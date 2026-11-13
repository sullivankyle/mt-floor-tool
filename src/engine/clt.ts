/**
 * CLT panel checks (concept v7 port, unchanged behaviour).
 * Phase 2 replaces the fixed catalog properties with the PRG 320 Annex shear analogy.
 */
import type { Inputs, Panel, Util } from './types';
import { charDepth, cltFireRatio } from './fire';

/** Panel self weight, psf. P.pcf lb/ft^3, P.t in. */
export const psfOf = (P: Panel): number => P.pcf * P.t / 12;

/**
 * Simple-span midspan deflection of a 1 ft strip under uniform load.
 * @param wPsf load, psf (= lb/ft on a 1 ft strip)
 * @param Lft span, ft
 * @param EI stiffness, lbf-in^2 per ft of width
 * @returns deflection, in.
 */
export function stripDeflection(wPsf: number, Lft: number, EI: number): number {
  return 5 * (wPsf / 12) * Math.pow(Lft * 12, 4) / (384 * EI);
}

/**
 * CLT Handbook vibration-controlled span (guide §4.2.2, eq. from the CLT Handbook ch. 7).
 * @param EI lbf-in^2/ft; @param wPsf panel self weight, psf. @returns span limit, ft
 */
export const cltSpanLimit = (EI: number, wPsf: number): number => Math.pow(EI, 0.293) / Math.pow(wPsf, 0.122) / 13.34;

export interface PanelResult {
  L: number;      // span, ft
  w: number;      // total ASD load D + L, psf
  M: number;      // moment, lbf-ft/ft
  V: number;      // shear, lbf/ft
  EIapp: number;  // apparent stiffness incl. shear, lbf-in^2/ft
  dL: number;     // live deflection, in.
  dT: number;     // total deflection, in.
  u: Util;
  fr: number;     // fire section-modulus ratio (-)
  umax: number;
  ok: boolean;
}

/**
 * Simple-span CLT panel strength, deflection and fire check, ASD D + L.
 * Shear deformation via PRG 320 apparent stiffness with Ks = 11.5 (uniform load, pinned-pinned).
 * @param L span, ft
 */
export function panelCheck(o: Inputs, P: Panel, L: number): PanelResult {
  const D = psfOf(P) + o.sdl, w = D + o.LLd, Lin = L * 12;
  const M = w * L * L / 8, V = w * L / 2;
  const EIe = P.EI * 1e6, GA = P.GA * 1e6, EIapp = EIe / (1 + 11.5 * EIe / (GA * Lin * Lin));
  const dL = stripDeflection(o.LLd, L, EIapp), dT = stripDeflection(w, L, EIapp);
  const u: Util = { b: M / P.FbS, v: V / P.Vs, dl: dL / (Lin / 360), dt: dT / (Lin / 240), f: 0 };
  let fr = 1; const a = charDepth(o.fire);
  if (a) { fr = cltFireRatio(P, a); u.f = fr > 0 ? M / (2.85 * P.FbS * fr) : 9.99; }
  const umax = Math.max(u.b, u.v, u.dl, u.dt, u.f);
  return { L, w, M, V, EIapp, dL, dT, u, fr, umax, ok: umax <= 1 };
}
