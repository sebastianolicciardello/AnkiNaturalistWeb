import {
  fetchObservations,
  fetchPreviewCached,
  fetchUser,
  INatApiError,
  INatUserNotFoundError,
  normalizeLogin,
} from '../lib/inat';
import {
  buildObservationUrl,
  estimateBytes,
  formatBytes,
  formatLocation,
  formatNumber,
  formatObservationDate,
  photoVariantUrl,
  qualityClass,
  qualityLabel,
} from '../lib/format';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MIN_LIMIT,
  PHOTO_SIZE_OPTIONS,
  type INatObservation,
  type INatPhoto,
  type INatUser,
  type Options,
  type PhotoSize,
  type QualityFilter,
} from '../lib/types';
import type { GenerateProgress, GenerateResult } from '../lib/generate';

type UiPhase = GenerateProgress['phase'] | 'observations';

const BASE_URL = import.meta.env.BASE_URL;
const ROOT = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
const WASM_URL = new URL(`${ROOT}sql-wasm.wasm`, window.location.origin).href;
const PHOTO_PROXY_URL = new URL(`${ROOT}api/photo`, window.location.origin).href;

function proxiedPhotoUrl(url: string): string {
  return `${PHOTO_PROXY_URL}?url=${encodeURIComponent(url)}`;
}

const PHASE_TITLES: Record<UiPhase, string> = {
  observations: 'Raccolta delle osservazioni',
  prepare: 'Preparazione',
  taxonomy: 'Tassonomia',
  photos: 'Immagini',
  notes: 'Flashcard',
  zip: 'Compressione',
};

let currentUser: INatUser | null = null;
let currentPreview: { observations: INatObservation[]; totalResults: number } | null = null;
let previewState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let searchController: AbortController | null = null;
let previewController: AbortController | null = null;
let generateController: AbortController | null = null;
let previewTimer: number | null = null;
let previewRequestId = 0;
let searchInFlight = false;
let isGenerating = false;
let resultObjectUrl: string | null = null;
let lastDefaultDeck = '';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento #${id} non trovato nella pagina.`);
  return element as T;
}

// Form di ricerca
const searchForm = byId<HTMLFormElement>('search-form');
const usernameInput = byId<HTMLInputElement>('username');
const searchButton = byId<HTMLButtonElement>('search-button');
const searchButtonLabel = byId<HTMLSpanElement>('search-button-label');
const exampleButton = byId<HTMLButtonElement>('example-user');
const formError = byId<HTMLParagraphElement>('form-error');

// Profilo
const workspace = byId<HTMLElement>('workspace');
const profileSection = byId<HTMLElement>('profile-section');
const profileAvatar = byId<HTMLImageElement>('profile-avatar');
const profileInitials = byId<HTMLDivElement>('profile-initials');
const profileName = byId<HTMLHeadingElement>('profile-name');
const profileLogin = byId<HTMLParagraphElement>('profile-login');
const profileStats = byId<HTMLParagraphElement>('profile-stats');
const profileLink = byId<HTMLAnchorElement>('profile-link');
const changeUserButton = byId<HTMLButtonElement>('change-user');

// Opzioni
const qualitySelect = byId<HTMLSelectElement>('quality-select');
const limitInput = byId<HTMLInputElement>('limit-input');
const photoSizeSelect = byId<HTMLSelectElement>('photo-size-select');
const localeSelect = byId<HTMLSelectElement>('locale-select');
const includeWithoutPhoto = byId<HTMLInputElement>('include-without-photo');
const includeDescriptions = byId<HTMLInputElement>('include-descriptions');
const includeIdentifications = byId<HTMLInputElement>('include-identifications');
const deckNameInput = byId<HTMLInputElement>('deck-name');
const fromDateInput = byId<HTMLInputElement>('from-date');
const toDateInput = byId<HTMLInputElement>('to-date');
const dateError = byId<HTMLParagraphElement>('date-error');
const generateButton = byId<HTMLButtonElement>('generate-button');
const generateButtonLabel = byId<HTMLSpanElement>('generate-button-label');
const generateSummary = byId<HTMLParagraphElement>('generate-summary');

// Anteprima
const previewGrid = byId<HTMLDivElement>('preview-grid');
const previewStatus = byId<HTMLParagraphElement>('preview-status');
const previewSummary = byId<HTMLParagraphElement>('preview-summary');
const previewErrorBox = byId<HTMLDivElement>('preview-error');
const previewErrorMessage = byId<HTMLParagraphElement>('preview-error-message');
const previewRetryButton = byId<HTMLButtonElement>('preview-retry');

// Progresso
const progressSection = byId<HTMLElement>('progress-section');
const progressTitle = byId<HTMLHeadingElement>('progress-title');
const progressMessage = byId<HTMLParagraphElement>('progress-message');
const progressBar = byId<HTMLDivElement>('progress-bar');
const progressFill = byId<HTMLDivElement>('progress-fill');
const progressCount = byId<HTMLSpanElement>('progress-count');
const progressUser = byId<HTMLParagraphElement>('progress-user');
const progressDeck = byId<HTMLParagraphElement>('progress-deck');
const cancelButton = byId<HTMLButtonElement>('cancel-button');

// Risultato
const resultSection = byId<HTMLElement>('result-section');
const downloadLink = byId<HTMLAnchorElement>('download-link');
const resultStats = byId<HTMLParagraphElement>('result-stats');
const resultDetails = byId<HTMLParagraphElement>('result-details');
const resultDeck = byId<HTMLParagraphElement>('result-deck');
const resultFilename = byId<HTMLParagraphElement>('result-filename');
const resultWarning = byId<HTMLDivElement>('result-warning');
const resultWarningTitle = byId<HTMLHeadingElement>('result-warning-title');
const resultWarningList = byId<HTMLUListElement>('result-warning-list');
const newDeckButton = byId<HTMLButtonElement>('new-deck-button');

// Errore
const errorSection = byId<HTMLElement>('error-section');
const errorMessage = byId<HTMLParagraphElement>('error-message');
const errorRetryButton = byId<HTMLButtonElement>('error-retry');
const errorBackButton = byId<HTMLButtonElement>('error-back');

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function initApp(): void {
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleSearch();
  });

  exampleButton.addEventListener('click', () => {
    usernameInput.value = 'kueda';
    void handleSearch();
  });

  changeUserButton.addEventListener('click', resetToSearch);
  qualitySelect.addEventListener('change', onFilterChange);
  includeWithoutPhoto.addEventListener('change', onFilterChange);
  localeSelect.addEventListener('change', onFilterChange);
  fromDateInput.addEventListener('change', onFilterChange);
  toDateInput.addEventListener('change', onFilterChange);

  limitInput.addEventListener('input', updateGenerateSummary);
  limitInput.addEventListener('blur', () => {
    limitInput.value = String(readLimit());
    updateGenerateSummary();
  });
  photoSizeSelect.addEventListener('change', updateGenerateSummary);
  includeDescriptions.addEventListener('change', updateGenerateSummary);
  includeIdentifications.addEventListener('change', updateGenerateSummary);
  deckNameInput.addEventListener('input', updateGenerateSummary);

  generateButton.addEventListener('click', () => void handleGenerate());
  cancelButton.addEventListener('click', cancelGeneration);
  previewRetryButton.addEventListener('click', () => void loadPreview());
  newDeckButton.addEventListener('click', resetToWorkspace);
  errorRetryButton.addEventListener('click', () => {
    hideError();
    void handleGenerate();
  });
  errorBackButton.addEventListener('click', () => {
    hideError();
    showWorkspace();
  });

  profileAvatar.addEventListener('error', () => {
    profileAvatar.hidden = true;
    profileInitials.hidden = false;
  });

  window.addEventListener('beforeunload', resetResultUrl);

  const params = new URLSearchParams(window.location.search);
  const initialUser = params.get('user') ?? params.get('username');
  if (initialUser) {
    usernameInput.value = initialUser;
    void handleSearch({ scroll: true });
  }

  updateGenerateSummary();
}

function onFilterChange(): void {
  updateGenerateSummary();
  if (currentUser) schedulePreview();
}

function readLimit(): number {
  const parsed = Number.parseInt(limitInput.value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}

function readOptions(): Options {
  const quality = (qualitySelect.value as QualityFilter) || 'all';
  const photoSize = (photoSizeSelect.value as PhotoSize) || 'medium';

  return {
    quality,
    limit: readLimit(),
    photoSize,
    locale: localeSelect.value || 'it',
    includeWithoutPhoto: includeWithoutPhoto.checked,
    includeDescriptions: includeDescriptions.checked,
    includeIdentifications: includeIdentifications.checked,
    deckName:
      deckNameInput.value.trim() ||
      (currentUser ? defaultDeckName(currentUser) : 'Le mie osservazioni iNaturalist'),
    fromDate: fromDateInput.value,
    toDate: toDateInput.value,
  };
}

function getDateError(options: Options): string | null {
  if (options.fromDate && options.toDate && options.fromDate > options.toDate) {
    return 'La data iniziale non può essere successiva alla data finale.';
  }
  return null;
}

function showDateError(message: string | null): void {
  dateError.hidden = !message;
  dateError.textContent = message ?? '';
  fromDateInput.classList.toggle('is-invalid', Boolean(message));
  toDateInput.classList.toggle('is-invalid', Boolean(message));
}

function defaultDeckName(user: INatUser): string {
  return `iNaturalist – @${user.login}`;
}

function setDefaultDeckName(user: INatUser): void {
  const nextDefault = defaultDeckName(user);
  if (!deckNameInput.value.trim() || deckNameInput.value === lastDefaultDeck) {
    deckNameInput.value = nextDefault;
  }
  lastDefaultDeck = nextDefault;
}

function updateSearchControls(): void {
  const disabled = searchInFlight || isGenerating;
  usernameInput.disabled = disabled;
  searchButton.disabled = disabled;
  exampleButton.disabled = disabled;
  searchButton.classList.toggle('is-loading', searchInFlight);
  searchButton.setAttribute('aria-busy', String(searchInFlight));
  searchButtonLabel.textContent = searchInFlight ? 'Cerco…' : 'Cerca';
}

function setSearchLoading(loading: boolean): void {
  searchInFlight = loading;
  updateSearchControls();
}

function updateUrl(login: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('user', login);
  window.history.replaceState(null, '', url);
}

function clearUrlUser(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('user');
  url.searchParams.delete('username');
  window.history.replaceState(null, '', url);
}

async function handleSearch({ scroll = true }: { scroll?: boolean } = {}): Promise<void> {
  if (isGenerating) return;

  const login = normalizeLogin(usernameInput.value);
  if (!login) {
    showFormError('Inserisci il tuo nickname iNaturalist.');
    usernameInput.focus();
    return;
  }

  searchController?.abort();
  previewController?.abort();
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }

  const controller = new AbortController();
  searchController = controller;

  setSearchLoading(true);
  hideFormError();
  hideError();
  hideResult();
  resetResultUrl();
  hideProgress();
  hideWorkspace();

  currentUser = null;
  currentPreview = null;
  previewState = 'idle';

  try {
    const user = await fetchUser(login, controller.signal);
    if (controller.signal.aborted) return;

    currentUser = user;
    updateUrl(user.login);
    setDefaultDeckName(user);
    renderProfile(user);
    showWorkspace();
    if (scroll) scrollToSection(workspace);

    setSearchLoading(false);
    await loadPreview();
  } catch (error) {
    if (isAbort(error)) return;
    if (error instanceof INatUserNotFoundError) showFormError(error.message);
    else showFormError(friendlyError(error));
    hideWorkspace();
  } finally {
    if (searchController === controller) {
      searchController = null;
      setSearchLoading(false);
    }
  }
}

function renderProfile(user: INatUser): void {
  profileName.textContent = user.name?.trim() || user.login;
  profileLogin.textContent = `@${user.login}`;

  const observations = formatNumber(user.observations_count ?? 0);
  const species = formatNumber(user.species_count ?? 0);
  profileStats.textContent = `${observations} osservazioni · ${species} specie`;

  if (user.icon_url) {
    profileAvatar.src = user.icon_url;
    profileAvatar.alt = `Avatar di ${user.login}`;
    profileAvatar.hidden = false;
    profileInitials.hidden = true;
  } else {
    profileAvatar.removeAttribute('src');
    profileAvatar.hidden = true;
    profileInitials.hidden = false;
  }

  profileInitials.textContent = initials(user);
  profileLink.href = `https://www.inaturalist.org/people/${encodeURIComponent(user.login)}`;
  profileSection.hidden = false;
}

function initials(user: INatUser): string {
  const source = (user.name?.trim() || user.login).trim();
  return source
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function schedulePreview(): void {
  if (!currentUser) return;
  if (previewTimer !== null) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    previewTimer = null;
    void loadPreview();
  }, 350);
}

async function loadPreview(): Promise<void> {
  if (!currentUser) return;

  const options = readOptions();
  const dateProblem = getDateError(options);
  if (dateProblem) {
    showDateError(dateProblem);
    previewController?.abort();
    previewState = 'error';
    currentPreview = null;
    renderPreviewError(dateProblem);
    updateGenerateSummary();
    return;
  }
  showDateError(null);

  previewController?.abort();
  const controller = new AbortController();
  previewController = controller;
  const requestId = ++previewRequestId;

  setPreviewLoading();

  try {
    const preview = await fetchPreviewCached(
      {
        login: currentUser.login,
        quality: options.quality,
        includeWithoutPhoto: options.includeWithoutPhoto,
        locale: options.locale,
        fromDate: options.fromDate || undefined,
        toDate: options.toDate || undefined,
      },
      controller.signal
    );

    if (controller.signal.aborted || requestId !== previewRequestId) return;

    currentPreview = preview;
    previewState = 'ready';
    renderPreview(preview);
  } catch (error) {
    if (isAbort(error)) return;
    if (requestId !== previewRequestId) return;

    currentPreview = null;
    previewState = 'error';
    renderPreviewError(friendlyError(error));
  } finally {
    if (requestId === previewRequestId) {
      previewGrid.setAttribute('aria-busy', 'false');
      updateGenerateSummary();
    }
  }
}

function setPreviewLoading(): void {
  previewState = 'loading';
  currentPreview = null;
  previewStatus.textContent = "Carico l'anteprima…";
  previewSummary.textContent = '';
  previewErrorBox.hidden = true;
  previewRetryButton.hidden = true;
  previewGrid.setAttribute('aria-busy', 'true');
  renderSkeletons(4);
  updateGenerateSummary();
}

function renderSkeletons(count: number): void {
  previewGrid.replaceChildren(
    ...Array.from({ length: count }, () => {
      const card = document.createElement('div');
      card.className = 'preview-card preview-skeleton';
      card.innerHTML =
        '<div class="preview-skeleton-media"></div>' +
        '<div class="preview-skeleton-line preview-skeleton-line-lg"></div>' +
        '<div class="preview-skeleton-line"></div>' +
        '<div class="preview-skeleton-line preview-skeleton-line-sm"></div>';
      return card;
    })
  );
}

function renderPreview(preview: { observations: INatObservation[]; totalResults: number }): void {
  previewErrorBox.hidden = true;
  previewRetryButton.hidden = true;

  if (preview.totalResults === 0) {
    previewStatus.textContent = 'Nessuna osservazione trovata';
    previewSummary.textContent = 'Prova a cambiare i filtri, il periodo o il nickname.';
    previewGrid.replaceChildren(createPreviewEmpty());
    return;
  }

  const shown = preview.observations.length;
  previewStatus.textContent =
    shown < preview.totalResults
      ? `Anteprima delle prime ${formatNumber(shown)} osservazioni`
      : `${formatNumber(shown)} osservazioni trovate`;
  previewSummary.textContent =
    shown < preview.totalResults
      ? `Su ${formatNumber(preview.totalResults)} disponibili con i filtri scelti.`
      : 'Tutte le osservazioni corrispondenti sono in anteprima.';

  previewGrid.replaceChildren(
    ...preview.observations.map((observation) => createPreviewCard(observation))
  );
}

function renderPreviewError(message: string): void {
  previewStatus.textContent = 'Anteprima non disponibile';
  previewSummary.textContent = '';
  previewGrid.replaceChildren();
  previewGrid.setAttribute('aria-busy', 'false');
  previewErrorMessage.textContent = message;
  previewErrorBox.hidden = false;
  previewRetryButton.hidden = false;
}

function createPreviewCard(observation: INatObservation): HTMLElement {
  const card = document.createElement('a');
  card.className = 'preview-card';
  card.href = buildObservationUrl(observation);
  card.target = '_blank';
  card.rel = 'noreferrer';

  const media = document.createElement('div');
  media.className = 'preview-media';

  const photo = firstVisiblePhoto(observation);
  if (photo) {
    const image = document.createElement('img');
    image.src = proxiedPhotoUrl(photoVariantUrl(photo.url, 'small'));
    image.alt = observation.taxon?.name ?? 'Osservazione iNaturalist';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.remove();
      media.classList.add('is-empty');
      media.append(createLeafPlaceholder());
    });
    media.append(image);
  } else {
    media.classList.add('is-empty');
    media.append(createLeafPlaceholder());
  }

  const badge = document.createElement('span');
  badge.className = `preview-badge preview-quality-${qualityClass(observation.quality_grade)}`;
  badge.textContent = qualityLabel(observation.quality_grade);
  media.append(badge);

  const body = document.createElement('div');
  body.className = 'preview-body';

  const scientificName = document.createElement('div');
  scientificName.className = 'preview-sci';
  scientificName.textContent = observation.taxon?.name || 'Sconosciuto';

  const commonName = observation.taxon?.preferred_common_name?.trim();
  const common = document.createElement('div');
  common.className = 'preview-common';
  common.textContent = commonName || '';

  const meta = document.createElement('div');
  meta.className = 'preview-meta';
  meta.textContent = `${formatObservationDate(observation)} · ${formatLocation(observation)}`;

  body.append(scientificName);
  if (commonName) body.append(common);
  body.append(meta);

  card.append(media, body);
  return card;
}

function createPreviewEmpty(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'preview-empty';
  empty.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4C12 4 5 9 5 17c0 1.5.4 2.5 1 3 2-6 6-9 11-11-4 3-7 7-8 12 7 0 11-6 11-17Z" fill="currentColor"/></svg>' +
    '<p>Nessuna osservazione con questi filtri.</p>' +
    '<small>Prova a includere più qualità o ad allargare il periodo.</small>';
  return empty;
}

function createLeafPlaceholder(): HTMLElement {
  const placeholder = document.createElement('div');
  placeholder.className = 'preview-placeholder';
  placeholder.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4C12 4 5 9 5 17c0 1.5.4 2.5 1 3 2-6 6-9 11-11-4 3-7 7-8 12 7 0 11-6 11-17Z" fill="currentColor"/></svg>' +
    '<span>Nessuna foto</span>';
  return placeholder;
}

function firstVisiblePhoto(observation: INatObservation): INatPhoto | null {
  return (
    (observation.photos ?? []).find((photo) => Boolean(photo.url) && !photo.hidden) ?? null
  );
}

function updateGenerateSummary(): void {
  const options = readOptions();
  const dateProblem = getDateError(options);
  const preview = currentPreview;
  showDateError(dateProblem);

  if (
    isGenerating ||
    previewState !== 'ready' ||
    !preview ||
    preview.totalResults === 0 ||
    Boolean(dateProblem)
  ) {
    generateButton.disabled = true;

    if (dateProblem) {
      generateButtonLabel.textContent = 'Controlla le date';
      generateSummary.textContent = dateProblem;
    } else if (previewState === 'loading') {
      generateButtonLabel.textContent = 'Calcolo le osservazioni…';
      generateSummary.textContent = 'Sto recuperando il conteggio da iNaturalist.';
    } else if (previewState === 'error') {
      generateButtonLabel.textContent = 'Anteprima non disponibile';
      generateSummary.textContent = 'Riprova a caricare l’anteprima.';
    } else if (preview && preview.totalResults === 0) {
      generateButtonLabel.textContent = 'Nessuna osservazione';
      generateSummary.textContent = 'Modifica i filtri per trovare osservazioni.';
    } else {
      generateButtonLabel.textContent = 'Crea il mazzo';
      generateSummary.textContent = 'Cerca un utente per iniziare.';
    }
    return;
  }

  const count = Math.min(options.limit, preview.totalResults);
  const estimate = estimateBytes(count, options.photoSize);
  const sizeLabel =
    PHOTO_SIZE_OPTIONS.find((option) => option.value === options.photoSize)?.label.toLowerCase() ??
    options.photoSize;

  generateButton.disabled = false;
  generateButtonLabel.textContent = `Crea ${formatNumber(count)} flashcard`;
  generateSummary.textContent = `~${formatBytes(estimate)} · ${formatNumber(count)} note · foto ${sizeLabel}`;
}

async function handleGenerate(): Promise<void> {
  if (!currentUser || !currentPreview || previewState !== 'ready' || isGenerating) return;

  const options = readOptions();
  const dateProblem = getDateError(options);
  if (dateProblem) {
    showDateError(dateProblem);
    return;
  }

  const expected = Math.min(options.limit, currentPreview.totalResults);
  if (expected <= 0) return;

  const estimate = estimateBytes(expected, options.photoSize);
  if (expected > 1000 || estimate > 250 * 1024 * 1024) {
    const proceed = window.confirm(
      `Il mazzo conterrà circa ${formatNumber(expected)} flashcard (~${formatBytes(
        estimate
      )}). Su dispositivi con poca memoria potrebbe richiedere tempo. Vuoi continuare?`
    );
    if (!proceed) return;
  }

  isGenerating = true;
  updateSearchControls();
  resetResultUrl();
  hideError();
  hideResult();
  showProgress(options);

  const controller = new AbortController();
  generateController = controller;
  const signal = controller.signal;
  let outcome: 'success' | 'error' | 'cancel' = 'cancel';

  try {
    setProgress('observations', 0, expected, 'Recupero le osservazioni da iNaturalist…');

    const generateModulePromise = import('../lib/generate');
    const observationsPromise = fetchObservations({
      login: currentUser.login,
      quality: options.quality,
      includeWithoutPhoto: options.includeWithoutPhoto,
      locale: options.locale,
      fromDate: options.fromDate || undefined,
      toDate: options.toDate || undefined,
      limit: expected,
      signal,
      onProgress: (current, total) =>
        setProgress(
          'observations',
          current,
          total,
          `Recupero le osservazioni (${formatNumber(current)}/${formatNumber(total)})…`
        ),
    });

    const [{ generateApkg }, { observations }] = await Promise.all([
      generateModulePromise,
      observationsPromise,
    ]);

    if (signal.aborted) throw abortError();
    if (observations.length === 0) {
      throw new Error('Nessuna osservazione trovata con i filtri selezionati.');
    }

    const result = await generateApkg({
      user: currentUser,
      observations,
      options,
      signal,
      wasmUrl: WASM_URL,
      photoProxyUrl: PHOTO_PROXY_URL,
      onProgress: (progress) =>
        setProgress(progress.phase, progress.current, progress.total, progress.message),
    });

    if (signal.aborted) return;

    showResult(result);
    outcome = 'success';
  } catch (error) {
    if (isAbort(error)) {
      outcome = 'cancel';
      return;
    }
    outcome = 'error';
    showError(friendlyError(error));
  } finally {
    isGenerating = false;
    generateController = null;
    updateSearchControls();
    if (outcome === 'cancel') showWorkspace();
  }
}

function showProgress(options: Options): void {
  progressSection.hidden = false;
  workspace.hidden = true;
  resultSection.hidden = true;
  errorSection.hidden = true;
  progressUser.textContent = currentUser ? `@${currentUser.login}` : '';
  progressDeck.textContent = options.deckName;
  progressTitle.textContent = PHASE_TITLES.observations;
  progressMessage.textContent = 'Recupero le osservazioni da iNaturalist…';
  progressCount.textContent = '';
  progressFill.style.width = '0%';
  progressBar.classList.add('is-indeterminate');
  progressBar.removeAttribute('aria-valuenow');
  progressBar.setAttribute('aria-valuetext', 'Recupero le osservazioni…');
  cancelButton.disabled = false;
  scrollToSection(progressSection);
}

function setProgress(phase: UiPhase, current: number, total: number, message: string): void {
  progressTitle.textContent = PHASE_TITLES[phase];
  progressMessage.textContent = message;
  progressCount.textContent =
    total > 0 ? `${formatNumber(current)} / ${formatNumber(total)}` : '';

  const indeterminate = current === 0 || total <= 0;
  const percent = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
  progressFill.style.width = `${percent}%`;
  progressBar.classList.toggle('is-indeterminate', indeterminate);

  if (indeterminate) {
    progressBar.removeAttribute('aria-valuenow');
  } else {
    progressBar.setAttribute('aria-valuenow', String(Math.round(percent)));
  }
  progressBar.setAttribute('aria-valuetext', message);
}

function cancelGeneration(): void {
  if (!generateController) return;
  generateController.abort();
  cancelButton.disabled = true;
  progressMessage.textContent = 'Annullamento in corso…';
  progressBar.classList.add('is-indeterminate');
  progressBar.removeAttribute('aria-valuenow');
  progressBar.setAttribute('aria-valuetext', 'Annullamento in corso');
  progressFill.style.width = '0%';
}

function showResult(result: GenerateResult): void {
  resetResultUrl();
  resultObjectUrl = URL.createObjectURL(result.blob);

  downloadLink.href = resultObjectUrl;
  downloadLink.download = result.filename;
  resultStats.textContent = `${formatNumber(result.noteCount)} flashcard · ${formatBytes(
    result.bytes
  )}`;
  resultDetails.textContent = `${formatNumber(result.photoCount)} foto incluse`;
  resultDeck.textContent = result.deckName;
  resultFilename.textContent = result.filename;

  if (result.skipped.length > 0) {
    resultWarning.hidden = false;
    resultWarningTitle.textContent = `${formatNumber(
      result.skipped.length
    )} osservazioni saltate (foto non disponibile)`;
    resultWarningList.replaceChildren(
      ...result.skipped.slice(0, 8).map((skipped) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = skipped.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = `#${skipped.id}`;
        item.append(link, document.createTextNode(` — ${skipped.reason}`));
        return item;
      })
    );
    if (result.skipped.length > 8) {
      const more = document.createElement('li');
      more.textContent = `… e altre ${formatNumber(result.skipped.length - 8)} osservazioni.`;
      resultWarningList.append(more);
    }
  } else {
    resultWarning.hidden = true;
    resultWarningList.replaceChildren();
  }

  progressSection.hidden = true;
  workspace.hidden = true;
  errorSection.hidden = true;
  resultSection.hidden = false;
  scrollToSection(resultSection);
}

function showError(message: string): void {
  errorMessage.textContent = message;
  errorSection.hidden = false;
  progressSection.hidden = true;
  workspace.hidden = true;
  resultSection.hidden = true;
  scrollToSection(errorSection);
}

function hideError(): void {
  errorSection.hidden = true;
}

function showFormError(message: string): void {
  formError.textContent = message;
  formError.hidden = false;
}

function hideFormError(): void {
  formError.hidden = true;
  formError.textContent = '';
}

function showWorkspace(): void {
  workspace.hidden = false;
  progressSection.hidden = true;
  resultSection.hidden = true;
  errorSection.hidden = true;
}

function hideWorkspace(): void {
  workspace.hidden = true;
}

function hideProgress(): void {
  progressSection.hidden = true;
}

function hideResult(): void {
  resultSection.hidden = true;
}

function resetToWorkspace(): void {
  resetResultUrl();
  hideError();
  hideResult();
  hideProgress();
  showWorkspace();
  updateGenerateSummary();
  scrollToSection(workspace);
}

function resetToSearch(): void {
  searchController?.abort();
  previewController?.abort();
  if (previewTimer !== null) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }

  currentUser = null;
  currentPreview = null;
  previewState = 'idle';
  previewRequestId += 1;
  lastDefaultDeck = '';
  setSearchLoading(false);
  hideFormError();
  hideError();
  resetResultUrl();
  hideProgress();
  hideResult();
  hideWorkspace();
  clearUrlUser();
  updateGenerateSummary();

  usernameInput.focus();
  usernameInput.select();
  scrollToSection(searchForm);
}

function resetResultUrl(): void {
  if (resultObjectUrl) {
    URL.revokeObjectURL(resultObjectUrl);
    resultObjectUrl = null;
  }
  downloadLink.removeAttribute('href');
  downloadLink.removeAttribute('download');
}

function scrollToSection(element: HTMLElement): void {
  element.scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: 'start',
  });
}

function friendlyError(error: unknown): string {
  if (error instanceof INatApiError) return error.message;
  if (error instanceof Error) {
    if (error.name === 'TypeError' && /fetch|network|load/i.test(error.message)) {
      return 'Connessione non riuscita. Controlla la rete e riprova.';
    }
    return error.message;
  }
  return 'Si è verificato un errore imprevisto. Riprova.';
}

function abortError(): DOMException {
  return new DOMException('Operazione annullata', 'AbortError');
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

initApp();
