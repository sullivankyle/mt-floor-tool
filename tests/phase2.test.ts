// Phase 2 member design: checks against published tables and hand calculations.
import { describe, it, expect } from 'vitest';
import lamData from '../src/data/laminations.json';
import { defaultCatalog } from '../src/data/catalog';
import {
  cltLayupProps, analyzeSpans, envelope, supportLoad, liveLoadReduction, KLL, volFactor, beamStability, leGeneral,
  columnStability, memberCheck, panelCheck, combos, type LamGrade,
} from '../src/engine';

const lams = lamData.grades as Record<string, LamGrade>;

describe('PRG 320-2019 Appendix X3: layup properties reproduce Table A2', () => {
  // Table A2 (U.S.): [FbS lbf-ft/ft, EI 10^6 lbf-in^2/ft, GA 10^6 lbf/ft, Vs lbf/ft] for 3, 5, 7 plies of 1 3/8 in.
  const A2: Record<string, number[][]> = {
    E1: [[4525, 115, 0.46, 1490], [10400, 440, 0.92, 2480], [18375, 1089, 1.4, 3475]],
    E2: [[3825, 102, 0.53, 1980], [8825, 389, 1.1, 3300], [15600, 963, 1.6, 4625]],
    E3: [[2800, 81, 0.35, 1160], [6400, 311, 0.69, 1930], [11325, 769, 1.0, 2700]],
    E4: [[4525, 115, 0.50, 1820], [10400, 440, 1.0, 3025], [18400, 1089, 1.5, 4225]],
    E5: [[3825, 101, 0.46, 1650], [8800, 389, 0.92, 2750], [15575, 962, 1.4, 3850]],
    V1: [[2090, 108, 0.53, 1980], [4800, 415, 1.1, 3300], [8500, 1027, 1.6, 4625]],
    V2: [[2030, 95, 0.46, 1490], [4675, 363, 0.91, 2480], [8275, 898, 1.4, 3475]],
  };
  // Note A1 rounding: FbS, Vs nearest 25 (> 2500), 10 (1000 to 2500), 5 otherwise; EI nearest 10^6 (> 10^7);
  // GA nearest 10^5 (10^6 to 10^7), 10^4 otherwise. Allow half a rounding step plus 1%.
  const stepF = (v: number) => v > 2500 ? 25 : v >= 1000 ? 10 : 5;
  const stepGA = (v: number) => v >= 1 ? 0.1 : 0.01;
  for (const [g, rows] of Object.entries(A2)) {
    rows.forEach(([FbS, EI, GA, Vs], k) => {
      it(`${g} ${3 + 2 * k}-ply`, () => {
        const p = cltLayupProps(lams[g], new Array(3 + 2 * k).fill(1.375));
        expect(Math.abs(p.FbS - FbS)).toBeLessThanOrEqual(stepF(FbS) / 2 + 0.01 * FbS);
        expect(Math.abs(p.EI - EI)).toBeLessThanOrEqual(0.5 + 0.01 * EI);
        expect(Math.abs(p.GA - GA)).toBeLessThanOrEqual(stepGA(GA) / 2 + 0.01 * GA);
        expect(Math.abs(p.Vs - Vs)).toBeLessThanOrEqual(stepF(Vs) / 2 + 0.01 * Vs);
      });
    });
  }
});

describe('continuous beam (three-moment equation)', () => {
  const EI = 1e9, L = 10, w = 100;
  it('simple span: wL^2/8, wL/2, 5wL^4/384EI', () => {
    const a = analyzeSpans(1, L, [w], EI);
    expect(a.Mpos).toBeCloseTo(w * L * L / 8, 6);
    expect(a.R[0]).toBeCloseTo(w * L / 2, 9);
    expect(a.defl).toBeCloseTo(5 * (w / 12) * (L * 12) ** 4 / (384 * EI), 4);
  });
  it('shear deformation matches NDS eq. 10.4-1 with Ks = 11.5 (simple span)', () => {
    const GA = 0.46e6, EIc = 115e6, a = analyzeSpans(1, 12, [50], EIc, GA);
    const EIapp = EIc / (1 + 11.5 * EIc / (GA * 144 * 144));
    expect(a.defl / (5 * (50 / 12) * 144 ** 4 / (384 * EIapp))).toBeCloseTo(1, 2);
  });
  it('two spans: -wL^2/8 at support, 1.25wL interior reaction, 0.0703wL^2 positive', () => {
    const a = analyzeSpans(2, L, [w, w], EI);
    expect(a.Msup[1]).toBeCloseTo(-w * L * L / 8, 6);
    expect(a.R[1]).toBeCloseTo(1.25 * w * L, 6);
    expect(a.Mpos / (w * L * L)).toBeCloseTo(0.0703, 4);
  });
  it('two spans, one loaded: 0.0957wL^2 positive', () => {
    expect(analyzeSpans(2, L, [w, 0], EI).Mpos / (w * L * L)).toBeCloseTo(0.0957, 4);
  });
  it('three spans: -0.1wL^2 at supports, 1.1wL interior reaction', () => {
    const a = analyzeSpans(3, L, [w, w, w], EI);
    expect(a.Msup[1]).toBeCloseTo(-0.1 * w * L * L, 6);
    expect(a.R[1]).toBeCloseTo(1.1 * w * L, 6);
  });
  it('pattern envelope picks one-span loading for positive moment', () => {
    expect(envelope(2, L, 0, w, EI).Mpos / (w * L * L)).toBeCloseTo(0.0957, 4);
  });
  it('support loads: simple wL, two-span interior 1.25wL', () => {
    expect(supportLoad(1, L, w, 0).D).toBeCloseTo(w * L, 9);
    expect(supportLoad(2, L, w, w).D).toBeCloseTo(1.25 * w * L, 6);
    expect(supportLoad(2, L, w, w).L).toBeCloseTo(1.25 * w * L, 6);
  });
});

describe('ASCE 7-22 §4.7 live load reduction', () => {
  it('interior column, 4 floors x 900 sq ft: 0.25 + 15/sqrt(14400) = 0.375 -> 0.40 floor', () => {
    expect(liveLoadReduction(50, KLL.interiorColumn, 3600, 4).factor).toBeCloseTo(0.4, 12);
  });
  it('interior beam, 750 sq ft: 0.25 + 15/sqrt(1500) = 0.6373', () => {
    expect(liveLoadReduction(50, KLL.interiorBeam, 750, 1).factor).toBeCloseTo(0.25 + 15 / Math.sqrt(1500), 12);
  });
  it('one floor limit 0.50; KLL AT < 400 not reduced; 100 psf assembly not reduced; > 100 psf 20% for 2+ floors', () => {
    expect(liveLoadReduction(50, 4, 10000, 1).factor).toBe(0.5);
    expect(liveLoadReduction(50, 2, 150, 1).factor).toBe(1);
    expect(liveLoadReduction(100, 4, 5000, 3).factor).toBe(1);
    expect(liveLoadReduction(125, 4, 5000, 3).factor).toBe(0.8);
  });
});

describe('NDS 2018 adjustment factors', () => {
  it('volume factor CV, 5 1/8 x 24, L = 30 ft: (21/30)^0.1 (12/24)^0.1 = 0.9003', () => {
    expect(volFactor(30, 24, 5.125)).toBeCloseTo(0.90034, 4);
  });
  it('volume factor uses b <= 10.75 in.', () => {
    expect(volFactor(30, 24, 14.25)).toBeCloseTo(volFactor(30, 24, 10.75), 12);
  });
  it('beam stability CL, 6 3/4 x 30, lu = 10 ft: le = 2.06 lu, RB = 12.76, CL = 0.9755', () => {
    const le = leGeneral(120, 30);
    expect(le).toBeCloseTo(247.2, 9);
    const r = beamStability(le, 30, 6.75, 2400, 0.95e6);
    expect(r.RB).toBeCloseTo(12.758, 3);
    expect(r.CL).toBeCloseTo(0.9755, 3);
  });
  it('column stability CP, 8 3/4 x 9, 13 ft, DF L2 (Fc 1950, Emin 0.85): CP = 0.802', () => {
    expect(columnStability(156 / 8.75, 1950, 0.85e6)).toBeCloseTo(0.8021, 3);
  });
});

describe('ASD and LRFD', () => {
  const cat = defaultCatalog();
  it('combinations per ASCE 7-22 with CD / lambda', () => {
    expect(combos('ASD').map(c => [c.cD, c.cL, c.time])).toEqual([[1, 0, 0.9], [1, 1, 1.0]]);
    expect(combos('LRFD').map(c => [c.cD, c.cL, c.time])).toEqual([[1.4, 0, 0.6], [1.2, 1.6, 0.8]]);
  });
  it('dead-only glulam beam: LRFD/ASD bending utilization = 1.4 x 0.9 / (2.54 x 0.85 x 0.6)', () => {
    const o = { b: 6.75, d: 24, L: 24, spans: 1 as const, wD: 500, wL: 0, llf: 1, brace: { kind: 'continuous' as const } };
    const a = memberCheck({ method: 'ASD', fire: 0, cltFallOff: true, colExp: 4 }, cat, o), l = memberCheck({ method: 'LRFD', fire: 0, cltFallOff: true, colExp: 4 }, cat, o);
    expect(l.u.b / a.u.b).toBeCloseTo(1.4 * 0.9 / (2.54 * 0.85 * 0.6), 9);
  });
  it('CLT rolling shear has no CD or lambda: LRFD capacity = 2.00 x 0.75 x Vs', () => {
    const P = cat.panels[4];
    const r = panelCheck({ method: 'LRFD', fire: 0, cltFallOff: true, colExp: 4 }, P, 12, 1, 20, 50, 1);
    expect(r.Vsp).toBeCloseTo(1.5 * P.Vs, 9);
  });
  it('CLT long-term deflection uses Kcr = 2.0', () => {
    const P = cat.panels[4], D = P.pcf * P.t / 12 + 25;
    const dD = analyzeSpans(1, 15, [D], P.EI * 1e6, P.GA * 1e6).defl;
    const r = panelCheck({ method: 'ASD', fire: 0, cltFallOff: true, colExp: 4 }, P, 15, 1, 25, 50, 1);
    expect(r.dT).toBeCloseTo(2.0 * dD + r.dL, 9);
    expect(r.dL).toBeCloseTo(analyzeSpans(1, 15, [50], P.EI * 1e6, P.GA * 1e6).defl, 9);
  });
});
