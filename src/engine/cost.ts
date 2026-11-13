/**
 * Pricing (concept v7 port): material, connections allowance, erection, freight, tariffs.
 */
import type { Catalog, Cfg, Inputs, Manufacturer } from './types';
import { evalStructure, type StructureResult } from './system';
import { quantities, cltReason, glReason, haul, type Haul, type Quantities } from './logistics';
import { glFactor } from './glulam';

export interface Pricing {
  ic: number; ig: number; mc: Manufacturer; mg: Manufacturer; // CLT and glulam supplier indexes
  hc: Haul; hg: Haul;
  hours: number;                    // crane and crew hours
  parts: Record<string, number>;    // $ by cost line, in display order
  total: number;                    // $
  cpsf: number;                     // $/ft^2
  oversize: boolean;
}

export interface DesignResult extends StructureResult {
  q: Quantities; pr: Pricing; supOk: boolean;
  cpsf: number;   // $/ft^2
  cfpsf: number;  // timber ft^3/ft^2
  ppk: number;    // picks per 1,000 ft^2
  ok: boolean;
}

/** Prices the design with a given CLT supplier and glulam supplier (indexes into cat.mfrs). */
export function priceWith(o: Inputs, cat: Catalog, r: StructureResult, q: Quantities, ic: number, ig: number): Pricing {
  const C = cat, mc = C.mfrs[ic], mg = C.mfrs[ig], c = r.cfg;
  const cltVal = q.cf.clt * r.P.cost * o.appear * mc.pf;
  const pur = q.cf.pur * C.gl.cost * glFactor(C, c.pw as number) * mg.pf, gir = q.cf.gir * C.gl.cost * glFactor(C, c.gw) * mg.pf, colv = q.cf.col * C.gl.cost * glFactor(C, r.col.b) * mg.pf;
  const oversize = C.logi.panW > 8.5 || (r.Lpan || 0) > 53;
  const hc = haul(o, C, mc, q.cf.clt * r.P.pcf, cltVal, oversize);
  const hg = haul(o, C, mg, (q.cf.pur + q.cf.gir + q.cf.col) * C.gl.pcf, pur + gir + colv, o.A > 53);
  const hours = q.n.panels / C.inst.pPanel + (q.n.pur + q.n.gir) / C.inst.pBeam + q.n.col / C.inst.pCol;
  const parts: Record<string, number> = {
    'CLT panels': cltVal, 'Purlins': pur, 'Girders': gir, 'Columns': colv,
    'Connections': q.n.pur * 2 * (r.stack ? C.conn.bear : C.conn.pur) + q.n.gir * 2 * C.conn.gir + q.n.col * C.conn.col,
    'Erection': hours * C.inst.crew, 'Freight': hc.frt + hg.frt, 'Tariffs': hc.tar + hg.tar
  };
  if (!r.T2) delete parts['Purlins'];
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { ic, ig, mc, mg, hc, hg, hours, parts, total, cpsf: total / q.area, oversize };
}

/** Cheapest eligible supply for the design. Mutates and returns r (as the concept does). */
export function price(o: Inputs, cat: Catalog, r: StructureResult): DesignResult {
  const q = quantities(o, cat, r), M = cat.mfrs;
  const cOK = M.map((m, i) => cltReason(cat, m, r) ? -1 : i).filter(i => i >= 0);
  const gOK = M.map((m, i) => glReason(m, o) ? -1 : i).filter(i => i >= 0);
  let best: Pricing | null = null;
  const consider = (ic: number, ig: number) => { const p = priceWith(o, cat, r, q, ic, ig); if (!best || p.total < best.total) best = p; };
  if (o.sup !== 'auto') {
    const i = +o.sup;
    if (cOK.includes(i)) { if (!o.split && gOK.includes(i)) consider(i, i); else gOK.forEach(g => consider(i, g)); }
  } else if (o.split) cOK.forEach(ic => gOK.forEach(ig => consider(ic, ig)));
  else cOK.filter(i => gOK.includes(i)).forEach(i => consider(i, i));
  const supOk = !!best;
  const pr: Pricing = best || priceWith(o, cat, r, q, 0, 0);   // price anyway so charts still work
  return Object.assign(r, { q, pr, supOk, cpsf: pr.cpsf, cfpsf: (q.cf.clt + q.cf.pur + q.cf.gir + q.cf.col) / q.area,
    ppk: q.picks / q.area * 1000, ok: r.strOk && r.vibF && r.vibA && r.depthOk && r.pickOk && supOk });
}

export const evalDesign = (o: Inputs, cat: Catalog, cfg: Cfg): DesignResult => price(o, cat, evalStructure(o, cat, cfg));
