/**
 * Load combinations and live load reduction.
 * ASCE 7-22 §2.3.1 (strength, LRFD) and §2.4.1 (allowable stress, ASD), gravity combinations with D and L only.
 * Time adjustment: NDS 2018 Table 2.3.2 load duration factor CD (ASD) and Table N3 time effect factor λ (LRFD).
 * ASCE 7-22 is not in refs/; combinations and §4.7 are from the standard as commonly published. Verify against a copy.
 */
import type { Method } from './types';

export interface Combo {
  name: string;
  cD: number;    // dead load factor (-)
  cL: number;    // live load factor (-)
  time: number;  // CD (ASD) or λ (LRFD) for this combination (-)
}

/** Gravity combinations with D and L. */
export function combos(method: Method): Combo[] {
  return method === 'ASD'
    ? [{ name: 'D', cD: 1, cL: 0, time: 0.9 },             // ASCE 7-22 2.4.1 combo 1; NDS Table 2.3.2 permanent CD = 0.9
       { name: 'D + L', cD: 1, cL: 1, time: 1.0 }]          // combo 2; ten-year CD = 1.0
    : [{ name: '1.4D', cD: 1.4, cL: 0, time: 0.6 },         // ASCE 7-22 2.3.1 combo 1; NDS Table N3 λ = 0.6
       { name: '1.2D + 1.6L', cD: 1.2, cL: 1.6, time: 0.8 }]; // combo 2; λ = 0.8, L from occupancy
}

/** LRFD format conversion and resistance factors, NDS 2018 Table N1 and N2 (or Table 10.3.1 for CLT). */
export const LRFD = {
  Fb: { KF: 2.54, phi: 0.85 },
  Fv: { KF: 2.88, phi: 0.75 },
  Fs: { KF: 2.00, phi: 0.75 },   // CLT rolling shear, Table 10.3.1 (no λ applies)
  Fc: { KF: 2.40, phi: 0.90 },
  Fcperp: { KF: 1.67, phi: 0.90 }, // no λ applies
  Emin: { KF: 1.76, phi: 0.85 },
} as const;

/** Live load element factors, ASCE 7-22 Table 4.7-1 (subset used here). */
export const KLL = { interiorColumn: 4, interiorBeam: 2, other: 1 } as const;

export interface LLR { factor: number; KLLAT: number; note: string }

/**
 * ASCE 7-22 §4.7.2, eq. 4.7-1: L = Lo (0.25 + 15 / sqrt(KLL AT)), for KLL AT >= 400 ft^2.
 * Lower limits: 0.50 Lo for members supporting one floor, 0.40 Lo for two or more.
 * Not reduced when Lo > 100 psf, except members supporting two or more floors may be reduced 20%;
 * not reduced for assembly uses (taken here as Lo >= 100 psf, the assembly option in this tool).
 * @param Lo unreduced live load, psf; @param KLL (-); @param AT total tributary area, ft^2; @param floors floors supported (-)
 * @returns factor L/Lo (-)
 */
export function liveLoadReduction(Lo: number, KLLv: number, AT: number, floors: number, enabled = true): LLR {
  const KLLAT = KLLv * AT;
  if (!enabled) return { factor: 1, KLLAT, note: 'live load reduction off' };
  if (Lo > 100) return floors >= 2 ? { factor: 0.8, KLLAT, note: 'Lo > 100 psf: 20% for 2+ floors' } : { factor: 1, KLLAT, note: 'Lo > 100 psf: not reduced' };
  if (Lo >= 100) return { factor: 1, KLLAT, note: 'assembly: not reduced' };
  if (KLLAT < 400) return { factor: 1, KLLAT, note: 'KLL AT < 400 sq ft' };
  const f = 0.25 + 15 / Math.sqrt(KLLAT), lim = floors >= 2 ? 0.4 : 0.5;
  return { factor: Math.min(1, Math.max(lim, f)), KLLAT, note: f < lim ? `limited to ${lim}` : 'eq. 4.7-1' };
}
