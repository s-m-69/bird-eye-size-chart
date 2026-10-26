/** BirdEye fit ratings: CSV affects only existing chart_data.fitScale values. */
import { canonicalChartName, readCsv, CsvImportError } from './sizeStudioCsv';

export type FitUpdate = { name: string; rating: number | null };
export type FitResult = { name: string; status: 'updated' | 'unchanged' | 'error'; message: string };
export const FIT_BATCH_SIZE = 3;

/**
 * Accepts the two-column template or a legacy measurement export with an added
 * `Fit Rating` column. Existing charts/measurements are never replaced.
 * Empty ratings do not change anything; the explicit word `clear` removes one.
 */
export function planFitCsv(text: string): FitUpdate[] {
  const grid = readCsv(text);
  if (grid.length < 2) throw new CsvImportError('Add chart names and fit ratings before uploading.');
  const normalized = grid[0].map((s) => s.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' '));
  const nameIndex = normalized.indexOf('chart name');
  const fitIndex = normalized.indexOf('fit rating');
  if (nameIndex < 0 || fitIndex < 0 || normalized.filter((s) => s === 'chart name').length !== 1 || normalized.filter((s) => s === 'fit rating').length !== 1) {
    throw new CsvImportError('The CSV must have exactly one Chart Name column and one Fit Rating column.');
  }
  const found = new Map<string, FitUpdate>();
  grid.slice(1).forEach((cells, rowIndex) => {
    if (cells.length !== grid[0].length) throw new CsvImportError(`Row ${rowIndex + 2}: missing or extra CSV cells.`);
    const name = cells[nameIndex].trim().replace(/\s+/g, ' ');
    const raw = cells[fitIndex].trim();
    if (!name || name.length > 120 || /[\r\n]/.test(name) || /^[=@]/.test(name)) throw new CsvImportError(`Row ${rowIndex + 2}: invalid Chart Name.`);
    if (!raw) return; // Empty is deliberately NOT a deletion.
    const rating: number | null = /^clear$/i.test(raw) ? null : /^[1-5]$/.test(raw) ? Number(raw) : NaN;
    if (Number.isNaN(rating)) throw new CsvImportError(`Row ${rowIndex + 2} (${name}): Fit Rating must be 1, 2, 3, 4, 5, blank, or clear.`);
    const key = canonicalChartName(name);
    const previous = found.get(key);
    if (previous && previous.rating !== rating) throw new CsvImportError(`${name} has conflicting fit ratings in different rows.`);
    if (!previous) found.set(key, { name, rating });
    if (found.size > 250) throw new CsvImportError('Maximum 250 charts per fit rating upload.');
  });
  if (!found.size) throw new CsvImportError('No fit ratings found. Enter 1–5 beside each chart you want to update.');
  return [...found.values()];
}

/** Don't trust client-side parsing on the server. */
export function verifyFitBatch(payload: unknown): FitUpdate[] {
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > FIT_BATCH_SIZE) {
    throw new CsvImportError(`Submit between 1 and ${FIT_BATCH_SIZE} fit updates at a time.`);
  }
  const keys = new Set<string>();
  return payload.map((row) => {
    if (!row || typeof row !== 'object') throw new CsvImportError('Invalid fit rating payload.');
    const { name, rating } = row as Partial<FitUpdate>;
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[\r\n]/.test(name)) throw new CsvImportError('Invalid chart name.');
    if (rating !== null && !(typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new CsvImportError(`Invalid fit rating for ${name}.`);
    const key = canonicalChartName(name);
    if (keys.has(key)) throw new CsvImportError('Duplicate chart in fit batch.');
    keys.add(key);
    return { name: name.trim(), rating };
  });
}

/** Excel-ready prefilled export of every existing chart; no product IDs. */
export function fitCsvTemplate(charts: Array<{name:string;data:{fitScale?:number}}>): string {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return 'Chart Name,Fit Rating\r\n' + charts.map((c) => `${quote(c.name)},${c.data.fitScale ?? ''}`).join('\r\n') + '\r\n';
}
