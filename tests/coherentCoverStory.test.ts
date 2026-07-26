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
});
