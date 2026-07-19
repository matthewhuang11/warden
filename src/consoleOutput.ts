import type { TransformStats } from './obfuscate/transformRequestBody.js';

// The polished, human-readable output shown by default (as opposed to the
// structured JSON logs in log.ts, which are opt-in via WARDEN_VERBOSE=1).
// Purely presentational — never affects what gets obfuscated or how.

export function formatUpstreamUrlForDisplay(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid upstream URL]';
  }
}

export function printBanner(port: number, upstreamBaseUrl: string, obfuscationEnabled: boolean): void {
  const displayUrl = formatUpstreamUrlForDisplay(upstreamBaseUrl);
  if (!obfuscationEnabled) {
    console.log(`⚠ Warden is running on :${port} — obfuscation is DISABLED, traffic is passing straight through to ${displayUrl}`);
    return;
  }
  console.log(`✓ Warden is running · protecting Claude Code traffic on :${port}`);
}

export function printUpstreamUnreachableWarning(upstreamBaseUrl: string, error: string): void {
  const displayUrl = formatUpstreamUrlForDisplay(upstreamBaseUrl);
  console.error(
    [
      '',
      `⚠ Warning: could not reach upstream ${displayUrl} (${error}).`,
      '',
      'Warden will keep running, but requests will fail until this is reachable — check your',
      'network connection or WARDEN_UPSTREAM_BASE_URL.',
      '',
    ].join('\n'),
  );
}

export function printPortInUseError(port: number): void {
  console.error(
    [
      '',
      `✗ Error: port ${port} is already in use.`,
      '',
      'Another process is already listening there — either stop it, or run Warden on a different port:',
      '',
      `  WARDEN_PORT=<a free port> npm start`,
      '',
    ].join('\n'),
  );
}

export function printStartupError(port: number, message: string): void {
  console.error(`\n✗ Error: failed to start Warden on port ${port}: ${message}\n`);
}

/** One concise line per request that actually renamed something — nothing
 * is printed for a pass-through request with zero renames, to keep normal
 * usage quiet. */
export function printObfuscationSummary(stats: TransformStats): void {
  if (stats.totalIdentifiersRenamed === 0) return;

  const labels = [...new Set(stats.blocks.map((b) => b.label))];
  const where = labels.length === 1 ? ` in ${labels[0]}` : labels.length > 1 ? ` across ${labels.length} files` : '';
  const identifiers = stats.totalIdentifiersRenamed === 1 ? 'identifier' : 'identifiers';

  console.log(`🔒 ${stats.totalIdentifiersRenamed} ${identifiers} protected${where}`);
}
