import { config } from './config.js';
import { logger } from './log.js';
import { createProxyServer } from './server.js';

const UPSTREAM_REACHABILITY_CHECK_TIMEOUT_MS = 5000;

const server = createProxyServer();

// Registered before listen() so a synchronous-ish bind failure (most
// commonly EADDRINUSE, another process already on this port) can never
// surface as Node's default unhandled-'error' crash — that prints a raw
// stack trace with no indication of what to actually do about it.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      [
        '',
        `Error: port ${config.port} is already in use.`,
        '',
        'Another process is already listening there — either stop it, or run Warden on a different port:',
        '',
        `  WARDEN_PORT=<a free port> npm start`,
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
  logger.error('server.listen_failed', { port: config.port, error: String(err) });
  console.error(`\nError: failed to start Warden on port ${config.port}: ${err.message}\n`);
  process.exit(1);
});

server.listen(config.port, () => {
  logger.info('server.listening', {
    port: config.port,
    upstream: config.upstreamBaseUrl,
    obfuscationEnabled: config.obfuscationEnabled,
  });
  void checkUpstreamReachable();
});

/**
 * Best-effort, non-blocking reachability check for the configured upstream.
 * Deliberately doesn't gate startup or retry — the per-request path already
 * fails individual requests cleanly (502/504) if the upstream is down, so
 * this only exists to surface an obviously-misconfigured or offline upstream
 * immediately with a clear message, rather than leaving a pilot user to
 * discover it via a slow, silent-feeling timeout on their first real request.
 */
async function checkUpstreamReachable(): Promise<void> {
  try {
    await fetch(config.upstreamBaseUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(UPSTREAM_REACHABILITY_CHECK_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn('server.upstream_unreachable_at_startup', { upstream: config.upstreamBaseUrl, error: String(err) });
    console.error(
      [
        '',
        `Warning: could not reach upstream ${config.upstreamBaseUrl} (${String(err)}).`,
        '',
        'Warden will keep running, but requests will fail until this is reachable — check your',
        'network connection or WARDEN_UPSTREAM_BASE_URL.',
        '',
      ].join('\n'),
    );
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('server.shutting_down', { signal });
    server.close(() => process.exit(0));
  });
}
