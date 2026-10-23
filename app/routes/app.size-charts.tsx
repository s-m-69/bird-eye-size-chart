import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from 'react-router';
import { useAppBridge } from '@shopify/app-bridge-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartPreview } from '../components/size-studio/ChartPreview';
import { AdminSkeleton } from '../components/size-studio/AdminSkeleton';
import { getDraftIssue } from '../components/size-studio/draftValidation';
import { adminStyles } from '../styles/sizeStudioAdmin';
import { authenticate } from '../shopify.server';
import { getCharts, hasDefinition, installDefinition, saveChart, validateChart } from '../models/sizeStudio.server';
import type { Chart, ChartData } from '../models/sizeStudio.server';
import { assignProductsById } from '../models/sizeStudioAssignments.server';
import { importCsvBatch } from '../models/sizeStudioCsv.server';
import { canonicalChartName, csvTemplate, planCsv, CSV_BATCH_SIZE, CSV_MAX_BYTES } from '../models/sizeStudioCsv';
import type { CsvPlan, ImportResult } from '../models/sizeStudioCsv';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const installed = await hasDefinition(admin);
  const data = installed ? await getCharts(admin) : { charts: [] as Chart[], truncated: false };
  return { installed, ...data };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get('intent') || '');
  try {
    if (intent === 'setup') {
      await installDefinition(admin);
      return { ok: 'Size chart library is ready.' };
    }
    if (!(await hasDefinition(admin))) throw new Error('Set up the size chart library first.');
    if (intent === 'save') {
      const id = String(form.get('id') || '');
      const parsed = JSON.parse(String(form.get('payload') || '{}'));
      const chart = validateChart(parsed);
      const current = (await getCharts(admin)).charts;
      if (id && !current.some((c) => c.id === id)) throw new Error('That size chart could not be found.');
      if (!id && current.length >= 250) throw new Error('The chart library has reached its current 250-chart limit.');
      const saved = await saveChart(admin, chart, id || undefined);
      return { ok: `“${chart.name}” saved.`, savedId: saved.id as string };
    }
    if (intent === 'import-batch') {
      const raw = String(form.get('payload') || '');
      if (raw.length > 30000) throw new Error('Import batch is too large.');
      const batch: unknown = JSON.parse(raw);
      const importResults = await importCsvBatch(admin, batch);
      return { importResults };
    }
    if (intent === 'assign-picked') {
      const chartHandle = String(form.get('chartHandle') || '');
      const current = (await getCharts(admin)).charts;
      if (!current.some((c) => c.handle === chartHandle)) throw new Error('Choose a saved chart first.');
      const productIds: unknown = JSON.parse(String(form.get('productIds') || '[]'));
      if (!Array.isArray(productIds) || !productIds.every((id) => typeof id === 'string')) {
        throw new Error('Please select products using the product picker.');
      }
      const result = await assignProductsById(admin, productIds as string[], chartHandle, form.get('allowReplace') === 'yes');
      return {
        ok: result.count
          ? `Size chart assigned to ${result.count} product${result.count === 1 ? '' : 's'}.${result.unchanged ? ` ${result.unchanged} already had this chart.` : ''}`
          : `All ${result.unchanged} selected products already use this size chart.`,
      };
    }
    throw new Error('Unknown action.');
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Something went wrong. Please try again.' };
  }
};

type Draft = Pick<Chart, 'name' | 'productType' | 'tag' | 'data'>;
type PickedProduct = { id: string; title: string; image?: string };
const blank = (): Draft => ({
  name: '', productType: '', tag: '', data: {
    unit: 'in', columns: ['Size', 'Waist', 'Hip'],
    rows: ['XS', 'S', 'M', 'L', 'XL'].map((size) => [size, '', '']),
  },
});
const copyDraft = (chart: Chart): Draft => ({
  name: chart.name,
  productType: chart.productType,
  tag: chart.tag,
  data: structuredClone(chart.data),
});

export function ErrorBoundary() {
  return <s-page heading="Size charts">
    <div className="bs-v11-root"><section className="bs-v11-empty" role="alert">
      <h2>Size charts couldn't load</h2>
      <p className="bs-v11-muted">The admin connection may be temporarily unavailable. Your customer-facing charts remain in Shopify.</p>
      <button type="button" className="bs-v11-btn primary" onClick={() => window.location.reload()}>Try again</button>
    </section></div><style>{adminStyles}</style>
  </s-page>;
}

export function HydrateFallback() {
  return <s-page heading="Size charts"><div className="bs-v11-root"><AdminSkeleton /></div><style>{adminStyles}</style></s-page>;
}

export default function SizeChartsPage() {
  const { installed, charts, truncated } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [screen, setScreen] = useState<'library' | 'editor' | 'import'>('library');
  const [tab, setTab] = useState<'measurements' | 'products'>('measurements');
  const [editingId, setEditingId] = useState<string>('');
  const [draft, setDraft] = useState<Draft>(blank);
  const [search, setSearch] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<PickedProduct[]>([]);
  const [pickerError, setPickerError] = useState('');
  const [replace, setReplace] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [csvPlan, setCsvPlan] = useState<CsvPlan | null>(null);
  const [csvFile, setCsvFile] = useState('');
  const [csvError, setCsvError] = useState('');
  const [csvResults, setCsvResults] = useState<ImportResult[]>([]);
  const [csvOffset, setCsvOffset] = useState(0);
  const [csvRunning, setCsvRunning] = useState(false);
  const [csvInFlight, setCsvInFlight] = useState(false);
  const csvFetcher = useFetcher<typeof action>();
  const lastCsvResponse = useRef<unknown>(null);

  const active = useMemo(() => charts.find((c) => c.id === editingId), [charts, editingId]);
  const filtered = useMemo(() => charts.filter((c) => c.name.toLowerCase().includes(search.toLowerCase().trim())), [charts, search]);
  const busy = navigation.state !== 'idle';
  const saveIssue = getDraftIssue(draft);
  const [csvParsing, setCsvParsing] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);

  useEffect(() => {
    if (actionData && 'savedId' in actionData && actionData.savedId) {
      setEditingId(actionData.savedId);
      setTab('products');
      setScreen('editor');
    }
  }, [actionData]);

  useEffect(() => {
    if (!csvRunning || csvInFlight || !csvPlan || csvFetcher.state !== 'idle') return;
    if (csvOffset >= csvPlan.charts.length) { setCsvRunning(false); return; }
    setCsvInFlight(true);
    csvFetcher.submit({ intent: 'import-batch', payload: JSON.stringify(csvPlan.charts.slice(csvOffset, csvOffset + CSV_BATCH_SIZE)) }, { method: 'post' });
  }, [csvRunning, csvInFlight, csvPlan, csvOffset, csvFetcher.state]);

  useEffect(() => {
    if (!csvInFlight || csvFetcher.state !== 'idle' || !csvFetcher.data || csvFetcher.data === lastCsvResponse.current) return;
    lastCsvResponse.current = csvFetcher.data;
    setCsvInFlight(false);
    if ('importResults' in csvFetcher.data && Array.isArray(csvFetcher.data.importResults)) {
      const batch = csvFetcher.data.importResults as ImportResult[];
      setCsvResults((prev) => [...prev, ...batch]);
      const failed = batch.some((item) => item.status === 'error');
      if (failed) { setCsvError('Some charts could not be saved. You can retry safely; existing charts will be skipped.'); setCsvRunning(false); }
      else setCsvOffset((index) => index + batch.length);
    } else {
      setCsvError('Shopify could not finish this batch. Press Retry to resume safely.');
      setCsvRunning(false);
    }
  }, [csvInFlight, csvFetcher.state, csvFetcher.data]);

  function resetCsv() {
    setCsvPlan(null); setCsvFile(''); setCsvError(''); setCsvResults([]);
    setCsvOffset(0); setCsvRunning(false); setCsvInFlight(false);
    lastCsvResponse.current = csvFetcher.data;
  }
  async function uploadCsv(file?: File) {
    resetCsv();
    if (!file) return;
    setCsvParsing(true);
    setCsvFile(file.name);
    if (!/\.csv$/i.test(file.name)) { setCsvError('Choose a .csv file exported from Excel or Google Sheets.'); setCsvParsing(false); return; }
    if (file.size > CSV_MAX_BYTES) { setCsvError('Maximum file size is 256 KB. Split larger files.'); setCsvParsing(false); return; }
    try { const plan = planCsv(await file.text()); setCsvPlan(plan); }
    catch (error) { setCsvError(error instanceof Error ? error.message : 'The CSV file could not be read.'); }
    finally { setCsvParsing(false); }
  }
  function downloadCsvTemplate() {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csvTemplate()], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'BirdEye_Size_Studio_Template.csv';
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  }
  const existingCsv = new Set(charts.map(c => canonicalChartName(c.name)));
  const csvFinished = csvPlan !== null && csvOffset >= csvPlan.charts.length && csvResults.length > 0;
  const csvFailed = csvResults.some(r => r.status === 'error');
  const csvSuccess = csvResults.filter(r => r.status === 'created').length;
  const csvSkipped = csvResults.filter(r => r.status === 'skipped').length;
  function startImport() {
    if (!csvPlan || csvInFlight) return;
    if (csvFailed) {
      // Start again from the first chart in the failed batch. Deterministic handles make retries safe.
      const failedBatchNames = new Set(csvPlan.charts.slice(csvOffset, csvOffset + CSV_BATCH_SIZE).map(c => canonicalChartName(c.name)));
      setCsvResults(prev => prev.filter(r => !failedBatchNames.has(canonicalChartName(r.name))));
    }
    setCsvError(''); setCsvRunning(true);
  }

  function create() {
    setDraft(blank()); setEditingId(''); setSelectedProducts([]); setReplace(false);
    setPasteError(''); setTab('measurements'); setScreen('editor');
  }
  function edit(chart: Chart) {
    setDraft(copyDraft(chart)); setEditingId(chart.id); setSelectedProducts([]);
    setReplace(false); setTab('measurements'); setScreen('editor'); setPasteError('');
  }
  function duplicate(chart: Chart) {
    setDraft({ ...copyDraft(chart), name: `${chart.name} - Copy`, productType: '', tag: '' });
    setEditingId(''); setSelectedProducts([]); setReplace(false);
    setPasteError(''); setTab('measurements'); setScreen('editor');
  }
  function modify(update: (value: Draft) => void) {
    setDraft((previous) => { const next = structuredClone(previous); update(next); return next; });
  }
  function addRow() { modify((d) => { d.data.rows.push(d.data.columns.map(() => '')); }); }
  function addColumn() { modify((d) => {
    d.data.columns.push('Measurement'); d.data.rows.forEach((r) => r.push(''));
  }); }
  function pasteGrid() {
    const normalized = bulkText.replace(/\r\n/g, '\n').trim();
    const rows = normalized.split('\n').filter(Boolean).map((line) => line.split('\t').map((s) => s.trim()));
    if (rows.length < 2 || rows.length > 41 || rows[0].length < 2 || rows[0].length > 9 || rows.some((r) => r.length !== rows[0].length)) {
      setPasteError('Copy a table with headers and at least one size row from Google Sheets or Excel.'); return;
    }
    modify((d) => { d.data.columns = rows[0]; d.data.rows = rows.slice(1); });
    setPasteError(''); setBulkText('');
  }
  async function pickProducts() {
    setPickerError(''); setPickerBusy(true);
    try {
      const result = await shopify.resourcePicker({
        type: 'product', action: 'select', multiple: 25,
        filter: { variants: false },
        selectionIds: selectedProducts.map((p) => ({ id: p.id })),
      });
      if (result === undefined) return;
      setSelectedProducts(result.map((product) => ({
        id: product.id,
        title: product.title,
        image: product.images?.[0]?.originalSrc,
      })));
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'Product picker could not open. Reload the app and try again.');
    } finally { setPickerBusy(false); }
  }

  return <s-page heading="Size charts">
    <div className="bs-v11-root" aria-busy={navigation.state === 'loading'}>
      <div className="bs-v11-top">
        <div><div className="bs-v11-kicker">BIRD EYE / SIZE STUDIO</div><h1>{screen === 'library' ? 'Size charts' : screen === 'import' ? 'Import charts' : editingId ? 'Edit chart' : 'New chart'}</h1>
          <p className="bs-v11-muted">{screen === 'library' ? 'Create and manage measurements for your products.' : screen === 'import' ? 'One CSV can contain up to 25 different size charts.' : 'Measurements are entered in inches.'}</p></div>
        <div>{screen === 'library' ? <div className="bs-v11-header-actions"><button type="button" className="bs-v11-btn subtle" disabled={!installed} onClick={() => {resetCsv(); setScreen('import');}}>Import CSV</button>{charts.length > 0 && <button type="button" className="bs-v11-btn primary" disabled={!installed} onClick={create}>New chart <span aria-hidden="true">↗</span></button>}</div> : <button type="button" className="bs-v11-btn" onClick={() => {setCsvRunning(false); setScreen('library');}}>← Back to charts</button>}</div>
      </div>
      {actionData && ('error' in actionData && actionData.error
        ? <div role="alert" className="bs-v11-alert error">{actionData.error}</div>
        : 'ok' in actionData && actionData.ok
        ? <div role="status" className="bs-v11-alert success">✓ {actionData.ok}</div> : null)}
      {navigation.state === 'loading' && screen === 'library' ? <AdminSkeleton /> : !installed ? <div className="bs-v11-empty"><h2>Set up your chart library</h2><p className="bs-v11-muted">This creates a dedicated size-chart collection in Shopify. Your existing products and size guides are not changed.</p>
        <Form method="post"><input type="hidden" name="intent" value="setup"/><button className="bs-v11-btn primary" type="submit">Set up library</button></Form></div>
      : screen === 'import' ? <>
        <div className="bs-v11-import-layout">
          <section className="bs-v11-csv-steps">
            <div className="bs-v11-step-index">01 — TEMPLATE</div>
            <h2>Start with the template</h2>
            <p className="bs-v11-muted">One row per size. Repeat the chart name for each size, then leave irrelevant measurement columns blank.</p>
            <button type="button" className="bs-v11-btn" onClick={downloadCsvTemplate}>Download template ↓</button>
            <div className="bs-v11-csv-helper">Works in Excel and Google Sheets · Inches only · No technical IDs or product handles</div>
          </section>
          <section className="bs-v11-csv-upload">
            <div className="bs-v11-step-index">02 — FILE</div>
            <h2>Upload your completed file</h2>
            <label className="bs-v11-file-target" htmlFor="bs-v11-file"><span className="bs-v11-upload-glyph">↑</span><strong>{csvFile || 'Choose a CSV file'}</strong><span>Click to browse · Max 256 KB · Up to 25 charts</span></label>
            <input id="bs-v11-file" type="file" accept=".csv,text/csv" aria-label="Upload CSV size charts" onChange={(e) => void uploadCsv(e.target.files?.[0])} disabled={csvRunning || csvInFlight || csvParsing}/>
            {csvParsing && <div role="status" aria-live="polite"><AdminSkeleton variant="import" /></div>}
            {csvError && <div role="alert" className="bs-v11-alert error">{csvError}</div>}
          </section>
        </div>
        {csvPlan && <section className="bs-v11-csv-review">
          <div className="bs-v11-review-head"><div><div className="bs-v11-step-index">03 — REVIEW</div><h2>{csvPlan.charts.length} chart{csvPlan.charts.length === 1 ? '' : 's'} ready to review</h2><p className="bs-v11-muted">No product assignments are changed. Existing chart names are skipped, never overwritten.</p></div><span className="bs-v11-csv-count">{csvPlan.rowsRead} size rows</span></div>
          <div className="bs-v11-review-list" aria-busy={csvRunning || csvInFlight}>
            {csvPlan.charts.map((c, i) => {
              const outcome = csvResults.find(r => canonicalChartName(r.name) === canonicalChartName(c.name));
              const already = existingCsv.has(canonicalChartName(c.name));
              return <div className="bs-v11-review-row" key={c.name}><span className="bs-v11-chart-icon">↔</span><div><strong>{c.name}</strong><p>{outcome?.status === 'error' ? outcome.message : `${c.data.rows.length} sizes · ${c.data.columns.slice(1).join(', ')}`}</p></div><span className={'bs-v11-pill ' + (outcome?.status || (already ? 'skipped' : 'new'))}>{outcome ? (outcome.status === 'created' ? 'Created' : outcome.status === 'skipped' ? 'Skipped' : 'Needs retry') : already ? 'Already exists' : 'New'}</span><details className="bs-v11-review-details"><summary>Preview measurements</summary><div className="bs-v11-table-scroll"><table className="bs-v11-table"><thead><tr>{c.data.columns.map((column, j) => <th key={j}>{column}{j ? ' (in)' : ''}</th>)}</tr></thead><tbody>{c.data.rows.map((row, r) => <tr key={r}>{row.map((value, j) => <td key={j}>{value}</td>)}</tr>)}</tbody></table></div></details></div>;
            })}
          </div>
          {(csvRunning || csvInFlight) && <AdminSkeleton variant="import" />}
          {csvResults.length > 0 && <div role="status" aria-live="polite" className="bs-v11-csv-progress">{csvSuccess} created · {csvSkipped} skipped · {csvResults.filter(r => r.status === 'error').length} errors · {Math.min(csvOffset,csvPlan.charts.length)} of {csvPlan.charts.length} processed</div>}
          <div className="bs-v11-csv-footer"><p className="bs-v11-muted">This file is not stored. Saves happen in batches of {CSV_BATCH_SIZE} to protect the free hosting service.</p>
            <button className="bs-v11-btn primary" type="button" disabled={csvParsing || csvRunning || csvInFlight || csvFinished} onClick={startImport}>{csvRunning || csvInFlight ? 'Saving charts…' : csvFinished ? 'Import complete ✓' : csvFailed ? 'Retry remaining charts' : csvResults.length ? 'Continue import' : `Import ${csvPlan.charts.length} chart${csvPlan.charts.length === 1 ? '' : 's'}`}</button></div>
        </section>}
      </> : screen === 'library' ? <>
        <div className="bs-v11-summary"><div><span className="bs-v11-big">{charts.length}</span><span className="bs-v11-muted">Saved charts</span></div><span className="bs-v11-small">Measurements in inches</span></div>
        <div className="bs-v11-library">
          <div className="bs-v11-search-row"><label htmlFor="bs-v11-search">Find a size chart</label><input id="bs-v11-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search charts..." /></div>
          {truncated && <p className="bs-v11-alert error">Showing the first 250 charts only. This starter requires pagination for larger libraries.</p>}
          {!filtered.length ? <div className="bs-v11-empty"><h2>{charts.length ? 'No matching charts' : 'No charts yet'}</h2><p className="bs-v11-muted">{charts.length ? 'Try a different name.' : 'Create your first chart to get started.'}</p><button type="button" className="bs-v11-btn primary" onClick={create}>+ New chart</button></div>
          : filtered.map((chart) => <div className="bs-v11-chart-row" key={chart.id}>
            <div className="bs-v11-chart-icon" aria-hidden="true">—</div>
            <div className="bs-v11-chart-info"><strong>{chart.name}</strong><span>{chart.data.rows.length} sizes · {Math.max(0, chart.data.columns.length - 1)} measurements · inches</span></div>
            <button type="button" className="bs-v11-btn subtle" onClick={() => duplicate(chart)} aria-label={`Duplicate ${chart.name}`}>Duplicate</button>
            <button type="button" className="bs-v11-btn" onClick={() => edit(chart)} aria-label={`Edit ${chart.name}`}>Edit →</button>
          </div>)}
        </div>
      </> : <>
        <div className="bs-v11-steps" aria-label="Chart setup steps"><button aria-current={tab === 'measurements' ? 'step' : undefined} className={tab === 'measurements' ? 'selected' : ''} type="button" onClick={() => setTab('measurements')}><span>1</span> Measurements</button>
          <button aria-current={tab === 'products' ? 'step' : undefined} className={tab === 'products' ? 'selected' : ''} type="button" onClick={() => setTab('products')} disabled={!active}><span>2</span> Choose products</button></div>
        {tab === 'measurements' ? <div className="bs-v11-editor-grid">
          <div className="bs-v11-editor">
            <Form method="post" aria-label="Save size chart"><input type="hidden" name="intent" value="save"/><input type="hidden" name="id" value={active?.id || ''}/><input type="hidden" name="payload" value={JSON.stringify(draft)}/>
              <label className="bs-v11-label">Chart name<input required value={draft.name} placeholder="e.g. Flow Leggings" maxLength={120} onChange={(e) => modify((d) => { d.name = e.target.value; })}/></label>
              <div className="bs-v11-section-title"><div><h2>Measurements</h2><p className="bs-v11-muted">Only enter inches. CM is calculated automatically.</p></div><span className="bs-v11-unit-label">IN</span></div>
              <div className="bs-v11-table-scroll" role="region" aria-label="Edit measurements; scroll sideways for additional columns" tabIndex={0}><table className="bs-v11-edit-table"><thead><tr>{draft.data.columns.map((col, colIndex) => <th key={colIndex}>
                {colIndex === 0 ? <span>Size</span> : <><input aria-label={`Measurement column ${colIndex + 1}`} value={col} onChange={(e) => modify((d) => { d.data.columns[colIndex] = e.target.value; })}/><button type="button" title={`Remove ${col}`} aria-label={`Remove ${col} column`} disabled={draft.data.columns.length <= 2} onClick={() => modify((d) => { d.data.columns.splice(colIndex, 1); d.data.rows.forEach((r) => r.splice(colIndex, 1)); })}>×</button></>}
              </th>)}<th aria-label="Row controls"></th></tr></thead><tbody>{draft.data.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, colIndex) => <td key={colIndex}>
                <input aria-label={`${draft.data.columns[colIndex]} row ${rowIndex + 1}`} value={cell} placeholder={colIndex ? 'e.g. 24–27' : 'e.g. M'} onChange={(e) => modify((d) => { d.data.rows[rowIndex][colIndex] = e.target.value; })}/>
              </td>)}<td><button type="button" aria-label={`Remove row ${rowIndex + 1}`} title="Remove size" disabled={draft.data.rows.length <= 1} onClick={() => modify((d) => { d.data.rows.splice(rowIndex, 1); })}>×</button></td></tr>)}</tbody></table></div><p className="bs-v11-mobile-scroll-hint">Swipe the table sideways for additional measurements →</p>
              <div className="bs-v11-table-actions"><button type="button" className="bs-v11-btn subtle" disabled={draft.data.rows.length >= 40} onClick={addRow}>+ Add size</button><button type="button" className="bs-v11-btn subtle" disabled={draft.data.columns.length >= 9} onClick={addColumn}>+ Add measurement</button></div>
              <details className="bs-v11-import"><summary>Paste measurements from Excel / Sheets</summary><p className="bs-v11-muted">Copy the cells, including the header row. Paste them here.</p><textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={3} placeholder={'Size\tWaist\tHip\nXS\t24–27\t33–35'} />
                {pasteError && <p className="bs-v11-error">{pasteError}</p>}<button className="bs-v11-btn" type="button" onClick={pasteGrid}>Use pasted measurements</button></details>
              <div className="bs-v11-bottom"><p className="bs-v11-muted" aria-live="polite">{saveIssue || (active ? 'Updates will appear on every product using this chart.' : 'Save first, then select products.')}</p><button disabled={busy || Boolean(saveIssue)} type="submit" className="bs-v11-btn primary">{busy ? 'Saving…' : active ? 'Save changes' : 'Save and choose products →'}</button></div>
            </Form>
          </div>
          <div className="bs-v11-preview-card"><div className="bs-v11-preview-card-heading"><h2>Customer preview</h2><button className="bs-v11-btn subtle" type="button" aria-expanded={showPreview} aria-controls="bs-v11-customer-preview" onClick={() => setShowPreview((p) => !p)}>{showPreview ? 'Hide preview' : 'Show preview'}</button></div>{showPreview && <div id="bs-v11-customer-preview"><ChartPreview draft={draft} productTitle={selectedProducts[0]?.title}/></div>}</div>
        </div> : <div className="bs-v11-products">
          <h2>Choose products</h2><p className="bs-v11-muted">Search your Shopify catalogue, select products, and assign <strong>{active?.name}</strong>. No product handles or URLs needed.</p>
          <button type="button" className="bs-v11-btn picker" onClick={pickProducts} disabled={pickerBusy} aria-busy={pickerBusy}>{pickerBusy ? 'Opening product search…' : 'Search Shopify products →'}</button>
          {pickerError && <div role="alert" className="bs-v11-alert error">{pickerError}</div>}
          {selectedProducts.length > 0 ? <div className="bs-v11-selected"><div className="bs-v11-selected-heading">{selectedProducts.length} selected product{selectedProducts.length === 1 ? '' : 's'}</div>
            {selectedProducts.map((product) => <div key={product.id} className="bs-v11-product-row"><span className="bs-v11-product-image">{product.image ? <img src={product.image} alt=""/> : '▧'}</span><strong>{product.title}</strong><button type="button" aria-label={`Remove ${product.title}`} onClick={() => setSelectedProducts((list) => list.filter((p) => p.id !== product.id))}>×</button></div>)}
          </div> : <p className="bs-v11-muted bs-v11-products-hint">No products selected yet. Existing assignments, including Flow Leggings, are preserved.</p>}
          <Form method="post"><input name="intent" type="hidden" value="assign-picked"/><input name="chartHandle" type="hidden" value={active?.handle || ''}/><input name="productIds" type="hidden" value={JSON.stringify(selectedProducts.map((p) => p.id))}/>
            <label className="bs-v11-checkbox"><input name="allowReplace" type="checkbox" value="yes" checked={replace} onChange={(e) => setReplace(e.target.checked)}/>Replace a product's existing size chart if it already has a different one</label>
            <button className="bs-v11-btn primary" type="submit" disabled={!active || busy || selectedProducts.length === 0}>Assign chart to {selectedProducts.length || ''} product{selectedProducts.length === 1 ? '' : 's'}</button>
          </Form>
          <div className="bs-v11-products-footer"><button className="bs-v11-btn subtle" type="button" onClick={() => setScreen('library')}>Done — back to charts</button></div>
        </div>}
      </>}
    </div>
    <style>{adminStyles}</style>
  </s-page>;
}
