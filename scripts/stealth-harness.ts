import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, Socket, type Server } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface FixtureManifest {
  tuning: string[];
  heldOut: string[];
}

export interface HarnessConfig {
  cwd: string;
  fixturePath: string;
  task: string;
  runs: number;
  totalBudgetUsd: number;
  runTimeoutMs: number;
  testApiKey: string;
  claudeBin: string;
  model: string;
  dryRun: boolean;
}

export interface RunningProxy {
  port: number;
  stop(): Promise<void>;
}

export interface HarnessRuntime {
  startProxy(config: HarnessConfig): Promise<RunningProxy>;
  runClaude(config: HarnessConfig, port: number, runNumber: number): Promise<string>;
}

const DEFAULT_TASK = 'Review this file for correctness and suggest one focused improvement. Do not edit files.';

export function readHarnessConfig(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): HarnessConfig {
  const options = parseArgs(argv);
  const manifest = readManifest(cwd);
  const fixturePath = options.fixture ?? manifest.tuning[0];
  if (!manifest.tuning.includes(fixturePath)) {
    if (manifest.heldOut.includes(fixturePath)) {
      throw new Error(`Held-out fixture cannot be used for tuning: ${fixturePath}`);
    }
    throw new Error(`Fixture is not listed in the tuning manifest: ${fixturePath}`);
  }

  const maximumRuns = readRequiredPositiveInteger(env, 'WARDEN_STEALTH_MAX_RUNS');
  const runs = options.runs ?? 1;
  if (!Number.isSafeInteger(runs) || runs <= 0 || runs > maximumRuns) {
    throw new Error(`Requested runs must be between 1 and WARDEN_STEALTH_MAX_RUNS (${maximumRuns})`);
  }

  const totalBudgetUsd = readRequiredPositiveNumber(env, 'WARDEN_STEALTH_MAX_BUDGET_USD');
  const testApiKey = env.WARDEN_STEALTH_TEST_API_KEY ?? '';
  if (!options.dryRun) validateDedicatedKey(testApiKey, env.ANTHROPIC_API_KEY);

  return {
    cwd,
    fixturePath,
    task: options.task ?? DEFAULT_TASK,
    runs,
    totalBudgetUsd,
    runTimeoutMs: readOptionalPositiveInteger(env, 'WARDEN_STEALTH_RUN_TIMEOUT_MS', 5 * 60 * 1000),
    testApiKey,
    claudeBin: env.WARDEN_STEALTH_CLAUDE_BIN ?? 'claude',
    model: env.WARDEN_STEALTH_MODEL ?? 'sonnet',
    dryRun: options.dryRun,
  };
}

export function buildClaudeArgs(config: HarnessConfig, budgetPerRunUsd: number): string[] {
  const prompt = `Read ${config.fixturePath}. ${config.task}`;
  return [
    '--print',
    '--bare',
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
    '--tools',
    'Read',
    '--model',
    config.model,
    '--max-budget-usd',
    budgetPerRunUsd.toFixed(4),
    '--output-format',
    'json',
    prompt,
  ];
}

export function buildClaudeEnv(config: HarnessConfig, port: number): NodeJS.ProcessEnv {
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_AUTH_TOKEN;
  delete childEnv.CLAUDE_CODE_USE_BEDROCK;
  delete childEnv.CLAUDE_CODE_USE_VERTEX;
  delete childEnv.CLAUDE_CODE_USE_FOUNDRY;
  delete childEnv.WARDEN_AUTH_TOKEN;
  delete childEnv.WARDEN_STEALTH_TEST_API_KEY;
  childEnv.ANTHROPIC_API_KEY = config.testApiKey;
  childEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  childEnv.NO_PROXY = appendNoProxy(childEnv.NO_PROXY, '127.0.0.1', 'localhost');
  return childEnv;
}

export function buildProxyEnv(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): NodeJS.ProcessEnv {
  const proxyEnv = { ...env };
  delete proxyEnv.ANTHROPIC_API_KEY;
  delete proxyEnv.ANTHROPIC_AUTH_TOKEN;
  delete proxyEnv.WARDEN_AUTH_TOKEN;
  delete proxyEnv.WARDEN_STEALTH_TEST_API_KEY;
  delete proxyEnv.WARDEN_OBFUSCATION_DISABLED;
  proxyEnv.WARDEN_PORT = String(port);
  proxyEnv.WARDEN_VERBOSE = '1';
  proxyEnv.WARDEN_UPSTREAM_BASE_URL = 'https://api.anthropic.com';
  proxyEnv.WARDEN_REDACT_COMMENTS = '1';
  proxyEnv.WARDEN_REDACT_STRINGS = '1';
  proxyEnv.WARDEN_CONNECT_CONFIG = path.join(cwd, '.warden', `stealth-harness-${port}-no-connect.json`);
  return proxyEnv;
}

export async function executeHarness(
  config: HarnessConfig,
  runtime: HarnessRuntime = realRuntime,
): Promise<string[]> {
  if (config.dryRun) return [];
  const proxy = await runtime.startProxy(config);
  const outputs: string[] = [];
  try {
    for (let runNumber = 1; runNumber <= config.runs; runNumber++) {
      outputs.push(await runtime.runClaude(config, proxy.port, runNumber));
    }
    return outputs;
  } finally {
    await proxy.stop();
  }
}

const realRuntime: HarnessRuntime = {
  async startProxy(config) {
    const port = await findAvailablePort();
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: config.cwd,
      env: buildProxyEnv(port, process.env, config.cwd),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => process.stderr.write(`[warden] ${String(chunk)}`));
    child.stderr.on('data', (chunk) => process.stderr.write(`[warden] ${String(chunk)}`));
    await waitForPort(port, child, 10_000);
    return { port, stop: () => stopChild(child) };
  },

  async runClaude(config, port) {
    const budgetPerRunUsd = config.totalBudgetUsd / config.runs;
    const child = spawn(config.claudeBin, buildClaudeArgs(config, budgetPerRunUsd), {
      cwd: config.cwd,
      env: buildClaudeEnv(config, port),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return collectChild(child, config.runTimeoutMs);
  },
};

function readManifest(cwd: string): FixtureManifest {
  const manifestPath = path.join(cwd, 'examples/fixture-manifest.json');
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as FixtureManifest;
  if (!Array.isArray(parsed.tuning) || parsed.tuning.length === 0 || !Array.isArray(parsed.heldOut)) {
    throw new Error(`Invalid fixture manifest: ${manifestPath}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): { fixture?: string; task?: string; runs?: number; dryRun: boolean } {
  const options: { fixture?: string; task?: string; runs?: number; dryRun: boolean } = { dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (!['--fixture', '--task', '--runs'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${arg}`);
    if (arg === '--fixture') options.fixture = value;
    else if (arg === '--task') options.task = value;
    else options.runs = Number(value);
  }
  return options;
}

function validateDedicatedKey(testApiKey: string, developmentApiKey: string | undefined): void {
  if (testApiKey.length < 20 || testApiKey.toLowerCase().includes('dummy')) {
    throw new Error('WARDEN_STEALTH_TEST_API_KEY must be a real dedicated test key');
  }
  if (developmentApiKey && testApiKey === developmentApiKey) {
    throw new Error('WARDEN_STEALTH_TEST_API_KEY must differ from ANTHROPIC_API_KEY');
  }
}

function readRequiredPositiveInteger(env: NodeJS.ProcessEnv, name: string): number {
  const raw = env[name];
  if (!raw || !/^\d+$/.test(raw) || Number(raw) <= 0) throw new Error(`${name} must be set to a positive integer`);
  return Number(raw);
}

function readOptionalPositiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  if (env[name] === undefined) return fallback;
  return readRequiredPositiveInteger(env, name);
}

function readRequiredPositiveNumber(env: NodeJS.ProcessEnv, name: string): number {
  const raw = env[name];
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be set to a positive number`);
  return value;
}

function appendNoProxy(current: string | undefined, ...entries: string[]): string {
  return [...new Set([...(current ?? '').split(',').filter(Boolean), ...entries])].join(',');
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a local Warden port');
  await closeServer(server);
  return address.port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function waitForPort(port: number, child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Warden exited before startup with code ${child.exitCode}`);
    const connected = await new Promise<boolean>((resolve) => {
      const socket = new Socket();
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.connect(port, '127.0.0.1');
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stopChild(child);
  throw new Error(`Warden did not start within ${timeoutMs}ms`);
}

function collectChild(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Claude CLI exceeded ${timeoutMs}ms timeout`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(-2_000)}`));
    });
  });
}

function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    child.once('close', () => {
      clearTimeout(killTimer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function main(): Promise<void> {
  const config = readHarnessConfig(process.argv.slice(2));
  const budgetPerRunUsd = config.totalBudgetUsd / config.runs;
  console.log(
    `Stealth harness: fixture=${config.fixturePath} runs=${config.runs} totalBudgetUsd=${config.totalBudgetUsd.toFixed(2)}`,
  );
  if (config.dryRun) {
    console.log(`Dry run; Claude args: ${JSON.stringify(buildClaudeArgs(config, budgetPerRunUsd))}`);
    return;
  }
  const outputs = await executeHarness(config);
  for (const [index, output] of outputs.entries()) {
    console.log(`\n=== Trial ${index + 1} ===\n${output}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
