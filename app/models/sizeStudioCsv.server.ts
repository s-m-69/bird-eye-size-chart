/** Shopify-only CSV create path. No files, jobs, new DB tables or product assignments. */
import { createHash } from 'node:crypto';
import { getCharts, validateChart } from './sizeStudio.server';
import { canonicalChartName, CsvImportError, CSV_BATCH_SIZE, verifyCsvChart } from './sizeStudioCsv';
import type { CsvChart, ImportResult } from './sizeStudioCsv';

type Admin = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
const CHART_TYPE = 'size_studio_chart';
export const importHandleFor = (name: string) => 'bss-csv-' + createHash('sha256').update(canonicalChartName(name)).digest('hex').slice(0, 20);

async function graphql(admin: Admin, query: string, variables: Record<string, unknown>) {
  const res = await admin.graphql(query, { variables });
  if (!res.ok) throw new Error(`Shopify API returned HTTP ${res.status}.`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e: { message: string }) => e.message).join('; '));
  if (!json.data) throw new Error('Shopify returned an empty response.');
  return json.data;
}
async function existingByHandle(admin: Admin, handle: string): Promise<string | null> {
  const data = await graphql(admin, `#graphql
    query SizeStudioCsvCheck($handle: MetaobjectHandleInput!) {
      metaobjectByHandle(handle: $handle) {
        field(key: "name") { value }
      }
    }`, { handle: { type: CHART_TYPE, handle } });
  return data.metaobjectByHandle?.field?.value ?? null;
}
async function createChart(admin: Admin, chart: CsvChart, handle: string) {
  const data = await graphql(admin, `#graphql
    mutation SizeStudioCsvCreate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { message field }
      }
    }`, { metaobject: {
    type: CHART_TYPE, handle,
    fields: [
      { key: 'name', value: chart.name },
      { key: 'chart_data', value: JSON.stringify(chart.data) },
      { key: 'match_product_type', value: '' },
      { key: 'match_tag', value: '' },
    ],
  }});
  const payload = data.metaobjectCreate;
  if (!payload?.metaobject || payload.userErrors?.length) {
    throw new Error(payload?.userErrors?.map((e: { message: string }) => e.message).join('; ') || 'Shopify did not confirm chart creation.');
  }
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Validates the entire batch before mutating Shopify, then creates charts sequentially.
 * The same uploaded batch can be safely submitted again: named existing charts are skipped;
 * deterministic handles prevent duplicate creates on ambiguous network retries.
 */
export async function importCsvBatch(admin: Admin, payload: unknown): Promise<ImportResult[]> {
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > CSV_BATCH_SIZE) throw new CsvImportError(`Submit 1–${CSV_BATCH_SIZE} charts per batch.`);
  if (JSON.stringify(payload).length > 30000) throw new CsvImportError('Import batch is too large. Please split your file.');
  const charts = payload.map(verifyCsvChart);
  const names = charts.map(c => canonicalChartName(c.name));
  if (new Set(names).size !== names.length) throw new CsvImportError('Duplicate chart names in the same import batch.');
  charts.forEach(chart => validateChart(chart));
  const existing = await getCharts(admin);
  if (existing.truncated || existing.charts.length >= 250) throw new CsvImportError('The chart library is too large for the current safe importer. No charts were changed.');
  const used = new Set(existing.charts.map(c => canonicalChartName(c.name)));
  if (existing.charts.length + charts.filter(c => !used.has(canonicalChartName(c.name))).length > 250) {
    throw new CsvImportError('This import would exceed the current 250-chart limit. No charts were changed.');
  }
  const results: ImportResult[] = [];
  for (const chart of charts) {
    const key = canonicalChartName(chart.name);
    if (used.has(key)) {
      results.push({ name: chart.name, status: 'skipped', message: 'Chart name already exists; left unchanged.' });
      continue;
    }
    const handle = importHandleFor(chart.name);
    let done = false, errorMessage = '';
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const match = await existingByHandle(admin, handle);
        if (match !== null) {
          if (canonicalChartName(match) === key) {
            results.push({ name: chart.name, status: 'skipped', message: 'Previously imported; no duplicate created.' });
            used.add(key); done = true; break;
          }
          throw new Error('Import handle collision. This chart was not created.');
        }
        await createChart(admin, chart, handle);
        results.push({ name: chart.name, status: 'created', message: 'Created in Shopify; assign products separately.' });
        used.add(key); done = true;
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : 'Unexpected Shopify error.';
        if (/handle collision/i.test(errorMessage)) break;
        // Retry only on throttling/transient connectivity; deterministic handle makes retry safe.
        if (!/throttl|429|50[0234]|timed?\s*out|network|fetch|connection/i.test(errorMessage)) break;
        if (attempt < 2) await delay(500 * (attempt + 1));
      }
    }
    if (!done) results.push({ name: chart.name, status: 'error', message: errorMessage || 'Could not save chart.' });
    // A tiny pacing interval reduces the risk of exhausting GraphQL rate budgets.
    await delay(150);
  }
  return results;
}
