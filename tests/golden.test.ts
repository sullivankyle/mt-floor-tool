// Golden-file tests: the ported engine must reproduce the concept (v7) exactly
// for the 5 reference cases in tests/golden/cases.mjs. Files are produced by
// `npm run golden`, which runs the original concept page in jsdom.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CASES } from './golden/cases.mjs';
import { summarize } from './golden/summarize.mjs';
import { defaultCatalog } from '../src/data/catalog';
import { study, rank, priceWith, cltReason, glReason, type Inputs, type DesignResult } from '../src/engine';

const REL = 1e-12;

function compare(a: unknown, b: unknown, path: string, errs: string[]) {
  if (errs.length > 20) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!(a === b || Math.abs(a - b) <= REL * Math.max(Math.abs(a), Math.abs(b)))) errs.push(`${path}: ${a} vs golden ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { errs.push(`${path}: length ${a.length} vs golden ${b.length}`); return; }
    a.forEach((x, i) => compare(x, b[i], `${path}[${i}]`, errs));
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    if (ka.join() !== kb.join()) errs.push(`${path}: keys ${ka.join()} vs golden ${kb.join()}`);
    kb.forEach(k => compare((a as any)[k], (b as any)[k], `${path}.${k}`, errs));
  } else if (a !== b) errs.push(`${path}: ${JSON.stringify(a)} vs golden ${JSON.stringify(b)}`);
}

describe('golden: port matches concept v7', () => {
  for (const name of Object.keys(CASES)) {
    it(name, () => {
      const golden = JSON.parse(readFileSync(join(__dirname, 'golden', 'cases', name + '.json'), 'utf8'));
      const o: Inputs = golden.inputs;
      const cat = defaultCatalog();
      const pts = study(o, cat);
      const ranked = rank(o, pts);
      const priceRow = (r: DesignResult) => cat.mfrs.map((m, i) => {
        const why = cltReason(cat, m, r) || glReason(m, o);
        const p = priceWith(o, cat, r, r.q, i, i);
        return { why, cpsf: p.cpsf, total: p.total };
      });
      const mine = summarize(o, pts, ranked, priceRow);
      const errs: string[] = [];
      compare(mine, golden, name, errs);
      expect(errs).toEqual([]);
    });
  }

  it('detects a change (guards against a vacuous comparison)', () => {
    const golden = JSON.parse(readFileSync(join(__dirname, 'golden', 'cases', 'a-default-office-corridor.json'), 'utf8'));
    const o: Inputs = golden.inputs;
    const cat = defaultCatalog();
    cat.inst.crew *= 1.0001;
    const pts = study(o, cat);
    const mine = summarize(o, pts, rank(o, pts), () => null);
    const errs: string[] = [];
    compare(mine, golden, 'a', errs);
    expect(errs.length).toBeGreaterThan(0);
  });
});
