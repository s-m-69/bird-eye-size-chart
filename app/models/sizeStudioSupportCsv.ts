/** BirdEye V12.0.7: independent Support OR Compression numeric-bar CSV importer. */
import { canonicalChartName, readCsv, CsvImportError } from './sizeStudioCsv';
export type BarType = 'support' | 'compression';
export type SupportUpdate = {name:string; type:BarType|null; rating:number|null};
export type SupportResult = {name:string; status:'updated'|'unchanged'|'error';message:string};
export const SUPPORT_BATCH_SIZE=3;
const normalize=(s:string)=>s.trim().toLowerCase();
export function planSupportCsv(text:string):SupportUpdate[]{
  const grid=readCsv(text);
  if(grid.length<2)throw new CsvImportError('The file must include a header and chart rows.');
  const header=grid[0].map(x=>normalize(x.replace(/^\uFEFF/,'')).replace(/\s+/g,' '));
  const locate=(k:string)=>{const positions=header.map((x,i)=>x===k?i:-1).filter(x=>x>=0);if(positions.length!==1)throw new CsvImportError(`Exactly one ${k} column is required.`);return positions[0];};
  const nameAt=locate('chart name'),typeAt=locate('bar type'),ratingAt=locate('rating');
  const map=new Map<string,SupportUpdate>();
  for(let i=1;i<grid.length;i++){
    const cells=grid[i];if(cells.length!==header.length)throw new CsvImportError(`Row ${i+1}: wrong number of cells.`);
    const name=cells[nameAt].trim().replace(/\s+/g,' '),rawType=normalize(cells[typeAt]),rawRating=normalize(cells[ratingAt]);
    if(!name||name.length>120||/[\r\n]/.test(name)||/^[=@+\-]/.test(name))throw new CsvImportError(`Row ${i+1}: invalid Chart Name.`);
    if(!rawType&&!rawRating)continue;
    let type:BarType|null, rating:number|null;
    if((rawType==='clear'||rawRating==='clear')&&['','clear'].includes(rawType)&&['','clear'].includes(rawRating)){
      type=null;rating=null;
    }else{
      if(rawType!=='support'&&rawType!=='compression')throw new CsvImportError(`Row ${i+1} (${name}): Bar Type must be Support, Compression, blank or clear.`);
      if(!/^[1-5]$/.test(rawRating))throw new CsvImportError(`Row ${i+1} (${name}): Rating must be a whole number from 1 to 5.`);
      type=rawType;rating=Number(rawRating);
    }
    const key=canonicalChartName(name),previous=map.get(key);
    if(previous&&(previous.type!==type||previous.rating!==rating))throw new CsvImportError(`Chart ${name} has conflicting bar values in repeated rows.`);
    if(!previous)map.set(key,{name,type,rating});
    if(map.size>250)throw new CsvImportError('Maximum 250 charts per CSV upload.');
  }
  if(!map.size)throw new CsvImportError('No Support/Compression changes found.');
  return [...map.values()];
}
export function verifySupportBatch(payload:unknown):SupportUpdate[]{
  if(!Array.isArray(payload)||!payload.length||payload.length>SUPPORT_BATCH_SIZE)throw new CsvImportError(`Submit 1–${SUPPORT_BATCH_SIZE} changes per batch.`);
  const seen=new Set<string>();
  return payload.map(x=>{
    if(!x||typeof x!=='object')throw new CsvImportError('Invalid batch row.');
    const {name,type,rating}=x as Partial<SupportUpdate>;
    if(typeof name!=='string'||!name.trim()||name.length>120||/[\r\n]/.test(name))throw new CsvImportError('Invalid chart name.');
    const clear=type===null&&rating===null;
    if(!clear&&!( (type==='support'||type==='compression') && typeof rating==='number' &&Number.isInteger(rating)&&rating>=1&&rating<=5))throw new CsvImportError(`Invalid bar type/rating for ${name}.`);
    const key=canonicalChartName(name);if(seen.has(key))throw new CsvImportError('Duplicate chart in batch.');seen.add(key);
    return {name:name.trim(),type:type!,rating:rating!};
  });
}
export function supportCsvTemplate(charts:Array<{name:string;data:{supportType?:BarType;supportLevel?:number}}>){
  const quote=(s:string)=>`"${s.replace(/"/g,'""')}"`;
  return 'Chart Name,Bar Type,Rating\r\n'+charts.map(c=>{
    const rating=c.data.supportLevel;
    const has=typeof rating==='number'&&Number.isInteger(rating)&&rating>=1&&rating<=5;
    return `${quote(c.name)},${has?(c.data.supportType||'support'):''},${has?c.data.supportLevel:''}`;
  }).join('\r\n')+'\r\n';
}
