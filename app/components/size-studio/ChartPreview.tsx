import { useState } from 'react';
import type { ChartData } from '../../models/sizeStudio.server';

type ChartPreviewProps = { draft: { data: ChartData }; productTitle?: string };

function displayMeasurement(value: string, unit: 'in' | 'cm') {
  return unit === 'in' ? value : value.replace(/\d+(?:\.\d+)?/g,
    (number) => String(Math.round(Number(number) * 2.54)));
}

/** Customer heading always belongs to the Shopify product, not the internal chart. */
export function ChartPreview({ draft, productTitle }: ChartPreviewProps) {
  const [unit, setUnit] = useState<'in' | 'cm'>('in');
  return <section className="bs-v11-preview" aria-label="Customer-facing size guide preview">
    <h3 className="bs-v11-preview-title">{productTitle || 'PRODUCT NAME'}</h3>
    <div className="bs-v11-units" role="group" aria-label="Preview measurement units">
      <button type="button" aria-pressed={unit === 'in'} className={unit === 'in' ? 'active' : ''} onClick={() => setUnit('in')}>IN</button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-pressed={unit === 'cm'} className={unit === 'cm' ? 'active' : ''} onClick={() => setUnit('cm')}>CM</button>
    </div>
    <div className="bs-v11-table-scroll" tabIndex={0} role="region" aria-label="Preview measurements (scroll if needed)">
      <table className="bs-v11-table preview"><thead><tr>{draft.data.columns.map((column, i) => <th scope="col" key={i}>{column || 'Measurement'}</th>)}</tr></thead>
        <tbody>{draft.data.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => c === 0
          ? <th scope="row" key={c}>{cell || '—'}</th>
          : <td key={c}>{cell.trim() ? displayMeasurement(cell, unit) : '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {!productTitle && <p className="bs-v11-muted bs-v11-preview-note">The actual product name appears on its PDP.</p>}
  </section>;
}
