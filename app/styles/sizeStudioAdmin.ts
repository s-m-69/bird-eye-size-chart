/**
 * BirdEye Size Studio V11.2 admin design tokens.
 * One local stylesheet, scoped to the app route. No shadow cards or gradients.
 * The React Router route injects this sheet so the app requires no CSS pipeline changes.
 */
export const adminStyles = String.raw`
.bs-v11-root {
  --bss-ink: #0a3442;
  --bss-type: #152d35;
  --bss-muted: #364b54;
  --bss-rule: #c7d1d3;
  --bss-faint: #e4e9e9;
  --bss-paper: #ffffff;
  --bss-wash: #f4f6f5;
  --bss-focus: #0861b3;
  --bss-alert: #8d1535;
  --bss-ok: #175b40;
  --bss-space: clamp(18px, 3.5vw, 48px);
  color: var(--bss-type);
  font-family: inherit;
  font-size: 15px;
  max-width: 1340px;
  margin-inline: auto;
  padding: 12px var(--bss-space) 78px;
  overflow-wrap: anywhere;
}
.bs-v11-root *, .bs-v11-root *::before, .bs-v11-root *::after { box-sizing: border-box; }
.bs-v11-root :where(button, input, textarea, summary, [tabindex]):focus-visible {
  outline: 3px solid var(--bss-focus);
  outline-offset: 3px;
}
.bs-v11-root :where(button, input, textarea) { font: inherit; }
.bs-v11-root button { cursor: pointer; }
.bs-v11-root button:disabled { cursor: not-allowed; color: #364b54; border-color: #71868e; background: var(--bss-wash); }
.bs-v11-root input:disabled { background: var(--bss-wash); color: #4d6068; }
.bs-v11-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
/* The page title is editorial; the rightmost action is the only primary CTA. */
.bs-v11-top {
  display: flex; align-items: end; justify-content: space-between;
  gap: 22px; flex-wrap: wrap; border-bottom: 1px solid var(--bss-rule);
  padding: 12px 0 25px; margin: 0 0 26px;
}
.bs-v11-kicker { font-size: 11px; color: var(--bss-muted); font-weight: 750; letter-spacing: .15em; margin-bottom: 12px; }
.bs-v11-top h1 { color: var(--bss-ink); font-size: clamp(30px, 4.2vw, 46px); line-height: 1.06; font-weight: 730; letter-spacing: -.048em; margin: 0 0 13px; }
.bs-v11-muted { color: var(--bss-muted); line-height: 1.5; margin: 4px 0; font-size: 14px; }
.bs-v11-top .bs-v11-muted { max-width: 53ch; }
.bs-v11-header-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.bs-v11-btn {
  appearance: none; border: 1px solid var(--bss-ink); background: var(--bss-paper);
  color: var(--bss-ink); border-radius: 3px; display: inline-flex; align-items: center;
  justify-content: center; gap: 7px; min-height: 48px; padding: 11px 18px;
  text-align: center; font-size: 14px; font-weight: 720; line-height: 1.3;
  text-decoration: none; white-space: normal; transition: background-color .12s ease;
}
.bs-v11-btn:hover:not(:disabled) { background: var(--bss-wash); }
.bs-v11-btn.primary { color: #fff; background: var(--bss-ink); }
.bs-v11-btn.primary:hover:not(:disabled) { background: #13566b; }
.bs-v11-btn.subtle { border: 1px solid transparent; background: transparent; }
.bs-v11-btn.subtle:hover:not(:disabled) { border-color: var(--bss-rule); background: var(--bss-wash); }
.bs-v11-btn.picker { width: 100%; justify-content: space-between; background: var(--bss-paper); border-color: var(--bss-rule); }
.bs-v11-alert { padding: 14px 16px; margin: 14px 0 21px; border-left: 4px solid; border-radius: 0; line-height: 1.5; font-size: 14px; }
.bs-v11-alert.success { border-color: var(--bss-ok); background: #eff7f1; color: #13432f; }
.bs-v11-alert.error { border-color: var(--bss-alert); background: #fff1f3; color: #75152b; }
.bs-v11-error { color: #75152b; font-weight: 650; }
/* Library: one searchable register, not a dashboard of card widgets. */
.bs-v11-summary { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 1px solid var(--bss-rule); padding-bottom: 16px; }
.bs-v11-summary > div { display: flex; align-items: baseline; gap: 12px; }
.bs-v11-big { color: var(--bss-ink); font-weight: 750; font-size: 32px; line-height: 1; font-variant-numeric: tabular-nums; }
.bs-v11-small { font-size: 13px; color: var(--bss-muted); }
.bs-v11-library { width: 100%; min-width: 0; }
.bs-v11-search-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; border-bottom: 1px solid var(--bss-rule); padding: 18px 0; }
.bs-v11-search-row label { color: var(--bss-ink); font-size: 14px; font-weight: 730; }
.bs-v11-search-row input { flex: 1 1 230px; width: min(100%, 520px); max-width: 520px; }
.bs-v11-root :where(.bs-v11-search-row input, .bs-v11-label input, .bs-v11-edit-table input, .bs-v11-import textarea) {
  min-height: 48px; padding: 10px 12px; color: var(--bss-type); background: #fff;
  border: 1px solid #71868e; border-radius: 3px; font-size: 15px;
}
.bs-v11-root input::placeholder, .bs-v11-root textarea::placeholder { color: var(--bss-muted); opacity: 1; }
.bs-v11-chart-row { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 14px 0; border-bottom: 1px solid var(--bss-faint); }
.bs-v11-chart-icon { display: grid; place-items: center; flex: 0 0 28px; font-size: 20px; color: var(--bss-muted); }
.bs-v11-chart-info { min-width: 0; flex: 1; display: grid; gap: 6px; }
.bs-v11-chart-info strong { color: var(--bss-ink); font-weight: 740; font-size: 16px; }
.bs-v11-chart-info span { color: var(--bss-muted); font-size: 13px; }
.bs-v11-chart-row .bs-v11-btn { min-width: 98px; }
.bs-v11-empty { padding: clamp(28px, 6vw, 76px) 0; max-width: 560px; }
.bs-v11-empty h2 { font-size: 28px; line-height: 1.15; letter-spacing: -.035em; color: var(--bss-ink); margin: 0 0 12px; }
.bs-v11-empty .bs-v11-btn { margin-top: 20px; }
/* Editor: measurement work area and restrained storefront preview. */
.bs-v11-steps { display: flex; gap: 20px; flex-wrap: wrap; border-bottom: 1px solid var(--bss-rule); margin-bottom: 24px; }
.bs-v11-steps button {
  min-height: 52px; display: inline-flex; align-items: center; gap: 9px; background: transparent;
  border: 0; border-bottom: 3px solid transparent; padding: 12px 2px; color: var(--bss-muted);
  font-weight: 720; font-size: 15px;
}
.bs-v11-steps button.selected { color: var(--bss-ink); border-color: var(--bss-ink); }
.bs-v11-steps button span { display: grid; place-items: center; border: 1px solid currentColor; border-radius: 50%; height: 28px; width: 28px; font-size: 12px; }
.bs-v11-steps button:disabled { border-color: transparent; background: transparent; color: #657880; }
.bs-v11-editor-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: clamp(24px, 3vw, 50px); align-items: start; }
.bs-v11-editor { min-width: 0; }
.bs-v11-label { display: grid; gap: 9px; font-size: 14px; color: var(--bss-ink); font-weight: 750; }
.bs-v11-label input { width: 100%; }
.bs-v11-section-title { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; justify-content: space-between; margin: 34px 0 17px; }
.bs-v11-section-title h2, .bs-v11-preview-card h2, .bs-v11-products h2 { color: var(--bss-ink); font-size: 21px; letter-spacing: -.02em; font-weight: 720; margin: 0 0 5px; }
.bs-v11-unit-label { display: inline-flex; padding: 8px 10px; border: 1px solid var(--bss-rule); font-weight: 740; font-size: 12px; color: var(--bss-ink); letter-spacing: .08em; }
.bs-v11-table-scroll { width: 100%; overflow-x: auto; max-width: 100%; overscroll-behavior-x: contain; }
.bs-v11-edit-table, .bs-v11-table { width: 100%; border-collapse: collapse; }
.bs-v11-edit-table { min-width: 380px; }
.bs-v11-edit-table th { background: var(--bss-wash); color: var(--bss-ink); font-weight: 750; text-align: left; padding: 8px; font-size: 13px; border-bottom: 1px solid var(--bss-rule); }
.bs-v11-edit-table th:first-child { min-width: 105px; }
.bs-v11-edit-table th input { min-width: 110px; width: calc(100% - 46px); font-weight: 720; font-size: 14px; }
.bs-v11-edit-table td { border-bottom: 1px solid var(--bss-faint); padding: 6px 5px; }
.bs-v11-edit-table td input { width: 100%; min-width: 88px; }
.bs-v11-edit-table th button, .bs-v11-edit-table td > button {
  min-height: 48px; min-width: 48px; color: #7c1227; border: 1px solid transparent; background: none;
  border-radius: 2px; font-size: 22px; font-weight: 650;
}
.bs-v11-edit-table th button:hover, .bs-v11-edit-table td > button:hover { background: #fff1f3; }
.bs-v11-mobile-scroll-hint { display: none; color: var(--bss-muted); font-size: 13px; margin: 8px 0 0; }
.bs-v11-table-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 15px; }
.bs-v11-import { border-top: 1px solid var(--bss-rule); padding-top: 18px; margin-top: 26px; }
.bs-v11-import summary { min-height: 48px; display: flex; align-items: center; color: var(--bss-ink); font-size: 14px; font-weight: 710; }
.bs-v11-import textarea { resize: vertical; width: 100%; min-height: 100px; margin: 10px 0; }
.bs-v11-bottom { display: flex; justify-content: space-between; align-items: center; gap: 18px; flex-wrap: wrap; border-top: 1px solid var(--bss-rule); padding-top: 22px; margin-top: 30px; }
.bs-v11-bottom > p { flex: 1 1 230px; max-width: 425px; }
.bs-v11-bottom > button { flex: 0 1 auto; }
.bs-v11-preview-card { min-width: 0; border-left: 1px solid var(--bss-rule); padding-left: clamp(20px, 2.5vw, 34px); position: sticky; top: 24px; }
.bs-v11-preview-card-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 20px; }
.bs-v11-preview-card-heading h2 { margin: 0; }
.bs-v11-preview { border-top: 1px solid var(--bss-rule); border-bottom: 1px solid var(--bss-rule); padding: 28px 0 16px; text-align: center; }
.bs-v11-preview-title { font-size: clamp(17px, 2vw, 21px); color: var(--bss-ink); letter-spacing: -.02em; margin: 0 0 18px; font-weight: 750; text-transform: uppercase; }
.bs-v11-units { display: flex; justify-content: center; align-items: center; gap: 13px; margin-bottom: 20px; }
.bs-v11-units button { min-height: 48px; min-width: 56px; padding: 10px 12px; border: 0; border-bottom: 2px solid transparent; background: #fff; color: var(--bss-muted); font-weight: 740; }
.bs-v11-units button.active { color: var(--bss-ink); border-bottom-color: var(--bss-ink); }
.bs-v11-units span { color: var(--bss-muted); }
.bs-v11-table th { background: var(--bss-wash); color: var(--bss-ink); font-weight: 750; padding: 13px 10px; text-align: center; font-size: 13px; border: 1px solid var(--bss-rule); }
.bs-v11-table td, .bs-v11-table tbody th { color: var(--bss-type); padding: 12px 8px; font-size: 14px; border: 1px solid var(--bss-rule); text-align: center; font-weight: 500; }
.bs-v11-table tbody th { font-weight: 760; }
.bs-v11-preview-note { font-size: 12px; margin-top: 14px; }
/* Product picker has a single central action; no existing assignment is overwritten without consent. */
.bs-v11-products { max-width: 760px; }
.bs-v11-products > p { margin: 8px 0 20px; }
.bs-v11-selected { margin: 24px 0; border-top: 1px solid var(--bss-rule); }
.bs-v11-selected-heading { font-size: 13px; padding: 14px 0; font-weight: 760; color: var(--bss-ink); }
.bs-v11-product-row { display: flex; gap: 14px; align-items: center; border-top: 1px solid var(--bss-faint); padding: 9px 0; }
.bs-v11-product-image { display: grid; place-items: center; flex: 0 0 52px; height: 52px; background: var(--bss-wash); }
.bs-v11-product-image img { width: 100%; height: 100%; object-fit: cover; }
.bs-v11-product-row strong { min-width: 0; flex: 1; font-size: 15px; }
.bs-v11-product-row > button { min-height: 48px; min-width: 48px; font-size: 22px; border: 0; background: transparent; color: #8d1535; }
.bs-v11-products-hint { border-left: 3px solid var(--bss-rule); padding: 12px 16px; }
.bs-v11-checkbox { display: flex; align-items: start; gap: 12px; margin: 22px 0; line-height: 1.5; color: var(--bss-type); }
.bs-v11-checkbox input { width: 22px; height: 22px; flex: 0 0 22px; accent-color: var(--bss-ink); }
.bs-v11-products-footer { border-top: 1px solid var(--bss-rule); margin-top: 26px; padding-top: 16px; }
/* CSV is an orderly sequence, not a wall of dropzones and pills. */
.bs-v11-import-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: clamp(18px, 4vw, 48px); border-bottom: 1px solid var(--bss-rule); padding-bottom: 30px; }
.bs-v11-csv-steps, .bs-v11-csv-upload { min-width: 0; }
.bs-v11-import-layout h2, .bs-v11-csv-review h2 { color: var(--bss-ink); font-size: 22px; letter-spacing: -.025em; line-height: 1.2; font-weight: 750; margin: 10px 0 12px; }
.bs-v11-step-index { color: var(--bss-muted); font-weight: 760; letter-spacing: .12em; font-size: 12px; }
.bs-v11-csv-helper { color: var(--bss-muted); margin: 16px 0 0; line-height: 1.5; font-size: 13px; }
.bs-v11-csv-steps > button { margin-top: 24px; }
.bs-v11-csv-upload input[type=file] { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
.bs-v11-file-target { display: flex; align-items: center; gap: 14px; min-height: 96px; margin-top: 21px; padding: 18px 16px; border: 1px dashed #728a92; color: var(--bss-ink); background: #fff; cursor: pointer; flex-wrap: wrap; }
.bs-v11-file-target:hover, .bs-v11-csv-upload:focus-within .bs-v11-file-target { background: var(--bss-wash); border-style: solid; }
.bs-v11-csv-upload:focus-within .bs-v11-file-target { outline: 3px solid var(--bss-focus); outline-offset: 3px; }
.bs-v11-file-target strong { font-size: 14px; min-width: 0; overflow-wrap: anywhere; }
.bs-v11-file-target span:last-child { font-size: 13px; color: var(--bss-muted); }
.bs-v11-upload-glyph { font-size: 24px; font-weight: 700; }
.bs-v11-csv-review { padding-top: 27px; }
.bs-v11-review-head { display: flex; gap: 18px; align-items: baseline; justify-content: space-between; flex-wrap: wrap; border-bottom: 1px solid var(--bss-rule); padding-bottom: 17px; }
.bs-v11-csv-count { color: var(--bss-type); font-size: 13px; font-weight: 710; }
.bs-v11-review-row { display: flex; align-items: start; gap: 15px; padding: 16px 0; border-bottom: 1px solid var(--bss-faint); flex-wrap: wrap; }
.bs-v11-review-row > div:not(.bs-v11-review-details) { min-width: 0; flex: 1; }
.bs-v11-review-row strong { color: var(--bss-ink); font-size: 15px; }
.bs-v11-review-row p { color: var(--bss-muted); line-height: 1.5; margin-top: 6px; font-size: 13px; }
.bs-v11-pill { border: 1px solid var(--bss-rule); padding: 5px 9px; color: var(--bss-type); font-size: 12px; font-weight: 700; }
.bs-v11-pill.error { border-color: #8d1535; color: #75152b; }
.bs-v11-pill.created { border-color: var(--bss-ok); color: #145138; }
.bs-v11-review-details { flex: 1 1 100%; padding-left: 42px; min-width: 0; }
.bs-v11-review-details summary { min-height: 48px; display: flex; align-items: center; color: var(--bss-ink); font-weight: 720; cursor: pointer; }
.bs-v11-review-details table { max-width: 820px; }
.bs-v11-csv-progress { color: var(--bss-ink); border-left: 3px solid var(--bss-ink); padding: 14px; margin: 18px 0; font-size: 14px; }
.bs-v11-csv-footer { display: flex; gap: 24px; align-items: end; justify-content: space-between; flex-wrap: wrap; border-top: 1px solid var(--bss-rule); padding-top: 20px; margin-top: 12px; }
.bs-v11-csv-footer > p { flex: 1 1 250px; max-width: 590px; }
/* Content-shaped skeletons; respect reduced-motion settings. */
.bs-v11-skeleton { width: 100%; padding: 10px 0; }
.bs-v11-skeleton-search { height: 48px; width: min(100%, 440px); background: var(--bss-wash); margin: 14px 0 22px; }
.bs-v11-skeleton-row { display: flex; align-items: center; gap: 19px; padding: 15px 0; border-bottom: 1px solid var(--bss-faint); min-height: 72px; }
.bs-v11-skeleton-index { width: 26px; height: 18px; background: var(--bss-wash); }
.bs-v11-skeleton-row > div { min-width: 0; flex: 1; display: grid; gap: 9px; }
.bs-v11-skeleton-bar { display: block; height: 15px; max-width: 100%; background: var(--bss-wash); }
.bs-v11-skeleton-bar.wide { width: min(60%, 320px); }
.bs-v11-skeleton-bar.medium { width: min(38%, 190px); height: 11px; }
.bs-v11-skeleton-action { width: 88px; height: 48px; background: var(--bss-wash); }
.bs-v11-skeleton-import { border-top: 1px solid var(--bss-faint); display: grid; gap: 10px; margin: 12px 0; }
@media (prefers-reduced-motion: no-preference) {
  .bs-v11-skeleton-bar, .bs-v11-skeleton-index, .bs-v11-skeleton-search, .bs-v11-skeleton-action { animation: bss-breathe 1.4s ease-in-out infinite alternate; }
  @keyframes bss-breathe { from { opacity: 1; } to { opacity: .52; } }
}
@media (max-width: 900px) {
  .bs-v11-mobile-scroll-hint { display: block; }
  .bs-v11-editor-grid { grid-template-columns: minmax(0, 1fr); }
  .bs-v11-preview-card { position: static; border-left: 0; padding-left: 0; border-top: 1px solid var(--bss-rule); padding-top: 23px; }
}
@media (max-width: 650px) {
  .bs-v11-root { padding-inline: 16px; }
  .bs-v11-top { align-items: stretch; gap: 20px; }
  .bs-v11-top > div { min-width: 0; }
  .bs-v11-header-actions { justify-content: flex-start; }
  .bs-v11-import-layout { grid-template-columns: minmax(0, 1fr); }
  .bs-v11-csv-review { padding-top: 24px; }
  .bs-v11-search-row { display: grid; }
  .bs-v11-search-row input { width: 100%; }
  .bs-v11-chart-row { flex-wrap: wrap; }
  .bs-v11-chart-info { flex: 1 1 calc(100% - 44px); }
  .bs-v11-chart-row .bs-v11-btn { flex: 1; }
  .bs-v11-summary { align-items: start; }
  .bs-v11-small { text-align: right; }
  .bs-v11-bottom > button, .bs-v11-csv-footer > button { width: 100%; }
  .bs-v11-review-details { padding-left: 0; }
}
`;
