/**
 * Fire (concept v7 port). Phase 3 replaces this with NDS Chapter 16 in full.
 */
import type { Panel } from './types';

/**
 * Effective char depth, in., for an exposure time in hours.
 * 1.2 x a_char with a_char = 1.5 in/hr^0.813 x t^0.813 (NDS 16.2.1, beta_n = 1.5 in./hr).
 * @param hr exposure, hours. @returns in.
 */
export const charDepth = (hr: number): number => hr > 0 ? 1.2 * 1.5 * Math.pow(hr, 0.813) : 0;

/**
 * Ratio of residual to original section modulus for a CLT panel charred from the underside,
 * counting only major-direction (odd) plies. No lamination fall-off. Concept simplification.
 * @param a char depth, in.
 */
export function cltFireRatio(P: Panel, a: number): number {
  const lt = P.t / P.pl;
  const S = (a0: number): number => {
    const L: [number, number][] = [];
    for (let i = 0; i < P.pl; i += 2) { const bot = Math.max(i * lt, a0), top = (i + 1) * lt; if (top - bot > 1e-6) L.push([bot, top]); }
    if (!L.length) return 0;
    let A = 0, M = 0; L.forEach(([b, t]) => { A += t - b; M += (t - b) * (b + t) / 2; });
    const yb = M / A; let I = 0;
    L.forEach(([b, t]) => { const h = t - b, y = (b + t) / 2; I += h * h * h / 12 + h * (y - yb) * (y - yb); });
    return I / Math.max(yb - L[0][0], L[L.length - 1][1] - yb);
  };
  return S(a) / S(0);
}
