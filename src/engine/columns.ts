/**
 * Glulam columns (concept v7 port). Phase 2 adds real grades, load combos and live load reduction.
 */
import type { Catalog, Inputs } from './types';
import { charDepth } from './fire';

/**
 * Axial capacity per NDS 3.7.1 column stability factor (c = 0.9 for glulam), no CD.
 * @param b, d in.; @param Le effective length, in.; @param Fc psi; @param Emin psi. @returns lbf
 */
export function colCap(b: number, d: number, Le: number, Fc: number, Emin: number): number {
  const m = Math.min(b, d); if (m <= 0) return 0;
  const FcE = 0.822 * Emin / Math.pow(Le / m, 2), al = FcE / Fc, k = (1 + al) / 1.8;
  return (k - Math.sqrt(k * k - al / 0.9)) * Fc * b * d;
}

export interface ColumnResult { b: number; d: number; P: number; cap: number; capF: number; u: { n: number; f: number }; umax: number; ok: boolean }

/**
 * Column check, pinned-pinned, Le = story height. Fire: 4-sided char, 2.58 Fc and 2.03 Emin (NDS Table 16.2.2).
 * @param b, d in.; @param P axial load, lbf
 */
export function columnCheck(o: Inputs, cat: Catalog, b: number, d: number, P: number): ColumnResult {
  const gl = cat.gl, Le = o.H * 12, cap = colCap(b, d, Le, gl.Fc, gl.Emin * 1e6), a = charDepth(o.fire);
  const capF = a ? colCap(b - 2 * a, d - 2 * a, Le, gl.Fc * 2.58, gl.Emin * 1e6 * 2.03) : Infinity;
  const u = { n: P / cap, f: a ? (capF > 0 ? P / capF : 9.99) : 0 }, umax = Math.max(u.n, u.f);
  return { b, d, P, cap, capF, u, umax, ok: umax <= 1 };
}
