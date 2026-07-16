import { createInterface } from 'node:readline/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from './config.js';

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

export interface SetupWizardOptions {
  /** Skip the confirmation prompt (e.g. for scripted/demo use: `--yes`). */
  assumeYes?: boolean;
}

/**
 * Interactively offers to write ANTHROPIC_BASE_URL into the user's Claude
 * Code settings (~/.claude/settings.json) instead of making them edit it by
 * hand. Never writes without an explicit yes, and never touches the file if
 * it can't be parsed as a JSON object — either way, falls back to printing
 * the manual instructions so the user is never left with no path forward.
 */
export async function runSetupWizard(options: SetupWizardOptions = {}): Promise<void> {
  const baseUrl = `http://localhost:${config.port}`;
  console.log(`\nThis configures Claude Code to send its traffic through Warden at ${baseUrl}.`);

  let existing: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      const raw = await readFile(SETTINGS_PATH, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error('top-level value is not a JSON object');
      existing = parsed;
    } catch (err) {
      console.error(`\n✗ Could not read/parse ${SETTINGS_PATH} (${String(err)}).`);
      console.error("Refusing to touch it automatically — here's what to add by hand instead:\n");
      printManualInstructions(baseUrl);
      return;
    }
  }

  const existingEnv = isRecord(existing.env) ? existing.env : {};
  const currentValue = existingEnv.ANTHROPIC_BASE_URL;

  if (currentValue === baseUrl) {
    console.log(`\n✓ ${SETTINGS_PATH} already points ANTHROPIC_BASE_URL at ${baseUrl}. Nothing to change.`);
    console.log('If Claude Code is already running, restart it and you\'re set.\n');
    return;
  }

  const updated = {
    ...existing,
    env: {
      ...existingEnv,
      ANTHROPIC_BASE_URL: baseUrl,
    },
  };

  console.log(`\nThis will write to ${SETTINGS_PATH}:\n`);
  console.log(JSON.stringify(updated, null, 2));
  if (typeof currentValue === 'string') {
    console.log(`\n(replacing the existing ANTHROPIC_BASE_URL: ${currentValue})`);
  }

  const confirmed = options.assumeYes || (await confirm('\nWrite this now? [y/N] '));
  if (!confirmed) {
    console.log('\nSkipped. Add it yourself whenever you\'re ready:\n');
    printManualInstructions(baseUrl);
    return;
  }

  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');

  console.log(`\n✓ Updated ${SETTINGS_PATH}.`);
  console.log(
    'Restart Claude Code (fully quit and reopen, or reload the VS Code window) for this to take\n' +
      'effect — ANTHROPIC_BASE_URL is only read once at startup.\n',
  );
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function printManualInstructions(baseUrl: string): void {
  console.log(
    [
      '  {',
      '    "env": {',
      `      "ANTHROPIC_BASE_URL": "${baseUrl}"`,
      '    }',
      '  }',
      '',
      `  (in ${SETTINGS_PATH})`,
      '',
      'Or, in a shell, before starting Claude Code:',
      '',
      `  export ANTHROPIC_BASE_URL=${baseUrl}`,
      '  claude',
      '',
    ].join('\n'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
