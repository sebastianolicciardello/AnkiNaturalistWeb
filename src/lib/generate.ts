import AnkiExport from 'anki-apkg-export';
import type { INatObservation, INatPhoto, INatUser, Options, PhotoSize } from './types';
import { CARD_NAME, FIELD_NAMES, MODEL_NAME, TAG_ROOT } from './types';
import {
  ANSWER_FORMAT,
  CARD_CSS,
  PLACEHOLDER_FILENAME,
  QUESTION_FORMAT,
  buildNoteFields,
} from './cards';
import {
  buildObservationUrl,
  collectTaxonIds,
  photoFilename,
  photoVariantUrl,
  qualityClass,
} from './format';
import type { TaxonInfo } from './format';
import { fetchTaxaInfo } from './inat';

export type GeneratePhase = 'prepare' | 'taxonomy' | 'photos' | 'notes' | 'zip';

export interface GenerateProgress {
  phase: GeneratePhase;
  current: number;
  total: number;
  message: string;
}

export interface SkippedObservation {
  id: number;
  url: string;
  reason: string;
}

export interface GenerateResult {
  blob: Blob;
  filename: string;
  deckName: string;
  noteCount: number;
  photoCount: number;
  skipped: SkippedObservation[];
  bytes: number;
}

export interface GenerateParams {
  user: INatUser;
  observations: INatObservation[];
  options: Options;
  signal: AbortSignal;
  wasmUrl: string;
  photoProxyUrl: string;
  onProgress: (progress: GenerateProgress) => void;
}

interface PreparedCard {
  observation: INatObservation;
  photo: INatPhoto | null;
  photoFile: string;
}

const PHOTO_CONCURRENCY = 5;

export async function generateApkg(params: GenerateParams): Promise<GenerateResult> {
  const { user, observations, options, signal, wasmUrl, photoProxyUrl, onProgress } = params;

  if (observations.length === 0) {
    throw new Error('Nessuna osservazione da includere nel mazzo.');
  }

  onProgress({
    phase: 'prepare',
    current: 0,
    total: 1,
    message: 'Preparo il generatore di mazzi…',
  });

  let apkg: AnkiExport;
  try {
    // Passiamo il modello direttamente alla creazione: così il pacchetto non
    // contiene il modello Basic inutilizzato che la libreria aggiungerebbe.
    apkg = await AnkiExport.create(options.deckName, {
      locateFile: () => wasmUrl,
      model: {
        name: MODEL_NAME,
        fields: [...FIELD_NAMES],
        sortField: 'ScientificName',
        css: CARD_CSS,
        templates: [
          {
            name: CARD_NAME,
            questionFormat: QUESTION_FORMAT,
            answerFormat: ANSWER_FORMAT,
            requiredFields: ['ObservationID'],
          },
        ],
      },
    });
  } catch (error) {
    console.error('Inizializzazione AnkiExport fallita', error);
    throw new Error(
      'Impossibile inizializzare il generatore di mazzi. Ricarica la pagina e riprova.'
    );
  }

  try {
    const modelId = apkg.topModelId;

    // La tassonomia è un extra: se l'API non risponde, il mazzo viene creato
    // ugualmente con il solo nome scientifico.
    let taxa = new Map<number, TaxonInfo>();
    try {
      const taxonIds = collectTaxonIds(observations);
      if (taxonIds.length > 0) {
        taxa = await fetchTaxaInfo(
          taxonIds,
          options.locale,
          (current, total) =>
            onProgress({
              phase: 'taxonomy',
              current,
              total,
              message: 'Recupero la tassonomia…',
            }),
          signal
        );
      }
    } catch (error) {
      if (isAbort(error)) throw error;
      console.warn('Tassonomia non disponibile, proseguo senza.', error);
    }

    const order = new Map(observations.map((observation, index) => [observation.id, index]));
    const cards: PreparedCard[] = [];
    const skipped: SkippedObservation[] = [];
    let processed = 0;

    onProgress({
      phase: 'photos',
      current: 0,
      total: observations.length,
      message: 'Scarico le foto delle osservazioni…',
    });

    await runPool(
      observations,
      PHOTO_CONCURRENCY,
      async (observation) => {
        const downloaded = await downloadFirstPhoto(
          observation,
          options.photoSize,
          photoProxyUrl,
          signal
        );

        if (downloaded) {
          const filename = photoFilename(observation.id, downloaded.photo);
          apkg.addMedia(filename, downloaded.blob);
          cards.push({ observation, photo: downloaded.photo, photoFile: filename });
        } else if (options.includeWithoutPhoto) {
          cards.push({ observation, photo: null, photoFile: PLACEHOLDER_FILENAME });
        } else {
          skipped.push({
            id: observation.id,
            url: buildObservationUrl(observation),
            reason: 'Foto non disponibile',
          });
        }

        processed += 1;
        onProgress({
          phase: 'photos',
          current: processed,
          total: observations.length,
          message: `Preparo le immagini (${processed}/${observations.length})…`,
        });
      },
      signal
    );

    cards.sort(
      (a, b) => (order.get(a.observation.id) ?? 0) - (order.get(b.observation.id) ?? 0)
    );
    skipped.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    if (cards.length === 0) {
      throw new Error(
        'Nessuna foto è stata scaricata. Prova a includere le osservazioni senza foto o ad ampliare i filtri.'
      );
    }

    if (cards.some((card) => card.photo === null)) {
      const placeholder = await createPlaceholderBlob();
      apkg.addMedia(PLACEHOLDER_FILENAME, placeholder);
    }

    const notes = cards.map((card) => ({
      fields: buildNoteFields(card.observation, card.photo, card.photoFile, taxa, options),
      noteId: card.observation.id,
      tags: tagsFor(card.observation, user.login),
      modelId,
    }));

    const notesChunkSize = 50;
    for (let index = 0; index < notes.length; index += notesChunkSize) {
      const chunk = notes.slice(index, index + notesChunkSize);
      apkg.addNotes(chunk);
      const current = Math.min(index + notesChunkSize, notes.length);
      onProgress({
        phase: 'notes',
        current,
        total: notes.length,
        message: `Creo le flashcard (${current}/${notes.length})…`,
      });
    }

    onProgress({
      phase: 'zip',
      current: 0,
      total: 1,
      message: 'Compressione del mazzo…',
    });

    const blob = await apkg.save({ type: 'blob' });
    if (signal.aborted) throw abortError();

    return {
      blob,
      filename: buildApkgFilename(user.login),
      deckName: options.deckName,
      noteCount: cards.length,
      photoCount: cards.filter((card) => card.photo !== null).length,
      skipped,
      bytes: blob.size,
    };
  } finally {
    apkg.close();
  }
}

function visiblePhotos(observation: INatObservation): INatPhoto[] {
  return (observation.photos ?? []).filter((photo) => Boolean(photo.url) && !photo.hidden);
}

async function downloadFirstPhoto(
  observation: INatObservation,
  size: PhotoSize,
  photoProxyUrl: string,
  signal: AbortSignal
): Promise<{ photo: INatPhoto; blob: Blob } | null> {
  const photos = visiblePhotos(observation);

  for (const photo of photos) {
    for (const variant of photoSizeFallbacks(size)) {
      if (signal.aborted) throw abortError();

      try {
        const blob = await fetchPhoto(
          photoVariantUrl(photo.url, variant),
          photoProxyUrl,
          signal
        );
        return { photo, blob };
      } catch (error) {
        if (isAbort(error)) throw error;
        // Variante non disponibile: proviamo la successiva o la foto successiva.
      }
    }
  }

  return null;
}

function photoSizeFallbacks(size: PhotoSize): readonly PhotoSize[] {
  if (size === 'large') return ['large', 'medium', 'small'];
  if (size === 'medium') return ['medium', 'small'];
  return ['small'];
}

async function fetchPhoto(
  photoUrl: string,
  photoProxyUrl: string,
  signal: AbortSignal
): Promise<Blob> {
  const response = await fetch(`${photoProxyUrl}?url=${encodeURIComponent(photoUrl)}`, {
    signal,
  });

  if (!response.ok) {
    throw new Error(`Download foto fallito (HTTP ${response.status}).`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('La risposta non contiene un\'immagine.');
  }
  if (blob.size === 0) {
    throw new Error('Immagine vuota.');
  }
  return blob;
}

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal: AbortSignal
): Promise<void> {
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (true) {
        if (signal.aborted) throw abortError();

        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;

        const item = items[index];
        if (item === undefined) continue;
        await worker(item);
      }
    }
  );

  await Promise.all(workers);
}

function tagsFor(observation: INatObservation, login: string): string[] {
  const tags = [TAG_ROOT, 'inat', `inat::${qualityClass(observation.quality_grade)}`];
  if (login) tags.push(`inat::user::${login}`);
  return tags;
}

function buildApkgFilename(login: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const safeLogin =
    login
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'inat';
  return `iNaturalist-${safeLogin}-${date}.apkg`;
}

async function createPlaceholderBlob(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 600;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas non disponibile per l\'immagine segnaposto.');

  const gradient = context.createLinearGradient(0, 0, 900, 600);
  gradient.addColorStop(0, '#e8f0e2');
  gradient.addColorStop(1, '#c9dfae');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 900, 600);

  context.fillStyle = 'rgba(45, 98, 72, 0.08)';
  context.beginPath();
  context.arc(120, 90, 160, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(800, 520, 200, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.translate(450, 260);
  context.rotate(-Math.PI / 5);
  context.fillStyle = 'rgba(45, 98, 72, 0.9)';
  context.beginPath();
  context.ellipse(0, 0, 90, 150, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(246, 244, 236, 0.8)';
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(0, -130);
  context.lineTo(0, 130);
  context.stroke();
  context.restore();

  context.fillStyle = '#2d6248';
  context.font = '600 34px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.fillText('Nessuna foto disponibile', 450, 520);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Impossibile creare l\'immagine segnaposto.'));
      },
      'image/png'
    );
  });
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
