// Shared helpers: run a reference case through the current engine and summarize it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CASES } from './cases.mjs';
import { summarize } from './summarize.mjs';
import { defaultCatalog, DESIGN_DEFAULTS } from '../../src/data/catalog';
import { study, rank, priceWith, cltReason, glReason, type Inputs, type DesignResult } from '../../src/engine';

/** Inputs for a case: concept defaults (from the frozen concept file) + current design-basis defaults + case overrides. */
export function caseInputs(name: string): Inputs {
  const concept = JSON.parse(readFileSync(join(__dirname, 'concept-v7', name + '.json'), 'utf8'));
  return { ...concept.inputs, ...DESIGN_DEFAULTS, ...(CASES as Record<string, object>)[name] } as Inputs;
}

export function runCase(name: string) {
  const o = caseInputs(name), cat = defaultCatalog();
  const pts = study(o, cat), ranked = rank(o, pts);
  const priceRow = (r: DesignResult) => cat.mfrs.map((m, i) => {
    const why = cltReason(cat, m, r) || glReason(m, o);
    const p = priceWith(o, cat, r, r.q, i, i);
    return { why, cpsf: p.cpsf, total: p.total };
  });
  return summarize(o, pts, ranked, priceRow);
}
