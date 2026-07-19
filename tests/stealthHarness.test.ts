import { describe, expect, it, vi } from 'vitest';
import {
  buildClaudeArgs,
  buildClaudeEnv,
  buildProxyEnv,
  executeHarness,
  readHarnessConfig,
  type HarnessConfig,
} from '../scripts/stealth-harness.js';

const cappedEnv = {
  WARDEN_STEALTH_MAX_RUNS: '3',
  WARDEN_STEALTH_MAX_BUDGET_USD: '1.50',
  WARDEN_STEALTH_TEST_API_KEY: 'sk-ant-dedicated-stealth-test-key',
};

describe('stealth harness guardrails', () => {
  it('requires explicit run and spend caps', () => {
    expect(() => readHarnessConfig([], {})).toThrow(/WARDEN_STEALTH_MAX_RUNS/);
    expect(() => readHarnessConfig([], { WARDEN_STEALTH_MAX_RUNS: '1' })).toThrow(
      /WARDEN_STEALTH_MAX_BUDGET_USD/,
    );
  });

  it('rejects dummy, missing, or shared development keys', () => {
    expect(() => readHarnessConfig([], { ...cappedEnv, WARDEN_STEALTH_TEST_API_KEY: 'dummy' })).toThrow(
      /real dedicated test key/,
    );
    expect(() =>
      readHarnessConfig([], {
        ...cappedEnv,
        ANTHROPIC_API_KEY: cappedEnv.WARDEN_STEALTH_TEST_API_KEY,
      }),
    ).toThrow(/must differ/);
  });

  it('rejects held-out fixtures and runs above the agreed cap', () => {
    expect(() =>
      readHarnessConfig(['--fixture', 'examples/fixtures/held-out/fintech/treasury-sweep.ts'], cappedEnv),
    ).toThrow(/Held-out fixture/);
    expect(() => readHarnessConfig(['--runs', '4'], cappedEnv)).toThrow(/between 1/);
  });

  it('routes a bare read-only Claude session through Warden with a divided budget', () => {
    const config = readHarnessConfig(['--runs', '3'], cappedEnv);
    const args = buildClaudeArgs(config, config.totalBudgetUsd / config.runs);
    const env = buildClaudeEnv(config, 43123);

    expect(args).toContain('--bare');
    expect(args).toContain('Read');
    expect(args).toContain('0.5000');
    expect(args.at(-1)).toContain(config.fixturePath);
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:43123');
    expect(env.ANTHROPIC_API_KEY).toBe(cappedEnv.WARDEN_STEALTH_TEST_API_KEY);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('does not expose API credentials to the Warden child process', () => {
    const env = buildProxyEnv(43123, {
      ANTHROPIC_API_KEY: 'normal-development-key',
      ANTHROPIC_AUTH_TOKEN: 'normal-auth-token',
      WARDEN_AUTH_TOKEN: 'local-proxy-token',
      WARDEN_STEALTH_TEST_API_KEY: cappedEnv.WARDEN_STEALTH_TEST_API_KEY,
      WARDEN_OBFUSCATION_DISABLED: '1',
      WARDEN_REDACT_COMMENTS: '0',
      WARDEN_REDACT_STRINGS: '0',
    }, '/test/workspace');

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.WARDEN_STEALTH_TEST_API_KEY).toBeUndefined();
    expect(env.WARDEN_PORT).toBe('43123');
    expect(env.WARDEN_VERBOSE).toBe('1');
    expect(env.WARDEN_OBFUSCATION_DISABLED).toBeUndefined();
    expect(env.WARDEN_REDACT_COMMENTS).toBe('1');
    expect(env.WARDEN_REDACT_STRINGS).toBe('1');
    expect(env.WARDEN_UPSTREAM_BASE_URL).toBe('https://api.anthropic.com');
    expect(env.WARDEN_CONNECT_CONFIG).toBe('/test/workspace/.warden/stealth-harness-43123-no-connect.json');
  });

  it('always stops the fresh proxy when a Claude trial fails', async () => {
    const config = readHarnessConfig([], cappedEnv);
    const stop = vi.fn(async () => undefined);
    const runtime = {
      startProxy: vi.fn(async () => ({ port: 43123, stop })),
      runClaude: vi.fn(async () => {
        throw new Error('simulated Claude failure');
      }),
    };

    await expect(executeHarness(config, runtime)).rejects.toThrow('simulated Claude failure');
    expect(runtime.startProxy).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('runs the selected task the requested number of times through one fresh proxy', async () => {
    const config: HarnessConfig = readHarnessConfig(['--runs', '2', '--task', 'Review edge cases.'], cappedEnv);
    const stop = vi.fn(async () => undefined);
    const runtime = {
      startProxy: vi.fn(async () => ({ port: 43123, stop })),
      runClaude: vi.fn(async (_config: HarnessConfig, _port: number, runNumber: number) => `trial-${runNumber}`),
    };

    await expect(executeHarness(config, runtime)).resolves.toEqual(['trial-1', 'trial-2']);
    expect(runtime.runClaude).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
  });
});
