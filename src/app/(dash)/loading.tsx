/** Instant feedback while a page loads (tab taps on the phone feel immediate). */
export default function Loading() {
  const bar = 'animate-pulse rounded-lg bg-slate-200';
  return (
    <div aria-busy="true" aria-label="جارٍ التحميل">
      <div className={`${bar} mb-2 h-7 w-48`} />
      <div className={`${bar} mb-6 h-4 w-72 max-w-full`} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="card p-4"><div className={`${bar} mb-3 h-3 w-24`} /><div className={`${bar} h-7 w-12`} /></div>)}
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="card mb-4 p-4"><div className={`${bar} mb-4 h-5 w-40`} /><div className={`${bar} mb-2 h-3 w-full`} /><div className={`${bar} mb-2 h-3 w-5/6`} /><div className={`${bar} h-3 w-2/3`} /></div>
      ))}
    </div>
  );
}
