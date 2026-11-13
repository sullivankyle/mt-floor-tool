/**
 * Structural evaluation of one typical bay for a given configuration (concept evalStructure).
 * Combines the CLT, glulam, column and vibration modules and adds depth, pick weights and constraints.
 */
import type { Catalog, Cfg, Inputs, Panel } from './types';
import { psfOf, panelCheck, stripDeflection, type PanelResult } from './clt';
import { memberCheck, type MemberResult } from './glulam';
import { columnCheck, type ColumnResult } from './columns';
import { bayVibration } from './vibration';
import { COLS } from '../data/catalog';

export interface StructureResult {
  cfg: Cfg; P: Panel; T2: boolean; stack: boolean;
  s: number | null;   // purlin spacing, ft
  Lp: number;         // CLT span, ft
  pan: PanelResult; pur: MemberResult | null; gir: MemberResult; col: ColumnResult;
  Pcol: number;       // column axial load, lbf
  wE: number;         // vibration weight, psf
  dp: number; fp: number; dj: number | null; fj: number | null; dg: number; fg: number; fn: number; // in., Hz
  W: number;          // effective weight, lb
  ap: number;         // peak acceleration, % g
  Lpan: number | null; // shipped panel length, ft (null = longer than max)
  depth: number;      // structural depth, in.
  wts: { panel: number; purlin: number; girder: number; column: number }; // pick weights, lb
  heavy: [string, number];
  strOk: boolean; depthOk: boolean; pickOk: boolean; vibF: boolean; vibA: boolean;
}

export function evalStructure(o: Inputs, cat: Catalog, cfg: Cfg): StructureResult {
  const P = cat.panels[cfg.pi], gl = cat.gl, E = gl.E * 1e6, T2 = cfg.sys !== 'T1', stack = cfg.sys === 'T3';
  const s = T2 ? o.A / cfg.n : null, Lp = (T2 ? s : o.B) as number, pPsf = psfOf(P);
  const pan = panelCheck(o, P, Lp), Dfl = pPsf + o.sdl;
  const pw = cfg.pw as number, pd = cfg.pd as number, gd = cfg.gd as number;
  const pur = T2 ? memberCheck(o, cat, pw, pd, o.B, Dfl * (s as number), o.LLd * (s as number)) : null;
  const purSW = pur ? pur.sw : 0, extra = T2 ? purSW * o.B / (s as number) : 0;
  const gir = memberCheck(o, cat, cfg.gw, gd, o.A, Dfl * o.B + extra, o.LLd * o.B);
  // vibration
  const wE = pPsf + o.sdl + o.LLv, Ds = P.EI * 1e6;
  const dp = stripDeflection(wE, Lp, Ds);
  const vib = bayVibration({ T2, A: o.A, B: o.B, s, wE, Ds, dp, E, gw: cfg.gw, gd, pw, pd, girSW: gir.sw, purSW, extra, damp: o.damp });
  // column (one bay of tributary area per floor)
  const area = o.A * o.B;
  const framPsf = ((T2 ? cfg.n * pw * pd / 144 * o.B : 0) + cfg.gw * gd / 144 * o.A) * gl.pcf / area;
  const Pcol = o.stories * (Dfl + framPsf + o.LLd) * area;
  let col!: ColumnResult;
  if (cfg.ci == null) { for (const c of COLS) { col = columnCheck(o, cat, c[0], c[1], Pcol); if (col.ok) break; } }
  else col = columnCheck(o, cat, COLS[cfg.ci][0], COLS[cfg.ci][1], Pcol);
  // panel pieces, depth, pick weights
  const { panW, panMax } = cat.logi;
  const Lpan = Lp > panMax ? null : Math.max(Lp, Math.floor(panMax / Lp) * Lp);
  const depth = stack ? P.t + pd + gd : P.t + Math.max(gd, T2 ? pd : 0);
  const wts = { panel: Lpan ? pPsf * panW * Lpan : 0, purlin: T2 ? purSW * o.B : 0, girder: gir.sw * o.A, column: col.b * col.d / 144 * o.H * gl.pcf };
  const heavy = Object.entries(wts).sort((a, b) => b[1] - a[1])[0] as [string, number];
  const strOk = pan.ok && (!pur || pur.ok) && gir.ok && col.ok && !!Lpan;
  const depthOk = !o.maxD || depth <= o.maxD, pickOk = !o.maxPick || heavy[1] <= o.maxPick * 1000;
  return { cfg, P, T2, stack, s, Lp, pan, pur, gir, col, Pcol, wE, dp, fp: vib.fp, dj: vib.dj, fj: vib.fj, dg: vib.dg, fg: vib.fg, fn: vib.fn, W: vib.W, ap: vib.ap,
           Lpan, depth, wts, heavy, strOk, depthOk, pickOk, vibF: vib.fn >= o.target, vibA: vib.ap <= o.alim };
}
