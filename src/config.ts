export interface WardenConfig {
  port: number;
  upstreamBaseUrl: string;
  obfuscationEnabled: boolean;
}

function readConfig(env: NodeJS.ProcessEnv): WardenConfig {
  const port = Number.parseInt(env.WARDEN_PORT ?? '8787', 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid WARDEN_PORT: ${env.WARDEN_PORT}`);
  }

  return {
    port,
    upstreamBaseUrl: env.WARDEN_UPSTREAM_BASE_URL ?? 'https://api.anthropic.com',
    obfuscationEnabled: env.WARDEN_OBFUSCATION_DISABLED !== '1',
  };
}

export const config = readConfig(process.env);
