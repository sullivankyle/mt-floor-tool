/**
 * Structural evaluation of one typical bay for a given configuration.
 * Load path: CLT panel reactions -> purlins -> girders (smeared per ft) -> columns (tributary A x B per floor).
 * Each member applies its own ASCE 7-22 §4.7 live load reduction; reactions pass on unreduced live load.
 */
import { basisOf, type Catalog, type Cfg, type DesignBasis, type Inputs, type LamGrade, type Panel } from './types';
import { psfOf, panelCheck, stripDeflection, type PanelResult } from './clt';
import { memberCheck, beamGrade, lePointFactor, type MemberResult, type Bracing } from './glulam';
import { columnCheck, type ColumnResult } from './columns';
import { bayVibration, floorModes, guideEvaluate, compositeEI, concreteLayer, G, type Layer, type FloorModes, type GuideResult } from './vibration';
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
  W: number;          // effective weight, lb (guide method: 2 g x bay modal mass)
  ap: number;         // governing weighted peak acceleration, % g (0 if the floor is transient-only)
  vrms: number;       // governing weighted RMS velocity, micro-in./s (0 if resonant-only or DG 11)
  vib: VibDetail;     // vibration stiffness, modes and response detail
  topPsf: number;     // topping weight, psf
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
  // topping weight is dead load for strength (its stiffness is credited for vibration only, guide Table 3-5)
  const top = toppingOf(o, cat), sdl = o.sdl + top.psf;
  const pan = panelCached(basis, P, Lp, nPan, sdl, o.LLd, llfPan, cat.lams[P.grade]);
  const Dfl = pPsf + sdl;
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
  // vibration (guide §4.3 with closed-form modes, or AISC DG 11)
  const wE = pPsf + sdl + o.LLv;
  const vibs = vibrationOf(o, cat, { P, T2, stack, s, Lp, nPan, purSpans, wE, E, cfg, pw, pd, gd, girSW: gir.sw, purSW, extra, top });
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
           pan, pur, gir, col, Pcol: PD + PL, wE, ...vibs.fields, vib: vibs.detail, topPsf: top.psf,
           Lpan, depth, wts, heavy, conn: connectionProtection(o.fire, cfg.sys, pw, cfg.gw, col.b, cat.connGeom.concealedW), strOk, depthOk, pickOk,
           vibF: vibs.fields.fn >= o.target, vibA: vibs.ok };
}

/** Topping weight (psf) and, for concrete, its dynamic stiffness per ft width (guide 3.3.5). */
function toppingOf(o: Inputs, cat: Catalog): { psf: number; layer: (Layer & { GA: number }) | null } {
  const t = o.topType && o.topType !== 'none' ? cat.vib.toppings[o.topType] : null;
  if (!t || !(o.topT > 0)) return { psf: 0, layer: null };
  return { psf: t.pcf * o.topT / 12, layer: t.stiff ? concreteLayer(o.topT, t.fc ?? 4000, t.dyn ?? 1.35) : null };
}

export interface VibDetail {
  method: 'guide' | 'dg11';
  EIx: number; EIy: number; GAx: number;   // panel vibration stiffness incl. topping, lbf-in^2/ft, lbf/ft
  Ij: number | null; Ig: number;           // beam I for vibration incl. composite credit, in^4
  fm: FloorModes | null; ev: GuideResult | null;
  fwMin: number; fwMax: number;
}

interface VibArgs {
  P: Panel; T2: boolean; stack: boolean; s: number | null; Lp: number; nPan: number; purSpans: number;
  wE: number; E: number; cfg: Cfg; pw: number; pd: number; gd: number; girSW: number; purSW: number; extra: number;
  top: { psf: number; layer: (Layer & { GA: number }) | null };
}

/**
 * Vibration stiffness and response. Panel: CLT major/minor EI plus the topping by the gamma method (§3.4.1).
 * Beams: incidental composite action with the CLT where the panel is clamped to the beam (§3.4.3, Figs 3-3 to 3-5):
 * purlins and no-purlin girders use the panel's minor-direction properties, flush girders the major direction,
 * dropped girders none; flange width min(L/2.5, beam spacing).
 */
function vibrationOf(o: Inputs, cat: Catalog, a: VibArgs) {
  const P = a.P, E = a.E, cfg = a.cfg;
  const clt0: Layer = { EI: P.EI * 1e6, EA: (P.EA0 ?? 0) * 1e6, h: P.t }, clt90: Layer = { EI: (P.EI90 ?? P.EI / 30) * 1e6, EA: (P.EA90 ?? 0) * 1e6, h: P.t };
  const tl = a.top.layer, g = o.topGamma || 0;
  const EIx = tl ? compositeEI(tl, clt0, g).EI : clt0.EI, EIy = tl ? compositeEI(tl, clt90, g).EI : clt90.EI;
  const GAx = P.GA * 1e6 + (tl ? tl.GA : 0);
  // beams, with optional clamped CLT flange
  const tee = (b: number, d: number, L: number, spacing: number, deck: Layer, credit: boolean) => {
    const I = b * d ** 3 / 12;
    if (!credit || !(o.beamGamma > 0) || !(deck.EA > 0)) return I;
    const Beff = Math.min(L / 2.5, spacing);   // ft; deck values are per ft
    const fl: Layer = { EI: deck.EI * Beff, EA: deck.EA * Beff, h: deck.h };
    return compositeEI(fl, { EI: E * I, EA: E * b * d, h: d }, o.beamGamma).EI / E;
  };
  const Ij = a.T2 ? tee(a.pw, a.pd, o.B, a.s as number, clt90, true) : null;
  const Ig = tee(cfg.gw, a.gd, o.A, o.B, a.T2 ? clt0 : clt90, !a.stack);
  const fwMax = o.fwMax || 2.1, fwMin = Math.max(1.25, fwMax - cat.vib.fwSpan);
  if (o.vibMethod === 'dg11') {
    const dp = stripDeflection(a.wE, a.Lp, EIx);
    const v = bayVibration({ T2: a.T2, A: o.A, B: o.B, s: a.s, wE: a.wE, Ds: EIx, dp, E, gw: cfg.gw, gd: a.gd, pw: a.pw, pd: a.pd,
      girSW: a.girSW, purSW: a.purSW, extra: a.extra, damp: o.damp, Ig, Ij: Ij ?? undefined });
    const detail: VibDetail = { method: 'dg11', EIx, EIy, GAx, Ij, Ig, fm: null, ev: null, fwMin, fwMax };
    return { fields: { dp, fp: v.fp, dj: v.dj, fj: v.fj, dg: v.dg, fg: v.fg, fn: v.fn, W: v.W, ap: v.ap, vrms: 0 }, detail, ok: v.ap <= o.alim };
  }
  const floorW = o.layout === 'corr' ? 2 * o.nb * o.B + o.Wc : 3 * o.B;   // floor width across the girders, ft
  const fm = floorModes({ T2: a.T2, A: o.A, B: o.B, s: a.s, Lp: a.Lp, Ly: a.T2 ? o.B : o.A, nPan: a.nPan, purSpans: a.purSpans, wE: a.wE,
    panel: { EIx, EIy, GAx }, E, Ij, Ig, purSW: a.purSW, girSW: a.girSW, extra: a.extra, capJ: 2 * o.A, capG: floorW * 2 / 3, kH: cat.vib.kH });
  const walk = { P: cat.vib.walker.P, damp: o.damp, stride: cat.vib.walker.stride, path: Math.max(o.A, o.B * (o.layout === 'corr' ? o.nb : 1)) };
  const ev = guideEvaluate(fm.modes, { walk, fwMax, fwMin, step: cat.vib.fwStep, alim: o.alim, vlim: o.vlim || 16000 });
  // DG 11 effective weight kept for display (W = 2 g M1)
  const detail: VibDetail = { method: 'guide', EIx, EIy, GAx, Ij, Ig, fm, ev, fwMin, fwMax };
  return { fields: { dp: fm.dp, fp: fm.fp, dj: fm.dj, fj: fm.fj, dg: fm.dg, fg: fm.fg, fn: fm.f1, W: 2 * G * fm.M1, ap: ev.apfwPct, vrms: ev.vrms },
           detail, ok: ev.okA && ev.okV };
}
