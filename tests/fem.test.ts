// FEM engine exchange (vib-engine/docs/integration.md), tested with the engine's own example files.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { caseInputs } from './golden/run';
import { defaultCatalog } from '../src/data/catalog';
import { exportDesign, parseFemResults, femStale, needsFem } from '../src/data/fem';
import { evalDesign, type Cfg, type Inputs } from '../src/engine';

const fx = (f: string) => readFileSync(join(__dirname, 'fixtures', 'fem', f), 'utf8');
const res = parseFemResults(fx('results_T2.json'));
const design = JSON.parse(fx('design_T2.json'));
const o: Inputs = { ...caseInputs('a-default-office-corridor'), layout: 'bay', A: 30, B: 25, LLv: 7, sdl: 25, damp: 0.03, fwMax: 2.2 };
const cfg: Cfg = { sys: 'T2', n: 3, pi: 1, pw: 6.75, pd: 21, gw: 10.75, gd: 30, ci: null };

describe('FEM exchange', () => {
  it('reads the engine example results', () => {
    expect(res.summary.f1_Hz).toBe(4.38);
    expect(res.summary.ap_fw_pct_g).toBe(0.584);
    expect(res.modes!.length).toBe(20);
  });
  it('exports the same design keys as the engine example, and the example results match it (not stale)', () => {
    const cat = defaultCatalog(), r = evalDesign(o, cat, cfg), d = exportDesign(o, cat, r, 1.6, 2.2);
    for (const k of Object.keys(design)) expect((d as unknown as Record<string, unknown>)[k]).toEqual(design[k]);
    expect(d.fw_range).toEqual([1.6, 2.2]);
    expect(d.panel!.name).toBe('V2 5-ply 6 7/8');
    expect(femStale(res, d)).toEqual([]);
  });
  it('marks results stale when the design changes', () => {
    const cat = defaultCatalog(), r = evalDesign(o, cat, { ...cfg, gd: 33 }), d = exportDesign(o, cat, r, 1.6, 2.2);
    expect(femStale(res, d)).toEqual(['gd']);
    const r2 = evalDesign({ ...o, sdl: 30 }, cat, cfg);
    expect(femStale(res, exportDesign({ ...o, sdl: 30 }, cat, r2, 1.6, 2.2))).toEqual(['sdl']);
  });
  it('topping weight goes into sdl with a note', () => {
    const o2 = { ...o, topType: 'concrete' as const, topT: 2 }, cat = defaultCatalog(), r = evalDesign(o2, cat, cfg);
    const d = exportDesign(o2, cat, r, 1.6, 2.2);
    expect(d.sdl).toBeCloseTo(25 + 145 * 2 / 12, 3);
    expect(d.source.notes[0]).toMatch(/topping/);
  });
  it('rejects files that are not engine results', () => {
    expect(() => parseFemResults('{}')).toThrow(/fem_engine/);
    expect(() => parseFemResults('{"engine":{"name":"fem_engine"},"input":{},"summary":{}}')).toThrow(/f1_Hz/);
  });
});

describe('cross-check with the engine example', () => {
  it("this tool's DG 11 option reproduces the engine's hand_method block", () => {
    const r = evalDesign({ ...o, vibMethod: 'dg11' }, defaultCatalog(), cfg);
    expect(r.fn).toBeCloseTo(res.hand_method!.f_dunkerley!, 1);
    expect(r.ap).toBeCloseTo(res.hand_method!.ap_pct_g!, 2);
    expect(r.wE).toBeCloseTo(res.hand_method!.wE!, 2);
  });
  it("this tool's guide method is conservative against FEM for this bay (0.662 vs 0.584 % g)", () => {
    const r = evalDesign(o, defaultCatalog(), cfg);
    const ratio = r.ap / res.summary.ap_fw_pct_g;
    expect(ratio).toBeGreaterThan(1.0);
    expect(ratio).toBeLessThan(1.3);
  });
});

describe('verify-with-FEM flags (engine VALIDATION.md sections 5 and 9)', () => {
  const cat = defaultCatalog();
  it('T1, light 3-ply T2 and T3 are flagged; near-limit results are flagged', () => {
    expect(needsFem(evalDesign(o, cat, { sys: 'T1', n: 0, pi: 4, pw: 5.125, pd: 9, gw: 10.75, gd: 36, ci: null }), 0.5)[0]).toMatch(/CLT on girders/);
    expect(needsFem(evalDesign(o, cat, { ...cfg, pi: 0 }), 0.5)[0]).toMatch(/3-ply/);
    expect(needsFem(evalDesign(o, cat, { ...cfg, sys: 'T3' }), 0.5)[0]).toMatch(/Dropped girders/);
    expect(needsFem(evalDesign(o, cat, cfg), 0.85)[0]).toMatch(/85% of the limit/);
    expect(needsFem(evalDesign(o, cat, cfg), 1.15)[0]).toMatch(/FEM may show it passes/);
    expect(needsFem(evalDesign(o, cat, cfg), 0.5)).toEqual([]);
    expect(needsFem(evalDesign(o, cat, cfg), 1.3)).toEqual([]);
  });
});
