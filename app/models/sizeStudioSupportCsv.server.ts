/** V12.0.7: existing charts only; updates chart_data.supportType/supportLevel without touching Fit or measurements. */
import {getCharts} from './sizeStudio.server';
import {canonicalChartName,CsvImportError} from './sizeStudioCsv';
import {verifySupportBatch} from './sizeStudioSupportCsv';
import type {SupportResult} from './sizeStudioSupportCsv';
type Admin={graphql:(query:string,options?:{variables?:Record<string,unknown>})=>Promise<Response>};
export async function updateSupportBatch(admin:Admin,payload:unknown):Promise<SupportResult[]>{
  const updates=verifySupportBatch(payload),{charts,truncated}=await getCharts(admin);
  if(truncated)throw new CsvImportError('Chart library is incomplete; nothing was updated.');
  const index=new Map<string,typeof charts>();
  for(const c of charts){const key=canonicalChartName(c.name);index.set(key,[...(index.get(key)||[]),c]);}
  for(const u of updates){const matches=index.get(canonicalChartName(u.name))||[];if(matches.length!==1)throw new CsvImportError(`Chart ${u.name} was not found or is duplicated; batch cancelled.`);}
  const results:SupportResult[]=[];
  for(const u of updates){
    const chart=index.get(canonicalChartName(u.name))![0];
    const oldType=chart.data.supportLevel==null?null:(chart.data.supportType||'support');
    const oldRating=chart.data.supportLevel??null;
    if(oldType===u.type&&oldRating===u.rating){results.push({name:chart.name,status:'unchanged',message:'Already set.'});continue;}
    const data={...chart.data};
    if(u.type===null){delete data.supportType;delete data.supportLevel;}
    else{data.supportType=u.type;data.supportLevel=u.rating!;}
    try{
      const res=await admin.graphql(`#graphql
        mutation SizeStudioBarOnly($id: ID!, $metaobject: MetaobjectUpdateInput!) {
          metaobjectUpdate(id:$id, metaobject:$metaobject) { metaobject { id } userErrors { field message } }
        }`,{variables:{id:chart.id,metaobject:{fields:[{key:'chart_data',value:JSON.stringify(data)}]}}});
      if(!res.ok)throw new Error(`Shopify HTTP ${res.status}`);
      const body=await res.json();
      if(body.errors?.length)throw new Error(body.errors.map((x:{message:string})=>x.message).join('; '));
      const result=body.data?.metaobjectUpdate;
      if(!result?.metaobject||result.userErrors?.length)throw new Error(result?.userErrors?.map((x:{message:string})=>x.message).join('; ')||'No success confirmation');
      results.push({name:chart.name,status:'updated',message:`${u.type??'Bar cleared'} ${u.rating??''}`.trim()});
    }catch(err){results.push({name:chart.name,status:'error',message:err instanceof Error?err.message:'Update failed'});}
  }
  return results;
}
