/**
 * BirdEye Size Studio — read-only assignment scan for library counts and safe deletion.
 * Source of truth: product metafield size_studio.chart_handle.
 * It never changes products, inventory, variants, or theme data.
 */
export type ShopifyAdmin = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};
export type ChartProduct = {
  id: string;
  title: string;
  image?: string;
};
export type SizeStudioUsage = {
  counts: Record<string, number>;
  products: Record<string, ChartProduct[]>;
  complete: boolean;
  scanned: number;
};

type ProductNode = {
  id: string;
  title?: string;
  featuredImage?: { url: string } | null;
  metafield: { value: string } | null;
};

// This cap avoids unbounded admin requests on large catalogues.
// If reached, result.complete=false and ALL deletion requests fail closed.
const MAX_PRODUCTS = 3000;
const PAGE_SIZE = 100;

export async function scanChartUsage(
  admin: ShopifyAdmin,
  handles: string[],
  includeProductDetails = false,
): Promise<SizeStudioUsage> {
  const recognized = new Set(handles);
  const counts: Record<string, number> = Object.fromEntries(handles.map((handle) => [handle, 0]));
  const products: Record<string, ChartProduct[]> = Object.fromEntries(handles.map((handle) => [handle, []]));
  let after: string | null = null;
  let hasNextPage = true;
  let scanned = 0;

  while (hasNextPage && scanned < MAX_PRODUCTS) {
    const response = await admin.graphql(`#graphql
      query SizeStudioUsage($after: String, $first: Int!, $details: Boolean!) {
        products(first: $first, after: $after) {
          nodes {
            id
            title @include(if: $details)
            featuredImage @include(if: $details) { url }
            metafield(namespace: "size_studio", key: "chart_handle") { value }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { variables: { after, first: Math.min(PAGE_SIZE, MAX_PRODUCTS - scanned), details: includeProductDetails } });

    const json = await response.json();
    if (!response.ok || json.errors?.length || !json.data?.products) {
      const detail = json.errors?.map((e: { message: string }) => e.message).join('; ');
      throw new Error(detail || 'Unable to verify Shopify product assignments.');
    }
    const page = json.data.products as {
      nodes: ProductNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
    if (!Array.isArray(page.nodes) || !page.pageInfo) {
      throw new Error('Shopify returned an incomplete product page.');
    }
    for (const product of page.nodes) {
      const handle = product.metafield?.value;
      if (typeof handle === 'string' && recognized.has(handle)) {
        counts[handle] += 1;
        if (includeProductDetails) {
          products[handle].push({
            id: product.id,
            title: product.title || 'Untitled product',
            ...(product.featuredImage?.url ? { image: product.featuredImage.url } : {}),
          });
        }
      }
    }
    scanned += page.nodes.length;
    hasNextPage = page.pageInfo.hasNextPage;
    const next = page.pageInfo.endCursor;
    if (hasNextPage && (!next || next === after || page.nodes.length === 0)) {
      throw new Error('Product pagination did not advance; counts cannot be verified.');
    }
    after = next;
  }
  return { counts, products, complete: !hasNextPage, scanned };
}
