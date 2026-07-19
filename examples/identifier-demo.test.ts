import { describe, expect, it } from 'vitest';
import { calculateRenewalOffer } from './identifier-demo.js';

describe('calculateRenewalOffer', () => {
  it('returns a deterministic offer for an eligible account', () => {
    const accountRiskMultiplier = 1.25;
    const annualRevenue = 1000;

    expect(
      calculateRenewalOffer({
        accountRiskMultiplier,
        annualRevenue,
        renewalWindowDays: 30,
      }),
    ).toBe(1000 * 1.25 + 'Internal enterprise renewal multiplier for strategic accounts'.length);
  });

  it('returns zero for an invalid account', () => {
    expect(
      calculateRenewalOffer({
        accountRiskMultiplier: 1,
        annualRevenue: 0,
        renewalWindowDays: 30,
      }),
    ).toBe(0);
  });
});
