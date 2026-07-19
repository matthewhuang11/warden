import { describe, it, expect, afterEach } from 'vitest';
import { obfuscateCode } from '../src/obfuscate/obfuscateCode.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';
import { rehydrateText } from '../src/rehydrate/rehydrateText.js';
import { config } from '../src/config.js';

const originalRedactComments = config.redactComments;
const originalRedactStrings = config.redactStrings;

afterEach(() => {
  config.redactComments = originalRedactComments;
  config.redactStrings = originalRedactStrings;
});

describe('comment redaction', () => {
  it('redacts a line comment with business content while leaving code logic untouched', async () => {
    const source = [
      '// Applies our proprietary risk pricing model before checkout',
      'function computeSurcharge(order) {',
      '  return order.total * 1.3;',
      '}',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);
    const lines = result.output.split('\n');

    expect(lines[0]).toMatch(/^\/\/ .+$/);
    expect(lines[0]).not.toBe('// Applies our proprietary risk pricing model before checkout');
    for (const word of ['proprietary', 'risk', 'pricing', 'checkout']) {
      expect(lines[0].toLowerCase()).not.toContain(word);
    }
    expect(lines.slice(1).join('\n')).toBe('function func_1(order) {\n  return order.total * 1.3;\n}');
    expect(result.commentsRedacted).toBe(1);
  });

  it('redacts a multi-line block comment while preserving the original line count', async () => {
    const source = [
      '/*',
      ' * This whole module implements the high-risk-zone',
      ' * surcharge logic requested by the pricing team.',
      ' */',
      'function run() {}',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    const outputLines = result.output.split('\n');
    expect(outputLines).toHaveLength(source.split('\n').length);
    expect(outputLines[0]).toMatch(/^\/\* .+$/);
    for (const word of ['risk', 'zone', 'surcharge', 'pricing']) {
      expect(result.output.toLowerCase()).not.toContain(word);
    }
    expect(outputLines[outputLines.length - 1]).toBe('function func_1() {}');
    expect(result.output).toContain('*/');
    expect(result.commentsRedacted).toBe(1);
  });

  it('leaves comments untouched when WARDEN_REDACT_COMMENTS is disabled', async () => {
    config.redactComments = false;
    const source = '// Applies our proprietary risk pricing model\nfunction run() {}';
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toContain('// Applies our proprietary risk pricing model');
    expect(result.commentsRedacted).toBe(0);
  });

  it('does not produce the same placeholder for every comment (no single fixed fingerprint)', async () => {
    const source = [
      '// first comment about something',
      'function a() {}',
      '// second comment about something else',
      'function b() {}',
      '// third comment about yet another thing',
      'function c() {}',
      '// fourth comment about one more topic',
      'function d() {}',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    const commentLines = result.output.split('\n').filter((line) => line.trim().startsWith('//'));
    expect(commentLines).toHaveLength(4);
    // Not asserting *all* are distinct (a small rotating pool can coincide),
    // just that they aren't all the identical fixed string every time.
    expect(new Set(commentLines).size).toBeGreaterThan(1);
  });

  it('roughly preserves comment shape: a short comment gets a shorter placeholder than a long one', async () => {
    const shortSource = '// ok\nfunction a() {}';
    const longSource =
      '// This is a much longer comment that explains a fair amount of business context and reasoning\nfunction b() {}';
    const map = new RenameMap();

    const shortResult = await obfuscateCode(shortSource, map);
    const longResult = await obfuscateCode(longSource, new RenameMap());

    const shortLine = shortResult.output.split('\n')[0];
    const longLine = longResult.output.split('\n')[0];
    expect(longLine.length).toBeGreaterThan(shortLine.length);
  });

  it('never leaks the real comment text into the placeholder, across a range of lengths', async () => {
    const distinctiveWords = ['xylophone', 'quetzalcoatl', 'zephyranth'];
    const source = [
      `// ${distinctiveWords[0]}`,
      `// a comment mentioning ${distinctiveWords[1]} in the middle`,
      `// a much longer comment that eventually gets around to mentioning ${distinctiveWords[2]} near the very end of it`,
      'function f() {}',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    for (const word of distinctiveWords) {
      expect(result.output).not.toContain(word);
    }
    expect(result.commentsRedacted).toBe(3);
  });
});

describe('string literal redaction', () => {
  it('does not redact a short string (e.g. a short flag)', async () => {
    const source = 'const mode = "abc";';
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe('const var_1 = "abc";');
    expect(result.stringsRedacted).toBe(0);
  });

  it('does not redact long machine tokens that participate in typed protocols', async () => {
    const source = [
      "type ReviewState = 'ready' | 'pending_manual_review' | 'follow-up-required';",
      "const state: ReviewState = 'pending_manual_review';",
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toContain("'pending_manual_review'");
    expect(result.output).toContain("'follow-up-required'");
    expect(result.stringsRedacted).toBe(0);
    expect(rehydrateText(result.output, map)).toBe(source);
  });

  it('does not redact a string used in a conditional/comparison, to avoid breaking logic the model needs to see', async () => {
    const source = [
      'function check(status) {',
      '  if (status === "pending_review_needed_for_compliance") {',
      '    return true;',
      '  }',
      '  return false;',
      '}',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toContain('status === "pending_review_needed_for_compliance"');
    expect(result.stringsRedacted).toBe(0);
  });

  it('does not redact a string used as a switch/case value', async () => {
    const source = [
      'function check(status) {',
      '  switch (status) {',
      '    case "archived_for_compliance_reasons":',
      '      return false;',
      '  }',
      '  return true;',
      '}',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toContain('case "archived_for_compliance_reasons":');
    expect(result.stringsRedacted).toBe(0);
  });

  it('does not redact an import source path', async () => {
    const source = `import { fetchZipRiskScore } from './risk_engine_module_path';`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe(source);
    expect(result.stringsRedacted).toBe(0);
  });

  it('does not redact an object key, even a long multi-word one', async () => {
    const source = 'const config = {\n  "a very long descriptive object key name": 1,\n};';
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toContain('"a very long descriptive object key name": 1');
    expect(result.stringsRedacted).toBe(0);
  });

  it('does not redact a JSX attribute value', async () => {
    const source = 'const el = <div className="a long descriptive class name here yes" />;';
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toContain('className="a long descriptive class name here yes"');
    expect(result.stringsRedacted).toBe(0);
  });

  it('redacts a long, multi-word business-sounding string and round-trips back to the exact original on rehydration', async () => {
    const source = 'const zipRiskDescription = "applies 1.3x multiplier for high-risk zip codes";';
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe('const var_1 = "str_1";');
    expect(result.stringsRedacted).toBe(1);

    // Simulate the model echoing the placeholder token back in its response.
    const modelResponse = `The str_1 value determines pricing.`;
    const rehydrated = rehydrateText(modelResponse, map);
    expect(rehydrated).toBe('The applies 1.3x multiplier for high-risk zip codes value determines pricing.');
  });

  it('leaves strings untouched when WARDEN_REDACT_STRINGS is disabled', async () => {
    config.redactStrings = false;
    const source = 'const msg = "applies 1.3x multiplier for high-risk zip codes";';
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toContain('"applies 1.3x multiplier for high-risk zip codes"');
    expect(result.stringsRedacted).toBe(0);
  });

  it('does not touch template literals (deliberately out of scope, see report)', async () => {
    const source = 'const url = `/api/users/${id}/this is a long descriptive suffix here`;';
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    // `url` itself is still a normal identifier-rename candidate — only the
    // template literal's own content must stay untouched.
    expect(result.output).toBe('const var_1 = `/api/users/${id}/this is a long descriptive suffix here`;');
    expect(result.stringsRedacted).toBe(0);
  });
});

describe('derived constant redaction', () => {
  it('folds a top-level constant derived from sensitive string length and round-trips exactly', async () => {
    const source = [
      "const CONFIDENTIAL_PRICING_MESSAGE = 'Internal enterprise renewal multiplier for strategic accounts';",
      'const RENEWAL_PROCESSING_FEE = CONFIDENTIAL_PRICING_MESSAGE.length;',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe("const var_1 = 'str_1';\nconst var_2 = 61;");
    expect(result.output).not.toContain('.length');
    expect(result.stringsRedacted).toBe(1);
    expect(result.derivedConstantsRedacted).toBe(1);
    expect(rehydrateText(result.output, map)).toBe(source);
  });

  it('folds a direct sensitive string length without exposing the string upstream', async () => {
    const source = "const processingFee = 'Internal enterprise renewal multiplier for strategic accounts'.length;";
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe('const var_1 = 61;');
    expect(result.output).not.toContain('Internal enterprise');
    expect(result.derivedConstantsRedacted).toBe(1);
    expect(rehydrateText(result.output, map)).toBe(source);
  });

  it('skips folding when the numeric replacement already appears in source', async () => {
    const source = [
      'const existingLimit = 61;',
      "const pricingMessage = 'Internal enterprise renewal multiplier for strategic accounts';",
      'const processingFee = pricingMessage.length;',
    ].join('\n');
    const result = await obfuscateCode(source, new RenameMap());

    expect(result.output).toContain('const var_1 = 61;');
    expect(result.output).toContain('const var_3 = var_2.length;');
    expect(result.derivedConstantsRedacted).toBe(0);
  });

  it('leaves derived expressions alone when string redaction is disabled', async () => {
    config.redactStrings = false;
    const source = [
      "const pricingMessage = 'Internal enterprise renewal multiplier for strategic accounts';",
      'const processingFee = pricingMessage.length;',
    ].join('\n');
    const result = await obfuscateCode(source, new RenameMap());

    expect(result.output).toContain("const var_1 = 'Internal enterprise renewal multiplier for strategic accounts';");
    expect(result.output).toContain('const var_2 = var_1.length;');
    expect(result.derivedConstantsRedacted).toBe(0);
  });
});

describe('combined with identifier renaming', () => {
  it('redacts comments and qualifying strings alongside normal identifier renaming in one pass', async () => {
    const source = [
      '// Applies our proprietary risk pricing model before checkout',
      'function computeSurcharge(order) {',
      '  const status = order.status;',
      '  if (status === "pending_review_needed") {',
      '    return 0;',
      '  }',
      '  const zipRiskDescription = "applies 1.3x multiplier for high-risk zip codes";',
      '  return zipRiskDescription;',
      '}',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);
    const lines = result.output.split('\n');

    expect(lines[0]).toMatch(/^\/\/ .+$/);
    expect(lines[0]).not.toContain('proprietary');
    expect(lines.slice(1).join('\n')).toBe(
      [
        'function func_1(order) {',
        '  const var_1 = order.status;',
        '  if (var_1 === "pending_review_needed") {',
        '    return 0;',
        '  }',
        '  const var_2 = "str_1";',
        '  return var_2;',
        '}',
      ].join('\n'),
    );
    expect(result.commentsRedacted).toBe(1);
    expect(result.stringsRedacted).toBe(1);
    expect(result.renamedCount).toBe(5);
  });
});
