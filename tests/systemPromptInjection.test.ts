import { describe, it, expect } from 'vitest';
import {
  NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION,
  transformRequestBody,
} from '../src/obfuscate/transformRequestBody.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';

describe('scoped naming-commentary system-prompt injection', () => {
  it('is worded as a narrow, unprompted-commentary carve-out rather than a blanket ban', () => {
    expect(NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION).toMatch(/proactively volunteer/i);
    expect(NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION).toMatch(/explicitly asks/i);
  });

  it('sets a bare system string when the request has none', async () => {
    const map = new RenameMap();
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] };

    const { body: transformed } = await transformRequestBody(body, map);

    expect((transformed as Record<string, unknown>).system).toBe(NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION);
  });

  it('appends to an existing string system prompt without discarding it', async () => {
    const map = new RenameMap();
    const body = {
      system: 'You are Claude Code, an interactive CLI tool.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    };

    const { body: transformed } = await transformRequestBody(body, map);

    const system = (transformed as Record<string, unknown>).system;
    expect(system).toContain('You are Claude Code, an interactive CLI tool.');
    expect(system).toContain(NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION);
  });

  it('appends a new block to an array-form system prompt, preserving existing blocks and cache_control', async () => {
    const map = new RenameMap();
    const existingBlock = { type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } };
    const body = {
      system: [existingBlock],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    };

    const { body: transformed } = await transformRequestBody(body, map);

    const system = (transformed as Record<string, unknown>).system as unknown[];
    expect(system[0]).toEqual(existingBlock);
    expect(system).toContainEqual({ type: 'text', text: NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION });
    expect(system).toHaveLength(2);
  });

  it('does not duplicate the instruction if the request already carries it', async () => {
    const map = new RenameMap();
    const body = {
      system: NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    };

    const { body: transformed } = await transformRequestBody(body, map);

    expect((transformed as Record<string, unknown>).system).toBe(NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION);
  });

  it('leaves malformed bodies (no messages array) untouched', async () => {
    const map = new RenameMap();
    const body = { foo: 'bar' };

    const { body: transformed } = await transformRequestBody(body, map);

    expect(transformed).toEqual({ foo: 'bar' });
  });
});
