import type { SyncPayload, SyncCategory } from './sync-schema';

export interface DashboardSnapshot {
  totals: Record<SyncCategory, number>;
  byRepo: Array<{ repoLabel: string; sessions: number; total: number }>;
  byDay: Array<{ day: string; total: number; categories: Record<SyncCategory, number> }>;
  sessionCount: number;
}

export function buildDashboardSnapshot(payloads: SyncPayload[]): DashboardSnapshot {
  const totals = emptyCategories();
  const sessions = new Set<string>();
  const repoMap = new Map<string, { sessions: Set<string>; total: number }>();
  const dayMap = new Map<string, Record<SyncCategory, number>>();

  for (const payload of payloads) {
    sessions.add(payload.sessionLabel);
    const repo = repoMap.get(payload.repoLabel) ?? { sessions: new Set<string>(), total: 0 };
    repo.sessions.add(payload.sessionLabel);
    const payloadTotal = totalOf(payload.totals);
    repo.total += payloadTotal;
    repoMap.set(payload.repoLabel, repo);
    for (const category of Object.keys(totals) as SyncCategory[]) totals[category] += payload.totals[category];

    const daily = dayMap.get(payload.capturedAt.slice(0, 10)) ?? emptyCategories();
    for (const category of Object.keys(daily) as SyncCategory[]) daily[category] += payload.totals[category];
    dayMap.set(payload.capturedAt.slice(0, 10), daily);
  }

  return {
    totals,
    byRepo: [...repoMap.entries()].map(([repoLabel, value]) => ({ repoLabel, sessions: value.sessions.size, total: value.total })),
    byDay: [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, categories]) => ({ day, total: totalOf(categories), categories })),
    sessionCount: sessions.size,
  };
}

export function totalOf(totals: Record<SyncCategory, number>): number {
  return totals.identifier + totals.comment + totals.string + totals.secret;
}

function emptyCategories(): Record<SyncCategory, number> {
  return { identifier: 0, comment: 0, string: 0, secret: 0 };
}
