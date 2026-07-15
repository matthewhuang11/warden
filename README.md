# Warden

A local HTTP proxy that sits between Claude Code (or any Anthropic-API
client) and `api.anthropic.com`. It obfuscates locally-declared JS/TS
identifiers before a request leaves your machine, forwards the sanitized
request to the real API, and rehydrates the response back to real names
before it reaches you — so the model still sees everything it needs to
help, but your own function/variable/class names never leave your
machine in the clear.

## Quickstart (~2 minutes)

```
npm run setup   # installs dependencies and builds
npm start       # leave this running in its own terminal
```

Then point Claude Code at it. **`ANTHROPIC_BASE_URL` is read once when
Claude Code starts, not per-request** — if Claude Code is already
running, restart it after this for it to take effect.

**Shell (CLI):**

```
export ANTHROPIC_BASE_URL=http://localhost:8787
claude
```

**Claude Code settings.json** (`~/.claude/settings.json` for all
projects, or `.claude/settings.json` in one project) — use this instead
if you'd rather not export it in every shell; it works the same whether
you launch Claude Code from a terminal or from inside VS Code:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8787"
  }
}
```

Either way, restart Claude Code (or reload the VS Code window) afterward.

**Confirm it's working:** the terminal running `npm start` should print a
`request.forwarded` log line for each request once Claude Code starts
talking to it.

To go back to talking to Anthropic directly, `unset ANTHROPIC_BASE_URL`
(and remove the `env` block from settings.json if you added it there).

> `npm run setup` just runs `setup.sh`, which does `npm install` +
> `npm run build` and prints the steps above. If you'd rather run each
> step yourself: `npm install && npm run build && npm start`, or
> `npm run dev` for auto-restart on change during development.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `WARDEN_PORT` | `8787` | Local port the proxy listens on |
| `WARDEN_UPSTREAM_BASE_URL` | `https://api.anthropic.com` | Where requests are forwarded |
| `WARDEN_OBFUSCATION_DISABLED` | unset | Set to `1` to run as a pure passthrough (no obfuscation) |
| `WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS` | `30000` | How long to wait for the upstream to start responding before failing the request with a `504` |

Your real auth keeps flowing through untouched — the proxy forwards
whatever `Authorization`/`x-api-key` header it receives without
inspecting it; only the request/response bodies are rewritten. If you
normally log into Claude Code via OAuth (subscription login, no
`ANTHROPIC_API_KEY` set) rather than an API key, that's confirmed to work
for auth headers in general, but whether `ANTHROPIC_BASE_URL` itself
applies to OAuth-authenticated traffic isn't documented — the first real
session is the way to confirm it for your setup. If it doesn't take
effect, try also setting `ANTHROPIC_AUTH_TOKEN`.

## What gets obfuscated

Only `POST /v1/messages` requests are inspected. Within those, two places:

- **`Edit`/`Write` tool_use inputs** — code the assistant is about to
  write (`old_string`/`new_string`/`content`).
- **`tool_result` content** — file/command output sent back to the model
  as context (e.g. `Read`/`Bash` results).

Plain chat text and the system prompt are left alone. If a code block
doesn't parse cleanly as JS/TS (e.g. `Edit`'s `old_string`/`new_string` is
often a small fragment rather than a complete, syntactically valid
program), it's forwarded untouched rather than risk corrupting it — watch
the logs for `obfuscate.parse_failed` to see how often this happens in
practice.

Only the *names* of locally-declared functions, variables, and classes
are changed — imported/built-in/library identifiers are never touched,
and the code's structure/logic is untouched. Renaming is applied via
exact byte-offset splicing on the original source, so formatting is
preserved exactly.

`tool_result` content is handled differently depending on which tool
produced it:

- **`Read`/`Edit`/`Write` results** (and anything else not listed below)
  are parsed as a full JS/TS file via tree-sitter — this is what
  discovers *new* renameable names.
- **`Bash` results** (grep/cat/ls/arbitrary command output) are not
  parsed at all — they're rarely a complete, valid program, so a
  tree-sitter parse would just fail and leave everything untouched
  anyway. Instead, a plain word-boundary substitution reuses whatever
  names the session has *already* discovered from an earlier `Read`/
  `Edit`/`Write` (e.g. renaming `data` won't touch `database` or
  `dataset`). See **Known limitations** below.

## Known limitations

### Not protected (real names can reach the upstream API unobfuscated)

- **A name's *first* appearance in `Bash` output isn't caught.** `Bash`
  `tool_result` content skips AST parsing (see above), so it can never be
  the first place a sensitive name is discovered — only names already in
  the session's rename map from an earlier `Read`/`Edit`/`Write` get
  substituted. If a real identifier's first appearance in a conversation
  is inside `grep`/`cat`/`ls` output rather than a `Read` of the file
  itself, that first occurrence goes out as-is.
- **Files over 5,000 lines skip obfuscation entirely**, not partially.
  tree-sitter parsing runs synchronously and blocks Node's single
  event-loop thread for however long it takes to parse — measured
  against this codebase, roughly 660ms at 5,000 lines, 1.3s at 10,000,
  and 15s at 40,000 (worse than linear, not a fixed per-line cost),
  during which every other in-flight request would freeze. Anything over
  the line-count ceiling is forwarded completely untouched instead
  (logged as `obfuscate.skipped_too_large`) — there's no "rename as much
  as fits."
- **A pathologically deep JSON request body** (thousands of levels of
  array/object nesting — not something a normal file or command output
  would produce) can defeat `JSON.stringify` after obfuscation
  (`RangeError: Maximum call stack size exceeded` — `JSON.parse` tolerates
  this depth, `JSON.stringify` doesn't). That one request degrades to
  going out unobfuscated instead of failing (logged as
  `obfuscate.transform_failed`).

### Operational behavior (not a privacy gap, just worth knowing)

- **A hung/unreachable upstream fails after `WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS`
  (default 30s), not immediately.** This only bounds the wait for the
  *first* response byte — once headers arrive, a long legitimate
  streaming completion is never cut off by it. A connection that drops
  mid-stream (rather than never responding at all) is handled separately
  and typically surfaces much faster, as a stream error to the client.

## Watching it work

Structured JSON logs go to stdout, one line per event:

- `obfuscate.request_transformed` — a request was scanned; `blocksScanned`/`blocksRenamed`/`totalIdentifiersRenamed`
- `obfuscate.applied` — one code block was successfully renamed, with the grammar dialect used
- `obfuscate.parse_failed` — a code block didn't parse in either grammar and was left untouched
- `obfuscate.skipped_too_large` — a code block exceeded the line-count ceiling and was left untouched without attempting to parse it
- `obfuscate.transform_failed` — obfuscating/re-serializing the request body threw unexpectedly; the original request was forwarded untouched instead
- `request.upstream_timeout` — the upstream didn't respond within `WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS`; the client got a `504`
- `request.forwarded` — every proxied request, with status and duration

On startup, Warden also checks that its port is free and that the
upstream is reachable — a port already in use prints a clear error and
exits; an unreachable upstream prints a warning but still starts (so a
transient network blip doesn't block you from getting the proxy running).

## Development

```
npm test        # run unit tests once
npm run test:watch
npx tsc -p tsconfig.json --noEmit   # typecheck
```

---

`legacy-extension/` is an earlier Chrome-extension-based approach (regex
PII redaction on chatgpt.com/claude.ai), kept for reference only — this
proxy is a full architectural pivot, not built on top of it.
