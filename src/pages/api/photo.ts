/**
 * Proxy delle foto iNaturalist.
 *
 * Le immagini servite da static.inaturalist.org non espongono header CORS,
 * quindi il browser non può scaricarle con fetch() per includerle nel mazzo.
 * Questo endpoint recupera solo URL riconducibili ai CDN fotografici di
 * iNaturalist e restituisce il flusso originale, con cache lato client.
 *
 * La generazione dell'APKG resta interamente nel browser: qui transitano
 * soltanto i byte delle immagini.
 */

export const prerender = false;

const ALLOWED_HOSTS = new Set([
  'inaturalist-open-data.s3.amazonaws.com',
  'inaturalist-open-data.s3.us-east-1.amazonaws.com',
  'static.inaturalist.org',
]);

// I nomi file delle foto iNaturalist hanno sempre la forma
// /photos/<id>/<dimensione>.<estensione>. Il vincolo impedisce di usare il
// proxy per raggiungere altri percorsi dello stesso host.
const PHOTO_PATH = /^\/photos\/\d+\/(?:square|small|medium|large)\.(?:jpe?g|png|gif|webp)$/i;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const UPSTREAM_TIMEOUT_MS = 30_000;

function errorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function parsePhotoUrl(raw: string | null): URL | null {
  if (!raw || raw.length > 2_048) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (!PHOTO_PATH.test(url.pathname)) return null;

  return url;
}

export async function GET({ request }: { request: Request }): Promise<Response> {
  const requestUrl = new URL(request.url);
  const photoUrl = parsePhotoUrl(requestUrl.searchParams.get('url'));

  if (!photoUrl) {
    return errorResponse('Parametro url non valido.', 400);
  }

  const timeoutSignal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const signal = request.signal
    ? AbortSignal.any([request.signal, timeoutSignal])
    : timeoutSignal;

  let upstream: Response;
  try {
    upstream = await fetch(photoUrl, {
      signal,
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
        'User-Agent': 'AnkiNaturalistWeb/0.1 (generatore di mazzi Anki)',
      },
    });
  } catch (error) {
    if (request.signal?.aborted) {
      return errorResponse('Richiesta annullata.', 499);
    }
    if (timeoutSignal.aborted) {
      return errorResponse('Il server fotografico non ha risposto in tempo.', 504);
    }
    console.error('Proxy foto: richiesta upstream fallita', error);
    return errorResponse('Impossibile contattare il server fotografico.', 502);
  }

  if (upstream.status === 404) {
    return errorResponse('Foto non trovata.', 404);
  }
  if (!upstream.ok) {
    return errorResponse(
      `Il server fotografico ha risposto con HTTP ${upstream.status}.`,
      502
    );
  }

  const contentType = (upstream.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();

  if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
    await upstream.body?.cancel();
    return errorResponse('Il server fotografico non ha restituito un\'immagine.', 502);
  }

  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=2592000, s-maxage=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });

  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers.set('Content-Length', contentLength);

  const etag = upstream.headers.get('etag');
  if (etag) headers.set('ETag', etag);

  const lastModified = upstream.headers.get('last-modified');
  if (lastModified) headers.set('Last-Modified', lastModified);

  return new Response(upstream.body, { status: 200, headers });
}

export function ALL(): Response {
  return new Response('Metodo non consentito.', {
    status: 405,
    headers: {
      Allow: 'GET',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
