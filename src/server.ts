import { createServer, type IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { logger } from './log.js';
import { transformRequestBody } from './obfuscate/transformRequestBody.js';
import { sessionRenameMap } from './session.js';

// Headers that must not be blindly forwarded between hops: either they
// describe the transport of *this* connection (and would be wrong for the
// new one), or they'd cause res.writeHead to fight with Node's own framing.
// content-length is included unconditionally because the request body may
// be rewritten (obfuscation changes its byte length) — fetch recomputes it
// from whatever body we actually send.
const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
]);

function buildForwardHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function buildResponseHeaders(upstream: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
    headers[key] = value;
  });
  return headers;
}

export function createProxyServer(): Server {
  return createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      logger.error('request.unhandled_error', { error: String(err) });
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'proxy_error', message: 'Unhandled proxy failure' }));
    });
  });
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function prepareObfuscatedBody(raw: Buffer, path: string): Promise<string | Buffer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    logger.warn('obfuscate.body_not_json', { path, error: String(err) });
    return raw;
  }

  const { body: transformed, stats } = await transformRequestBody(parsed, sessionRenameMap);
  logger.info('obfuscate.request_transformed', { path, ...stats });
  return JSON.stringify(transformed);
}

async function handleRequest(req: IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  const start = Date.now();
  const method = req.method ?? 'GET';
  const path = req.url ?? '/';
  const target = new URL(path, config.upstreamBaseUrl);

  logger.info('request.received', { method, path });

  const hasBody = method !== 'GET' && method !== 'HEAD';
  const shouldObfuscate = config.obfuscationEnabled && hasBody && method === 'POST' && target.pathname === '/v1/messages';

  let body: ReadableStream | string | Buffer | undefined;
  if (shouldObfuscate) {
    const raw = await readRequestBody(req);
    body = await prepareObfuscatedBody(raw, path);
  } else if (hasBody) {
    body = Readable.toWeb(req) as unknown as ReadableStream;
  }
  const isStreamingBody = typeof ReadableStream !== 'undefined' && body instanceof ReadableStream;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(target, {
      method,
      headers: buildForwardHeaders(req),
      body,
      duplex: isStreamingBody ? 'half' : undefined,
    } as RequestInit);
  } catch (err) {
    logger.error('request.upstream_unreachable', { method, path, error: String(err) });
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_unreachable', message: String(err) }));
    return;
  }

  res.writeHead(upstreamResponse.status, buildResponseHeaders(upstreamResponse));

  if (!upstreamResponse.body) {
    res.end();
    logger.info('request.forwarded', {
      method,
      path,
      status: upstreamResponse.status,
      durationMs: Date.now() - start,
    });
    return;
  }

  const nodeStream = Readable.fromWeb(upstreamResponse.body as import('node:stream/web').ReadableStream);
  nodeStream.on('error', (err) => {
    logger.error('response.stream_error', { method, path, error: String(err) });
    res.destroy(err);
  });
  nodeStream.on('end', () => {
    logger.info('request.forwarded', {
      method,
      path,
      status: upstreamResponse.status,
      durationMs: Date.now() - start,
    });
  });
  nodeStream.pipe(res);
}
