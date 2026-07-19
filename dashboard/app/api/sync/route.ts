import { NextResponse } from 'next/server';
import { hasValidBearerToken } from '../../../lib/auth';
import { insertSyncPayload, listSyncPayloads } from '../../../lib/store';
import { parseSyncPayload } from '../../../lib/sync-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!hasValidBearerToken(request.headers.get('authorization'), process.env.WARDEN_ORG_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const payload = parseSyncPayload(await request.json());
    insertSyncPayload(payload);
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: 'invalid_payload', message: error instanceof Error ? error.message : 'Invalid sync payload' },
      { status: 400 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!hasValidBearerToken(request.headers.get('authorization'), process.env.WARDEN_ORG_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ payloads: listSyncPayloads() });
}
