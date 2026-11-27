/**
 * Tipi condivisi tra client iNaturalist, generatore di flashcard e UI.
 * Le API pubbliche di iNaturalist restituiscono molti più campi di quelli
 * usati qui: teniamo solo ciò che serve a costruire il mazzo.
 */

export interface INatUser {
  id: number;
  login: string;
  name?: string | null;
  icon_url?: string | null;
  observations_count?: number | null;
  species_count?: number | null;
  identifications_count?: number | null;
  created_at?: string | null;
  suspended?: boolean;
}

export interface INatPhoto {
  id: number;
  url: string;
  attribution?: string | null;
  license_code?: string | null;
  hidden?: boolean;
  original_dimensions?: {
    width?: number;
    height?: number;
  } | null;
}

export interface INatTaxon {
  id: number;
  name: string;
  rank?: string | null;
  rank_level?: number | null;
  preferred_common_name?: string | null;
  english_common_name?: string | null;
  ancestor_ids?: number[] | null;
  ancestry?: string | null;
  iconic_taxon_name?: string | null;
  default_photo?: INatPhoto | null;
}

export interface INatIdentification {
  id: number;
  category?: string | null;
  current?: boolean;
  body?: string | null;
  created_at?: string | null;
  user?: {
    id: number;
    login: string;
    name?: string | null;
  } | null;
  taxon?: INatTaxon | null;
}

export interface INatObservation {
  id: number;
  uuid?: string;
  observed_on?: string | null;
  time_observed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  uri?: string | null;
  description?: string | null;
  place_guess?: string | null;
  quality_grade?: string | null;
  community_taxon_id?: number | null;
  taxon?: INatTaxon | null;
  identifications?: INatIdentification[] | null;
  photos?: INatPhoto[] | null;
  num_identification_agreements?: number | null;
  num_identification_disagreements?: number | null;
  location?: string | null;
  obscured?: boolean;
  captive?: boolean;
  user?: {
    id: number;
    login: string;
    name?: string | null;
  } | null;
}

export interface INatObservationResponse {
  total_results: number;
  page: number;
  per_page: number;
  results: INatObservation[];
}

export interface INatUserResponse {
  total_results: number;
  page?: number;
  per_page?: number;
  results: INatUser[];
}

export interface INatTaxaResponse {
  total_results: number;
  page?: number;
  per_page?: number;
  results: INatTaxon[];
}

export type QualityFilter = 'all' | 'research' | 'needs_id' | 'casual' | 'verifiable';
export type PhotoSize = 'small' | 'medium' | 'large';

export interface Options {
  quality: QualityFilter;
  limit: number;
  photoSize: PhotoSize;
  locale: string;
  includeWithoutPhoto: boolean;
  includeDescriptions: boolean;
  includeIdentifications: boolean;
  deckName: string;
  fromDate: string;
  toDate: string;
}

/**
 * Campi del note type. I primi sedici riprendono il modello dell'app Android
 * AnkiNaturalist; PhotoCredit e QualityClass aggiungono l'attribuzione della
 * foto e una classe CSS per colorare il badge della qualità.
 */
export const FIELD_NAMES = [
  'ObservationID',
  'ScientificName',
  'CommonName',
  'Taxonomy',
  'Photo',
  'ObservationDate',
  'Location',
  'Description',
  'CommunityTaxon',
  'IdentificationStatus',
  'QualityGrade',
  'Identifications',
  'Agreements',
  'Disagreements',
  'ObservationURL',
  'PersonalNotes',
  'PhotoCredit',
  'QualityClass',
] as const;

export type FieldName = (typeof FIELD_NAMES)[number];

export const MODEL_NAME = 'AnkiNaturalist Observation';
export const CARD_NAME = 'Osservazione';
export const TAG_ROOT = 'ankinaturalist';

export const QUALITY_OPTIONS: ReadonlyArray<{ value: QualityFilter; label: string }> = [
  { value: 'all', label: 'Tutte le osservazioni' },
  { value: 'verifiable', label: 'Research Grade + Needs ID' },
  { value: 'research', label: 'Solo Research Grade' },
  { value: 'needs_id', label: 'Solo Needs ID' },
  { value: 'casual', label: 'Solo Casual' },
];

export const PHOTO_SIZE_OPTIONS: ReadonlyArray<{ value: PhotoSize; label: string; hint: string }> = [
  { value: 'small', label: 'Compatta', hint: 'Più leggera, ideale per molti mazzi' },
  { value: 'medium', label: 'Consigliata', hint: 'Buon compromesso qualità/spazio' },
  { value: 'large', label: 'Alta', hint: 'Dettagli maggiori, file più pesante' },
];

export const LOCALE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
];

export const DEFAULT_LIMIT = 300;
export const MAX_LIMIT = 2000;
export const MIN_LIMIT = 1;
