import type {
  INatObservation,
  INatObservationResponse,
  INatTaxaResponse,
  INatTaxon,
  INatUser,
  INatUserResponse,
  QualityFilter,
} from './types';
import type { TaxonInfo } from './format';

const API_BASE = 'https://api.inaturalist.org/v1';
const MIN_REQUEST_INTERVAL_MS = 1100;
const PAGE_SIZE = 200;
const PREVIEW_PAGE_SIZE = 8;
const PREVIEW_TTL_MS = 5 * 60 * 1000;

let lastRequestAt = 0;
let requestChain: Promise<unknown> = Promise.resolve();

export class INatApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'INatApiError';
    this.status = status;
  }
}

export class INatUserNotFoundError extends Error {
  readonly login: string;

  constructor(login: string) {
    super(`Nessun utente iNaturalist trovato con il nickname “${login}”.`);
    this.name = 'INatUserNotFoundError';
    this.login = login;
  }
}

function abortError(): DOMException {
  return new DOMException('Operazione annullata', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Serializza le richieste e impone almeno 1,1 s tra una e l'altra.
 * Le linee guida iNaturalist consigliano non più di 60 richieste al minuto.
 */
async function rateLimitedFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const run = requestChain.then(async () => {
    if (signal?.aborted) throw abortError();

    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await sleep(wait, signal);

    lastRequestAt = Date.now();
    return fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });
  });

  requestChain = run.catch(() => undefined);
  return run;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await rateLimitedFetch(url, signal);

  if (!response.ok) {
    if (response.status === 404) {
      throw new INatApiError('Risorsa non trovata su iNaturalist.', 404);
    }
    if (response.status === 429) {
      throw new INatApiError(
        'iNaturalist ha temporaneamente limitato le richieste. Attendi un minuto e riprova.',
        429
      );
    }
    if (response.status >= 500) {
      throw new INatApiError(
        'iNaturalist non è raggiungibile in questo momento. Riprova tra poco.',
        response.status
      );
    }
    throw new INatApiError(
      `iNaturalist ha risposto con un errore (HTTP ${response.status}).`,
      response.status
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new INatApiError('iNaturalist ha restituito una risposta non valida.');
  }
}

export function normalizeLogin(input: string): string {
  return input.trim().replace(/^@+/, '').trim();
}

export async function fetchUser(login: string, signal?: AbortSignal): Promise<INatUser> {
  try {
    const data = await fetchJson<INatUserResponse>(
      `${API_BASE}/users/${encodeURIComponent(login)}`,
      signal
    );
    const user = data.results?.[0];
    if (!user || (data.total_results ?? 0) === 0) throw new INatUserNotFoundError(login);
    return user;
  } catch (error) {
    if (error instanceof INatApiError && error.status === 404) {
      throw new INatUserNotFoundError(login);
    }
    throw error;
  }
}

export interface ObservationQuery {
  login: string;
  quality: QualityFilter;
  includeWithoutPhoto: boolean;
  locale: string;
  fromDate?: string;
  toDate?: string;
}

function qualityGrades(quality: QualityFilter): string | null {
  switch (quality) {
    case 'research':
      return 'research';
    case 'needs_id':
      return 'needs_id';
    case 'casual':
      return 'casual';
    case 'verifiable':
      return 'research,needs_id';
    default:
      return null;
  }
}

function buildObservationsUrl(
  query: ObservationQuery,
  page: number,
  perPage: number
): string {
  const url = new URL(`${API_BASE}/observations`);
  url.searchParams.set('user_login', query.login);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('order_by', 'observed_on');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('locale', query.locale);
  url.searchParams.set('ttl', '300');

  if (!query.includeWithoutPhoto) url.searchParams.set('photos', 'true');

  const quality = qualityGrades(query.quality);
  if (quality) url.searchParams.set('quality_grade', quality);
  if (query.fromDate) url.searchParams.set('d1', query.fromDate);
  if (query.toDate) url.searchParams.set('d2', query.toDate);

  return url.toString();
}

async function fetchObservationsPage(
  query: ObservationQuery,
  page: number,
  perPage: number,
  signal?: AbortSignal
): Promise<INatObservationResponse> {
  return fetchJson<INatObservationResponse>(
    buildObservationsUrl(query, page, perPage),
    signal
  );
}

const previewCache = new Map<
  string,
  { storedAt: number; data: { observations: INatObservation[]; totalResults: number } }
>();

function previewCacheKey(query: ObservationQuery): string {
  return JSON.stringify({
    login: query.login.toLowerCase(),
    quality: query.quality,
    includeWithoutPhoto: query.includeWithoutPhoto,
    locale: query.locale,
    fromDate: query.fromDate ?? '',
    toDate: query.toDate ?? '',
  });
}

export async function fetchPreviewCached(
  query: ObservationQuery,
  signal?: AbortSignal
): Promise<{ observations: INatObservation[]; totalResults: number }> {
  const key = previewCacheKey(query);
  const cached = previewCache.get(key);
  if (cached && Date.now() - cached.storedAt < PREVIEW_TTL_MS) {
    return cached.data;
  }

  const response = await fetchObservationsPage(query, 1, PREVIEW_PAGE_SIZE, signal);
  const data = {
    observations: response.results ?? [],
    totalResults: response.total_results ?? 0,
  };

  previewCache.delete(key);
  previewCache.set(key, { storedAt: Date.now(), data });
  if (previewCache.size > 24) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey !== undefined) previewCache.delete(oldestKey);
  }

  return data;
}

export interface FetchObservationsOptions extends ObservationQuery {
  limit: number;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
}

export async function fetchObservations(
  options: FetchObservationsOptions
): Promise<{ observations: INatObservation[]; totalResults: number }> {
  const limit = Math.max(1, options.limit);
  const observations: INatObservation[] = [];
  let totalResults = 0;
  let page = 1;

  while (observations.length < limit) {
    const remaining = limit - observations.length;
    const perPage = Math.min(PAGE_SIZE, remaining);
    const response = await fetchObservationsPage(
      options,
      page,
      perPage,
      options.signal
    );

    if (page === 1) totalResults = response.total_results ?? 0;

    const pageResults = response.results ?? [];
    observations.push(...pageResults);
    options.onProgress?.(
      Math.min(observations.length, limit),
      Math.min(totalResults || limit, limit)
    );

    if (
      pageResults.length === 0 ||
      pageResults.length < perPage ||
      observations.length >= totalResults
    ) {
      break;
    }

    page += 1;
  }

  return {
    observations: observations.slice(0, limit),
    totalResults,
  };
}

/**
 * Recupera i nomi dei taxon in blocchi da 200 (limite pratico dell'API).
 * L'endpoint /taxa accetta `id` come lista separata da virgole.
 */
export async function fetchTaxaInfo(
  ids: number[],
  locale: string,
  onProgress?: (current: number, total: number) => void,
  signal?: AbortSignal
): Promise<Map<number, TaxonInfo>> {
  const uniqueIds = [...new Set(ids)].filter((id) => Number.isFinite(id));
  const result = new Map<number, TaxonInfo>();
  if (uniqueIds.length === 0) return result;

  const chunks: number[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 200) {
    chunks.push(uniqueIds.slice(index, index + 200));
  }

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;

    const url = new URL(`${API_BASE}/taxa`);
    url.searchParams.set('id', chunk.join(','));
    url.searchParams.set('per_page', '200');
    url.searchParams.set('locale', locale);

    const data = await fetchJson<INatTaxaResponse>(url.toString(), signal);
    for (const taxon of data.results ?? []) {
      result.set(taxon.id, taxonInfoFromApi(taxon));
    }

    onProgress?.(index + 1, chunks.length);
  }

  return result;
}

function taxonInfoFromApi(taxon: INatTaxon): TaxonInfo {
  return {
    id: taxon.id,
    name: taxon.name,
    rank: taxon.rank ?? null,
    rankLevel: taxon.rank_level ?? null,
    preferredCommonName: taxon.preferred_common_name ?? null,
  };
}
