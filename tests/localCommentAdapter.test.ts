import { describe, expect, it } from 'vitest';
import { createConfiguredLocalCommentAdapter } from '../src/rehydrate/localCommentAdapter.js';

describe('local comment adapter configuration', () => {
  it('is disabled without an explicit endpoint', () => {
    expect(createConfiguredLocalCommentAdapter({})).toBeUndefined();
  });

  it('accepts loopback OpenAI-compatible endpoints without a key', () => {
    expect(createConfiguredLocalCommentAdapter({
      WARDEN_COVER_STORY_COMMENT_MODEL_URL: 'http://127.0.0.1:1234/v1/chat/completions',
    })).toBeDefined();
  });

  it('rejects remote endpoints unless explicitly allowed', () => {
    expect(createConfiguredLocalCommentAdapter({
      WARDEN_COVER_STORY_COMMENT_MODEL_URL: 'https://model.example.test/v1/chat/completions',
    })).toBeUndefined();
    expect(createConfiguredLocalCommentAdapter({
      WARDEN_COVER_STORY_COMMENT_MODEL_URL: 'https://model.example.test/v1/chat/completions',
      WARDEN_COVER_STORY_COMMENT_MODEL_ALLOW_REMOTE: '1',
    })).toBeDefined();
  });
});
