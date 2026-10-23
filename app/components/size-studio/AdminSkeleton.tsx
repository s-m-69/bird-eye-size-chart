/** Shapes mirror the actual chart list and CSV review, without a spinner. */
export function AdminSkeleton({ variant = 'library' }: { variant?: 'library' | 'import' }) {
  if (variant === 'import') return <div className="bs-v11-skeleton bs-v11-skeleton-import" role="status" aria-label="Checking and saving imported charts">
    <div className="bs-v11-skeleton-bar wide" /><div className="bs-v11-skeleton-bar medium" />
  </div>;
  return <section className="bs-v11-library bs-v11-skeleton" role="status" aria-label="Loading size chart library">
    <div className="bs-v11-skeleton-search" />
    {[1, 2, 3, 4].map(index => <div className="bs-v11-skeleton-row" key={index}><span className="bs-v11-skeleton-index" /><div><span className="bs-v11-skeleton-bar wide" /><span className="bs-v11-skeleton-bar medium" /></div><span className="bs-v11-skeleton-action" /></div>)}
    <span className="bs-v11-sr-only">Loading size charts</span>
  </section>;
}
