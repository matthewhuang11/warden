import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { Readable, Transform } from 'node:stream';
import { config } from './config.js';
import { logger } from './log.js';
import { transformRequestBody } from './obfuscate/transformRequestBody.js';
import { sessionRenameMap } from './session.js';
import { rehydrateSseStream } from './rehydrate/sseRehydrate.js';
import { rehydrateJsonValue } from './rehydrate/rehydrateJson.js';
import {
  printExchangeRequestMarker,
  printExchangeResponseMarker,
  printObfuscationSummary,
} from './consoleOutput.js';
import { recordAuditEvents } from './audit/runtime.js';
import type { TransformStats } from './obfuscate/transformRequestBody.js';

let nextExchangeId = 0;

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

function safeLogPath(path: string): string {
  try {
    return new URL(path, 'http://warden.invalid').pathname || '/';
  } catch {
    return '[invalid-request-target]';
  }
}

function errorType(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function hasValidAuthToken(req: IncomingMessage): boolean {
  if (config.authToken === undefined) return true;
  const supplied = req.headers['x-warden-token'];
  if (typeof supplied !== 'string') return false;
  const expected = Buffer.from(config.authToken);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createProxyServer(): Server {
  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      logger.error('request.unhandled_error', { errorType: errorType(err) });
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'proxy_error', message: 'Unhandled proxy failure' }));
    });
  });
  server.headersTimeout = config.clientHeadersTimeoutMs;
  server.requestTimeout = config.requestTimeoutMs;
  server.keepAliveTimeout = 5000;
  return server;
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const contentLength = req.headers['content-length'];
  if (typeof contentLength === 'string') {
    const declaredLength = Number.parseInt(contentLength, 10);
    if (Number.isSafeInteger(declaredLength) && declaredLength > config.maxRequestBodyBytes) {
      req.resume();
      throw new RequestBodyTooLargeError();
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    totalBytes += buffer.length;
    if (totalBytes > config.maxRequestBodyBytes) {
      req.resume();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the configured maximum size');
    this.name = 'RequestBodyTooLargeError';
  }
}

class ResponseBodyTooLargeError extends Error {
  constructor() {
    super('Upstream response exceeds the configured buffering limit');
    this.name = 'ResponseBodyTooLargeError';
  }
}

class SseResponseTooLargeError extends Error {
  constructor() {
    super('SSE response exceeds the configured maximum size');
    this.name = 'SseResponseTooLargeError';
  }
}

function limitSseStream(source: Readable): Readable {
  let totalBytes = 0;
  const limited = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > config.maxSseResponseBytes) {
        callback(new SseResponseTooLargeError());
        return;
      }
      callback(null, buffer);
    },
  });
  source.on('error', (err) => limited.destroy(err));
  limited.on('error', () => source.destroy());
  return source.pipe(limited);
}

async function readBufferedResponse(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const bytes = Number.parseInt(declaredLength, 10);
    if (Number.isSafeInteger(bytes) && bytes > config.maxBufferedResponseBytes) {
      await response.body?.cancel();
      throw new ResponseBodyTooLargeError();
    }
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > config.maxBufferedResponseBytes) {
        await reader.cancel();
        throw new ResponseBodyTooLargeError();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface PreparedBody {
  body: string | Buffer;
  stats: TransformStats;
}

function emptyTransformStats(): TransformStats {
  return {
    blocksScanned: 0,
    blocksRenamed: 0,
    totalIdentifiersRenamed: 0,
    commentsRedacted: 0,
    stringsRedacted: 0,
    derivedConstantsRedacted: 0,
    secretsRedacted: 0,
    auditEvents: [],
    blocks: [],
  };
}

async function prepareObfuscatedBody(raw: Buffer, path: string): Promise<PreparedBody> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    logger.warn('obfuscate.body_not_json', { path, errorType: errorType(err) });
    return { body: raw, stats: emptyTransformStats() };
  }

  // transformRequestBody is defensive about shape, but the body is
  // client-controlled and JSON.stringify itself isn't immune to pathological
  // input (e.g. it throws RangeError on extreme nesting depth, unlike
  // JSON.parse). Anything unexpected here should degrade to forwarding the
  // original request untouched rather than failing it outright — obfuscation
  // is a best-effort privacy layer, not something worth blocking traffic for.
  try {
    const { body: transformed, stats } = await transformRequestBody(parsed, sessionRenameMap);
    await recordAuditEvents(stats.auditEvents);
    logger.info('obfuscate.request_transformed', { path, ...stats });
    printObfuscationSummary(stats);
    return { body: JSON.stringify(transformed), stats };
  } catch (err) {
    logger.error('obfuscate.transform_failed', { path, errorType: errorType(err) });
    return { body: raw, stats: emptyTransformStats() };
  }
}

async function handleRequest(req: IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  const start = Date.now();
  const method = req.method ?? 'GET';
  const path = req.url ?? '/';
  const logPath = safeLogPath(path);

  if (!hasValidAuthToken(req)) {
    res.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="warden"',
    });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  // Warden is a forward proxy for one configured origin, not an open proxy.
  // Reject absolute-form and protocol-relative request targets before URL
  // resolution so a client cannot redirect a request to another host.
  if (/^(?:https?:)?\/\//i.test(path)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_request_target' }));
    return;
  }

  let target: URL;
  try {
    target = new URL(path, config.upstreamBaseUrl);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_request_target' }));
    return;
  }

  logger.info('request.received', { method, path: logPath });

  const hasBody = method !== 'GET' && method !== 'HEAD';
  const shouldObfuscate = config.obfuscationEnabled && hasBody && method === 'POST' && target.pathname === '/v1/messages';
  const exchangeId = shouldObfuscate ? ++nextExchangeId : undefined;
  let responseMarkerPrinted = false;
  const markResponse = (status: number) => {
    if (exchangeId === undefined || responseMarkerPrinted) return;
    responseMarkerPrinted = true;
    printExchangeResponseMarker(exchangeId, status, Date.now() - start);
  };

  let body: ReadableStream | string | Buffer | undefined;
  if (hasBody) {
    let raw: Buffer;
    try {
      raw = await readRequestBody(req);
    } catch (err) {
      if (err instanceof RequestBodyTooLargeError) {
        logger.warn('request.body_too_large', { method, path: logPath, maxBytes: config.maxRequestBodyBytes });
        if (exchangeId !== undefined) printExchangeRequestMarker(exchangeId, emptyTransformStats());
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'request_body_too_large' }));
        markResponse(413);
        return;
      }
      throw err;
    }
    if (shouldObfuscate) {
      const prepared = await prepareObfuscatedBody(raw, logPath);
      body = prepared.body;
      printExchangeRequestMarker(exchangeId!, prepared.stats);
    } else {
      body = raw;
    }
  }
  const isStreamingBody = typeof ReadableStream !== 'undefined' && body instanceof ReadableStream;

  // Bounds only the wait for response headers — a slow-or-unreachable
  // upstream (accepted the connection but never replied) would otherwise
  // hang this request forever, since fetch has no default timeout. Once
  // headers arrive the timer is cleared and never fires again, so a long
  // legitimate streaming completion afterward is never cut short by it.
  const headersController = new AbortController();
  const headersTimeout = setTimeout(
    () => headersController.abort(new Error(`Upstream did not respond within ${config.upstreamHeadersTimeoutMs}ms`)),
    config.upstreamHeadersTimeoutMs,
  );

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(target, {
      method,
      headers: buildForwardHeaders(req),
      body,
      duplex: isStreamingBody ? 'half' : undefined,
      signal: headersController.signal,
    } as RequestInit);
  } catch (err) {
    const timedOut = headersController.signal.aborted;
    logger.error(timedOut ? 'request.upstream_timeout' : 'request.upstream_unreachable', {
      method,
      path: logPath,
      errorType: errorType(err),
    });
    res.writeHead(timedOut ? 504 : 502, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: timedOut ? 'upstream_timeout' : 'upstream_unreachable',
        message: timedOut ? 'The upstream did not respond in time' : 'The upstream could not be reached',
      }),
    );
    markResponse(timedOut ? 504 : 502);
    return;
  } finally {
    clearTimeout(headersTimeout);
  }

  const logForwarded = () => {
    logger.info('request.forwarded', {
      method,
      path: logPath,
      status: upstreamResponse.status,
      durationMs: Date.now() - start,
    });
    markResponse(upstreamResponse.status);
  };

  if (!upstreamResponse.body) {
    res.writeHead(upstreamResponse.status, buildResponseHeaders(upstreamResponse));
    res.end();
    logForwarded();
    return;
  }

  const contentType = upstreamResponse.headers.get('content-type') ?? '';

  if (shouldObfuscate && contentType.includes('text/event-stream')) {
    res.writeHead(upstreamResponse.status, buildResponseHeaders(upstreamResponse));
    const upstreamNodeStream = Readable.fromWeb(upstreamResponse.body as import('node:stream/web').ReadableStream);
    const rehydratedStream = limitSseStream(Readable.from(rehydrateSseStream(upstreamNodeStream, sessionRenameMap)));
    rehydratedStream.on('error', (err) => {
      logger.error('response.stream_error', { method, path: logPath, errorType: errorType(err) });
      markResponse(upstreamResponse.status);
      res.destroy(err);
    });
    rehydratedStream.on('end', logForwarded);
    rehydratedStream.pipe(res);
    return;
  }

  if (shouldObfuscate && contentType.includes('application/json')) {
    let rawText: string;
    try {
      rawText = await readBufferedResponse(upstreamResponse);
    } catch (err) {
      if (err instanceof ResponseBodyTooLargeError) {
        logger.warn('rehydrate.response_too_large', {
          method,
          path: logPath,
          maxBytes: config.maxBufferedResponseBytes,
        });
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream_response_too_large' }));
        markResponse(502);
        return;
      }
      throw err;
    }
    let output = rawText;
    try {
      const parsed = JSON.parse(rawText);
      output = JSON.stringify(rehydrateJsonValue(parsed, sessionRenameMap));
    } catch (err) {
      logger.warn('rehydrate.response_not_json', { method, path: logPath, errorType: errorType(err) });
    }
    res.writeHead(upstreamResponse.status, buildResponseHeaders(upstreamResponse));
    res.end(output);
    logForwarded();
    return;
  }

  res.writeHead(upstreamResponse.status, buildResponseHeaders(upstreamResponse));
  const nodeStream = Readable.fromWeb(upstreamResponse.body as import('node:stream/web').ReadableStream);
  nodeStream.on('error', (err) => {
    logger.error('response.stream_error', { method, path: logPath, errorType: errorType(err) });
    markResponse(upstreamResponse.status);
    res.destroy(err);
  });
  nodeStream.on('end', logForwarded);
  nodeStream.pipe(res);
}
