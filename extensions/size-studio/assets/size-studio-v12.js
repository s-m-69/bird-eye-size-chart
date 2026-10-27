/* BirdEye Size Studio V12.1.3 – chart height, real close and hard background scroll lock. */
(function (global) {
  'use strict';
  if (global.__BSS_V12_LOADED__) return;
  global.__BSS_V12_LOADED__ = true;
  global.__BSS_V12_BUILD__ = '12.1.3';
  const toInches = (n, unit) => unit === 'cm' ? n / 2.54 : n;
  const display = (s) => String(s ?? '').trim();
  const labels = ['Runs small','Runs slightly small','True to size','Runs slightly large','Runs large'];
  const supportLabels = ['Level 1 of 5','Level 2 of 5','Level 3 of 5','Level 4 of 5','Level 5 of 5'];
  const barKind = chart => chart?.supportType === 'compression' ? 'Compression' : 'Support';
  const hasBar = chart => Number.isInteger(chart?.supportLevel) && chart.supportLevel >= 1 && chart.supportLevel <= 5 && (chart.supportType === undefined || chart.supportType === 'support' || chart.supportType === 'compression');
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
  // Compare actual measurements to every available size, never infer a range
  // from Fit/Support/Compression ratings. Approved body charts only.
  function estimate(chart, values, inputUnit) {
    if (!chart || !Array.isArray(chart.rows) || !Array.isArray(chart.columns)) return {type:'unavailable',reason:'Missing chart.'};
    if (chart.recommendationBasis !== 'body') return {type:'unverified',reason:'Body-measurement ranges are not yet approved.'};
    const dims=fields(chart);
    if (!dims.length) return {type:'unavailable',reason:'No supported body-measurement columns.'};
    const measurements={};
    for(const d of dims){
      const raw=values?.[d.key];
      if(raw===''||raw===undefined||raw===null)return {type:'incomplete',missing:d.key};
      const n=Number(raw);
      if(!Number.isFinite(n)||n<=0||n>(inputUnit==='cm'?300:120))return {type:'invalid',field:d.key};
      measurements[d.key]=toInches(n,inputUnit);
    }
    const chartUnit=chart.unit==='cm'?'cm':'in';
    const weights=Object.fromEntries(dims.map(d=>[d.key,dims.length===1?1:
      (dims.some(x=>x.key==='waist')&&dims.some(x=>x.key==='hips')?(d.key==='waist'?.6:.4):
      (dims.some(x=>x.key==='underbust')?(d.key==='underbust'?.6:.4):1/dims.length))]));
    const options=[];
    for(const row of chart.rows){
      if(!Array.isArray(row)||!display(row[0]))continue;
      const comparisons=[];
      for(const d of dims){
        const raw=interval(row[d.index]);
        if(!raw){comparisons.length=0;break;} // incomplete sizes are never candidates
        const [lo,hi]=raw.map(n=>toInches(n,chartUnit));
        const actual=measurements[d.key];
        const offset=actual<lo?lo-actual:actual>hi?actual-hi:0;
        const normalized=offset/Math.max(1,hi-lo);
        comparisons.push({key:d.key,label:display(d.label),actual,lo,hi,inside:offset<=1e-7,offset,normalized,
          weight:weights[d.key]||1/dims.length});
      }
      if(comparisons.length!==dims.length)continue;
      const fit=comparisons.every(c=>c.inside);
      const penalty=comparisons.reduce((t,c)=>t+c.normalized*c.weight,0);
      const midpoint=comparisons.reduce((t,c)=>t+c.weight*Math.abs(c.actual-(c.lo+c.hi)/2)/Math.max(1,c.hi-c.lo),0);
      options.push({size:display(row[0]),comparisons,fit,penalty,midpoint});
    }
    if(!options.length)return {type:'unavailable',reason:'No complete size ranges are available.'};
    // Prefer a size containing all measurements. When none does, rank nearest
    // available ranges by weighted amount outside each dimension's interval.
    options.sort((a,b)=>Number(b.fit)-Number(a.fit)||a.penalty-b.penalty||a.midpoint-b.midpoint||a.size.localeCompare(b.size));
    const winner=options[0];
    return {type:winner.fit?'recommended':'best_match',size:winner.size,
      alternate:null,comparisons:winner.comparisons,
      reason:winner.fit?'All required measurements fall within this size range.':
       'This is the closest available size based on the measurements you entered.',
      exact:winner.fit};
  }
  function formatMeasurement(n,unit){return unit==='cm'?String(Math.round(n*2.54)):String(Number(n.toFixed(1)))}
  function describeOutcome(outcome,unit){
    if(!outcome?.comparisons?.length)return 'Compare your measurements with the size chart.';
    const within=outcome.comparisons.filter(c=>c.inside);
    const outside=outcome.comparisons.filter(c=>!c.inside);
    const names=within.map(c=>c.label.toLowerCase()).join(' and ');
    if(!outside.length)return `Your ${names} ${within.length===1?'falls':'fall'} within this size’s approved measurement range.`;
    const deviations=outside.map(c=>`${c.label.toLowerCase()} is ${c.actual<c.lo?'below':'above'} the listed ${outcome.size} range`);
    const expected=outside.map(c=>`${c.label.toLowerCase()} may feel ${c.actual<c.lo?'looser':'snugger'}`).join('; ');
    return `${within.length?`Your ${names} ${within.length===1?'fits':'fit'} ${outcome.size}. `:''}Your ${deviations.join(' and ')}. ${expected.charAt(0).toUpperCase()+expected.slice(1)}. Check the chart if you prefer a different fit.`;
  }
  function convertChartValue(value,sourceUnit,targetUnit){
    const text=String(value??'');
    if(targetUnit==='in'&&sourceUnit!=='cm')return text;
    if(targetUnit==='cm'&&sourceUnit==='cm')return text.replace(/\d+(?:\.\d+)?/g,v=>String(Math.round(Number(v))));
    const multiplier=targetUnit==='cm'?2.54:1/2.54;
    return text.replace(/\d+(?:\.\d+)?/g,v=>targetUnit==='cm'?String(Math.round(Number(v)*multiplier)):String(Number((Number(v)*multiplier).toFixed(1))));
  }
  const api={interval,dimension,fields,estimate,labels,supportLabels,convertChartValue,describeOutcome};
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
      support_level:hasBar(chart)?chart.supportLevel:null,
      support_type:hasBar(chart)?barKind(chart).toLowerCase():null};
    try{global.Shopify?.analytics?.publish?.('birdeye_size_studio:'+event,payload)}catch(_err){/* privacy/analytics failure never breaks sizing */}
  }
  // V12.1.2: lock the entire storefront document, not just body overflow.
  // Capture values before the legacy PDP controller mutates them, then restore
  // exactly those inline values on close (including theme Quick View locks).
  let scrollLock = null;
  let pendingPreOpen = null;
  let dismissGuardUntil = 0;
  const lockProps = {
    html: ['overflow', 'overscroll-behavior'],
    body: ['position', 'top', 'left', 'right', 'width', 'overflow', 'overscroll-behavior']
  };
  const snapshotStyle = (el, names) => names.map(name => ({
    name, value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name)
  }));
  function capturePreOpen() {
    if (scrollLock || pendingPreOpen) return;
    pendingPreOpen = {
      y: global.scrollY || doc.documentElement.scrollTop || 0,
      html: snapshotStyle(doc.documentElement, lockProps.html),
      body: snapshotStyle(doc.body, lockProps.body)
    };
  }
  function restoreStyles(el, props) {
    for (const prop of props) {
      if (prop.value) el.style.setProperty(prop.name, prop.value, prop.priority);
      else el.style.removeProperty(prop.name);
    }
  }
  function lockBackground() {
    if (scrollLock) return;
    const initial = pendingPreOpen || {
      y: global.scrollY || doc.documentElement.scrollTop || 0,
      html: snapshotStyle(doc.documentElement, lockProps.html),
      body: snapshotStyle(doc.body, lockProps.body)
    };
    pendingPreOpen = null;
    scrollLock = initial;
    doc.documentElement.style.setProperty('overflow', 'hidden', 'important');
    doc.documentElement.style.setProperty('overscroll-behavior', 'none', 'important');
    const body = doc.body.style;
    body.setProperty('position', 'fixed', 'important');
    body.setProperty('top', `-${initial.y}px`, 'important');
    body.setProperty('left', '0', 'important');
    body.setProperty('right', '0', 'important');
    body.setProperty('width', '100%', 'important');
    body.setProperty('overflow', 'hidden', 'important');
    body.setProperty('overscroll-behavior', 'none', 'important');
    doc.documentElement.classList.add('bss-v12-scroll-locked');
  }
  function unlockBackground() {
    if (!scrollLock) { pendingPreOpen = null; return; }
    const initial = scrollLock;
    scrollLock = null;
    doc.documentElement.classList.remove('bss-v12-scroll-locked');
    restoreStyles(doc.body, initial.body);
    restoreStyles(doc.documentElement, initial.html);
    // Restore the scroll offset after releasing fixed positioning.
    if (Math.abs((global.scrollY || 0) - initial.y) > 1) global.scrollTo(0, initial.y);
  }
  function anyVisibleSizeGuide() {
    return Array.from(doc.querySelectorAll('[data-bss-layer].bss-v12-enhanced'))
      .some(layer => layer.isConnected && !layer.hidden);
  }
  function syncBackgroundScroll() {
    if (anyVisibleSizeGuide()) lockBackground();
    else unlockBackground();
  }
  // Avoid theme-level, nested scrollbar, wheel and mobile touch leakage.
  // The Size Studio modal intentionally fits within one viewport; no internal
  // scrolling is needed for ordinary supported product charts.
  function preventBackgroundMotion(event) {
    if (anyVisibleSizeGuide() && event.cancelable) event.preventDefault();
  }
  global.addEventListener('wheel', preventBackgroundMotion, { capture: true, passive: false });
  global.addEventListener('touchmove', preventBackgroundMotion, { capture: true, passive: false });
  doc.addEventListener('keydown', event => {
    if (!anyVisibleSizeGuide()) return;
    if (!['PageDown','PageUp','Home','End','ArrowDown','ArrowUp',' '].includes(event.key)) return;
    if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (event.cancelable) event.preventDefault();
  }, true);
  // The legacy PDP handler owns the close operation. Run our guard after its
  // listener on the same layer, and suppress click bubbling to theme handlers.
  function guardClose(layer) {
    if (layer.dataset.bssV12CloseGuard === 'true') return;
    layer.dataset.bssV12CloseGuard = 'true';
    layer.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (!target?.closest('[data-bss-close], .bss__close, .bss__scrim')) return;
      dismissGuardUntil = Date.now() + 350;
      event.preventDefault();
      event.stopPropagation();
      // Legacy close may move the layer back under its app block synchronously.
      queueMicrotask(syncBackgroundScroll);
    });
  }
  function supportBar(chart) {
    if(!hasBar(chart))return null;
    const rating=chart.supportLevel,kind=barKind(chart);
    const section=create('section','bss-v12-support');
    section.append(create('h3','bss-v12-subtitle',kind));
    const track=create('div','bss-v12-support-track');track.setAttribute('role','img');
    track.setAttribute('aria-label',`${kind}: ${rating} of 5`);
    for(let i=1;i<=5;i++)track.append(create('span',i===rating?'is-selected':''));
    section.append(track);
    const captions=create('div','bss-v12-track-labels');
    for(const text of [`LOW ${kind.toUpperCase()}`,`MID ${kind.toUpperCase()}`,`HIGH ${kind.toUpperCase()}`])captions.append(create('span','',text));
    section.append(captions);return section;
  }
  function fitBar(chart) {
    const rating=chart?.fitScale;
    if(!Number.isInteger(rating)||rating<1||rating>5)return null;
    const wrapper=create('section','bss-v12-compact-fit');
    const title=create('div','bss-v12-info-title');
    title.append(create('span','','Fit'),create('span','bss-v12-info-value',labels[rating-1]));wrapper.append(title);
    const track=create('div','bss__fit-track');track.setAttribute('role','img');
    track.setAttribute('aria-label',`Fit: ${labels[rating-1]}`);
    for(let i=1;i<=5;i++)track.append(create('span',i===rating?'bss__fit-segment is-active':'bss__fit-segment'));
    wrapper.append(track);
    const captions=create('div','bss__fit-labels');
    for(const text of ['Runs Small','True to Size','Runs Large'])captions.append(create('span','',text));
    wrapper.append(captions);return wrapper;
  }
  function compactSupportBar(chart) {
    if(!hasBar(chart))return null;
    const rating=chart.supportLevel,kind=barKind(chart);
    const wrapper=create('section','bss-v12-compact-support');
    const title=create('div','bss-v12-info-title');
    title.append(create('span','',kind),create('span','bss-v12-info-value',`${rating} / 5`));wrapper.append(title);
    const track=create('div','bss-v12-support-track');track.setAttribute('role','img');
    track.setAttribute('aria-label',`${kind}: ${rating} of 5`);
    for(let i=1;i<=5;i++)track.append(create('span',i===rating?'is-selected':''));
    wrapper.append(track);
    const captions=create('div','bss-v12-track-labels');
    for(const text of [`LOW ${kind.toUpperCase()}`,`MID ${kind.toUpperCase()}`,`HIGH ${kind.toUpperCase()}`])captions.append(create('span','',text));
    wrapper.append(captions);return wrapper;
  }
  function renderCalculator(chart,root,unit,onChart) {
    const section=create('section','bss-v12-calculator');
    section.setAttribute('aria-label','Find My Size');
    const content=create('div','bss-v12-calculator-grid');
    const figure=create('div','bss-v12-image');
    const imageURL=chart?.measurementImageUrl || root?.dataset.bssImage || settings()?.dataset.bssImage || '';
    if(imageURL && /^(https?:\/\/|\/\/|\/)/.test(imageURL)) {
      const img=create('img');img.src=imageURL;img.alt='Model showing where to take body measurements';img.loading='lazy';figure.append(img);
    }else {figure.hidden=true;content.classList.add('bss-v12-no-image');}
    const form=create('form','bss-v12-form');form.noValidate=true;
    const header=create('div','bss-v12-calculator-head');
    header.append(create('h3','','Add your measurements'));
    const approved=chart?.recommendationBasis==='body';
    form.append(header);
    const selectedUnit=create('div','bss-v12-unit-choice');
    selectedUnit.setAttribute('role','group');selectedUnit.setAttribute('aria-label','Measurement units');
    let measureUnit=unit==='cm'?'cm':'in';
    const measurements={};
    function repaintUnits(){for(const btn of selectedUnit.querySelectorAll('button')) {
      const selected=btn.dataset.unit===measureUnit;
      btn.classList.toggle('is-selected',selected);btn.setAttribute('aria-pressed',String(selected));
    }}
    for(const name of ['in','cm']) {
      const b=create('button','',name.toUpperCase());b.type='button';b.dataset.unit=name;
      b.addEventListener('click',()=>{
        if(measureUnit===name)return;
        for(const field of Object.values(measurements)){
          if(field.value){const v=Number(field.value);
            if(Number.isFinite(v))field.value=name==='cm'?String(Math.round(v*2.54)):String(Number((v/2.54).toFixed(1)));
          }
        }
        measureUnit=name;repaintUnits();result.replaceChildren();
        for(const el of form.querySelectorAll('.bss-v12-unit'))el.textContent=measureUnit.toUpperCase();
      });
      selectedUnit.append(b);
    }
    repaintUnits();form.append(selectedUnit);
    // Fit and Support/Compression are visible in Size Chart mode. Keep the
    // reference-led measurement form uncluttered, and the result text-only.
    const dims=fields(chart);
    const result=create('div','bss-v12-result');result.setAttribute('aria-live','polite');
    if(approved&&dims.length){
      const inputArea=create('div','bss-v12-inputs');
      for(const dim of dims){
        const wrapper=create('label','bss-v12-field');wrapper.append(create('span','',dim.label));
        const input=create('input');input.type='number';input.min='1';input.max='300';input.step='any';
        input.inputMode='decimal';input.autocomplete='off';input.placeholder='Enter measurement';
        input.setAttribute('aria-label',dim.label);input.addEventListener('input',()=>result.replaceChildren());measurements[dim.key]=input;
        wrapper.append(input,create('span','bss-v12-unit',measureUnit.toUpperCase()));inputArea.append(wrapper);
      }
      form.append(inputArea);
    }
    // The result occupies the visual gap between inputs and the single CTA.
    // No How to Measure or duplicate Size Chart buttons; the chart-level image
    // is the measurement illustration and the centered top switch handles views.
    form.append(result);
    const actions=create('div','bss-v12-actions');
    const submitRow=create('div','bss-v12-primary-row');
    if(approved&&dims.length){
      const btn=create('button','bss-v12-submit','Calculate my size');btn.type='submit';
      submitRow.append(btn);
    }
    actions.append(submitRow);form.append(actions);
    if(!approved){
      const note=create('p','bss-v12-caution','Size recommendations are being verified for this style.');
      form.append(note);
    }else if(!dims.length){
      form.append(create('p','bss-v12-caution','This chart does not yet have usable body measurements.'));
    }
    form.addEventListener('submit',e=>{
      e.preventDefault();if(!approved||!dims.length)return;
      result.replaceChildren();
      const entered=Object.fromEntries(Object.entries(measurements).map(([key,input])=>[key,input.value]));
      const outcome=estimate(chart,entered,measureUnit);
      if(outcome.type==='incomplete'||outcome.type==='invalid'){
        result.append(create('p','bss-v12-caution','Please enter valid measurements in every field.'));
        measurements[outcome.missing||outcome.field]?.focus();return;
      }
      if(outcome.size){
        // One elegant result line. Keep inputs visible so the customer can edit
        // and recalculate without an extra screen or edit button.
        const line=create('p','bss-v12-best-match');
        line.append(
          create('span','bss-v12-best-match-label','Your Best Size Match: '),
          create('strong','bss-v12-best-match-value',outcome.size)
        );
        result.append(line);
        emit('recommendation_generated',root,chart,outcome);
      }else{
        result.append(create('p','bss-v12-caution',outcome.reason||'Please review your measurements.'));
      }
    });
    content.append(figure,form);section.append(content);return section;
  }
  function applyView(layer,mode,focus=true){
    const content=layer.querySelector('[data-bss-content]');if(!content)return;
    const view=mode==='chart'?'chart':'calculator';
    layer.dataset.bssV12View=view;layer.classList.add('bss-v12-enhanced');
    guardClose(layer);
    const calculator=content.querySelector('.bss-v12-calculator');
    const table=content.querySelector('.bss__table-scroll');
    const originalUnits=content.querySelector('.bss__units-row');
    const legacyFit=content.querySelector('.bss__fit-scale');
    const legacySupport=content.querySelector('.bss-v12-support');
    const navigation=content.querySelector('.bss-v12-chart-navigation');
    for(const el of [calculator,table,originalUnits,legacyFit,legacySupport]){
      if(!el)continue;
      const isChartPart=el!==calculator;
      el.hidden=isChartPart?view!=='chart':view!=='calculator';
    }
    if(navigation){for(const b of navigation.querySelectorAll('[data-bss-view-tab]')){const selected=b.dataset.bssViewTab===view;b.classList.toggle('is-active',selected);b.setAttribute('aria-selected',String(selected));}}
    if(focus){
      const panel=layer.querySelector('.bss__panel');if(panel)panel.scrollTop=0;
      if(view==='chart')navigation?.querySelector('[data-bss-view-tab=chart]')?.focus();
      else (calculator?.querySelector('input')||calculator?.querySelector('.bss-v12-unit-choice button')||calculator?.querySelector('button'))?.focus();
    }
  }
  function enhanceLayer(layer,root,chart){
    const content=layer.querySelector('[data-bss-content]');if(!content)return false;
    // Critical: eligibility can be unverified/garment. In that case there is no
    // calculator node, so using its presence as an init marker makes every
    // MutationObserver pass prepend another heading indefinitely.
    // Claim the exact content node *before* inserting any DOM elements.
    if(content.dataset.bssV12Initialized==='true' && content.querySelector('.bss-v12-chart-navigation'))return false;
    const table=content.querySelector('.bss__table-scroll');if(!table)return false;
    content.dataset.bssV12Initialized='true';
    const bar=supportBar(chart);if(bar)table.before(bar);
    const unit=content.querySelector('[data-bss-unit].is-selected')?.dataset.bssUnit||'in';
    const navigation=create('div','bss-v12-chart-navigation');
    const tabs=create('div','bss-v12-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Size guide views');
    const canRecommend=chart.recommendationBasis==='body' && fields(chart).length>0;
    for(const [mode,label] of [['chart','Size Chart'],['calculator','Find My Size']]){
      const tab=create('button','bss-v12-tab',label);tab.type='button';tab.dataset.bssViewTab=mode;
      tab.setAttribute('role','tab');
      if(mode==='calculator'&&!canRecommend){tab.disabled=true;tab.title='Size recommendations are being verified for this style';}
      else tab.addEventListener('click',()=>applyView(layer,mode));
      tabs.append(tab);
    }
    navigation.append(tabs);
    content.prepend(navigation);
    if(canRecommend){
      const calculator=renderCalculator(chart,root,unit,()=>applyView(layer,'chart'));
      table.before(calculator);
    }
    // Size chart ALWAYS opens first; approved customers can opt into the calculator.
    applyView(layer,layer.dataset.bssV12View||'chart',false);
    emit('guide_opened',root,chart);
    return true;
  }
  // Enhance legacy PDP size-guide modal without changing any of its existing chart/table handling.
  const layerOwner=new WeakMap();
  // Legacy PDP chart table is rendered by the V10 embed, which otherwise shows
  // one decimal for CM. Repaint only changed *measurement cells* from the
  // original chart data, leaving headers/sizes intact and avoiding DOM loops.
  function roundPdpTable(layer,chart){
    const content=layer.querySelector('[data-bss-content]');
    const table=content?.querySelector('.bss__table-scroll table');
    const selected=content?.querySelector('.bss__units button.is-selected,[data-bss-unit].is-selected')?.dataset?.bssUnit;
    if(!table||selected!=='cm'||!Array.isArray(chart?.rows))return;
    const rows=table.querySelectorAll('tbody tr');
    if(rows.length!==chart.rows.length)return;
    for(let r=0;r<rows.length;r++){
      const cells=rows[r].querySelectorAll('td');
      for(let i=0;i<cells.length;i++){
        const target=convertChartValue(chart.rows[r][i+1],chart.unit==='cm'?'cm':'in','cm');
        if(cells[i].textContent!==target)cells[i].textContent=target;
      }
    }
  }
  function scanLayers(){
    for(const root of doc.querySelectorAll('[data-bss-v9-root]')){
      const layer=root.querySelector('[data-bss-layer]');if(layer)layerOwner.set(layer,root);
    }
    for(const layer of doc.querySelectorAll('[data-bss-layer]')){
      if(layer.hidden){delete layer.dataset.bssV12View;continue;}
      const content=layer.querySelector('[data-bss-content]');
      // Idempotent for approved AND unapproved charts. A newly rebuilt
      // content node is independently eligible for a fresh enhancement.
      if(!content)continue;
      if(content.dataset.bssV12Initialized==='true' && content.querySelector('.bss-v12-chart-navigation')){const owner=layerOwner.get(layer)||layer.closest('.bss-v12-quick-root');const chart=owner&&readChart(owner);if(chart)roundPdpTable(layer,chart);continue;}
      const root=layerOwner.get(layer)||layer.closest('.bss-v12-quick-root')||doc.querySelector('[data-bss-v9-root]');
      if(!root)continue;
      const chart=readChart(root);
      if(!chart||!Array.isArray(chart.rows))continue;
      enhanceLayer(layer,root,chart);roundPdpTable(layer,chart);
    }
  }
  // Reuse the actual chart JSON already rendered on the product page by the
  // existing Size Studio Liquid app block. No app proxy or Render/Neon request.
  // A product page is fetched only when its quick-view size guide is opened.
  const QUICKVIEWS='quick-add-modal,.quick-add-modal,[data-quick-view],[data-quickview],.quick-view,.quickview,.quickview-modal,.quick-shop,.quickshop,[id*="QuickView"],[id*="Quickview"],[id*="quick-view"],[id*="quickview"],[class*="quick-view"],[class*="quickview"]';
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
    // A main-product handle on the drawer itself has highest priority.
    for(const value of [container.dataset?.productHandle,container.dataset?.handle]){
      if(VALID_HANDLE.test(value||''))return value;
    }
    const own=fromURL(container.dataset?.productUrl);
    if(own)return own;
    // Primary "View full details" link, never a matching-set cross-sell.
    for(const link of container.querySelectorAll('a[href*="/products/"]')){
      if(/view\s*(?:full\s*)?(?:details|product)|product\s*details/i.test(link.textContent?.trim()||'') ||
         link.matches('[data-product-details-link],.quick-view__view-details,.quickview__view-details,.product__view-details')){
        const handle=fromURL(link.getAttribute('href'));
        if(handle)return handle;
      }
    }
    for(const link of container.querySelectorAll('.product__title a[href*="/products/"],.product-title a[href*="/products/"],[data-product-title] a[href*="/products/"],.qv-product-title a[href*="/products/"]')){
      const handle=fromURL(link.getAttribute('href'));
      if(handle)return handle;
    }
    // Nested data handles are only trusted if unique; they may be related products.
    const options=new Set();
    for(const context of Array.from(container.querySelectorAll('[data-product-handle],[data-handle],[data-product-url]')).slice(0,30)){
      for(const value of [context.dataset?.productHandle,context.dataset?.handle]){
        if(VALID_HANDLE.test(value||''))options.add(value);
      }
      const url=fromURL(context.dataset?.productUrl);
      if(url)options.add(url);
    }
    if(options.size===1)return [...options][0];
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
      if(panel.closest('[data-bss-layer]')||panel.parentElement?.closest(QUICKVIEWS))continue;
      const slot=locateSizeRow(panel);if(!slot)continue;
      const handle=handleFrom(panel);
      let trigger=panel.querySelector('[data-bss-v12-quick-trigger]');
      if(trigger){
        if(!handle){trigger.remove();panel.removeAttribute('data-bss-v12-owns-quickview');continue;}
        if(handle!==trigger.dataset.bssProductHandle)trigger.dataset.bssProductHandle=handle;
        panel.setAttribute('data-bss-v12-owns-quickview','true');
        continue;
      }
      if(!handle)continue; // No reliable product context => no incorrect chart.
      trigger=create('button','bss-v12-quick-trigger','Find Your Perfect Fit');
      trigger.type='button';trigger.dataset.bssV12QuickTrigger='true';
      trigger.dataset.bssProductHandle=handle;
      trigger.setAttribute('aria-haspopup','dialog');
      panel.setAttribute('data-bss-v12-owns-quickview','true');
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
    const timeout=setTimeout(()=>controller.abort(),8000);
    let html;
    try{
      const response=await fetch(url.toString(),{credentials:'same-origin',headers:{Accept:'text/html'},signal:controller.signal});
      if(!response.ok||new URL(response.url).origin!==location.origin)throw Error('Product page unavailable');
      const size=Number(response.headers.get('content-length')||0);
      if(size>8*1024*1024)throw Error('Product page exceeds safe read size');
      html=await response.text();
      if(html.length>8*1024*1024)throw Error('Product page exceeds safe read size');
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
  function reportQuickviewError(button,handle){
    const row=button.parentElement||button;
    row.querySelector('.bss-v12-quick-error')?.remove();
    const notice=create('span','bss-v12-quick-error');notice.setAttribute('role','status');
    notice.append('Size guide unavailable here. ');
    if(handle&&VALID_HANDLE.test(handle)){
      const link=create('a','','Open product page');
      link.href=(global.Shopify?.routes?.root||'/').replace(/\/?$/,'/')+'products/'+handle;
      notice.append(link);
    }
    row.append(notice);
  }
  async function quickviewClick(button,explicitHandle){
    if(button.disabled)return;
    // Re-read the active main product at click time, never a matching-set item.
    const drawer=button.closest(QUICKVIEWS);
    const current=handleFrom(drawer);
    const handle=current||explicitHandle||button.dataset.bssProductHandle;
    if(!handle||!VALID_HANDLE.test(handle)){reportQuickviewError(button,null);return;}
    button.disabled=true;
    button.setAttribute('aria-busy','true');
    try{
      const data=await loadStorefrontChart(handle);
      if(!button.isConnected)return;
      const now=handleFrom(button.closest(QUICKVIEWS));
      if(now&&now!==handle)return;
      rowErrorClear(button);
      popup(data,button);
    }catch(err){
      // A missing PDP app block or network failure must never be a silent click.
      console.warn('[Size Studio] Quick View chart unavailable:',err?.message||'lookup failed');
      reportQuickviewError(button,handle);
    }finally{button.disabled=false;button.removeAttribute('aria-busy')}
  }
  function rowErrorClear(button){button.parentElement?.querySelector('.bss-v12-quick-error')?.remove()}
  function popup(data,opener){
    capturePreOpen();
    const root=create('div','bss bss-v12-quick-root');
    root.dataset.bssHandle=data.chartHandle||'';root.dataset.bssProductId=data.productId||'';
    root.dataset.bssProductHandle=data.handle||'';root.dataset.bssQuickView='true';
    const layer=create('div','bss__layer');layer.dataset.bssMode='modal';layer.setAttribute('data-bss-layer','');
    const scrim=create('div','bss__scrim');
    const panel=create('section','bss__panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.tabIndex=-1;
    const head=create('div','bss__head');
    const title=create('h2','bss__heading',data.title||'Size guide');title.id='bss-v12-quick-title-'+Math.random().toString(36).slice(2);
    panel.setAttribute('aria-labelledby',title.id);head.append(title);
    const close=create('button','bss__close','×');close.type='button';close.setAttribute('aria-label','Close size guide');head.append(close);
    const content=create('div','bss__content');content.setAttribute('data-bss-content','');
    const unitRow=create('div','bss__units-row'),units=create('div','bss__units');
    units.setAttribute('role','group');units.setAttribute('aria-label','Size chart units');
    const chartContent=create('div');let selected='in';
    function paintTable(){
      chartContent.replaceChildren();const table=create('table','bss__table');const tr=create('tr');
      for(const label of data.chart.columns)tr.append(create('th','',label));
      const thead=create('thead');thead.append(tr);table.append(thead);
      const tbody=create('tbody');
      for(const values of data.chart.rows){
        const row=create('tr');values.forEach((v,i)=>{
          let shown=String(v??'');
          if(i)shown=convertChartValue(v,data.chart.unit==='cm'?'cm':'in',selected);
          row.append(create(i?'td':'th','',shown));
        });tbody.append(row);
      }
      table.append(tbody);chartContent.append(table);
    }
    for(const u of ['in','cm']){
      const b=create('button',u===selected?'is-selected':'',u.toUpperCase());b.type='button';b.dataset.bssUnit=u;
      b.setAttribute('aria-pressed',String(u===selected));
      b.addEventListener('click',()=>{
        selected=u;
        for(const button of units.querySelectorAll('button')){
          button.classList.toggle('is-selected',button.dataset.bssUnit===u);
          button.setAttribute('aria-pressed',String(button.dataset.bssUnit===u));
        }
        paintTable();
      });units.append(b);
    }
    unitRow.append(units);content.append(unitRow);
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
    const scroller=create('div','bss__table-scroll');scroller.append(chartContent);paintTable();content.append(scroller);
    panel.append(head,content);layer.append(scrim,panel);root.append(layer);doc.body.append(root);
    enhanceLayer(layer,root,data.chart);
    const prev=doc.activeElement;const overflow=doc.body.style.overflow;
    doc.body.style.overflow='hidden';syncBackgroundScroll();panel.focus();
    function dismiss(){doc.removeEventListener('keydown',keys,true);root.remove();doc.body.style.overflow=overflow;syncBackgroundScroll();(prev?.isConnected?prev:opener)?.focus()}
    function keys(e){
      if(e.key==='Escape'){e.preventDefault();dismiss();return;}
      if(e.key!=='Tab')return;
      const els=[...panel.querySelectorAll('button:not([disabled]), input:not([disabled])')].filter(x=>x.getClientRects().length);
      if(els.length){const a=els[0],z=els[els.length-1];
        if(e.shiftKey&&doc.activeElement===a){e.preventDefault();z.focus();}
        else if(!e.shiftKey&&doc.activeElement===z){e.preventDefault();a.focus();}
      }
    }
    scrim.addEventListener('click',dismiss);close.addEventListener('click',dismiss);doc.addEventListener('keydown',keys,true);
  }
  let raf=0;
  function scan(){scanLayers();scanQuickviews();syncBackgroundScroll()}
  function schedule(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;scan()})}
  // The V10 PDP script listens for .bss-v9-trigger on document capture.
  // An earlier window-capture handler can prevent it from incorrectly opening
  // a PDP chart when a legacy Quick View trigger is clicked.
  global.addEventListener('click',e=>{
    const element = e.target instanceof Element ? e.target : e.target?.parentElement;
    const clickClose = element?.closest?.('[data-bss-close],.bss__close,.bss__scrim');
    if (clickClose?.closest('[data-bss-layer].bss-v12-enhanced')) {
      dismissGuardUntil = Date.now() + 350;
      queueMicrotask(syncBackgroundScroll);
      return; // Preserve legacy PDP and Quick View close handlers.
    }
    const el=e.target?.closest?.('[data-bss-v12-quick-trigger],.bss-v9-trigger');
    if(!el)return;
    if (Date.now() < dismissGuardUntil) {
      e.preventDefault();e.stopImmediatePropagation();return;
    }
    const drawer=el.closest(QUICKVIEWS);
    if (!drawer) { capturePreOpen(); setTimeout(syncBackgroundScroll, 0); }
    if(!drawer && !el.matches('[data-bss-v12-quick-trigger]'))return;
    // Never hijack the normal product-page Size Studio link.
    if(!drawer)return;
    const handle=handleFrom(drawer)||el.dataset.bssProductHandle;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    quickviewClick(el,handle);
  },true);
  doc.addEventListener('click',e=>{
    const el=e.target?.closest?.('[data-bss-v12-quick-trigger]');
    if(!el)return;
    if(Date.now()<dismissGuardUntil){e.preventDefault();e.stopImmediatePropagation();return;}
    e.preventDefault();e.stopPropagation();quickviewClick(el);
  },true);
  function init(){scan();const observer=new MutationObserver(records=>{if(records.some(r=>r.addedNodes.length||r.removedNodes.length||r.attributeName==='hidden'))schedule()});observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});doc.addEventListener('shopify:section:load',schedule)}
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window!=='undefined'?window:globalThis);
