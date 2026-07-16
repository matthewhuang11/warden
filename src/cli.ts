#!/usr/bin/env node
import { runSetupWizard } from './setupWizard.js';

const HELP = `
warden-proxy — local proxy that obfuscates local identifiers before they
reach api.anthropic.com, and rehydrates them back on the way out.

Usage:
  warden-proxy              Start the proxy (foreground)
  warden-proxy setup        Configure Claude Code to use it (writes to
                             ~/.claude/settings.json, with confirmation)
  warden-proxy --help       Show this help

Options for "setup":
  --yes, -y                 Skip the confirmation prompt

Environment variables (see README for the full list):
  WARDEN_PORT                Port to listen on (default 8787)
  WARDEN_UPSTREAM_BASE_URL    Upstream to forward to (default https://api.anthropic.com)
  WARDEN_VERBOSE              Set to 1 for detailed JSON logs
`;

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return;
  }

  if (command === 'setup') {
    const assumeYes = rest.includes('--yes') || rest.includes('-y');
    await runSetupWizard({ assumeYes });
    console.log('Run `warden-proxy` (no arguments) to start the proxy.');
    return;
  }

  if (command !== undefined) {
    console.error(`Unknown command: ${command}\n${HELP}`);
    process.exitCode = 1;
    return;
  }

  // No subcommand: start the proxy. index.js starts listening as an
  // import-time side effect (also true for `node dist/index.js` / `npm
  // start`), so importing it here is enough.
  await import('./index.js');
}

void main();
