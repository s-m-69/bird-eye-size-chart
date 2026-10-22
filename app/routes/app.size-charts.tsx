import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useMemo, useState } from "react";
import { authenticate } from "../shopify.server";
import { assignProduct, deleteChart, getCharts, hasDefinition, installDefinition, saveChart, validateChart } from "../models/sizeStudio.server";
import type { Chart, ChartData } from "../models/sizeStudio.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const installed = await hasDefinition(admin);
  const data = installed ? await getCharts(admin) : { charts: [], truncated: false };
  return { installed, ...data };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  try {
    if (intent === "setup") {
      await installDefinition(admin);
      return { ok: "Size Studio is ready. Create your first chart." };
    }
    if (!(await hasDefinition(admin))) throw new Error("Initialize Size Studio first.");
    if (intent === "save") {
      const id = String(form.get("id") || "");
      const chart = validateChart(JSON.parse(String(form.get("payload") || "{}")));
      const current = (await getCharts(admin)).charts;
      if (id && !current.some(c => c.id === id)) throw new Error("Chart not found in this store.");
      if (!id && current.length >= 250) throw new Error("The starter admin editor currently lists at most 250 charts. Pagination is needed beyond that.");
      const result = await saveChart(admin, chart, id || undefined);
      return { ok: `Saved “${chart.name}”. Chart handle: ${result.handle}.` };
    }
    if (intent === "delete") {
      const id = String(form.get("id") || "");
      const current = (await getCharts(admin)).charts;
      if (!current.some(c => c.id === id)) throw new Error("Chart not found.");
      await deleteChart(admin, id);
      return { ok: "Chart deleted. Check PDPs previously using it." };
    }
    if (intent === "assign") {
      const chartHandle = String(form.get("chartHandle") || "");
      const raw = String(form.get("productHandle") || "").trim();
      const inputs = [...new Set(raw.split(/[\n,]+/).map(x => x.trim()).filter(Boolean))];
      if (!inputs.length || inputs.length > 25) throw new Error("Enter 1–25 product URLs or handles, one per line.");
      if (!(await getCharts(admin)).charts.some(c => c.handle === chartHandle)) throw new Error("Select an existing chart.");
      const failures: string[] = [];
      const successful: string[] = [];
      for (const input of inputs) {
        const handle = input.split("/products/").pop()?.split("?")[0]?.replace(/\/$/, "") || "";
        if (!/^[a-z0-9][a-z0-9-]*$/.test(handle)) { failures.push(input + ": invalid handle"); continue; }
        try { successful.push(await assignProduct(admin, handle, chartHandle)); }
        catch (err) { failures.push(input + ": " + (err instanceof Error ? err.message : "failed")); }
      }
      return {
        ok: `Assigned “${chartHandle}” to ${successful.length} product(s).${failures.length ? ` Unassigned: ${failures.slice(0, 4).join("; ")}${failures.length > 4 ? "; and more" : ""}` : ""}`,
      };
    }
    throw new Error("Unknown action.");
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
};

type Draft = Pick<Chart, "name" | "productType" | "tag" | "data">;
function parseSheet(raw: string): string[][] {
  const delimiter = raw.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let cell = "", row: string[] = [], quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && quoted && raw[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && raw[i + 1] === "\n") i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += ch;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

const initial = (): Draft => ({
  name: "",
  productType: "",
  tag: "",
  data: {
    unit: "in",
    columns: ["Size", "Bust", "Underbust"],
    rows: ["XS", "S", "M", "L", "XL"].map((size) => [size, "", ""]),
  },
});
const inputStyle = { width: "100%", minHeight: 39, padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 8, font: "inherit", boxSizing: "border-box" as const, background: "#fff", color: "#13233c" };
const labelStyle = { display: "grid", gap: 5, fontWeight: 600 as const, fontSize: 12, color: "#425466" };
const btn = { border: "1px solid #c7d3df", borderRadius: 8, padding: "9px 13px", background: "#fff", color: "#17273e", cursor: "pointer", fontWeight: 650 as const };
const primary = { ...btn, background: "#173a60", color: "white", borderColor: "#173a60" };
const panel = { padding: 22, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 15, boxShadow: "0 2px 10px rgba(12,24,40,.025)" };
const title = { fontSize: 18, margin: "0 0 5px", fontWeight: 700 as const, color: "#17273e" };

export default function SizeChartsPage() {
  const { installed, charts, truncated } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [editing, setEditing] = useState<string>("__new");
  const [draft, setDraft] = useState<Draft>(initial);
  const [assignChart, setAssignChart] = useState<string>("");
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState("");
  const active = useMemo(() => charts.find(c => c.id === editing), [charts, editing]);
  const update = (fn: (d: Draft) => Draft) => setDraft(d => fn(structuredClone(d)));
  const editChart = (chart: Chart) => {
    setEditing(chart.id);
    setDraft({ name: chart.name, productType: chart.productType, tag: chart.tag, data: structuredClone(chart.data) });
  };
  const importTable = () => {
    const grid = parseSheet(bulkText);
    const length = grid[0]?.length || 0;
    if (grid.length < 2 || length < 2 || length > 9 || grid.length > 41 || grid.some(r => r.length !== length)) {
      setBulkError("Paste a rectangular table of 2–9 columns with a header and 1–40 size rows."); return;
    }
    update(d => ({...d, data: {...d.data, columns: grid[0], rows: grid.slice(1)}}));
    setBulkError(""); setBulkText("");
  };
  const addColumn = () => update(d => ({ ...d, data: { ...d.data, columns: [...d.data.columns, "Measurement"], rows: d.data.rows.map(r => [...r, ""]) } }));
  const removeColumn = (idx: number) => update(d => ({ ...d, data: { ...d.data, columns: d.data.columns.filter((_, i) => i !== idx), rows: d.data.rows.map(r => r.filter((_, i) => i !== idx)) } }));
  return (
    <s-page heading="Size Studio">
      <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif", color: "#17273e", padding: "0 4px 40px" }}>
        <div style={{ padding: "14px 0 20px" }}>
          <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>Individual product charts first. Reuse approved charts across products; category defaults are optional.</p>
        </div>
        {actionData && ("error" in actionData ? <div role="alert" style={{ padding: 13, marginBottom: 17, background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 9, color: "#9f1239" }}>{actionData.error}</div> : <div role="status" style={{ padding: 13, marginBottom: 17, background: "#effcf5", border: "1px solid #bbf7d0", borderRadius: 9, color: "#166534" }}>{actionData.ok}</div>)}
        {!installed ? <section style={panel}>
          <h2 style={title}>Enable your chart library</h2>
          <p style={{ color: "#64748b" }}>Creates Shopify metaobject definitions in your store. Size charts are stored in Shopify, not in an external chart database.</p>
          <Form method="post"><input type="hidden" name="intent" value="setup" /><button type="submit" style={primary}>Initialize Size Studio</button></Form>
        </section> : <>
          <div className="bss-admin-grid" style={{ display: "grid", gridTemplateColumns: "minmax(210px, 270px) minmax(0, 1fr)", gap: 17, alignItems: "start" }}>
            <aside style={panel}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 18 }}><h2 style={{ ...title, margin: 0 }}>Chart library</h2><span style={{ fontSize: 12, color: "#738296" }}>{charts.length}</span></div>
              <button type="button" style={{ ...primary, width: "100%", marginBottom: 8 }} onClick={() => { setEditing("__new"); setDraft(initial()); }}>+ Create size chart</button>
              {active && <button type="button" style={{...btn, width:"100%", marginBottom:12}} onClick={() => { setEditing("__new"); setDraft({name: active.name + " — Copy", productType:"", tag:"", data:structuredClone(active.data)}); }}>Duplicate selected chart</button>}
              {charts.length === 0 && <p style={{ fontSize: 13, color: "#7c8b9b" }}>No charts yet. Create one, then assign it to products. Optional rules save time for shared sizing.</p>}
              {charts.map(c => <button type="button" key={c.id} onClick={() => editChart(c)} style={{ textAlign: "left", width: "100%", border: "1px solid", borderColor: editing === c.id ? "#9ac4e9" : "#eef2f6", padding: 12, marginBottom: 8, borderRadius: 10, background: editing === c.id ? "#eff7ff" : "white", cursor: "pointer" }}><b style={{ display: "block", fontSize: 13 }}>{c.name}</b><span style={{ display: "block", marginTop: 4, fontSize: 11, color: "#64748b" }}>{c.tag ? `#${c.tag}` : c.productType ? `Type: ${c.productType}` : "Product assignment"}</span></button>)}
              {truncated && <p style={{ color: "#b45309" }}>Only the first 250 charts are listed.</p>}
            </aside>
            <main style={panel}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start", marginBottom: 20 }}><div><h2 style={title}>{active ? "Edit size chart" : "Create size chart"}</h2><p style={{ fontSize: 12, margin: 0, color: "#64748b" }}>Enter real measurements. The default numbers are placeholders.</p></div><span style={{ fontSize: 11, background: "#f1f5f9", borderRadius: 30, padding: "6px 10px", color: "#64748b" }}>Draft</span></div>
              <Form method="post">
                <input type="hidden" name="intent" value="save" />
                <input type="hidden" name="id" value={active?.id || ""} />
                <input type="hidden" name="payload" value={JSON.stringify(draft)} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 13 }}>
                  <label style={labelStyle}>Chart name<input style={inputStyle} required value={draft.name} onChange={e => update(d => ({...d, name: e.target.value}))} placeholder="Sports Bra Fit Guide" /></label>
                  <label style={labelStyle}>Optional product-type default<input style={inputStyle} value={draft.productType} onChange={e => update(d => ({...d, productType: e.target.value}))} placeholder="Sports Bra" /></label>
                  <label style={labelStyle}>Optional tag fallback<input style={inputStyle} value={draft.tag} onChange={e => update(d => ({...d, tag: e.target.value}))} placeholder="sizeguide-bra" /></label>
                </div>
                <p style={{ fontSize: 12, color: "#7c8b9b", marginTop: 8 }}>Product assignments always win. Leave both optional defaults blank if this size chart is unique to one product. Do not group different patterns, compression or measurements under one sports-bra chart.</p>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12, padding: "17px 0", borderTop: "1px solid #eef2f6", marginTop: 16 }}>
                  <div role="note" style={{ fontSize: 13, lineHeight: 1.5, background: "#f1f7f7", color: "#083c4a", padding: "11px 14px", width: "100%", border: "1px solid #dce7e8" }}><b>Enter all measurements in inches.</b> Customers can switch between IN (your original values) and CM (automatically rounded to whole numbers). Example: 25.2–26.8 in → 64–68 cm.</div>
                </div>
                <h3 style={{ fontSize: 14, marginBottom: 8 }}>Measurements</h3>
                <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 340 }}>
                  <thead><tr>{draft.data.columns.map((col, ci) => <th key={ci} style={{ padding: 7, minWidth: 100, borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}><div style={{ display: "flex", alignItems: "center", gap: 3 }}><input aria-label={`Column ${ci + 1}`} style={{...inputStyle, padding: "7px 5px", minHeight: 32, fontWeight: 650, fontSize: 12}} value={col} onChange={e => update(d => { d.data.columns[ci] = e.target.value; return d; })} />{ci > 0 && <button aria-label={`Remove ${col}`} type="button" onClick={() => removeColumn(ci)} style={{ border: 0, background: "transparent", color: "#9b3644", cursor: "pointer" }}>×</button>}</div></th>)}<th style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}></th></tr></thead>
                  <tbody>{draft.data.rows.map((row, ri) => <tr key={ri}>{row.map((val, ci) => <td key={ci} style={{ borderBottom: "1px solid #eef2f6", padding: 5 }}><input aria-label={`Row ${ri+1}, ${draft.data.columns[ci]}`} style={{ ...inputStyle, minHeight: 33, padding: "6px 7px", fontSize: 12 }} value={val} onChange={e => update(d => { d.data.rows[ri][ci] = e.target.value; return d; })} /></td>)}<td style={{ textAlign: "center", borderBottom: "1px solid #eef2f6" }}><button type="button" title="Remove size" onClick={() => update(d => ({...d, data: {...d.data, rows: d.data.rows.filter((_, i) => i !== ri)}}))} style={{...btn, padding: "6px 9px"}}>×</button></td></tr>)}</tbody>
                </table></div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button type="button" disabled={draft.data.rows.length >= 40} style={btn} onClick={() => update(d => ({...d, data: {...d.data, rows: [...d.data.rows, d.data.columns.map(() => "")]}}))}>+ Size row</button><button type="button" disabled={draft.data.columns.length >= 9} style={btn} onClick={addColumn}>+ Measurement column</button></div>
                <details style={{ marginTop: 17, padding: "12px 13px", background: "#f6f9fc", borderRadius: 9 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Quick import: paste from Excel / Google Sheets / CSV</summary>
                  <p style={{ fontSize: 12, color: "#64748b" }}>Include the header row (Size, Bust, Waist…). Tab-separated and quoted CSV are supported. This replaces the current grid.</p>
                  <textarea aria-label="Paste spreadsheet measurement table" style={{ ...inputStyle, minHeight: 88 }} rows={4} value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder={"Size\tWaist\tHip\nXS-S\t25.2–26.8\t33.9–35.4\nM\t27.6–29.1\t36.2–37.8"}/>
                  {bulkError && <p style={{color:"#b91c1c",fontSize:12}}>{bulkError}</p>}
                  <button type="button" onClick={importTable} style={{...btn,marginTop:8}}>Import table</button>
                </details>
                <div style={{ display: "flex", gap: 10, marginTop: 20 }}><button type="submit" disabled={navigation.state !== "idle"} style={primary}>{navigation.state !== "idle" ? "Saving…" : "Save size chart"}</button></div>
              </Form>
              {active && <Form method="post" onSubmit={e => { if (!confirm("Delete this chart? It may still be selected on product pages.")) e.preventDefault(); }} style={{ marginTop: 15 }}><input name="intent" type="hidden" value="delete"/><input name="id" type="hidden" value={active.id}/><button type="submit" style={{ ...btn, borderColor: "#fecaca", color: "#b91c1c" }}>Delete chart</button></Form>}
            </main>
          </div>
          <section style={{ ...panel, marginTop: 16 }}>
            <h2 style={title}>Product-specific assignments</h2><p style={{ color: "#64748b", fontSize: 13, marginTop: 0 }}>The product's own chart always wins. Paste 1–25 product handles or PDP URLs, one per line. Colours/size variants within the same product share its chart.</p>
            <Form method="post" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
              <input type="hidden" name="intent" value="assign" />
              <label style={{...labelStyle, flex: "2 1 250px"}}>Product URLs or handles<textarea style={{...inputStyle, minHeight:92}} required name="productHandle" rows={3} placeholder={"/products/align-sports-bra\n/products/anchor-sports-bra"} /></label>
              <label style={{...labelStyle, flex: "1 1 180px"}}>Use chart<select name="chartHandle" required style={inputStyle} value={assignChart} onChange={e => setAssignChart(e.target.value)}><option value="">Select a chart</option>{charts.map(c => <option key={c.id} value={c.handle}>{c.name}</option>)}</select></label>
              <button type="submit" disabled={!charts.length || navigation.state !== "idle"} style={primary}>Assign to products</button>
            </Form>
          </section>
          <p style={{ fontSize: 12, color: "#64748b", marginTop: 16 }}>Storefront setup: Shopify → Online Store → Themes → Customize → Product template → Add block → Apps → Size guide. Save only on your draft theme until verified.</p>
        </>}
      </div>
      <style>{`@media(max-width:720px){.bss-admin-grid{grid-template-columns:minmax(0,1fr)!important}}`}</style>
    </s-page>
  );
}
