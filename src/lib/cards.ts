import type { INatObservation, INatPhoto, Options } from './types';
import { FIELD_NAMES, type FieldName } from './types';
import {
  buildCommunityTaxon,
  buildDescription,
  buildIdentifications,
  buildObservationUrl,
  buildPhotoCredit,
  buildTaxonomy,
  escapeHtml,
  formatLocation,
  formatObservationDate,
  identificationStatus,
  qualityClass,
  qualityLabel,
  sanitizeField,
} from './format';
import type { TaxonInfo } from './format';

export const PLACEHOLDER_FILENAME = 'ankinaturalist_placeholder.png';

export const QUESTION_FORMAT = `
<div class="anw-card">
  <div class="anw-photo">{{Photo}}</div>
  {{#PhotoCredit}}<div class="anw-credit">{{PhotoCredit}}</div>{{/PhotoCredit}}
  <div class="anw-meta">
    <span>📍 {{Location}}</span>
    <span>📅 {{ObservationDate}}</span>
  </div>
  <div class="anw-question">Quale specie è stata osservata?</div>
</div>
`.trim();

export const ANSWER_FORMAT = `
{{FrontSide}}
<hr id="answer" class="anw-hr">
<div class="anw-answer">
  <div class="anw-sci">{{ScientificName}}</div>
  {{#CommonName}}<div class="anw-common">{{CommonName}}</div>{{/CommonName}}
  {{#Taxonomy}}<div class="anw-taxonomy">{{Taxonomy}}</div>{{/Taxonomy}}

  <div class="anw-badges">
    <span class="anw-badge anw-quality-{{QualityClass}}">{{QualityGrade}}</span>
    <span class="anw-badge anw-status">{{IdentificationStatus}}</span>
    <span class="anw-counts">👍 {{Agreements}} · 👎 {{Disagreements}}</span>
  </div>

  {{#CommunityTaxon}}<div class="anw-community">Consenso community: <i>{{CommunityTaxon}}</i></div>{{/CommunityTaxon}}
  {{#Identifications}}<div class="anw-ids">{{Identifications}}</div>{{/Identifications}}
  {{#Description}}<div class="anw-desc"><strong>Descrizione originale</strong>{{Description}}</div>{{/Description}}
  {{#PersonalNotes}}<div class="anw-notes"><strong>Le tue note</strong>{{PersonalNotes}}</div>{{/PersonalNotes}}

  <div class="anw-footer"><a href="{{ObservationURL}}">Apri su iNaturalist · #{{ObservationID}}</a></div>
</div>
`.trim();

export const CARD_CSS = `
.card {
  --anw-bg: #f6f4ec;
  --anw-ink: #1f2a24;
  --anw-soft: #5f6d64;
  --anw-muted: #7b877e;
  --anw-line: #d9dfd4;
  --anw-green: #2d6248;
  --anw-green-dark: #1b4a35;
  --anw-photo-shadow: rgba(31, 42, 36, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  text-align: center;
  color: var(--anw-ink);
  background: var(--anw-bg);
  padding: 14px;
  margin: 0;
}

.card, .card * { box-sizing: border-box; }

.anw-card, .anw-answer {
  max-width: 560px;
  margin: 0 auto;
}

.anw-photo img {
  display: block;
  max-width: 100%;
  max-height: 55vh;
  width: auto;
  height: auto;
  margin: 0 auto;
  border-radius: 16px;
  box-shadow: 0 12px 30px var(--anw-photo-shadow);
}

.anw-credit {
  margin-top: 6px;
  font-size: 0.68em;
  line-height: 1.35;
  color: var(--anw-muted);
}

.anw-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 16px;
  margin: 14px 0 6px;
  font-size: 0.82em;
  color: var(--anw-soft);
}

.anw-question {
  margin-top: 8px;
  font-size: 1.08em;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--anw-green);
}

.anw-hr {
  max-width: 560px;
  margin: 18px auto;
  border: 0;
  border-top: 1px solid var(--anw-line);
}

.anw-sci {
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  font-style: italic;
  font-size: 1.55em;
  font-weight: 700;
  line-height: 1.15;
  color: var(--anw-green-dark);
}

.anw-common {
  margin-top: 2px;
  font-size: 1.15em;
  color: var(--anw-ink);
}

.anw-taxonomy {
  margin: 8px 0 12px;
  font-size: 0.76em;
  line-height: 1.4;
  color: var(--anw-muted);
}

.anw-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin: 10px 0;
}

.anw-badge {
  display: inline-block;
  padding: 4px 9px;
  border-radius: 999px;
  font-size: 0.72em;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.anw-quality-research {
  background: #e1f0df;
  border: 1px solid #b9d8b2;
  color: #25613f;
}

.anw-quality-needs_id {
  background: #fff0d6;
  border: 1px solid #f0d19a;
  color: #8a5a12;
}

.anw-quality-casual,
.anw-quality-unknown {
  background: #ececec;
  border: 1px solid #d6d6d6;
  color: #5b5b5b;
}

.anw-status {
  background: #e5eef6;
  border: 1px solid #c3d7e7;
  color: #285a7a;
}

.anw-counts {
  font-size: 0.78em;
  color: var(--anw-soft);
}

.anw-community {
  margin: 8px 0;
  font-size: 0.9em;
  color: var(--anw-ink);
}

.anw-ids {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: #eef4ef;
  color: #3f4d45;
  font-size: 0.78em;
  text-align: left;
}

.anw-ids ul {
  margin: 0;
  padding-left: 1.1em;
}

.anw-ids li {
  margin: 3px 0;
}

.anw-id-cat {
  color: var(--anw-muted);
}

.anw-id-comment {
  margin-top: 2px;
  color: var(--anw-soft);
  white-space: pre-wrap;
}

.anw-more {
  color: var(--anw-muted);
}

.anw-desc, .anw-notes {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 0 12px 12px 0;
  font-size: 0.86em;
  text-align: left;
  white-space: pre-wrap;
}

.anw-desc {
  background: #f1f4ec;
  border-left: 3px solid #9dbf8f;
}

.anw-notes {
  background: #fff8d9;
  border-left: 3px solid #e5c04a;
}

.anw-desc strong, .anw-notes strong {
  display: block;
  margin-bottom: 4px;
  font-size: 0.78em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--anw-muted);
}

.anw-footer {
  margin-top: 16px;
  font-size: 0.72em;
}

.anw-footer a {
  color: var(--anw-green);
  text-decoration: none;
}

.night_mode .card,
.nightMode .card,
.card.night_mode {
  --anw-bg: #121815;
  --anw-ink: #e7eee9;
  --anw-soft: #aab8af;
  --anw-muted: #8d9a91;
  --anw-line: #2a3730;
  --anw-green: #8fc9a6;
  --anw-green-dark: #b9e3c8;
  --anw-photo-shadow: rgba(0, 0, 0, 0.55);
}

.night_mode .anw-ids,
.nightMode .anw-ids,
.card.night_mode .anw-ids {
  background: #1a2620;
  color: #d6e2d9;
}

.night_mode .anw-desc,
.nightMode .anw-desc,
.card.night_mode .anw-desc {
  background: #18211c;
}

.night_mode .anw-notes,
.nightMode .anw-notes,
.card.night_mode .anw-notes {
  background: #2a2617;
}

.night_mode .anw-quality-research,
.nightMode .anw-quality-research,
.card.night_mode .anw-quality-research {
  background: #1e3a2a;
  border-color: #356a4a;
  color: #b9e3c8;
}

.night_mode .anw-quality-needs_id,
.nightMode .anw-quality-needs_id,
.card.night_mode .anw-quality-needs_id {
  background: #3a2d16;
  border-color: #6a5225;
  color: #f0cf8e;
}

.night_mode .anw-quality-casual,
.night_mode .anw-quality-unknown,
.nightMode .anw-quality-casual,
.nightMode .anw-quality-unknown,
.card.night_mode .anw-quality-casual,
.card.night_mode .anw-quality-unknown {
  background: #242424;
  border-color: #3c3c3c;
  color: #bdbdbd;
}

.night_mode .anw-status,
.nightMode .anw-status,
.card.night_mode .anw-status {
  background: #1c2d3a;
  border-color: #34516a;
  color: #a8cbe6;
}

@media (prefers-color-scheme: dark) {
  .card {
    --anw-bg: #121815;
    --anw-ink: #e7eee9;
    --anw-soft: #aab8af;
    --anw-muted: #8d9a91;
    --anw-line: #2a3730;
    --anw-green: #8fc9a6;
    --anw-green-dark: #b9e3c8;
    --anw-photo-shadow: rgba(0, 0, 0, 0.55);
  }

  .anw-ids { background: #1a2620; color: #d6e2d9; }
  .anw-desc { background: #18211c; }
  .anw-notes { background: #2a2617; }
  .anw-quality-research { background: #1e3a2a; border-color: #356a4a; color: #b9e3c8; }
  .anw-quality-needs_id { background: #3a2d16; border-color: #6a5225; color: #f0cf8e; }
  .anw-quality-casual, .anw-quality-unknown { background: #242424; border-color: #3c3c3c; color: #bdbdbd; }
  .anw-status { background: #1c2d3a; border-color: #34516a; color: #a8cbe6; }
}
`.trim();

export function buildNoteFields(
  observation: INatObservation,
  photo: INatPhoto | null,
  photoFile: string,
  taxa: ReadonlyMap<number, TaxonInfo>,
  options: Pick<Options, 'includeDescriptions' | 'includeIdentifications'>
): Record<FieldName, string> {
  const scientificName = observation.taxon?.name?.trim() || 'Sconosciuto';
  const commonName = observation.taxon?.preferred_common_name?.trim() || '';
  const photoHtml = photo
    ? `<img src="${escapeHtml(photoFile)}" alt="${escapeHtml(scientificName)}">`
    : `<img src="${PLACEHOLDER_FILENAME}" alt="Nessuna foto disponibile">`;

  const values: Record<FieldName, string> = {
    ObservationID: String(observation.id),
    ScientificName: escapeHtml(scientificName),
    CommonName: escapeHtml(commonName),
    Taxonomy: escapeHtml(buildTaxonomy(observation, taxa)),
    Photo: photoHtml,
    ObservationDate: escapeHtml(formatObservationDate(observation)),
    Location: escapeHtml(formatLocation(observation)),
    Description: buildDescription(observation, options),
    CommunityTaxon: escapeHtml(buildCommunityTaxon(observation, taxa)),
    IdentificationStatus: escapeHtml(identificationStatus(observation)),
    QualityGrade: escapeHtml(qualityLabel(observation.quality_grade)),
    Identifications: buildIdentifications(observation, options),
    Agreements: String(observation.num_identification_agreements ?? 0),
    Disagreements: String(observation.num_identification_disagreements ?? 0),
    ObservationURL: escapeHtml(buildObservationUrl(observation)),
    PersonalNotes: '',
    PhotoCredit: escapeHtml(buildPhotoCredit(photo)),
    QualityClass: qualityClass(observation.quality_grade),
  };

  for (const field of FIELD_NAMES) {
    values[field] = sanitizeField(values[field]);
  }

  return values;
}
