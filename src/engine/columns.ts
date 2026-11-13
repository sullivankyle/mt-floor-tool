/**
 * Glulam columns per NDS 2018 3.7 and Chapter 5, axial load only.
 */
import type { Catalog, ColumnGrade, DesignBasis } from './types';
import { charDepth, reducedSection, FIRE } from './fire';
import { combos, LRFD } from './loads';

export function columnGrade(cat: Catalog): ColumnGrade {
  return cat.glGrades.columns.find(g => g.name === cat.gl.colGrade) || cat.glGrades.columns[0];
}

/**
 * Column stability factor, NDS eq. 3.7-1, c = 0.9 (glulam). FcE = 0.822 Emin' / (le/d)^2.
 * @param leOverD (-); @param FcStar psi (all factors except CP); @param EminP psi
 */
export function columnStability(leOverD: number, FcStar: number, EminP: number): number {
  const FcE = 0.822 * EminP / (leOverD * leOverD), al = FcE / FcStar, k = (1 + al) / 1.8;
  return k - Math.sqrt(k * k - al / 0.9);
}

/**
 * Axial capacity Fc* CP A (concept helper, kept for the fire check).
 * @param b, d in.; @param Le in.; @param Fc psi (Fc*); @param Emin psi. @returns lbf
 */
export function colCap(b: number, d: number, Le: number, Fc: number, Emin: number): number {
  const m = Math.min(b, d); if (m <= 0) return 0;
  return columnStability(Le / m, Fc, Emin) * Fc * b * d;
}

export interface ColumnResult {
  b: number; d: number;
  P: number;      // governing factored load, lbf
  PD: number; PL: number; // service dead and reduced live, lbf
  cap: number;    // capacity for the governing combination, lbf
  capF: number;   // fire capacity, lbf
  CP: number; leOverD: number; gov: string;
  fire: { a: number; bf: number; df: number; P: number; cap: number } | null; // in., in., in., lbf, lbf
  u: { n: number; f: number }; umax: number; ok: boolean;
}

/**
 * Column check, Le = Ke H (NDS 3.7.1.2), le/d <= 50 (3.7.1.4).
 *  Fc' = Fc CD CM Ct CP (ASD) or Fc KF 2.40 phi 0.90 lambda CP (LRFD); Emin' = Emin (LRFD x 1.76 x 0.85).
 *  Fire: see below (NDS 16.2).
 * @param b, d in.; @param PD dead load, lbf; @param PL live load after reduction, lbf; @param H story height, ft; @param Ke (-)
 */
export function columnCheck(basis: DesignBasis, cat: Catalog, b: number, d: number, PD: number, PL: number, H: number, Ke: number): ColumnResult {
  const g = columnGrade(cat), lrfd = basis.method === 'LRFD';
  const Le = Ke * H * 12, m = Math.min(b, d), leOverD = Le / m;
  const EminP = g.Emin * 1e6 * (lrfd ? LRFD.Emin.KF * LRFD.Emin.phi : 1);
  let un = 0, P = 0, cap = 0, CP = 0, gov = '';
  for (const c of combos(basis.method)) {
    const Fcs = g.Fc * c.time * (lrfd ? LRFD.Fc.KF * LRFD.Fc.phi : 1);
    const cp = leOverD <= 50 ? columnStability(leOverD, Fcs, EminP) : 0;
    const cp_ = cp * Fcs * b * d, p = c.cD * PD + c.cL * PL, uu = cp_ > 0 ? p / cp_ : 9.99;
    if (uu > un) { un = uu; P = p; cap = cp_; CP = cp; gov = c.name; }
  }
  // Fire, NDS 16.2: a_eff on 4 (or 3) faces; Table 16.2.2: Fc x 2.58 x CP, with CP from FcE x 2.03 on the reduced
  // section (slenderness on the smaller reduced dimension); ASD D + L.
  const a = charDepth(basis.fire);
  let capF = Infinity, fire: ColumnResult['fire'] = null;
  if (a > 0) {
    const { bf, df } = reducedSection(b, d, a, basis.colExp);
    capF = bf > 0 && df > 0 && Le / Math.min(bf, df) <= 50 ? columnStability(Le / Math.min(bf, df), FIRE.Fc * g.Fc, FIRE.FcE * g.Emin * 1e6) * FIRE.Fc * g.Fc * bf * df : 0;
    fire = { a, bf, df, P: PD + PL, cap: capF };
  }
  const u = { n: un, f: a ? (capF > 0 ? (PD + PL) / capF : 9.99) : 0 }, umax = Math.max(u.n, u.f);
  return { b, d, P, PD, PL, cap, capF, CP, leOverD, gov, fire, u, umax, ok: umax <= 1 };
}
