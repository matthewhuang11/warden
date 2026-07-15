import { describe, it, expect } from 'vitest';
import { transformRequestBody } from '../src/obfuscate/transformRequestBody.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';
import { rehydrateText } from '../src/rehydrate/rehydrateText.js';

function toolUse(id: string, name: string) {
  return { role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] };
}

function toolResult(toolUseId: string, text: string) {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text }] }],
  };
}

function textOf(body: unknown, messageIndex: number): string {
  const messages = (body as { messages: unknown[] }).messages;
  const content = (messages[messageIndex] as { content: unknown[] }).content;
  const inner = (content[0] as { content: unknown[] }).content;
  return (inner[0] as { text: string }).text;
}

describe('Bash tool_result obfuscation', () => {
  it('reuses a name already known from an earlier Read when it appears in Bash output, word-boundary safe', async () => {
    const map = new RenameMap();
    const body = {
      messages: [
        toolUse('t1', 'Read'),
        toolResult('t1', 'const data = fetchData();\nconsole.log(data.length);'),
        toolUse('t2', 'Bash'),
        toolResult(
          't2',
          [
            "src/x.js:1:const data = fetchData();",
            'src/x.js:2:console.log(data.length);',
            'src/schema.js:5:const database = connect();',
            'src/utils.js:3:export const dataset = [];',
          ].join('\n'),
        ),
      ],
    };

    const { body: transformed } = await transformRequestBody(body, map);

    // The Read established `data` as renameable first.
    const readText = textOf(transformed, 1);
    expect(readText).not.toContain('data ');
    const syntheticMatch = readText.match(/const (var_\w+) = fetchData\(\);/);
    expect(syntheticMatch).not.toBeNull();
    const synthetic = syntheticMatch![1];

    // The Bash grep output reuses that exact synthetic name for `data`...
    const grepText = textOf(transformed, 3);
    expect(grepText).toContain(`src/x.js:1:const ${synthetic} = fetchData();`);
    expect(grepText).toContain(`src/x.js:2:console.log(${synthetic}.length);`);

    // ...but never touches `database` or `dataset`, which merely contain
    // `data` as a substring rather than as the whole word.
    expect(grepText).toContain('src/schema.js:5:const database = connect();');
    expect(grepText).toContain('src/utils.js:3:export const dataset = [];');
  });

  it('leaves Bash output completely untouched when none of its names are already known', async () => {
    const map = new RenameMap();
    const originalText = 'totalSecretApiKey.txt\nconfigManager.json\nprocessOrder.js';
    const body = {
      messages: [toolUse('t1', 'Bash'), toolResult('t1', originalText)],
    };

    const { body: transformed, stats } = await transformRequestBody(body, map);

    expect(textOf(transformed, 1)).toBe(originalText);
    expect(stats.blocksRenamed).toBe(0);
    expect(stats.totalIdentifiersRenamed).toBe(0);
  });

  it('round-trips: a name obfuscated in Bash output is correctly reversed if the model echoes it back in its response', async () => {
    const map = new RenameMap();
    const body = {
      messages: [
        toolUse('t1', 'Read'),
        toolResult('t1', 'function processOrder(order) { return order.total; }'),
        toolUse('t2', 'Bash'),
        toolResult('t2', 'src/orders.js:3:function processOrder(order) { return order.total; }'),
      ],
    };

    const { body: transformed } = await transformRequestBody(body, map);
    const grepText = textOf(transformed, 3);
    expect(grepText).not.toContain('processOrder');

    // Simulate the model quoting the (already-obfuscated) grep line back in
    // its own response text — the same sessionRenameMap reverses it exactly
    // like any other synthetic name, with no Bash-specific rehydration path
    // needed.
    const modelResponseText = `Found it: ${grepText}`;
    const userVisibleText = rehydrateText(modelResponseText, map);

    expect(userVisibleText).toBe(
      'Found it: src/orders.js:3:function processOrder(order) { return order.total; }',
    );
  });
});
