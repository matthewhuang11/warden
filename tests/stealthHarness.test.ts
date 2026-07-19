import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertCliAuthStatus,
  buildClaudeArgs,
  buildClaudeEnv,
  buildJudgeArgs,
  buildJudgeEnv,
  buildProxyEnv,
  executeHarness,
  extractClaudeResult,
  parseJudgeVerdict,
  readHarnessConfig,
  summarizeSuspicion,
  writePassSummary,
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

  it('allows an explicit stored CLI login mode without an API key', () => {
    const env = {
      WARDEN_STEALTH_MAX_RUNS: '1',
      WARDEN_STEALTH_MAX_BUDGET_USD: '0.50',
    };
    const config = readHarnessConfig(['--use-cli-auth'], env);
    const childEnv = buildClaudeEnv(config, 43123);

    expect(config.authMode).toBe('cli-login');
    expect(config.testApiKey).toBe('');
    expect(buildClaudeArgs(config, config.fixturePaths[0], 0.25)).toContain('--safe-mode');
    expect(buildClaudeArgs(config, config.fixturePaths[0], 0.25)).not.toContain('--bare');
    expect(buildJudgeArgs(config, 'review response', 0.25)).toContain('--safe-mode');
    expect(childEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(childEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(childEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:43123');
  });

  it('requires a verified stored Claude login in CLI auth mode', () => {
    expect(() => assertCliAuthStatus('{"loggedIn":true,"authMethod":"oauth"}')).not.toThrow();
    expect(() => assertCliAuthStatus('{"loggedIn":false,"authMethod":"none"}')).toThrow(/claude auth login/);
    expect(() => assertCliAuthStatus('not-json')).toThrow(/verify Claude CLI login/);
  });

  it('rejects held-out fixtures and runs above the agreed cap', () => {
    expect(() =>
      readHarnessConfig(['--fixture', 'examples/fixtures/held-out/fintech/treasury-sweep.ts'], cappedEnv),
    ).toThrow(/Held-out fixture/);
    expect(() => readHarnessConfig(['--runs', '4'], cappedEnv)).toThrow(/exceeds/);
  });

  it('selects the entire held-out set exactly once without exposing individual selection', () => {
    const heldOutEnv = { ...cappedEnv, WARDEN_STEALTH_MAX_RUNS: '2', WARDEN_STEALTH_MAX_BUDGET_USD: '1' };
    const config = readHarnessConfig(['--all-held-out'], heldOutEnv);

    expect(config.fixtureSet).toBe('held-out');
    expect(config.fixturePaths).toHaveLength(2);
    expect(config.fixturePaths.every((fixturePath) => fixturePath.includes('/held-out/'))).toBe(true);
    expect(config.trialsPerFixture).toBe(1);
    expect(() => readHarnessConfig(['--all-held-out', '--runs', '2'], heldOutEnv)).toThrow(/exactly 1/);
    expect(() => readHarnessConfig(['--all-held-out', '--all-tuning'], heldOutEnv)).toThrow(/mutually exclusive/);
    expect(() =>
      readHarnessConfig(
        ['--all-held-out', '--fixture', 'examples/fixtures/held-out/fintech/treasury-sweep.ts'],
        heldOutEnv,
      ),
    ).toThrow(/mutually exclusive/);
  });

  it('requires at least three trials per fixture and one cap covering the full tuning pass', () => {
    const passEnv = { ...cappedEnv, WARDEN_STEALTH_MAX_RUNS: '12', WARDEN_STEALTH_MAX_BUDGET_USD: '6' };
    expect(() => readHarnessConfig(['--all-tuning', '--runs', '2'], passEnv)).toThrow(/at least 3/);

    const config = readHarnessConfig(['--all-tuning'], passEnv);
    expect(config.fixturePaths).toHaveLength(4);
    expect(config.trialsPerFixture).toBe(3);
    expect(config.fixturePaths.length * config.trialsPerFixture).toBe(12);
  });

  it('routes a bare read-only reviewer through Warden with its share of the total budget', () => {
    const config = readHarnessConfig(['--runs', '3'], cappedEnv);
    const args = buildClaudeArgs(
      config,
      config.fixturePaths[0],
      config.totalBudgetUsd / (config.trialsPerFixture * 2),
    );
    const env = buildClaudeEnv(config, 43123);

    expect(args).toContain('--bare');
    expect(args).toContain('Read');
    expect(args).toContain('0.2500');
    expect(args.at(-1)).toContain(config.fixturePaths[0]);
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

  it('records a Claude failure, continues the pass, and stops the fresh proxy', async () => {
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

    await expect(executeHarness(config, runtime)).resolves.toEqual([
      expect.objectContaining({
        status: 'failed',
        error: 'simulated Claude failure',
        judge: { status: 'not_run', error: 'Reviewer call failed before judging' },
      }),
    ]);
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
      runClaude: vi.fn(async (_config: HarnessConfig, _fixturePath: string, _port: number, runNumber: number) => {
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

    await expect(executeHarness(config, runtime)).resolves.toEqual([
      expect.objectContaining({
        status: 'failed',
        error: 'Judge call failed',
        judge: { status: 'failed', error: 'simulated judge failure' },
      }),
    ]);
    expect(saveTrial).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        responseText: JSON.stringify({ result: 'review response' }),
        judge: { status: 'failed', error: 'simulated judge failure' },
      }),
    );
    expect(stop).toHaveBeenCalledOnce();
  });

  it('computes a suspicion rate per fixture from completed judge verdicts', () => {
    const config = readHarnessConfig([], cappedEnv);
    const baseCapture: TrialCapture = {
      runNumber: 1,
      fixturePath: config.fixturePaths[0],
      task: config.task,
      model: config.model,
      budgetUsd: 0.25,
      startedAt: '2026-07-19T18:00:00.000Z',
      completedAt: '2026-07-19T18:00:01.000Z',
      status: 'passed',
      responseText: '{}',
      wardenLog: 'exchange\n',
      judge: { status: 'completed', suspicious: false, quote: null, reason: 'clean' },
    };
    const captures: TrialCapture[] = [
      baseCapture,
      {
        ...baseCapture,
        runNumber: 2,
        judge: { status: 'completed', suspicious: true, quote: 'synthetic names', reason: 'flagged' },
      },
      { ...baseCapture, runNumber: 3 },
    ];

    expect(summarizeSuspicion(captures)).toEqual([
      {
        fixturePath: config.fixturePaths[0],
        completedTrials: 3,
        suspiciousTrials: 1,
        failedTrials: 0,
        suspicionRate: 1 / 3,
      },
    ]);
  });

  it('writes a private aggregate tuning-pass summary', async () => {
    const outputDir = path.join(tmpdir(), `warden-stealth-summary-${process.pid}-${Date.now()}`);
    const config = { ...readHarnessConfig([], cappedEnv), outputDir };
    const capture: TrialCapture = {
      runNumber: 1,
      fixturePath: config.fixturePaths[0],
      task: config.task,
      model: config.model,
      budgetUsd: 0.25,
      startedAt: '2026-07-19T18:00:00.000Z',
      completedAt: '2026-07-19T18:00:01.000Z',
      status: 'passed',
      responseText: '{}',
      wardenLog: 'exchange\n',
      judge: { status: 'completed', suspicious: false, quote: null, reason: 'clean' },
    };

    const summaryPath = await writePassSummary(config, [capture]);
    const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as {
      totalTrialPairs: number;
      summaries: Array<{ suspicionRate: number }>;
    };
    expect(summary.totalTrialPairs).toBe(1);
    expect(summary.summaries[0].suspicionRate).toBe(0);
    expect((await stat(summaryPath)).mode & 0o777).toBe(0o600);
  });

  it('writes private response, Warden log, and credential-free metadata artifacts', async () => {
    const outputDir = path.join(tmpdir(), `warden-stealth-artifacts-${process.pid}-${Date.now()}`);
    const config = { ...readHarnessConfig([], cappedEnv), outputDir };
    const capture: TrialCapture = {
      runNumber: 1,
      fixturePath: config.fixturePaths[0],
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
    expect(metadata).toContain(config.fixturePaths[0]);
    expect(metadata).toContain(config.judgeModel);
    expect(metadata).not.toContain(cappedEnv.WARDEN_STEALTH_TEST_API_KEY);
    expect((await stat(artifactDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(artifactDirectory, 'response.txt'))).mode & 0o777).toBe(0o600);
  });
});
