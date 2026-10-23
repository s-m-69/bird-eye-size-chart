/** V11: Shopify product picker assignment. No schema changes and no theme changes. */
export type ShopifyAdmin = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

async function queryAdmin(admin: ShopifyAdmin, query: string, variables: Record<string, unknown>) {
  const response = await admin.graphql(query, { variables });
  const data = await response.json();
  if (data.errors?.length) {
    throw new Error(data.errors.map((error: { message: string }) => error.message).join('; '));
  }
  if (!data.data) throw new Error('Shopify did not return a result.');
  return data.data;
}

type ProductNode = {
  id: string;
  title: string;
  metafield: { value: string; compareDigest: string } | null;
};

export async function assignProductsById(
  admin: ShopifyAdmin,
  inputIds: string[],
  chartHandle: string,
  allowReplace = false,
) {
  const ids = Array.from(new Set(inputIds));
  if (!ids.length || ids.length > 25) throw new Error('Choose between 1 and 25 products.');
  if (ids.some((id) => !/^gid:\/\/shopify\/Product\/\d+$/.test(id))) {
    throw new Error('One selected product ID is invalid. Please choose products again.');
  }
  if (!chartHandle || chartHandle.length > 255) throw new Error('Select a saved size chart first.');

  const data = await queryAdmin(admin, `#graphql
    query SizeStudioSelectedProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          metafield(namespace: "size_studio", key: "chart_handle") {
            value
            compareDigest
          }
        }
      }
    }`, { ids });
  const products = (data.nodes as Array<ProductNode | null>).filter(
    (node): node is ProductNode => Boolean(node?.id && node?.title),
  );
  if (products.length !== ids.length) {
    throw new Error('Some selected products are no longer available. Please choose products again.');
  }

  const conflicts = products.filter(
    (product) => product.metafield?.value && product.metafield.value !== chartHandle,
  );
  if (conflicts.length && !allowReplace) {
    throw new Error(
      `${conflicts.slice(0, 3).map((product) => product.title).join(', ')}${conflicts.length > 3 ? ' and others' : ''} already ${conflicts.length === 1 ? 'has' : 'have'} another size chart. Enable “Replace existing chart” only if you want to change that assignment.`,
    );
  }

  const changes = products.filter((product) => product.metafield?.value !== chartHandle);
  if (!changes.length) return { count: 0, unchanged: products.length, productTitles: products.map((p) => p.title) };
  const mutation = await queryAdmin(admin, `#graphql
    mutation SizeStudioAssignSelected($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`, {
    metafields: changes.map((product) => ({
      ownerId: product.id,
      namespace: 'size_studio',
      key: 'chart_handle',
      type: 'single_line_text_field',
      value: chartHandle,
      // Avoid racing another staff member's edits.
      compareDigest: product.metafield?.compareDigest ?? null,
    })),
  });
  const result = mutation.metafieldsSet;
  if (!result) throw new Error('Shopify did not confirm the assignment.');
  if (result.userErrors?.length) {
    throw new Error(result.userErrors.map((e: { message: string }) => e.message).join('; '));
  }
  return { count: changes.length, unchanged: products.length - changes.length, productTitles: products.map((p) => p.title) };
}
