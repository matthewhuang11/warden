# Warden

Warden is a local TypeScript HTTP proxy experiment for Claude Code and other
Anthropic Messages API clients. It sits between a client and
`api.anthropic.com`, tries to obfuscate selected local JS/TS identifiers,
comments, and some string literals before requests leave the machine, then
rehydrates model responses back to the original text on the way home.

## Project status

This project is not fully functional or production-ready. I am pivoting away
from active development for now and open-sourcing the repository in its current
work-in-progress state.

The code may still be useful as a prototype or reference implementation, but
do not rely on it as a complete privacy or security boundary. The obfuscation
is heuristic, the supported request shapes are narrow, and some behavior
depends on whether the client actually honors `ANTHROPIC_BASE_URL`.

## What works today

- Starts a local proxy on `127.0.0.1:8787` by default.
- Forwards traffic to `https://api.anthropic.com` unless configured otherwise.
- Inspects only `POST /v1/messages` request bodies.
- Rewrites code found in Claude Code-style `Edit` and `Write` tool inputs.
- Rewrites code-like `tool_result` content when it can be parsed as JS/TS.
- Reuses known rename mappings in `Bash` tool results with word-boundary text
  replacement.
- Rehydrates JSON and SSE responses using the in-memory session rename map.
- Writes an encrypted local audit log under `.warden/audit.log.enc`.
- Provides local `stats` and HTML `report` commands.
- Includes an optional aggregate-only dashboard sync path.
- Includes tests, fuzzing scripts, and prototype stealth/coherent-cover-story
  harnesses.

## What is incomplete

- Warden is best-effort, not a guarantee that sensitive names or prose never
  reach an upstream model.
- Only JS/TS-oriented code paths are implemented.
- Plain chat text and system prompts are intentionally not rewritten.
- File and directory names are not virtualized in default `pool` mode.
- `coherent` cover-story mode exists, but should be treated as experimental.
- Bash output can only rewrite names that were already discovered earlier in
  the same proxy session.
- Code blocks that fail tree-sitter parsing are forwarded unchanged.
- Files over the internal line-count limit are forwarded unchanged.
- Secret detection is not implemented; `secrets` counters are reserved and
  currently stay at `0`.
- Claude Code OAuth/subscription routing through `ANTHROPIC_BASE_URL` has not
  been proven for every setup.
- The dashboard is optional and early; it is not required for local proxy use.

## Repository layout

- `src/` - proxy, CLI, obfuscation, rehydration, audit log, and sync code.
- `tests/` - unit, resilience, fuzz, and prototype behavior tests.
- `examples/` - synthetic business-code fixtures for evaluation.
- `dashboard/` - separate Next.js dashboard for aggregate sync data.
- `legacy-extension/` - older Chrome-extension approach kept for reference.
- `scripts/` - package verification, fuzzing, and evaluation harnesses.

## Development setup

Requirements:

- Node.js 20+
- npm
- macOS if you want the default encrypted audit log key storage, because it
  uses macOS Keychain.

From a clone:

```bash
npm install
npm run build
npm start
```

There is also a convenience setup script:

```bash
npm run setup
```

For development with auto-restart:

```bash
npm run dev
```

From a clone, run CLI subcommands through the built entrypoint:

```bash
node dist/cli.js --help
node dist/cli.js stats
```

If the package is published, installed, or linked locally, the package metadata
also exposes `warden-proxy` and `warden` as command names.

## Connecting Claude Code

Run the setup helper after building:

```bash
node dist/cli.js setup
```

It offers to write this value into `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8787"
  }
}
```

`ANTHROPIC_BASE_URL` is read when Claude Code starts, so restart Claude Code
after changing it. To bypass Warden again, remove that setting or unset the
environment variable.

## CLI

```bash
warden-proxy              # start the proxy
warden-proxy setup        # configure Claude Code settings, with confirmation
warden-proxy stats        # print local protection totals
warden-proxy report       # write and open a local HTML report
warden-proxy connect      # enable optional dashboard sync
```

From a clone, use `node dist/cli.js <command>` instead. `warden` is an alias
for the same CLI when the package is installed or linked.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `WARDEN_PORT` | `8787` | Local proxy port |
| `WARDEN_UPSTREAM_BASE_URL` | `https://api.anthropic.com` | Upstream API origin |
| `WARDEN_AUTH_TOKEN` | unset | Optional token required in `x-warden-token` |
| `WARDEN_OBFUSCATION_DISABLED` | unset | Set to `1` for passthrough mode |
| `WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS` | `30000` | Time limit for upstream response headers |
| `WARDEN_CLIENT_HEADERS_TIMEOUT_MS` | `15000` | Time limit for inbound request headers |
| `WARDEN_REQUEST_TIMEOUT_MS` | `120000` | Time limit for inbound request body receipt |
| `WARDEN_MAX_REQUEST_BODY_BYTES` | `10485760` | Max inbound request body size |
| `WARDEN_MAX_BUFFERED_RESPONSE_BYTES` | `10485760` | Max buffered JSON response size |
| `WARDEN_MAX_SSE_RESPONSE_BYTES` | `52428800` | Max total rehydrated SSE response size |
| `WARDEN_MAX_SESSION_MAPPINGS` | `10000` | Max in-memory rename mappings |
| `WARDEN_SESSION_MAPPING_TTL_MS` | `1800000` | Idle lifetime for rename mappings |
| `WARDEN_REDACT_COMMENTS` | enabled | Set to `0` to keep comments |
| `WARDEN_REDACT_STRINGS` | enabled | Set to `0` to keep qualifying strings |
| `WARDEN_COVER_STORY_MODE` | `pool` | `pool` or experimental `coherent` mode |
| `WARDEN_VERBOSE` | unset | Set to `1` for structured JSON logs |
| `WARDEN_CONNECT_CONFIG` | `~/.warden/connect.json` | Optional dashboard sync config path |
| `WARDEN_DASHBOARD_URL` | unset | Default sync URL for `warden connect` |

Additional harness-only environment variables exist under the
`WARDEN_STEALTH_*`, `WARDEN_LOCAL_MODEL_*`, and
`WARDEN_COVER_STORY_COMMENT_MODEL*` prefixes. See `examples/README.md` and
the scripts under `scripts/` for those workflows.

## Obfuscation model

Warden rewrites request bodies only when all of these are true:

- The request is `POST /v1/messages`.
- Obfuscation has not been disabled.
- The relevant message content is in a recognized tool-use or tool-result
  shape.
- The extracted text parses as JS/TS, except for known-name substitutions in
  Bash results.

The main implemented transformations are:

- Locally declared functions, variables, classes, interfaces, and type aliases
  are renamed.
- Imported, built-in, and library identifiers are intended to be left alone.
- Comments are replaced with generic placeholder comments when enabled.
- Long, multi-word string literals in non-load-bearing positions may be
  replaced with placeholders when enabled.
- Some top-level constants derived exactly from a redacted string's `.length`
  may be folded to the computed number.

Response rehydration is based on the in-memory rename map for the current
running proxy process. If mappings expire or are evicted, old synthetic names
may stay synthetic in later responses.

## Local reports and sync

Audit events are stored locally in an append-only encrypted log:

```bash
node dist/cli.js stats
node dist/cli.js report
```

`report` writes `warden-report.html` in the current directory by default and
attempts to open it in the system browser.

Team sync is opt-in:

```bash
node dist/cli.js connect <org-token> --url https://dashboard.example.com/api/sync
```

After that, successfully recorded audit events are posted to the configured
endpoint as aggregate counts, pseudonymous repository/session labels,
timestamps, and one-way hashes. Source code, comments, real identifiers, file
contents, and rename maps are not included in the sync payload.

The dashboard lives in `dashboard/` and is developed separately:

```bash
cd dashboard
npm install
npm run dev
```

See `dashboard/README.md` for its environment variables and storage notes.

## Tests and verification

```bash
npm test
npm run fuzz
npm run fuzz:batch
npm run verify
npm run verify:package
```

Some evaluation harnesses may require explicit API keys, budget caps, or local
model endpoints. They are intended for supervised experimentation, not normal
use.

## License

MIT. See `LICENSE`.
