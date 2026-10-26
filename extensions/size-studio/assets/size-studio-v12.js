/* BirdEye Size Studio V12 – additive global enhancement. No third-party dependencies. */
(function (global) {
  'use strict';
  if (global.__BSS_V12_LOADED__) return;
  global.__BSS_V12_LOADED__ = true;
  const toInches = (n, unit) => unit === 'cm' ? n / 2.54 : n;
  const display = (s) => String(s ?? '').trim();
  const labels = ['Runs small','Runs slightly small','True to size','Runs slightly large','Runs large'];
  const supportLabels = ['Low support','Mid support','High support'];
  function interval(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const m = display(value).replace(/[–—−]/g, '-').match(/^\s*(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*$/);
    if (!m) return null;
    const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
    return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b >= a ? [a, b] : null;
  }
  function dimension(name) {
    const n = display(name).toLowerCase().replace(/[^a-z]/g, '');
    if (n === 'overbust' || n === 'bust' || n === 'chest') return 'bust';
    if (n === 'underbust') return 'underbust';
    if (n === 'waist') return 'waist';
    if (n === 'hip' || n === 'hips') return 'hips';
    return null;
  }
  function fields(chart) {
    const found = [];
    for (let i = 1; i < (chart?.columns || []).length; i++) {
      const key = dimension(chart.columns[i]);
      if (key && !found.some(x => x.key === key)) found.push({ key, index: i, label: chart.columns[i] });
    }
    return found;
  }
  function estimate(chart, values, inputUnit) {
    if (!chart || !Array.isArray(chart.rows) || !Array.isArray(chart.columns)) return { type:'unavailable', reason:'Missing chart.' };
    if (chart.recommendationBasis !== 'body') return { type:'unverified', reason:'Body-measurement ranges have not been approved for this chart.' };
    const dims = fields(chart);
    if (!dims.length) return { type:'unavailable', reason:'This chart has no supported body-measurement columns.' };
    const input = {};
    for (const d of dims) {
      const raw = values?.[d.key];
      if (raw === '' || raw === null || raw === undefined) return {type:'incomplete', missing:d.key};
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n > (inputUnit === 'cm' ? 300 : 120)) return {type:'invalid', field:d.key};
      input[d.key] = toInches(n, inputUnit);
    }
    const chartUnit = chart.unit === 'cm' ? 'cm' : 'in';
    const options = [];
    for (const row of chart.rows) {
      if (!Array.isArray(row) || !display(row[0])) continue;
      const distances = [];
      const valid = [];
      for (const d of dims) {
        const bounds = interval(row[d.index]);
        if (!bounds) {valid.push(false);continue;}
        const a = toInches(bounds[0], chartUnit), b = toInches(bounds[1], chartUnit);
        const n = input[d.key];
        valid.push(n >= a - 1e-7 && n <= b + 1e-7);
        distances.push(Math.abs(n - (a + b) / 2) / Math.max(1, b - a));
      }
      options.push({size: display(row[0]), fits:valid.every(Boolean), matches:valid.reduce((s,x)=>s+Number(x),0), score:distances.reduce((s,x)=>s+x,0)/Math.max(1,dims.length)});
    }
    if (!options.length) return {type:'unavailable',reason:'No size rows are available.'};
    const matches = options.filter(x => x.fits).sort((a,b) => a.score - b.score);
    if (matches.length) {
      const tie = matches.length > 1 && Math.abs(matches[0].score-matches[1].score) < 0.08;
      return { type:tie?'between_sizes':'recommended', size:matches[0].size, alternate:tie?matches[1].size:null, matches:matches.map(x=>x.size) };
    }
    // Conflicting dimensions: surface alternatives without pretending there is an exact fit.
    const partial = options.filter(x=>x.matches>0).sort((a,b)=>b.matches-a.matches || a.score-b.score);
    if (dims.length > 1 && partial.length) return {type:'between_sizes',size:partial[0].size,alternate:partial.find(x=>x.size!==partial[0].size)?.size || null, matches:[],reason:'Your measurements fall into different size ranges.'};
    return {type:'no_match',reason:'No verified size range contains your measurements.'};
  }
  const api={interval,dimension,fields,estimate,labels,supportLabels};
  global.BirdEyeSizeStudioV12 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  const doc=document;
  const create=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const settings=()=>doc.querySelector('[data-bss-v12-global]');
  const readChart=root=>{try{let x=JSON.parse(root.dataset.bssJson||'{}');return typeof x==='string'?JSON.parse(x):x}catch{return null}};
  const safeSession=()=>{
    try{let id=sessionStorage.getItem('bss_v12_journey');if(!id){id=global.crypto?.randomUUID?.()||'bss-'+Math.random().toString(36).slice(2);sessionStorage.setItem('bss_v12_journey',id)}return id}catch{return null}
  };
  const contextFor=(root)=>root?.dataset?.bssQuickView==='true'?'quick_view':root?.closest('[data-quick-view],quick-add-modal,.quick-add-modal,[id*="QuickView"],.quick-view')?'quick_view':location.pathname.startsWith('/collections/')?'collection':location.pathname==='/'?'home':'pdp';
  function emit(event,root,chart,outcome) {
    if (settings()?.dataset.bssTracking === 'false') return;
    const payload={version:12, event, journey_id:safeSession(), product_id:root?.dataset.bssProductId||null,
      chart_handle:root?.dataset.bssHandle||null, context:contextFor(root),
      recommended_size:outcome?.size||null, alternate_size:outcome?.alternate||null,
      result_type:outcome?.type||null, fit_rating:Number.isInteger(chart?.fitScale)?chart.fitScale:null,
      support_level:Number.isInteger(chart?.supportLevel)?chart.supportLevel:null};
    try{global.Shopify?.analytics?.publish?.('birdeye_size_studio:'+event,payload)}catch(_err){/* privacy/analytics failure never breaks sizing */}
  }
  function supportBar(chart) {
    const rating=chart?.supportLevel;
    if (!Number.isInteger(rating)||rating<1||rating>3) return null;
    const section=create('section','bss-v12-support');
    const h=create('h3','bss-v12-subtitle','Support');section.append(h);
    const track=create('div','bss-v12-support-track');track.setAttribute('role','img');track.setAttribute('aria-label',supportLabels[rating-1]);
    for(let i=1;i<=3;i++)track.append(create('span',i===rating?'is-selected':''));
    section.append(track);
    const labelRow=create('div','bss-v12-track-labels');
    for(const title of ['LOW SUPPORT','MID SUPPORT','HIGH SUPPORT'])labelRow.append(create('span','',title));
    section.append(labelRow);return section;
  }
  function renderCalculator(chart,root,unit,onChart) {
    const section=create('section','bss-v12-calculator');
    const header=create('div','bss-v12-calculator-head');header.append(create('h3','', 'Find My Size'));
    const description=create('p','','Enter your body measurements to check your fit.');header.append(description);section.append(header);
    const content=create('div','bss-v12-calculator-grid');
    const figure=create('div','bss-v12-image');
    const imageURL=root?.dataset.bssImage || settings()?.dataset.bssImage || '';
    if(imageURL && /^(https?:\/\/|\/\/|\/)/.test(imageURL)) {const img=create('img');img.src=imageURL;img.alt='Model and body measurement guidance';img.loading='lazy';figure.append(img)}
    else figure.append(create('div','bss-v12-image-placeholder','Measurement guide'));
    const form=create('form','bss-v12-form');form.noValidate=true;
    const selectedUnit=create('div','bss-v12-unit-choice');selectedUnit.setAttribute('role','group');selectedUnit.setAttribute('aria-label','Measurement units');
    let measureUnit=unit==='cm'?'cm':'in';
    const measurements={};
    function repaintUnits(){ for(const btn of selectedUnit.querySelectorAll('button')){ const selected=btn.dataset.unit===measureUnit;btn.classList.toggle('is-selected',selected);btn.setAttribute('aria-pressed',String(selected)) }}
    for(const name of ['in','cm']){const b=create('button','',name.toUpperCase());b.type='button';b.dataset.unit=name;b.addEventListener('click',()=>{ if(measureUnit===name)return; for(const field of Object.values(measurements)){if(field.value){const v=Number(field.value);if(Number.isFinite(v))field.value=String(Number((v*(name==='cm'?2.54:1/2.54)).toFixed(2))) } }measureUnit=name;repaintUnits();for(const el of form.querySelectorAll('.bss-v12-unit'))el.textContent=measureUnit.toUpperCase() });selectedUnit.append(b)}repaintUnits();form.append(selectedUnit);
    const dims=fields(chart);
    const result=create('div','bss-v12-result');result.setAttribute('aria-live','polite');
    for(const dim of dims){const wrapper=create('label','bss-v12-field');wrapper.append(create('span','',dim.label));const input=create('input');input.type='number';input.min='1';input.max='300';input.step='any';input.inputMode='decimal';input.autocomplete='off';input.placeholder='Enter measurement';input.setAttribute('aria-label',dim.label);measurements[dim.key]=input;wrapper.append(input,create('span','bss-v12-unit',measureUnit.toUpperCase()));form.append(wrapper)}
    const btn=create('button','bss-v12-submit','Calculate my size');btn.type='submit';
    const actions=create('div','bss-v12-actions');actions.append(btn);
    const chartBtn=create('button','bss-v12-secondary','View size chart');chartBtn.type='button';chartBtn.addEventListener('click',()=>onChart?.());actions.append(chartBtn);form.append(actions);
    form.addEventListener('submit',e=>{e.preventDefault();result.replaceChildren();const entered=Object.fromEntries(Object.entries(measurements).map(([key,input])=>[key,input.value]));const outcome=estimate(chart,entered,measureUnit);const h=create('h4','',outcome.type==='recommended'?`Recommended size: ${outcome.size}`:outcome.type==='between_sizes'?`Between sizes${outcome.size?': '+outcome.size+(outcome.alternate?' / '+outcome.alternate:''):''}`:'Unable to recommend a size');result.append(h);
      const explanation=outcome.type==='recommended'?'Your measurements fit within the approved body-sizing range.':outcome.type==='between_sizes'?(outcome.reason||'More than one size fits. Compare both sizes in the chart.'):(outcome.reason||'Check the measurements and the size chart.');result.append(create('p','',explanation));
      if(outcome.type==='recommended'||outcome.type==='between_sizes'){const fit=chart?.fitScale;if(Number.isInteger(fit)&&fit>=1&&fit<=5)result.append(create('p','bss-v12-fit-note','Fit note: '+labels[fit-1]+'.'));const support=chart?.supportLevel;if(Number.isInteger(support)&&support>=1&&support<=3)result.append(create('p','bss-v12-fit-note','Support: '+supportLabels[support-1]+'.'))}
      if(outcome.type==='recommended'||outcome.type==='between_sizes')emit('recommendation_generated',root,chart,outcome);
    });
    if(chart?.recommendationBasis!=='body'){btn.disabled=true;result.append(create('p','bss-v12-caution','Size recommendation is not available until the body-measurement ranges are verified. You can still use the size chart.'))}
    else if(!dims.length){btn.disabled=true;result.append(create('p','bss-v12-caution','This chart has no supported measurement fields.'))}
    form.append(result);content.append(figure,form);section.append(content);return section;
  }
  // Enhance legacy PDP size-guide modal without changing any of its existing chart/table handling.
  const layerOwner=new WeakMap();
  function scanLayers(){
    for(const root of doc.querySelectorAll('[data-bss-v9-root]')) {
      const layer=root.querySelector('[data-bss-layer]');if(layer)layerOwner.set(layer,root);
    }
    for(const layer of doc.querySelectorAll('[data-bss-layer]')){
      if(layer.hidden)continue;
      const content=layer.querySelector('[data-bss-content]');if(!content||content.querySelector('.bss-v12-calculator'))continue;
      const root=layerOwner.get(layer)||doc.querySelector('[data-bss-v9-root]');if(!root)continue;
      const chart=readChart(root);if(!chart||!Array.isArray(chart.rows))continue;
      const table=content.querySelector('.bss__table-scroll');if(!table)continue;
      const bar=supportBar(chart);if(bar)table.before(bar);
      const unit=content.querySelector('[data-bss-unit].is-selected')?.dataset.bssUnit||'in';
      const calculator=renderCalculator(chart,root,unit,()=>table.scrollIntoView({block:'nearest',behavior:'smooth'}));table.before(calculator);
      emit('guide_opened',root,chart);
    }
  }
  // Reuse the actual chart JSON already rendered on the product page by the
  // existing Size Studio Liquid app block. No app proxy or Render/Neon request.
  // A product page is fetched only when its quick-view size guide is opened.
  const QUICKVIEWS='quick-add-modal,.quick-add-modal,[data-quick-view],.quick-view,[id*="QuickView"],[id*="quick-view"],.quickview,[class*="quick-view"]';
  const chartCache=new Map();
  const VALID_HANDLE=/^[a-z0-9][a-z0-9-]{0,199}$/;
  const fromURL=value=>{
    if(!value)return null;
    try{
      const u=new URL(value,location.origin);
      if(u.origin!==location.origin)return null;
      const match=u.pathname.match(/\/products\/([a-z0-9][a-z0-9-]{0,199})(?:\/)?$/i);
      return match?match[1].toLowerCase():null;
    }catch{return null}
  };
  function handleFrom(container) {
    if(!container)return null;
    // Prefer explicit product context or product-title URL; never infer from text.
    const contexts=[container,...container.querySelectorAll('[data-product-handle],[data-handle],[data-product-url]')].slice(0,20);
    for(const context of contexts){
      for(const value of [context.dataset?.productHandle,context.dataset?.handle]){
        if(VALID_HANDLE.test(value||''))return value;
      }
      const url=fromURL(context.dataset?.productUrl);
      if(url)return url;
    }
    for(const link of container.querySelectorAll('.product__title a[href*="/products/"],.product-title a[href*="/products/"],[data-product-title] a[href*="/products/"]')){
      const handle=fromURL(link.getAttribute('href'));
      if(handle)return handle;
    }
    // A drawer can contain cross-sell links. Refuse to guess when ambiguous.
    const handles=new Set();
    for(const link of Array.from(container.querySelectorAll('a[href*="/products/"]')).slice(0,40)){
      const handle=fromURL(link.getAttribute('href'));
      if(handle)handles.add(handle);
      if(handles.size>1)return null;
    }
    return handles.size===1?[...handles][0]:null;
  }
  function locateSizeRow(panel){
    const placeholder=panel.querySelector('.size_select > .perfect_fit,.size_select .perfect_fit');
    if(placeholder)return {target:placeholder,insert:'before'};
    // Kiwi may be disabled. Still attach to the shared drawer's own Size label.
    const rows=panel.querySelectorAll('.size_select,.product-form__input,fieldset[data-option-name="Size"],fieldset, [data-option-name="Size"]');
    for(const row of rows){
      if(row.closest('[data-bss-layer]'))continue;
      const labels=row.querySelectorAll('legend,label,.form__label,.option-label,.product-form__label,span');
      for(const label of Array.from(labels).slice(0,30)){
        if(label.children.length>1)continue;
        if(/^size\s*:?[\s]*$/i.test(label.textContent?.trim()||''))return {target:label,insert:'after'};
      }
      if(row.classList.contains('size_select'))return {target:row,insert:'prepend'};
    }
    return null;
  }
  function scanQuickviews(){
    const config=settings();if(!config||config.dataset.bssQuickview!=='true')return;
    for(const panel of Array.from(doc.querySelectorAll(QUICKVIEWS)).slice(0,24)){
      if(panel.closest('[data-bss-layer]'))continue;
      const slot=locateSizeRow(panel);if(!slot)continue;
      const handle=handleFrom(panel);
      let trigger=panel.querySelector('[data-bss-v12-quick-trigger]');
      if(trigger){
        if(handle&&handle!==trigger.dataset.bssProductHandle)trigger.dataset.bssProductHandle=handle;
        continue;
      }
      if(!handle)continue; // No reliable product context => no incorrect chart.
      trigger=create('button','bss-v12-quick-trigger','Find Your Perfect Fit');
      trigger.type='button';trigger.dataset.bssV12QuickTrigger='true';
      trigger.dataset.bssProductHandle=handle;
      trigger.setAttribute('aria-haspopup','dialog');
      if(slot.insert==='before')slot.target.before(trigger);
      else if(slot.insert==='after')slot.target.after(trigger);
      else slot.target.prepend(trigger);
    }
  }
  async function loadStorefrontChart(handle){
    if(!VALID_HANDLE.test(handle))throw Error('Invalid product handle');
    const existing=chartCache.get(handle);
    if(existing&&Date.now()-existing.at<5*60*1000)return existing.data;
    // Shopify.routes.root covers international storefront routes.
    const localeRoot=global.Shopify?.routes?.root || '/';
    const url=new URL(localeRoot.replace(/\/?$/,'/')+'products/'+encodeURIComponent(handle),location.origin);
    if(url.origin!==location.origin)throw Error('Unexpected product origin');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),6500);
    let html;
    try{
      const response=await fetch(url.toString(),{credentials:'same-origin',headers:{Accept:'text/html'},signal:controller.signal});
      if(!response.ok||new URL(response.url).origin!==location.origin)throw Error('Product page unavailable');
      const size=Number(response.headers.get('content-length')||0);
      if(size>3*1024*1024)throw Error('Product page exceeds safe read size');
      html=await response.text();
      if(html.length>3*1024*1024)throw Error('Product page exceeds safe read size');
    }finally{clearTimeout(timeout)}
    const page=new DOMParser().parseFromString(html,'text/html');
    const chartNode=page.querySelector('[data-bss-v9-root][data-bss-json]');
    if(!chartNode)throw Error('No Size Studio chart rendered for product');
    const chart=readChart(chartNode);
    if(!chart||!Array.isArray(chart.rows)||!chart.rows.length||!Array.isArray(chart.columns))throw Error('Malformed product chart');
    const data={handle, chart, chartHandle:chartNode.dataset.bssHandle||'',
      productId:chartNode.dataset.bssProductId||'',
      title:chartNode.querySelector('.bss__heading')?.textContent?.trim()||'Size guide'};
    chartCache.set(handle,{at:Date.now(),data});
    if(chartCache.size>80)chartCache.delete(chartCache.keys().next().value);
    return data;
  }
  async function quickviewClick(button){
    if(button.disabled)return;
    // Re-read the active product at click time in case the drawer was reused.
    const drawer=button.closest(QUICKVIEWS);
    const current=handleFrom(drawer);
    const handle=current||button.dataset.bssProductHandle;
    if(!handle||!VALID_HANDLE.test(handle))return;
    button.disabled=true;
    try{
      const data=await loadStorefrontChart(handle);
      if(!button.isConnected)return; // Drawer was closed/replaced during request.
      const now=handleFrom(button.closest(QUICKVIEWS));
      if(now&&now!==handle)return; // Prevent a stale chart after product switch.
      popup(data,button);
    }catch(_err){
      button.title='Size guide unavailable. Please open the product page.';
      button.setAttribute('aria-label','Size guide unavailable. Open the product page.');
    }finally{button.disabled=false}
  }
  function popup(data,opener){
    const root=create('div','bss');root.dataset.bssHandle=data.chartHandle||'';root.dataset.bssProductId=data.productId||'';root.dataset.bssProductHandle=data.handle||'';root.dataset.bssQuickView='true';
    const layer=create('div','bss__layer');layer.dataset.bssMode='modal';
    const scrim=create('div','bss__scrim');const panel=create('section','bss__panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.tabIndex=-1;
    const head=create('div','bss__head');head.append(create('h2','bss__heading',data.title||'Size guide'));
    const close=create('button','bss__close','×');close.type='button';close.setAttribute('aria-label','Close size guide');head.append(close);
    const content=create('div','bss__content');
    const units=create('div','bss-v12-simple-units');const chartContent=create('div');let selected='in';
    function paintTable(){chartContent.replaceChildren();const table=create('table','bss__table');const tr=create('tr');for(const label of data.chart.columns)tr.append(create('th','',label));const thead=create('thead');thead.append(tr);table.append(thead);const tbody=create('tbody');for(const values of data.chart.rows){const row=create('tr');values.forEach((v,i)=>{let shown=String(v||'');if(i&&selected!==data.chart.unit){shown=shown.replace(/\d+(?:\.\d+)?/g,t=>String(Number((Number(t)*(selected==='cm'?2.54:1/2.54)).toFixed(1))))}row.append(create(i?'td':'th','',shown))});tbody.append(row)}table.append(tbody);chartContent.append(table)}
    for(const u of ['in','cm']){const b=create('button','',''+u.toUpperCase());b.type='button';b.addEventListener('click',()=>{selected=u;paintTable()});units.append(b)}
    const scroller=create('div','bss__table-scroll');scroller.append(chartContent);paintTable();
    // Quick View must show the same True to Fit information as the PDP.
    const fitRating=data.chart?.fitScale;
    if(Number.isInteger(fitRating)&&fitRating>=1&&fitRating<=5){
      const fit=create('div','bss__fit-scale');fit.setAttribute('role','img');fit.setAttribute('aria-label',`Fit rating ${fitRating} of 5: ${labels[fitRating-1]}`);
      const track=create('div','bss__fit-track');track.setAttribute('aria-hidden','true');
      for(let i=1;i<=5;i++)track.append(create('span',i===fitRating?'bss__fit-segment is-active':'bss__fit-segment'));
      fit.append(track);
      const captions=create('div','bss__fit-labels');captions.setAttribute('aria-hidden','true');
      for(const text of ['Runs Small','True to Size','Runs Large'])captions.append(create('span','',text));
      fit.append(captions);content.append(fit);
    }
    const support=supportBar(data.chart);if(support)content.append(support);
    content.append(renderCalculator(data.chart,root,'in',()=>scroller.scrollIntoView({block:'nearest'})),units,scroller);
    panel.append(head,content);layer.append(scrim,panel);root.append(layer);doc.body.append(root);
    const prev=doc.activeElement;const overflow=doc.body.style.overflow;doc.body.style.overflow='hidden';panel.focus();emit('guide_opened',root,data.chart);
    function dismiss(){doc.removeEventListener('keydown',keys,true);root.remove();doc.body.style.overflow=overflow;(prev?.isConnected?prev:opener)?.focus()}
    function keys(e){if(e.key==='Escape'){e.preventDefault();dismiss()}if(e.key==='Tab'){const els=[...panel.querySelectorAll('button:not([disabled]), input:not([disabled])')];if(els.length){const a=els[0],z=els[els.length-1];if(e.shiftKey&&doc.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&doc.activeElement===z){e.preventDefault();a.focus()}}}}
    scrim.addEventListener('click',dismiss);close.addEventListener('click',dismiss);doc.addEventListener('keydown',keys,true);
  }
  let raf=0;
  function scan(){scanLayers();scanQuickviews()}
  function schedule(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;scan()})}
  doc.addEventListener('click',e=>{const el=e.target?.closest?.('[data-bss-v12-quick-trigger]');if(el){e.preventDefault();e.stopPropagation();quickviewClick(el)}},true);
  function init(){scan();const observer=new MutationObserver(records=>{if(records.some(r=>r.addedNodes.length||r.removedNodes.length))schedule()});observer.observe(doc.body,{subtree:true,childList:true});doc.addEventListener('shopify:section:load',schedule)}
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window!=='undefined'?window:globalThis);
