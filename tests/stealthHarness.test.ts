import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildClaudeArgs,
  buildClaudeEnv,
  buildJudgeArgs,
  buildJudgeEnv,
  buildProxyEnv,
  executeHarness,
  extractClaudeResult,
  parseJudgeVerdict,
  readHarnessConfig,
  writeTrialArtifacts,
  type HarnessConfig,
  type TrialCapture,
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

  it('routes a bare read-only reviewer through Warden with its share of the total budget', () => {
    const config = readHarnessConfig(['--runs', '3'], cappedEnv);
    const args = buildClaudeArgs(config, config.totalBudgetUsd / (config.runs * 2));
    const env = buildClaudeEnv(config, 43123);

    expect(args).toContain('--bare');
    expect(args).toContain('Read');
    expect(args).toContain('0.2500');
    expect(args.at(-1)).toContain(config.fixturePath);
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:43123');
    expect(env.ANTHROPIC_API_KEY).toBe(cappedEnv.WARDEN_STEALTH_TEST_API_KEY);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('runs the fixed-rubric judge directly with no tools and the same budget share', () => {
    const config = readHarnessConfig(['--runs', '3'], cappedEnv);
    const args = buildJudgeArgs(config, 'The names appear auto-generated.', 0.25);
    const env = buildJudgeEnv(config);

    expect(args).toContain('--system-prompt');
    expect(args).toContain('--json-schema');
    expect(args).toContain('');
    expect(args).toContain('0.2500');
    expect(args.at(-1)).toContain('The names appear auto-generated.');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
    expect(env.ANTHROPIC_API_KEY).toBe(cappedEnv.WARDEN_STEALTH_TEST_API_KEY);
  });

  it('parses structured verdicts and requires an exact quote when suspicious', () => {
    const responseText = 'The naming appears auto-generated rather than production-ready.';
    const output = JSON.stringify({
      structured_output: {
        suspicious: true,
        quote: 'appears auto-generated',
        reason: 'The response explicitly questions identifier authenticity.',
      },
    });

    expect(parseJudgeVerdict(output, responseText)).toEqual({
      suspicious: true,
      quote: 'appears auto-generated',
      reason: 'The response explicitly questions identifier authenticity.',
    });
    expect(() =>
      parseJudgeVerdict(
        JSON.stringify({ structured_output: { suspicious: true, quote: 'invented quote', reason: 'flagged' } }),
        responseText,
      ),
    ).toThrow(/exact response quote/);
    expect(extractClaudeResult(JSON.stringify({ result: responseText }))).toBe(responseText);
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
    const saveTrial = vi.fn(async () => '/artifacts/failed-trial');
    let logs = 'startup\n';
    const runtime = {
      startProxy: vi.fn(async () => ({ port: 43123, readLogs: () => logs, stop })),
      runClaude: vi.fn(async () => {
        logs += 'request substitutions=4\n';
        throw new Error('simulated Claude failure');
      }),
      runJudge: vi.fn(),
      saveTrial,
    };

    await expect(executeHarness(config, runtime)).rejects.toThrow('simulated Claude failure');
    expect(runtime.startProxy).toHaveBeenCalledOnce();
    expect(saveTrial).toHaveBeenCalledWith(
      config,
      expect.objectContaining({ status: 'failed', wardenLog: 'request substitutions=4\n' }),
    );
    expect(runtime.runJudge).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('runs the selected task the requested number of times through one fresh proxy', async () => {
    const config: HarnessConfig = readHarnessConfig(['--runs', '2', '--task', 'Review edge cases.'], cappedEnv);
    const stop = vi.fn(async () => undefined);
    let logs = 'startup\n';
    const saveTrial = vi.fn(async (_config: HarnessConfig, capture: TrialCapture) => `/artifacts/${capture.runNumber}`);
    const runtime = {
      startProxy: vi.fn(async () => ({ port: 43123, readLogs: () => logs, stop })),
      runClaude: vi.fn(async (_config: HarnessConfig, _port: number, runNumber: number) => {
        logs += `exchange-${runNumber}\n`;
        return JSON.stringify({ result: `trial-${runNumber}` });
      }),
      runJudge: vi.fn(async () => ({ suspicious: false, quote: null, reason: 'No detection language.' })),
      saveTrial,
    };

    await expect(executeHarness(config, runtime)).resolves.toEqual([
      expect.objectContaining({
        runNumber: 1,
        responseText: JSON.stringify({ result: 'trial-1' }),
        wardenLog: 'exchange-1\n',
        judge: expect.objectContaining({ status: 'completed', suspicious: false }),
      }),
      expect.objectContaining({
        runNumber: 2,
        responseText: JSON.stringify({ result: 'trial-2' }),
        wardenLog: 'exchange-2\n',
        judge: expect.objectContaining({ status: 'completed', suspicious: false }),
      }),
    ]);
    expect(runtime.runClaude).toHaveBeenCalledTimes(2);
    expect(runtime.runJudge).toHaveBeenCalledTimes(2);
    expect(saveTrial).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('persists the reviewer response and a failed verdict when judging fails', async () => {
    const config = readHarnessConfig([], cappedEnv);
    const stop = vi.fn(async () => undefined);
    const saveTrial = vi.fn(async () => '/artifacts/judge-failure');
    let logs = 'startup\n';
    const runtime = {
      startProxy: vi.fn(async () => ({ port: 43123, readLogs: () => logs, stop })),
      runClaude: vi.fn(async () => {
        logs += 'exchange-1\n';
        return JSON.stringify({ result: 'review response' });
      }),
      runJudge: vi.fn(async () => {
        throw new Error('simulated judge failure');
      }),
      saveTrial,
    };

    await expect(executeHarness(config, runtime)).rejects.toThrow('simulated judge failure');
    expect(saveTrial).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        responseText: JSON.stringify({ result: 'review response' }),
        judge: { status: 'failed', error: 'simulated judge failure' },
      }),
    );
    expect(stop).toHaveBeenCalledOnce();
  });

  it('writes private response, Warden log, and credential-free metadata artifacts', async () => {
    const outputDir = path.join(tmpdir(), `warden-stealth-artifacts-${process.pid}-${Date.now()}`);
    const config = { ...readHarnessConfig([], cappedEnv), outputDir };
    const capture: TrialCapture = {
      runNumber: 1,
      fixturePath: config.fixturePath,
      task: config.task,
      model: config.model,
      budgetUsd: 1.5,
      startedAt: '2026-07-19T18:00:00.000Z',
      completedAt: '2026-07-19T18:00:02.000Z',
      status: 'passed',
      responseText: '{"result":"complete response"}',
      wardenLog: '[Warden exchange 1 request] identifiers=4\n',
      judge: { status: 'completed', suspicious: false, quote: null, reason: 'No detection language.' },
    };

    const artifactDirectory = await writeTrialArtifacts(config, capture);
    const metadata = await readFile(path.join(artifactDirectory, 'metadata.json'), 'utf8');
    expect(await readFile(path.join(artifactDirectory, 'response.txt'), 'utf8')).toBe(capture.responseText);
    expect(await readFile(path.join(artifactDirectory, 'warden.log'), 'utf8')).toBe(capture.wardenLog);
    expect(JSON.parse(await readFile(path.join(artifactDirectory, 'verdict.json'), 'utf8'))).toEqual(capture.judge);
    expect(metadata).toContain(config.fixturePath);
    expect(metadata).toContain(config.judgeModel);
    expect(metadata).not.toContain(cappedEnv.WARDEN_STEALTH_TEST_API_KEY);
    expect((await stat(artifactDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(artifactDirectory, 'response.txt'))).mode & 0o777).toBe(0o600);
  });
});
