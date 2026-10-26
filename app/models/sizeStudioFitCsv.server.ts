/** Update ONLY Shopify metaobject chart_data.fitScale, never chart measurements, names or assignments. */
import { getCharts } from './sizeStudio.server';
import { canonicalChartName, CsvImportError } from './sizeStudioCsv';
import { verifyFitBatch } from './sizeStudioFitCsv';
import type { FitResult } from './sizeStudioFitCsv';

type Admin = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };

export async function updateFitBatch(admin: Admin, payload: unknown): Promise<FitResult[]> {
  const updates = verifyFitBatch(payload);
  const { charts, truncated } = await getCharts(admin);
  if (truncated) throw new CsvImportError('The chart library is incomplete. No ratings were changed.');
  const byName = new Map<string, typeof charts>();
  for (const chart of charts) {
    const key = canonicalChartName(chart.name);
    byName.set(key, [...(byName.get(key) ?? []), chart]);
  }
  // Fail the entire batch before a single Shopify mutation on mismatch/ambiguity.
  for (const update of updates) {
    const matches = byName.get(canonicalChartName(update.name)) ?? [];
    if (matches.length !== 1) throw new CsvImportError(`Chart “${update.name}” ${matches.length ? 'has duplicate names' : 'was not found'}. Nothing in this batch was changed.`);
  }
  const results: FitResult[] = [];
  for (const update of updates) {
    const chart = byName.get(canonicalChartName(update.name))![0];
    const was = chart.data.fitScale;
    if (was === update.rating || (update.rating === null && was === undefined)) {
      results.push({ name: chart.name, status: 'unchanged', message: 'Already has this rating.' });
      continue;
    }
    const data = { ...chart.data };
    if (update.rating === null) delete data.fitScale;
    else data.fitScale = update.rating;
    try {
      const res = await admin.graphql(`#graphql
        mutation SizeStudioFitOnly($id: ID!, $metaobject: MetaobjectUpdateInput!) {
          metaobjectUpdate(id: $id, metaobject: $metaobject) {
            metaobject { id }
            userErrors { field message }
          }
        }`, { variables: { id: chart.id, metaobject: { fields: [{ key: 'chart_data', value: JSON.stringify(data) }] } } });
      if (!res.ok) throw new Error(`Shopify returned HTTP ${res.status}.`);
      const body = await res.json();
      if (body.errors?.length) throw new Error(body.errors.map((e: {message:string}) => e.message).join('; '));
      const result = body.data?.metaobjectUpdate;
      if (!result?.metaobject || result.userErrors?.length) throw new Error(result?.userErrors?.map((e: {message:string}) => e.message).join('; ') || 'Shopify did not confirm the update.');
      results.push({ name: chart.name, status: 'updated', message: 'Fit rating updated.' });
    } catch (error) {
      results.push({ name: chart.name, status: 'error', message: error instanceof Error ? error.message : 'Update failed.' });
    }
  }
  return results;
}
