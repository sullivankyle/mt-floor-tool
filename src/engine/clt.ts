/**
 * CLT panels: section properties from the layup (PRG 320-2019 Appendix X3, shear analogy as used for Annex A)
 * and flatwise design per NDS 2018 Chapter 10.
 */
import type { DesignBasis, LamGrade, Panel, Util } from './types';
import { charDepth, cltFireRatio } from './fire';
import { combos, LRFD } from './loads';
import { envelope, supportLoad } from './beam';

/** Panel self weight, psf. P.pcf lb/ft^3, P.t in. */
export const psfOf = (P: Panel): number => P.pcf * P.t / 12;

/**
 * Simple-span midspan deflection of a 1 ft strip under uniform load (bending only).
 * @param wPsf load, psf (= lb/ft on a 1 ft strip); @param Lft span, ft; @param EI lbf-in^2 per ft of width. @returns in.
 */
export function stripDeflection(wPsf: number, Lft: number, EI: number): number {
  return 5 * (wPsf / 12) * Math.pow(Lft * 12, 4) / (384 * EI);
}

/**
 * CLT Handbook vibration-controlled span (guide §4.2.2).
 * @param EI lbf-in^2/ft; @param wPsf panel self weight, psf. @returns span limit, ft
 */
export const cltSpanLimit = (EI: number, wPsf: number): number => Math.pow(EI, 0.293) / Math.pow(wPsf, 0.122) / 13.34;

export interface LayupProps {
  t: number;    // thickness, in.
  pl: number;   // layers (-)
  EI: number;   // (EI)eff,f,0, 10^6 lbf-in^2/ft
  GA: number;   // (GA)eff,f,0, 10^6 lbf/ft
  FbS: number;  // (FbS)eff,f,0, ASD reference, lbf-ft/ft
  Vs: number;   // Vs,0, ASD reference, lbf/ft
}

/**
 * Major-direction flatwise properties from the layup, PRG 320-2019 Appendix X3.
 * Layers alternate major (L) and minor (T), starting and ending with L (symmetric layups; X3.1).
 * Transverse E = E/30; longitudinal G = E/16; rolling (transverse) G = longitudinal G/10 (X3.1).
 *  EI  : eq. X3-3, about the E-weighted neutral axis.
 *  GA  : eq. X3-5.
 *  FbS : eq. X3-1 ASD, 0.85 Fb,major Seff / 12 with Seff = 2 EI / (Emajor tp).
 *  Vs  : eq. X3-7 ASD, Fs,minor (2/3) Agross.
 * @param g lamination grade (PRG 320 Table A1); @param layers lamination thicknesses, in., bottom to top
 */
export function cltLayupProps(g: LamGrade, layers: number[]): LayupProps {
  const b = 12, n = layers.length, tp = layers.reduce((s, t) => s + t, 0);
  const Emaj = g.major.E * 1e6, Emin = g.minor.E * 1e6;
  const E = layers.map((_, i) => i % 2 === 0 ? Emaj : Emin / 30);
  const G = layers.map((_, i) => i % 2 === 0 ? Emaj / 16 : Emin / 16 / 10);
  let y = 0, EA = 0, EAy = 0; const yc: number[] = [];
  layers.forEach((t, i) => { yc.push(y + t / 2); EA += E[i] * t; EAy += E[i] * t * (y + t / 2); y += t; });
  const na = EAy / EA;
  let EI = 0;
  layers.forEach((t, i) => { EI += E[i] * b * t ** 3 / 12 + E[i] * b * t * (yc[i] - na) ** 2; });
  const t1 = layers[0], tn = layers[n - 1];
  let den = t1 / (2 * G[0] * b) + tn / (2 * G[n - 1] * b);
  for (let i = 1; i < n - 1; i++) den += layers[i] / (G[i] * b);
  const GA = (tp - t1 / 2 - tn / 2) ** 2 / den;
  const Seff = 2 * EI / (Emaj * tp);
  const FbS = 0.85 * g.major.Fb * Seff / 12;
  const Vs = g.minor.Fs * 2 / 3 * b * tp;
  return { t: tp, pl: n, EI: EI / 1e6, GA: GA / 1e6, FbS, Vs };
}

/** Fills t, pl, EI, GA, FbS, Vs on each panel from its layup, or from its override where given. Mutates and returns panels. */
export function resolvePanels(panels: Panel[], lams: Record<string, LamGrade>): Panel[] {
  panels.forEach(P => {
    const g = lams[P.grade];
    if (g && P.layers && P.layers.length) {
      const p = cltLayupProps(g, P.layers);
      Object.assign(P, { t: p.t, pl: p.pl, EI: p.EI, GA: p.GA, FbS: p.FbS, Vs: p.Vs });
      if (P.real === undefined) P.real = true;
    }
    if (P.override) { Object.assign(P, Object.fromEntries(Object.entries(P.override).filter(([k, v]) => k !== 'src' && v != null))); }
  });
  return panels;
}

export interface PanelResult {
  L: number;       // span, ft
  n: number;       // number of continuous spans analysed (-)
  w: number;       // service D + L, psf
  M: number;       // governing factored moment, lbf-ft/ft
  V: number;       // governing factored rolling shear, lbf/ft
  FbSp: number;    // adjusted moment capacity for the governing combination, lbf-ft/ft
  Vsp: number;     // adjusted rolling shear capacity, lbf/ft
  gov: string;     // governing combination for bending
  EIapp: number;   // simple-span apparent stiffness incl. shear (NDS eq. 10.4-1, Ks 11.5), lbf-in^2/ft (display)
  dL: number;      // live deflection, in.
  dT: number;      // long-term deflection Kcr dD + dL, in.
  u: Util;
  fr: number;      // fire section-modulus ratio (-)
  umax: number;
  ok: boolean;
  sup: { D: number; L: number };  // load to the governing supporting line (unfactored, unreduced live), plf
}

/** NDS 3.5.2: Kcr = 2.0 for CLT in dry service. */
export const KCR_CLT = 2.0;

/**
 * Flatwise CLT panel check, 1 to 3 equal spans, uniform load, live load patterned.
 * Bending: FbS' = FbS CD (ASD) or FbS KF phi lambda (LRFD); CL = 1 (flatwise). NDS Table 10.3.1.
 * Rolling shear: Vs' = Vs (no CD, no lambda; LRFD KF 2.00 phi 0.75). Checked at the support face.
 * Deflection: bending + shear (Timoshenko, matches NDS 10.4.1.1 Ks); live L/360, Kcr dD + dL <= L/240.
 * @param L span, ft; @param n spans; @param sdl superimposed dead, psf; @param LL live, psf (unreduced); @param llf live reduction factor (-)
 */
export function panelCheck(basis: DesignBasis, P: Panel, L: number, n: number, sdl: number, LL: number, llf = 1): PanelResult {
  const D = psfOf(P) + sdl, Lr = LL * llf, Lin = L * 12;
  const EIe = P.EI * 1e6, GA = P.GA * 1e6;
  const u: Util = { b: 0, v: 0, dl: 0, dt: 0, f: 0, br: 0 };
  let M = 0, V = 0, gov = '', FbSp = 0, Vsp = 0;
  for (const c of combos(basis.method)) {
    const e = envelope(n, L, c.cD * D, c.cL * Lr, EIe, GA, 0, false);
    const fb = basis.method === 'ASD' ? P.FbS * c.time : P.FbS * LRFD.Fb.KF * LRFD.Fb.phi * c.time;
    const fs = basis.method === 'ASD' ? P.Vs : P.Vs * LRFD.Fs.KF * LRFD.Fs.phi;
    const m = Math.max(e.Mpos, e.Mneg);
    if (m / fb > u.b) { u.b = m / fb; M = m; gov = c.name; FbSp = fb; }
    if (e.Vmax / fs > u.v) { u.v = e.Vmax / fs; V = e.Vmax; Vsp = fs; }
  }
  const dL = envelope(n, L, 0, LL, EIe, GA).defl, dD = envelope(n, L, D, 0, EIe, GA).defl;
  const dT = KCR_CLT * dD + dL;
  u.dl = dL / (Lin / 360); u.dt = dT / (Lin / 240);
  let fr = 1; const a = charDepth(basis.fire);
  if (a) {   // fire: ASD D + L, residual major plies (concept method, Phase 3 replaces)
    const Mf = envelope(n, L, D, Lr, EIe, GA, 0, false).Mpos;
    fr = cltFireRatio(P, a); u.f = fr > 0 ? Mf / (2.85 * P.FbS * fr) : 9.99;
  }
  const umax = Math.max(u.b, u.v, u.dl, u.dt, u.f);
  const EIapp = EIe / (1 + 11.5 * EIe / (GA * Lin * Lin));
  return { L, n, w: D + LL, M, V, FbSp, Vsp, gov, EIapp, dL, dT, u, fr, umax, ok: umax <= 1, sup: supportLoad(n, L, D, LL) };
}
