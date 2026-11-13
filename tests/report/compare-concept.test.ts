// Not a pass/fail test: prints how each reference case's best design differs from the concept (v7).
// Run with `npm run compare:concept`.
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CASES } from '../golden/cases.mjs';
import { runCase } from '../golden/run';

const sz = (b: number, d: number) => `${b}x${d}`;
const desc = (p: any) => !p ? 'none' :
  `${p.cfg.sys}/${p.cfg.n} panel#${p.cfg.pi} ${p.r.pur ? 'pur ' + sz(p.r.pur.b, p.r.pur.d) + ' ' : ''}gir ${sz(p.r.gir.b, p.r.gir.d)} col ${sz(p.r.col.b, p.r.col.d)} | $${p.r.cpsf.toFixed(2)}/sf ${p.r.depth.toFixed(1)} in. ${p.r.fn.toFixed(2)} Hz`;

it('compare best designs with concept v7', () => {
  const lines: string[] = [];
  for (const name of Object.keys(CASES)) {
    const c = JSON.parse(readFileSync(join(__dirname, '..', 'golden', 'concept-v7', name + '.json'), 'utf8'));
    const t0 = performance.now(), e = runCase(name), ms = performance.now() - t0;
    lines.push(`${name} (${ms.toFixed(0)} ms incl. summary)\n  concept: ${desc(c.points[c.best])}  (${c.ranked.length} pass)\n  now:     ${desc(e.points[e.best])}  (${e.ranked.length} pass)`);
  }
  console.log('\n' + lines.join('\n'));
}, 120000);
