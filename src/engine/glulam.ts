/**
 * Glulam beam checks (concept v7 port). Phase 2 replaces with full NDS Ch. 5 adjustment factors.
 */
import type { Catalog, Inputs, Util } from './types';
import { charDepth } from './fire';

/** Price factor for a glulam member of width b (in.): step function over catalog widths. */
export function glFactor(cat: Catalog, b: number): number {
  const k = Object.keys(cat.glW).map(Number).sort((a, c) => a - c); let f = cat.glW[k[0]];
  k.forEach(x => { if (b >= x) f = cat.glW[x]; });
  return f;
}

/**
 * Volume factor Cv, NDS 5.3.6 with x = 10 (western species). L ft, d in., b in.
 * Not combined with CL here (concept applies Cv alone).
 */
export const volFactor = (L: number, d: number, b: number): number =>
  Math.min(1, Math.pow(21 / L, 0.1) * Math.pow(12 / d, 0.1) * Math.pow(5.125 / b, 0.1));

export interface MemberResult {
  b: number; d: number; L: number;  // in., in., ft
  sw: number;   // self weight, plf
  T: number;    // total load, plf
  M: number;    // moment, lbf-in
  V: number;    // shear, lbf
  Fbp: number;  // adjusted Fb, psi
  dL: number; dT: number; // in.
  u: Util; umax: number; ok: boolean;
}

/**
 * Simple-span glulam beam, uniform load, ASD D + L.
 * @param b width, in.; @param d depth, in.; @param L span, ft
 * @param wD superimposed dead line load, plf (self weight added here); @param wL live line load, plf
 */
export function memberCheck(o: Inputs, cat: Catalog, b: number, d: number, L: number, wD: number, wL: number): MemberResult {
  const gl = cat.gl, E = gl.E * 1e6;
  const sw = b * d / 144 * gl.pcf, T = wD + sw + wL, L12 = L * 12;
  const S = b * d * d / 6, I = b * d * d * d / 12;
  const M = T * L * L / 8 * 12, V = T * L / 2;
  const Fbp = gl.Fb * volFactor(L, d, b);
  const dL = 5 * (wL / 12) * Math.pow(L12, 4) / (384 * E * I), dT = 5 * (T / 12) * Math.pow(L12, 4) / (384 * E * I);
  const u: Util = { b: M / S / Fbp, v: 1.5 * V / (b * d) / gl.Fv, dl: dL / (L12 / 360), dt: dT / (L12 / 240), f: 0 };
  const a = charDepth(o.fire);
  // Fire: 3-sided exposure, 2.85 Fb and 2.75 Fv (NDS Table 16.2.2 ASD factors), no CD/Cv in fire.
  if (a) { const bf = b - 2 * a, df = d - a; u.f = bf > 0 && df > 0 ? Math.max(M / (bf * df * df / 6) / (2.85 * gl.Fb), 1.5 * V / (bf * df) / (2.75 * gl.Fv)) : 9.99; }
  const umax = Math.max(u.b, u.v, u.dl, u.dt, u.f);
  return { b, d, L, sw, T, M, V, Fbp, dL, dT, u, umax, ok: umax <= 1 };
}
