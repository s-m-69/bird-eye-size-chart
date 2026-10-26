/** BirdEye Size Studio — Shopify merchant-owned metaobjects; no separate chart DB. */
const CHART_TYPE = "size_studio_chart";
const FIELD_KEYS = ["name", "chart_data", "match_product_type", "match_tag"] as const;

type Admin = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };

async function gql(admin: Admin, query: string, variables: Record<string, unknown> = {}) {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors.map((e: {message: string}) => e.message).join("; "));
  return json.data;
}

function checkMutation<T extends { userErrors?: { message: string }[] }>(payload: T | null): T {
  if (!payload) throw new Error("Shopify returned no response.");
  if (payload.userErrors?.length) throw new Error(payload.userErrors.map(e => e.message).join("; "));
  return payload;
}

export type ChartData = {
  /** Optional merchandising fit indicator: 1=small, 3=true to size, 5=large. */
  fitScale?: number;
  /** Optional support: 1 low, 2 mid, 3 high. */
  supportLevel?: number;
  /** Only verified body ranges can produce a customer size recommendation. */
  recommendationBasis?: "body" | "garment" | "unverified";
  unit: "cm" | "in";
  columns: string[];
  rows: string[][];
};
export type Chart = {
  id: string;
  handle: string;
  name: string;
  productType: string;
  tag: string;
  data: ChartData;
};

export function starterData(): ChartData {
  // Sample values are deliberately illustrative: verify real garment measurements before publishing.
  return {
    unit: "in", columns: ["Size", "Bust", "Underbust"],
    // Leave all example measurement cells empty: never publish unverified sample sizes.
    rows: [["XS", "", ""], ["S", "", ""], ["M", "", ""], ["L", "", ""], ["XL", "", ""]],
  };
}

export async function hasDefinition(admin: Admin): Promise<boolean> {
  const data = await gql(admin, `#graphql
    query SizeStudioDefinition($type: String!) {
      metaobjectDefinitionByType(type: $type) { id }
    }`, { type: CHART_TYPE });
  return Boolean(data.metaobjectDefinitionByType);
}

export async function installDefinition(admin: Admin) {
  if (await hasDefinition(admin)) return;
  const data = await gql(admin, `#graphql
    mutation SizeStudioInstall($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition { id }
        userErrors { message field }
      }
    }`, { definition: {
    name: "Size Studio Chart", type: CHART_TYPE,
    description: "Reusable size guides rendered by BirdEye Size Studio.",
    access: { storefront: "PUBLIC_READ" },
    fieldDefinitions: [
      { key: "name", name: "Name", type: "single_line_text_field", required: true },
      { key: "chart_data", name: "Chart data", type: "json", required: true },
      { key: "match_product_type", name: "Match product type", type: "single_line_text_field" },
      { key: "match_tag", name: "Match product tag", type: "single_line_text_field" },
    ]
  }});
  checkMutation(data.metaobjectDefinitionCreate);
}

export async function getCharts(admin: Admin): Promise<{ charts: Chart[], truncated: boolean }> {
  const charts: Chart[] = [];
  let cursor: string | null = null;
  let hasNext = true;
  while (hasNext && charts.length < 250) {
    const data = await gql(admin, `#graphql
      query SizeStudioCharts($type: String!, $cursor: String) {
        metaobjects(type: $type, first: 100, after: $cursor) {
          nodes { id handle fields { key value } }
          pageInfo { hasNextPage endCursor }
        }
      }`, { type: CHART_TYPE, cursor });
    for (const node of data.metaobjects.nodes) {
      const fields = Object.fromEntries(node.fields.map((f: {key: string; value: string}) => [f.key, f.value]));
      let value: ChartData;
      try { value = JSON.parse(fields.chart_data || "{}"); }
      catch { value = starterData(); }
      charts.push({
        id: node.id, handle: node.handle, name: fields.name || node.handle,
        productType: fields.match_product_type || "", tag: fields.match_tag || "",
        data: value,
      });
    }
    hasNext = data.metaobjects.pageInfo.hasNextPage;
    cursor = data.metaobjects.pageInfo.endCursor;
  }
  return { charts, truncated: hasNext };
}

export function validateChart(value: any): Omit<Chart, "id" | "handle"> {
  const name = String(value?.name || "").trim().slice(0, 120);
  if (!name) throw new Error("Give the chart a name.");
  // Optional fallback, not a sizing constraint. Product assignment always wins.
  const productType = String(value?.productType || "").trim().slice(0, 120);
  const tag = String(value?.tag || "").trim().slice(0, 120);
  const raw = value?.data || {};
  const columns = Array.isArray(raw.columns) ? raw.columns.map((v: any) => String(v).trim().slice(0, 70)) : [];
  const rows = Array.isArray(raw.rows) ? raw.rows.map((r: any) => Array.isArray(r) ? r.map((v: any) => String(v).slice(0, 70)) : []) : [];
  if (columns.length < 2 || columns.length > 9 || columns.some((v: string) => !v)) throw new Error("Add 2–9 named columns (including Size).");
  if (rows.length < 1 || rows.length > 40 || rows.some((r: string[]) => r.length !== columns.length || !r[0]?.trim())) throw new Error("Add 1–40 rows; every row needs a size and the correct number of cells.");
  if (raw.unit && raw.unit !== "in") throw new Error("Enter size-chart measurements in inches. The customer CM view is generated automatically.");
  if (rows.some((r: string[]) => r.slice(1).some(v => !v.trim()))) throw new Error("Fill all measurement cells in inches before saving the chart.");
  const data: ChartData = {
    unit: "in", columns, rows,
  };
  // Never assume True to Size. Existing charts omit fitScale until staff set it.
  const fit = raw.fitScale;
  if (fit !== undefined && fit !== null && fit !== '') {
    if (typeof fit !== 'number' || !Number.isInteger(fit) || fit < 1 || fit > 5) {
      throw new Error('Fit scale must be an integer from 1 to 5, or left blank.');
    }
    data.fitScale = fit;
  }
  // BSS_V12_0_0 — verified body sizing gate and merchandising support marker.
  const support = raw.supportLevel;
  if (support !== undefined && support !== null && support !== '') {
    if (typeof support !== 'number' || !Number.isInteger(support) || support < 1 || support > 3) {
      throw new Error('Support must be Low (1), Mid (2), High (3), or blank.');
    }
    data.supportLevel = support;
  }
  const basis = raw.recommendationBasis;
  if (basis !== undefined && basis !== null && basis !== '') {
    if (!['body', 'garment', 'unverified'].includes(basis)) throw new Error('Invalid body-measurement verification state.');
    data.recommendationBasis = basis;
  }
  if (JSON.stringify(data).length > 26000) throw new Error("Size chart is too large.");
  return { name, productType, tag, data };
}

export async function saveChart(admin: Admin, chart: Omit<Chart,"id"|"handle">, id?: string) {
  const fields = [
    { key: FIELD_KEYS[0], value: chart.name },
    { key: FIELD_KEYS[1], value: JSON.stringify(chart.data) },
    { key: FIELD_KEYS[2], value: chart.productType },
    { key: FIELD_KEYS[3], value: chart.tag },
  ];
  if (id) {
    const response = await gql(admin, `#graphql
      mutation SizeStudioUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message }
        }
      }`, { id, metaobject: { fields } });
    return checkMutation(response.metaobjectUpdate).metaobject;
  }
  const response = await gql(admin, `#graphql
    mutation SizeStudioCreate($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { field message }
      }
    }`, { metaobject: { type: CHART_TYPE, fields } });
  return checkMutation(response.metaobjectCreate).metaobject;
}

export async function deleteChart(admin: Admin, id: string) {
  const response = await gql(admin, `#graphql
    mutation SizeStudioDelete($id: ID!) {
      metaobjectDelete(id: $id) { deletedId userErrors { field message } }
    }`, { id });
  checkMutation(response.metaobjectDelete);
}

export async function assignProduct(admin: Admin, handle: string, chartHandle: string) {
  const productResult = await gql(admin, `#graphql
    query SizeStudioProduct($identifier: ProductIdentifierInput!) {
      product: productByIdentifier(identifier: $identifier) { id title handle }
    }`, { identifier: { handle } });
  const product = productResult.product;
  if (!product) throw new Error(`No product found with handle “${handle}”.`);
  const result = await gql(admin, `#graphql
    mutation SizeStudioAssign($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
    }`, { metafields: [{ ownerId: product.id, namespace: "size_studio", key: "chart_handle", type: "single_line_text_field", value: chartHandle }] });
  checkMutation(result.metafieldsSet);
  return product.title as string;
}
