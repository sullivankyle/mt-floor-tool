// Not a pass/fail test: this tool's vibration estimate for the FEM engine's example design (examples/design_T2.json).
import { it } from 'vitest';
import { caseInputs } from '../golden/run';
import { defaultCatalog } from '../../src/data/catalog';
import { evalDesign } from '../../src/engine';

it('FEM example T2 design', () => {
  const cat = defaultCatalog();
  const base = { ...caseInputs('a-default-office-corridor'), layout: 'bay' as const, A: 30, B: 25, LLv: 7, sdl: 25, damp: 0.03, fwMax: 2.2 };
  const cfg = { sys: 'T2' as const, n: 3, pi: 1, pw: 6.75, pd: 21, gw: 10.75, gd: 30, ci: null };
  for (const vibMethod of ['guide', 'dg11'] as const) {
    const r = evalDesign({ ...base, vibMethod }, cat, cfg);
    const fm = r.vib.fm;
    console.log(vibMethod, 'f1', r.fn.toFixed(2), 'fp', r.fp.toFixed(2), 'fj', r.fj?.toFixed(2), 'fg', r.fg.toFixed(2), 'ap %g', r.ap.toFixed(3),
      fm ? `M1 ${fm.M1.toFixed(1)} (Mp ${fm.Mp.toFixed(1)} Mj ${fm.Mj?.toFixed(1)} Mg ${fm.Mg.toFixed(1)}) fw ${r.vib.ev?.res?.fw.toFixed(3)}` : `W ${(r.W / 1000).toFixed(1)} kip`, 'wE', r.wE.toFixed(1));
  }
  console.log('FEM: f1 4.38 Hz, M1 179.8, ap_fw 0.584 (worst) / 0.516 (centre); engine hand (DG 11 style) f 3.40 Hz, 1.025 %g');
});
