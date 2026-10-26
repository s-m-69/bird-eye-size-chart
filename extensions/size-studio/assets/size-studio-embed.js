/* BirdEye Size Studio V10.1 | App-only design refinement; no edits to merchant theme. */
(() => {
  'use strict';
  if (window.__BSS_V9_INITIALIZED__) return;
  window.__BSS_V9_INITIALIZED__ = true;
  const root = document.querySelector('[data-bss-v9-root]');
  if (!root) return;
  const layer = root.querySelector('[data-bss-layer]');
  const panel = layer?.querySelector('.bss__panel');
  const content = layer?.querySelector('[data-bss-content]');
  if (!layer || !panel || !content) return;
  let chart;
  try { chart = JSON.parse(root.dataset.bssJson || '{}'); }
  catch (_error) { return; }
  if (typeof chart === 'string') { try { chart = JSON.parse(chart); } catch (_error) { return; } }
  if (!chart || !Array.isArray(chart.columns) || chart.columns.length < 2 || !Array.isArray(chart.rows) || !chart.rows.length) return;
  let unit = chart.unit === 'in' ? 'in' : 'cm';
  let isOpen = false, previousFocus = null, opener = null, savedOverflow = '';
  const hideKiwi = root.dataset.bssHideKiwi === 'true';
  const make = (tag, cls, value) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (value !== undefined) el.textContent = String(value);
    return el;
  };
  function suppressKiwi(sizeRow) {
    if (!hideKiwi) return;
    for (const element of sizeRow.querySelectorAll('.ks-chart-container, .ks-chart-modal-link')) {
      if (element.closest('.bss-v9-trigger')) continue;
      if (element.matches('.ks-chart-container') && element.parentElement !== sizeRow) continue;
      if (element.style.getPropertyValue('display') !== 'none' || element.style.getPropertyPriority('display') !== 'important') {
        element.style.setProperty('display', 'none', 'important');
      }
      if (element.getAttribute('aria-hidden') !== 'true') element.setAttribute('aria-hidden', 'true');
    }
  }
  // Preserve exactly the same physical injection point as Kiwi's "Inject before / Class / perfect_fit".
  function syncAnchors() {
    if (isOpen) return;
    const anchors = [...document.querySelectorAll('.product__info-wrapper .size_select > .perfect_fit')];
    for (const anchor of anchors) {
      const row = anchor.parentElement;
      if (!row) continue;
      // The app belongs to this product page; never create controls in quick-add overlays.
      if (row.closest('quick-add-modal, .quick-add-modal, [data-quick-view]')) continue;
      const nearby = [...row.querySelectorAll(':scope > .bss-v9-trigger')];
      let trigger = nearby[0];
      for (const duplicate of nearby.slice(1)) duplicate.remove();
      if (!trigger) {
        trigger = make('button','bss-v9-trigger',root.dataset.bssButtonLabel || 'Find Your Perfect Fit');
        trigger.type = 'button';
        trigger.dataset.bssHideKiwi = String(hideKiwi);
        trigger.setAttribute('aria-haspopup','dialog');
        trigger.setAttribute('aria-expanded','false');
        trigger.setAttribute('aria-controls',panel.querySelector('.bss__heading')?.id || '');
        anchor.before(trigger);
      }
      trigger.style.setProperty('--bss-v9-link',root.style.getPropertyValue('--bss-trigger-color') || '#016066');
      suppressKiwi(row);
    }
  }
  const factorValue = (raw, from, to) => {
    const source = String(raw ?? '');
    if (from === to) return source;
    // Inches are the source of truth. CM is displayed as WHOLE numbers, like Kiwi.
    // Preserve the original inch text exactly; convert every bound of a range independently.
    return source.replace(/\d+(?:\.\d+)?/g, value => {
      const number = Number(value);
      if (!Number.isFinite(number)) return value;
      if (from === 'in' && to === 'cm') return String(Math.round(number * 2.54));
      // Legacy cm-authored charts, if any, can still display one-decimal inches.
      return String(Number((number / 2.54).toFixed(1)));
    });
  };
  function paint(focusUnit = false) {
    content.replaceChildren();
    const unitsRow = make('div','bss__units-row');
    const units = make('div','bss__units');
    units.setAttribute('role','group'); units.setAttribute('aria-label','Measurement units');
    for (const choice of ['cm','in']) {
      const button = make('button',choice === unit ? 'is-selected' : '',choice.toUpperCase());
      button.type = 'button'; button.setAttribute('aria-pressed',String(choice === unit));
      button.setAttribute('aria-label',choice === 'cm' ? 'Show centimetres' : 'Show inches');
      button.dataset.bssUnit = choice;
      button.addEventListener('click',() => {unit=choice;paint(true);});
      if (units.childElementCount) units.appendChild(make('span','bss__unit-separator','|'));
      units.appendChild(button);
    }
    unitsRow.appendChild(units);content.appendChild(unitsRow);
    // BSS_V11_3_2_SIMPLE_FIT_SCALE — product/fit information only, never a size recommendation.
    // Older charts have no rating and therefore show nothing here.
    const fitRating = Number(chart.fitScale);
    if (chart.fitScale !== undefined && Number.isInteger(fitRating) && fitRating >= 1 && fitRating <= 5) {
      const fitDescriptions = ['Runs small','Runs slightly small','True to size','Runs slightly large','Runs large'];
      const scale = make('div', 'bss__fit-scale');
      scale.setAttribute('role', 'img');
      scale.setAttribute('aria-label', `Fit rating ${fitRating} of 5: ${fitDescriptions[fitRating - 1]}`);
      const track = make('div', 'bss__fit-track');
      track.setAttribute('aria-hidden', 'true');
      for (let i=1; i<=5; i++) track.appendChild(make('span', i===fitRating ? 'bss__fit-segment is-active' : 'bss__fit-segment'));
      scale.appendChild(track);
      const labels = make('div', 'bss__fit-labels');
      labels.setAttribute('aria-hidden','true');
      for (const caption of ['Runs Small','True to Size','Runs Large']) labels.appendChild(make('span','',caption));
      scale.appendChild(labels);
      content.appendChild(scale);
    }
    const scroller = make('div','bss__table-scroll');
    scroller.setAttribute('role','region');scroller.setAttribute('aria-label','Size measurements');scroller.tabIndex=0;
    const table = make('table','bss__table');
    table.style.minWidth = Math.max(320, chart.columns.length * 110) + 'px';
    const thead=make('thead');const header=make('tr');
    for (let i=0;i<chart.columns.length;i++) {
      const th=make('th','',String(chart.columns[i]));th.scope='col';header.appendChild(th);
    }
    thead.appendChild(header);table.appendChild(thead);
    const tbody=make('tbody');
    for (const row of chart.rows) {
      if (!Array.isArray(row)) continue;
      const tr=make('tr');
      for (let i=0;i<chart.columns.length;i++) {
        const cell=make(i?'td':'th','',i?factorValue(row[i],chart.unit || 'cm',unit):String(row[i]??''));
        if (!i) cell.scope='row';tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);scroller.appendChild(table);content.appendChild(scroller);
    if (focusUnit) units.querySelector(`[data-bss-unit="${unit}"]`)?.focus();
  }
  const vars=['--bss-panel-bg','--bss-text','--bss-muted','--bss-accent','--bss-table-head','--bss-separator','--bss-trigger-color','--bss-radius','--bss-space','--bss-modal-width','--bss-overlay-opacity'];
  function open(trigger) {
    if (isOpen) return;
    isOpen=true;opener=trigger;previousFocus=document.activeElement;
    paint();const comp=getComputedStyle(root);
    for (const name of vars) {
      const value=comp.getPropertyValue(name).trim();
      if (value)layer.style.setProperty(name,value);
    }
    const themeHeading = document.querySelector('.product__title h1, .product__title, .product__info-wrapper h1');
    layer.style.setProperty('--bss-heading-font', getComputedStyle(themeHeading || document.body).fontFamily);
    layer.style.setProperty('--bss-body-font', getComputedStyle(document.body).fontFamily);
    layer.dataset.bssMode=root.dataset.bssMode==='drawer'?'drawer':'modal';
    document.body.appendChild(layer);layer.hidden=false;
    opener?.setAttribute('aria-expanded','true');
    savedOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    document.addEventListener('keydown',onKeydown,true);
    // Focus the dialog surface first, so mouse/touch openings keep the unobtrusive close icon clean.
    // Tab proceeds to the close button; Shift+Tab wraps to the final control.
    panel.focus();
  }
  function close() {
    if (!isOpen) return;
    isOpen=false;layer.hidden=true;
    opener?.setAttribute('aria-expanded','false');
    document.body.style.overflow=savedOverflow;
    document.removeEventListener('keydown',onKeydown,true);
    root.appendChild(layer);
    if (previousFocus?.isConnected) previousFocus.focus();
    // Picker DOM may have re-rendered while the panel was open.
    syncAnchors();
  }
  function onKeydown(event) {
    if (!isOpen) return;
    if (event.key==='Escape') {event.preventDefault();close();return;}
    if (event.key!=='Tab') return;
    const controls=[...panel.querySelectorAll('button:not([disabled]), [href], [tabindex="0"]')].filter(el=>el.getClientRects().length);
    if (!controls.length) {event.preventDefault();panel.focus();return;}
    const first=controls[0],last=controls[controls.length-1];
    if (event.shiftKey && (document.activeElement===first || document.activeElement===panel)) {event.preventDefault();last.focus();}
    else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
  }
  layer.addEventListener('click', e => {if(e.target.closest('[data-bss-close]'))close();});
  document.addEventListener('click', e=> {
    const trigger=e.target instanceof Element ? e.target.closest('.bss-v9-trigger') : null;
    if (!trigger) return;
    e.preventDefault(); e.stopPropagation();
    if (isOpen)close();else open(trigger);
  },true);
  let pending=false;
  function scheduleSync() {
    if (pending || isOpen) return;
    pending=true;
    requestAnimationFrame(()=>{pending=false;syncAnchors();});
  }
  // Shopify variant-picker and Kiwi can re-render or inject nodes dynamically.
  // Observe child-list changes and Kiwi styling updates, but only on our product's size row.
  const observer=new MutationObserver(records=>{
    if (records.some(rec=>rec.type==='childList' || (rec.type==='attributes' && rec.target?.classList?.contains('ks-chart-container'))))scheduleSync();
  });
  function initialize(){
    syncAnchors();
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style']});
  }
  if (document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else initialize();
  document.addEventListener('shopify:section:load',scheduleSync);
})();
