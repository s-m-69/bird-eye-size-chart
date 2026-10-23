/** Shopify-admin-only resource route for chart counts. No writes. */
import type { LoaderFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import { getCharts } from '../models/sizeStudio.server';
import { scanChartUsage } from '../models/sizeStudioUsage.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  try {
    const { charts, truncated } = await getCharts(admin);
    const handles = charts.map((chart) => chart.handle).sort();
    const result = await scanChartUsage(admin, handles, true);
    return {
      signature: handles.join('|'),
      ...result,
      // If chart library is truncated, direct assignment counts for loaded charts
      // may still be complete, but the merchant should see the separate warning.
      chartsTruncated: truncated,
    };
  } catch (error) {
    return {
      signature: '', counts: {} as Record<string, number>,
      products: {} as Record<string, { id: string; title: string; image?: string }[]>,
      complete: false, scanned: 0,
      error: error instanceof Error ? error.message : 'Unable to load product counts.',
    };
  }
};
