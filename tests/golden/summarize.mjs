// Shared by the golden generator (run inside the original concept page) and the
// golden test (run against the ported engine). Plain JS with no imports so the
// generator can inject its source into the concept page. Keep it that way.
export function summarize(o, pts, ranked, priceRow) {
  const pick = (obj, keys) => { const out = {}; keys.forEach(k => { out[k] = obj[k]; }); return out; };
  const haul = h => pick(h, ['d', 'loads', 'frt', 'tar', 'cross']);
  const one = p => {
    if (!p.r) return { cfg: p.cfg, r: null };
    const r = p.r;
    return {
      cfg: p.cfg,
      r: {
        ok: r.ok, strOk: r.strOk, vibF: r.vibF, vibA: r.vibA, depthOk: r.depthOk, pickOk: r.pickOk, supOk: r.supOk,
        s: r.s, Lp: r.Lp, Lpan: r.Lpan, depth: r.depth,
        wE: r.wE, dp: r.dp, fp: r.fp, dj: r.dj, fj: r.fj, dg: r.dg, fg: r.fg, fn: r.fn, W: r.W, ap: r.ap,
        cpsf: r.cpsf, cfpsf: r.cfpsf, ppk: r.ppk, Pcol: r.Pcol, wts: r.wts, heavy: r.heavy,
        pan: pick(r.pan, ['L', 'w', 'M', 'V', 'EIapp', 'dL', 'dT', 'u', 'fr', 'umax', 'ok']),
        pur: r.pur ? pick(r.pur, ['b', 'd', 'L', 'sw', 'T', 'M', 'V', 'Fbp', 'dL', 'dT', 'u', 'umax', 'ok']) : null,
        gir: pick(r.gir, ['b', 'd', 'L', 'sw', 'T', 'M', 'V', 'Fbp', 'dL', 'dT', 'u', 'umax', 'ok']),
        col: pick(r.col, ['b', 'd', 'P', 'cap', 'capF', 'u', 'umax', 'ok']),
        q: pick(r.q, ['area', 'bays', 'n', 'cf', 'picks']),
        pr: { ic: r.pr.ic, ig: r.pr.ig, total: r.pr.total, cpsf: r.pr.cpsf, hours: r.pr.hours, oversize: r.pr.oversize,
              parts: r.pr.parts, hc: haul(r.pr.hc), hg: haul(r.pr.hg) },
      },
    };
  };
  const best = ranked[0] || null;
  const out = {
    inputs: o,
    nPoints: pts.length,
    points: pts.map(one),
    ranked: ranked.map(p => pts.indexOf(p)),
    best: best ? pts.indexOf(best) : -1,
    suppliersForBest: best ? priceRow(best.r) : null,
  };
  // round-trip through JSON so Infinity/undefined are normalized the same way on both sides
  return JSON.parse(JSON.stringify(out));
}
