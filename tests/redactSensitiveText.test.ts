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

    expect(result.output).toBe(
      ['// [redacted]', 'function func_1(order) {', '  return order.total * 1.3;', '}'].join('\n'),
    );
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
    expect(outputLines[0]).toBe('/* [redacted]');
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
});

describe('string literal redaction', () => {
  it('does not redact a short string (e.g. a short flag)', async () => {
    const source = 'const mode = "abc";';
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe('const var_1 = "abc";');
    expect(result.stringsRedacted).toBe(0);
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

    expect(result.output).toBe(
      [
        '// [redacted]',
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
