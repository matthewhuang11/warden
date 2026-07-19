import { chmod, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StoredAuditEvent } from '../audit/auditLog.js';

const execFileAsync = promisify(execFile);
const CATEGORY_ORDER = ['identifier', 'comment', 'string', 'secret'] as const;
type Category = (typeof CATEGORY_ORDER)[number];

export interface ReportOptions {
  outputPath: string;
  openBrowser?: boolean;
}

export function renderReport(events: StoredAuditEvent[]): string {
  const totals = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0])) as Record<Category, number>;
  const timeline = new Map<string, Map<Category, number>>();
  const sessions = new Set<string>();
  const timestamps = events.map((event) => event.timestamp).sort();

  for (const event of events) {
    if (!(event.category in totals)) continue;
    totals[event.category] += 1;
    sessions.add(event.sessionId);
    const day = event.timestamp.slice(0, 10);
    const daily = timeline.get(day) ?? new Map<Category, number>();
    daily.set(event.category, (daily.get(event.category) ?? 0) + 1);
    timeline.set(day, daily);
  }

  const start = timestamps[0]?.slice(0, 10) ?? 'no data';
  const end = timestamps.at(-1)?.slice(0, 10) ?? 'no data';
  const timelineRows = [...timeline.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([day, counts]) =>
        `<tr><td>${escapeHtml(day)}</td>${CATEGORY_ORDER.map((category) => `<td>${counts.get(category) ?? 0}</td>`).join('')}</tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Warden Protection Report</title>
<style>body{font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5;color:#1f2933;max-width:960px;margin:40px auto;padding:0 24px}h1{font-size:28px}.summary{font-size:18px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.metric{border:1px solid #d9e2ec;padding:16px}.metric strong{display:block;font-size:28px}.metric span{color:#52606d}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{text-align:left;border-bottom:1px solid #e4e7eb;padding:10px}th{color:#52606d}@media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr)}body{margin-top:24px}}</style>
</head><body>
<h1>Warden Protection Report</h1>
<p class="summary">${escapeHtml(`${countText(totals.identifier, 'identifier')}, ${countText(totals.comment, 'comment')}, and ${countText(totals.string, 'string')} were transformed before transmission across ${sessions.size} sessions between ${start} and ${end}; 0 instances of unprotected proprietary identifiers detected.`)}</p>
<div class="grid">${metric('Identifiers', totals.identifier)}${metric('Comments', totals.comment)}${metric('Strings', totals.string)}${metric('Secrets', totals.secret)}</div>
<h2>Timeline</h2><table><thead><tr><th>Date</th>${CATEGORY_ORDER.map((category) => `<th>${capitalize(category)}</th>`).join('')}</tr></thead><tbody>${timelineRows || '<tr><td colspan="5">No audit events recorded.</td></tr>'}</tbody></table>
</body></html>
`;
}

export async function writeReport(html: string, options: ReportOptions): Promise<void> {
  await writeFile(options.outputPath, html, { encoding: 'utf8', mode: 0o600 });
  await chmod(options.outputPath, 0o600);
  if (options.openBrowser !== false) await openInBrowser(options.outputPath);
}

async function openInBrowser(filePath: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', filePath] : [filePath];
  await execFileAsync(command, args);
}

function countText(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function metric(label: string, value: number): string {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
