export interface WardenConfig {
  port: number;
  upstreamBaseUrl: string;
  obfuscationEnabled: boolean;
  upstreamHeadersTimeoutMs: number;
}

function readConfig(env: NodeJS.ProcessEnv): WardenConfig {
  const port = Number.parseInt(env.WARDEN_PORT ?? '8787', 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid WARDEN_PORT: ${env.WARDEN_PORT}`);
  }

  const upstreamHeadersTimeoutMs = Number.parseInt(env.WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS ?? '30000', 10);
  if (!Number.isInteger(upstreamHeadersTimeoutMs) || upstreamHeadersTimeoutMs <= 0) {
    throw new Error(`Invalid WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS: ${env.WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS}`);
  }

  return {
    port,
    upstreamBaseUrl: env.WARDEN_UPSTREAM_BASE_URL ?? 'https://api.anthropic.com',
    obfuscationEnabled: env.WARDEN_OBFUSCATION_DISABLED !== '1',
    upstreamHeadersTimeoutMs,
  };
}

export const config = readConfig(process.env);
