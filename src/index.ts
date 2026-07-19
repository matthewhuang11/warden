import { config } from './config.js';
import { logger } from './log.js';
import { createProxyServer } from './server.js';
import {
  formatUpstreamUrlForDisplay,
  printBanner,
  printPortInUseError,
  printStartupError,
  printUpstreamUnreachableWarning,
} from './consoleOutput.js';

const UPSTREAM_REACHABILITY_CHECK_TIMEOUT_MS = 5000;

const server = createProxyServer();

// Registered before listen() so a synchronous-ish bind failure (most
// commonly EADDRINUSE, another process already on this port) can never
// surface as Node's default unhandled-'error' crash — that prints a raw
// stack trace with no indication of what to actually do about it.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    printPortInUseError(config.port);
    process.exit(1);
  }
  logger.error('server.listen_failed', { port: config.port, error: String(err) });
  printStartupError(config.port, err.message);
  process.exit(1);
});

server.listen(config.port, '127.0.0.1', () => {
  logger.info('server.listening', {
    port: config.port,
    upstream: formatUpstreamUrlForDisplay(config.upstreamBaseUrl),
    obfuscationEnabled: config.obfuscationEnabled,
  });
  printBanner(config.port, config.upstreamBaseUrl, config.obfuscationEnabled);
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
    logger.warn('server.upstream_unreachable_at_startup', {
      upstream: formatUpstreamUrlForDisplay(config.upstreamBaseUrl),
      errorType: err instanceof Error ? err.name : typeof err,
    });
    printUpstreamUnreachableWarning(config.upstreamBaseUrl, String(err));
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('server.shutting_down', { signal });
    server.close(() => process.exit(0));
  });
}
