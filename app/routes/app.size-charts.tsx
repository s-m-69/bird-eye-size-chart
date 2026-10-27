import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from 'react-router';
import { useAppBridge } from '@shopify/app-bridge-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartPreview } from '../components/size-studio/ChartPreview';
import { AdminSkeleton } from '../components/size-studio/AdminSkeleton';
import { getDraftIssue } from '../components/size-studio/draftValidation';
import { adminStyles } from '../styles/sizeStudioAdmin';
import { authenticate } from '../shopify.server';
import { getCharts, hasDefinition, installDefinition, saveChart, validateChart, deleteChart } from '../models/sizeStudio.server';
import { scanChartUsage } from '../models/sizeStudioUsage.server';
import type { Chart, ChartData } from '../models/sizeStudio.server';
import { assignProductsById } from '../models/sizeStudioAssignments.server';
import { importCsvBatch } from '../models/sizeStudioCsv.server';
import { canonicalChartName, csvTemplate, planCsv, CSV_BATCH_SIZE, CSV_MAX_BYTES } from '../models/sizeStudioCsv';
import type { CsvPlan, ImportResult } from '../models/sizeStudioCsv';
import { planFitCsv, fitCsvTemplate, FIT_BATCH_SIZE } from '../models/sizeStudioFitCsv';
import type { FitUpdate, FitResult } from '../models/sizeStudioFitCsv';
import { updateFitBatch } from '../models/sizeStudioFitCsv.server';
import { planSupportCsv, supportCsvTemplate, SUPPORT_BATCH_SIZE } from '../models/sizeStudioSupportCsv';
import type { SupportUpdate, SupportResult } from '../models/sizeStudioSupportCsv';
import { updateSupportBatch } from '../models/sizeStudioSupportCsv.server';

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
    if (intent === 'delete-chart') {
      const id = String(form.get('id') || '');
      if (form.get('confirmation') !== 'DELETE') throw new Error('Type DELETE to confirm deletion.');
      const { charts, truncated } = await getCharts(admin);
      if (truncated) throw new Error('The chart library is incomplete. Delete is disabled to protect product guides.');
      const chart = charts.find((item) => item.id === id);
      if (!chart) throw new Error('Chart not found. Refresh the library.');
      if (chart.productType?.trim() || chart.tag?.trim()) {
        throw new Error('Remove this chart’s automatic matching rules before deleting it.');
      }
      // Always recheck server-side immediately before deletion; browser counts
      // can become stale after another member of staff assigns a product.
      const usage = await scanChartUsage(admin, [chart.handle]);
      if (!usage.complete) {
        throw new Error('Could not verify every product assignment. Chart was not deleted.');
      }
      if (usage.counts[chart.handle] !== 0) {
        throw new Error(`This chart is assigned to ${usage.counts[chart.handle]} product(s). Reassign those products before deleting it.`);
      }
      await deleteChart(admin, chart.id);
      return { ok: `“${chart.name}” deleted.`, deletedId: chart.id };
    }
    if (intent === 'import-batch') {
      const raw = String(form.get('payload') || '');
      if (raw.length > 30000) throw new Error('Import batch is too large.');
      const batch: unknown = JSON.parse(raw);
      const importResults = await importCsvBatch(admin, batch);
      return { importResults };
    }
    // BSS_V12_0_7_SUPPORT_COMPRESSION — validated server-side before chart update.
    if (intent === 'update-support-batch') {
      const raw=String(form.get('payload') || '');
      if (raw.length>10000) throw new Error('Bar update payload too large.');
      return {supportResults:await updateSupportBatch(admin,JSON.parse(raw))};
    }
    if (intent === 'update-fit-batch') {
      const raw = String(form.get('payload') || '');
      if (raw.length > 10000) throw new Error('Fit update batch is too large.');
      return { fitResults: await updateFitBatch(admin, JSON.parse(raw)) };
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
        assignedHandle: chartHandle,
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
type AssignedProductsData = {
  chartHandle: string;
  products: PickedProduct[];
  incomplete: boolean;
  error?: string;
};
type ChartUsageData = {
  signature: string;
  counts: Record<string, number>;
  products: Record<string, PickedProduct[]>;
  complete: boolean;
  scanned: number;
  error?: string;
};
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
  const assignedFetcher = useFetcher<AssignedProductsData>();
  const usageFetcher = useFetcher<ChartUsageData>();
  const [confirmDelete, setConfirmDelete] = useState<Chart | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const lastCsvResponse = useRef<unknown>(null);

  const active = useMemo(() => charts.find((c) => c.id === editingId), [charts, editingId]);
  const filtered = useMemo(() => charts.filter((c) => c.name.toLowerCase().includes(search.toLowerCase().trim())), [charts, search]);
  const busy = navigation.state !== 'idle';
  const chartSignature = useMemo(() => charts.map((c) => c.handle).sort().join('|'), [charts]);
  const usageReady = usageFetcher.state === 'idle' &&
    usageFetcher.data?.signature === chartSignature && !usageFetcher.data?.error;
  const usage = usageReady ? usageFetcher.data : undefined;
  const assignedLoading = assignedFetcher.state !== 'idle' ||
    (Boolean(active?.handle) && assignedFetcher.data?.chartHandle !== active?.handle);
  const savedAssignments = !assignedLoading && assignedFetcher.data?.chartHandle === active?.handle
    ? assignedFetcher.data : undefined;
  const fitRating = draft.data.fitScale;
  const supportRating = draft.data.supportLevel;
  const saveIssue = fitRating !== undefined && (!Number.isInteger(fitRating) || fitRating < 1 || fitRating > 5)
    ? 'Fit rating must be a whole number between 1 and 5.'
    : supportRating !== undefined && (!Number.isInteger(supportRating) || supportRating < 1 || supportRating > 5)
    ? 'Support/Compression rating must be a whole number between 1 and 5.'
    : draft.data.supportType && supportRating === undefined
    ? 'Enter a rating from 1 to 5 for the selected Support/Compression bar.'
    : getDraftIssue(draft);
  const [csvParsing, setCsvParsing] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);

  useEffect(() => {
    if (actionData && 'savedId' in actionData && actionData.savedId) {
      setEditingId(actionData.savedId);
      setTab('products');
      setScreen('editor');
    }
  }, [actionData]);

  // Aggregate assignment counts once per library view, not once per chart.
  useEffect(() => {
    if (installed && screen === 'library') usageFetcher.load('/app/chart-usage');
  }, [installed, screen, chartSignature]);

  // Dismiss the confirmation after a successful delete, without deleting
  // anything merely because a confirmation dialog was opened.
  useEffect(() => {
    if (actionData && 'deletedId' in actionData && actionData.deletedId) {
      setConfirmDelete(null);
      setDeleteConfirmation('');
    }
  }, [actionData]);

  // Read Shopify's saved product metafields only when an existing chart's
  // product tab opens. This is separate from the add-products picker state.
  useEffect(() => {
    if (screen === 'editor' && tab === 'products' && active?.handle) {
      assignedFetcher.load(`/app/assigned-products?handle=${encodeURIComponent(active.handle)}`);
    }
  }, [screen, tab, active?.handle]);

  // Refresh the assigned list after the existing mutation successfully saves.
  useEffect(() => {
    if (actionData && 'assignedHandle' in actionData &&
        actionData.assignedHandle && actionData.assignedHandle === active?.handle) {
      setSelectedProducts([]);
      assignedFetcher.load(`/app/assigned-products?handle=${encodeURIComponent(actionData.assignedHandle)}`);
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
        <FitCsvUpdater charts={charts} truncated={truncated} />
        <SupportCsvUpdater charts={charts} truncated={truncated} />
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
          <div className="bs-v11-search-row"><label htmlFor="bs-v11-search">Find a size chart</label><input id="bs-v11-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search charts..." /><button type="button" className="bs-v11-btn subtle" disabled={usageFetcher.state !== 'idle'} onClick={() => usageFetcher.load('/app/chart-usage')} aria-label="Refresh product assignment counts">↻ Refresh counts</button></div>
          {truncated && <p className="bs-v11-alert error">Showing the first 250 charts only. This starter requires pagination for larger libraries.</p>}{usageFetcher.data?.error && <p role="alert" className="bs-v11-alert error">Could not load assignment counts: {usageFetcher.data.error}. Deletion remains unavailable.</p>}{usageReady && usage && !usage.complete && <p role="status" className="bs-v11-alert error">Only {usage.scanned} Shopify products were checked; counts are lower bounds. Deleting charts is disabled until the full catalogue can be verified.</p>}
          {!filtered.length ? <div className="bs-v11-empty"><h2>{charts.length ? 'No matching charts' : 'No charts yet'}</h2><p className="bs-v11-muted">{charts.length ? 'Try a different name.' : 'Create your first chart to get started.'}</p><button type="button" className="bs-v11-btn primary" onClick={create}>+ New chart</button></div>
          : filtered.map((chart) => {
            const count = usage?.counts[chart.handle];
            const assignedProducts = usage?.products?.[chart.handle] ?? [];
            const hasAutoMatching = Boolean(chart.productType?.trim() || chart.tag?.trim());
            const deletePermitted = usageReady && usage?.complete && !truncated && count === 0 && !hasAutoMatching;
            const deleteExplanation = !usageReady ? 'Wait for assignment counts to load' :
              !usage?.complete || truncated ? 'The library or product scan is incomplete' :
              hasAutoMatching ? 'Remove automatic matching rules first' :
              count !== 0 ? 'Reassign this chart’s products before deleting' : 'Delete unused chart';
            return <div className="bs-v11-chart-row" key={chart.id}>
              <div className="bs-v11-chart-icon" aria-hidden="true">—</div>
              <div className="bs-v11-chart-info">
                <div className="bs-v11-name-hover">
                  <button type="button" className="bs-v11-chart-name-trigger" aria-label={`Show products assigned to ${chart.name}`} aria-describedby={`bs-v11-assignment-preview-${chart.id}`}>
                    {chart.name}
                  </button>
                  <div className="bs-v11-assignment-popover" id={`bs-v11-assignment-preview-${chart.id}`} role="tooltip">
                    <div className="bs-v11-popover-head">Assigned to following products:</div>
                    {!usageReady ? <p className="bs-v11-popover-empty">{usageFetcher.data?.error ? 'Unable to load assignments.' : 'Checking Shopify assignments…'}</p> : assignedProducts.length ? (
                      <div className="bs-v11-popover-products">
                        {assignedProducts.map((product) => (
                          <div className="bs-v11-popover-product" key={product.id}>
                            <div className="bs-v11-popover-thumb">{product.image ? <img src={product.image} alt="" loading="lazy" /> : <span aria-hidden="true">▧</span>}</div>
                            <span className="bs-v11-popover-title">{product.title}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="bs-v11-popover-empty">No directly assigned products.</p>
                    )}
                    {usageReady && usage && !usage.complete && <p className="bs-v11-popover-incomplete">Partial results — additional assignments may exist.</p>}
                    {hasAutoMatching && <p className="bs-v11-popover-incomplete">Automatic matching rules may apply to other products.</p>}
                  </div>
                </div>
                <span>{chart.data.rows.length} sizes · {Math.max(0, chart.data.columns.length - 1)} measurements · inches</span>
                <div className="bs-v11-count-wrap">
                  <span className={'bs-v11-usage-pill' + (typeof count === 'number' && count > 0 ? ' assigned' : '')}>
                    {!usageReady ? (usageFetcher.data?.error || 'Checking assignments…') :
                      !usage?.complete ? `At least ${count ?? 0} assigned (incomplete)` :
                      `${count ?? 0} product${count === 1 ? '' : 's'} assigned`}
                  </span>
                  {hasAutoMatching && <span className="bs-v11-usage-note">Auto-match rules enabled</span>}
                </div>
              </div>
              <div className="bs-v11-chart-actions">
                <button type="button" className="bs-v11-btn subtle" onClick={() => duplicate(chart)} aria-label={`Duplicate ${chart.name}`}>Duplicate</button>
                <button type="button" className="bs-v11-btn danger" disabled={!deletePermitted || busy} title={deleteExplanation} onClick={() => {setDeleteConfirmation(''); setConfirmDelete(chart);}} aria-label={`Delete ${chart.name}`}>Delete</button>
                <button type="button" className="bs-v11-btn" onClick={() => edit(chart)} aria-label={`Edit ${chart.name}`}>Edit →</button>
              </div>
            </div>;
          })}
        </div>
      </> : <>
        <div className="bs-v11-steps" aria-label="Chart setup steps"><button aria-current={tab === 'measurements' ? 'step' : undefined} className={tab === 'measurements' ? 'selected' : ''} type="button" onClick={() => setTab('measurements')}><span>1</span> Measurements</button>
          <button aria-current={tab === 'products' ? 'step' : undefined} className={tab === 'products' ? 'selected' : ''} type="button" onClick={() => setTab('products')} disabled={!active}><span>2</span> Choose products</button></div>
        {tab === 'measurements' ? <div className="bs-v11-editor-grid">
          <div className="bs-v11-editor">
            <Form method="post" aria-label="Save size chart"><input type="hidden" name="intent" value="save"/><input type="hidden" name="id" value={active?.id || ''}/><input type="hidden" name="payload" value={JSON.stringify(draft)}/>
              <label className="bs-v11-label">Chart name<input required value={draft.name} placeholder="e.g. Flow Leggings" maxLength={120} onChange={(e) => modify((d) => { d.name = e.target.value; })}/></label>
              <div className="bs-v11-fit-editor">
                <label className="bs-v11-label" htmlFor="bs-v11-fit-scale">Fit rating (1–5)
                  <input
                    id="bs-v11-fit-scale"
                    type="number"
                    min={1}
                    max={5}
                    step={1}
                    inputMode="numeric"
                    placeholder="e.g. 3"
                    value={draft.data.fitScale ?? ''}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      modify((chart) => {
                        if (value === '') delete chart.data.fitScale;
                        else chart.data.fitScale = Number(value);
                      });
                    }}
                  />
                </label>
                <p className="bs-v11-muted">1 Runs Small · 2 Slightly Small · 3 True to Size · 4 Slightly Large · 5 Runs Large. Leave blank to hide.</p>
              </div>
              {/* BSS_V12_1_1 — one optional measurement guide image per chart. */}
              <section aria-label="Find My Size measurement image" style={{margin:'14px 0 20px',padding:'17px 20px',border:'1px solid #e3ebed',background:'#fbfcfc'}}>
                <label className="bs-v11-label" htmlFor="bs-v12-measurement-image">Find My Size — measurement image (optional)
                  <input id="bs-v12-measurement-image" type="url" inputMode="url" maxLength={2048}
                    placeholder="https://cdn.shopify.com/..."
                    value={draft.data.measurementImageUrl ?? ''}
                    onChange={(event) => {
                      const url = event.currentTarget.value;
                      modify((d) => {
                        if (!url.trim()) delete d.data.measurementImageUrl;
                        else d.data.measurementImageUrl = url;
                      });
                    }}/>
                </label>
                <p className="bs-v11-muted" style={{margin:'7px 0 0',fontSize:12}}>Upload your annotated measuring image in Shopify Admin → Content → Files, copy its HTTPS link and paste it here. This image will be used for every product assigned to this chart. Leave blank to use the global fallback image.</p>
                {draft.data.measurementImageUrl && draft.data.measurementImageUrl.startsWith('https://') && (
                  <div style={{display:'flex',justifyContent:'center',alignItems:'center',height:150,maxWidth:260,overflow:'hidden',background:'#f2f5f5',marginTop:12}}>
                    <img src={draft.data.measurementImageUrl} alt="Measurement image preview" style={{width:'100%',height:'100%',objectFit:'contain',objectPosition:'center'}}/>
                  </div>
                )}
              </section>
              {/* BSS_V12_0_0 — optional support attribute and body-range approval. */}
              <section className="bs-v12-settings" aria-label="Support and size recommendations">
                {/* BSS_V12_0_7_SUPPORT_COMPRESSION — one optional 1–5 bar per chart. */}
                <label className="bs-v11-label" htmlFor="bs-v12-bar-type">Bar Type (optional)
                  <select id="bs-v12-bar-type" value={draft.data.supportType ?? (draft.data.supportLevel === undefined ? '' : 'support')}
                    onChange={(event) => {
                      const kind = event.currentTarget.value;
                      modify((chart) => {
                        if (!kind) { delete chart.data.supportType; delete chart.data.supportLevel; }
                        else chart.data.supportType = kind as 'support' | 'compression';
                      });
                    }}>
                    <option value="">None — hide bar</option>
                    <option value="support">Support</option>
                    <option value="compression">Compression</option>
                  </select>
                </label>
                <label className="bs-v11-label" htmlFor="bs-v12-bar-rating">Rating (1–5)
                  <input id="bs-v12-bar-rating" type="number" min={1} max={5} step={1} inputMode="numeric"
                    placeholder="1–5" disabled={!draft.data.supportType && draft.data.supportLevel === undefined}
                    value={draft.data.supportLevel ?? ''}
                    onChange={(event) => {
                      const raw = event.currentTarget.value;
                      modify((chart) => {
                        if (raw === '') delete chart.data.supportLevel;
                        else { chart.data.supportLevel = Number(raw); if (!chart.data.supportType) chart.data.supportType = 'support'; }
                      });
                    }}/>
                  <span className="bs-v12-bar-hint">Numeric 1–5, just like Fit. The selected type controls the storefront label. Blank/None hides the bar.</span>
                </label>
                <label className="bs-v11-label">Size recommendation eligibility
                  <select value={draft.data.recommendationBasis ?? 'unverified'} onChange={(e) => {
                    const basis=e.currentTarget.value as 'body' | 'garment' | 'unverified';
                    modify((d) => { d.data.recommendationBasis=basis; });
                  }}>
                    <option value="unverified">Unverified — no recommendations</option>
                    <option value="body">Approved body-measurement ranges</option>
                    <option value="garment">Garment measurements — no recommendations</option>
                  </select>
                </label>
                <p className="bs-v11-muted">Only select Approved body-measurement ranges after confirming the table describes customers’ body dimensions. The calculator will otherwise be disabled.</p>
              </section>
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
          <section aria-label="Products already assigned to this chart" className="bs-v11-assigned-products">
            <h3>Already assigned</h3>
            {assignedLoading ? <p role="status" className="bs-v11-muted">Checking saved Shopify assignments…</p>
            : savedAssignments?.error ? <div role="alert" className="bs-v11-alert error">{savedAssignments.error}</div>
            : savedAssignments?.products.length ? <>
                <p className="bs-v11-muted">{savedAssignments.products.length} product{savedAssignments.products.length === 1 ? '' : 's'} currently use this chart.</p>
                <div className="bs-v11-selected">{savedAssignments.products.map((product) =>
                  <div key={product.id} className="bs-v11-product-row">
                    <span className="bs-v11-product-image">{product.image ? <img src={product.image} alt=""/> : '▧'}</span>
                    <strong>{product.title}</strong>
                    <span className="bs-v11-muted">Assigned</span>
                  </div>)}</div>
              </>
            : <p className="bs-v11-muted">{savedAssignments?.incomplete ? 'No matches among the products checked; additional assignments may exist.' : 'No saved product assignments found for this chart.'}</p>}
            {savedAssignments?.incomplete && <p role="status" className="bs-v11-muted">Only the first 3,000 Shopify products could be checked. This list may be incomplete.</p>}
          </section>
          <button type="button" className="bs-v11-btn picker" onClick={pickProducts} disabled={pickerBusy} aria-busy={pickerBusy}>{pickerBusy ? 'Opening product search…' : 'Add more Shopify products →'}</button>
          {pickerError && <div role="alert" className="bs-v11-alert error">{pickerError}</div>}
          {selectedProducts.length > 0 ? <div className="bs-v11-selected"><div className="bs-v11-selected-heading">{selectedProducts.length} selected product{selectedProducts.length === 1 ? '' : 's'}</div>
            {selectedProducts.map((product) => <div key={product.id} className="bs-v11-product-row"><span className="bs-v11-product-image">{product.image ? <img src={product.image} alt=""/> : '▧'}</span><strong>{product.title}</strong><button type="button" aria-label={`Remove ${product.title}`} onClick={() => setSelectedProducts((list) => list.filter((p) => p.id !== product.id))}>×</button></div>)}
          </div> : <p className="bs-v11-muted bs-v11-products-hint">No additional products selected. Existing assignments above are preserved.</p>}
          <Form method="post"><input name="intent" type="hidden" value="assign-picked"/><input name="chartHandle" type="hidden" value={active?.handle || ''}/><input name="productIds" type="hidden" value={JSON.stringify(selectedProducts.map((p) => p.id))}/>
            <label className="bs-v11-checkbox"><input name="allowReplace" type="checkbox" value="yes" checked={replace} onChange={(e) => setReplace(e.target.checked)}/>Replace a product's existing size chart if it already has a different one</label>
            <button className="bs-v11-btn primary" type="submit" disabled={!active || busy || selectedProducts.length === 0}>Assign chart to {selectedProducts.length || ''} product{selectedProducts.length === 1 ? '' : 's'}</button>
          </Form>
          <div className="bs-v11-products-footer"><button className="bs-v11-btn subtle" type="button" onClick={() => setScreen('library')}>Done — back to charts</button></div>
        </div>}
      </>}
    </div>
    {confirmDelete && <div className="bs-v11-delete-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) {setConfirmDelete(null); setDeleteConfirmation('');} }}>
      <section className="bs-v11-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="bs-v11-delete-title" aria-describedby="bs-v11-delete-desc" onKeyDown={(event) => {if (event.key === 'Escape') {setConfirmDelete(null); setDeleteConfirmation('');}}}>
        <div className="bs-v11-delete-head"><h2 id="bs-v11-delete-title">Delete size chart?</h2><button type="button" className="bs-v11-delete-close" aria-label="Close deletion dialog" onClick={() => {setConfirmDelete(null); setDeleteConfirmation('');}}>×</button></div>
        <p id="bs-v11-delete-desc">This will permanently remove <strong>{confirmDelete.name}</strong> from Shopify. Only unused charts can be deleted. This cannot be undone.</p>
        {actionData && 'error' in actionData && actionData.error && <p className="bs-v11-alert error" role="alert">{actionData.error}</p>}
        <Form method="post">
          <input type="hidden" name="intent" value="delete-chart" />
          <input type="hidden" name="id" value={confirmDelete.id} />
          <label className="bs-v11-label">Type DELETE to confirm<input autoFocus autoComplete="off" name="confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="DELETE" /></label>
          <div className="bs-v11-delete-footer"><button type="button" className="bs-v11-btn" onClick={() => {setConfirmDelete(null);setDeleteConfirmation('');}}>Cancel</button><button type="submit" className="bs-v11-btn danger-solid" disabled={deleteConfirmation !== 'DELETE' || busy}>Delete chart permanently</button></div>
        </Form>
      </section>
    </div>}
    <style>{adminStyles + libraryEnhancementStyles + fitScaleEditorStyles + v12SettingsStyles + v12BarNumericStyles}</style>
  </s-page>;
}

const libraryEnhancementStyles = String.raw`

/* Product hover preview: appears on mouse hover, keyboard focus, and tap-to-focus. */
.bs-v11-chart-row:hover,.bs-v11-chart-row:focus-within{position:relative;z-index:20}
.bs-v11-name-hover{position:relative;width:max-content;max-width:100%}
.bs-v11-name-hover::after{content:"";position:absolute;left:0;top:100%;width:100%;height:12px}
.bs-v11-chart-name-trigger{display:block;max-width:100%;border:0;background:none;padding:2px 0;margin:0;color:var(--bss-ink,#103d4c);font:inherit;font-weight:740;font-size:16px;text-align:left;line-height:1.4;cursor:help;overflow-wrap:anywhere}
.bs-v11-chart-name-trigger:hover{text-decoration:underline;text-underline-offset:3px}
.bs-v11-chart-name-trigger:focus-visible{outline:2px solid #147387;outline-offset:3px}
.bs-v11-assignment-popover{position:absolute;z-index:1000;left:0;top:calc(100% + 9px);width:min(370px,calc(100vw - 36px));padding:0;border:1px solid #d4e0e1;background:#fff;color:#173c48;box-shadow:0 16px 42px rgba(12,38,47,.16);visibility:hidden;opacity:0;pointer-events:none;transform:translateY(-4px);transition:opacity .12s ease,transform .12s ease,visibility .12s}
.bs-v11-name-hover:hover .bs-v11-assignment-popover,.bs-v11-name-hover:focus-within .bs-v11-assignment-popover{visibility:visible;opacity:1;pointer-events:auto;transform:translateY(0)}
.bs-v11-popover-head{font-size:13px;font-weight:750;color:#103d4c;border-bottom:1px solid #e2e9ea;padding:15px 16px}
.bs-v11-popover-products{max-height:290px;overflow-y:auto;overscroll-behavior:contain;padding:5px 12px}
.bs-v11-popover-product{display:flex;align-items:center;gap:12px;padding:9px 4px;border-bottom:1px solid #eef1f1;min-width:0}
.bs-v11-popover-product:last-child{border-bottom:0}
.bs-v11-popover-thumb{display:flex;align-items:center;justify-content:center;width:52px;height:62px;flex:0 0 52px;background:#f3f5f5;border:1px solid #e9eeee;color:#94a2a4;overflow:hidden}
.bs-v11-popover-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.bs-v11-assignment-popover .bs-v11-popover-title{font-size:13px;line-height:1.4;font-weight:600;color:#203c49;overflow-wrap:anywhere}
.bs-v11-popover-empty,.bs-v11-popover-incomplete{font-size:12px;color:#526771;margin:0;padding:13px 16px;line-height:1.45}
.bs-v11-popover-incomplete{border-top:1px solid #e6eded;background:#f8faf9}
@media(hover:none){.bs-v11-chart-name-trigger{cursor:pointer}.bs-v11-assignment-popover{position:fixed;left:14px;right:14px;bottom:16px;top:auto;width:auto;max-height:75vh}}
@media(prefers-reduced-motion:reduce){.bs-v11-assignment-popover{transition:none}}
.bs-v11-count-wrap{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:4px}
.bs-v11-usage-pill{display:inline-flex;width:max-content;max-width:100%;padding:5px 10px;border:1px solid #dae3e4;color:#38505a;background:#f5f8f8;border-radius:3px;font-size:12px;font-weight:680;font-variant-numeric:tabular-nums}
.bs-v11-usage-pill.assigned{background:#eaf3f0;border-color:#c8ddd5;color:#205b46}
.bs-v11-usage-note{font-size:12px;color:#6c5c38}
.bs-v11-chart-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}
.bs-v11-chart-actions .bs-v11-btn{min-width:0}
.bs-v11-chart-actions .bs-v11-btn.danger{color:#922941;background:white;border-color:transparent}
.bs-v11-chart-actions .bs-v11-btn.danger:hover:not(:disabled){background:#fff1f3;border-color:#e1b0b8}
.bs-v11-chart-actions .bs-v11-btn.danger:disabled{border-color:transparent;color:#7c868b;background:transparent;opacity:.7}
.bs-v11-delete-backdrop{position:fixed;z-index:999999;inset:0;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(3,25,34,.48)}
.bs-v11-delete-dialog{background:white;color:#103d4c;border:1px solid #b3c4c8;padding:clamp(20px,4vw,38px);width:min(100%,510px);max-height:85vh;overflow:auto;box-shadow:0 18px 70px rgba(0,20,29,.2)}
.bs-v11-delete-head{display:flex;gap:14px;justify-content:space-between;align-items:start}
.bs-v11-delete-head h2{font-size:24px;font-weight:740;letter-spacing:-.025em;margin:0}
.bs-v11-delete-close{min-width:40px;min-height:40px;font-size:30px;line-height:1;border:0;background:transparent;color:#103d4c}
.bs-v11-delete-dialog p{line-height:1.55;margin:18px 0 22px}
.bs-v11-delete-footer{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:22px}
.bs-v11-btn.danger-solid{border:1px solid #922941;background:#922941;color:white}
.bs-v11-btn.danger-solid:hover:not(:disabled){background:#751c32}
@media(max-width:900px){.bs-v11-chart-actions{justify-content:flex-start}.bs-v11-chart-info{flex-basis:calc(100% - 45px)}.bs-v11-chart-row{flex-wrap:wrap}}
`;

// BSS_V11_3_2_FIT_SCALE — editor-specific styles; the storefront uses its own scoped CSS.
const fitScaleEditorStyles = String.raw`
.bs-v11-fit-editor{border-top:1px solid #e1e9eb;padding:18px 0 14px;margin:14px 0 20px}
.bs-v11-fit-editor .bs-v11-label{display:block;max-width:240px;margin:0}
.bs-v11-fit-editor input{display:block;width:125px;height:42px;margin-top:7px;padding:9px 12px;border:1px solid #b9cdd1;border-radius:0;background:#fff;color:#033C4F;font:inherit;font-size:16px;font-variant-numeric:tabular-nums}
.bs-v11-fit-editor input:focus-visible{outline:2px solid #033C4F;outline-offset:2px}
.bs-v11-fit-editor p{margin:9px 0 0;font-size:12px;line-height:1.5}
.bs-v11-fit-visual{margin:5px 0 20px;padding:0 3px}
.bs-v11-units:has(+ .bs-v11-fit-visual){margin-bottom:9px}
.bs-v11-fit-track{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;height:7px}
.bs-v11-fit-segment{display:block;background:#e5e9ea;min-width:0}
.bs-v11-fit-segment.is-active{background:#033C4F}
.bs-v11-fit-labels{display:flex;justify-content:space-between;gap:10px;margin-top:9px;color:#526974;font-size:11px;line-height:1.3}
.bs-v11-fit-labels span:nth-child(2){text-align:center}
.bs-v11-fit-labels span:last-child{text-align:right}
`;


/** Optional fit-only updater, isolated from the existing create-only measurement importer. */
function FitCsvUpdater({ charts, truncated }: { charts: Chart[]; truncated: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const [updates, setUpdates] = useState<FitUpdate[]>([]);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<FitResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [running, setRunning] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const lastResponse = useRef<unknown>(null);
  const countByName = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chart of charts) {
      const key = canonicalChartName(chart.name);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [charts]);
  const updated = results.filter((r) => r.status === 'updated').length;
  const unchanged = results.filter((r) => r.status === 'unchanged').length;
  const failures = results.filter((r) => r.status === 'error');
  const finished = updates.length > 0 && offset >= updates.length && !running;

  function downloadRatings() {
    const csv = '\uFEFF' + fitCsvTemplate(charts);
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = 'BirdEye_Fit_Ratings.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }
  async function loadRatings(file?: File) {
    if (!file || running || inFlight) return;
    setFilename(file.name); setUpdates([]); setError(''); setResults([]); setOffset(0);
    if (!/\.csv$/i.test(file.name) || file.size > 256 * 1024) {
      setError('Upload a CSV file under 256 KB.'); return;
    }
    if (truncated) { setError('Chart library is incomplete. Bulk updates are disabled.'); return; }
    try {
      const parsed = planFitCsv(await file.text());
      const missing = parsed.filter((item) => countByName.get(canonicalChartName(item.name)) !== 1);
      if (missing.length) throw new Error('Unknown or ambiguous chart names: ' + missing.slice(0, 8).map((c) => c.name).join(', ') + (missing.length > 8 ? '…' : '') + '. All names must match the existing chart library.');
      setUpdates(parsed);
    } catch (err) { setError(err instanceof Error ? err.message : 'The CSV could not be read.'); }
  }
  function runUpdates() {
    if (!updates.length || truncated || inFlight) return;
    setError(''); setResults([]); setOffset(0);
    lastResponse.current = fetcher.data;
    setRunning(true);
  }
  useEffect(() => {
    if (!running || inFlight || fetcher.state !== 'idle') return;
    if (offset >= updates.length) { setRunning(false); return; }
    setInFlight(true);
    fetcher.submit({ intent: 'update-fit-batch', payload: JSON.stringify(updates.slice(offset, offset + FIT_BATCH_SIZE)) }, { method: 'post' });
  }, [running, inFlight, fetcher.state, offset, updates]);
  useEffect(() => {
    if (!inFlight || fetcher.state !== 'idle' || !fetcher.data || fetcher.data === lastResponse.current) return;
    lastResponse.current = fetcher.data;
    setInFlight(false);
    if ('fitResults' in fetcher.data && Array.isArray(fetcher.data.fitResults)) {
      const next = fetcher.data.fitResults as FitResult[];
      setResults((all) => [...all, ...next]);
      if (next.some((row) => row.status === 'error')) {
        setError('Some ratings failed. Check the results; successful rows were saved. Reupload the same file to retry safely.');
        setRunning(false);
      } else {
        setOffset((value) => value + next.length);
      }
    } else {
      const reason = ('error' in fetcher.data && fetcher.data.error) ? String(fetcher.data.error) : 'Shopify did not confirm this batch.';
      setError(reason + ' Reupload the same CSV to retry safely.');
      setRunning(false);
    }
  }, [inFlight, fetcher.state, fetcher.data]);
  return <section className="bs-v11-csv-review" aria-label="Update fit ratings from CSV">
    <div className="bs-v11-review-head"><div>
      <div className="bs-v11-step-index">QUICK UPDATE / EXISTING CHARTS</div>
      <h2>Bulk update fit ratings</h2>
      <p className="bs-v11-muted">Download the prefilled chart list, enter 1–5, save as CSV and upload. Measurements and product assignments stay untouched. Blank = leave unchanged; <strong>clear</strong> = remove rating.</p>
    </div></div>
    <div className="bs-v11-csv-footer" style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
      <button type="button" className="bs-v11-btn" disabled={running || inFlight || truncated || !charts.length} onClick={downloadRatings}>Download my fit ratings CSV ↓</button>
      <label htmlFor="bs-fit-csv-file">Upload updated CSV</label>
      <input id="bs-fit-csv-file" aria-label="Upload fit ratings CSV" type="file" accept=".csv,text/csv" disabled={running || inFlight || truncated} onChange={(event) => void loadRatings(event.target.files?.[0])}/>
    </div>
    {filename && <p className="bs-v11-muted">{filename}</p>}
    {updates.length > 0 && <div className="bs-v11-csv-footer">
      <p className="bs-v11-muted">{updates.length} existing chart rating{updates.length===1?'':'s'} ready. {updates.slice(0,5).map((row) => `${row.name}: ${row.rating ?? 'clear'}`).join(' · ')}{updates.length>5?' …':''}</p>
      <button type="button" className="bs-v11-btn primary" disabled={running || inFlight || truncated || finished} onClick={runUpdates}>{running || inFlight ? 'Updating ratings…' : finished ? 'Ratings updated ✓' : `Update ${updates.length} fit ratings`}</button>
    </div>}
    {results.length > 0 && <p role="status" className="bs-v11-csv-progress">{updated} updated · {unchanged} unchanged · {failures.length} errors · {Math.min(offset,updates.length)} of {updates.length} processed</p>}
    {failures.length > 0 && <p role="alert" className="bs-v11-alert error">{failures.slice(0,4).map((row) => `${row.name}: ${row.message}`).join(' · ')}</p>}
    {error && <p role="alert" className="bs-v11-alert error">{error}</p>}
    {finished && !error && <p role="status" className="bs-v11-alert success">Fit rating update complete. Refresh your chart library to see the latest ratings.</p>}
  </section>;
}

function SupportCsvUpdater({ charts, truncated }: { charts: Chart[]; truncated: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const [updates, setUpdates] = useState<SupportUpdate[]>([]);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<SupportResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [running, setRunning] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const lastResponse = useRef<unknown>(null);
  const countByName = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chart of charts) {
      const key = canonicalChartName(chart.name);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [charts]);
  const updated = results.filter((r) => r.status === 'updated').length;
  const unchanged = results.filter((r) => r.status === 'unchanged').length;
  const failures = results.filter((r) => r.status === 'error');
  const finished = updates.length > 0 && offset >= updates.length && !running;

  function downloadRatings() {
    const csv = '\uFEFF' + supportCsvTemplate(charts);
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = 'BirdEye_Support_Compression_Ratings.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }
  async function loadRatings(file?: File) {
    if (!file || running || inFlight) return;
    setFilename(file.name); setUpdates([]); setError(''); setResults([]); setOffset(0);
    if (!/\.csv$/i.test(file.name) || file.size > 256 * 1024) {
      setError('Upload a CSV file under 256 KB.'); return;
    }
    if (truncated) { setError('Chart library is incomplete. Bulk updates are disabled.'); return; }
    try {
      const parsed = planSupportCsv(await file.text());
      const missing = parsed.filter((item) => countByName.get(canonicalChartName(item.name)) !== 1);
      if (missing.length) throw new Error('Unknown or ambiguous chart names: ' + missing.slice(0, 8).map((c) => c.name).join(', ') + (missing.length > 8 ? '…' : '') + '. All names must match the existing chart library.');
      setUpdates(parsed);
    } catch (err) { setError(err instanceof Error ? err.message : 'The CSV could not be read.'); }
  }
  function runUpdates() {
    if (!updates.length || truncated || inFlight) return;
    setError(''); setResults([]); setOffset(0);
    lastResponse.current = fetcher.data;
    setRunning(true);
  }
  useEffect(() => {
    if (!running || inFlight || fetcher.state !== 'idle') return;
    if (offset >= updates.length) { setRunning(false); return; }
    setInFlight(true);
    fetcher.submit({ intent: 'update-support-batch', payload: JSON.stringify(updates.slice(offset, offset + SUPPORT_BATCH_SIZE)) }, { method: 'post' });
  }, [running, inFlight, fetcher.state, offset, updates]);
  useEffect(() => {
    if (!inFlight || fetcher.state !== 'idle' || !fetcher.data || fetcher.data === lastResponse.current) return;
    lastResponse.current = fetcher.data;
    setInFlight(false);
    if ('supportResults' in fetcher.data && Array.isArray(fetcher.data.supportResults)) {
      const next = fetcher.data.supportResults as SupportResult[];
      setResults((all) => [...all, ...next]);
      if (next.some((row) => row.status === 'error')) {
        setError('Some ratings failed. Check the results; successful rows were saved. Reupload the same file to retry safely.');
        setRunning(false);
      } else {
        setOffset((value) => value + next.length);
      }
    } else {
      const reason = ('error' in fetcher.data && fetcher.data.error) ? String(fetcher.data.error) : 'Shopify did not confirm this batch.';
      setError(reason + ' Reupload the same CSV to retry safely.');
      setRunning(false);
    }
  }, [inFlight, fetcher.state, fetcher.data]);
  return <section className="bs-v11-csv-review" aria-label="Update Support / Compression ratings from CSV">
    <div className="bs-v11-review-head"><div>
      <div className="bs-v11-step-index">QUICK UPDATE / EXISTING CHARTS</div>
      <h2>Bulk update Support / Compression ratings</h2>
      <p className="bs-v11-muted">Download the prefilled chart list. Choose Bar Type = Support or Compression and Rating = 1–5; save as CSV and upload. Measurements and product assignments stay untouched. Blank type and rating = leave unchanged; <strong>clear</strong> = remove rating.</p>
    </div></div>
    <div className="bs-v11-csv-footer" style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
      <button type="button" className="bs-v11-btn" disabled={running || inFlight || truncated || !charts.length} onClick={downloadRatings}>Download my Support / Compression ratings CSV ↓</button>
      <label htmlFor="bs-support-csv-file">Upload updated CSV</label>
      <input id="bs-support-csv-file" aria-label="Upload Support / Compression ratings CSV" type="file" accept=".csv,text/csv" disabled={running || inFlight || truncated} onChange={(event) => void loadRatings(event.target.files?.[0])}/>
    </div>
    {filename && <p className="bs-v11-muted">{filename}</p>}
    {updates.length > 0 && <div className="bs-v11-csv-footer">
      <p className="bs-v11-muted">{updates.length} existing chart rating{updates.length===1?'':'s'} ready. {updates.slice(0,5).map((row) => `${row.name}: ${row.type ? row.type+' '+row.rating : 'clear'}`).join(' · ')}{updates.length>5?' …':''}</p>
      <button type="button" className="bs-v11-btn primary" disabled={running || inFlight || truncated || finished} onClick={runUpdates}>{running || inFlight ? 'Updating ratings…' : finished ? 'Ratings updated ✓' : `Update ${updates.length} Support / Compression ratings`}</button>
    </div>}
    {results.length > 0 && <p role="status" className="bs-v11-csv-progress">{updated} updated · {unchanged} unchanged · {failures.length} errors · {Math.min(offset,updates.length)} of {updates.length} processed</p>}
    {failures.length > 0 && <p role="alert" className="bs-v11-alert error">{failures.slice(0,4).map((row) => `${row.name}: ${row.message}`).join(' · ')}</p>}
    {error && <p role="alert" className="bs-v11-alert error">{error}</p>}
    {finished && !error && <p role="status" className="bs-v11-alert success">Support / Compression rating update complete. Refresh your chart library to see the latest ratings.</p>}
  </section>;
}


// BSS_V12_0_0 — editor settings only, scoped to Size Studio.
const v12SettingsStyles = String.raw`
.bs-v12-settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px;margin:14px 0 20px;padding:20px;border:1px solid #e3ebed;background:#fbfcfc}
.bs-v12-settings .bs-v11-label{display:block;min-width:0}
.bs-v12-settings select{display:block;width:100%;height:43px;margin-top:7px;padding:8px 10px;font:inherit;font-size:13px;color:#033C4F;background:#fff;border:1px solid #b9cdd1;border-radius:0}
.bs-v12-settings select:focus-visible{outline:2px solid #033C4F;outline-offset:2px}
.bs-v12-settings p{grid-column:1/-1;margin:0;font-size:12px;line-height:1.5}
`;

// BSS_V12_0_7_SUPPORT_COMPRESSION — numeric 1–5 input, consistent with Fit.
const v12BarNumericStyles = String.raw`
.bs-v12-settings input[type="number"]{display:block;width:125px;height:42px;margin-top:7px;padding:9px 12px;border:1px solid #b9cdd1;border-radius:0;background:#fff;color:#033C4F;font:inherit;font-size:16px;font-variant-numeric:tabular-nums}
.bs-v12-settings input[type="number"]:focus-visible{outline:2px solid #033C4F;outline-offset:2px}
.bs-v12-bar-hint{display:block;margin-top:8px;font-size:11px;line-height:1.5;color:#526974}
`;
