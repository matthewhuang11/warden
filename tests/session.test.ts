import { describe, it, expect } from 'vitest';
import { transformRequestBody } from '../src/obfuscate/transformRequestBody.js';
import { sessionRenameMap } from '../src/session.js';

function toolResultRequest(toolUseId: string, text: string) {
  return {
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: [{ type: 'text', text }],
          },
        ],
      },
    ],
  };
}

function textOf(body: unknown): string {
  const messages = (body as { messages: unknown[] }).messages;
  const content = (messages[0] as { content: unknown[] }).content;
  const inner = (content[0] as { content: unknown[] }).content;
  return (inner[0] as { text: string }).text;
}

describe('sessionRenameMap persistence across requests', () => {
  it('reuses the same synthetic name for a function across two separate requests in the same session', async () => {
    // Turn 1: a Read-style tool_result containing a file that declares processOrder.
    const firstRequest = toolResultRequest(
      'toolu_1',
      ['function processOrder(order) {', '  return order.total;', '}'].join('\n'),
    );
    const { body: firstBody } = await transformRequestBody(firstRequest, sessionRenameMap);
    const firstText = textOf(firstBody);

    const declMatch = firstText.match(/function (func_\w+)\(order\)/);
    expect(declMatch).not.toBeNull();
    const syntheticName = declMatch![1];
    expect(firstText).not.toContain('processOrder');

    // Turn 2: a separate request/tool_result, from a different file, that
    // only *calls* processOrder — it has no local declaration of its own,
    // so nothing in this snippet's scope resolves it. It must still come
    // out as the same synthetic name established in turn 1, not leak the
    // real name and not mint a different placeholder.
    const secondRequest = toolResultRequest(
      'toolu_2',
      ['const receipt = processOrder(pendingOrder);', 'console.log(receipt);'].join('\n'),
    );
    const { body: secondBody } = await transformRequestBody(secondRequest, sessionRenameMap);
    const secondText = textOf(secondBody);

    expect(secondText).toContain(`${syntheticName}(pendingOrder)`);
    expect(secondText).not.toContain('processOrder');
  });

  it('reuses the same synthetic name for a variable across two separate requests in the same session', async () => {
    // Turn 1: declares and renames a variable.
    const firstRequest = toolResultRequest(
      'toolu_3',
      ['const cachedConfig = loadConfig();', 'console.log(cachedConfig.env);'].join('\n'),
    );
    const { body: firstBody } = await transformRequestBody(firstRequest, sessionRenameMap);
    const firstText = textOf(firstBody);

    const declMatch = firstText.match(/const (var_\w+) = loadConfig\(\);/);
    expect(declMatch).not.toBeNull();
    const syntheticName = declMatch![1];
    expect(firstText).not.toContain('cachedConfig');

    // Turn 2: a separate request that only *reads* cachedConfig — no local
    // declaration in this snippet at all, just a reference.
    const secondRequest = toolResultRequest(
      'toolu_4',
      ["if (cachedConfig.env === 'prod') {", '  alertOncall();', '}'].join('\n'),
    );
    const { body: secondBody } = await transformRequestBody(secondRequest, sessionRenameMap);
    const secondText = textOf(secondBody);

    expect(secondText).toContain(`${syntheticName}.env === 'prod'`);
    expect(secondText).not.toContain('cachedConfig');
  });
});
