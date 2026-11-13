/**
 * Structural evaluation of one typical bay for a given configuration.
 * Load path: CLT panel reactions -> purlins -> girders (smeared per ft) -> columns (tributary A x B per floor).
 * Each member applies its own ASCE 7-22 §4.7 live load reduction; reactions pass on unreduced live load.
 */
import { basisOf, type Catalog, type Cfg, type DesignBasis, type Inputs, type LamGrade, type Panel } from './types';
import { psfOf, panelCheck, stripDeflection, type PanelResult } from './clt';
import { memberCheck, beamGrade, lePointFactor, type MemberResult, type Bracing } from './glulam';
import { columnCheck, type ColumnResult } from './columns';
import { bayVibration } from './vibration';
import { liveLoadReduction, KLL } from './loads';
import { connectionProtection, type ConnFlag } from './fire';
import { COLS } from '../data/catalog';

export interface StructureResult {
  cfg: Cfg; P: Panel; T2: boolean; stack: boolean;
  s: number | null;   // purlin spacing, ft
  Lp: number;         // CLT span, ft
  nPan: number;       // CLT spans analysed continuous (-)
  purSpans: number;   // purlin spans continuous (-)
  llf: { pan: number; pur: number; gir: number; col: number }; // live load reduction factors (-)
  pan: PanelResult; pur: MemberResult | null; gir: MemberResult; col: ColumnResult;
  Pcol: number;       // column service load D + reduced L, lbf
  wE: number;         // vibration weight, psf
  dp: number; fp: number; dj: number | null; fj: number | null; dg: number; fg: number; fn: number; // in., Hz
  W: number;          // effective weight, lb
  ap: number;         // peak acceleration, % g
  Lpan: number | null; // shipped panel length, ft (null = longer than max)
  depth: number;      // structural depth, in.
  wts: { panel: number; purlin: number; girder: number; column: number }; // pick weights, lb
  heavy: [string, number];
  conn: ConnFlag[];   // NDS 16.3 connection protection flags (empty without a fire rating)
  strOk: boolean; depthOk: boolean; pickOk: boolean; vibF: boolean; vibA: boolean;
}

/**
 * The panel check depends only on the panel and loads, not on the beams, so the optimizer's many
 * evaluations per layout reuse it. Keyed on every value the check reads (panel edits change the key).
 */
const panelMemo = new Map<string, PanelResult>();
function panelCached(basis: DesignBasis, P: Panel, L: number, n: number, sdl: number, LL: number, llf: number, g?: LamGrade): PanelResult {
  const k = [basis.method, basis.fire, basis.cltFallOff, P.grade, P.layers.join(','), P.EI, P.GA, P.FbS, P.Vs, P.t, P.pl, P.pcf, L, n, sdl, LL, llf].join('|');
  let r = panelMemo.get(k);
  if (!r) { if (panelMemo.size > 5000) panelMemo.clear(); r = panelCheck(basis, P, L, n, sdl, LL, llf, g); panelMemo.set(k, r); }
  return r;
}

export function evalStructure(o: Inputs, cat: Catalog, cfg: Cfg): StructureResult {
  const basis = basisOf(o);
  const P = cat.panels[cfg.pi], gl = cat.gl, E = beamGrade(cat).Ex * 1e6, T2 = cfg.sys !== 'T1', stack = cfg.sys === 'T3';
  const s = T2 ? o.A / cfg.n : null, Lp = (T2 ? s : o.B) as number, pPsf = psfOf(P);
  const pw = cfg.pw as number, pd = cfg.pd as number, gd = cfg.gd as number;
  const { panW, panMax } = cat.logi;
  const Lpan = Lp > panMax ? null : Math.max(Lp, Math.floor(panMax / Lp) * Lp);
  // CLT: continuous over the spans one shipped panel covers (max 3 analysed)
  const nPan = o.panelCont === 'cont' && Lpan ? Math.min(3, Math.max(1, Math.round(Lpan / Lp))) : 1;
  const llfPan = liveLoadReduction(o.LLd, KLL.other, Lp * 1.5 * Lp, 1, o.llr).factor;   // one-way slab: AT <= span x 1.5 span
  const pan = panelCached(basis, P, Lp, nPan, o.sdl, o.LLd, llfPan, cat.lams[P.grade]);
  const Dfl = pPsf + o.sdl;
  // purlins
  const purSpans = T2 && stack && o.purlinCont === 'two' && o.layout === 'corr' && o.nb === 2 ? 2 : 1;
  let pur: MemberResult | null = null, llfPur = 1, gD: number, gL: number;
  if (T2) {
    const sp = s as number;
    llfPur = liveLoadReduction(o.LLd, KLL.interiorBeam, sp * o.B, 1, o.llr).factor;
    pur = memberCheck(basis, cat, { b: pw, d: pd, L: o.B, spans: purSpans as 1 | 2, wD: pan.sup.D, wL: pan.sup.L, llf: llfPur,
      brace: { kind: 'continuous' }, bearing: stack ? { lb: cfg.gw } : undefined });
    gD = pur.sup.D / sp; gL = pur.sup.L / sp;     // purlin reactions smeared along the girder, plf
  } else { gD = pan.sup.D; gL = pan.sup.L; }
  // girders: flush systems are braced by the CLT/purlin tops; dropped girders only at purlin points
  const brace: Bracing = stack ? { kind: 'points', lu: s as number, leFactor: lePointFactor(cfg.n - 1) } : { kind: 'continuous' };
  const llfGir = liveLoadReduction(o.LLd, KLL.interiorBeam, o.A * o.B, 1, o.llr).factor;
  const gir = memberCheck(basis, cat, { b: cfg.gw, d: gd, L: o.A, spans: 1, wD: gD, wL: gL, llf: llfGir, brace });
  const purSW = pur ? pur.sw : 0, extra = T2 ? purSW * o.B / (s as number) : 0;
  // vibration (unchanged method; Phase 4)
  const wE = pPsf + o.sdl + o.LLv, Ds = P.EI * 1e6;
  const dp = stripDeflection(wE, Lp, Ds);
  const vib = bayVibration({ T2, A: o.A, B: o.B, s, wE, Ds, dp, E, gw: cfg.gw, gd, pw, pd, girSW: gir.sw, purSW, extra, damp: o.damp });
  // column: one bay of tributary area per floor, all floors above, ASCE 7-22 4.7 with KLL = 4
  const area = o.A * o.B;
  const framPsf = ((T2 ? cfg.n * pw * pd / 144 * o.B : 0) + cfg.gw * gd / 144 * o.A) * gl.pcf / area;
  const llfCol = liveLoadReduction(o.LLd, KLL.interiorColumn, o.stories * area, o.stories, o.llr).factor;
  const PD = o.stories * (Dfl + framPsf) * area, PL = o.stories * o.LLd * area * llfCol;
  let col!: ColumnResult;
  if (cfg.ci == null) { for (const c of COLS) { col = columnCheck(basis, cat, c[0], c[1], PD, PL, o.H, o.Ke); if (col.ok) break; } }
  else col = columnCheck(basis, cat, COLS[cfg.ci][0], COLS[cfg.ci][1], PD, PL, o.H, o.Ke);
  // depth, pick weights
  const depth = stack ? P.t + pd + gd : P.t + Math.max(gd, T2 ? pd : 0);
  const wts = { panel: Lpan ? pPsf * panW * Lpan : 0, purlin: T2 ? purSW * o.B * purSpans : 0, girder: gir.sw * o.A, column: col.b * col.d / 144 * o.H * gl.pcf };
  const heavy = Object.entries(wts).sort((a, b) => b[1] - a[1])[0] as [string, number];
  const strOk = pan.ok && (!pur || pur.ok) && gir.ok && col.ok && !!Lpan;
  const depthOk = !o.maxD || depth <= o.maxD, pickOk = !o.maxPick || heavy[1] <= o.maxPick * 1000;
  return { cfg, P, T2, stack, s, Lp, nPan, purSpans, llf: { pan: llfPan, pur: llfPur, gir: llfGir, col: llfCol },
           pan, pur, gir, col, Pcol: PD + PL, wE, dp, fp: vib.fp, dj: vib.dj, fj: vib.fj, dg: vib.dg, fg: vib.fg, fn: vib.fn, W: vib.W, ap: vib.ap,
           Lpan, depth, wts, heavy, conn: connectionProtection(o.fire, cfg.sys, pw, cfg.gw, col.b, cat.connGeom.concealedW), strOk, depthOk, pickOk, vibF: vib.fn >= o.target, vibA: vib.ap <= o.alim };
}
