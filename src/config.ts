export interface WardenConfig {
  port: number;
  upstreamBaseUrl: string;
  obfuscationEnabled: boolean;
  upstreamHeadersTimeoutMs: number;
  maxRequestBodyBytes: number;
  maxBufferedResponseBytes: number;
  maxSseResponseBytes: number;
  maxSessionMappings: number;
  redactComments: boolean;
  redactStrings: boolean;
}

function readPositiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${key}: ${env[key]}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${key}: ${env[key]}`);
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv): WardenConfig {
  const port = readPositiveInteger(env, 'WARDEN_PORT', 8787);
  if (port > 65535) throw new Error(`Invalid WARDEN_PORT: ${env.WARDEN_PORT}`);

  const upstreamBaseUrl = env.WARDEN_UPSTREAM_BASE_URL ?? 'https://api.anthropic.com';
  let parsedUpstream: URL;
  try {
    parsedUpstream = new URL(upstreamBaseUrl);
  } catch {
    throw new Error(`Invalid WARDEN_UPSTREAM_BASE_URL: ${upstreamBaseUrl}`);
  }
  if (!['http:', 'https:'].includes(parsedUpstream.protocol) || parsedUpstream.username || parsedUpstream.password) {
    throw new Error(`Invalid WARDEN_UPSTREAM_BASE_URL: ${upstreamBaseUrl}`);
  }

  const upstreamHeadersTimeoutMs = readPositiveInteger(env, 'WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS', 30000);
  const maxRequestBodyBytes = readPositiveInteger(env, 'WARDEN_MAX_REQUEST_BODY_BYTES', 10 * 1024 * 1024);
  const maxBufferedResponseBytes = readPositiveInteger(env, 'WARDEN_MAX_BUFFERED_RESPONSE_BYTES', 10 * 1024 * 1024);
  const maxSseResponseBytes = readPositiveInteger(env, 'WARDEN_MAX_SSE_RESPONSE_BYTES', 50 * 1024 * 1024);
  const maxSessionMappings = readPositiveInteger(env, 'WARDEN_MAX_SESSION_MAPPINGS', 10000);

  return {
    port,
    upstreamBaseUrl,
    obfuscationEnabled: env.WARDEN_OBFUSCATION_DISABLED !== '1',
    upstreamHeadersTimeoutMs,
    maxRequestBodyBytes,
    maxBufferedResponseBytes,
    maxSseResponseBytes,
    maxSessionMappings,
    redactComments: env.WARDEN_REDACT_COMMENTS !== '0',
    redactStrings: env.WARDEN_REDACT_STRINGS !== '0',
  };
}

export const config = readConfig(process.env);
