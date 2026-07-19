import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

describe('readConfig', () => {
  it('returns secure defaults', () => {
    const config = readConfig({});

    expect(config.port).toBe(8787);
    expect(config.upstreamBaseUrl).toBe('https://api.anthropic.com');
    expect(config.maxRequestBodyBytes).toBe(10 * 1024 * 1024);
    expect(config.maxBufferedResponseBytes).toBe(10 * 1024 * 1024);
    expect(config.maxSessionMappings).toBe(10000);
  });

  it.each([
    ['WARDEN_PORT', '0'],
    ['WARDEN_PORT', '65536'],
    ['WARDEN_PORT', '8787oops'],
    ['WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS', '1.5'],
    ['WARDEN_MAX_REQUEST_BODY_BYTES', '-1'],
    ['WARDEN_MAX_BUFFERED_RESPONSE_BYTES', 'nope'],
    ['WARDEN_MAX_SESSION_MAPPINGS', '0'],
  ])('rejects invalid %s=%s', (key, value) => {
    expect(() => readConfig({ [key]: value })).toThrow(`Invalid ${key}`);
  });

  it.each(['not a url', 'ftp://example.test', 'https://user:pass@example.test'])(
    'rejects unsafe upstream URL %s',
    (upstreamBaseUrl) => {
      expect(() => readConfig({ WARDEN_UPSTREAM_BASE_URL: upstreamBaseUrl })).toThrow(
        'Invalid WARDEN_UPSTREAM_BASE_URL',
      );
    },
  );

  it('accepts explicit positive limits and a local HTTP upstream for development', () => {
    const config = readConfig({
      WARDEN_PORT: '9000',
      WARDEN_UPSTREAM_BASE_URL: 'http://127.0.0.1:4321',
      WARDEN_UPSTREAM_HEADERS_TIMEOUT_MS: '500',
      WARDEN_MAX_REQUEST_BODY_BYTES: '1024',
      WARDEN_MAX_BUFFERED_RESPONSE_BYTES: '2048',
      WARDEN_MAX_SESSION_MAPPINGS: '3',
    });

    expect(config).toMatchObject({
      port: 9000,
      upstreamBaseUrl: 'http://127.0.0.1:4321',
      upstreamHeadersTimeoutMs: 500,
      maxRequestBodyBytes: 1024,
      maxBufferedResponseBytes: 2048,
      maxSessionMappings: 3,
    });
  });
});
