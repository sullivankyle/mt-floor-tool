/**
 * Design search (concept v7 port): layouts, auto-sizing of purlins and girders, ranking.
 */
import type { Catalog, Cfg, Inputs, Objective } from './types';
import { psfOf, panelCheck } from './clt';
import { evalStructure } from './system';
import { price, type DesignResult } from './cost';
import { PWS, GWS, DEP, MAXDB } from '../data/catalog';

export interface Point { cfg: Cfg; r: DesignResult | null }

/** Index into DEP of a starting depth from strength and L/240 stiffness. b in., L ft, wplf plf. */
export function startIdx(cat: Catalog, b: number, L: number, wplf: number): number {
  const gl = cat.gl, L12 = L * 12;
  const dS = Math.sqrt(6 * (wplf * L * L / 8 * 12) / (b * gl.Fb * 0.9));
  const dI = Math.cbrt(12 * (5 * (wplf / 12) * Math.pow(L12, 3) * 240 / (384 * gl.E * 1e6)) / b);
  const i = DEP.findIndex(d => d >= Math.max(dS, dI) * 0.95);
  return i < 0 ? DEP.length - 1 : i;
}

/** Deepens purlins/girders from a starting size until strength and vibration pass or limits are hit. */
export function autosize(o: Inputs, cat: Catalog, base: Cfg): { cfg: Cfg; r: DesignResult | null } {
  const P = cat.panels[base.pi], T2 = base.sys !== 'T1', flush = base.sys === 'T2', s = T2 ? o.A / base.n : o.B;
  const w = psfOf(P) + o.sdl + o.LLd, fx = o.fix;
  const cap = (d: number) => d <= (o.maxD ? o.maxD - P.t : 99);
  const lastOf = (b: number) => DEP.filter(d => d <= MAXDB * b && cap(d)).length - 1;
  const fP = T2 && fx.pd != null, fG = fx.gd != null;
  const lastP = T2 ? (fP ? DEP.indexOf(fx.pd as number) : lastOf(base.pw as number)) : 0, lastG = fG ? DEP.indexOf(fx.gd as number) : lastOf(base.gw);
  if (lastG < 0 || (T2 && lastP < 0)) return { cfg: Object.assign({}, base, { pd: DEP[0], gd: DEP[0], ci: null }), r: null };
  let ip = T2 ? (fP ? lastP : Math.min(startIdx(cat, base.pw as number, o.B, w * s), lastP)) : 0;
  let ig = fG ? lastG : Math.min(startIdx(cat, base.gw, o.A, w * o.B), lastG), cfg!: Cfg, r!: ReturnType<typeof evalStructure>;
  for (let k = 0; k < 90; k++) {
    if (flush && DEP[ip] > DEP[ig]) { if (ip <= lastG) ig = ip; else break; }   // flush purlins: girder at least as deep
    cfg = Object.assign({}, base, { pd: T2 ? DEP[ip] : DEP[0], gd: DEP[ig], ci: fx.ci });
    r = evalStructure(o, cat, cfg);
    if (!r.pan.ok || !r.Lpan) break;
    if (T2 && !(r.pur as NonNullable<typeof r.pur>).ok) { if (ip < lastP) { ip++; continue; } break; }
    if (!r.gir.ok) { if (ig < lastG) { ig++; continue; } break; }
    if (r.vibF && r.vibA) break;
    if (r.fp < o.target || !r.depthOk) break;
    const canP = T2 && ip < lastP, canG = ig < lastG;
    if (canP && (!canG || (r.fj as number) <= r.fg)) ip++; else if (canG) ig++; else break;
  }
  return { cfg, r: price(o, cat, r) };
}

/** Layouts to search: system and purlin count. Purlin counts give CLT spans of about 4 to 20 ft. */
export function layouts(o: Inputs): { sys: Cfg['sys']; n: number }[] {
  const L: { sys: Cfg['sys']; n: number }[] = [], ok = (t: string) => o.sysF === 'all' || o.sysF === t || (o.sysF === 'T23' && t !== 'T1');
  if (ok('T1') && o.fix.n == null) L.push({ sys: 'T1', n: 0 });
  const ns: number[] = [];
  if (o.fix.n != null) ns.push(o.fix.n); else { const n0 = Math.max(2, Math.ceil(o.A / 20)), n1 = Math.min(12, Math.floor(o.A / 4)); for (let n = n0; n <= n1; n++) ns.push(n); }
  (['T2', 'T3'] as const).forEach(t => { if (ok(t)) ns.forEach(n => L.push({ sys: t, n })); });
  return L;
}

/** Full study: every panel x layout x member width, auto-sized. */
export function study(o: Inputs, cat: Catalog): Point[] {
  const pts: Point[] = [];
  cat.panels.forEach((P, pi) => {
    if (!P.on || (o.fix.pi != null && o.fix.pi !== pi)) return;
    layouts(o).forEach(l => {
      const Lp = l.sys !== 'T1' ? o.A / l.n : o.B;
      if (Lp > cat.logi.panMax || !panelCheck(o, P, Lp).ok) { pts.push({ cfg: { sys: l.sys, n: l.n, pi } as Cfg, r: null }); return; }
      const pws = l.sys === 'T1' ? [PWS[0]] : PWS.filter(w => o.fix.pw == null || w === o.fix.pw), gws = GWS.filter(w => o.fix.gw == null || w === o.fix.gw);
      pws.forEach(pw => gws.forEach(gw => { const a = autosize(o, cat, { sys: l.sys, n: l.n, pi, pw, gw }); if (a.r) pts.push(a); }));
    });
  });
  return pts;
}

/** Objective value to minimize (lower is better). */
export const OBJ_VALUE: Record<Objective, (r: DesignResult) => number> = {
  cost: r => r.cpsf,
  depth: r => r.depth + r.cpsf / 1000,
  vol: r => r.cfpsf,
  picks: r => r.ppk,
  freq: r => -r.fn,
};

/** Passing designs sorted by objective, ties broken by cost. */
export const rank = (o: Inputs, list: Point[]): Point[] =>
  list.filter(p => p.r && p.r.ok).sort((a, b) => (OBJ_VALUE[o.obj](a.r!) - OBJ_VALUE[o.obj](b.r!)) || (a.r!.cpsf - b.r!.cpsf));

/** First failing check, in the concept's order. */
export function whyFail(r: DesignResult): string {
  if (!r.Lpan) return 'panel longer than max length'; if (!r.pan.ok) return 'CLT panel';
  if (r.pur && !r.pur.ok) return 'purlin at depth limit'; if (!r.gir.ok) return 'girder at depth limit'; if (!r.col.ok) return 'column (largest size fails)';
  if (!r.depthOk) return 'structural depth limit'; if (!r.pickOk) return 'crane pick limit'; if (!r.supOk) return 'no supplier can make it';
  if (!r.vibF) return 'frequency target'; if (!r.vibA) return 'acceleration limit'; return '';
}
