import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { obfuscateCode } from '../src/obfuscate/obfuscateCode.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';
import { transformCoherentCoverStory } from '../src/obfuscate/coherentCoverStory.js';
import { rehydrateCoverStoryText } from '../src/rehydrate/rehydrateCoverStory.js';

const fixtures = [
  { id: 'settlement-reserve', sourcePath: 'examples/fixtures/tuning/fintech/settlement-reserve.ts' },
  { id: 'treasury-sweep', sourcePath: 'examples/fixtures/tuning/fintech/treasury-sweep.ts' },
  { id: 'post-discharge-followup', sourcePath: 'examples/fixtures/tuning/healthtech/care-gap-priority.ts', note: 'Substituted: the named post-discharge source is not present in this checkout.' },
  { id: 'prior-authorization', sourcePath: 'examples/fixtures/tuning/healthtech/prior-authorization.ts' },
  { id: 'credit-line-policy', sourcePath: 'examples/fixtures/tuning/fintech/credit-line-policy.ts' },
] as const;

const outputDir = path.resolve('.warden/limitation-diagnostic/coherent-cover-story');
await mkdir(outputDir, { recursive: true, mode: 0o700 });

const summary: Array<Record<string, unknown>> = [];
for (const fixture of fixtures) {
  const source = await readFile(fixture.sourcePath, 'utf8');
  const current = await obfuscateCode(source, new RenameMap(1_000, 60_000, 'stealth', 0));
  const coherent = await transformCoherentCoverStory(source);
  const currentPath = path.join(outputDir, `${fixture.id}.pool-based.ts`);
  const coherentPath = path.join(outputDir, `${fixture.id}.coherent-cover-story.ts`);
  await writeFile(currentPath, `${current.output}\n`, { mode: 0o600 });
  await writeFile(coherentPath, `${coherent.output}\n`, { mode: 0o600 });
  summary.push({
    id: fixture.id,
    sourcePath: fixture.sourcePath,
    note: 'note' in fixture ? fixture.note : undefined,
    current: { path: currentPath, renamedCount: current.renamedCount, commentsRedacted: current.commentsRedacted, stringsRedacted: current.stringsRedacted },
    coherent: {
      path: coherentPath,
      domain: coherent.plan.domain.title,
      shape: coherent.plan.shape,
      renamedCount: coherent.renamedCount,
      stringsRewritten: coherent.stringsRewritten,
      commentsRewritten: coherent.commentsRewritten,
      validation: coherent.validation,
      rehydrates: rehydrateCoverStoryText(coherent.output, coherent.plan) === source,
      generationMode: coherent.plan.generationMode,
      llmRequired: coherent.plan.llmRequired,
    },
  });
}

await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputDir, fixtures: fixtures.length }, null, 2));

