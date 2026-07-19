import type { SyncPayload } from './sync-schema';
import { buildDashboardSnapshot, totalOf } from './dashboard-data';

export function renderSyncedReport(payloads: SyncPayload[]): string {
  const snapshot = buildDashboardSnapshot(payloads);
  const total = totalOf(snapshot.totals);
  const rows = snapshot.byDay
    .map(
      (day) => `<tr><td>${escapeHtml(day.day)}</td><td>${day.categories.identifier}</td><td>${day.categories.comment}</td><td>${day.categories.string}</td><td>${day.categories.secret}</td><td>${day.total}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Warden Team Protection Report</title><style>body{font:16px Arial,sans-serif;color:#1f2933;max-width:900px;margin:40px auto;padding:0 24px}table{border-collapse:collapse;width:100%}td,th{padding:9px;border-bottom:1px solid #d9e2ec;text-align:left}h1{font-size:28px}</style></head><body><h1>Warden Team Protection Report</h1><p>${total} aggregate transformations across ${snapshot.sessionCount} sessions. No source code or plaintext identifiers are included.</p><table><thead><tr><th>Date</th><th>Identifiers</th><th>Comments</th><th>Strings</th><th>Secrets</th><th>Total</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No data.</td></tr>'}</tbody></table></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
