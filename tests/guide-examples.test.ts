// Worked examples from the U.S. Mass Timber Floor Vibration Design Guide (WoodWorks, 2023).
// These are the checks the concept ran on its Design tab; they must keep passing.
import { describe, it, expect } from 'vitest';
import { stripDeflection, cltSpanLimit, freqFromDefl, dunkerley } from '../src/engine';

describe('guide worked examples', () => {
  it('§4.2.1 frequency example: 46 psf, 15 ft, EI 380e6 -> 0.138 in., 9.5 Hz', () => {
    const d = stripDeflection(46, 15, 380e6);
    expect(Math.abs(d - 0.138)).toBeLessThan(0.0006);
    expect(Math.abs(freqFromDefl(d) - 9.5)).toBeLessThan(0.06);
  });

  it('§4.2.2 CLT Handbook span limit: 4 1/8 in. panel, EI 95e6, 0.45 x 62.4 x t/12 psf -> 12.4 ft', () => {
    const L = cltSpanLimit(95e6, 0.45 * 62.4 * 4.125 / 12);
    expect(Math.abs(L - 12.4)).toBeLessThan(0.06);
  });

  it('Dunkerley: two equal 10 Hz components -> 10/sqrt(2)', () => {
    expect(dunkerley([10, 10])).toBeCloseTo(10 / Math.SQRT2, 12);
  });
});
