import { describe, expect, it } from 'vitest';
import { HAWA, layoutHawaMahal } from '../src/landmarks/hawaMahal';

describe('Hawa Mahal layout', () => {
  it('has five tiers that narrow upwards', () => {
    expect(HAWA.tierWidths).toHaveLength(5);
    for (let i = 1; i < HAWA.tierWidths.length; i++) expect(HAWA.tierWidths[i]).toBeLessThan(HAWA.tierWidths[i - 1]);
  });

  it('keeps every bay inside its tier and stacks tiers by storey height', () => {
    const { bays } = layoutHawaMahal();
    for (const b of bays) {
      expect(Math.abs(b.x)).toBeLessThan(HAWA.tierWidths[b.tier] / 2);
      expect(b.y).toBeCloseTo(HAWA.plinthH + b.tier * HAWA.storeyH);
    }
  });

  it('has on the order of the famous 953 windows', () => {
    const { windows } = layoutHawaMahal();
    expect(windows).toBeGreaterThan(600);
    expect(windows).toBeLessThan(1400);
  });
});
