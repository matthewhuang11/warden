# Warden

A local HTTP proxy that sits between Claude Code (or any Anthropic-API
client) and `api.anthropic.com`. It obfuscates locally-declared JS/TS
identifiers before a request leaves your machine, forwards the sanitized
request to the real API, and rehydrates the response back to real names
before it reaches you — so the model still sees everything it needs to
help, but your own function/variable/class names never leave your
machine in the clear.

## Quickstart (~2 minutes)

No install, no clone — this ships as a prebuilt CLI:

```
npx warden-proxy
```

Leave that running in its own terminal, then in a second terminal, let it
write the config for you:

```
npx warden-proxy setup
```

This offers to add `ANTHROPIC_BASE_URL` to your Claude Code settings
(`~/.claude/settings.json`) and shows you exactly what it's about to write
before asking to confirm — it won't touch the file without a yes. If you'd
rather do it yourself (or `setup` declines because the file doesn't parse),
it prints the same snippet for you to add by hand, plus a shell-export
alternative.

**`ANTHROPIC_BASE_URL` is read once when Claude Code starts, not
per-request** — restart Claude Code (fully quit and reopen, or reload the
VS Code window) after running `setup`, or after exporting it manually, for
it to take effect.

**Confirm it's working:** the terminal running `warden-proxy` should print
a line like `🔒 3 identifiers protected in src/foo.ts` whenever Claude Code
sends it something to obfuscate.

To go back to talking to Anthropic directly, `unset ANTHROPIC_BASE_URL`
(and remove the `env` block from settings.json if `setup` added it there).

> Working from a clone of this repo instead? `npm run setup` (runs
> `setup.sh`: `npm install` + `npm run build`, then prints the same
> instructions) followed by `npm start`. Or run each step yourself:
> `npm install && npm run build && npm start`, or `npm run dev` for
> auto-restart on change during development.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `WARDEN_PORT` | `8787` | Local port the proxy listens on |
| `WARDEN_UPSTREAM_BASE_URL` | `https://api.anthropic.com` | Where requests are forwarded |
| `WARDEN_AUTH_TOKEN` | unset | Optional shared token required in the `x-warden-token` header; requests without it receive a `401` |
| `WARDEN_OBFUSCATION_DISABLED` | unset | Set to `1` to run as a pure passthrough (no obfuscation) |
| `WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS` | `30000` | How long to wait for the upstream to start responding before failing the request with a `504` |
| `WARDEN_CLIENT_HEADERS_TIMEOUT_MS` | `15000` | Maximum time allowed to receive inbound request headers |
| `WARDEN_REQUEST_TIMEOUT_MS` | `120000` | Maximum time allowed to receive a complete inbound request |
| `WARDEN_MAX_REQUEST_BODY_BYTES` | `10485760` | Maximum request body size accepted by the proxy; larger requests receive a `413` before forwarding |
| `WARDEN_MAX_BUFFERED_RESPONSE_BYTES` | `10485760` | Maximum JSON response size buffered for rehydration; larger responses receive a `502` |
| `WARDEN_MAX_SSE_RESPONSE_BYTES` | `52428800` | Maximum total rehydrated SSE response size; larger streams are terminated |
| `WARDEN_MAX_SESSION_MAPPINGS` | `10000` | Maximum in-memory identifier/token mappings retained by one running proxy |
| `WARDEN_VERBOSE` | unset | Set to `1` for detailed JSON logs (see **Watching it work**) |
| `WARDEN_REDACT_COMMENTS` | enabled | Set to `0` to stop redacting comments (see **What gets obfuscated**) |
| `WARDEN_REDACT_STRINGS` | enabled | Set to `0` to stop redacting long, business-sounding string literals (see **What gets obfuscated**) |

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

Beyond identifier renaming, two more things get scrubbed from any block
that parses as JS/TS (both on by default; see the env vars above to turn
either off):

- **Comments** (`//` and `/* */`) are always fully replaced — they're pure
  documentation for humans, so unlike identifiers/strings there's no
  selective logic here. Rather than one fixed literal every time (an
  obvious tell that something was removed), the placeholder is picked from
  a small pool of generic, plausible-sounding phrases (e.g. `// see
  implementation below`, `// internal logic, not user-facing`), varied by
  the original comment's length/content/position so it isn't a fixed
  fingerprint — but never derived from the comment's actual words, so
  nothing about the real content leaks through even indirectly. The
  chosen phrase's length roughly scales with the original's, so a short
  comment doesn't visually balloon into a long one or vice versa. A
  multi-line block comment's placeholder preserves the original line
  count (padding with blank lines) so it round-trips through the
  line-number-prefix handling above; the comment's own text is discarded,
  not restored.
- **String literals** are handled far more conservatively, since blanket
  redaction would break code the model needs to reason about correctly.
  A string is only redacted if it's **15+ characters**, contains
  **multiple words** (separated by spaces or underscores — a proxy for
  "reads like business prose" rather than a technical token), and is
  **not** used as an import/export path, an object key, a JSX attribute
  value, or a comparison/switch-case value (contexts where the exact
  value is load-bearing for control flow, not just human-readable
  content). Redacted strings become a unique placeholder (`"str_1"`,
  `"str_2"`, ...) and — unlike identifiers — don't need a *consistent*
  mapping, but they do still round-trip byte-for-byte back to the exact
  original if the model ever echoes the placeholder back, using the same
  rename map and reversal mechanism as identifiers. Template literals
  (`` `...` ``) are left alone entirely — see **Known limitations**.

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
- **A long, `snake_case`-y string in a plain (non-comparison, non-key)
  position can be redacted even when it's actually a technical value, not
  business prose** — e.g. `const path = "/api/v2/high_risk_zone_lookup";`
  gets redacted, because nothing about that position is structurally
  different from a real business-description string, and its underscores
  make it read as "multi-word" to the heuristic. The reverse is also true
  in principle: a hyphenated or camelCase business string
  (`"high-risk-zone-multiplier"`) won't trip the multi-word check at all
  and goes out untouched. This heuristic is deliberately simple (length +
  word-separator check only) per spec — it isn't, and doesn't try to be, a
  true "does this look like business prose" classifier.
- **Requests larger than `WARDEN_MAX_REQUEST_BODY_BYTES` (10 MiB by default)
  are rejected with a `413` before obfuscation or forwarding.** This bounds
  memory use when the proxy buffers a request body for inspection.
- **The session rename map is bounded by `WARDEN_MAX_SESSION_MAPPINGS` (10,000
  by default).** When the limit is reached, the oldest mapping is evicted;
  an old token may then remain synthetic in a rehydrated response rather than
  allowing unbounded memory growth.
- **Template literals (`` `...` ``) are never touched**, even ones that
  are 100% static, long, multi-word business text. They commonly mix
  static text with interpolated expressions (`` `Order ${id} exceeds the
  ${threshold} limit` ``), and safely redacting only the static portions
  felt like a meaningfully bigger, riskier feature than what was asked for
  here — left out deliberately rather than shipped half-considered.

### Operational behavior (not a privacy gap, just worth knowing)

- **A hung/unreachable upstream fails after `WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS`
  (default 30s), not immediately.** This only bounds the wait for the
  *first* response byte — once headers arrive, a long legitimate
  streaming completion is never cut off by it. A connection that drops
  mid-stream (rather than never responding at all) is handled separately
  and typically surfaces much faster, as a stream error to the client.

## Watching it work

By default, Warden prints a short human-readable line per request that
actually renamed something (e.g. `🔒 3 identifiers protected in
src/foo.ts`), plus a one-line startup banner — nothing else. That's
intentional: it's meant to feel like a normal CLI tool, not a firehose of
logs.

For debugging, set `WARDEN_VERBOSE=1` to also get structured JSON logs to
stdout, one line per event:

- `obfuscate.request_transformed` — a request was scanned; `blocksScanned`/`blocksRenamed`/`totalIdentifiersRenamed`/`blocks` (per-block label + rename count)
- `obfuscate.applied` — one code block was successfully renamed, with the grammar dialect used, plus `commentsRedacted`/`stringsRedacted` counts
- `obfuscate.parse_failed` — a code block didn't parse in either grammar and was left untouched
- `obfuscate.skipped_too_large` — a code block exceeded the line-count ceiling and was left untouched without attempting to parse it
- `obfuscate.transform_failed` — obfuscating/re-serializing the request body threw unexpectedly; the original request was forwarded untouched instead
- `request.upstream_timeout` — the upstream didn't respond within `WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS`; the client got a `504`
- `request.forwarded` — every proxied request, with status and duration

On startup, Warden also checks that its port is free and that the
upstream is reachable — a port already in use prints a clear error and
exits; an unreachable upstream prints a warning but still starts (so a
transient network blip doesn't block you from getting the proxy running).
These two checks always print in plain text, regardless of `WARDEN_VERBOSE`.

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
