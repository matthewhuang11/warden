import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { obfuscateCode } from '../src/obfuscate/obfuscateCode.js';
import { transformCoherentCoverStory } from '../src/obfuscate/coherentCoverStory.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';

const FIXTURES = [
  'examples/fixtures/tuning/fintech/settlement-reserve.ts',
  'examples/fixtures/tuning/fintech/treasury-sweep.ts',
  'examples/fixtures/tuning/healthtech/care-gap-priority.ts',
  'examples/fixtures/tuning/healthtech/prior-authorization.ts',
  'examples/fixtures/tuning/fintech/credit-line-policy.ts',
] as const;

type Variant = 'original' | 'pool' | 'coherent';

interface LocalHarnessConfig {
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  fixtures: readonly string[];
  runs: number;
  outputDir: string;
  dryRun: boolean;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LocalModelCapture {
  fixturePath: string;
  runNumber: number;
  variant: Variant;
  model: string;
  sourcePath: string;
  responsePath: string;
  responseText: string;
  heuristicSignals: string[];
  heuristicSuspicious: boolean;
  domain?: string;
  validation?: { valid: boolean; reason: string | null };
}

export function buildLocalReviewMessages(source: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: 'You are reviewing a source file as a normal coding assistant. Do not discuss this evaluation harness or speculate about how the file was prepared.',
    },
    {
      role: 'user',
      content: [
        'Review this TypeScript file for correctness and suggest one focused improvement.',
        'Do not edit files. Treat the source as an ordinary project file.',
        '<source_file>',
        source,
        '</source_file>',
      ].join('\n'),
    },
  ];
}

export function parseOpenAiChatResponse(raw: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('Local model returned invalid JSON');
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new Error('Local model response had no choices');
  const message = payload.choices[0];
  if (!isRecord(message) || !isRecord(message.message)) throw new Error('Local model response had no message');
  const content = message.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(isRecord)
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('');
  }
  throw new Error('Local model response had no text content');
}

export function detectSuspicionSignals(response: string): string[] {
  const rules: Array<[string, RegExp]> = [
    ['artificial-or-synthetic', /\b(?:artificial|synthetic|generated|auto[- ]generated)\b/i],
    ['obfuscation-or-anonymization', /\b(?:obfuscat(?:ed|ion)|anonymi[sz](?:ed|ation)|placeholder)\b/i],
    ['inconsistent-domain', /\b(?:domain mismatch|inconsistent(?:ly)?|mixed vocabulary|does not belong)\b/i],
    ['strange-or-weird-naming', /\b(?:strange|weird|odd|unusual|generic)\s+(?:names?|naming|identifiers?)\b/i],
    ['missing-or-redacted-comments', /\b(?:missing|stripped|redacted|removed)\s+(?:comments?|context)\b/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(response)).map(([name]) => name);
}

export function isAllowedLocalModelEndpoint(rawEndpoint: string, allowRemote = false): boolean {
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    return false;
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') return false;
  if (allowRemote) return true;
  return endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost' || endpoint.hostname === '::1';
}

async function callLocalModel(config: LocalHarnessConfig, messages: ChatMessage[]): Promise<string> {
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: config.model, temperature: 0, max_tokens: 1_024, messages }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Local model returned HTTP ${response.status}: ${raw.slice(-500)}`);
  return parseOpenAiChatResponse(raw);
}

async function buildVariant(source: string, variant: Variant): Promise<{ source: string; domain?: string; validation?: { valid: boolean; reason: string | null } }> {
  if (variant === 'original') return { source };
  if (variant === 'pool') {
    const result = await obfuscateCode(source, new RenameMap(1_000, 60_000, 'stealth', 0));
    return { source: result.output };
  }
  const result = await transformCoherentCoverStory(source);
  return {
    source: result.output,
    domain: result.plan.domain.title,
    validation: { valid: result.validation.valid, reason: result.validation.reason },
  };
}

async function run(config: LocalHarnessConfig): Promise<LocalModelCapture[]> {
  await mkdir(config.outputDir, { recursive: true, mode: 0o700 });
  const captures: LocalModelCapture[] = [];
  for (const fixturePath of config.fixtures) {
    const original = await readFile(fixturePath, 'utf8');
    for (let runNumber = 1; runNumber <= config.runs; runNumber++) {
      for (const variant of ['original', 'pool', 'coherent'] as const) {
        const built = await buildVariant(original, variant);
        const fixtureName = path.basename(fixturePath, path.extname(fixturePath));
        const directory = path.join(config.outputDir, fixtureName, `run-${String(runNumber).padStart(2, '0')}`, variant);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const sourcePath = path.join(directory, 'source.ts');
        const responsePath = path.join(directory, 'response.txt');
        await writeFile(sourcePath, built.source, { mode: 0o600 });
        const responseText = await callLocalModel(config, buildLocalReviewMessages(built.source));
        await writeFile(responsePath, responseText, { mode: 0o600 });
        const heuristicSignals = detectSuspicionSignals(responseText);
        captures.push({
          fixturePath,
          runNumber,
          variant,
          model: config.model,
          sourcePath,
          responsePath,
          responseText,
          heuristicSignals,
          heuristicSuspicious: heuristicSignals.length > 0,
          ...(built.domain ? { domain: built.domain } : {}),
          ...(built.validation ? { validation: built.validation } : {}),
        });
      }
    }
  }
  await writeFile(path.join(config.outputDir, 'summary.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: config.model,
    fixtures: config.fixtures,
    runs: config.runs,
    heuristicOnly: true,
    captures: captures.map(({ responseText, ...capture }) => capture),
  }, null, 2)}\n`, { mode: 0o600 });
  return captures;
}

function readConfig(argv: string[], env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): LocalHarnessConfig {
  const options = parseArgs(argv);
  const endpoint = env.WARDEN_LOCAL_MODEL_URL ?? '';
  if (!options.dryRun && endpoint.length === 0) throw new Error('WARDEN_LOCAL_MODEL_URL must point to a local OpenAI-compatible /v1/chat/completions endpoint');
  if (endpoint.length > 0 && !isAllowedLocalModelEndpoint(endpoint, env.WARDEN_LOCAL_MODEL_ALLOW_REMOTE === '1')) {
    throw new Error('WARDEN_LOCAL_MODEL_URL must be loopback; set WARDEN_LOCAL_MODEL_ALLOW_REMOTE=1 only for an intentional remote evaluation');
  }
  const timeoutMs = Number(env.WARDEN_LOCAL_MODEL_TIMEOUT_MS ?? '30000');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('WARDEN_LOCAL_MODEL_TIMEOUT_MS must be positive');
  if (!Number.isSafeInteger(options.runs) || options.runs <= 0) throw new Error('--runs must be a positive integer');
  const fixtures = options.fixture ? [options.fixture] : FIXTURES;
  for (const fixture of fixtures) if (!FIXTURES.includes(fixture as typeof FIXTURES[number])) throw new Error(`Unknown fixture: ${fixture}`);
  return {
    endpoint,
    model: env.WARDEN_LOCAL_MODEL ?? 'local-reviewer',
    apiKey: env.WARDEN_LOCAL_MODEL_KEY,
    timeoutMs,
    fixtures,
    runs: options.runs,
    outputDir: path.resolve(cwd, env.WARDEN_LOCAL_MODEL_OUTPUT_DIR ?? '.warden/local-model-runs'),
    dryRun: options.dryRun,
  };
}

function parseArgs(argv: string[]): { fixture?: string; runs: number; dryRun: boolean } {
  let fixture: string | undefined;
  let runs = 1;
  let dryRun = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--fixture') {
      fixture = argv[++index];
      if (!fixture) throw new Error('--fixture requires a value');
    } else if (arg === '--runs') runs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { fixture, runs, dryRun };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function main(): Promise<void> {
  const config = readConfig(process.argv.slice(2));
  console.log(`Local model A/B harness: fixtures=${config.fixtures.length} runs=${config.runs} model=${config.model} output=${config.outputDir}`);
  console.log('Heuristic signals are diagnostic only; inspect response.txt for the literal model response.');
  if (config.dryRun) {
    console.log(`Reviewer endpoint: ${config.endpoint || '(not configured)'}`);
    return;
  }
  const captures = await run(config);
  for (const capture of captures) {
    console.log(`${capture.fixturePath} ${capture.variant} run=${capture.runNumber} signals=${capture.heuristicSignals.join(',') || 'none'} response=${capture.responsePath}`);
  }
  console.log(`Summary: ${path.join(config.outputDir, 'summary.json')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
