/** Bulk-updates only the chart_data JSON field of EXISTING Shopify size chart metaobjects. */
import { getCharts } from './sizeStudio.server';
import { canonicalChartName, CsvImportError } from './sizeStudioCsv';
import { verifyGuidanceBatch } from './sizeStudioGuidanceCsv';
import type { GuidanceResult } from './sizeStudioGuidanceCsv';
type Admin = {graphql:(query:string,options?:{variables?:Record<string,unknown>})=>Promise<Response>};

export async function updateGuidanceBatch(admin: Admin, payload: unknown, approveBody: boolean): Promise<GuidanceResult[]> {
  const updates = verifyGuidanceBatch(payload);
  const {charts,truncated} = await getCharts(admin);
  if (truncated) throw new CsvImportError('The chart library is incomplete. No updates made.');
  const byName = new Map<string,typeof charts>();
  for (const c of charts) {const k=canonicalChartName(c.name);byName.set(k,[...(byName.get(k)||[]),c]);}
  // Validate entire batch BEFORE the first mutation.
  for (const update of updates) {
    const matches=byName.get(canonicalChartName(update.name))||[];
    if (matches.length !== 1) throw new CsvImportError(`Chart ${update.name} ${matches.length?'is duplicated':'was not found'}. Batch cancelled.`);
    if (update.eligibility === 'body' && matches[0].data.recommendationBasis !== 'body' && !approveBody)
      throw new CsvImportError(`Approval required for ${update.name}: confirm the chart contains BODY measurement ranges.`);
  }
  const results: GuidanceResult[]=[];
  for (const u of updates) {
    const chart=byName.get(canonicalChartName(u.name))![0];
    const data={...chart.data};
    if (u.imageUrl === null) delete data.measurementImageUrl;
    else if (typeof u.imageUrl === 'string') data.measurementImageUrl=u.imageUrl;
    if (u.eligibility) data.recommendationBasis=u.eligibility;
    if (JSON.stringify(data)===JSON.stringify(chart.data)) {
      results.push({name:chart.name,status:'unchanged',message:'Already matches the CSV.'});continue;
    }
    if (JSON.stringify(data).length > 26000) {
      results.push({name:chart.name,status:'error',message:'Updated chart_data would exceed the Shopify size limit.'});
      continue;
    }
    try {
      const response=await admin.graphql(`#graphql
        mutation BirdEyeGuidanceOnly($id: ID!, $metaobject: MetaobjectUpdateInput!) {
          metaobjectUpdate(id:$id,metaobject:$metaobject) {
            metaobject { id }
            userErrors { field message }
          }
        }`,{variables:{id:chart.id,metaobject:{fields:[{key:'chart_data',value:JSON.stringify(data)}]}}});
      if (!response.ok) throw new Error(`Shopify HTTP ${response.status}`);
      const body=await response.json();
      if (body.errors?.length) throw new Error(body.errors.map((e:{message:string})=>e.message).join('; '));
      const result=body.data?.metaobjectUpdate;
      if (!result?.metaobject || result.userErrors?.length) throw new Error(result?.userErrors?.map((e:{message:string})=>e.message).join('; ')||'Shopify did not confirm the update.');
      results.push({name:chart.name,status:'updated',message:'Chart image / eligibility saved.'});
    } catch (error) {
      results.push({name:chart.name,status:'error',message:error instanceof Error?error.message:'Save failed.'});
    }
  }
  return results;
}
