export interface WardenConfig {
  port: number;
  upstreamBaseUrl: string;
  obfuscationEnabled: boolean;
  upstreamHeadersTimeoutMs: number;
  redactComments: boolean;
  redactStrings: boolean;
}

function readConfig(env: NodeJS.ProcessEnv): WardenConfig {
  const port = Number.parseInt(env.WARDEN_PORT ?? '8787', 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid WARDEN_PORT: ${env.WARDEN_PORT}`);
  }

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

  const upstreamHeadersTimeoutMs = Number.parseInt(env.WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS ?? '30000', 10);
  if (!Number.isInteger(upstreamHeadersTimeoutMs) || upstreamHeadersTimeoutMs <= 0) {
    throw new Error(`Invalid WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS: ${env.WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS}`);
  }

  return {
    port,
    upstreamBaseUrl,
    obfuscationEnabled: env.WARDEN_OBFUSCATION_DISABLED !== '1',
    upstreamHeadersTimeoutMs,
    redactComments: env.WARDEN_REDACT_COMMENTS !== '0',
    redactStrings: env.WARDEN_REDACT_STRINGS !== '0',
  };
}

export const config = readConfig(process.env);
