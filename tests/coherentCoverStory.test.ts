import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { transformCoherentCoverStory, validateCoherentCoverStoryOutput } from '../src/obfuscate/coherentCoverStory.js';
import { rehydrateCoverStoryText } from '../src/rehydrate/rehydrateCoverStory.js';

const fixturePaths = [
  'examples/fixtures/tuning/fintech/settlement-reserve.ts',
  'examples/fixtures/tuning/fintech/treasury-sweep.ts',
  'examples/fixtures/tuning/healthtech/care-gap-priority.ts',
  'examples/fixtures/tuning/healthtech/prior-authorization.ts',
  'examples/fixtures/tuning/fintech/credit-line-policy.ts',
];

describe('coherent cover story mode', () => {
  it.each(fixturePaths)('keeps one domain and exactly rehydrates %s', async (fixturePath) => {
    const source = await readFile(fixturePath, 'utf8');
    const result = await transformCoherentCoverStory(source);

    expect(result.validation.valid, result.validation.reason ?? undefined).toBe(true);
    expect(result.plan.domain.vocabulary.length).toBeGreaterThan(0);
    expect(result.plan.llmRequired).toBe(false);
    expect(rehydrateCoverStoryText(result.output, result.plan)).toBe(source);
  });

  it('rewrites comments into the selected domain and restores known comments exactly', async () => {
    const source = [
      'interface WorkRequest { ready: boolean; }',
      'interface WorkDecision { state: \'open\' | \'hold\'; }',
      '// Keep the original work item private while choosing a result.',
      'export function chooseWork(request: WorkRequest): WorkDecision {',
      '  if (!request.ready) return { state: \'hold\' };',
      '  return { state: \'open\' };',
      '}',
    ].join('\n');
    const result = await transformCoherentCoverStory(source);

    expect(result.commentsRewritten).toBe(1);
    expect(result.output).not.toContain('original work item');
    expect(result.output).toContain(result.plan.domain.noun);
    expect(rehydrateCoverStoryText(result.output, result.plan)).toBe(source);
  });

  it('rehydrates fake-domain references in a comment added by the model', async () => {
    const source = [
      'interface WorkRequest { ready: boolean; }',
      'interface WorkDecision { state: \'open\' | \'hold\'; }',
      'export function chooseWork(request: WorkRequest): WorkDecision {',
      '  return request.ready ? { state: \'open\' } : { state: \'hold\' };',
      '}',
    ].join('\n');
    const result = await transformCoherentCoverStory(source);
    const addedComment = `// Recalculate the ${result.plan.domain.noun} before ${result.plan.domain.action}ing the ${result.plan.domain.statusNoun}.`;
    const rehydrated = rehydrateCoverStoryText(`${result.output}\n${addedComment}`, result.plan);

    expect(rehydrated).toContain('WorkRequest');
    expect(rehydrated).toContain('chooseWork');
    expect(rehydrated).toContain('state');
  });

  it('flags a second catalog vocabulary before the output can be sent upstream', async () => {
    const source = [
      'interface WorkRequest { ready: boolean; }',
      'interface WorkDecision { state: \'open\' | \'hold\'; }',
      'export function chooseWork(request: WorkRequest): WorkDecision {',
      '  return request.ready ? { state: \'open\' } : { state: \'hold\' };',
      '}',
    ].join('\n');
    const result = await transformCoherentCoverStory(source);
    const ownType = result.plan.domain.typePrefixes[0];
    const foreignType = result.plan.domain.id === 'recipe-scoring' ? 'ParcelRequest' : 'RecipeProfile';
    const mixed = result.output.replace(new RegExp(`\\b${ownType}\\b`, 'g'), foreignType);
    const validation = await validateCoherentCoverStoryOutput(mixed, result.plan);

    expect(validation.valid).toBe(false);
    expect(validation.foreignVocabulary).toContain(foreignType);
  });

  it('keeps TypeScript comparisons on the TypeScript parser path', async () => {
    const source = 'export function choose(left: number, right: number): number { return left < right && right > 0 ? right : left; }';
    const result = await transformCoherentCoverStory(source);

    expect(result.plan.dialect).toBe('typescript');
    expect(result.validation.valid).toBe(true);
    expect(rehydrateCoverStoryText(result.output, result.plan)).toBe(source);
  });

  it('renames destructuring bindings and class fields without changing property keys', async () => {
    const source = [
      'interface WorkInput { firstValue: number; secondValue: number; }',
      'class WorkBox {',
      '  currentValue = 0;',
      '  choose({ firstValue: sourceValue, secondValue }: WorkInput): number {',
      '    this.currentValue = sourceValue;',
      '    return this.currentValue < secondValue ? secondValue : sourceValue;',
      '  }',
      '}',
    ].join('\n');
    const result = await transformCoherentCoverStory(source);

    expect(result.validation.valid, result.validation.reason ?? undefined).toBe(true);
    expect(result.output).not.toContain('WorkInput');
    expect(result.output).not.toContain('sourceValue');
    expect(result.output).toMatch(/\{ [A-Za-z_$][\w$]*: [A-Za-z_$][\w$]*,/);
    expect(rehydrateCoverStoryText(result.output, result.plan)).toBe(source);
  });

  it('keeps module sources intact while consistently remapping repeated literals', async () => {
    const source = [
      "import { loadState } from './real-module';",
      "export function readState(state: 'ready' | 'blocked'): string {",
      "  if (state === 'ready') return 'ready';",
      "  return 'blocked';",
      '}',
    ].join('\n');
    const result = await transformCoherentCoverStory(source);
    const readyMappings = result.plan.stringMappings.filter((mapping) => mapping.original === "'ready'");

    expect(result.validation.valid, result.validation.reason ?? undefined).toBe(true);
    expect(result.output).toContain("'./real-module'");
    expect(new Set(readyMappings.map((mapping) => mapping.synthetic))).toHaveLength(1);
    expect(result.output).not.toContain("'ready'");
    expect(rehydrateCoverStoryText(result.output, result.plan)).toBe(source);
  });

  it('renames enum members, generic parameters, method signatures, and catch bindings', async () => {
    const source = [
      "enum WorkState { Pending = 'pending', Approved = 'approved', Rejected = 'rejected' }",
      'interface WorkBox<T extends Record<string, unknown>> { choose(input: T): WorkState; }',
      'export function readWork<T extends Record<string, unknown>>(box: WorkBox<T>): WorkState {',
      '  try { return box.choose({} as T); } catch (failure) { return WorkState.Rejected; }',
      '}',
    ].join('\n');
    const result = await transformCoherentCoverStory(source);

    expect(result.validation.valid, result.validation.reason ?? undefined).toBe(true);
    expect(result.output).not.toContain('WorkState');
    expect(result.output).not.toContain('WorkBox');
    expect(result.output).not.toContain('Pending');
    expect(result.output).not.toContain('Rejected');
    expect(result.output).not.toContain('failure');
    expect(result.plan.shape.enumLiteralArity).toBe(3);
    expect(rehydrateCoverStoryText(result.output, result.plan)).toBe(source);
  });

  it('keeps TSX component and prop bindings coherent', async () => {
    const source = [
      "interface WidgetProps { label: string; count: number; }",
      'const Widget = ({ label, count }: WidgetProps) => <section data-label={label}>{count}</section>;',
      'export function renderWidget(props: WidgetProps) {',
      '  return <Widget label={props.label} count={props.count} />;',
      '}',
    ].join('\n');
    const result = await transformCoherentCoverStory(source);

    expect(result.plan.dialect).toBe('tsx');
    expect(result.validation.valid, result.validation.reason ?? undefined).toBe(true);
    expect(result.output).not.toContain('WidgetProps');
    expect(result.output).not.toContain('renderWidget');
    expect(result.output).toContain('data-label');
    expect(rehydrateCoverStoryText(result.output, result.plan)).toBe(source);
  });

  it('renames and rehydrates private class fields', async () => {
    const source = [
      'class WorkBox {',
      '  #currentValue = 0;',
      '  readValue(input: number): number { return this.#currentValue + input; }',
      '}',
    ].join('\n');
    const result = await transformCoherentCoverStory(source);

    expect(result.validation.valid, result.validation.reason ?? undefined).toBe(true);
    expect(result.output).not.toContain('#currentValue');
    expect(rehydrateCoverStoryText(result.output, result.plan)).toBe(source);
  });
});
