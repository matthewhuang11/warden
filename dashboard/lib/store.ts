import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { SyncPayload } from './sync-schema';

let database: DatabaseSync | undefined;

function getDatabase(): DatabaseSync {
  if (database) return database;
  const filePath = process.env.WARDEN_DASHBOARD_DB_PATH ?? path.join(process.cwd(), 'data', 'warden-dashboard.db');
  database = new DatabaseSync(filePath);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS sync_payloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_label TEXT NOT NULL,
      session_label TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  return database;
}

export function insertSyncPayload(payload: SyncPayload): void {
  getDatabase()
    .prepare(
      `INSERT INTO sync_payloads
       (repo_label, session_label, captured_at, period_start, period_end, payload_json, created_at)
       VALUES (@repoLabel, @sessionLabel, @capturedAt, @periodStart, @periodEnd, @payloadJson, @createdAt)`,
    )
    .run({
      repoLabel: payload.repoLabel,
      sessionLabel: payload.sessionLabel,
      capturedAt: payload.capturedAt,
      periodStart: payload.period.start,
      periodEnd: payload.period.end,
      payloadJson: JSON.stringify(payload),
      createdAt: new Date().toISOString(),
    });
}

export function listSyncPayloads(): SyncPayload[] {
  const rows = getDatabase().prepare('SELECT payload_json FROM sync_payloads ORDER BY captured_at ASC').all() as Array<{ payload_json: string }>;
  return rows.map((row) => JSON.parse(row.payload_json) as SyncPayload);
}
