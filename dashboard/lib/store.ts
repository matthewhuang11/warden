import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import postgres from 'postgres';
import type { SyncPayload } from './sync-schema';

let sqliteDatabase: DatabaseSync | undefined;
let postgresClient: ReturnType<typeof postgres> | undefined;
let postgresSchema: Promise<void> | undefined;

function getSqliteDatabase(): DatabaseSync {
  if (sqliteDatabase) return sqliteDatabase;
  const filePath = process.env.WARDEN_DASHBOARD_DB_PATH ?? path.join(process.cwd(), 'data', 'warden-dashboard.db');
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  sqliteDatabase = new DatabaseSync(filePath);
  sqliteDatabase.exec('PRAGMA journal_mode = WAL');
  sqliteDatabase.exec(`
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
  return sqliteDatabase;
}

function getPostgresClient(): ReturnType<typeof postgres> {
  if (postgresClient) return postgresClient;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for hosted dashboard storage');
  postgresClient = postgres(databaseUrl, { max: 1, prepare: false });
  return postgresClient;
}

async function ensurePostgresSchema(): Promise<void> {
  if (!postgresSchema) {
    const sql = getPostgresClient();
    postgresSchema = sql`
      CREATE TABLE IF NOT EXISTS sync_payloads (
        id BIGSERIAL PRIMARY KEY,
        repo_label TEXT NOT NULL,
        session_label TEXT NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL,
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `.then(() => undefined);
  }
  await postgresSchema;
}

export async function insertSyncPayload(payload: SyncPayload): Promise<void> {
  const payloadJson = JSON.stringify(payload);
  const createdAt = new Date().toISOString();
  if (process.env.DATABASE_URL) {
    await ensurePostgresSchema();
    const sql = getPostgresClient();
    await sql`
      INSERT INTO sync_payloads
        (repo_label, session_label, captured_at, period_start, period_end, payload_json, created_at)
      VALUES
        (${payload.repoLabel}, ${payload.sessionLabel}, ${payload.capturedAt}, ${payload.period.start},
         ${payload.period.end}, ${payloadJson}, ${createdAt})
    `;
    return;
  }

  getSqliteDatabase()
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
      payloadJson,
      createdAt,
    });
}

export async function listSyncPayloads(): Promise<SyncPayload[]> {
  if (process.env.DATABASE_URL) {
    await ensurePostgresSchema();
    const sql = getPostgresClient();
    const rows = await sql<{ payload_json: string }[]>`
      SELECT payload_json FROM sync_payloads ORDER BY captured_at ASC
    `;
    return rows.map((row) => JSON.parse(row.payload_json) as SyncPayload);
  }

  const rows = getSqliteDatabase()
    .prepare('SELECT payload_json FROM sync_payloads ORDER BY captured_at ASC')
    .all() as Array<{ payload_json: string }>;
  return rows.map((row) => JSON.parse(row.payload_json) as SyncPayload);
}

export async function closeStore(): Promise<void> {
  sqliteDatabase?.close();
  sqliteDatabase = undefined;
  if (postgresClient) await postgresClient.end({ timeout: 1 });
  postgresClient = undefined;
  postgresSchema = undefined;
}
