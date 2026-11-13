// Generates the golden files by running the ORIGINAL concept page in jsdom.
// Usage: npm run golden. Only rerun this if the concept file itself changes;
// the golden files define "no behavior change" for the ported engine.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { CASES } from './cases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const html = readFileSync(join(root, 'concept', 'vibration-concept.html'), 'utf8');
const summarizeSrc = readFileSync(join(here, 'summarize.mjs'), 'utf8').replace(/^export\s+/m, '');
const outDir = join(here, 'cases');
mkdirSync(outDir, { recursive: true });

for (const [name, overrides] of Object.entries(CASES)) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(summarizeSrc);
  const json = w.eval(`(() => {
    const o0 = readInputs(); Object.assign(o0, ${JSON.stringify(overrides)}); setInputs(o0); render();
    const o = readInputs();
    const priceRow = r => CAT.mfrs.map((m, i) => {
      const why = cltReason(m, r) || glReason(m, o);
      const p = priceWith(o, r, r.q, i, i);
      return { why, cpsf: p.cpsf, total: p.total };
    });
    return JSON.stringify(summarize(o, S.pts, S.ranked, priceRow));
  })()`);
  const data = JSON.parse(json);
  writeFileSync(join(outDir, name + '.json'), JSON.stringify(data) + '\n');
  const b = data.best >= 0 ? data.points[data.best] : null;
  console.log(`${name}: ${data.nPoints} points, ${data.ranked.length} pass, best ${b ? `${b.cfg.sys}/${b.cfg.n} $${b.r.cpsf.toFixed(2)}/sf ${b.r.fn.toFixed(2)} Hz` : 'none'}`);
  w.close();
}
