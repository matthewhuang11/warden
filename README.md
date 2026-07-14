# Warden

A local HTTP proxy that sits between Claude Code (or any Anthropic-API
client) and `api.anthropic.com`. It obfuscates locally-declared JS/TS
identifiers before a request leaves your machine, forwards the sanitized
request to the real API, and rehydrates the streaming response back to
real names before it reaches you.

Only the *names* of locally-declared functions, variables, and classes are
changed — imported/built-in/library identifiers are never touched, and the
code's structure/logic is untouched, so the model still sees everything it
needs to help. Renaming is applied via exact byte-offset splicing on the
original source, so formatting is preserved exactly.

> `legacy-extension/` is an earlier Chrome-extension-based approach (regex
> PII redaction on chatgpt.com/claude.ai). It's kept for reference only —
> this proxy is a full architectural pivot, not built on top of it.

## Setup

```
npm install
npm run build
npm start
```

or for development (auto-restart on change):

```
npm run dev
```

The server listens on `http://localhost:8787` by default.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `WARDEN_PORT` | `8787` | Local port the proxy listens on |
| `WARDEN_UPSTREAM_BASE_URL` | `https://api.anthropic.com` | Where requests are forwarded |
| `WARDEN_OBFUSCATION_DISABLED` | unset | Set to `1` to run as a pure passthrough (no obfuscation) |

## Pointing Claude Code at it

Claude Code reads `ANTHROPIC_BASE_URL` to override the API endpoint. It's
read once at startup, not per-request, so set it *before* launching —
changing it in a shell where `claude` is already running has no effect
until you restart:

```
export ANTHROPIC_BASE_URL=http://localhost:8787
claude
```

Your real auth keeps flowing through untouched — the proxy forwards
whatever `Authorization`/`x-api-key` header it receives without
inspecting it; only the request/response bodies are rewritten. If you
normally log into Claude Code via OAuth (subscription login, no
`ANTHROPIC_API_KEY` set) rather than an API key, that's confirmed to work
for auth headers in general, but whether `ANTHROPIC_BASE_URL` itself
applies to OAuth-authenticated traffic isn't documented — the first real
session is the way to confirm it for your setup. If it doesn't take
effect, try also setting `ANTHROPIC_AUTH_TOKEN`.

To go back to talking to Anthropic directly, `unset ANTHROPIC_BASE_URL`.

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

## Watching it work

Structured JSON logs go to stdout, one line per event:

- `obfuscate.request_transformed` — a request was scanned; `blocksScanned`/`blocksRenamed`/`totalIdentifiersRenamed`
- `obfuscate.applied` — one code block was successfully renamed, with the grammar dialect used
- `obfuscate.parse_failed` — a code block didn't parse in either grammar and was left untouched
- `request.forwarded` — every proxied request, with status and duration

## Development

```
npm test        # run unit tests once
npm run test:watch
npx tsc -p tsconfig.json --noEmit   # typecheck
```
