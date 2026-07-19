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
  sessionStatsPanel.record(stats);
}

export function formatExchangeRequestMarker(exchangeId: number, stats: TransformStats): string {
  return `[Warden exchange ${exchangeId} request] intercepted; identifiers=${stats.totalIdentifiersRenamed} comments=${stats.commentsRedacted} strings=${stats.stringsRedacted} derived=${stats.derivedConstantsRedacted} secrets=${stats.secretsRedacted}`;
}

export function formatExchangeResponseMarker(
  exchangeId: number,
  status: number,
  durationMs: number,
): string {
  return `[Warden exchange ${exchangeId} response] returned; status=${status} durationMs=${durationMs}`;
}

export function printExchangeRequestMarker(exchangeId: number, stats: TransformStats): void {
  console.log(formatExchangeRequestMarker(exchangeId, stats));
}

export function printExchangeResponseMarker(exchangeId: number, status: number, durationMs: number): void {
  console.log(formatExchangeResponseMarker(exchangeId, status, durationMs));
}

export interface ProtectionTotals {
  identifiers: number;
  comments: number;
  strings: number;
  derived: number;
  secrets: number;
}

interface StatsOutput {
  isTTY?: boolean;
  write(chunk: string): boolean;
}

/** Maintains one compact, in-place tally for the lifetime of the proxy. */
export class TerminalStatsPanel {
  private readonly totals: ProtectionTotals = { identifiers: 0, comments: 0, strings: 0, derived: 0, secrets: 0 };

  constructor(private readonly output: StatsOutput) {}

  record(stats: TransformStats): void {
    this.totals.identifiers += stats.totalIdentifiersRenamed;
    this.totals.comments += stats.commentsRedacted;
    this.totals.strings += stats.stringsRedacted;
    this.totals.derived += stats.derivedConstantsRedacted;
    this.totals.secrets += stats.secretsRedacted;
    if (this.output.isTTY) this.render();
  }

  get current(): ProtectionTotals {
    return { ...this.totals };
  }

  private render(): void {
    const { identifiers, comments, strings, derived, secrets } = this.totals;
    this.output.write(
      `\r\x1b[2KWarden stats | identifiers: ${identifiers} | comments: ${comments} | strings: ${strings} | derived: ${derived} | secrets: ${secrets}`,
    );
  }
}

export const sessionStatsPanel = new TerminalStatsPanel(process.stdout);
