import type {
  INatIdentification,
  INatObservation,
  INatPhoto,
  INatTaxon,
  Options,
  PhotoSize,
} from './types';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function sanitizeField(value: string): string {
  return value
    .replace(/\u0000/g, ' ')
    .replace(/\u001f/g, ' ')
    .replace(/\r\n/g, '\n');
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('it-IT').format(value);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** exponent;
  const formatted = new Intl.NumberFormat('it-IT', {
    maximumFractionDigits: exponent === 0 ? 0 : 1,
  }).format(amount);
  return `${formatted} ${units[exponent]}`;
}

export function estimateBytes(count: number, size: PhotoSize): number {
  const averagePhotoBytes = size === 'small' ? 35_000 : size === 'large' ? 350_000 : 110_000;
  return Math.round(count * averagePhotoBytes + 1_500_000);
}

export function formatObservationDate(observation: INatObservation): string {
  const datePart = observation.observed_on?.slice(0, 10);
  const match = datePart?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return datePart || 'Data non disponibile';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return datePart || 'Data non disponibile';

  const date = new Date(Date.UTC(year, month - 1, day));
  const dateText = new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);

  const time = observation.time_observed_at?.match(/T(\d{2}:\d{2})/)?.[1];
  return time ? `${dateText}, ${time}` : dateText;
}

export function formatLocation(observation: INatObservation): string {
  return observation.place_guess?.trim() || 'Località non specificata';
}

export function qualityClass(grade: string | null | undefined): string {
  switch ((grade ?? '').toLowerCase()) {
    case 'research':
      return 'research';
    case 'needs_id':
      return 'needs_id';
    case 'casual':
      return 'casual';
    default:
      return 'unknown';
  }
}

export function qualityLabel(grade: string | null | undefined): string {
  switch ((grade ?? '').toLowerCase()) {
    case 'research':
      return 'Research Grade';
    case 'needs_id':
      return 'Needs ID';
    case 'casual':
      return 'Casual';
    default:
      return 'Sconosciuto';
  }
}

export function identificationStatus(observation: INatObservation): string {
  const agreements = observation.num_identification_agreements ?? 0;
  const disagreements = observation.num_identification_disagreements ?? 0;
  const quality = (observation.quality_grade ?? '').toLowerCase();

  if (disagreements > 0) return 'Disaccordo nella community';
  if (quality === 'research' || agreements > 1) return 'Consenso raggiunto';
  if (agreements === 1) return 'Identificazione confermata';
  return 'In attesa di identificazione';
}

function categoryLabel(category: string | null | undefined): string {
  switch (category) {
    case 'improving':
      return 'migliorativa';
    case 'supporting':
      return 'a sostegno';
    case 'maverick':
      return 'in disaccordo';
    case 'leading':
      return 'proposta principale';
    default:
      return '';
  }
}

export function buildIdentifications(
  observation: INatObservation,
  options: Pick<Options, 'includeIdentifications'>
): string {
  if (!options.includeIdentifications) return '';

  const identifications = (observation.identifications ?? []).filter(
    (identification) => identification.current !== false
  );
  if (identifications.length === 0) return '';

  const shown = identifications.slice(0, 6);
  const items = shown.map((identification) => identificationItem(identification));
  const remaining = identifications.length - shown.length;
  if (remaining > 0) {
    items.push(
      `<li class="anw-more">… e altre ${remaining} identificazion${remaining === 1 ? 'e' : 'i'}</li>`
    );
  }

  return `<ul>${items.join('')}</ul>`;
}

function identificationItem(identification: INatIdentification): string {
  const user = identification.user?.login?.trim() || 'Utente iNaturalist';
  const taxon = identification.taxon?.name?.trim() || 'Taxon sconosciuto';
  const category = categoryLabel(identification.category);
  const body = identification.body?.trim();

  const categoryHtml = category
    ? ` <span class="anw-id-cat">(${escapeHtml(category)})</span>`
    : '';
  const bodyHtml = body
    ? `<div class="anw-id-comment">${escapeHtml(truncate(body, 240))}</div>`
    : '';

  return (
    `<li><span class="anw-id-user">${escapeHtml(user)}</span> ha proposto ` +
    `<i>${escapeHtml(taxon)}</i>${categoryHtml}${bodyHtml}</li>`
  );
}

/**
 * Restituisce la linea di discendenza del taxon nell'ordine radice → taxon.
 * `ancestor_ids` di iNaturalist include già il taxon stesso; `ancestry`
 * invece contiene solo gli antenati. Uniamo le due fonti per robustezza.
 */
export function taxonLineageIds(taxon: INatTaxon | null | undefined): number[] {
  if (!taxon) return [];
  const ids = new Set<number>();

  for (const id of taxon.ancestor_ids ?? []) {
    if (Number.isFinite(id)) ids.add(id);
  }

  if (taxon.ancestry) {
    for (const part of taxon.ancestry.split('/')) {
      const id = Number(part);
      if (Number.isFinite(id)) ids.add(id);
    }
  }

  if (Number.isFinite(taxon.id)) ids.add(taxon.id);
  return [...ids];
}

export function collectTaxonIds(observations: INatObservation[]): number[] {
  const ids = new Set<number>();
  for (const observation of observations) {
    for (const id of taxonLineageIds(observation.taxon)) ids.add(id);
    if (observation.community_taxon_id) ids.add(observation.community_taxon_id);
  }
  return [...ids];
}

export interface TaxonInfo {
  id: number;
  name: string;
  rank: string | null;
  rankLevel: number | null;
  preferredCommonName: string | null;
}

const MAJOR_RANKS = new Set([
  'kingdom',
  'phylum',
  'class',
  'order',
  'family',
  'genus',
  'species',
  'subspecies',
  'variety',
  'form',
]);

export function buildTaxonomy(
  observation: INatObservation,
  taxa: ReadonlyMap<number, TaxonInfo>
): string {
  const taxon = observation.taxon;
  if (!taxon?.name) return '';

  const names: string[] = [];
  for (const id of taxonLineageIds(taxon)) {
    const info = taxa.get(id);
    if (!info?.name) continue;
    if (info.rank === 'stateofmatter') continue;
    if (!MAJOR_RANKS.has(info.rank ?? '')) continue;
    if (names[names.length - 1] !== info.name) names.push(info.name);
  }

  if (names[names.length - 1] !== taxon.name) names.push(taxon.name);
  return names.slice(0, 9).join(' › ');
}

export function buildCommunityTaxon(
  observation: INatObservation,
  taxa: ReadonlyMap<number, TaxonInfo>
): string {
  const communityTaxonId = observation.community_taxon_id;
  if (!communityTaxonId) return '';

  const info = taxa.get(communityTaxonId);
  if (info?.name) return info.name;

  if (observation.taxon?.id === communityTaxonId) return observation.taxon.name;

  const identification = observation.identifications?.find(
    (item) => item.taxon?.id === communityTaxonId
  );
  return identification?.taxon?.name ?? '';
}

export function buildDescription(
  observation: INatObservation,
  options: Pick<Options, 'includeDescriptions'>
): string {
  if (!options.includeDescriptions) return '';
  const description = observation.description?.trim();
  return description ? escapeHtml(description) : '';
}

export function buildObservationUrl(observation: INatObservation): string {
  const raw = observation.uri?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (
        url.protocol === 'https:' &&
        (host === 'inaturalist.org' || host.endsWith('.inaturalist.org'))
      ) {
        return url.toString();
      }
    } catch {
      // URL non valido: usiamo il formato canonico qui sotto.
    }
  }
  return `https://www.inaturalist.org/observations/${observation.id}`;
}

export function licenseLabel(code: string | null | undefined): string {
  switch ((code ?? '').toLowerCase()) {
    case 'cc0':
      return 'CC0 1.0';
    case 'cc-by':
      return 'CC BY 4.0';
    case 'cc-by-sa':
      return 'CC BY-SA 4.0';
    case 'cc-by-nd':
      return 'CC BY-ND 4.0';
    case 'cc-by-nc':
      return 'CC BY-NC 4.0';
    case 'cc-by-nc-sa':
      return 'CC BY-NC-SA 4.0';
    case 'cc-by-nc-nd':
      return 'CC BY-NC-ND 4.0';
    default:
      return code ? code.toUpperCase() : '';
  }
}

export function buildPhotoCredit(photo: INatPhoto | null | undefined): string {
  if (!photo) return '';
  const attribution = photo.attribution?.trim();
  if (attribution) return attribution;
  const license = licenseLabel(photo.license_code);
  if (license) return `Foto: licenza ${license}`;
  return 'Foto da iNaturalist';
}

export function photoFilename(observationId: number, photo: INatPhoto): string {
  const match = /\.(jpe?g|png|gif|webp)(?:\?|$)/i.exec(photo.url);
  const extension = match?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? 'jpg';
  return `inat_${observationId}_${photo.id}.${extension}`;
}

const PHOTO_SIZE_PATTERN = /\/(square|small|medium|large|original)\.(jpe?g|png|gif|webp)(\?.*)?$/i;

export function photoVariantUrl(url: string, size: PhotoSize): string {
  if (!PHOTO_SIZE_PATTERN.test(url)) return url;
  return url.replace(PHOTO_SIZE_PATTERN, `/${size}.$2$3`);
}
