
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getCharts } from "../models/sizeStudio.server";

type Product = {
  id: string;
  title: string;
  featuredImage: { url: string } | null;
  metafield: { value: string } | null;
};

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<Response>;
};

async function readShopify(
  admin: AdminGraphql,
  query: string,
  variables: Record<string, unknown> = {}
) {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();

  if (!response.ok || json.errors?.length || !json.data) {
    throw new Error(
      json.errors?.map((e: { message: string }) => e.message).join("; ") ||
      "Shopify could not load assigned products."
    );
  }

  return json.data;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const chartHandle =
    new URL(request.url).searchParams.get("handle") || "";

  const empty = {
    chartHandle,
    products: [] as { id: string; title: string; image?: string }[],
    incomplete: false,
  };

  if (
    !chartHandle ||
    !/^[a-z0-9][a-z0-9_-]{0,254}$/i.test(chartHandle)
  ) {
    return { ...empty, error: "Invalid size chart handle." };
  }

  try {
    const charts = await getCharts(admin);

    if (!charts.charts.some((c) => c.handle === chartHandle)) {
      return { ...empty, error: "Size chart not found." };
    }

    let canFilter = false;

    try {
      const definitions = await readShopify(
        admin,
        `#graphql
        query SizeStudioProductMetafieldDefinition {
          metafieldDefinitions(
            first: 5,
            ownerType: PRODUCT,
            query: "namespace:size_studio key:chart_handle"
          ) {
            nodes {
              namespace
              key
              capabilities {
                adminFilterable {
                  enabled
                  status
                }
              }
            }
          }
        }`
      );

      const def = definitions.metafieldDefinitions?.nodes?.find(
        (n: { namespace: string; key: string }) =>
          n.namespace === "size_studio" &&
          n.key === "chart_handle"
      );

      canFilter = Boolean(
        def?.capabilities?.adminFilterable?.enabled &&
        def?.capabilities?.adminFilterable?.status === "FILTERABLE"
      );
    } catch {
      // Fall back to reading product metafields directly.
    }

    const products: typeof empty.products = [];
    const seen = new Set<string>();
    const MAX_SCAN = 3000;

    let cursor: string | null = null;
    let hasNextPage = true;
    let scanned = 0;

    while (hasNextPage && scanned < MAX_SCAN) {
      const data = await readShopify(
        admin,
        `#graphql
        query SizeStudioProductsForChart(
          $after: String,
          $filter: String
        ) {
          products(first: 100, after: $after, query: $filter) {
            nodes {
              id
              title
              featuredImage { url }
              metafield(
                namespace: "size_studio",
                key: "chart_handle"
              ) {
                value
              }
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }`,
        {
          after: cursor,
          filter: canFilter
            ? `metafields.size_studio.chart_handle:"${chartHandle}"`
            : null,
        }
      );

      const page = data.products;
      const nodes = page?.nodes as Product[] | undefined;

      if (!nodes || !page.pageInfo) {
        throw new Error("Shopify returned an incomplete product list.");
      }

      scanned += nodes.length;

      for (const product of nodes) {
        if (
          product.metafield?.value === chartHandle &&
          !seen.has(product.id)
        ) {
          seen.add(product.id);

          products.push({
            id: product.id,
            title: product.title,
            image: product.featuredImage?.url,
          });
        }
      }

      hasNextPage = page.pageInfo.hasNextPage;

      const nextCursor = page.pageInfo.endCursor as string | null;

      if (hasNextPage && (!nextCursor || nextCursor === cursor)) {
        throw new Error("Shopify pagination stopped unexpectedly.");
      }

      cursor = nextCursor;
    }

    return {
      chartHandle,
      products,
      incomplete: hasNextPage,
    };
  } catch (error) {
    return {
      ...empty,
      error:
        error instanceof Error
          ? error.message
          : "Could not check assignments.",
    };
  }
};
