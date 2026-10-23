/**
 * Size Studio CSV format and validation.
 * Shared, dependency-free code: safe to import into the browser and a server action.
 * Values are inches ONLY. No uploads or temporary data are stored by this module.
 */
export type CsvChart = {
  name: string;
  productType: string;
  tag: string;
  data: { unit: 'in'; columns: string[]; rows: string[][] };
};
export type CsvPlan = { charts: CsvChart[]; rowsRead: number; warnings: string[] };
export type ImportResult = { name: string; status: 'created' | 'skipped' | 'error'; message: string };
export class CsvImportError extends Error {}
export const CSV_MAX_BYTES = 256 * 1024;
export const CSV_MAX_CHARTS = 25;
export const CSV_BATCH_SIZE = 3;
export const CSV_MAX_ROWS = 1000;
export const CSV_TEMPLATE_HEADERS = ['Chart Name', 'Size', 'Waist (in)', 'Hip (in)', 'Bust (in)', 'Underbust (in)', 'Length (in)'];
export const csvTemplate = () => CSV_TEMPLATE_HEADERS.join(',') + '\r\n';
export const canonicalChartName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

/** RFC4180 parser (quotes, escaped quotes, LF and CRLF); rejects malformed input. */
export function readCsv(text: string): string[][] {
  if (new TextEncoder().encode(text).length > CSV_MAX_BYTES) throw new CsvImportError('File is too large. Maximum 256 KB per upload.');
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQuote = false, afterQuote = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuote) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuote = false; afterQuote = true; }
      else cell += ch;
      continue;
    }
    if (afterQuote) {
      if (ch === ',') { row.push(cell); cell = ''; afterQuote = false; continue; }
      if (ch === '\n' || ch === '\r') {
        row.push(cell); cell = ''; afterQuote = false;
        if (row.some(v => v.trim())) rows.push(row);
        row = [];
        if (ch === '\r' && source[i + 1] === '\n') i++;
        continue;
      }
      if (ch === ' ' || ch === '\t') continue;
      throw new CsvImportError(`Unexpected character after a quoted value near row ${rows.length + 1}.`);
    }
    if (ch === '"') {
      if (cell.trim()) throw new CsvImportError(`Quotation mark inside an unquoted value near row ${rows.length + 1}.`);
      cell = ''; inQuote = true;
    }
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      row.push(cell); cell = '';
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
      if (ch === '\r' && source[i + 1] === '\n') i++;
    } else cell += ch;
    if (rows.length > CSV_MAX_ROWS + 1) throw new CsvImportError(`Maximum ${CSV_MAX_ROWS} size rows per file.`);
  }
  if (inQuote) throw new CsvImportError('An opened quotation mark was not closed. Export as CSV UTF-8 and try again.');
  row.push(cell);
  if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

function parseInches(raw: string, chart: string, size: string, measurement: string): string {
  const value = raw.trim().replace(/[\u2013\u2014\u2212]/g, '-');
  const match = /^(\d+(?:\.\d{1,2})?)(?:\s*-\s*(\d+(?:\.\d{1,2})?))?$/.exec(value);
  if (!match) throw new CsvImportError(`${chart}, size ${size}: ${measurement} must be a number or range in inches (for example 24-27).`);
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (from <= 0 || to > 200 || to < from) throw new CsvImportError(`${chart}, size ${size}: ${measurement} must be positive, increasing, and at most 200 inches.`);
  return match[2] === undefined ? match[1] : `${match[1]}-${match[2]}`;
}

/** Turns a flat human-friendly CSV into existing Shopify size_studio_chart JSON objects. */
export function planCsv(text: string): CsvPlan {
  const grid = readCsv(text);
  if (!grid.length) throw new CsvImportError('The file is empty. Download a fresh template and enter your charts.');
  const [headers, ...data] = grid;
  if (headers.length < 3 || headers.length > 24) throw new CsvImportError('Template must have Chart Name, Size, and measurement columns. Maximum 22 measurement columns.');
  const normalized = headers.map(h => h.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' '));
  if (normalized[0] !== 'chart name' || normalized[1] !== 'size') throw new CsvImportError('First two columns must be Chart Name and Size, in that order.');
  const names = headers.slice(2).map(h => {
    const m = /^(.+?)\s*\(in\)$/i.exec(h.trim());
    if (!m || !m[1].trim()) throw new CsvImportError(`Column “${h}” must be named like “Waist (in)”. Only inches are accepted.`);
    return m[1].trim();
  });
  if (new Set(names.map(n => n.toLocaleLowerCase('en-US'))).size !== names.length) throw new CsvImportError('Two measurement columns use the same name. Rename or remove the duplicate.');
  if (names.some(n => n.length > 70)) throw new CsvImportError('Measurement headings cannot exceed 70 characters.');
  if (data.length > CSV_MAX_ROWS) throw new CsvImportError(`Maximum ${CSV_MAX_ROWS} size rows per file.`);
  const grouped = new Map<string, { display: string; rows: { size: string; measures: string[] }[]; used: Set<number>; seen: Set<string> }>();
  let rowsRead = 0;
  data.forEach((values, index) => {
    const line = index + 2;
    if (values.length !== headers.length) throw new CsvImportError(`Line ${line}: expected ${headers.length} cells but found ${values.length}. Check commas and quotation marks.`);
    const name = values[0].trim().replace(/\s+/g, ' ');
    const size = values[1].trim().replace(/\s+/g, ' ');
    if (!name || !size) throw new CsvImportError(`Line ${line}: Chart Name and Size are required.`);
    if (name.length > 120 || size.length > 70 || /[\r\n]/.test(name + size)) throw new CsvImportError(`Line ${line}: Chart Name or Size is too long or contains a line break.`);
    if (/^[=@]/.test(name) || /^[=@]/.test(size)) throw new CsvImportError(`Line ${line}: names cannot start with = or @.`);
    const key = canonicalChartName(name);
    let group = grouped.get(key);
    if (!group) {
      group = { display: name, rows: [], used: new Set(), seen: new Set() };
      grouped.set(key, group);
      if (grouped.size > CSV_MAX_CHARTS) throw new CsvImportError(`Maximum ${CSV_MAX_CHARTS} charts per file. Split the file into smaller uploads.`);
    }
    const sizeKey = size.normalize('NFKC').toLocaleLowerCase('en-US');
    if (group.seen.has(sizeKey)) throw new CsvImportError(`${name}: the size “${size}” appears twice.`);
    group.seen.add(sizeKey);
    if (group.rows.length >= 40) throw new CsvImportError(`${name}: maximum 40 sizes per chart.`);
    const measures = values.slice(2).map((value, i) => {
      const cell = value.trim();
      if (!cell) return '';
      group!.used.add(i);
      return parseInches(cell, name, size, names[i]);
    });
    group.rows.push({ size, measures });
    rowsRead++;
  });
  if (!grouped.size) throw new CsvImportError('No charts found. Fill in the template before uploading.');
  const charts: CsvChart[] = [];
  for (const group of grouped.values()) {
    const indices = [...group.used].sort((a,b) => a-b);
    if (!indices.length) throw new CsvImportError(`${group.display}: no measurements were entered.`);
    if (indices.length > 8) throw new CsvImportError(`${group.display}: maximum 8 measurement columns per chart.`);
    for (const row of group.rows) {
      for (const i of indices) {
        if (!row.measures[i]) throw new CsvImportError(`${group.display}, size ${row.size}: ${names[i]} is missing. Fill every used measurement for each size.`);
      }
    }
    charts.push({
      name: group.display, productType: '', tag: '',
      data: { unit: 'in', columns: ['Size', ...indices.map(i => names[i])], rows: group.rows.map(r => [r.size, ...indices.map(i => r.measures[i])]) },
    });
  }
  return { charts, rowsRead, warnings: [] };
}

/** Server-side validation: never trust pre-parsed payload sent by a browser. */
export function verifyCsvChart(input: unknown): CsvChart {
  if (!input || typeof input !== 'object') throw new CsvImportError('Invalid chart payload. Re-upload the file.');
  const obj = input as Partial<CsvChart>;
  if (typeof obj.name !== 'string' || !obj.name.trim() || obj.name.length > 120) throw new CsvImportError('A chart has an invalid name.');
  if (obj.productType !== '' || obj.tag !== '') throw new CsvImportError('CSV cannot set matching rules or product assignments.');
  if (!obj.data || obj.data.unit !== 'in' || !Array.isArray(obj.data.columns) || !Array.isArray(obj.data.rows)) throw new CsvImportError('Invalid measurement table.');
  const { columns, rows } = obj.data;
  if (columns.length < 2 || columns.length > 9 || columns[0] !== 'Size' || columns.some(v => typeof v !== 'string' || !v.trim() || v.length > 70)) throw new CsvImportError('Invalid measurement columns.');
  if (rows.length < 1 || rows.length > 40) throw new CsvImportError('Invalid number of sizes.');
  const seen = new Set<string>();
  const cleanRows = rows.map((row) => {
    if (!Array.isArray(row) || row.length !== columns.length || row.some(x => typeof x !== 'string')) throw new CsvImportError('Each size requires every measurement.');
    const size = row[0].trim();
    if (!size || size.length > 70 || seen.has(size.toLowerCase())) throw new CsvImportError('A size is empty or duplicated.');
    seen.add(size.toLowerCase());
    return [size, ...row.slice(1).map((cell, i) => parseInches(cell, obj.name!, size, columns[i+1]))];
  });
  return { name: obj.name.trim(), productType: '', tag: '', data: { unit: 'in', columns: [...columns], rows: cleanRows } };
}
