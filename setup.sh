#!/usr/bin/env bash
# One-shot setup for pilot users / demos: install, build, then print the
# exact next steps for pointing Claude Code at the running proxy.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> Installing dependencies..."
npm install

echo "==> Building..."
npm run build

PORT="${WARDEN_PORT:-8787}"

cat <<EOF

Warden is built. Next steps:

1. Start the proxy (leave this running in its own terminal):

     npm start

2. Point Claude Code at it. ANTHROPIC_BASE_URL is read once when Claude
   Code starts, NOT per-request — if Claude Code is already running, you
   must fully restart it after this for it to take effect.

   Shell (CLI):

     export ANTHROPIC_BASE_URL=http://localhost:${PORT}
     claude

   Claude Code settings.json (~/.claude/settings.json for all projects,
   or .claude/settings.json in a specific project) — works whether you
   launch Claude Code from a terminal or from inside VS Code:

     {
       "env": {
         "ANTHROPIC_BASE_URL": "http://localhost:${PORT}"
       }
     }

   Restart Claude Code (or reload the VS Code window) after saving, for
   the same reason as above.

3. Confirm it's working: proxy.log / the terminal running "npm start"
   should show a "request.forwarded" line for each request once Claude
   Code starts talking to it.

To go back to talking to Anthropic directly: unset ANTHROPIC_BASE_URL
(and remove/comment out the "env" block if you added it to settings.json).

EOF
