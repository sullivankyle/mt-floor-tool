/**
 * Floor vibration (concept v7 port).
 * Frequency: guide §4.2.1 simple-span estimate and Dunkerley combination.
 * Acceleration: AISC DG 11 walking formula used as a placeholder (not validated for timber).
 * Phase 4 adds the guide's modal response methods (§4.3).
 */

/** Acceleration of gravity, in./s^2. */
export const G = 386.1;

/** Natural frequency from self-weight deflection, f = 0.18 sqrt(g / delta) (guide §4.2.1). delta in. -> Hz */
export const freqFromDefl = (d: number): number => 0.18 * Math.sqrt(G / d);

/** Dunkerley combination 1/f^2 = sum 1/fi^2. Hz -> Hz */
export const dunkerley = (fs: number[]): number => 1 / Math.sqrt(fs.reduce((s, f) => s + 1 / (f * f), 0));

/** Simple-span beam midspan deflection: w plf, L ft, E psi, I in^4 -> in. (E and I kept separate to keep the concept's float order) */
const beamDefl = (w: number, Lft: number, E: number, I: number): number => 5 * (w / 12) * Math.pow(Lft * 12, 4) / (384 * E * I);

export interface VibInput {
  T2: boolean;       // has purlins
  A: number; B: number; // ft
  s: number | null;  // purlin spacing, ft
  wE: number;        // expected weight for vibration (panel + SDL + LLv), psf
  Ds: number;        // panel EI, lbf-in^2/ft
  dp: number;        // panel deflection under wE, in.
  E: number;         // glulam E, psi
  gw: number; gd: number; pw?: number; pd?: number; // in.
  girSW: number;     // girder self weight, plf
  purSW: number;     // purlin self weight, plf
  extra: number;     // purlin weight smeared onto girder, plf
  damp: number;      // damping ratio (-)
}

export interface VibResult {
  fp: number; dj: number | null; fj: number | null; dg: number; fg: number; fn: number;
  W: number;   // effective weight, lb
  ap: number;  // peak acceleration, % g
}

/**
 * Frequencies and DG 11-style acceleration of one bay.
 * Effective widths: joist 2.0 (Ds/Dj)^0.25 Lj; girder 1.8 (Dj/Dg)^0.25 Lg (AISC DG 11 ch. 4 effective-width method, Cj = 2.0, Cg = 1.8).
 */
export function bayVibration(v: VibInput): VibResult {
  const { T2, A, B, s, wE, Ds, dp, E } = v;
  const fp = freqFromDefl(dp);
  const Ig = v.gw * Math.pow(v.gd, 3) / 12, lg = wE * B + v.extra + v.girSW;
  const dg = beamDefl(lg, A, E, Ig), fg = freqFromDefl(dg);
  let dj: number | null = null, fj: number | null = null, W: number;
  if (T2) {
    const sp = s as number;
    const Ip = (v.pw as number) * Math.pow(v.pd as number, 3) / 12, lj = wE * sp + v.purSW;
    dj = beamDefl(lj, B, E, Ip); fj = freqFromDefl(dj);
    const Dj = E * Ip / sp, Dg = E * Ig / B;
    const Wj = (lj / sp) * 2.0 * Math.pow(Ds / Dj, 0.25) * B * B, Wg = (lg / B) * 1.8 * Math.pow(Dj / Dg, 0.25) * A * A;
    W = (dj * Wj + dg * Wg) / (dj + dg);
  } else {
    const Dg = E * Ig / B, Wj = wE * 2.0 * B * B, Wg = (lg / B) * 1.8 * Math.pow(Ds / Dg, 0.25) * A * A;
    W = (dp * Wj + dg * Wg) / (dp + dg);
  }
  const fn = dunkerley(T2 ? [fp, fj as number, fg] : [fp, fg]);
  // AISC DG 11 ch. 4 walking formula: ap/g = Po exp(-0.35 fn) / (beta W), Po = 65 lb. Returned in % g.
  const ap = 65 * Math.exp(-0.35 * fn) / (v.damp * W) * 100;
  return { fp, dj, fj, dg, fg, fn, W, ap };
}
