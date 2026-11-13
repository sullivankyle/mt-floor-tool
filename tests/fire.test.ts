// Phase 3 fire design (NDS 2018 Chapter 16): checks against the code tables and hand calculations.
import { describe, it, expect } from 'vitest';
import lamData from '../src/data/laminations.json';
import { defaultCatalog } from '../src/data/catalog';
import {
  charDepth, charDepthSolid, cltCharDepth, cltResidual, cltSeff, cltFireRatio, cltLayupProps, reducedSection,
  connectionProtection, memberCheck, columnCheck, panelCheck, volFactor, type LamGrade,
} from '../src/engine';

const lams = lamData.grades as Record<string, LamGrade>;

describe('NDS Table 16.2.1A: glulam char depths (beta_n = 1.5 in./hr)', () => {
  const rows: [number, number, number][] = [[1, 1.5, 1.8], [1.5, 2.1, 2.5], [2, 2.6, 3.2]];
  for (const [hr, ach, aeff] of rows) it(`${hr} hr: a_char ${ach}, a_eff ${aeff}`, () => {
    expect(Math.abs(charDepthSolid(hr) - ach)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(charDepth(hr) - aeff)).toBeLessThanOrEqual(0.05);
  });
});

describe('NDS Table 16.2.1B: CLT effective char depths with lamination fall-off', () => {
  const h = [0.625, 0.75, 0.875, 1, 1.25, 1.375, 1.5, 1.75, 2];
  const T: Record<string, number[]> = {
    1: [2.2, 2.2, 2.1, 2.0, 2.0, 1.9, 1.8, 1.8, 1.8],
    1.5: [3.4, 3.2, 3.1, 3.0, 2.9, 2.8, 2.8, 2.8, 2.6],
    2: [4.4, 4.3, 4.1, 4.0, 3.9, 3.8, 3.6, 3.6, 3.6],
  };
  // The table is not rounded consistently: 2.151, 3.651 and 2.952 are printed 2.1, 3.6 and 2.9 (rounded down),
  // while 3.790 is printed 3.8. Every cell is within 0.052 in. of eq. 16.2-3 x 1.2; allow 0.06.
  for (const [hr, row] of Object.entries(T)) row.forEach((v, i) => it(`${hr} hr, h_lam ${h[i]} in.: ${v} in.`, () => {
    expect(Math.abs(cltCharDepth(new Array(9).fill(h[i]), +hr).aeff - v)).toBeLessThanOrEqual(0.06);
  }));
  it('hand check, 1 3/8 in. laminations at 1 hr: t_gi = 0.8985 hr, 1 lamination falls off, a_eff = 1.930 in.', () => {
    const c = cltCharDepth([1.375, 1.375, 1.375], 1);
    expect(c.nlam).toBe(1);
    expect(c.aeff).toBeCloseTo(1.930, 3);
  });
  it('without fall-off the solid-wood rate applies (16.2-2)', () => {
    expect(cltCharDepth([1.375, 1.375, 1.375], 1, false).aeff).toBeCloseTo(1.8, 12);
  });
});

describe('CLT residual section (16.2.1.5, PRG 320 X3 assumptions)', () => {
  it('full E1 3-ply section modulus equals the X3 value 2 EI / (E tp)', () => {
    const S = cltSeff(lams.E1, cltResidual([1.375, 1.375, 1.375], 0));
    const p = cltLayupProps(lams.E1, [1.375, 1.375, 1.375]);
    expect(S).toBeCloseTo(2 * p.EI * 1e6 / (1.7e6 * 4.125), 6);
  });
  it('E1 3-ply after 1.930 in. char: hand-calculated Seff = 4.109 in.^3/ft', () => {
    const res = cltResidual([1.375, 1.375, 1.375], 1.93);
    expect(res.length).toBe(2);
    expect(res[0][0]).toBeCloseTo(0.82, 9);
    expect(cltSeff(lams.E1, res)).toBeCloseTo(4.109, 2);
  });
  it('panel fire capacity = 2.85 x FbS x residual ratio', () => {
    const cat = defaultCatalog(), P = cat.panels[4];   // E1 5-ply
    const r = panelCheck({ method: 'ASD', fire: 1, cltFallOff: true, colExp: 4 }, P, 12, 1, 25, 50, 1, cat.lams.E1);
    const ratio = cltFireRatio(cat.lams.E1, P.layers, cltCharDepth(P.layers, 1).aeff);
    expect(r.fire!.cap).toBeCloseTo(2.85 * P.FbS * ratio, 6);
    expect(r.u.f).toBeCloseTo(r.fire!.M / r.fire!.cap, 12);
  });
});

describe('glulam and columns in fire (Table 16.2.2)', () => {
  const cat = defaultCatalog();
  it('6 3/4 x 24 beam, 20 ft, 500 plf + self weight, 1 hr, 3 sides: u = 0.2005 by hand', () => {
    const r = memberCheck({ method: 'ASD', fire: 1, cltFallOff: true, colExp: 4 }, cat,
      { b: 6.75, d: 24, L: 20, spans: 1, wD: 500, wL: 0, llf: 1, brace: { kind: 'continuous' } });
    // a = 1.8, section 3.15 x 22.2, S = 258.73; M = (500 + 39.375) 20^2/8 x 12; CV on the original section
    const M = (500 + 6.75 * 24 / 144 * 35) * 400 / 8 * 12, S = 3.15 * 22.2 ** 2 / 6;
    expect(r.fire!.bf).toBeCloseTo(3.15, 9);
    expect(r.u.f).toBeCloseTo(M / (2.85 * 2400 * volFactor(20, 24, 6.75) * S), 9);
    expect(r.u.f).toBeCloseTo(0.2005, 3);
  });
  it('columns exposed on 3 faces are stronger than on 4', () => {
    const b4 = columnCheck({ method: 'ASD', fire: 1, cltFallOff: true, colExp: 4 }, cat, 10.75, 12, 50000, 50000, 13, 1);
    const b3 = columnCheck({ method: 'ASD', fire: 1, cltFallOff: true, colExp: 3 }, cat, 10.75, 12, 50000, 50000, 13, 1);
    expect(b3.capF).toBeGreaterThan(b4.capF);
    expect(reducedSection(10.75, 12, 1.8, 4)).toEqual({ bf: 10.75 - 3.6, df: 12 - 3.6 });
  });
});

describe('NDS 16.3 connection protection flags', () => {
  it('1 hr: 5 1/8 in. purlin conceals a 1.5 in. hanger (needs 5.1 in.); 2 hr: it does not', () => {
    expect(connectionProtection(1, 'T2', 5.125, 10.75, 12.25, 1.5)[0].ok).toBe(true);
    expect(connectionProtection(2, 'T2', 5.125, 10.75, 12.25, 1.5)[0].ok).toBe(false);
  });
  it('no rating, no flags', () => {
    expect(connectionProtection(0, 'T2', 5.125, 10.75, 12.25, 1.5)).toEqual([]);
  });
});
