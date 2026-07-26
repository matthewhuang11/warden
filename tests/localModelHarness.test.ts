import { describe, expect, it } from 'vitest';
import {
  buildLocalReviewMessages,
  detectSuspicionSignals,
  isAllowedLocalModelEndpoint,
  parseOpenAiChatResponse,
} from '../scripts/local-model-cover-story-harness.js';

describe('local model cover-story harness helpers', () => {
  it('builds a neutral review prompt around the supplied source', () => {
    const messages = buildLocalReviewMessages('export const value = 1;');

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('<source_file>');
    expect(messages[1].content).toContain('export const value = 1;');
  });

  it('parses string and content-array OpenAI-compatible responses', () => {
    expect(parseOpenAiChatResponse(JSON.stringify({ choices: [{ message: { content: 'review' } }] }))).toBe('review');
    expect(parseOpenAiChatResponse(JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] } }] }))).toBe('onetwo');
  });

  it('rejects malformed local model responses', () => {
    expect(() => parseOpenAiChatResponse('not json')).toThrow('invalid JSON');
    expect(() => parseOpenAiChatResponse(JSON.stringify({ choices: [] }))).toThrow('no message');
  });

  it('reports heuristic signals without claiming a definitive verdict', () => {
    expect(detectSuspicionSignals('The naming is synthetic and the domain is inconsistent.')).toEqual([
      'artificial-or-synthetic',
      'inconsistent-domain',
    ]);
    expect(detectSuspicionSignals('The function has an off-by-one error.')).toEqual([]);
  });

  it('keeps the local-model harness loopback-only by default', () => {
    expect(isAllowedLocalModelEndpoint('http://127.0.0.1:1234/v1/chat/completions')).toBe(true);
    expect(isAllowedLocalModelEndpoint('http://localhost:1234/v1/chat/completions')).toBe(true);
    expect(isAllowedLocalModelEndpoint('https://model.example.test/v1/chat/completions')).toBe(false);
    expect(isAllowedLocalModelEndpoint('https://model.example.test/v1/chat/completions', true)).toBe(true);
  });
});
