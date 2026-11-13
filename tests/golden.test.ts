// Golden-file regression tests for the 5 reference cases (tests/golden/cases.mjs).
//
// tests/golden/concept-v7/  outputs of the original concept (v7), frozen by `npm run golden`.
//                           Phase 1 matched these exactly (commit b8a9c98). Kept as the historical baseline;
//                           `npm run compare:concept` reports how each case's best design has moved since.
// tests/golden/engine/      snapshots of the current engine. Any change in results fails this test;
//                           after an intended change run `npm run golden:update` and explain it in the commit.
//
// Numbers are compared with a relative tolerance, not as text: different Node/V8 versions (CI runs Node 22)
// can differ in the last bit of Math functions. Every structural difference (keys, lengths, chosen designs,
// pass/fail flags, strings) still fails.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CASES } from './golden/cases.mjs';
import { runCase } from './golden/run';

const REL = 1e-9, ABS = 1e-9;
const dir = join(__dirname, 'golden', 'engine');

function compare(a: unknown, b: unknown, path: string, errs: string[]) {
  if (errs.length > 20) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!(a === b || Math.abs(a - b) <= Math.max(ABS, REL * Math.max(Math.abs(a), Math.abs(b))))) errs.push(`${path}: ${a} vs snapshot ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { errs.push(`${path}: length ${a.length} vs snapshot ${b.length}`); return; }
    a.forEach((x, i) => compare(x, b[i], `${path}[${i}]`, errs));
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    if (ka.join() !== kb.join()) errs.push(`${path}: keys ${ka.join()} vs snapshot ${kb.join()}`);
    kb.forEach(k => compare((a as any)[k], (b as any)[k], `${path}.${k}`, errs));
  } else if (a !== b) errs.push(`${path}: ${JSON.stringify(a)} vs snapshot ${JSON.stringify(b)}`);
}

describe('golden: engine matches its snapshots', () => {
  for (const name of Object.keys(CASES)) {
    it(name, () => {
      const mine = runCase(name), file = join(dir, name + '.json');
      if (process.env.GOLDEN_UPDATE) { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(mine) + '\n'); return; }
      const errs: string[] = [];
      compare(mine, JSON.parse(readFileSync(file, 'utf8')), name, errs);
      expect(errs).toEqual([]);
    }, 60000);
  }

  it('detects a change (guards against a vacuous comparison)', () => {
    const snap = JSON.parse(readFileSync(join(dir, 'a-default-office-corridor.json'), 'utf8'));
    const bumped = JSON.parse(JSON.stringify(snap));
    bumped.points[snap.best].r.cpsf *= 1 + 1e-6;
    const errs: string[] = [];
    compare(bumped, snap, 'a', errs);
    expect(errs.length).toBe(1);
  });
});
