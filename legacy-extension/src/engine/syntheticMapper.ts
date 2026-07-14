import type { EntityType, MappingRecord } from '../types';

const GREEK_LETTERS = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi',
  'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
];

/**
 * Deterministic pseudo-random unit interval derived from a numeric seed.
 * Same input always produces the same output within a session -- no Math.random(),
 * so re-anonymizing identical text is idempotent for a given mapper instance.
 */
function seededUnitInterval(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Stateful, bidirectional, in-memory mapper between real sensitive values and
 * realistic synthetic placeholders. Nothing here ever touches disk/network --
 * both maps live only in this instance's memory for the life of the tab.
 */
export class SyntheticMapper {
  private realToSynthetic = new Map<string, string>();
  private syntheticToReal = new Map<string, { real: string; type: EntityType; createdAt: number }>();
  private counters: Partial<Record<EntityType, number>> = {};

  private key(real: string, type: EntityType): string {
    return `${type}:${real.trim().toLowerCase()}`;
  }

  private nextPersonToken(): string {
    const n = this.counters.PERSON ?? 0;
    this.counters.PERSON = n + 1;
    const letter = GREEK_LETTERS[n % GREEK_LETTERS.length];
    const cycle = Math.floor(n / GREEK_LETTERS.length);
    return cycle === 0 ? `Candidate_${letter}` : `Candidate_${letter}${cycle + 1}`;
  }

  private nextOrgToken(): string {
    const n = (this.counters.ORGANIZATION ?? 0) + 1;
    this.counters.ORGANIZATION = n;
    return `Company_${n}`;
  }

  private nextEmailToken(): string {
    const n = (this.counters.EMAIL ?? 0) + 1;
    this.counters.EMAIL = n;
    return `redacted.contact${n}@example.com`;
  }

  private nextPhoneToken(): string {
    const n = (this.counters.PHONE ?? 0) + 1;
    this.counters.PHONE = n;
    // 555-01xx is an NANP range reserved for fictional use -- never a real subscriber number.
    return `555-01${String(n).padStart(2, '0')}`;
  }

  private nextSsnToken(): string {
    const n = (this.counters.SSN ?? 0) + 1;
    this.counters.SSN = n;
    // Area "000" is never issued by the SSA, so this can never collide with a real SSN.
    return `000-00-${String(n).padStart(4, '0')}`;
  }

  /**
   * Shifts a dollar amount by a deterministic +/-15% while preserving its
   * order of magnitude and formatting, so "$450,000" reads as plausible but
   * is never the real figure.
   */
  private syntheticMoney(realValue: string): string {
    const numeric = parseFloat(realValue.replace(/[^0-9.]/g, ''));
    if (Number.isNaN(numeric) || numeric === 0) return realValue;

    const magnitude = Math.pow(10, Math.floor(Math.log10(numeric)));
    const noise = 0.85 + seededUnitInterval(numeric) * 0.3; // 0.85x - 1.15x
    let shifted = Math.round((numeric * noise) / magnitude) * magnitude;
    if (shifted === numeric) shifted += magnitude;

    const hasCents = /\.\d{2}\b/.test(realValue);
    const formatted = shifted.toLocaleString('en-US', {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    });
    return `$${formatted}`;
  }

  /** Returns the existing synthetic token for `real`, or mints and records a new one. */
  getOrCreate(real: string, type: EntityType): string {
    const key = this.key(real, type);
    const existing = this.realToSynthetic.get(key);
    if (existing) return existing;

    let synthetic: string;
    switch (type) {
      case 'PERSON':
        synthetic = this.nextPersonToken();
        break;
      case 'ORGANIZATION':
        synthetic = this.nextOrgToken();
        break;
      case 'MONEY':
        synthetic = this.syntheticMoney(real);
        break;
      case 'EMAIL':
        synthetic = this.nextEmailToken();
        break;
      case 'PHONE':
        synthetic = this.nextPhoneToken();
        break;
      case 'SSN':
        synthetic = this.nextSsnToken();
        break;
    }

    this.realToSynthetic.set(key, synthetic);
    this.syntheticToReal.set(synthetic, { real, type, createdAt: Date.now() });
    return synthetic;
  }

  /** Reverses a synthetic token back to its real value, or undefined if unknown. */
  reveal(synthetic: string): string | undefined {
    return this.syntheticToReal.get(synthetic)?.real;
  }

  getAllMappings(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [synthetic, { real }] of this.syntheticToReal.entries()) {
      out[synthetic] = real;
    }
    return out;
  }

  getRecords(): MappingRecord[] {
    return Array.from(this.syntheticToReal.entries()).map(([synthetic, { real, type, createdAt }]) => ({
      synthetic,
      real,
      type,
      createdAt,
    }));
  }

  get tokens(): string[] {
    return Array.from(this.syntheticToReal.keys());
  }

  get size(): number {
    return this.syntheticToReal.size;
  }

  clear(): void {
    this.realToSynthetic.clear();
    this.syntheticToReal.clear();
    this.counters = {};
  }
}
