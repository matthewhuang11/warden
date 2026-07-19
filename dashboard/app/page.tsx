import {
  Activity,
  CheckCircle2,
  CircleDot,
  Database,
  Download,
  FileCode2,
  FolderKanban,
  LayoutDashboard,
  LockKeyhole,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { buildDashboardSnapshot, totalOf, type DashboardSnapshot } from '../lib/dashboard-data';
import { renderSyncedReport } from '../lib/export-report';
import { listSyncPayloads } from '../lib/store';
import type { SyncCategory } from '../lib/sync-schema';

export const dynamic = 'force-dynamic';

const CATEGORY_META: Record<
  SyncCategory,
  { label: string; color: string; dotClass: string; icon: LucideIcon }
> = {
  identifier: { label: 'Identifiers', color: '#2563eb', dotClass: 'bg-blue-600', icon: FileCode2 },
  comment: { label: 'Comments', color: '#d97706', dotClass: 'bg-amber-600', icon: CircleDot },
  string: { label: 'Strings', color: '#7c3aed', dotClass: 'bg-violet-600', icon: Database },
  secret: { label: 'Secrets', color: '#e11d48', dotClass: 'bg-rose-600', icon: LockKeyhole },
};

const CATEGORY_ORDER = Object.keys(CATEGORY_META) as SyncCategory[];

const NAV_ITEMS = [
  { href: '#overview', label: 'Overview', icon: LayoutDashboard },
  { href: '#activity', label: 'Activity', icon: Activity },
  { href: '#repositories', label: 'Repositories', icon: FolderKanban },
] as const;

export default async function DashboardPage() {
  const payloads = await listSyncPayloads();
  const snapshot = buildDashboardSnapshot(payloads);
  const exportHref = `data:text/html;charset=utf-8,${encodeURIComponent(renderSyncedReport(payloads))}`;
  const total = totalOf(snapshot.totals);
  const repoCount = snapshot.byRepo.length;
  const lastUpdated = payloads.length
    ? formatTimestamp(payloads.reduce((latest, payload) => (payload.capturedAt > latest ? payload.capturedAt : latest), ''))
    : 'Waiting for first sync';

  return (
    <div className="min-h-screen bg-[#fafafa] text-[#18181b]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[232px] border-r border-zinc-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-3 border-b border-zinc-200 px-5">
          <BrandMark />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Warden</p>
            <p className="truncate text-xs text-zinc-500">Team protection</p>
          </div>
        </div>

        <nav aria-label="Dashboard sections" className="space-y-1 p-3">
          {NAV_ITEMS.map(({ href, label, icon: Icon }, index) => (
            <a
              className={`flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors ${
                index === 0 ? 'bg-zinc-100 font-medium text-zinc-950' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950'
              }`}
              href={href}
              key={href}
            >
              <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
              {label}
            </a>
          ))}
        </nav>

        <div className="mt-auto border-t border-zinc-200 p-4">
          <div className="flex items-start gap-3">
            <LockKeyhole aria-hidden="true" className="mt-0.5 text-emerald-700" size={16} />
            <div>
              <p className="text-xs font-medium text-zinc-800">Private by design</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">Aggregate counts and one-way hashes only.</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[232px]">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="lg:hidden">
              <BrandMark />
            </div>
            <div className="hidden items-center gap-2 text-sm sm:flex">
              <span className="font-medium text-zinc-900">Team workspace</span>
              <span className="text-zinc-300">/</span>
              <span className="text-zinc-500">Protection</span>
            </div>
            <span className="text-sm font-semibold sm:hidden">Warden</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-600">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
            Sync active
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <section className="scroll-mt-24" id="overview">
            <div className="flex flex-col gap-5 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
                  <ShieldCheck aria-hidden="true" size={15} />
                  Protection overview
                </div>
                <h1 className="text-2xl font-semibold text-zinc-950 sm:text-[28px]">Code privacy, at a glance</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                  Aggregate transformations across connected Warden sessions.
                </p>
              </div>
              <a
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3.5 text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-400 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
                download="warden-team-report.html"
                href={exportHref}
              >
                <Download aria-hidden="true" size={15} />
                Export report
              </a>
            </div>

            <div className="mt-6 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
              <div className="grid grid-cols-2 divide-x divide-y divide-zinc-200 sm:grid-cols-4 sm:divide-y-0">
                {CATEGORY_ORDER.map((category) => {
                  const meta = CATEGORY_META[category];
                  const value = snapshot.totals[category];
                  const share = total === 0 ? 0 : Math.round((value / total) * 100);
                  return (
                    <div className="min-w-0 p-4 sm:p-5" key={category}>
                      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                        <span className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
                        {meta.label}
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <p className="text-2xl font-semibold tabular-nums text-zinc-950 sm:text-[28px]">{formatNumber(value)}</p>
                        <span className="pb-1 text-xs tabular-nums text-zinc-400">{share}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="mt-5 grid scroll-mt-24 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(290px,0.55fr)]" id="activity">
            <div className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900">Protection activity</h2>
                  <p className="mt-1 text-xs text-zinc-500">Transformed items by category and day</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {CATEGORY_ORDER.map((category) => (
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500" key={category}>
                      <span className={`h-2 w-2 rounded-full ${CATEGORY_META[category].dotClass}`} />
                      {CATEGORY_META[category].label}
                    </span>
                  ))}
                </div>
              </div>
              <ActivityChart days={snapshot.byDay} />
            </div>

            <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-5 py-4">
                <h2 className="text-sm font-semibold text-zinc-900">Protection status</h2>
                <p className="mt-1 text-xs text-zinc-500">Last update: {lastUpdated}</p>
              </div>
              <div className="divide-y divide-zinc-100 px-5">
                <StatusRow icon={CheckCircle2} label="Sync pipeline" value="Operational" valueClass="text-emerald-700" />
                <StatusRow icon={FolderKanban} label="Repositories" value={formatNumber(repoCount)} />
                <StatusRow icon={Activity} label="Sessions" value={formatNumber(snapshot.sessionCount)} />
                <StatusRow icon={ShieldCheck} label="Protected items" value={formatNumber(total)} />
              </div>
              <div className="m-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <LockKeyhole aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-700" size={16} />
                  <div>
                    <p className="text-xs font-semibold text-emerald-950">Data boundary enforced</p>
                    <p className="mt-1 text-xs leading-5 text-emerald-800">No source code or plaintext identifiers are stored.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-5 grid scroll-mt-24 gap-5 xl:grid-cols-2" id="repositories">
            <div className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
              <PanelHeader count={`${repoCount} connected`} title="Repositories" />
              <RepositoryTable snapshot={snapshot} total={total} />
            </div>

            <div className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
              <PanelHeader count={`${snapshot.byDay.length} days`} title="Daily activity" />
              <DailyActivityTable days={snapshot.byDay} />
            </div>
          </section>

          <footer className="mt-6 flex flex-col gap-2 border-t border-zinc-200 py-5 text-xs text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
            <span>Warden team protection</span>
            <span>Counts, timestamps, pseudonymous labels, and one-way hashes only</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-white shadow-sm">
      <ShieldCheck aria-hidden="true" size={18} strokeWidth={2} />
    </span>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
  valueClass = 'text-zinc-900',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex h-12 items-center justify-between gap-4">
      <span className="flex items-center gap-2.5 text-xs text-zinc-500">
        <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
        {label}
      </span>
      <span className={`text-xs font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

function PanelHeader({ title, count }: { title: string; count: string }) {
  return (
    <div className="flex h-14 items-center justify-between border-b border-zinc-200 px-5">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      <span className="text-xs tabular-nums text-zinc-400">{count}</span>
    </div>
  );
}

function ActivityChart({ days }: { days: DashboardSnapshot['byDay'] }) {
  if (days.length === 0) {
    return (
      <div className="flex h-[310px] flex-col items-center justify-center px-6 text-center">
        <Activity aria-hidden="true" className="text-zinc-300" size={28} strokeWidth={1.5} />
        <p className="mt-3 text-sm font-medium text-zinc-700">No activity recorded</p>
        <p className="mt-1 text-xs text-zinc-500">Protection totals will appear after the first connected session.</p>
      </div>
    );
  }

  const width = 820;
  const height = 300;
  const margin = { top: 24, right: 18, bottom: 42, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...days.map((day) => day.total), 1);
  const slotWidth = plotWidth / days.length;
  const barWidth = Math.min(38, slotWidth * 0.54);

  return (
    <div className="overflow-x-auto px-3 pb-3 pt-2 sm:px-5">
      <svg aria-label="Protection activity by day and category" className="h-[300px] min-w-[640px] w-full" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, 1, 2, 3, 4].map((step) => {
          const y = margin.top + (plotHeight / 4) * step;
          const value = Math.round(maxValue * (1 - step / 4));
          return (
            <g key={step}>
              <line stroke="#e4e4e7" strokeWidth="1" x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
              <text fill="#a1a1aa" fontSize="11" textAnchor="end" x={margin.left - 10} y={y + 4}>
                {formatNumber(value)}
              </text>
            </g>
          );
        })}
        {days.map((day, index) => {
          const x = margin.left + index * slotWidth + (slotWidth - barWidth) / 2;
          let cursorY = margin.top + plotHeight;
          return (
            <g key={day.day}>
              <title>{`${day.day}: ${day.total} protected items`}</title>
              {CATEGORY_ORDER.map((category) => {
                const segmentHeight = (day.categories[category] / maxValue) * plotHeight;
                cursorY -= segmentHeight;
                return (
                  <rect
                    fill={CATEGORY_META[category].color}
                    height={Math.max(segmentHeight, day.categories[category] > 0 ? 1 : 0)}
                    key={category}
                    rx="2"
                    width={barWidth}
                    x={x}
                    y={cursorY}
                  />
                );
              })}
              <text fill="#71717a" fontSize="11" textAnchor="middle" x={x + barWidth / 2} y={height - 14}>
                {formatDay(day.day)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function RepositoryTable({ snapshot, total }: { snapshot: DashboardSnapshot; total: number }) {
  if (snapshot.byRepo.length === 0) {
    return <EmptyTable icon={FolderKanban} label="No connected repositories" />;
  }

  const repositories = [...snapshot.byRepo].sort((a, b) => b.total - a.total);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="px-5 py-3 font-medium">Repository</th>
            <th className="px-4 py-3 text-right font-medium">Sessions</th>
            <th className="px-4 py-3 text-right font-medium">Protected</th>
            <th className="w-[32%] px-5 py-3 font-medium">Share</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {repositories.map((repo) => {
            const share = total === 0 ? 0 : Math.round((repo.total / total) * 100);
            return (
              <tr className="text-sm" key={repo.repoLabel}>
                <td className="px-5 py-3.5 font-mono text-xs text-zinc-700">{repo.repoLabel}</td>
                <td className="px-4 py-3.5 text-right tabular-nums text-zinc-600">{repo.sessions}</td>
                <td className="px-4 py-3.5 text-right font-medium tabular-nums text-zinc-900">{formatNumber(repo.total)}</td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                      <div className="h-full rounded-full bg-zinc-700" style={{ width: `${Math.max(share, share > 0 ? 3 : 0)}%` }} />
                    </div>
                    <span className="w-8 text-right text-xs tabular-nums text-zinc-400">{share}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DailyActivityTable({ days }: { days: DashboardSnapshot['byDay'] }) {
  if (days.length === 0) return <EmptyTable icon={Activity} label="No daily activity" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] border-collapse text-left">
        <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="px-5 py-3 font-medium">Date</th>
            {CATEGORY_ORDER.map((category) => (
              <th className="px-3 py-3 text-right font-medium" key={category}>
                {CATEGORY_META[category].label.slice(0, 3)}
              </th>
            ))}
            <th className="px-5 py-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {[...days].reverse().slice(0, 7).map((day) => (
            <tr className="text-sm" key={day.day}>
              <td className="px-5 py-3.5 font-medium text-zinc-700">{formatDay(day.day)}</td>
              {CATEGORY_ORDER.map((category) => (
                <td className="px-3 py-3.5 text-right tabular-nums text-zinc-500" key={category}>
                  {formatNumber(day.categories[category])}
                </td>
              ))}
              <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-zinc-900">{formatNumber(day.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyTable({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex h-44 flex-col items-center justify-center text-center">
      <Icon aria-hidden="true" className="text-zinc-300" size={24} strokeWidth={1.5} />
      <p className="mt-3 text-sm text-zinc-500">{label}</p>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDay(day: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00.000Z`),
  );
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(timestamp));
}
