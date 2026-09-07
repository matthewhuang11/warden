import { RenameMap } from '../src/obfuscate/renameMap.js';
import { obfuscateCode } from '../src/obfuscate/obfuscateCode.js';
import { rehydrateText } from '../src/rehydrate/rehydrateText.js';

const sampleSource = `type RenewalDecision = {
  accountId: string;
  renewalMarginCents: number;
  requiresRetentionReview: boolean;
};

// Decide whether a high-value subscription renewal needs manual review.
export function evaluateRenewalRisk(
  accountId: string,
  projectedRevenueCents: number,
  promisedDiscountCents: number,
): RenewalDecision {
  const minimumRenewalMarginCents = 25_000;
  const renewalMarginCents = Math.max(0, projectedRevenueCents - promisedDiscountCents);
  const requiresRetentionReview = renewalMarginCents < minimumRenewalMarginCents;

  return { accountId, renewalMarginCents, requiresRetentionReview };
}
`;

const renameMap = new RenameMap(10_000, 30 * 60 * 1000, 'stealth', 0);
const result = await obfuscateCode(sampleSource, renameMap);

const syntheticNames = renameMap.syntheticNames().slice(0, 4).join(', ');
const mockModelResponse = `I would add tests around ${syntheticNames} so edge-case behavior stays stable.`;

console.log('=== Original code ===');
console.log(sampleSource.trim());
console.log('\n=== What the upstream model would see ===');
console.log(result.output.trim());
console.log('\n=== Demo stats ===');
console.log(
  JSON.stringify(
    {
      dialect: result.dialect,
      identifiersRenamed: result.renamedCount,
      commentsRedacted: result.commentsRedacted,
      stringsRedacted: result.stringsRedacted,
    },
    null,
    2,
  ),
);
console.log('\n=== Mock model response before rehydration ===');
console.log(mockModelResponse);
console.log('\n=== Mock model response after local rehydration ===');
console.log(rehydrateText(mockModelResponse, renameMap));
