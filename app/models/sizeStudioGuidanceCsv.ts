/** BirdEye Size Studio: chart-specific measurement-image and recommendation-eligibility CSV. */
import { canonicalChartName, readCsv, CsvImportError } from './sizeStudioCsv';

export type RecommendationEligibility = 'body' | 'garment' | 'unverified';
export type GuidanceUpdate = {
  name: string;
  /** undefined leaves existing URL unchanged; null clears it. */
  imageUrl?: string | null;
  /** undefined leaves existing approval unchanged. */
  eligibility?: RecommendationEligibility;
};
export type GuidanceResult = { name: string; status: 'updated'|'unchanged'|'error'; message: string };
export const GUIDANCE_BATCH_SIZE = 3;
const HEADERS = ['chart name','measurement image url','size recommendation eligibility'] as const;
const normalize = (s: string) => s.trim().toLocaleLowerCase('en-US').replace(/\s+/g,' ');

export function validateMeasurementImageUrl(value: string): string {
  if (value.length > 2048) throw new CsvImportError('Measurement Image URL must be 2048 characters or fewer.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new CsvImportError('Measurement Image URL must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password)
    throw new CsvImportError('Measurement Image URL must use HTTPS and cannot contain a username or password.');
  return url.toString();
}

export function parseEligibility(value: string): RecommendationEligibility {
  const s = normalize(value).replace(/[–—]/g,'-');
  if (['body','approved body-measurement ranges','approved body measurement ranges','approved body ranges'].includes(s)) return 'body';
  if (['garment','garment measurements','garment measurements only','garment measurement chart only'].includes(s)) return 'garment';
  if (['unverified','not verified','not yet verified'].includes(s)) return 'unverified';
  throw new CsvImportError('Size Recommendation Eligibility must be Unverified, Garment measurements only, or Approved body-measurement ranges.');
}

/** Empty fields mean NO CHANGE, not deletion. `clear` explicitly removes an image URL. */
export function planGuidanceCsv(text: string): GuidanceUpdate[] {
  if (text.length > 256 * 1024) throw new CsvImportError('Maximum CSV size is 256 KB.');
  const grid = readCsv(text);
  if (grid.length < 2) throw new CsvImportError('Include the header row and at least one chart.');
  const heads = grid[0].map((h) => normalize(h.replace(/^\uFEFF/,'')));
  const at: number[] = HEADERS.map((name) => {
    const matches = heads.flatMap((value,i) => value === name ? [i] : []);
    if (matches.length !== 1) throw new CsvImportError(`CSV needs exactly one ${name} column.`);
    return matches[0];
  });
  const found = new Map<string, GuidanceUpdate>();
  grid.slice(1).forEach((cells,index) => {
    const line = index + 2;
    if (cells.length !== heads.length) throw new CsvImportError(`Row ${line}: the number of CSV cells does not match the header.`);
    const name = cells[at[0]].trim().replace(/\s+/g,' ');
    if (!name || name.length > 120 || /[\r\n]/.test(name) || /^[=+@\-]/.test(name))
      throw new CsvImportError(`Row ${line}: invalid Chart Name.`);
    const image = cells[at[1]].trim();
    const approval = cells[at[2]].trim();
    if (!image && !approval) return;
    const row: GuidanceUpdate = { name };
    try {
      if (image) row.imageUrl = normalize(image) === 'clear' ? null : validateMeasurementImageUrl(image);
      if (approval) row.eligibility = parseEligibility(approval);
    } catch (error) {
      throw new CsvImportError(`Row ${line} (${name}): ${error instanceof Error ? error.message : 'invalid value'}`);
    }
    const key = canonicalChartName(name);
    const previous = found.get(key);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(row)) throw new CsvImportError(`Conflicting updates for ${name} in repeated CSV rows.`);
    } else found.set(key,row);
    if (found.size > 250) throw new CsvImportError('A CSV can update at most 250 charts.');
  });
  if (!found.size) throw new CsvImportError('No changes found. Enter an image URL or recommendation-eligibility value.');
  return [...found.values()];
}

export function verifyGuidanceBatch(payload: unknown): GuidanceUpdate[] {
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > GUIDANCE_BATCH_SIZE)
    throw new CsvImportError(`Submit 1–${GUIDANCE_BATCH_SIZE} updates per batch.`);
  const seen = new Set<string>();
  return payload.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CsvImportError('Invalid CSV update row.');
    const raw = value as Record<string,unknown>;
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 120 || /^[=+@\-]/.test(raw.name))
      throw new CsvImportError('Invalid Chart Name.');
    const name = raw.name.trim();
    const key = canonicalChartName(name);
    if (seen.has(key)) throw new CsvImportError(`Duplicate ${name} in the submitted batch.`);
    seen.add(key);
    const hasImage = Object.prototype.hasOwnProperty.call(raw,'imageUrl');
    const hasApproval = Object.prototype.hasOwnProperty.call(raw,'eligibility');
    if (!hasImage && !hasApproval) throw new CsvImportError(`No updates supplied for ${name}.`);
    const update: GuidanceUpdate = { name };
    if (hasImage) {
      if (raw.imageUrl !== null && (typeof raw.imageUrl !== 'string' || !raw.imageUrl.trim())) throw new CsvImportError(`Invalid image URL for ${name}.`);
      update.imageUrl = raw.imageUrl === null ? null : validateMeasurementImageUrl(raw.imageUrl as string);
    }
    if (hasApproval) {
      if (!['body','garment','unverified'].includes(String(raw.eligibility))) throw new CsvImportError(`Invalid eligibility for ${name}.`);
      update.eligibility = raw.eligibility as RecommendationEligibility;
    }
    return update;
  });
}

export function guidanceCsvTemplate(charts: Array<{ name: string; data: { measurementImageUrl?: string; recommendationBasis?: RecommendationEligibility } }>): string {
  const q = (value: string) => '"' + value.replace(/"/g,'""').replace(/^[=+@\-]/, (x) => "'" + x) + '"';
  return 'Chart Name,Measurement Image URL,Size Recommendation Eligibility\r\n' +
    charts.map((chart) => [q(chart.name),q(chart.data.measurementImageUrl || ''),q(chart.data.recommendationBasis || 'unverified')].join(',')).join('\r\n') + '\r\n';
}
