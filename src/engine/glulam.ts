/**
 * Glulam bending members (purlins, girders) per NDS 2018 Chapter 5 with Chapter 3 provisions.
 */
import type { BeamGrade, Catalog, DesignBasis, Util } from './types';
import { charDepth, reducedSection, FIRE } from './fire';
import { combos, LRFD } from './loads';
import { envelope, supportLoad } from './beam';

/** Price factor for a glulam member of width b (in.): step function over catalog widths. */
export function glFactor(cat: Catalog, b: number): number {
  const k = Object.keys(cat.glW).map(Number).sort((a, c) => a - c); let f = cat.glW[k[0]];
  k.forEach(x => { if (b >= x) f = cat.glW[x]; });
  return f;
}

export function beamGrade(cat: Catalog): BeamGrade {
  return cat.glGrades.beams.find(g => g.name === cat.gl.beamGrade) || cat.glGrades.beams[0];
}

/**
 * Volume factor CV, NDS Supplement Table 5A adjustment factors / NDS 5.3.6, x = 10 (not Southern Pine).
 * b is taken as at most 10.75 in. (widest single piece for multi-piece widths).
 * @param L0 length between points of zero moment, ft; @param d in.; @param b in.
 */
export const volFactor = (L0: number, d: number, b: number): number =>
  Math.min(1, Math.pow(21 / L0, 0.1) * Math.pow(12 / d, 0.1) * Math.pow(5.125 / Math.min(b, 10.75), 0.1));

/**
 * Effective length for bending, NDS Table 3.3.3 footnote 1 (single span, load not otherwise listed). lu, d in. -> le in.
 */
export function leGeneral(lu: number, d: number): number {
  const r = lu / d;
  return r < 7 ? 2.06 * lu : r <= 14.3 ? 1.63 * lu + 3 * d : 1.84 * lu;
}

/** NDS Table 3.3.3 le/lu for equal point loads with lateral support at the load points, by number of loads. */
export function lePointFactor(loads: number): number {
  const t = [1.11, 1.68, 1.54, 1.68, 1.73, 1.78];   // 1 to 6 loads
  return loads >= 7 ? 1.84 : t[Math.max(1, loads) - 1];
}

/**
 * Beam stability factor CL, NDS 3.3.3, eq. 3.3-6. RB = sqrt(le d / b^2) <= 50; FbE = 1.20 Emin' / RB^2.
 * @param le in.; @param d, b in.; @param FbStar psi (all factors except Cfu, CV, CL); @param EminP psi
 * @returns CL, or 0 when RB > 50 (not permitted)
 */
export function beamStability(le: number, d: number, b: number, FbStar: number, EminP: number): { CL: number; RB: number } {
  const RB = Math.sqrt(le * d / (b * b));
  if (RB > 50) return { CL: 0, RB };
  const r = 1.20 * EminP / (RB * RB) / FbStar, k = (1 + r) / 1.9;
  return { CL: k - Math.sqrt(k * k - r / 0.95), RB };
}

export type Bracing = { kind: 'continuous' } | { kind: 'points'; lu: number; leFactor: number }; // lu ft

export interface BeamOpts {
  b: number; d: number;     // in.
  L: number;                // span, ft
  spans: 1 | 2;             // simple, or two equal spans continuous
  wD: number;               // superimposed dead line load (excl. self weight), plf
  wL: number;               // live line load, unreduced, plf
  llf: number;              // live load reduction factor (-)
  brace: Bracing;           // top (compression) edge bracing for positive moment
  bearing?: { lb: number }; // bearing length on the support below, in. (dropped girder width); checked if given
}

export interface MemberResult {
  b: number; d: number; L: number; spans: number;
  sw: number;   // self weight, plf
  T: number;    // service D + L (reduced), plf
  M: number;    // governing factored moment, lbf-in
  V: number;    // governing factored shear at d, lbf
  Fbp: number;  // Fb' for the governing case, psi
  Fvp: number;  // Fv' for the governing case, psi
  CL: number; CV: number; Cb: number; // (-)
  gov: string;  // governing combination
  dL: number; dT: number; // in.
  R: number;    // governing factored reaction, lbf
  fire: { a: number; bf: number; df: number; M: number; cap: number; CL: number } | null; // in., in., in., lbf-in, lbf-in, -
  u: Util; umax: number; ok: boolean;
  sup: { D: number; L: number };   // load to the governing supporting line (unfactored, unreduced live), lbf
}

/** NDS 3.5.2: Kcr = 1.5 for glulam in dry service. */
export const KCR_GLULAM = 1.5;

/**
 * Glulam beam check. Strength for every ASCE 7-22 gravity combination (loads.ts), live load patterned on two spans.
 *  Fb' = Fbx CD CM Ct (lesser of CL, CV)    NDS Table 5.3.1, 5.3.6; LRFD x KF 2.54 x phi 0.85 x lambda
 *  Negative moment (two spans) uses Fbx- (or Fbx+ when specified balanced) with the bottom edge unbraced over 0.25 L.
 *  Fv' = Fvx CD CM Ct, shear at d from the support (NDS 3.4.3.1(a)); Cvr = 1.0 (prismatic, no notches).
 *  Deflection with Ex app: live L/360; Kcr dD + dL <= L/240 (NDS 3.5.2, Kcr 1.5).
 *  Bearing: fc_perp = R / (b lb) <= Fc_perp Cb (NDS 3.10.2, Cb 3.10.4 at the interior support).
 */
export function memberCheck(basis: DesignBasis, cat: Catalog, o: BeamOpts): MemberResult {
  const g = beamGrade(cat), { b, d, L, spans } = o;
  const sw = b * d / 144 * cat.gl.pcf, D = o.wD + sw, Lr = o.wL * o.llf, L12 = L * 12;
  const S = b * d * d / 6, I = b * d * d * d / 12, E = g.Ex * 1e6;
  const lrfd = basis.method === 'LRFD';
  const EminP = g.Exmin * 1e6 * (lrfd ? LRFD.Emin.KF * LRFD.Emin.phi : 1);
  const Fbn = spans > 1 && cat.gl.balancedContinuous ? g.Fbp : g.Fbn;
  const CVp = volFactor(spans > 1 ? 0.75 * L : L, d, b), CVn = volFactor(0.5 * L, d, b);
  const u: Util = { b: 0, v: 0, dl: 0, dt: 0, f: 0, br: 0 };
  let M = 0, V = 0, Fbp = 0, Fvp = 0, CL = 1, CV = CVp, gov = '', R = 0, Cb = 1;
  for (const c of combos(basis.method)) {
    const e = envelope(spans, L, c.cD * D, c.cL * Lr, E * I, Infinity, d, false);
    const tf = c.time;                                 // CD (ASD) or lambda (LRFD)
    const kb = lrfd ? LRFD.Fb.KF * LRFD.Fb.phi : 1, kv = lrfd ? LRFD.Fv.KF * LRFD.Fv.phi : 1;
    // positive moment
    let CLp = 1;
    if (o.brace.kind === 'points') CLp = beamStability(o.brace.leFactor * o.brace.lu * 12, d, b, g.Fbp * tf * kb, EminP).CL;
    const fbP = g.Fbp * tf * kb * Math.min(CLp, CVp);
    const uP = fbP > 0 ? e.Mpos * 12 / S / fbP : 9.99;
    // negative moment over the interior support: bottom edge in compression, lu = 0.25 L to the inflection point
    let uN = 0, fbN = 0, CLn = 1;
    if (spans > 1) {
      CLn = beamStability(leGeneral(0.25 * L12, d), d, b, Fbn * tf * kb, EminP).CL;
      fbN = Fbn * tf * kb * Math.min(CLn, CVn);
      uN = fbN > 0 ? e.Mneg * 12 / S / fbN : 9.99;
    }
    if (Math.max(uP, uN) > u.b) {
      u.b = Math.max(uP, uN); gov = c.name;
      if (uP >= uN) { M = e.Mpos * 12; Fbp = fbP; CL = CLp; CV = CVp; } else { M = e.Mneg * 12; Fbp = fbN; CL = CLn; CV = CVn; }
    }
    const fv = g.Fv * tf * kv, uv = 1.5 * e.Vd / (b * d) / fv;
    if (uv > u.v) { u.v = uv; V = e.Vd; Fvp = fv; }
    if (o.bearing) {
      const cb = spans > 1 && o.bearing.lb < 6 ? (o.bearing.lb + 0.375) / o.bearing.lb : 1;
      const fcp = g.Fcperp * cb * (lrfd ? LRFD.Fcperp.KF * LRFD.Fcperp.phi : 1);   // no CD or lambda on Fc_perp
      const ub = e.Rmax / (b * o.bearing.lb) / fcp;
      if (ub > u.br) { u.br = ub; R = e.Rmax; Cb = cb; }
    } else R = Math.max(R, e.Rmax);
  }
  const dL = envelope(spans, L, 0, o.wL, E * I).defl, dD = envelope(spans, L, D, 0, E * I).defl;
  const dT = KCR_GLULAM * dD + dL;
  u.dl = dL / (L12 / 360); u.dt = dT / (L12 / 240);
  // Fire, NDS 16.2: 3-sided exposure (CLT on top), a_eff per 16.2-4; Table 16.2.2: Fb x 2.85 x (lesser of CV on the
  // original section, CL on the reduced section with FbE x 2.03); ASD D + L. No shear factor in Table 16.2.2.
  const a = charDepth(basis.fire);
  let fire: MemberResult['fire'] = null;
  if (a > 0) {
    const e = envelope(spans, L, D, Lr, E * I, Infinity, d, false);
    const { bf, df } = reducedSection(b, d, a, 3), EminF = FIRE.FbE * g.Exmin * 1e6;
    if (bf > 0 && df > 0) {
      const Sf = bf * df * df / 6;
      const CLp = o.brace.kind === 'points' ? beamStability(o.brace.leFactor * o.brace.lu * 12, df, bf, FIRE.Fb * g.Fbp, EminF).CL : 1;
      const capP = FIRE.Fb * g.Fbp * Math.min(CLp, CVp) * Sf;
      let capN = Infinity, CLn = 1;
      if (spans > 1) { CLn = beamStability(leGeneral(0.25 * L12, df), df, bf, FIRE.Fb * Fbn, EminF).CL; capN = FIRE.Fb * Fbn * Math.min(CLn, CVn) * Sf; }
      const uP = capP > 0 ? e.Mpos * 12 / capP : 9.99, uN = spans > 1 ? (capN > 0 ? e.Mneg * 12 / capN : 9.99) : 0;
      u.f = Math.max(uP, uN);
      fire = uP >= uN ? { a, bf, df, M: e.Mpos * 12, cap: capP, CL: CLp } : { a, bf, df, M: e.Mneg * 12, cap: capN, CL: CLn };
    } else { u.f = 9.99; fire = { a, bf, df, M: 0, cap: 0, CL: 0 }; }
  }
  const umax = Math.max(u.b, u.v, u.dl, u.dt, u.f, u.br);
  return { b, d, L, spans, sw, T: D + Lr, M, V, Fbp, Fvp, CL, CV, Cb, gov, dL, dT, R, fire, u, umax, ok: umax <= 1, sup: supportLoad(spans, L, D, o.wL) };
}
