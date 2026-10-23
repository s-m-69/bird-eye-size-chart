import type { ChartData } from '../../models/sizeStudio.server';

type DraftMeasurements = { name: string; data: ChartData };
const measurePattern = /^\d+(?:\.\d{1,2})?(?:\s*[-–—]\s*\d+(?:\.\d{1,2})?)?$/;

/** Explains why Save is disabled. Server validation remains authoritative. */
export function getDraftIssue(draft: DraftMeasurements): string | null {
  if (!draft.name.trim()) return 'Enter a chart name to save.';
  const { columns, rows } = draft.data;
  if (columns.length < 2 || columns.length > 9 || columns.some(c => !c.trim()))
    return 'Give each measurement column a name.';
  if (new Set(columns.map(c => c.trim().toLowerCase())).size !== columns.length)
    return 'Measurement names must be unique.';
  if (!rows.length || rows.length > 40) return 'Add at least one size (maximum 40).';
  if (rows.some(r => r.length !== columns.length || !r[0]?.trim()))
    return 'Every row needs a size label.';
  const sizes = rows.map(r => r[0].trim().toLowerCase());
  if (new Set(sizes).size !== sizes.length) return 'Each size label must be unique.';
  for (const row of rows) for (const value of row.slice(1)) {
    const clean = value.trim();
    if (!clean) return 'Fill in all measurements before saving.';
    if (!measurePattern.test(clean)) return 'Enter inches as a number or range, such as 24–27.';
    const numbers = clean.split(/[-–—]/).map(Number);
    if (numbers.some(n => n <= 0) || (numbers.length === 2 && numbers[0] > numbers[1]))
      return 'Measurements must be positive and ranges in ascending order.';
  }
  return null;
}
