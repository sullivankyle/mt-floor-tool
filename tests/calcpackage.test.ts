// The calc package must report exactly the checks the engine ran, with no missing or NaN values.
import { describe, it, expect } from 'vitest';
import { caseInputs } from './golden/run';
import { defaultCatalog } from '../src/data/catalog';
import { study, rank, evalDesign, calcPackage, type Inputs } from '../src/engine';

function check(o: Inputs) {
  const cat = defaultCatalog(), best = rank(o, study(o, cat))[0] ?? study(o, cat).find(p => p.r)!;
  const r = evalDesign(o, cat, best.cfg), pkg = calcPackage(o, cat, r);
  const lines = pkg.flatMap(s => s.lines);
  for (const l of lines) for (const s of [l.item, l.eq, l.val, l.ref]) expect(s).not.toMatch(/NaN|undefined/);
  const us = lines.filter(l => l.u != null).map(l => l.u as number);
  const engineU = [r.pan.u.b, r.pan.u.v, r.pan.u.dl, r.pan.u.dt, r.gir.u.b, r.gir.u.v, r.gir.u.dl, r.gir.u.dt, r.col.u.n];
  if (r.pur) engineU.push(r.pur.u.b, r.pur.u.v, r.pur.u.dl, r.pur.u.dt);
  for (const u of engineU) expect(us).toContain(u);
  return { pkg, r };
}

describe('calc package', () => {
  it('default office case: every member check appears with its utilization', () => {
    const { pkg } = check(caseInputs('a-default-office-corridor'));
    expect(pkg.map(s => s.title.split(':')[0])).toEqual(['Design basis and loads', 'CLT panel', 'Purlin', 'Girder', 'Column', 'Vibration (closed-form modes)']);
  });
  it('2-hour fire and LRFD: fire lines present for every member', () => {
    const { pkg, r } = check({ ...caseInputs('c-2hr-fire-6-floors'), method: 'LRFD' });
    const fire = pkg.flatMap(s => s.lines).filter(l => l.item.startsWith('Fire'));
    expect(fire.length).toBe(r.pur ? 4 : 3);
    expect(pkg[0].lines[0].ref).toContain('2.3.1');
  });
  it('DG 11 option produces its own vibration section', () => {
    const { pkg } = check({ ...caseInputs('b-residential-single-bay'), vibMethod: 'dg11' });
    expect(pkg[pkg.length - 1].title).toBe('Vibration (AISC DG 11 option)');
  });
});
