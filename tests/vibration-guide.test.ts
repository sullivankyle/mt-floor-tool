// Guide §4.3 post-processors reproduced with the guide's published FEM modal data (Examples 1, 2, 3),
// plus Table 4-4 (CLT Handbook spans), Example 3 composite stiffness and the closed-form plate estimate.
import { describe, it, expect } from 'vitest';
import { resonantAt, transientAt, compositeEI, concreteLayer, cltSpanLimitRho, plateModes, effImpulse, G, type Mode } from '../src/engine/vibration';

describe('Example 1 (bearing wall, Table 7-2 modal data)', () => {
  const single: Mode[] = [{ f: 9.84, M: 12.4, mu: -1 }, { f: 11.17, M: 12.2, mu: 0 }, { f: 15.55, M: 12.8, mu: 1 }, { f: 21.59, M: 11.9, mu: 0 }, { f: 37.8, M: 9.1, mu: -0.89 }];
  const walk = { P: 168, damp: 0.03, stride: 2.5, path: 30 };
  it('Table 7-5 harmonics at fw = 1.85 Hz: 0.130, 0.181, 0.421, 1.063 in./s^2; ap,fw = 1.160 in./s^2 (0.30% g)', () => {
    const r = resonantAt(single, 1.85, walk);
    [0.130, 0.181, 0.421, 1.063].forEach((v, i) => expect(r.ah[i]).toBeCloseTo(v, 2));
    [0.088, 0.174, 0.421, 1.063].forEach((v, i) => expect(r.ahfw[i]).toBeCloseTo(v, 2));
    expect(r.apfw).toBeCloseTo(1.160, 2);
    expect(r.apfw / G * 100).toBeCloseTo(0.30, 2);
  });
  it('effective impulse 1.164 lbf-s; 1/3-octave band at 10.08 Hz gives vRMS about 43,634 mips', () => {
    expect(effImpulse(168, 1.85, 9.84)).toBeCloseTo(1.164, 2);
    const t = transientAt(single, 1.85, 168, 0.03);
    expect(t.band!.fc).toBeCloseTo(10.08, 2);
    expect(Math.abs(t.band!.vrms / 43634 - 1)).toBeLessThan(0.01);
  });
  it('two-span model: 1/3-octave vRMS about 21,815 mips', () => {
    const dbl: Mode[] = [{ f: 9.84, M: 24.8, mu: -1 }, { f: 11.17, M: 24.4, mu: 0 }, { f: 15.0, M: 22.1, mu: -0.96 }, { f: 15.55, M: 25.6, mu: -1 }, { f: 15.94, M: 21.7, mu: 0 }];
    expect(Math.abs(transientAt(dbl, 1.85, 168, 0.03).band!.vrms / 21815 - 1)).toBeLessThan(0.01);
  });
  it('closed-form plate estimate (15 x 30 ft, EI 380/98, GA 37.4e6, 46 psf) is within 5% of FEM 9.84 Hz and 10% of 12.4 lbf-s^2/in.', () => {
    const m = plateModes(380e6, 98e6, 37.4e6, 46, 15, 30, 1, 0.25)[0];
    expect(Math.abs(m.f / 9.84 - 1)).toBeLessThan(0.05);
    expect(Math.abs(m.M / 12.4 - 1)).toBeLessThan(0.10);
  });
});

describe('Example 2 (open floor, Table 8-6 modal data, fw = 2.2 Hz, 2.5% damping)', () => {
  const f = [9.01, 9.56, 9.70, 9.92, 9.93, 11.11, 13.49, 14.24], M = [178.1, 153.4, 122.6, 125.3, 69.2, 92.0, 126.0, 55.2];
  const mu = [-1.0, -0.997, -0.997, 0.994, -0.341, -0.521, 0.128, -0.0431];
  const modes: Mode[] = f.map((x, i) => ({ f: x, M: M[i], mu: mu[i] }));
  it('harmonics 0.153, 0.134, 0.361, 2.15 in./s^2; weighted 0.113, 0.134, 0.361, 1.96; ap,fw 2.00 in./s^2 (0.52% g)', () => {
    const r = resonantAt(modes, 2.2, { P: 168, damp: 0.025, stride: 2.5, path: 0 });
    [0.153, 0.134, 0.361, 2.15].forEach((v, i) => expect(Math.abs(r.ah[i] / v - 1)).toBeLessThan(0.02));
    [0.113, 0.134, 0.361, 1.96].forEach((v, i) => expect(Math.abs(r.ahfw[i] / v - 1)).toBeLessThan(0.02));
    expect(r.apfw).toBeCloseTo(2.00, 1);
    expect(r.ap).toBeCloseTo(2.19, 1);
  });
});

describe('Example 3 (SAP2000, Table 9-11 modal data, fw = 2.0 Hz, 3.5% damping)', () => {
  const t = [[14.76, -0.1252], [14.78, -0.114], [15.07, 0.0877], [15.57, 0.0941], [15.71, 0.1375], [15.8, 0.0729], [16.16, -0.1236], [16.84, 0.0345], [16.91, -0.0779], [17.96, -0.0204],
    [21.53, 0.0922], [22.86, -0.1364], [23.43, 0.0841], [24.77, -0.1314], [25.19, 0.1183], [26.33, 0.0213], [27.06, -0.1263], [27.95, -0.0606], [28.77, 0.0107], [28.83, 0.0228], [29.32, 0.006], [30.01, 0.0743]];
  // SAP2000 units: mu in ft, modal mass 83.33 lb-ft-s^2, so mu^2 I / M is in ft/s. Convert consistently to
  // in./s: mu^2 / 12 with M / 144 gives 12 x (ft/s).
  const modes: Mode[] = t.map(([f, m]) => ({ f, M: 83.33 / 144, mu: m * Math.sqrt(1 / 12) }));
  it('total vRMS about 3,300 mips and 1/3-octave about 3,100 mips at 16 Hz', () => {
    const r = transientAt(modes, 2.0, 168, 0.035);
    expect(Math.abs(r.vrms / 3300 - 1)).toBeLessThan(0.05);
    expect(Math.abs(r.band!.vrms / 3100 - 1)).toBeLessThan(0.05);
    expect(r.band!.fc).toBeCloseTo(16, 0);
  });
  it('composite CLT + 5 in. concrete, gamma 0.5 on the CLT: EI = 1,155,000 k-in^2/ft (major), 826,000 (minor)', () => {
    const c = concreteLayer(5, 4000);
    const major = compositeEI(c, { EI: 95e6, EA: 46.9e6, h: 4.125 }, 0.5);
    expect(major.on).toBe(2);
    expect(Math.abs(major.EI / 1.155e9 - 1)).toBeLessThan(0.002);
    expect(Math.abs(compositeEI(c, { EI: 3.1e6, EA: 21.3e6, h: 4.125 }, 0.5).EI / 0.826e9 - 1)).toBeLessThan(0.003);
  });
});

describe('DG 11 option keeps the Phase 3 behaviour', () => {
  it('case a with vibMethod dg11: best design $53.95/sf, 3 flush purlins (as committed in Phase 3)', async () => {
    const { caseInputs } = await import('./golden/run');
    const { defaultCatalog } = await import('../src/data/catalog');
    const { study, rank } = await import('../src/engine');
    const o = { ...caseInputs('a-default-office-corridor'), vibMethod: 'dg11' as const };
    const best = rank(o, study(o, defaultCatalog()))[0];
    expect(best.r!.cpsf).toBeCloseTo(53.95, 2);
    expect([best.cfg.sys, best.cfg.n]).toEqual(['T2', 3]);
  });
});

describe('Table 4-4: CLT Handbook vibration-controlled spans (rho A form)', () => {
  const rows: [string, number, number, number, number][] = [['E1', 115, 0.45, 49.5, 13.1], ['E1', 440, 0.45, 82.5, 18.2], ['E1', 1080, 0.45, 115.5, 22.7],
    ['E2', 389, 0.52, 82.5, 17.2], ['V2', 95, 0.45, 49.5, 12.4], ['V2', 363, 0.45, 82.5, 17.2], ['V2', 898, 0.45, 115.5, 21.5], ['V4', 285, 0.39, 82.5, 16.3]];
  for (const [g, EI, rho, A, L] of rows) it(`${g} EI ${EI}: ${L} ft`, () => expect(Math.abs(cltSpanLimitRho(EI * 1e6, rho, A) - L)).toBeLessThanOrEqual(0.051));
});
