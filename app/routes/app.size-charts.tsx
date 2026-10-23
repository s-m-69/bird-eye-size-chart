import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from 'react-router';
import { useAppBridge } from '@shopify/app-bridge-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
const convert = (value: string, unit: 'in' | 'cm') => unit === 'in'
  ? value
  : value.replace(/\d+(?:\.\d+)?/g, (part) => String(Math.round(Number(part) * 2.54)));
const copyDraft = (chart: Chart): Draft => ({
  name: chart.name, productType: chart.productType, tag: chart.tag,
  data: structuredClone(chart.data),
});

function ChartPreview({ draft }: { draft: Draft }) {
  const [unit, setUnit] = useState<'in' | 'cm'>('in');
  return <div className="bs-v11-preview">
    <div className="bs-v11-preview-title">{draft.name || 'Product size chart'}</div>
    <div className="bs-v11-units" role="group" aria-label="Preview units">
      <button type="button" className={unit === 'cm' ? 'active' : ''} onClick={() => setUnit('cm')}>CM</button>
      <span>|</span>
      <button type="button" className={unit === 'in' ? 'active' : ''} onClick={() => setUnit('in')}>IN</button>
    </div>
    <div className="bs-v11-table-scroll"><table className="bs-v11-table preview"><thead><tr>{draft.data.columns.map((c, i) => <th key={i}>{c || 'Measurement'}</th>)}</tr></thead>
      <tbody>{draft.data.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{c ? (cell.trim() ? convert(cell, unit) : '—') : (cell || '—')}</td>)}</tr>)}</tbody>
    </table></div>
    <p className="bs-v11-muted bs-v11-preview-note">Preview only · Your storefront design stays unchanged.</p>
  </div>;
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
    setCsvFile(file.name);
    if (!/\.csv$/i.test(file.name)) { setCsvError('Choose a .csv file exported from Excel or Google Sheets.'); return; }
    if (file.size > CSV_MAX_BYTES) { setCsvError('Maximum file size is 256 KB. Split larger files.'); return; }
    try { const plan = planCsv(await file.text()); setCsvPlan(plan); }
    catch (error) { setCsvError(error instanceof Error ? error.message : 'The CSV file could not be read.'); }
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
    setPickerError('');
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
    }
  }

  return <s-page heading="Size Studio">
    <div className="bs-v11-root">
      <div className="bs-v11-top">
        <div><div className="bs-v11-kicker">BIRDEYE / SIZE STUDIO</div><h1>{screen === 'library' ? 'Better sizing, made simple.' : screen === 'import' ? 'Import size charts' : editingId ? 'Edit size chart' : 'New size chart'}</h1>
          <p className="bs-v11-muted">{screen === 'library' ? 'A beautiful size guide for every product. Manage it all in one place.' : screen === 'import' ? 'Upload one CSV with as many as 25 charts. Review everything before saving.' : 'Enter measurements in inches. We take care of centimetres.'}</p></div>
        <div>{screen === 'library' ? <div className="bs-v11-header-actions"><button type="button" className="bs-v11-btn bs-v11-btn-light" disabled={!installed} onClick={() => {resetCsv(); setScreen('import');}}>↑ Import CSV</button><button type="button" className="bs-v11-btn primary" disabled={!installed} onClick={create}>+ New chart</button></div> : <button type="button" className="bs-v11-btn" onClick={() => {setCsvRunning(false); setScreen('library');}}>← All charts</button>}</div>
      </div>
      {actionData && ('error' in actionData && actionData.error
        ? <div role="alert" className="bs-v11-alert error">{actionData.error}</div>
        : 'ok' in actionData && actionData.ok
        ? <div role="status" className="bs-v11-alert success">✓ {actionData.ok}</div> : null)}
      {!installed ? <div className="bs-v11-card bs-v11-empty"><h2>Set up your chart library</h2><p className="bs-v11-muted">This creates a dedicated size-chart collection in Shopify. Your existing products and size guides are not changed.</p>
        <Form method="post"><input type="hidden" name="intent" value="setup"/><button className="bs-v11-btn primary" type="submit">Set up library</button></Form></div>
      : screen === 'import' ? <>
        <div className="bs-v11-import-layout">
          <section className="bs-v11-card bs-v11-csv-steps">
            <div className="bs-v11-step-index">01 / DOWNLOAD</div>
            <h2>Start with the template</h2>
            <p className="bs-v11-muted">One row per size. Repeat the chart name for each size, then leave irrelevant measurement columns blank.</p>
            <button type="button" className="bs-v11-btn primary" onClick={downloadCsvTemplate}>↓ Download CSV template</button>
            <div className="bs-v11-csv-helper">Works in Excel and Google Sheets · Inches only · No technical IDs or product handles</div>
          </section>
          <section className="bs-v11-card bs-v11-csv-upload">
            <div className="bs-v11-step-index">02 / UPLOAD</div>
            <h2>Upload your completed file</h2>
            <label className="bs-v11-file-target" htmlFor="bs-v11-file"><span className="bs-v11-upload-glyph">↑</span><strong>{csvFile || 'Choose a CSV file'}</strong><span>Click to browse · Max 256 KB · Up to 25 charts</span></label>
            <input id="bs-v11-file" type="file" accept=".csv,text/csv" onChange={(e) => void uploadCsv(e.target.files?.[0])} disabled={csvRunning || csvInFlight}/>
            {csvError && <div role="alert" className="bs-v11-alert error">{csvError}</div>}
          </section>
        </div>
        {csvPlan && <section className="bs-v11-card bs-v11-csv-review">
          <div className="bs-v11-review-head"><div><div className="bs-v11-step-index">03 / REVIEW & SAVE</div><h2>{csvPlan.charts.length} chart{csvPlan.charts.length === 1 ? '' : 's'} ready to review</h2><p className="bs-v11-muted">No product assignments are changed. Existing chart names are skipped, never overwritten.</p></div><span className="bs-v11-csv-count">{csvPlan.rowsRead} size rows</span></div>
          <div className="bs-v11-review-list">
            {csvPlan.charts.map((c, i) => {
              const outcome = csvResults.find(r => canonicalChartName(r.name) === canonicalChartName(c.name));
              const already = existingCsv.has(canonicalChartName(c.name));
              return <div className="bs-v11-review-row" key={c.name}><span className="bs-v11-chart-icon">↔</span><div><strong>{c.name}</strong><p>{outcome?.status === 'error' ? outcome.message : `${c.data.rows.length} sizes · ${c.data.columns.slice(1).join(', ')}`}</p></div><span className={'bs-v11-pill ' + (outcome?.status || (already ? 'skipped' : 'new'))}>{outcome ? (outcome.status === 'created' ? 'Created' : outcome.status === 'skipped' ? 'Skipped' : 'Needs retry') : already ? 'Already exists' : 'New'}</span><details className="bs-v11-review-details"><summary>Preview measurements</summary><div className="bs-v11-table-scroll"><table className="bs-v11-table"><thead><tr>{c.data.columns.map((column, j) => <th key={j}>{column}{j ? ' (in)' : ''}</th>)}</tr></thead><tbody>{c.data.rows.map((row, r) => <tr key={r}>{row.map((value, j) => <td key={j}>{value}</td>)}</tr>)}</tbody></table></div></details></div>;
            })}
          </div>
          {csvResults.length > 0 && <div role="status" className="bs-v11-csv-progress">{csvSuccess} created · {csvSkipped} skipped · {csvResults.filter(r => r.status === 'error').length} errors · {Math.min(csvOffset,csvPlan.charts.length)} of {csvPlan.charts.length} processed</div>}
          <div className="bs-v11-csv-footer"><p className="bs-v11-muted">This file is not stored. Saves happen in batches of {CSV_BATCH_SIZE} to protect the free hosting service.</p>
            <button className="bs-v11-btn primary" type="button" disabled={csvRunning || csvInFlight || csvFinished} onClick={startImport}>{csvRunning || csvInFlight ? 'Saving charts…' : csvFinished ? 'Import complete ✓' : csvFailed ? 'Retry remaining charts' : csvResults.length ? 'Continue import' : `Import ${csvPlan.charts.length} chart${csvPlan.charts.length === 1 ? '' : 's'}`}</button></div>
        </section>}
      </> : screen === 'library' ? <>
        <div className="bs-v11-summary"><div><span className="bs-v11-big">{charts.length}</span><span className="bs-v11-muted">Saved size charts</span></div><span className="bs-v11-small">Product-level sizing · IN / CM</span></div>
        <div className="bs-v11-card bs-v11-library">
          <div className="bs-v11-search-row"><label htmlFor="bs-v11-search">Find a size chart</label><input id="bs-v11-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search charts..." /></div>
          {truncated && <p className="bs-v11-alert error">Showing the first 250 charts only. This starter requires pagination for larger libraries.</p>}
          {!filtered.length ? <div className="bs-v11-empty"><h2>{charts.length ? 'No matching charts' : 'No charts yet'}</h2><p className="bs-v11-muted">{charts.length ? 'Try a different name.' : 'Create your first chart to get started.'}</p><button type="button" className="bs-v11-btn primary" onClick={create}>+ New chart</button></div>
          : filtered.map((chart) => <div className="bs-v11-chart-row" key={chart.id}>
            <div className="bs-v11-chart-icon" aria-hidden="true">↔</div>
            <div className="bs-v11-chart-info"><strong>{chart.name}</strong><span>{chart.data.rows.length} sizes · {Math.max(0, chart.data.columns.length - 1)} measurements · inches</span></div>
            <button type="button" className="bs-v11-btn subtle" onClick={() => duplicate(chart)}>Duplicate</button>
            <button type="button" className="bs-v11-btn" onClick={() => edit(chart)}>Edit →</button>
          </div>)}
        </div>
      </> : <>
        <div className="bs-v11-steps"><button className={tab === 'measurements' ? 'selected' : ''} type="button" onClick={() => setTab('measurements')}><span>1</span> Measurements</button>
          <button className={tab === 'products' ? 'selected' : ''} type="button" onClick={() => setTab('products')} disabled={!active}><span>2</span> Choose products</button></div>
        {tab === 'measurements' ? <div className="bs-v11-editor-grid">
          <div className="bs-v11-card bs-v11-editor">
            <Form method="post"><input type="hidden" name="intent" value="save"/><input type="hidden" name="id" value={active?.id || ''}/><input type="hidden" name="payload" value={JSON.stringify(draft)}/>
              <label className="bs-v11-label">Chart name<input required value={draft.name} placeholder="e.g. Flow Leggings" maxLength={120} onChange={(e) => modify((d) => { d.name = e.target.value; })}/></label>
              <div className="bs-v11-section-title"><div><h2>Measurements</h2><p className="bs-v11-muted">Only enter inches. CM is calculated automatically.</p></div><span className="bs-v11-unit-label">INCHES</span></div>
              <div className="bs-v11-table-scroll"><table className="bs-v11-edit-table"><thead><tr>{draft.data.columns.map((col, colIndex) => <th key={colIndex}>
                {colIndex === 0 ? <span>Size</span> : <><input aria-label={`Measurement column ${colIndex + 1}`} value={col} onChange={(e) => modify((d) => { d.data.columns[colIndex] = e.target.value; })}/><button type="button" title={`Remove ${col}`} aria-label={`Remove ${col} column`} onClick={() => modify((d) => { d.data.columns.splice(colIndex, 1); d.data.rows.forEach((r) => r.splice(colIndex, 1)); })}>×</button></>}
              </th>)}<th aria-label="Row controls"></th></tr></thead><tbody>{draft.data.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, colIndex) => <td key={colIndex}>
                <input aria-label={`${draft.data.columns[colIndex]} row ${rowIndex + 1}`} value={cell} placeholder={colIndex ? 'e.g. 24–27' : 'e.g. M'} onChange={(e) => modify((d) => { d.data.rows[rowIndex][colIndex] = e.target.value; })}/>
              </td>)}<td><button type="button" aria-label={`Remove row ${rowIndex + 1}`} title="Remove size" onClick={() => modify((d) => { d.data.rows.splice(rowIndex, 1); })}>×</button></td></tr>)}</tbody></table></div>
              <div className="bs-v11-table-actions"><button type="button" className="bs-v11-btn subtle" disabled={draft.data.rows.length >= 40} onClick={addRow}>+ Add size</button><button type="button" className="bs-v11-btn subtle" disabled={draft.data.columns.length >= 9} onClick={addColumn}>+ Add measurement</button></div>
              <details className="bs-v11-import"><summary>Paste measurements from Excel / Sheets</summary><p className="bs-v11-muted">Copy the cells, including the header row. Paste them here.</p><textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={3} placeholder={'Size\tWaist\tHip\nXS\t24–27\t33–35'} />
                {pasteError && <p className="bs-v11-error">{pasteError}</p>}<button className="bs-v11-btn" type="button" onClick={pasteGrid}>Use pasted measurements</button></details>
              <div className="bs-v11-bottom"><p className="bs-v11-muted">{active ? 'Saving changes updates the chart on any product already using it.' : 'Save the chart first, then choose products.'}</p><button disabled={busy} type="submit" className="bs-v11-btn primary">{busy ? 'Saving…' : active ? 'Save changes' : 'Save and choose products →'}</button></div>
            </Form>
          </div>
          <div className="bs-v11-card bs-v11-preview-card"><div className="bs-v11-preview-card-heading"><h2>Customer preview</h2><button className="bs-v11-btn subtle" type="button" onClick={() => setShowPreview((p) => !p)}>{showPreview ? 'Hide' : 'Show'}</button></div>{showPreview && <ChartPreview draft={draft}/>}</div>
        </div> : <div className="bs-v11-card bs-v11-products">
          <h2>Choose products</h2><p className="bs-v11-muted">Search your Shopify catalogue, select products, and assign <strong>{active?.name}</strong>. No product handles or URLs needed.</p>
          <button type="button" className="bs-v11-btn picker" onClick={pickProducts}>+ Search Shopify products</button>
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
    <style>{STYLE}</style>
  </s-page>;
}

const STYLE = `
/* V11.1 refresh: stronger visual hierarchy, warmer neutrals, calmer interactions */
.bs-v11-root{--bs-teal:#073d4c;--bs-muted:#6f7d82;max-width:1200px!important;padding:12px 0 55px!important;background:transparent!important}
.bs-v11-top{background:linear-gradient(110deg,#f4f8f7 0%,#ffffff 77%);border:1px solid #e2eceb;border-radius:18px;padding:26px 30px!important;margin:5px 0 26px!important;min-height:124px;box-shadow:0 8px 25px rgba(22,55,61,.025)}
.bs-v11-top h1{font-size:30px!important;letter-spacing:-1px!important;margin-top:10px!important}
.bs-v11-kicker{font-size:10px!important;letter-spacing:2px!important;color:#5d8b8a!important}
.bs-v11-header-actions{display:flex;gap:9px;flex-wrap:wrap}
.bs-v11-btn{border-radius:9px!important;padding:11px 16px!important;transition:background .16s ease,border-color .16s ease}
.bs-v11-btn-light{background:#fff!important;border-color:#cbdcdd!important}
.bs-v11-card{border-radius:15px!important;box-shadow:0 7px 28px rgba(12,40,50,.035)!important;border-color:#e4ebed!important}
.bs-v11-summary{padding:8px 2px 12px!important}
.bs-v11-library{padding:0 22px 12px!important}
.bs-v11-chart-row{padding:17px 0!important}
.bs-v11-chart-icon{background:#e9f1ef!important;color:#245966!important;border-radius:12px!important;font-weight:700}
.bs-v11-chart-info strong{font-size:15px!important}
.bs-v11-import-layout{display:grid;grid-template-columns:1fr 1fr;gap:17px;margin-bottom:18px}
.bs-v11-import-layout .bs-v11-card{min-height:224px;padding:25px!important}
.bs-v11-import-layout h2,.bs-v11-csv-review h2{color:#083d4b;font-size:18px;font-weight:740;letter-spacing:-.3px;margin:10px 0}
.bs-v11-step-index{font-size:10px;letter-spacing:1.6px;color:#688a8a;font-weight:800}
.bs-v11-csv-helper{margin-top:17px;color:#74868b;font-size:11px;line-height:1.4}
.bs-v11-csv-upload input[type=file]{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.bs-v11-file-target{margin-top:15px;border:1.5px dashed #bdd2d3;min-height:125px;border-radius:13px;background:#f8fbfa;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#0d3f4b;cursor:pointer;text-align:center;padding:16px}
.bs-v11-file-target:hover{border-color:#5a9398;background:#f3f9f8}
.bs-v11-file-target strong{font-size:13px;max-width:95%;overflow-wrap:anywhere}
.bs-v11-file-target span:last-child{font-size:11px;color:#869698}
.bs-v11-upload-glyph{font-size:23px;line-height:1;color:#4b8890}
.bs-v11-csv-review{padding:25px!important}
.bs-v11-review-head{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:15px}
.bs-v11-csv-count{font-size:11px;color:#436873;background:#eef5f3;border-radius:18px;padding:8px 11px;white-space:nowrap}
.bs-v11-review-row{display:flex;align-items:center;gap:14px;border-bottom:1px solid #edf2f1;padding:15px 0;flex-wrap:wrap}
.bs-v11-review-row:last-child{border-bottom:0}
.bs-v11-review-row>div:not(.bs-v11-review-details){flex:1;min-width:0}
.bs-v11-review-details{width:100%;padding:0 0 4px 55px}.bs-v11-review-details summary{cursor:pointer;color:#2c6771;font-size:11px;font-weight:650;margin:0 0 8px}.bs-v11-review-details table{max-width:720px}.bs-v11-review-row strong{display:block;color:#153e49;font-size:13px}
.bs-v11-review-row p{font-size:12px;color:#819195;margin:5px 0 0}
.bs-v11-pill{font-size:10px;font-weight:700;padding:6px 10px;border-radius:30px;background:#edf5f5;color:#36636b;white-space:nowrap}
.bs-v11-pill.created{background:#e3f5ec;color:#26734b}.bs-v11-pill.skipped{background:#f2f3f3;color:#6b7880}.bs-v11-pill.error{background:#fff0f1;color:#a84250}
.bs-v11-csv-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-top:22px;border-top:1px solid #e9efef}
.bs-v11-csv-footer p{max-width:440px}
.bs-v11-csv-progress{margin:12px 0;color:#295c67;background:#f0f7f5;padding:11px 14px;border-radius:8px;font-size:12px}
@media(max-width:730px){.bs-v11-import-layout{grid-template-columns:1fr}.bs-v11-top{padding:20px!important;flex-direction:column;align-items:flex-start!important}.bs-v11-top h1{font-size:25px!important}.bs-v11-csv-footer,.bs-v11-review-head{flex-direction:column;align-items:stretch}.bs-v11-csv-footer button{width:100%}}

.bs-v11-root{--bs-teal:#073d4c;--bs-muted:#667782;max-width:1170px;padding:12px 0 46px;color:#263944;font-family:inherit}
.bs-v11-top{display:flex;justify-content:space-between;align-items:center;gap:18px;margin:6px 0 24px}
.bs-v11-top h1{font-size:27px;letter-spacing:-.65px;line-height:1.2;margin:5px 0 7px;color:var(--bs-teal);font-weight:700}
.bs-v11-kicker{font-size:10px;letter-spacing:1.6px;font-weight:750;color:#6b8790}
.bs-v11-muted{font-size:13px;color:var(--bs-muted);line-height:1.5;margin:4px 0}
.bs-v11-card{background:white;border:1px solid #e2e9eb;border-radius:13px;padding:23px;box-shadow:0 2px 9px rgba(18,42,50,.03)}
.bs-v11-btn{appearance:none;white-space:nowrap;background:#fff;color:var(--bs-teal);border:1px solid #cad8dc;border-radius:7px;padding:10px 15px;font-family:inherit;font-size:13px;font-weight:650;cursor:pointer}
.bs-v11-btn:hover{background:#f5fafb}.bs-v11-btn:focus-visible{outline:2px solid #218b9c;outline-offset:2px}
.bs-v11-btn.primary{color:#fff;background:var(--bs-teal);border-color:var(--bs-teal)}.bs-v11-btn.primary:hover{background:#0d5263}
.bs-v11-btn:disabled{opacity:.5;cursor:not-allowed}.bs-v11-btn.subtle{border-color:transparent;background:transparent}
.bs-v11-alert{padding:12px 15px;border-radius:7px;font-size:13px;margin-bottom:18px}
.bs-v11-alert.success{background:#eaf6ef;color:#1d6740}.bs-v11-alert.error{background:#fff1f2;color:#9e2b43}
.bs-v11-summary{display:flex;justify-content:space-between;align-items:center;margin:0 0 17px}
.bs-v11-summary>div{display:flex;gap:12px;align-items:baseline}.bs-v11-big{font-weight:700;color:var(--bs-teal);font-size:26px}
.bs-v11-small{font-size:12px;color:#738892}.bs-v11-library{padding:4px 22px}
.bs-v11-search-row{padding:21px 0;display:flex;align-items:center;gap:22px;border-bottom:1px solid #edf1f2}
.bs-v11-search-row label{font-weight:650;font-size:13px;flex:0 0 125px}
.bs-v11-search-row input,.bs-v11-label input,.bs-v11-edit-table input,.bs-v11-import textarea{color:#223943;background:#fff;border:1px solid #d0dcdf;border-radius:6px;font-size:13px;font-family:inherit;padding:10px;box-sizing:border-box}
.bs-v11-search-row input{min-width:0;flex:1;max-width:410px}.bs-v11-search-row input:focus,.bs-v11-label input:focus,.bs-v11-edit-table input:focus{outline:2px solid #b5dee3}
.bs-v11-chart-row{padding:19px 0;border-bottom:1px solid #eef2f3;display:flex;align-items:center;gap:12px}
.bs-v11-chart-row:last-child{border-bottom:0}.bs-v11-chart-icon{width:42px;height:42px;background:#eef5f5;border-radius:9px;display:grid;place-items:center;font-size:20px;color:var(--bs-teal);flex-shrink:0}
.bs-v11-chart-info{flex:1;min-width:0;display:grid;gap:4px}.bs-v11-chart-info strong{color:#123b46;font-size:14px}.bs-v11-chart-info span{font-size:12px;color:var(--bs-muted)}
.bs-v11-empty{padding:40px 20px;text-align:center}.bs-v11-empty h2{margin:0 0 8px;color:var(--bs-teal)}
.bs-v11-steps{display:flex;gap:10px;margin:0 0 18px}.bs-v11-steps button{border:0;background:transparent;color:#687b82;padding:8px 10px 12px;border-bottom:2px solid transparent;font-weight:650;cursor:pointer}
.bs-v11-steps button span{background:#e9eff1;border-radius:50%;display:inline-grid;place-items:center;width:22px;height:22px;margin-right:7px;font-size:11px}
.bs-v11-steps button.selected{border-color:var(--bs-teal);color:var(--bs-teal)}.bs-v11-steps button.selected span{background:var(--bs-teal);color:#fff}
.bs-v11-steps button:disabled{opacity:.48;cursor:not-allowed}
.bs-v11-editor-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(285px,1fr);gap:16px;align-items:start}
.bs-v11-label{display:grid;gap:8px;font-size:13px;font-weight:650;color:#294b56}.bs-v11-label input{height:42px}
.bs-v11-section-title{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:28px 0 13px}
.bs-v11-section-title h2,.bs-v11-preview-card h2,.bs-v11-products h2{margin:0 0 4px;font-size:16px;color:var(--bs-teal);font-weight:700}
.bs-v11-unit-label{border:1px solid #e2e9ec;padding:6px 9px;border-radius:5px;font-size:10px;letter-spacing:1px;color:#527781;font-weight:750}
.bs-v11-table-scroll{overflow:auto;max-width:100%}.bs-v11-edit-table,.bs-v11-table{width:100%;border-collapse:collapse;min-width:320px}
.bs-v11-edit-table th{background:#f3f7f8;text-align:left;font-size:11px;color:#39616c;padding:8px;border-bottom:1px solid #dde8ea}
.bs-v11-edit-table th:first-child{min-width:65px}.bs-v11-edit-table th input{width:calc(100% - 27px);min-width:85px;height:33px;padding:5px 6px;font-size:11px;font-weight:700}
.bs-v11-edit-table th button,.bs-v11-edit-table td>button{background:none;border:0;padding:7px;color:#8b5c66;cursor:pointer;font-size:18px}
.bs-v11-edit-table td{border-bottom:1px solid #edf1f1;padding:6px 5px}.bs-v11-edit-table td input{width:100%;min-width:70px;font-size:12px;padding:8px}
.bs-v11-table-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:13px}.bs-v11-import{margin:19px 0 0;border-top:1px solid #e5eced;padding-top:17px;font-size:12px}
.bs-v11-import summary{cursor:pointer;font-weight:650;color:#385a64}.bs-v11-import textarea{width:100%;margin:9px 0}
.bs-v11-error{color:#a52b40;font-size:12px}.bs-v11-bottom{display:flex;gap:12px;justify-content:space-between;align-items:center;margin-top:26px;border-top:1px solid #eaf0f2;padding-top:18px}
.bs-v11-bottom p{max-width:290px}.bs-v11-preview-card{position:sticky;top:18px}.bs-v11-preview-card-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.bs-v11-preview{border:1px solid #e8eeef;padding:22px 11px 10px;background:#fff;text-align:center}.bs-v11-preview-title{font-size:17px;text-transform:uppercase;color:var(--bs-teal);font-weight:760;letter-spacing:.4px;margin-bottom:16px}
.bs-v11-units{display:flex;justify-content:center;gap:11px;align-items:center;margin-bottom:17px;font-size:11px;color:#8298a0}
.bs-v11-units button{border:0;border-bottom:2px solid transparent;padding:4px 3px 7px;font-weight:650;color:#87969b;background:transparent;cursor:pointer}
.bs-v11-units button.active{border-color:var(--bs-teal);color:var(--bs-teal)}
.bs-v11-table th{background:#f4f6f7;color:#385c66;font-size:11px;font-weight:700;padding:11px 9px;text-align:center;border:1px solid #edf0f0}
.bs-v11-table td{padding:11px 8px;font-size:11px;color:#34515c;text-align:center;border:1px solid #edf0f0}
.bs-v11-preview-note{margin-top:15px;font-size:11px}.bs-v11-products{max-width:770px}.bs-v11-products>p{margin:6px 0 22px}
.bs-v11-btn.picker{border-style:dashed;width:100%;padding:20px;font-size:14px;text-align:center}
.bs-v11-selected{border:1px solid #e0e9e9;border-radius:9px;margin:22px 0;overflow:hidden}.bs-v11-selected-heading{padding:11px 15px;background:#f2f7f8;color:#3c636c;font-weight:700;font-size:12px}
.bs-v11-product-row{display:flex;align-items:center;gap:13px;border-top:1px solid #eef2f2;padding:9px 13px}
.bs-v11-product-image{display:grid;place-items:center;width:42px;height:42px;background:#f1f4f5;border-radius:6px;flex-shrink:0;overflow:hidden}
.bs-v11-product-image img{width:100%;height:100%;object-fit:cover}.bs-v11-product-row strong{flex:1;font-size:13px;font-weight:650}
.bs-v11-product-row>button{border:0;background:transparent;cursor:pointer;font-size:18px;color:#879197}
.bs-v11-products-hint{background:#f5f8f9;border-radius:8px;padding:14px}.bs-v11-checkbox{display:flex;align-items:start;gap:8px;color:#586c75;font-size:12px;margin:19px 0;line-height:1.5}
.bs-v11-checkbox input{margin-top:2px}.bs-v11-products-footer{margin-top:28px;padding-top:16px;border-top:1px solid #eef1f2}
@media(max-width:920px){.bs-v11-editor-grid{grid-template-columns:minmax(0,1fr)}.bs-v11-preview-card{position:static}}
@media(max-width:610px){.bs-v11-top{align-items:start}.bs-v11-top h1{font-size:22px}.bs-v11-card{padding:15px}.bs-v11-chart-row{flex-wrap:wrap}.bs-v11-chart-info{flex-basis:calc(100% - 70px)}.bs-v11-chart-row .bs-v11-btn{flex:1}.bs-v11-search-row{display:grid;gap:9px}.bs-v11-bottom{flex-wrap:wrap}.bs-v11-bottom button{width:100%}.bs-v11-summary{align-items:start;gap:8px}.bs-v11-small{max-width:115px;text-align:right}}
`;
