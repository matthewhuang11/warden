import { describe, it, expect, afterEach } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createProxyServer } from '../src/server.js';
import { config } from '../src/config.js';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

const originalUpstreamBaseUrl = config.upstreamBaseUrl;
const originalUpstreamHeadersTimeoutMs = config.upstreamHeadersTimeoutMs;
const originalMaxRequestBodyBytes = config.maxRequestBodyBytes;
const originalMaxBufferedResponseBytes = config.maxBufferedResponseBytes;

const openServers: Server[] = [];

afterEach(async () => {
  config.upstreamBaseUrl = originalUpstreamBaseUrl;
  config.upstreamHeadersTimeoutMs = originalUpstreamHeadersTimeoutMs;
  config.maxRequestBodyBytes = originalMaxRequestBodyBytes;
  config.maxBufferedResponseBytes = originalMaxBufferedResponseBytes;
  await Promise.all(openServers.splice(0).map(close));
});

/** A fake "Anthropic" upstream plus a real proxy in front of it, wired together. */
async function startProxyWithUpstream(
  upstreamHandler: Parameters<typeof createServer>[0],
): Promise<{ proxyUrl: string }> {
  const upstream = createServer(upstreamHandler);
  openServers.push(upstream);
  const upstreamUrl = await listen(upstream);
  config.upstreamBaseUrl = upstreamUrl;

  const proxy = createProxyServer();
  openServers.push(proxy);
  const proxyUrl = await listen(proxy);
  return { proxyUrl };
}

const okJsonHandler: Parameters<typeof createServer>[0] = (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
};

describe('malformed and unexpected request bodies', () => {
  it('passes through malformed (non-JSON) bodies untouched instead of crashing', async () => {
    const { proxyUrl } = await startProxyWithUpstream(okJsonHandler);

    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not valid json ',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it.each([
    ['null', 'null'],
    ['a bare number', '42'],
    ['a bare string', '"just a string"'],
    ['messages as a non-array', '{"messages": "not an array"}'],
    [
      'messages containing null/scalar/wrong-typed entries',
      '{"messages": [null, 42, "str", {"content": "not array"}, {"content": [null, 42, {"type": "tool_result"}]}]}',
    ],
    [
      'a tool_use with a wrong-typed name and input',
      '{"messages": [{"content": [{"type": "tool_use", "name": 123, "input": "not a record"}]}]}',
    ],
    [
      'a tool_result with a wrong-typed tool_use_id and text',
      '{"messages": [{"content": [{"type": "tool_result", "tool_use_id": 42, "content": [{"type": "text", "text": 123}]}]}]}',
    ],
  ])('handles %s without crashing or hanging', async (_label, body) => {
    const { proxyUrl } = await startProxyWithUpstream(okJsonHandler);

    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    expect(res.status).toBe(200);
  });

  it('degrades to forwarding the original body untouched when a pathologically deep structure defeats re-serialization', async () => {
    const { proxyUrl } = await startProxyWithUpstream(okJsonHandler);

    // JSON.parse tolerates very deep nesting, but JSON.stringify (called on
    // the reconstructed body after transformRequestBody) throws
    // RangeError: Maximum call stack size exceeded at this depth — this
    // must degrade gracefully rather than fail the request.
    const depth = 100_000;
    const nested = '['.repeat(depth) + '1' + ']'.repeat(depth);

    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"messages": ${nested}}`,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('handles non-UTF8 bytes in the request body without crashing', async () => {
    const { proxyUrl } = await startProxyWithUpstream(okJsonHandler);

    const invalidBytes = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]);

    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: invalidBytes,
    });

    expect(res.status).toBe(200);
  });
});

describe('upstream target isolation', () => {
  it('rejects absolute-form request targets instead of forwarding them elsewhere', async () => {
    let upstreamRequests = 0;
    const { proxyUrl } = await startProxyWithUpstream((_req, res) => {
      upstreamRequests += 1;
      res.writeHead(200);
      res.end();
    });

    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });

    expect(res.status).toBe(200);
    expect(upstreamRequests).toBe(1);

    const absoluteTargetStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        proxyUrl,
        { method: 'GET', path: 'http://169.254.169.254/latest/meta-data/' },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on('error', reject);
      request.end();
    });

    expect(absoluteTargetStatus).toBe(400);
    expect(upstreamRequests).toBe(1);
  });
});

describe('request body limits', () => {
  it('rejects oversized obfuscated requests before contacting the upstream', async () => {
    config.maxRequestBodyBytes = 64;
    let upstreamRequests = 0;
    const { proxyUrl } = await startProxyWithUpstream((_req, res) => {
      upstreamRequests += 1;
      res.writeHead(200);
      res.end();
    });

    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(100) }] }),
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'request_body_too_large' });
    expect(upstreamRequests).toBe(0);
  });

  it('applies the same limit to pass-through requests', async () => {
    config.maxRequestBodyBytes = 4;
    let upstreamRequests = 0;
    const { proxyUrl } = await startProxyWithUpstream((_req, res) => {
      upstreamRequests += 1;
      res.writeHead(200);
      res.end();
    });

    const res = await fetch(`${proxyUrl}/health`, {
      method: 'POST',
      body: '12345',
    });

    expect(res.status).toBe(413);
    expect(upstreamRequests).toBe(0);
  });
});

describe('buffered response limits', () => {
  it('rejects an oversized JSON response before buffering it in memory', async () => {
    config.maxBufferedResponseBytes = 64;
    const { proxyUrl } = await startProxyWithUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ value: 'x'.repeat(100) }));
    });

    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_response_too_large' });
  });
});

describe('upstream timeout and mid-stream failure', () => {
  it('returns a clean 504 instead of hanging when the upstream never responds', async () => {
    config.upstreamHeadersTimeoutMs = 300;
    const { proxyUrl } = await startProxyWithUpstream(() => {
      // Never call res.writeHead/res.end — simulates a hung/unreachable upstream.
    });

    const start = performance.now();
    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    const elapsedMs = performance.now() - start;

    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ error: 'upstream_timeout' });
    // Should resolve close to the configured timeout, not hang indefinitely.
    expect(elapsedMs).toBeLessThan(2000);
  }, 10_000);

  it('ends the client response cleanly (not hung) when the upstream drops the connection mid-stream', async () => {
    const { proxyUrl } = await startProxyWithUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n',
      );
      setTimeout(() => res.socket?.destroy(), 100);
    });

    // Exactly where the abrupt close surfaces as an error — during the
    // initial fetch(), or later while reading the body stream — is a raw
    // network timing race, not something worth pinning down. Either way is
    // the desired outcome: a clean, promptly-rejected error, never a hang.
    const start = performance.now();
    await expect(
      (async () => {
        const res = await fetch(`${proxyUrl}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: [] }),
        });
        const reader = res.body!.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) return;
        }
      })(),
    ).rejects.toThrow();
    expect(performance.now() - start).toBeLessThan(5000);
  }, 10_000);
});

describe('concurrent requests and sessionRenameMap consistency', () => {
  it('converges on the same synthetic name when many concurrent requests discover the same new identifier for the first time', async () => {
    const receivedBodies: string[] = [];
    const { proxyUrl } = await startProxyWithUpstream(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');
      receivedBodies.push(raw);
      // text/plain, not application/json — so the proxy's own response
      // rehydration doesn't reverse this diagnostic echo before we see it.
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(raw);
    });

    const concurrency = 25;
    await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        fetch(`${proxyUrl}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: `t${i}`,
                    content: [{ type: 'text', text: `function handleConcurrentThing(x) { return x + ${i}; }` }],
                  },
                ],
              },
            ],
          }),
        }),
      ),
    );

    expect(receivedBodies).toHaveLength(concurrency);
    const synthNames = new Set(
      receivedBodies.map((body) => {
        const match = body.match(/function (\w+_\w+)\(x\)/);
        return match?.[1];
      }),
    );

    expect(synthNames.size).toBe(1);
    expect([...synthNames][0]).toMatch(/^func_/);
    // None of the concurrent requests should have leaked the real name.
    for (const body of receivedBodies) {
      expect(body).not.toContain('handleConcurrentThing');
    }
  });
});
