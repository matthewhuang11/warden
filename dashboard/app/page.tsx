import { listSyncPayloads } from '../lib/store';
import { buildDashboardSnapshot, totalOf } from '../lib/dashboard-data';
import { renderSyncedReport } from '../lib/export-report';

export const dynamic = 'force-dynamic';

const CATEGORY_LABELS = [
  ['identifier', 'Identifiers', 'bg-cyan-600'],
  ['comment', 'Comments', 'bg-amber-500'],
  ['string', 'Strings', 'bg-emerald-600'],
  ['secret', 'Secrets', 'bg-rose-600'],
] as const;

export default function DashboardPage() {
  const payloads = listSyncPayloads();
  const snapshot = buildDashboardSnapshot(payloads);
  const exportHref = `data:text/html;charset=utf-8,${encodeURIComponent(renderSyncedReport(payloads))}`;
  const total = totalOf(snapshot.totals);
  const maxDay = Math.max(...snapshot.byDay.map((day) => day.total), 1);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">Warden / team coverage</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Protection overview</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Aggregate activity from connected Warden sessions. Source code and plaintext identifiers are never shown here.</p>
          </div>
          <a className="inline-flex items-center justify-center border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-500 hover:text-slate-950" download="warden-team-report.html" href={exportHref}>
            Export report
          </a>
        </header>

        <section aria-label="Protection totals" className="grid gap-3 py-8 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORY_LABELS.map(([category, label, color]) => (
            <div className="border border-slate-200 bg-white p-5 shadow-sm" key={category}>
              <div className={`mb-5 h-1 w-10 ${color}`} />
              <p className="font-mono text-xs uppercase tracking-wider text-slate-500">{label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{snapshot.totals[category]}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-8 lg:grid-cols-[1.45fr_1fr]">
          <div className="border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-baseline justify-between gap-4"><h2 className="text-lg font-semibold">Coverage over time</h2><span className="font-mono text-xs text-slate-500">{total} total</span></div>
            {snapshot.byDay.length === 0 ? <p className="mt-8 text-sm text-slate-500">No synced activity yet.</p> : <div className="mt-6 space-y-4">{snapshot.byDay.map((day) => <div className="grid grid-cols-[76px_1fr_48px] items-center gap-3" key={day.day}><span className="font-mono text-xs text-slate-500">{day.day}</span><div className="h-3 bg-slate-100"><div className="h-3 bg-cyan-600" style={{ width: `${Math.max((day.total / maxDay) * 100, 4)}%` }} /></div><span className="text-right font-mono text-xs text-slate-600">{day.total}</span></div>)}</div>}
          </div>
          <div className="border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-baseline justify-between gap-4"><h2 className="text-lg font-semibold">By repository</h2><span className="font-mono text-xs text-slate-500">{snapshot.sessionCount} sessions</span></div>{snapshot.byRepo.length === 0 ? <p className="mt-8 text-sm text-slate-500">No connected repositories yet.</p> : <div className="mt-5 divide-y divide-slate-100">{snapshot.byRepo.map((repo) => <div className="flex items-center justify-between gap-4 py-3" key={repo.repoLabel}><span className="truncate font-mono text-xs text-slate-600">{repo.repoLabel}</span><span className="shrink-0 text-sm font-medium">{repo.total}</span></div>)}</div>}</div>
        </section>

        <footer className="mt-8 border-t border-slate-200 pt-5 text-xs text-slate-500">Synced data is limited to aggregate counts, pseudonymous labels, timestamps, and one-way hashes.</footer>
      </div>
    </main>
  );
}
