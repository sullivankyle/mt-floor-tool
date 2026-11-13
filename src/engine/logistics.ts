/**
 * Quantities, supplier eligibility and freight (concept v7 port).
 */
import type { Catalog, Inputs, Manufacturer } from './types';
import type { StructureResult } from './system';

/** Road miles between [lat, lon] points: great circle x 1.25 road factor. */
export function miles(a: readonly number[], b: readonly number[]): number {
  const R = 3959, t = (x: number) => x * Math.PI / 180, dLa = t(b[0] - a[0]), dLo = t(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.25;
}

export interface Quantities {
  area: number;  // floor area of the repeating unit, ft^2
  bays: number;
  n: { panels: number; pur: number; gir: number; col: number };  // piece counts
  cf: { clt: number; pur: number; gir: number; col: number };     // volumes, ft^3
  picks: number;
}

/** Quantities for the repeating unit: one bay, or one strip A wide across the whole building section. */
export function quantities(o: Inputs, cat: Catalog, r: StructureResult): Quantities {
  const c = r.cfg, corr = o.layout === 'corr', nb = o.nb, bays = corr ? 2 * nb : 1;
  const area = corr ? o.A * (2 * nb * o.B + o.Wc) : o.A * o.B;
  const baysPieces = r.Lpan ? bays * o.A * o.B / (cat.logi.panW * r.Lpan) : 0;
  const corrPieces = corr ? o.A / cat.logi.panW : 0;
  const n = { panels: baysPieces + corrPieces, pur: r.T2 ? c.n * bays : 0, gir: corr ? 2 * nb + 2 : 1, col: corr ? 2 * nb + 2 : 1 };
  const cf = { clt: area * r.P.t / 12, pur: n.pur * (c.pw as number) * (c.pd as number) / 144 * o.B, gir: n.gir * c.gw * (c.gd as number) / 144 * o.A, col: n.col * r.col.b * r.col.d / 144 * o.H };
  return { area, bays, n, cf, picks: n.panels + n.pur + n.gir + n.col };
}

/** Why a plant cannot supply the CLT ('' = it can). */
export function cltReason(cat: Catalog, m: Manufacturer, r: StructureResult): string {
  if (!m.on) return 'turned off'; if (!m.clt) return 'no CLT';
  if (cat.logi.panW > m.clt.w) return `max width ${m.clt.w} ft`;
  if (r.Lpan && r.Lpan > m.clt.L) return `max length ${m.clt.L} ft`;
  if (r.P.t > m.clt.t) return 'too thick';
  if (m.grades && !m.grades.includes(r.P.grade)) return `no ${r.P.grade} grade`;
  return '';
}

/** Why a plant cannot supply the glulam ('' = it can). Glulam length assumed up to 60 ft everywhere. */
export const glReason = (m: Manufacturer, o: Inputs): string => !m.on ? 'turned off' : !m.gl ? 'no glulam' : o.A > 60 ? 'girder over 60 ft' : '';

export interface Haul { d: number; loads: number; frt: number; tar: number; cross: boolean } // mi, loads, $, $

/**
 * Freight and tariff for one shipment.
 * @param wt shipped weight, lb; @param value material value, $
 */
export function haul(o: Inputs, cat: Catalog, m: Manufacturer, wt: number, value: number, oversize: boolean): Haul {
  const s = cat.sites[o.site], F = cat.frt, d = miles(s as unknown as number[], m.ll), cross = s[2] !== m.c;
  const loads = wt / F.payload;
  const frt = loads * (d * F.rate * (oversize ? 1 + F.osPct / 100 : 1) + F.fixed + (cross ? F.broker : 0));
  const tar = cross ? value * (m.c === 'CA' ? F.tarCAUS : F.tarUSCA) / 100 : 0;
  return { d, loads, frt, tar, cross };
}
