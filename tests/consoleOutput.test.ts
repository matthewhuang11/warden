import { describe, expect, it } from 'vitest';
import {
  formatExchangeRequestMarker,
  formatExchangeResponseMarker,
  formatUpstreamUrlForDisplay,
  TerminalStatsPanel,
} from '../src/consoleOutput.js';

describe('formatUpstreamUrlForDisplay', () => {
  it('removes query strings and fragments before display or logging', () => {
    expect(formatUpstreamUrlForDisplay('https://example.test/api?api_key=secret#fragment')).toBe(
      'https://example.test/api',
    );
  });

  it('returns a safe placeholder for invalid URLs', () => {
    expect(formatUpstreamUrlForDisplay('not a URL')).toBe('[invalid upstream URL]');
  });
});

describe('exchange markers', () => {
  it('correlates intercepted requests and returned responses with visible counts', () => {
    const stats = {
      blocksScanned: 1,
      blocksRenamed: 1,
      totalIdentifiersRenamed: 7,
      commentsRedacted: 1,
      stringsRedacted: 1,
      derivedConstantsRedacted: 2,
      secretsRedacted: 0,
      auditEvents: [],
      blocks: [],
    };

    expect(formatExchangeRequestMarker(42, stats)).toBe(
      '[Warden exchange 42 request] intercepted; identifiers=7 comments=1 strings=1 derived=2 secrets=0',
    );
    expect(formatExchangeResponseMarker(42, 200, 125)).toBe(
      '[Warden exchange 42 response] returned; status=200 durationMs=125',
    );
  });
});

describe('TerminalStatsPanel', () => {
  it('keeps a running category tally and updates one TTY line in place', () => {
    const writes: string[] = [];
    const output = { isTTY: true, write: (chunk: string) => (writes.push(chunk), true) };
    const panel = new TerminalStatsPanel(output);

    panel.record({
      blocksScanned: 1,
      blocksRenamed: 1,
      totalIdentifiersRenamed: 3,
      commentsRedacted: 1,
      stringsRedacted: 2,
      derivedConstantsRedacted: 1,
      secretsRedacted: 0,
      auditEvents: [],
      blocks: [],
    });
    panel.record({
      blocksScanned: 1,
      blocksRenamed: 1,
      totalIdentifiersRenamed: 1,
      commentsRedacted: 0,
      stringsRedacted: 1,
      derivedConstantsRedacted: 2,
      secretsRedacted: 2,
      auditEvents: [],
      blocks: [],
    });

    expect(panel.current).toEqual({ identifiers: 4, comments: 1, strings: 3, derived: 3, secrets: 2 });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain('identifiers: 4 | comments: 1 | strings: 3 | derived: 3 | secrets: 2');
    expect(writes[1]).toContain('\r\x1b[2K');
  });

  it('does not write terminal control sequences when output is not a TTY', () => {
    const writes: string[] = [];
    const panel = new TerminalStatsPanel({ isTTY: false, write: (chunk: string) => (writes.push(chunk), true) });

    panel.record({
      blocksScanned: 0,
      blocksRenamed: 0,
      totalIdentifiersRenamed: 0,
      commentsRedacted: 0,
      stringsRedacted: 0,
      derivedConstantsRedacted: 0,
      secretsRedacted: 0,
      auditEvents: [],
      blocks: [],
    });

    expect(writes).toEqual([]);
  });
});
