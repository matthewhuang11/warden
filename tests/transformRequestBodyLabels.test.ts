import { describe, it, expect } from 'vitest';
import { transformRequestBody } from '../src/obfuscate/transformRequestBody.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';

describe('transformRequestBody block labels (for console-output reporting)', () => {
  it('labels a Read tool_result with the originating file_path', async () => {
    const map = new RenameMap();
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/server.ts' } }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: [{ type: 'text', text: 'function processOrder(order) { return order.total; }' }],
            },
          ],
        },
      ],
    };

    const { stats } = await transformRequestBody(body, map);

    expect(stats.blocks).toEqual([{ label: 'src/server.ts', renamedCount: 1 }]);
  });

  it('labels an Edit tool_use with its file_path', async () => {
    const map = new RenameMap();
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Edit',
              input: {
                file_path: 'src/utils.ts',
                old_string: 'function loadConfig() {}',
                new_string: 'function loadConfig() { return {}; }',
              },
            },
          ],
        },
      ],
    };

    const { stats } = await transformRequestBody(body, map);

    expect(stats.blocks.every((b) => b.label === 'src/utils.ts')).toBe(true);
    expect(stats.blocks.length).toBeGreaterThan(0);
  });

  it('labels a Bash tool_result with a truncated form of its command', async () => {
    const map = new RenameMap();
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/orders.ts' } }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: [{ type: 'text', text: 'function processOrder(order) { return order.total; }' }],
            },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'grep -rn processOrder src/' } }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't2',
              content: [{ type: 'text', text: 'src/orders.js:3:function processOrder(order) {' }],
            },
          ],
        },
      ],
    };

    const { stats } = await transformRequestBody(body, map);

    expect(stats.blocks).toContainEqual({ label: 'src/orders.ts', renamedCount: 1 });
    expect(stats.blocks).toContainEqual({ label: 'Bash: grep -rn processOrder src/', renamedCount: 1 });
  });

  it('falls back to the tool name when there is no file_path or command to report', async () => {
    const map = new RenameMap();
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'unknown',
              content: [{ type: 'text', text: 'function processOrder(order) { return order.total; }' }],
            },
          ],
        },
      ],
    };

    const { stats } = await transformRequestBody(body, map);

    expect(stats.blocks).toEqual([{ label: 'tool_result', renamedCount: 1 }]);
  });
});
