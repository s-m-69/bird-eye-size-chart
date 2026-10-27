/** BirdEye Size Studio V12.1.4: bulk measurement image and eligibility editor. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import type { Chart } from '../../models/sizeStudio.server';
import { canonicalChartName } from '../../models/sizeStudioCsv';
import { GUIDANCE_BATCH_SIZE, guidanceCsvTemplate, planGuidanceCsv } from '../../models/sizeStudioGuidanceCsv';
import type { GuidanceResult, GuidanceUpdate } from '../../models/sizeStudioGuidanceCsv';

type ResponseData = {guidanceResults?: GuidanceResult[]; error?:string};
function displayEligibility(v?: string) {
  return v === 'body' ? 'Approved body-measurement ranges'
    : v === 'garment' ? 'Garment measurements only' : 'Unverified';
}
export function GuidanceCsvUpdater({charts,truncated}:{charts:Chart[];truncated:boolean}) {
  const fetcher=useFetcher<ResponseData>();
  const [updates,setUpdates]=useState<GuidanceUpdate[]>([]);
  const [file,setFile]=useState('');
  const [error,setError]=useState('');
  const [results,setResults]=useState<GuidanceResult[]>([]);
  const [offset,setOffset]=useState(0);
  const [running,setRunning]=useState(false);
  const [inFlight,setInFlight]=useState(false);
  const [approved,setApproved]=useState(false);
  const responseSeen=useRef<unknown>(null);
  const byName=useMemo(()=>{
    const index=new Map<string,Chart[]>();
    for(const chart of charts){const key=canonicalChartName(chart.name);index.set(key,[...(index.get(key)||[]),chart]);}
    return index;
  },[charts]);
  const needsApproval=updates.some(u=>u.eligibility==='body' && byName.get(canonicalChartName(u.name))?.[0]?.data.recommendationBasis!=='body');
  const finished=updates.length>0 && offset>=updates.length && !running;
  const success=results.filter(r=>r.status==='updated').length;
  const unchanged=results.filter(r=>r.status==='unchanged').length;
  const failures=results.filter(r=>r.status==='error');
  const reviewed=updates.map(u=>{
    const c=byName.get(canonicalChartName(u.name))![0];
    const image=u.imageUrl===undefined?'No change':u.imageUrl===null?'Remove image':u.imageUrl===c.data.measurementImageUrl?'Already assigned':'Update image';
    const eligibility=u.eligibility===undefined?'No change':displayEligibility(u.eligibility);
    return {...u,image,eligibilityDisplay:eligibility};
  });
  function download(){
    const csv='\uFEFF'+guidanceCsvTemplate(charts);
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='BirdEye_Chart_Images_Eligibility.csv';
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }
  async function load(file?:File){
    if(!file||running||inFlight)return;
    setFile(file.name);setUpdates([]);setResults([]);setOffset(0);setRunning(false);setApproved(false);setError('');
    if(!/\.csv$/i.test(file.name)||file.size>256*1024){setError('Select a CSV under 256 KB.');return;}
    if(truncated){setError('The chart library is incomplete. Bulk updates are disabled.');return;}
    try{
      const plan=planGuidanceCsv(await file.text());
      const missing=plan.filter(row=>(byName.get(canonicalChartName(row.name))||[]).length!==1);
      if(missing.length) throw new Error('Unknown or ambiguous chart names: '+missing.slice(0,6).map(c=>c.name).join(', ')+'. No changes have been made.');
      setUpdates(plan);
    }catch(e){setError(e instanceof Error?e.message:'Could not read this file.');}
  }
  function start(){
    if(!updates.length||inFlight||truncated||needsApproval&&!approved)return;
    setError('');setResults([]);setOffset(0);responseSeen.current=fetcher.data;setRunning(true);
  }
  useEffect(()=>{
    if(!running||inFlight||fetcher.state!=='idle')return;
    if(offset>=updates.length){setRunning(false);return;}
    setInFlight(true);
    fetcher.submit({intent:'update-guidance-batch',payload:JSON.stringify(updates.slice(offset,offset+GUIDANCE_BATCH_SIZE)),approveBody:approved?'yes':'no'}, {method:'post'});
  },[running,inFlight,fetcher.state,offset,updates,approved]);
  useEffect(()=>{
    if(!inFlight||fetcher.state!=='idle'||!fetcher.data||fetcher.data===responseSeen.current)return;
    responseSeen.current=fetcher.data;setInFlight(false);
    if(Array.isArray(fetcher.data.guidanceResults)){
      const batch=fetcher.data.guidanceResults;
      setResults(old=>[...old,...batch]);
      if(batch.some(r=>r.status==='error')){
        setError('Some charts could not be saved. Review the failures and reupload to retry safely.');setRunning(false);
      }else setOffset(v=>v+batch.length);
    }else{setError(fetcher.data.error||'Shopify did not confirm this update. No additional batches were submitted.');setRunning(false);}
  },[inFlight,fetcher.state,fetcher.data]);
  return <section className="bss-admin-guidance" aria-label="Update chart images and sizing eligibility">
    <div className="bss-admin-guidance-head">
      <div><span className="bss-admin-eyebrow">EXISTING CHARTS · CSV</span><h2>Images & recommendation eligibility</h2>
        <p>Update measurement-guide images and sizing eligibility across your chart library. Measurements, Fit, Support/Compression and product assignments are never modified by this importer.</p></div>
      <span className="bss-admin-meta">{charts.length} charts</span>
    </div>
    <div className="bss-admin-guidance-steps">
      <div><span className="bss-admin-step">01 / EXPORT</span><h3>Download your chart list</h3><p>One row per chart, with its currently saved settings. Edit in Excel or Google Sheets.</p>
        <button type="button" className="bs-v11-btn" disabled={truncated||!charts.length||running||inFlight} onClick={download}>Download prefilled CSV ↓</button></div>
      <div><span className="bss-admin-step">02 / UPLOAD</span><h3>Upload updated CSV</h3><p>Enter an HTTPS image URL and select one of the three eligibility states.</p>
        <label className="bss-admin-upload" htmlFor="bss-guidance-file">Choose CSV file</label>
        <input id="bss-guidance-file" type="file" accept=".csv,text/csv" aria-label="Upload chart images and eligibility CSV" disabled={truncated||running||inFlight} onChange={e=>void load(e.target.files?.[0])}/>
        {file&&<p className="bss-admin-selected-file">{file}</p>}</div>
    </div>
    <p className="bss-admin-hint"><strong>Blank</strong> = leave unchanged. Type <code>clear</code> in Measurement Image URL to remove an image. Eligibility: <code>Unverified</code>, <code>Garment measurements only</code>, or <code>Approved body-measurement ranges</code>. Use only verified BODY ranges for the last option.</p>
    {!!updates.length&&<div className="bss-admin-guidance-review">
      <div className="bss-admin-review-head"><h3>Review {updates.length} chart update{updates.length===1?'':'s'}</h3><p>Nothing is saved until you confirm.</p></div>
      <div className="bss-admin-review-table-wrap"><table className="bss-admin-review-table"><thead><tr><th>Chart</th><th>Measurement image</th><th>Recommendation eligibility</th></tr></thead><tbody>
        {reviewed.map(u=><tr key={u.name}><td>{u.name}</td><td>{u.image}</td><td>{u.eligibilityDisplay}</td></tr>)}
      </tbody></table></div>
      {needsApproval&&<label className="bss-admin-approval"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/><span>I have verified that every chart being changed to <strong>Approved body-measurement ranges</strong> contains actual customer body ranges, not finished-garment dimensions.</span></label>}
      <div className="bss-admin-guidance-actions"><button type="button" className="bs-v11-btn primary" disabled={running||inFlight||finished||needsApproval&&!approved} onClick={start}>{running||inFlight?'Saving charts…':finished?'Update complete ✓':`Apply ${updates.length} chart update${updates.length===1?'':'s'}`}</button><span>Saved in batches of {GUIDANCE_BATCH_SIZE}. Safe to reupload and retry.</span></div>
    </div>}
    {!!results.length&&<p role="status" className="bss-admin-progress">{success} updated · {unchanged} unchanged · {failures.length} errors · {Math.min(offset,updates.length)} of {updates.length} processed</p>}
    {!!failures.length&&<p role="alert" className="bs-v11-alert error">{failures.slice(0,4).map(r=>`${r.name}: ${r.message}`).join(' · ')}</p>}
    {error&&<p role="alert" className="bs-v11-alert error">{error}</p>}
    {finished&&!error&&<p role="status" className="bs-v11-alert success">Updates saved. Refresh the chart library to see the latest values.</p>}
  </section>;
}
