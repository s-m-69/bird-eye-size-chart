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
    {Number.isInteger(draft.data.fitScale) && Number(draft.data.fitScale) >= 1 && Number(draft.data.fitScale) <= 5 && (
      <div className="bs-v11-fit-visual" role="img" aria-label={`Fit rating ${draft.data.fitScale} of 5: ${['Runs small','Runs slightly small','True to size','Runs slightly large','Runs large'][Number(draft.data.fitScale) - 1]}`}>
        <div className="bs-v11-fit-track" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((value) => <span key={value} className={'bs-v11-fit-segment' + (value === draft.data.fitScale ? ' is-active' : '')} />)}
        </div>
        <div className="bs-v11-fit-labels" aria-hidden="true"><span>Runs Small</span><span>True to Size</span><span>Runs Large</span></div>
      </div>
    )}
    {/* BSS_V12_0_7_SUPPORT_COMPRESSION — 5-point bar, selected label only. */}
    {Number.isInteger(draft.data.supportLevel) && Number(draft.data.supportLevel) >= 1 && Number(draft.data.supportLevel) <= 5 && (
      <div className="bs-v12-support-preview" role="img" aria-label={`${draft.data.supportType === 'compression' ? 'Compression' : 'Support'}: ${draft.data.supportLevel} of 5`} style={{padding:'8px 2px 20px'}}>
        <p style={{fontSize:12,fontWeight:700,margin:'0 0 12px'}}>{draft.data.supportType === 'compression' ? 'Compression' : 'Support'}</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:4,height:9}} aria-hidden="true">
          {[1,2,3,4,5].map(i => <span key={i} style={{background:i===draft.data.supportLevel?'#236b71':'#e9e6e6'}} />)}
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginTop:9,fontSize:10}} aria-hidden="true">
          <span>LOW</span><span>MID</span><span>HIGH</span>
        </div>
      </div>
    )}
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
