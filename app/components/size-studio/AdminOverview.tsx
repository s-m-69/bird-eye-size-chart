import type { Chart } from '../../models/sizeStudio.server';
export function AdminOverview({charts}:{charts:Chart[]}){
  const images=charts.filter(c=>Boolean(c.data.measurementImageUrl)).length;
  const approved=charts.filter(c=>c.data.recommendationBasis==='body').length;
  const needsReview=charts.filter(c=>(c.data.recommendationBasis||'unverified')==='unverified').length;
  const bars=charts.filter(c=>typeof c.data.fitScale==='number'||typeof c.data.supportLevel==='number').length;
  const stats=[
    {label:'Size charts',value:charts.length,hint:'In Shopify'},
    {label:'Measurement images',value:images,hint:charts.length?`${Math.round(images/charts.length*100)}% coverage`:'No charts yet'},
    {label:'Approved for recommendations',value:approved,hint:'Body-measurement ranges'},
    {label:'Needs eligibility review',value:needsReview,hint:'Marked unverified'},
  ];
  return <section className="bss-admin-overview" aria-label="Size Studio overview">
    <div className="bss-admin-overview-head"><div><span className="bss-admin-eyebrow">YOUR LIBRARY</span><h2>At a glance</h2></div><span>{bars} charts with Fit or Support/Compression ratings</span></div>
    <div className="bss-admin-kpis">{stats.map(s=><div className="bss-admin-kpi" key={s.label}><span>{s.label}</span><strong>{s.value}</strong><small>{s.hint}</small></div>)}</div>
  </section>;
}
