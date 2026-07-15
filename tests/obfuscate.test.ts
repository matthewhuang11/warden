import { describe, it, expect } from 'vitest';
import { obfuscateCode } from '../src/obfuscate/obfuscateCode.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';
import { rehydrateText } from '../src/rehydrate/rehydrateText.js';

describe('obfuscateCode', () => {
  it('renames a locally declared variable and all its references', async () => {
    const source = `const total = computeTotal(items);\nconsole.log(total);`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.dialect).toBe('typescript');
    expect(result.output).toBe('const var_1 = computeTotal(items);\nconsole.log(var_1);');
    // computeTotal/items are free references (not declared in this snippet) — untouched.
    expect(result.output).toContain('computeTotal(items)');
  });

  it('leaves destructured imports untouched, including shadowing of built-in-sounding names', async () => {
    const source = `import { useState } from 'react';\nconst [count, setCount] = useState(0);\nsetCount(count + 1);`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    // useState (imported) must never be renamed.
    expect(result.output).toContain("import { useState } from 'react';");
    expect(result.output).toContain('useState(0)');
    // count/setCount come from array destructuring — conservatively left untouched too.
    expect(result.output).toContain('const [count, setCount] = useState(0);');
    expect(result.output).toContain('setCount(count + 1);');
  });

  it('renames a local variable that shadows a global-sounding name, consistently within its scope', async () => {
    const source = `function build() {\n  let Array = [1, 2, 3];\n  return Array.length;\n}`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe('function func_1() {\n  let var_1 = [1, 2, 3];\n  return var_1.length;\n}');
  });

  it('renames cross-referencing locally declared functions consistently, including forward references', async () => {
    const source = [
      'function main(items) {',
      '  return summarize(items);',
      '}',
      '',
      'function summarize(items) {',
      '  return helper(items) + 1;',
      '}',
      '',
      'function helper(items) {',
      '  return items.length;',
      '}',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toContain('function func_1(items) {');
    expect(result.output).toContain('return func_2(items);');
    expect(result.output).toContain('function func_2(items) {');
    expect(result.output).toContain('return func_3(items) + 1;');
    expect(result.output).toContain('function func_3(items) {');
    // Parameters are opaque (never renamed), even though their name "items"
    // is also used as a free identifier passed around between calls.
    expect(result.output).toContain('return items.length;');
  });

  it('does not rename a function parameter even when it shadows an outer renameable local', async () => {
    const source = `let items = loadItems();\nfunction total(items) {\n  return items.length;\n}\nconsole.log(items);`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe(
      'let var_1 = loadItems();\nfunction func_1(items) {\n  return items.length;\n}\nconsole.log(var_1);',
    );
  });

  it('expands an object-literal shorthand reference to a renamed local into explicit key: value form, preserving the real key', async () => {
    const source = `const width = 10;\nconst box = { width };`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    // Shorthand `{ width }` means `{ width: width }` — the key and value
    // share one token, so splicing in the synthetic name in place would
    // rename the key too. Expanding to explicit form keeps the real key
    // (`width`) visible and only obfuscates the value.
    expect(result.output).toBe('const var_1 = 10;\nconst var_2 = { width: var_1 };');
  });

  it('renames class declarations and their references consistently', async () => {
    const source = `class Widget {\n  constructor(name) {\n    this.name = name;\n  }\n}\nconst w = new Widget('x');`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toContain('class class_1 {');
    expect(result.output).toContain("new class_1('x')");
    expect(result.output).toContain('const var_1 = ');
    // Constructor parameter and property assignment are untouched.
    expect(result.output).toContain('constructor(name) {');
    expect(result.output).toContain('this.name = name;');
  });

  it('reuses the same synthetic name for the same original name across separate obfuscate calls in a session', async () => {
    const map = new RenameMap();
    const first = await obfuscateCode('const total = 1;', map);
    const second = await obfuscateCode('const total = 2;\nconsole.log(total);', map);

    expect(first.output).toBe('const var_1 = 1;');
    expect(second.output).toBe('const var_1 = 2;\nconsole.log(var_1);');
  });

  it('falls back to leaving source untouched when the code does not parse', async () => {
    const source = `function broken( { {`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.renamed).toBe(false);
    expect(result.dialect).toBeNull();
    expect(result.output).toBe(source);
  });

  it('handles a locally-declared variable that shadows a global name inside nested scopes without touching the outer global usage elsewhere', async () => {
    const source = `function outer() {\n  const console = makeLogger();\n  console.log('inner');\n}\nconsole.log('outer');`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toContain('const var_1 = makeLogger();');
    expect(result.output).toContain("var_1.log('inner');");
    // The free top-level `console` reference (no local declaration in this
    // snippet's scope) is left untouched.
    expect(result.output).toContain("console.log('outer');");
  });

  it('strips cat -n line-number prefixes (as produced by the Read tool) before parsing and restores them after renaming', async () => {
    const source = ['1\tconst total = computeTotal(items);', '2\tconsole.log(total);'].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.dialect).toBe('typescript');
    expect(result.renamed).toBe(true);
    expect(result.output).toBe(['1\tconst var_1 = computeTotal(items);', '2\tconsole.log(var_1);'].join('\n'));
  });

  it('strips padded cat -n prefixes (real Read tool output, right-aligned line numbers) and preserves the padding on restore', async () => {
    const source = ['     1\tfunction build() {', '     2\t  let x = 1;', '     3\t  return x;', '     4\t}'].join(
      '\n',
    );
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.renamed).toBe(true);
    expect(result.output).toBe(
      ['     1\tfunction func_1() {', '     2\t  let var_1 = 1;', '     3\t  return var_1;', '     4\t}'].join('\n'),
    );
  });

  it('supports a Read offset (line numbers not starting at 1) as long as they are sequential', async () => {
    const source = ['41\tconst width = 10;', '42\tconst box = { width };'].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe(['41\tconst var_1 = 10;', '42\tconst var_2 = { width: var_1 };'].join('\n'));
  });

  it('never renames names pulled out of a destructured CommonJS require', async () => {
    const source = `const { foo, bar } = require('./utils');\nfoo();\nconsole.log(bar);`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe(source);
  });

  it('never renames names pulled out of a destructured ES import', async () => {
    const source = `import { foo, bar } from './utils';\nfoo();\nconsole.log(bar);`;
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe(source);
  });

  it('resolves a variable shadowed by a same-named parameter and an unrelated same-named local independently, never confusing either with a real global', async () => {
    const source = [
      "const data = fetchData();",
      '',
      'function process(data) {',
      '  return data.length;',
      '}',
      '',
      'function summarize() {',
      '  const data = transform();',
      '  return data.count;',
      '}',
      '',
      'console.log(data.length);',
      "fetch('/api/data');",
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    // The outer `data` local is renamed everywhere it's actually referenced
    // at the outer scope, including after the two function declarations.
    expect(result.output).toContain('const var_1 = fetchData();');
    expect(result.output).toContain('console.log(var_1.length);');

    // `process`'s parameter shadows the outer local and is opaque — its
    // body must never be touched, regardless of what the outer `data` did.
    expect(result.output).toContain('function func_1(data) {\n  return data.length;\n}');

    // `summarize`'s own local `data` is a separate declaration in an
    // unrelated function; it's independently renameable and consistent
    // within its own scope (same synthetic name as the outer `data` is
    // expected, since the RenameMap keys by original name for round-trip
    // safety — but it must never leak the *parameter's* opaque binding).
    expect(result.output).toContain('function func_2() {\n  const var_1 = transform();\n  return var_1.count;\n}');

    // A genuine free reference to the `fetch` global (never declared
    // locally in this snippet) is left completely untouched.
    expect(result.output).toContain("fetch('/api/data');");
  });

  it('handles a class with a destructured-default constructor param, this.foo references, and an async try/catch loop', async () => {
    const source = [
      'class ApiClient {',
      '  constructor({ baseUrl, retries = 2 } = {}) {',
      '    this.baseUrl = baseUrl;',
      '    this.retries = retries;',
      '  }',
      '',
      '  async fetchData(id) {',
      '    let attempt = 0;',
      '    while (attempt <= this.retries) {',
      '      try {',
      '        const response = await fetch(`${this.baseUrl}/${id}`);',
      '        return await response.json();',
      '      } catch (err) {',
      '        attempt += 1;',
      '        if (attempt > this.retries) throw err;',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe(
      [
        'class class_1 {',
        '  constructor({ baseUrl, retries = 2 } = {}) {',
        '    this.baseUrl = baseUrl;',
        '    this.retries = retries;',
        '  }',
        '',
        '  async fetchData(id) {',
        '    let var_1 = 0;',
        '    while (var_1 <= this.retries) {',
        '      try {',
        '        const var_2 = await fetch(`${this.baseUrl}/${id}`);',
        '        return await var_2.json();',
        '      } catch (err) {',
        '        var_1 += 1;',
        '        if (var_1 > this.retries) throw err;',
        '      }',
        '    }',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  it('expands a shorthand export list referencing renamed classes, preserving the real export names', async () => {
    const source = [
      'class ApiClient {}',
      'class ApiError extends Error {}',
      'module.exports = { ApiClient, ApiError };',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe(
      ['class class_1 {}', 'class class_2 extends Error {}', 'module.exports = { ApiClient: class_1, ApiError: class_2 };'].join(
        '\n',
      ),
    );
  });

  it('expands a shorthand object literal elsewhere in a function body, preserving the real key', async () => {
    const source = [
      'function summarize(order) {',
      '  const total = computeTotal(order);',
      '  return { total, order };',
      '}',
    ].join('\n');
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.output).toBe(
      [
        'function func_1(order) {',
        '  const var_1 = computeTotal(order);',
        '  return { total: var_1, order };',
        '}',
      ].join('\n'),
    );
  });

  it('round-trips a shorthand export list through obfuscate then rehydrate back to byte-identical source', async () => {
    const source = [
      'class ApiClient {}',
      'class ApiError extends Error {}',
      'module.exports = { ApiClient, ApiError };',
    ].join('\n');
    const map = new RenameMap();
    const obfuscated = await obfuscateCode(source, map);
    const rehydrated = rehydrateText(obfuscated.output, map);

    expect(obfuscated.output).not.toBe(source);
    expect(rehydrated).toBe(source);
  });

  it('round-trips a shorthand object literal in a function body through obfuscate then rehydrate back to byte-identical source', async () => {
    const source = `function build() {\n  const width = 10;\n  const box = { width };\n  return box;\n}`;
    const map = new RenameMap();
    const obfuscated = await obfuscateCode(source, map);
    const rehydrated = rehydrateText(obfuscated.output, map);

    expect(obfuscated.output).not.toBe(source);
    expect(rehydrated).toBe(source);
  });

  it('does not misfire on ordinary code that merely starts one line with a number and a tab', async () => {
    // Only the first line looks like a numbered prefix; since not every
    // line matches, detection declines to strip anything. The leftover
    // leading "1\t" isn't valid syntax on its own (no line break for ASI to
    // kick in before "const"), so this correctly falls through to the same
    // untouched-source fallback as any other unparseable input.
    const source = '1\tconst total = computeTotal(items);\nconsole.log(total);';
    const map = new RenameMap();
    const result = await obfuscateCode(source, map);

    expect(result.renamed).toBe(false);
    expect(result.dialect).toBeNull();
    expect(result.output).toBe(source);
  });

  it('skips parsing entirely for a source file over the line-count ceiling, leaving it untouched', async () => {
    // Real-world timing (measured against this exact codebase) showed
    // tree-sitter parse time scales worse than linearly and blocks Node's
    // single event-loop thread the whole time: ~660ms at 5k lines, ~1.3s at
    // 10k, ~15s at 40k. A large generated/vendored file would freeze every
    // other in-flight request for however long its parse takes, so sources
    // over the ceiling skip parsing entirely rather than risk that.
    const lines: string[] = [];
    for (let i = 0; i < 6000; i++) {
      lines.push(`function fn${i}() { return ${i}; }`);
    }
    const source = lines.join('\n');
    const map = new RenameMap();

    const start = performance.now();
    const result = await obfuscateCode(source, map);
    const elapsedMs = performance.now() - start;

    expect(result.renamed).toBe(false);
    expect(result.dialect).toBeNull();
    expect(result.output).toBe(source);
    // The whole point of the guard is to make this decision cheap — a full
    // parse of 6000 declarations took ~900ms in isolated timing; skipping
    // it should resolve in a tiny fraction of that.
    expect(elapsedMs).toBeLessThan(200);
  });

  it('still parses and renames a file just under the line-count ceiling', async () => {
    const lines: string[] = ['function build() {', '  const total = 0;', '  return total;', '}'];
    for (let i = 0; i < 4000; i++) {
      lines.push(`// padding line ${i}`);
    }
    const source = lines.join('\n');
    const map = new RenameMap();

    const result = await obfuscateCode(source, map);

    expect(result.renamed).toBe(true);
    expect(result.dialect).toBe('typescript');
    expect(result.output).toContain('function func_1() {');
    expect(result.output).toContain('const var_1 = 0;');
    expect(result.output).toContain('return var_1;');
  });
});
