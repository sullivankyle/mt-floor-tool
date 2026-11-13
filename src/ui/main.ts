// @ts-nocheck -- UI ported verbatim from concept v7; the typed, tested code is src/engine.
// Typing and splitting this module is deferred to Phase 6 (UI polish).
import { defaultCatalog, DESIGN_DEFAULTS, PWS, GWS, DEP, COLS } from '../data/catalog';
import { makeProject, readProject, validateMfrs, normalizeMfrs } from '../data/project';
import { exportDesign, parseFemResults, femStale, needsFem } from '../data/fem';
import { study, rank, evalDesign, priceWith, cltReason, glReason, miles, layouts, whyFail,
         charDepth, stripDeflection, freqFromDefl, cltSpanLimit, OBJ_VALUE, G, calcPackage, combos, beamGrade, columnGrade, resolvePanels } from '../engine';

let CAT = defaultCatalog();

/* ================= display helpers for sizes ================= */
const WL = { 5.125: '5 1/8', 6.75: '6 3/4', 8.75: '8 3/4', 10.75: '10 3/4', 12.25: '12 1/4', 14.25: '14 1/4', 16.25: '16 1/4', 18.25: '18 1/4' };
const wl = w => WL[w] || String(w);
const dl = d => Number.isInteger(d) ? String(d) : Math.floor(d) + ' 1/2';
const sz = (b, d) => wl(b) + ' x ' + dl(d);

/* ================= objectives: engine value + display ================= */
const OBJ = {
  cost:  { lab: 'Cost, $/sq ft',          v: OBJ_VALUE.cost,  f: r => '$' + fmt(r.cpsf, 2) },
  depth: { lab: 'Structural depth, in.',  v: OBJ_VALUE.depth, f: r => fmt(r.depth, 1) + ' in.' },
  vol:   { lab: 'Timber, cu ft/sq ft',    v: OBJ_VALUE.vol,   f: r => fmt(r.cfpsf, 3) + ' cf/sf' },
  picks: { lab: 'Picks per 1,000 sq ft',  v: OBJ_VALUE.picks, f: r => fmt(r.ppk, 1) + ' picks' },
  freq:  { lab: 'Floor frequency, Hz',    v: OBJ_VALUE.freq,  f: r => fmt(r.fn, 1) + ' Hz' }
};

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const fmt = (x, n = 2) => (x == null || !isFinite(x)) ? '-' : x.toLocaleString('en-US', { maximumFractionDigits: n, minimumFractionDigits: n });
const money = x => '$' + fmt(x, 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const row = (name, val, unit) => `<tr><td class="name">${name}</td><td>${val}</td><td class="name">${unit || ''}</td></tr>`;
const niceStep = x => { const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
const sysName = c => c.sys === 'T1' ? 'CLT on girders' : c.sys === 'T3' ? `CLT on ${c.n} purlins per bay over dropped girders` : `CLT on ${c.n} flush purlins per bay`;
const sysShort = c => c.sys === 'T1' ? 'No purlins' : c.n + (c.sys === 'T3' ? ' purlins, dropped' : ' purlins, flush');
const sysColor = c => c.sys === 'T1' ? '#c77d2a' : c.sys === 'T3' ? '#7a52a8' : '#2f6fb5';
const mfrLabel = m => `${m.name}, ${m.plant}`;
function members(r) { const c = r.cfg; return `${r.P.name}${r.T2 ? `; purlins ${sz(c.pw, c.pd)}` : ''}; girder ${sz(c.gw, c.gd)}; column ${sz(r.col.b, r.col.d)}`; }
function supplierText(r) { const p = r.pr; return p.ic === p.ig ? mfrLabel(p.mc) : `CLT ${mfrLabel(p.mc)}; glulam ${mfrLabel(p.mg)}`; }
function statusOf(r) {
  if (!r.strOk) return ['bad', 'Fails strength'];
  if (!r.supOk) return ['bad', 'No supplier'];
  if (!r.depthOk) return ['bad', 'Too deep'];
  if (!r.pickOk) return ['bad', 'Pick too heavy'];
  if (!r.vibF) return ['bad', 'Below frequency target'];
  if (!r.vibA) return ['warn', 'Acceleration high'];
  return ['good', 'Pass'];
}
function parseList(s) { return [...new Set(s.split(/[\s,;]+/).map(Number).filter(x => x >= 8 && x <= 60))].sort((a, b) => a - b); }

const IDS = ['layout', 'nb', 'Wc', 'gA', 'gB', 'sysF', 'occ', 'sdl', 'stories', 'H', 'fire', 'maxD', 'maxPick', 'appear', 'site', 'sup', 'split', 'target', 'alim', 'damp', 'obj', 'method', 'panelCont', 'purlinCont', 'Ke', 'llr', 'cltFallOff', 'colExp', 'vibMethod', 'fwMax', 'vlim', 'topType', 'topT', 'topGamma', 'beamGamma'];
function readInputs() {
  const [LLd, LLv] = $('occ').value.split('|').map(Number);
  return {
    layout: $('layout').value, nb: +$('nb').value, Wc: +$('Wc').value,
    A: +$('gA').value, B: +$('gB').value, sysF: $('sysF').value,
    LLd, LLv, sdl: +$('sdl').value, stories: +$('stories').value, H: +$('H').value, fire: +$('fire').value,
    maxD: +$('maxD').value, maxPick: +$('maxPick').value, appear: +$('appear').value,
    site: $('site').value, sup: $('sup').value, split: $('split').checked,
    target: +$('target').value, alim: +$('alim').value, damp: +$('damp').value / 100, obj: $('obj').value,
    method: $('method').value, panelCont: $('panelCont').value, purlinCont: $('purlinCont').value, Ke: +$('Ke').value, llr: $('llr').checked,
    cltFallOff: $('cltFallOff').value === '1', colExp: +$('colExp').value,
    vibMethod: $('vibMethod').value, fwMax: +$('fwMax').value, vlim: +$('vlim').value,
    topType: $('topType').value, topT: +$('topT').value, topGamma: +$('topGamma').value, beamGamma: +$('beamGamma').value,
    fix: { n: null, pi: null, pw: null, pd: null, gw: null, gd: null, ci: null }
  };
}
function setInputs(o) {
  $('layout').value = o.layout; $('nb').value = o.nb; $('Wc').value = o.Wc; $('gA').value = o.A; $('gB').value = o.B; $('sysF').value = o.sysF;
  $('occ').value = o.LLd + '|' + o.LLv; $('sdl').value = o.sdl; $('stories').value = o.stories; $('H').value = o.H; $('fire').value = String(o.fire);
  $('maxD').value = String(o.maxD); $('maxPick').value = String(o.maxPick); $('appear').value = String(o.appear);
  $('site').value = o.site; $('sup').value = o.sup; $('split').checked = o.split;
  $('target').value = o.target; $('alim').value = String(o.alim); $('damp').value = o.damp * 100; $('obj').value = o.obj;
  const d = Object.assign({}, DESIGN_DEFAULTS, o);
  $('method').value = d.method; $('panelCont').value = d.panelCont; $('purlinCont').value = d.purlinCont; $('Ke').value = String(d.Ke); $('llr').checked = d.llr;
  $('cltFallOff').value = d.cltFallOff ? '1' : '0'; $('colExp').value = String(d.colExp);
  $('vibMethod').value = d.vibMethod; $('fwMax').value = String(d.fwMax); $('vlim').value = String(d.vlim);
  $('topType').value = d.topType; $('topT').value = String(d.topT); $('topGamma').value = String(d.topGamma); $('beamGamma').value = String(d.beamGamma);
}
const FIX = ['n', 'pi', 'pw', 'pd', 'gw', 'gd', 'ci'];
function fillFixSelects() { return;
  const any = [['any', 'Optimize']], keep = id => $(id).value || 'any';
  const set = (id, opts) => { const v = keep(id); $(id).innerHTML = any.concat(opts).map(([a, t]) => `<option value="${a}">${esc(t)}</option>`).join(''); $(id).value = [...$(id).options].some(x => x.value === v) ? v : 'any'; };
  set('fx_n', Array.from({ length: 11 }, (_, i) => [i + 2, String(i + 2)]));
  set('fx_pi', CAT.panels.map((P, i) => [i, P.name]));
  set('fx_pw', PWS.map(w => [w, wl(w) + ' in.'])); set('fx_gw', GWS.map(w => [w, wl(w) + ' in.']));
  set('fx_pd', DEP.map(d => [d, dl(d) + ' in.'])); set('fx_gd', DEP.map(d => [d, dl(d) + ' in.']));
  set('fx_ci', COLS.map((c, i) => [i, sz(c[0], c[1])]));
}

/* ================= state ================= */
const S = { o: null, pts: [], ranked: [], best: null, cur: null, ms: 0 };
let pinned = null;
const runs = [];
let gridRes = null, lastReportText = '';

/* ================= graphics ================= */
function costChart(r) {
  const parts = Object.entries(r.pr.parts).map(([k, v]) => [k, v / r.q.area]);
  const total = r.cpsf, W = 700, H = 290, ml = 52, mr = 16, mt = 30, mb = 56;
  const maxV = Math.max(...parts.map(p => p[1])), step = niceStep(maxV / 5), top = Math.ceil(maxV * 1.15 / step) * step;
  const plotH = H - mt - mb, gw = (W - ml - mr) / parts.length, bw = Math.min(46, gw * 0.55), y = v => H - mb - v / top * plotH;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost breakdown" style="width:100%;height:auto;font:11.5px system-ui,sans-serif">`;
  for (let v = 0; v <= top + 1e-9; v += step) s += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="#eee"/><text x="${ml - 6}" y="${y(v) + 4}" text-anchor="end" fill="#6b7078">$${+v.toFixed(2)}</text>`;
  s += `<text transform="translate(13,${mt + plotH / 2}) rotate(-90)" text-anchor="middle" fill="#6b7078">$ per sq ft</text>`;
  parts.forEach(([k, v], i) => {
    const x = ml + i * gw + gw / 2, pct = v / total * 100;
    s += `<rect x="${x - bw / 2}" y="${y(v)}" width="${bw}" height="${H - mb - y(v)}" fill="#2f6fb5" rx="2"><title>${k}: $${fmt(v, 2)}/sf, ${fmt(pct, 1)}%</title></rect>`;
    s += `<text x="${x}" y="${y(v) - 17}" text-anchor="middle" fill="#1f2328" font-weight="600">${fmt(pct, 0)}%</text>`;
    s += `<text x="${x}" y="${y(v) - 4}" text-anchor="middle" fill="#6b7078" font-size="10.5">$${fmt(v, 2)}</text>`;
    s += `<text x="${x}" y="${H - mb + 16}" text-anchor="middle" fill="#1f2328">${k}</text>`;
  });
  s += `<line x1="${ml}" x2="${W - mr}" y1="${H - mb}" y2="${H - mb}" stroke="#999"/>`;
  s += `<text x="${ml}" y="${H - 10}" fill="#1f2328" font-weight="600">Total $${fmt(total, 2)} per sq ft (${money(r.pr.total)} per ${r.q.bays > 1 ? 'strip' : 'bay'})</text>`;
  return s + '</svg>';
}

function planSvg(o, r) {
  const c = r.cfg, corr = o.layout === 'corr', nb = corr ? o.nb : 0;
  const totalB = corr ? 2 * nb * o.B + o.Wc : o.B;
  const W = 640, ml = 74, mr = 30, mt = 56;
  const k = Math.min((W - ml - mr) / o.A, 340 / totalB);
  const X = o.A * k, x0 = ml, y0 = mt, Y = totalB * k, H = y0 + Y + 92;
  const L = (x1, y1, x2, y2, st, ex) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${st}" ${ex || ''}/>`;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Plan view" style="width:100%;height:auto;font:12px system-ui,sans-serif">`;
  s += `<defs><marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2f6fb5"/></marker></defs>`;
  // bay bands top to bottom
  const bands = [];
  if (corr) { for (let i = 0; i < nb; i++) bands.push(['bay', o.B]); bands.push(['corr', o.Wc]); for (let i = 0; i < nb; i++) bands.push(['bay', o.B]); }
  else bands.push(['bay', o.B]);
  let y = y0, purl = ''; const lines = [y0];
  bands.forEach(([t, h]) => {
    const hh = h * k;
    s += `<rect x="${x0}" y="${y}" width="${X}" height="${hh}" fill="${t === 'corr' ? '#e9e4d8' : '#efe3cf'}" stroke="#d4c2a0"/>`;
    if (t === 'corr') {
      s += `<rect x="${x0}" y="${y + hh * 0.3}" width="${X}" height="${hh * 0.4}" fill="#cfe0f2" opacity=".8"/>`;
      s += `<text x="${x0 + 8}" y="${y + hh / 2 + 4}" fill="#2f6fb5">corridor ${o.Wc} ft: main MEP run</text>`;
      for (let yy = y + 6; yy < y + hh; yy += 12) {}
    } else if (r.T2) {
      for (let yy = y + 7; yy < y + hh; yy += 13) s += L(x0, yy, x0 + X, yy, '#e0d2b4');
      const pt = Math.max(4, c.pw / 12 * k);
      for (let i = 0; i <= c.n; i++) { const x = x0 + i * r.s * k; purl += `<rect x="${x - pt / 2}" y="${y}" width="${pt}" height="${hh}" fill="#b07a45" ${r.stack ? 'stroke="#5a3a18" stroke-width="0.8"' : ''}/>`; }
      if (corr) for (let i = 0; i < c.n; i++) { const xm = x0 + (i + 0.5) * r.s * k; s += L(xm, y + 4, xm, y + hh - 4, '#7fb0de', 'stroke-width="3" stroke-dasharray="2 3" opacity=".7"'); }
    } else {
      for (let x = x0 + 7; x < x0 + X; x += 13) s += L(x, y, x, y + hh, '#e0d2b4');
      if (corr) for (let i = 0; i < 3; i++) { const xm = x0 + (i + 0.5) * X / 3; s += L(xm, y + 4, xm, y + hh - 4, '#7fb0de', 'stroke-width="3" stroke-dasharray="2 3" opacity=".7"'); }
    }
    y += hh; lines.push(y);
  });
  const gt = Math.max(6, c.gw / 12 * k), cs = Math.max(10, r.col.b / 12 * k);
  if (!r.stack) s += purl;
  lines.forEach(yy => { s += `<rect x="${x0}" y="${yy - gt / 2}" width="${X}" height="${gt}" fill="#7a4a1f"/>`; [x0, x0 + X].forEach(x => s += `<rect x="${x - cs / 2}" y="${yy - cs / 2}" width="${cs}" height="${cs}" fill="#444"/>`); });
  if (r.stack) s += purl;                    // purlins bear on top of the dropped girders
  // span note on the first bay
  const yb0 = y0, yb1 = y0 + o.B * k;
  if (r.T2) { const xa = x0 + 6, xb = x0 + r.s * k - 6, ya = (yb0 + yb1) / 2; if (xb - xa > 24) s += L(xa, ya, xb, ya, '#2f6fb5', 'stroke-width="1.5" marker-start="url(#ah)" marker-end="url(#ah)"') + `<text x="${(xa + xb) / 2}" y="${ya - 6}" text-anchor="middle" fill="#2f6fb5">CLT ${fmt(r.s, 1)} ft</text>`; }
  else { const xa = x0 + X - 24; s += L(xa, yb0 + gt, xa, yb1 - gt, '#2f6fb5', 'stroke-width="1.5" marker-start="url(#ah)" marker-end="url(#ah)"') + `<text x="${xa - 6}" y="${(yb0 + yb1) / 2 + 4}" text-anchor="end" fill="#2f6fb5">CLT ${o.B} ft</text>`; }
  s += `<text x="${x0}" y="${y0 - 28}" fill="#1f2328" font-weight="600">${sysName(c)}</text><text x="${x0}" y="${y0 - 12}" fill="#6b7078">${r.T2 ? `purlins ${sz(c.pw, c.pd)}; ` : ''}girders ${sz(c.gw, c.gd)}; columns ${sz(r.col.b, r.col.d)}</text>`;
  const yd = y0 + Y + 26;
  s += L(x0, yd, x0 + X, yd, '#555') + L(x0, yd - 5, x0, yd + 5, '#555') + L(x0 + X, yd - 5, x0 + X, yd + 5, '#555');
  s += `<text x="${x0 + X / 2}" y="${yd + 16}" text-anchor="middle" fill="#555">A = ${o.A} ft (girder span, along corridor)</text>`;
  const xd = x0 - 36;
  s += L(xd, yb0, xd, yb1, '#555') + L(xd - 5, yb0, xd + 5, yb0, '#555') + L(xd - 5, yb1, xd + 5, yb1, '#555');
  s += `<text transform="translate(${xd - 8},${(yb0 + yb1) / 2}) rotate(-90)" text-anchor="middle" fill="#555">B = ${o.B} ft</text>`;
  const yl = H - 12; let lx = x0;
  [['#7a4a1f', 'girder'], ['#b07a45', 'purlin'], ['#444', 'column'], ['#efe3cf', 'CLT (lines = strong direction)'], ['#7fb0de', 'MEP branch']].forEach(([col, t]) => {
    if (!r.T2 && t === 'purlin') return; if (!corr && t === 'MEP branch') return;
    s += `<rect x="${lx}" y="${yl - 9}" width="14" height="9" fill="${col}"/><text x="${lx + 19}" y="${yl}" fill="#6b7078">${t}</text>`; lx += 30 + t.length * 6.2;
  });
  return s + '</svg>';
}

function heatColorT(t) { return `hsl(${Math.round((1 - Math.max(0, Math.min(1, t))) * 125)} 55% 86%)`; }
function heatHtml(o) {
  const lays = layouts(o), on = CAT.panels.map((P, i) => [P, i]).filter(([P]) => P.on), cell = new Map();
  S.pts.forEach((p, i) => {
    const key = p.cfg.pi + '|' + p.cfg.sys + p.cfg.n, prev = cell.get(key);
    if (!p.r || !p.r.ok) { if (!prev) cell.set(key, { i: -1, why: p.r ? whyFail(p.r) : 'CLT panel' }); return; }
    if (!prev || prev.i < 0 || OBJ[o.obj].v(p.r) < OBJ[o.obj].v(S.pts[prev.i].r)) cell.set(key, { i });
  });
  const vals = [...cell.values()].filter(c => c.i >= 0).map(c => OBJ[o.obj].v(S.pts[c.i].r));
  const lo = Math.min(...vals), hi = Math.max(...vals), cur = S.cur ? S.cur.cfg : null;
  let h = '<table class="heat"><tr><th>Panel \\ layout</th>' + lays.map(l => `<th>${sysShort(l)}<br><span class="ref">CLT ${fmt(l.sys !== 'T1' ? o.A / l.n : o.B, 1)} ft</span></th>`).join('') + '</tr>';
  on.forEach(([P, pi]) => {
    h += `<tr><th>${esc(P.name)}</th>` + lays.map(l => {
      const c = cell.get(pi + '|' + l.sys + l.n);
      if (!c || c.i < 0) return `<td class="none" title="${esc(c ? c.why : '')}">-</td>`;
      const p = S.pts[c.i], isCur = cur && cur.pi === pi && cur.sys === l.sys && (l.sys === 'T1' || cur.n === l.n);
      return `<td class="${S.best === p ? 'best' : ''} ${isCur ? 'cur' : ''}" style="background:${heatColorT(hi > lo ? (OBJ[o.obj].v(p.r) - lo) / (hi - lo) : 0)}" data-pick="${c.i}" title="${esc(members(p.r))}">${OBJ[o.obj].f(p.r)}<br><small>${o.obj === 'depth' ? '$' + fmt(p.r.cpsf, 1) : fmt(p.r.depth, 0) + ' in.'}, ${fmt(p.r.fn, 1)} Hz</small></td>`;
    }).join('') + '</tr>';
  });
  return h + '</table>';
}
function scatterSvg(o) {
  const yk = $('sc_y').value, yv = r => yk === 'depth' ? r.depth : r.fn;
  const pts = S.pts.map((p, i) => [p, i]).filter(([p]) => p.r && p.r.strOk);
  if (!pts.length) return '<div class="hint">No design passes strength.</div>';
  const W = 660, H = 330, ml = 54, mr = 18, mt = 16, mb = 44;
  const xs = pts.map(([p]) => p.r.cpsf), ys = pts.map(([p]) => yv(p.r));
  const x0 = Math.floor(Math.min(...xs) * 0.95), x1 = Math.max(...xs) * 1.03;
  const y1 = Math.max(...ys, yk === 'fn' ? o.target : (o.maxD || 0)) * 1.08;
  const px = x => ml + (x - x0) / (x1 - x0) * (W - ml - mr), py = y => H - mb - y / y1 * (H - mt - mb);
  const tx = niceStep((x1 - x0) / 5), ty = niceStep(y1 / 5);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost trade-off" style="width:100%;height:auto;font:11px system-ui,sans-serif">`;
  for (let x = Math.ceil(x0 / tx) * tx; x <= x1; x += tx) s += `<line x1="${px(x)}" x2="${px(x)}" y1="${mt}" y2="${H - mb}" stroke="#eee"/><text x="${px(x)}" y="${H - mb + 14}" text-anchor="middle" fill="#6b7078">$${+x.toFixed(1)}</text>`;
  for (let y = 0; y <= y1; y += ty) s += `<line x1="${ml}" x2="${W - mr}" y1="${py(y)}" y2="${py(y)}" stroke="#eee"/><text x="${ml - 6}" y="${py(y) + 4}" text-anchor="end" fill="#6b7078">${+y.toFixed(1)}</text>`;
  s += `<text x="${(ml + W - mr) / 2}" y="${H - 6}" text-anchor="middle" fill="#6b7078">Installed framing cost, $ per sq ft</text>`;
  s += `<text transform="translate(14,${(mt + H - mb) / 2}) rotate(-90)" text-anchor="middle" fill="#6b7078">${yk === 'depth' ? 'Structural depth, in.' : 'Floor frequency, Hz'}</text>`;
  const lim = yk === 'fn' ? o.target : o.maxD;
  if (lim) s += `<line x1="${ml}" x2="${W - mr}" y1="${py(lim)}" y2="${py(lim)}" stroke="${yk === 'fn' ? '#2e7d4f' : '#b3372f'}" stroke-dasharray="5 4"/><text x="${W - mr - 4}" y="${py(lim) - 5}" text-anchor="end" fill="${yk === 'fn' ? '#2e7d4f' : '#b3372f'}" font-weight="600">${yk === 'fn' ? 'target ' + fmt(lim, 1) + ' Hz' : 'max depth ' + lim + ' in.'}</text>`;
  const dot = ([p, i]) => `<circle cx="${px(p.r.cpsf)}" cy="${py(yv(p.r))}" r="3.4" fill="${!p.r.ok ? '#c3c6cb' : sysColor(p.cfg)}" fill-opacity="${p.r.ok ? .8 : .55}" data-pick="${i}" style="cursor:pointer"><title>${esc(sysName(p.cfg))}: ${esc(members(p.r))}. $${fmt(p.r.cpsf, 2)}/sf, ${fmt(p.r.depth, 1)} in. deep, ${fmt(p.r.fn, 1)} Hz</title></circle>`;
  pts.filter(([p]) => !p.r.ok).forEach(d => s += dot(d));
  pts.filter(([p]) => p.r.ok).forEach(d => s += dot(d));
  if (S.best) s += `<circle cx="${px(S.best.r.cpsf)}" cy="${py(yv(S.best.r))}" r="9" fill="none" stroke="#2e7d4f" stroke-width="2"/>`;
  if (S.cur && S.cur.r.strOk) s += `<circle cx="${px(S.cur.r.cpsf)}" cy="${py(yv(S.cur.r))}" r="9" fill="none" stroke="#2f6fb5" stroke-width="2.5" stroke-dasharray="3 2"/>`;
  return s + '</svg>';
}

/* ================= qualitative notes ================= */
function considerations(o, r) {
  const c = r.cfg, N = [], add = (k, t) => N.push(`<li class="${k}">${t}</li>`);
  const corr = o.layout === 'corr';
  add(r.depthOk ? 'ok' : 'bad', r.stack
    ? `Structural depth ${fmt(r.depth, 1)} in. (${fmt(r.P.t, 3)} in. CLT + ${dl(c.pd)} in. purlin + ${dl(c.gd)} in. dropped girder, stacked)${o.maxD ? ` against a ${o.maxD} in. limit` : ''}. Between girders it is only ${fmt(r.P.t + c.pd, 1)} in.`
    : `Structural depth ${fmt(r.depth, 1)} in. (${fmt(r.P.t, 3)} in. CLT + ${dl(Math.max(c.gd, r.T2 ? c.pd : 0))} in. girder${r.T2 ? ', purlins hung flush' : ''})${o.maxD ? ` against a ${o.maxD} in. limit` : ''}.${r.T2 ? ` Under purlins only: ${fmt(r.P.t + c.pd, 1)} in.` : ''}`);
  if (r.stack) add('ok', `Purlins bear on top of the girders: simple bearing connections (cheaper than hangers) and fewer tolerance problems. Ducts and pipes cross the girder line through the ${dl(c.pd)} in. high by ${fmt(r.s - c.pw / 12, 1)} ft wide gaps between purlins, with no girder penetrations.`);
  if (corr) {
    if (r.stack) add('ok', 'The corridor main can run above the corridor-side girder in the purlin gaps, so branches leave the corridor without dropping below the girder.');
    else if (r.T2) add('ok', `MEP branches run parallel to the purlins, so ducts sit between them in ${fmt(r.s - c.pw / 12, 1)} ft wide pockets ${dl(c.pd)} in. deep without penetrations.`);
    else add('info', 'No purlins: branch ducts run below the CLT with nothing to cross inside the bay, but there are no pockets to hide them in.');
    if (!r.stack) add('warn', `Every branch leaves the corridor across the corridor-side girder (${dl(c.gd)} in. deep). Plan for penetrations, a drop, a shallower girder on that line, or a dropped-girder layout.`);
  }
  if (r.vib.method === 'guide') {
    const ev = r.vib.ev;
    add(r.vibA && r.vibF ? 'ok' : 'bad', `Floor frequency ${fmt(r.fn, 1)} Hz, ${ev.regime} response (guide 4.3): ${ev.res ? `${fmt(ev.apfwPct, 2)}% g peak at ${fmt(ev.res.fw, 2)} Hz walking (limit ${fmt(o.alim, 1)})` : ''}${ev.res && ev.tr ? '; ' : ''}${ev.tr ? `${fmt(ev.vrms, 0)} mips RMS (limit ${fmt(o.vlim, 0)})` : ''}. Modes are closed-form estimates, not FEM; confirm with a model for final design.`);
  } else add(r.fn >= 15 ? 'ok' : r.vibF ? 'info' : 'bad', `Floor frequency ${fmt(r.fn, 1)} Hz (${r.fn < 3 ? 'below 3 Hz' : r.fn < 15 ? '3 to 15 Hz band, guide recommends a more detailed check' : 'above 15 Hz'}); DG 11 estimated acceleration ${fmt(r.ap, 2)}% g.`);
  if (o.fire) {
    const bad = r.conn.filter(x => !x.ok);
    add(r.pan.u.f > 1 || r.gir.u.f > 1 || (r.pur && r.pur.u.f > 1) || r.col.u.f > 1 ? 'bad' : 'info',
      `${o.fire} hour exposed timber (NDS 16.2): effective char ${fmt(charDepth(o.fire), 2)} in. on beams and columns, ${fmt(r.pan.fire.aeff, 2)} in. on the CLT soffit${o.cltFallOff ? ' with lamination fall-off' : ''}. Highest fire utilization ${fmt(Math.max(r.pan.u.f, r.gir.u.f, r.pur ? r.pur.u.f : 0, r.col.u.f), 2)}.`);
    add(bad.length ? 'warn' : 'info', bad.length
      ? `Connection protection (NDS 16.3): ${bad.map(x => esc(x.name.toLowerCase())).join(', ')} cannot be concealed in the wood as sized; protect with gypsum or use rated hardware, or widen the members.`
      : `Connection protection (NDS 16.3): concealed connectors fit with ${fmt(charDepth(o.fire), 2)} in. wood cover; keep all steel and fastener tips that far inside exposed faces.`);
    add('info', `Specify glulam beams for fire (NDS 16.2.4): substitute ${o.fire > 1 ? 'two outer tension laminations for two core laminations' : 'one outer tension lamination for a core lamination'} on the tension side (both sides for balanced layups).`);
  } else add('ok', 'No fire rating: exposed timber and connections with no char allowance.');
  add(r.pickOk ? 'ok' : 'bad', `Heaviest pick ${fmt(r.heavy[1] / 1000, 1)} kip (${r.heavy[0]})${o.maxPick ? ` against a ${o.maxPick} kip crane limit` : ''}. ${fmt(r.ppk, 1)} picks per 1,000 sq ft, about ${fmt(r.pr.hours / r.q.area * 1000, 1)} crane hours per 1,000 sq ft.`);
  add(r.pr.oversize ? 'warn' : 'ok', r.pr.oversize ? `Panels ${CAT.logi.panW} ft wide${(r.Lpan || 0) > 53 ? ' and over 53 ft long' : ''} ship as oversize loads (permits, higher freight). Panels 8 ft wide or narrower avoid this but add picks.` : 'Panels ship as standard loads.');
  add('info', `Repetition: ${r.T2 ? 3 : 2} glulam member sizes per floor, panels ${CAT.logi.panW} x ${fmt(r.Lpan || 0, 1)} ft.`);
  add(r.supOk ? 'info' : 'bad', r.supOk ? `Supplier: ${esc(supplierText(r))}, ${fmt(r.pr.hc.d, 0)} mi by road${r.pr.hc.cross || r.pr.hg.cross ? ', crosses the border' : ''}. Freight ${money(r.pr.parts.Freight / r.q.area * 1000)} per 1,000 sq ft.` : 'No listed manufacturer can make this panel size and grade.');
  if (r.pr.hc.cross || r.pr.hg.cross) add('warn', 'Cross-border supply: CUSMA-compliant Canadian CLT and glulam currently enter the US without the new tariffs, but this has changed several times in 2025 and 2026. Confirm before pricing.');
  return N.join('');
}
function supplierRows(o, r) {
  const q = r.q;
  const rows = CAT.mfrs.map((m, i) => {
    const why = cltReason(CAT, m, r) || glReason(m, o);
    const p = priceWith(o, CAT, r, q, i, i), d = miles(CAT.sites[o.site], m.ll);
    const chosen = r.pr.ic === i || r.pr.ig === i;
    return { m, i, why, p, d, chosen };
  }).sort((a, b) => (!!a.why - !!b.why) || a.p.cpsf - b.p.cpsf);
  return '<table class="t"><tr><th>Manufacturer</th><th>Plant</th><th class="l">Makes</th><th>Max CLT, ft</th><th>Road mi</th><th>Freight $/sf</th><th>Tariff $/sf</th><th>Delivered total $/sf</th><th class="l">Status</th></tr>' +
    rows.map(x => {
      const m = x.m, makes = [m.clt ? 'CLT' : '', m.gl ? 'glulam' : '', m.other ? 'MPP, LVL' : ''].filter(Boolean).join(', ');
      const size = m.clt ? `${m.clt.w} x ${m.clt.L}${m.clt.known ? '' : ' <span class="tag ph">assumed</span>'}` : '-';
      return `<tr class="${x.chosen ? 'sel' : x.why ? 'off' : ''}"><td>${esc(m.name)}</td><td>${esc(m.plant)}</td><td class="l">${makes}</td><td>${size}</td><td>${fmt(x.d, 0)}</td>` +
        (x.why ? `<td>-</td><td>-</td><td>-</td><td class="l">${esc(x.why)}</td>` :
          `<td>${fmt(x.p.parts.Freight / q.area, 2)}</td><td>${fmt(x.p.parts.Tariffs / q.area, 2)}</td><td><b>${fmt(x.p.cpsf, 2)}</b></td><td class="l">${x.chosen ? '<span class="chip good">selected</span>' : 'can supply'}</td>`) + '</tr>';
    }).join('') + '</table>';
}

/* ================= render ================= */
function render() {
  const o = readInputs();
  $('corrbox').style.display = o.layout === 'corr' ? '' : 'none';
  $('gA_o').textContent = o.A + ' ft'; $('gB_o').textContent = o.B + ' ft';
  $('sdl_o').textContent = o.sdl + ' psf'; $('stories_o').textContent = o.stories;
  $('H_o').textContent = fmt(o.H, 1) + ' ft'; $('target_o').textContent = fmt(o.target, 1) + ' Hz';
  $('damp_o').textContent = fmt(o.damp * 100, 1) + '%';
  const t0 = performance.now();
  S.o = o; S.pts = study(o, CAT); S.ranked = rank(o, S.pts); S.best = S.ranked[0] || null;
  S.ms = performance.now() - t0;
  let cfg = pinned || (S.best && S.best.cfg);
  if (!cfg) { const any = S.pts.filter(p => p.r).sort((a, b) => b.r.fn - a.r.fn)[0]; cfg = any && any.cfg; }
  if (!cfg) cfg = { sys: 'T2', n: Math.max(2, Math.ceil(o.A / 10)), pi: 4, pw: 6.75, pd: 24, gw: 10.75, gd: 36, ci: null };
  S.cur = { cfg, r: evalDesign(o, CAT, cfg) };
  renderStudy(o); renderDesign(o); renderRuns(); renderGrid(); renderReport(o);
  const cs = $('calcstat'); cs.textContent = `Recalculated ${S.pts.filter(p => p.r).length} designs in ${fmt(S.ms, 0)} ms at ${new Date().toLocaleTimeString()}`;
  cs.classList.add('flash'); clearTimeout(cs._t); cs._t = setTimeout(() => cs.classList.remove('flash'), 600);
}

function renderStudy(o) {
  const b = S.best;
  $('studyinfo').textContent = `${S.pts.filter(p => p.r).length} sized designs (${S.ranked.length} pass every check) across ${CAT.panels.filter(p => p.on).length} panels and ${layouts(o).length} layouts, in ${fmt(S.ms, 0)} ms. ${o.layout === 'corr' ? `Costs are per sq ft of a ${o.A} ft wide strip across ${2 * o.nb} bays and the corridor.` : 'Costs are per sq ft of one bay.'}`;
  if (!b) {
    const cnt = {}; S.pts.forEach(p => { const k = p.r ? whyFail(p.r) : 'CLT panel'; cnt[k] = (cnt[k] || 0) + 1; });
    const why = Object.entries(cnt).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ');
    $('bestbox').innerHTML = `<span class="chip bad">No design passes every check.</span><div class="hint">What governs: ${esc(why)}.</div>`;
  } else {
    const r = b.r;
    $('bestbox').innerHTML = `<div class="big"><span class="num">$${fmt(r.cpsf, 2)}</span><span class="unit">per sq ft</span><span class="chip good">${esc(sysName(b.cfg))}</span>${femBadge(r, o)}</div>
      <div style="margin-top:6px">${esc(members(r))}</div><div class="hint">From ${esc(supplierText(r))}</div>
      <div class="kpis">
        <div class="kpi"><b>${fmt(r.depth, 1)} in.</b><span>structural depth</span></div>
        <div class="kpi"><b>${fmt(r.fn, 1)} Hz</b><span>floor frequency</span></div>
        <div class="kpi"><b>${r.vrms && !r.ap ? fmt(r.vrms, 0) + ' mips' : fmt(r.ap, 2) + '% g'}</b><span>${r.vrms && !r.ap ? 'RMS velocity' : 'peak acceleration'}</span></div>
        <div class="kpi"><b>${fmt(r.ppk, 1)}</b><span>picks per 1,000 sq ft</span></div>
        <div class="kpi"><b>${fmt(r.heavy[1] / 1000, 1)} kip</b><span>heaviest pick</span></div>
        <div class="kpi"><b>${fmt(r.cfpsf, 3)}</b><span>timber, cu ft per sq ft</span></div>
      </div>
      <div class="actions" style="margin:12px 0 0"><button class="btn" data-pick="${S.pts.indexOf(b)}">Open on the Design tab</button></div>`;
  }
  const show = b ? b.r : S.cur.r;
  $('cb_for').textContent = b ? '(best option)' : '(no passing design; showing the design tab design)';
  $('costchart').innerHTML = costChart(show);
  $('notes').innerHTML = considerations(o, show);
  $('suppliers').innerHTML = supplierRows(o, show);
  $('heat').innerHTML = heatHtml(o);
  $('scatter').innerHTML = scatterSvg(o);
  const sl = S.ranked.slice(0, 8);
  $('short').innerHTML = !sl.length ? '<div class="hint">Nothing passes yet.</div>' :
    '<table class="t"><tr><th>#</th><th>Layout</th><th>Panel</th><th>Purlin</th><th>Girder</th><th>Column</th><th>$/sf</th><th>Depth, in.</th><th>Hz</th><th>Picks/1000 sf</th><th class="l">Supplier</th><th></th></tr>' +
    sl.map((p, k) => { const r = p.r, c = p.cfg, i = S.pts.indexOf(p);
      return `<tr><td>${k + 1}</td><td class="l">${sysShort(c)}</td><td class="l">${esc(r.P.name)}</td><td>${r.T2 ? sz(c.pw, c.pd) : '-'}</td><td>${sz(c.gw, c.gd)}</td><td>${sz(r.col.b, r.col.d)}</td><td>${fmt(r.cpsf, 2)}</td><td>${fmt(r.depth, 1)}</td><td>${fmt(r.fn, 1)}</td><td>${fmt(r.ppk, 1)}</td><td class="l">${esc(r.pr.mc.name + ' ' + r.pr.mc.plant.split(',')[0])}</td>` +
        `<td><button class="btn small" data-pick="${i}">Open</button> <button class="btn small" data-act="run-one" data-pick="${i}">Add run</button></td></tr>`; }).join('') + '</table>';
}

function fillSelect(id, opts, val) {
  const el = $(id), html = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  el.value = String(val);
}
function utilTd(u, gov) { return `<td class="${u > 1 ? 'u-bad' : (gov ? 'u-gov' : '')}">${u ? fmt(u, 2) : '-'}</td>`; }
const spanTxt = n => n > 1 ? ` x ${n} spans` : '';
function strRows(r) {
  const line = (name, size, u, umax, ok) => `<tr><td>${name}</td><td>${size}</td>` + ['b', 'v', 'dl', 'dt', 'f', 'br'].map(k => utilTd(u[k], u[k] === umax)).join('') + `<td><span class="chip ${ok ? 'good' : 'bad'}">${ok ? 'ok' : 'fails'}</span></td></tr>`;
  let h = '<tr><th>Member</th><th>Size and span</th><th>Bending</th><th>Shear</th><th>Live defl. L/360</th><th>Long-term defl. L/240</th><th>Fire</th><th>Bearing</th><th></th></tr>';
  h += line('CLT panel', `${esc(r.P.name)}, ${fmt(r.Lp, 1)} ft${spanTxt(r.pan.n)}`, r.pan.u, r.pan.umax, r.pan.ok);
  if (r.T2) h += line('Purlin', `${sz(r.pur.b, r.pur.d)}, ${fmt(r.pur.L, 0)} ft${spanTxt(r.pur.spans)}`, r.pur.u, r.pur.umax, r.pur.ok);
  h += line('Girder', `${sz(r.gir.b, r.gir.d)}, ${fmt(r.gir.L, 0)} ft`, r.gir.u, r.gir.umax, r.gir.ok);
  h += `<tr><td>Column</td><td>${sz(r.col.b, r.col.d)}, ${fmt(r.Pcol / 1000, 1)} kip service</td>${utilTd(r.col.u.n, r.col.u.n === r.col.umax)}<td>-</td><td>-</td><td>-</td>${utilTd(r.col.u.f, r.col.u.f === r.col.umax)}<td>-</td><td><span class="chip ${r.col.ok ? 'good' : 'bad'}">${r.col.ok ? 'ok' : 'fails'}</span></td></tr>`;
  return h;
}
function fireRows(r, o) {
  if (!(o.fire > 0)) return '<tr><td class="name">No fire rating selected.</td></tr>';
  const f1 = x => fmt(x, 1), f2 = x => fmt(x, 2);
  let h = '<tr><th>Member</th><th class="l">Exposure</th><th>a_eff, in.</th><th class="l">Residual section</th><th>Demand</th><th>Capacity</th><th>Utilization</th></tr>';
  const pf = r.pan.fire;
  if (pf) h += `<tr><td>CLT panel</td><td class="l">soffit${o.cltFallOff ? ', lamination fall-off' : ''}</td><td>${f2(pf.aeff)}</td><td class="l">${pf.nlam} lamination${pf.nlam === 1 ? '' : 's'} lost; S ratio ${f2(r.pan.fr)}</td><td>${fmt(pf.M, 0)} lbf-ft/ft</td><td>${fmt(pf.cap, 0)} lbf-ft/ft</td>${utilTd(r.pan.u.f, false)}</tr>`;
  const mem = (name, m) => m.fire ? `<tr><td>${name}</td><td class="l">3 sides</td><td>${f2(m.fire.a)}</td><td class="l">${f2(m.fire.bf)} x ${f2(m.fire.df)}, CL ${f2(m.fire.CL)}</td><td>${f1(m.fire.M / 12000)} kip-ft</td><td>${f1(m.fire.cap / 12000)} kip-ft</td>${utilTd(m.u.f, false)}</tr>` : '';
  if (r.T2) h += mem('Purlin', r.pur);
  h += mem('Girder', r.gir);
  const cf = r.col.fire;
  if (cf) h += `<tr><td>Column</td><td class="l">${o.colExp} sides</td><td>${f2(cf.a)}</td><td class="l">${f2(cf.bf)} x ${f2(cf.df)}</td><td>${f1(cf.P / 1000)} kip</td><td>${f1(cf.cap / 1000)} kip</td>${utilTd(r.col.u.f, false)}</tr>`;
  h += '<tr><th>Connection</th><th class="l">Where</th><th>Cover, in.</th><th class="l" colspan="4">NDS 16.3 protection</th></tr>';
  r.conn.forEach(c => { h += `<tr><td>${esc(c.name)}</td><td class="l">${esc(c.count)}</td><td>${f2(c.cover)}</td><td class="l" colspan="4"><span class="chip ${c.ok ? 'good' : 'warn'}">${c.ok ? 'ok' : 'protect'}</span> ${esc(c.note)}</td></tr>`; });
  return h;
}
function facRows(r, o) {
  const g = beamGrade(CAT), cg = columnGrade(CAT), f2 = x => fmt(x, 2), f0 = x => fmt(x, 0);
  let h = '<tr><th>Member</th><th class="l">Grade</th><th class="l">Governs</th><th>Live red.</th><th>CL</th><th>CV</th><th>Cb / CP</th><th>Fb\' or FbS\'</th><th>Fv\' or Vs\'</th><th class="l">Demand</th></tr>';
  h += `<tr><td>CLT panel</td><td class="l">${esc(r.P.grade)} (PRG 320 X3)</td><td class="l">${r.pan.gov}</td><td>${f2(r.llf.pan)}</td><td>1.00</td><td>-</td><td>-</td><td>${f0(r.pan.FbSp)} lbf-ft/ft</td><td>${f0(r.pan.Vsp)} lbf/ft</td><td class="l">M ${f0(r.pan.M)} lbf-ft/ft, V ${f0(r.pan.V)} lbf/ft</td></tr>`;
  const mem = (name, m, llf) => `<tr><td>${name}</td><td class="l">${esc(g.name)}</td><td class="l">${m.gov}</td><td>${f2(llf)}</td><td>${f2(m.CL)}</td><td>${f2(m.CV)}</td><td>${m.Cb !== 1 ? f2(m.Cb) : '-'}</td><td>${f0(m.Fbp)} psi</td><td>${f0(m.Fvp)} psi</td><td class="l">M ${fmt(m.M / 12000, 1)} kip-ft, V ${fmt(m.V / 1000, 1)} kip at d, R ${fmt(m.R / 1000, 1)} kip</td></tr>`;
  if (r.T2) h += mem('Purlin', r.pur, r.llf.pur);
  h += mem('Girder', r.gir, r.llf.gir);
  h += `<tr><td>Column</td><td class="l">${esc(cg.name)}</td><td class="l">${r.col.gov}</td><td>${f2(r.llf.col)}</td><td>-</td><td>-</td><td>CP ${f2(r.col.CP)}</td><td>-</td><td>-</td><td class="l">P ${fmt(r.col.P / 1000, 1)} kip, le/d ${fmt(r.col.leOverD, 1)}</td></tr>`;
  return h;
}
function vibRows(r, o) {
  const v = r.vib;
  if (v.method === 'guide') {
    const fm = v.fm, ev = v.ev, f2 = x => fmt(x, 2);
    let h = row('Expected weight (panel + dead + topping + vibration live)', fmt(r.wE, 1), 'psf') +
      row('Panel stiffness for vibration, EIx / EIy', `${fmt(v.EIx / 1e6, 0)} / ${fmt(v.EIy / 1e6, 0)}`, `10^6 lbf-in^2/ft${r.topPsf ? ' incl. topping (gamma ' + o.topGamma + ')' : ''}`) +
      row(`Panel plate mode (1,1) on rigid supports, ${fmt(r.Lp, 1)} x ${fmt(r.T2 ? o.B : o.A, 0)} ft${r.nPan > 1 ? ', ' + r.nPan + ' spans' : ''}`, f2(fm.fp), `Hz, modal mass ${fmt(fm.Mp, 1)} lbf-s^2/in.`) +
      (r.T2 ? row(`Purlin (${o.B} ft span, effective width ${fmt(fm.Bj, 1)} ft)`, f2(fm.fj), `Hz, modal mass ${fmt(fm.Mj, 1)}`) : '') +
      row(`Girder (${o.A} ft span, effective width ${fmt(fm.Bg, 1)} ft)`, f2(fm.fg), `Hz, modal mass ${fmt(fm.Mg, 1)}`) +
      row('Bay mode: Dunkerley frequency; deflection-weighted modal mass', `<b>${f2(fm.f1)}</b>`, `Hz (target ${fmt(o.target, 1)}), ${fmt(fm.M1, 1)} lbf-s^2/in.`) +
      row('Modes used', fm.modes.filter(m => m.mu !== 0).map(m => `${f2(m.f)} Hz`).join(', '), '') +
      row('Regime (guide 4.3.2)', ev.regime, `f1 vs 4 fw = ${fmt(4 * v.fwMax, 1)} Hz`);
    if (ev.res) h += row(`Resonant, fw ${fmt(v.fwMin, 2)} to ${fmt(v.fwMax, 2)} Hz: governing fw ${fmt(ev.res.fw, 3)} Hz, harmonics ${ev.res.ahfw.map(a => fmt(a / 386.1 * 100, 2)).join(' / ')}`, `<b>${fmt(ev.apfwPct, 2)}</b>`, `% g weighted (limit ${fmt(o.alim, 1)}), R = ${fmt(ev.Ra, 1)}`);
    if (ev.tr) h += row(`Transient at ${fmt(v.fwMax, 2)} Hz, ${ev.tr.modes} mode${ev.tr.modes === 1 ? '' : 's'} up to 2 f1${ev.tr.band ? `; 1/3 octave ${fmt(ev.tr.band.fc, 1)} Hz: ${fmt(ev.tr.band.vrms, 0)}` : ''}`, `<b>${fmt(ev.vrms, 0)}</b>`, `mips RMS weighted (limit ${fmt(o.vlim, 0)}), R = ${fmt(ev.Rv, 1)}`);
    const pw = r.P.pcf * r.P.t / 12, L = cltSpanLimit(r.P.EI * 1e6, pw) * (r.topPsf > 2 * pw ? 0.9 : 1);
    return h + row('CLT Handbook span limit (guide 4.2.2, bearing-wall basis; information only)', fmt(L, 1), `ft vs ${fmt(r.Lp, 1)} ft span${r.topPsf > 2 * pw ? ', -10% for topping' : ''}`);
  }
  return row('Expected weight (panel + dead + vibration live)', fmt(r.wE, 1), 'psf') +
    row(`Panel frequency (${fmt(r.Lp, 1)} ft span)`, fmt(r.fp, 1), 'Hz') +
    (r.T2 ? row(`Purlin frequency (${o.B} ft span)`, fmt(r.fj, 1), 'Hz') : '') +
    row(`Girder frequency (${o.A} ft span)`, fmt(r.fg, 1), 'Hz') +
    row('Floor frequency, 1/f^2 = sum of 1/f_i^2', `<b>${fmt(r.fn, 1)}</b>`, `Hz (target ${fmt(o.target, 1)})`) +
    row('Effective weight', fmt(r.W / 1000, 1), 'kip') +
    row('Peak acceleration, 65 lb x exp(-0.35 f) / (damping x W)', `<b>${fmt(r.ap, 2)}</b>`, `% g (limit ${fmt(o.alim, 1)})`);
}
function qtyRows(r, o) {
  const q = r.q, c = r.cfg;
  return row('Floor area', fmt(q.area, 0), 'sq ft') +
    row('CLT', `${fmt(q.cf.clt, 0)} cu ft; ${fmt(q.n.panels, 1)} panels (${CAT.logi.panW} x ${fmt(r.Lpan || 0, 1)} ft in bays${o.layout === 'corr' ? `, ${CAT.logi.panW} x ${o.Wc} ft in the corridor` : ''})`, '') +
    (r.T2 ? row('Purlins', `${q.n.pur} x ${sz(c.pw, c.pd)} x ${o.B} ft, ${fmt(q.cf.pur, 0)} cu ft`, '') : '') +
    row('Girders', `${q.n.gir} x ${sz(c.gw, c.gd)} x ${o.A} ft, ${fmt(q.cf.gir, 0)} cu ft`, '') +
    row('Columns', `${q.n.col} x ${sz(r.col.b, r.col.d)} x ${fmt(o.H, 1)} ft, ${fmt(q.cf.col, 0)} cu ft`, '') +
    row('Timber per sq ft', fmt(r.cfpsf, 3), 'cu ft/sq ft') +
    row('Crane picks', fmt(q.picks, 1), `${fmt(r.ppk, 1)} per 1,000 sq ft`) +
    row('Crane and crew time', fmt(r.pr.hours, 1), 'hours') +
    row('Heaviest pick', `${fmt(r.heavy[1] / 1000, 2)} kip`, r.heavy[0]) +
    row('Truckloads', `${fmt(r.pr.hc.loads + r.pr.hg.loads, 1)}${r.pr.oversize ? ' (CLT oversize)' : ''}`, `${fmt(r.pr.hc.d, 0)} mi`);
}
function costRows(r) {
  const tot = r.pr.total, a = r.q.area;
  return Object.entries(r.pr.parts).map(([k, v]) => row(k, money(v), `$${fmt(v / a, 2)}/sf, ${fmt(v / tot * 100, 0)}%`)).join('') +
    row('Total', '<b>' + money(tot) + '</b>', `<b>$${fmt(r.cpsf, 2)}/sf</b>`);
}
function renderDesign(o) {
  const { cfg, r } = S.cur;
  $('d_mode').textContent = pinned ? '(your selection)' : '(optimizer\'s best)';
  fillSelect('d_sys', [['T1', 'CLT on girders'], ['T2', 'CLT on flush purlins'], ['T3', 'Purlins over dropped girders']], cfg.sys);
  fillSelect('d_n', Array.from({ length: 11 }, (_, i) => [i + 2, `${i + 2} (at ${fmt(o.A / (i + 2), 1)} ft)`]), cfg.n || 2);
  fillSelect('d_pi', CAT.panels.map((P, i) => [i, P.name]), cfg.pi);
  fillSelect('d_ci', [['auto', 'Auto-size']].concat(COLS.map((c, i) => [i, sz(c[0], c[1])])), cfg.ci == null ? 'auto' : cfg.ci);
  fillSelect('d_pw', PWS.map(w => [w, wl(w) + ' in.']), cfg.pw || PWS[1]);
  fillSelect('d_pd', DEP.map(d => [d, dl(d) + ' in.']), cfg.pd || 24);
  fillSelect('d_gw', GWS.map(w => [w, wl(w) + ' in.']), cfg.gw);
  fillSelect('d_gd', DEP.map(d => [d, dl(d) + ' in.']), cfg.gd);
  ['d_n', 'd_pw', 'd_pd'].forEach(id => $(id).disabled = cfg.sys === 'T1');
  const st = statusOf(r);
  $('d_result').innerHTML = `<div class="big"><span class="num">$${fmt(r.cpsf, 2)}</span><span class="unit">per sq ft</span><span class="chip ${st[0]}">${st[1]}</span>${femBadge(r, o)}</div>
    <div class="kpis">
      <div class="kpi"><b>${fmt(r.depth, 1)} in.</b><span>structural depth</span></div>
      <div class="kpi"><b>${fmt(r.fn, 1)} Hz</b><span>floor frequency</span></div>
      <div class="kpi"><b>${r.vrms && !r.ap ? fmt(r.vrms, 0) + ' mips' : fmt(r.ap, 2) + '% g'}</b><span>${r.vrms && !r.ap ? 'RMS velocity (limit ' + fmt(o.vlim, 0) + ')' : 'acceleration (limit ' + fmt(o.alim, 1) + ')'}</span></div>
      <div class="kpi"><b>${fmt(Math.max(r.pan.umax, r.pur ? r.pur.umax : 0, r.gir.umax, r.col.umax), 2)}</b><span>highest utilization</span></div>
      <div class="kpi"><b>${fmt(r.ppk, 1)}</b><span>picks per 1,000 sq ft</span></div>
      <div class="kpi"><b>${fmt(r.heavy[1] / 1000, 1)} kip</b><span>heaviest pick (${r.heavy[0]})</span></div>
    </div><div class="hint" style="margin-top:8px">${esc(members(r))}. From ${esc(supplierText(r))}.</div>`;
  $('d_costchart').innerHTML = costChart(r);
  $('plan').innerHTML = planSvg(o, r);
  $('q_unit').textContent = o.layout === 'corr' ? `per ${o.A} ft strip: ${2 * o.nb} bays plus corridor, one floor` : 'per typical bay, one floor';
  $('t_str').innerHTML = strRows(r); $('t_fac').innerHTML = facRows(r, o); $('t_fire').innerHTML = fireRows(r, o);
  $('str_basis').textContent = `utilization = demand / capacity; ${o.method}, combinations ${combos(o.method).map(c => c.name).join(' and ')}; Kcr 1.5 glulam, 2.0 CLT`;
  $('t_vib').innerHTML = vibRows(r, o); $('t_qty').innerHTML = qtyRows(r, o); $('t_cost').innerHTML = costRows(r);
  $('d_notes').innerHTML = considerations(o, r);
  $('fem_box').innerHTML = femHtml(o, r);
  const d1 = stripDeflection(46, 15, 380e6), f1 = freqFromDefl(d1), l2 = cltSpanLimit(95e6, 0.45 * 62.4 * 4.125 / 12);
  const ok1 = Math.abs(d1 - 0.138) < 0.0006 && Math.abs(f1 - 9.5) < 0.06, ok2 = Math.abs(l2 - 12.4) < 0.06;
  const tag = ok => ok ? '<span class="ok">matches</span>' : '<span style="color:var(--bad);font-weight:600">differs</span>';
  $('checks').innerHTML = `<div>Frequency example (46 psf, 15 ft, EI 380x10^6): this tool ${fmt(d1, 3)} in., ${fmt(f1, 1)} Hz; guide 0.138 in., 9.5 Hz ${tag(ok1)}</div>` +
    `<div>CLT Handbook span limit example (4 1/8 in. panel, EI 95x10^6, 9.65 psf): this tool ${fmt(l2, 1)} ft; guide 12.4 ft ${tag(ok2)}</div>`;
}
function cfgFromEditor() {
  const ci = $('d_ci').value;
  return { sys: $('d_sys').value, n: +$('d_n').value, pi: +$('d_pi').value, pw: +$('d_pw').value, pd: +$('d_pd').value, gw: +$('d_gw').value, gd: +$('d_gd').value, ci: ci === 'auto' ? null : +ci };
}

/* ----- grid comparison ----- */
function runGrid() {
  const o = readInputs(), As = parseList($('lA').value), Bs = parseList($('lB').value);
  if (!As.length || !Bs.length) { $('g_msg').textContent = 'Enter at least one A and one B between 8 and 60 ft.'; return; }
  const t0 = performance.now(), cells = [];
  As.forEach(A => Bs.forEach(B => { const o2 = Object.assign({}, o, { A, B }); cells.push({ A, B, best: rank(o2, study(o2, CAT))[0] || null }); }));
  gridRes = { As, Bs, cells, key: JSON.stringify(o), obj: o.obj, ms: performance.now() - t0 };
  renderGrid(); renderReport(o);
}
function gridHeat(g) {
  const vals = g.cells.filter(c => c.best).map(c => OBJ[g.obj].v(c.best.r)), lo = Math.min(...vals), hi = Math.max(...vals);
  const top = g.cells.filter(c => c.best).sort((a, b) => OBJ[g.obj].v(a.best.r) - OBJ[g.obj].v(b.best.r))[0];
  let h = '<table class="heat"><tr><th>A \\ B</th>' + g.Bs.map(B => `<th>B = ${B} ft</th>`).join('') + '</tr>';
  g.As.forEach(A => {
    h += `<tr><th>A = ${A} ft</th>` + g.Bs.map(B => {
      const c = g.cells.find(c => c.A === A && c.B === B);
      if (!c.best) return '<td class="none">none</td>';
      const r = c.best.r;
      return `<td class="${c === top ? 'best' : ''}" style="background:${heatColorT(hi > lo ? (OBJ[g.obj].v(r) - lo) / (hi - lo) : 0)}" data-ga="${A}" data-gb="${B}" title="${esc(sysName(r.cfg) + ': ' + members(r))}">${OBJ[g.obj].f(r)}<br><small>${esc(sysShort(r.cfg))}, ${esc(r.P.name.split(' ').slice(0, 2).join(' '))}, ${fmt(r.depth, 0)} in., ${fmt(r.fn, 1)} Hz</small></td>`;
    }).join('') + '</tr>';
  });
  return h + '</table>';
}
function gridBars(g) {
  const list = g.cells.filter(c => c.best).sort((a, b) => a.best.r.cpsf - b.best.r.cpsf);
  if (!list.length) return '<div class="hint">No grid has a passing design.</div>';
  const max = Math.max(...list.map(c => c.best.r.cpsf)), W = 660, rh = 22, H = list.length * rh + 10, ml = 110, mr = 230;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grids ranked by cost" style="width:100%;height:auto;font:11.5px system-ui,sans-serif">`;
  list.forEach((c, i) => {
    const r = c.best.r, y = 5 + i * rh, w = r.cpsf / max * (W - ml - mr);
    s += `<text x="${ml - 8}" y="${y + 14}" text-anchor="end" fill="#1f2328">${c.A} x ${c.B} ft</text>`;
    s += `<rect x="${ml}" y="${y + 3}" width="${w}" height="${rh - 7}" rx="3" fill="${sysColor(r.cfg)}" fill-opacity=".8" data-ga="${c.A}" data-gb="${c.B}" style="cursor:pointer"/>`;
    s += `<text x="${ml + w + 6}" y="${y + 14}" fill="#6b7078">$${fmt(r.cpsf, 2)}/sf, ${fmt(r.depth, 0)} in. deep, ${fmt(r.fn, 1)} Hz, ${esc(sysShort(r.cfg))}</text>`;
  });
  return s + '</svg><div class="legend"><span><i style="background:var(--t1)"></i>CLT on girders</span><span><i style="background:var(--t2)"></i>Flush purlins</span><span><i style="background:var(--t3)"></i>Dropped girders</span></div>';
}
function renderGrid() {
  if (!gridRes) { $('g_heat').innerHTML = '<div class="hint">Not run yet.</div>'; $('g_bars').innerHTML = ''; return; }
  const stale = gridRes.key !== JSON.stringify(readInputs());
  $('g_msg').textContent = `${gridRes.cells.length} grids in ${fmt(gridRes.ms / 1000, 1)} s.` + (stale ? ' Inputs have changed since this run; run again to update.' : '');
  $('g_heat').innerHTML = gridHeat(gridRes); $('g_bars').innerHTML = gridBars(gridRes);
}

/* ----- runs ----- */
function runsTable(withActions) {
  if (!runs.length) return '<div class="hint">No runs yet.</div>';
  return '<table class="t"><tr><th>Run</th><th>Grid</th><th class="l">Layout</th><th class="l">Members</th><th>$/sf</th><th>Depth, in.</th><th>Hz</th><th>% g</th><th>Max util.</th><th>Picks/1000 sf</th><th class="l">Supplier</th><th>Result</th>' + (withActions ? '<th></th>' : '') + '</tr>' +
    runs.map((run, i) => {
      const r = evalDesign(run.o, CAT, run.cfg), st = statusOf(r), um = Math.max(r.pan.umax, r.pur ? r.pur.umax : 0, r.gir.umax, r.col.umax);
      return `<tr><td>${esc(run.label)}</td><td>${run.o.A} x ${run.o.B}</td><td class="l">${sysShort(run.cfg)}</td><td class="l">${esc(members(r))}</td><td>${fmt(r.cpsf, 2)}</td><td>${fmt(r.depth, 1)}</td><td>${fmt(r.fn, 1)}</td><td>${fmt(r.ap, 2)}</td><td>${fmt(um, 2)}</td><td>${fmt(r.ppk, 1)}</td><td class="l">${esc(r.pr.mc.name)}</td>` +
        `<td><span class="chip ${st[0]}">${st[1]}</span></td>` +
        (withActions ? `<td><button class="btn small" data-act="load-run" data-i="${i}">Load</button> <button class="btn small" data-act="del-run" data-i="${i}">Remove</button></td>` : '') + '</tr>';
    }).join('') + '</table>';
}
function renderRuns() { $('runs').innerHTML = runsTable(true); }

/* ----- catalog ----- */
function renderCatalog() {
  const n = (k, v, w) => `<input type="number" data-${k} value="${v}" step="any" style="width:${w || 80}px">`;
  let h = '<h2>CLT panels</h2><div style="overflow-x:auto"><table class="t"><tr><th>Use' + info(CTIP.use) + '</th><th>Name</th><th>Grade' + info(CTIP.grade) + '</th><th class="l">Layup, in.' + info(CTIP.layup) + '</th><th>t, in.</th><th>Plies</th><th>EI_eff, 10^6 lbf-in^2/ft' + info(CTIP.EI) + '</th><th>FbS_eff, lbf-ft/ft' + info(CTIP.FbS) + '</th><th>GA_eff, 10^6 lbf/ft' + info(CTIP.GA) + '</th><th>Vs, lbf/ft' + info(CTIP.Vs) + '</th><th>Density, pcf' + info(CTIP.dens) + '</th><th>Price, $/cu ft' + info(CTIP.price) + '</th><th class="l">Source</th></tr>';
  CAT.panels.forEach((P, i) => {
    const ov = P.override && Object.keys(P.override).some(k => k !== 'src' && P.override[k] != null);
    h += `<tr><td><input type="checkbox" data-p="${i}" data-f="on" ${P.on ? 'checked' : ''}></td><td><input type="text" data-p="${i}" data-f="name" value="${esc(P.name)}" style="width:130px"></td><td>${P.grade}</td>` +
      `<td class="l"><input type="text" data-p="${i}" data-f="layers" value="${esc(P.layers.join(' '))}" style="width:150px"></td><td>${fmt(P.t, 3)}</td><td>${P.pl}</td>` +
      ['EI', 'FbS', 'GA', 'Vs'].map(f => `<td>${n(`p="${i}" data-f="${f}"`, +P[f].toPrecision(4), 74)}</td>`).join('') +
      ['pcf', 'cost'].map(f => `<td>${n(`p="${i}" data-f="${f}"`, P[f], 74)}</td>`).join('') +
      `<td class="l" style="white-space:normal;min-width:220px"><span class="tag ${ov ? 'ph' : 'real'}">${ov ? 'override' : 'computed'}</span> <span class="hint">${esc(ov && P.override.src ? P.override.src : P.src)}</span></td></tr>`;
  });
  h += '</table></div><div class="hint">Section properties are computed from the layup and the PRG 320-2019 Table A1 lamination values (Appendix X3); they reproduce Table A2. Typing a value into EI, FbS, GA or Vs overrides it, for example with a manufacturer\'s product-report value; edit the layup to go back to computed values. Layers run bottom to top, alternating major and minor. CLT price default from the Beck Group Mass Timber Performance Index (about $42 to $44 per cu ft in 2023 and 2024, excluding freight). E1 premium is a placeholder.</div>';
  // key is the data attribute suffix (g, i, c, r, l) -> data-g="field"
  const block = (title, tag, fields, key) => `<h2 style="margin-top:20px">${title} ${tag ? '<span class="tag ph">' + tag + '</span>' : ''}</h2><div class="four">` +
    fields.map(([k, l, v]) => `<div><label>${l}${info(CTIP[k])}</label>${n(`${key}="${k}"`, v, 120)}</div>`).join('') + '</div>';
  const g = CAT.gl, I = CAT.inst, C = CAT.conn, F = CAT.frt, L = CAT.logi, bg = beamGrade(CAT), cg = columnGrade(CAT);
  const sel = (key, opts, v) => `<select data-gs="${key}">${opts.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  h += `<h2 style="margin-top:20px">Glulam <span class="tag real">NDS Supplement 2018</span></h2><div class="four">` +
    `<div><label>Beams (purlins, girders)${info(CTIP.bgrade)}</label>${sel('beamGrade', CAT.glGrades.beams.map(x => x.name), g.beamGrade)}</div>` +
    `<div><label>Columns${info(CTIP.cgrade)}</label>${sel('colGrade', CAT.glGrades.columns.map(x => x.name), g.colGrade)}</div>` +
    `<div><label>Density, pcf${info(CTIP.pcf)}</label>${n('g="pcf"', g.pcf, 120)}</div>` +
    `<div><label>Base price, $/cu ft (6 3/4 in. wide)${info(CTIP.cost)}</label>${n('g="cost"', g.cost, 120)}</div></div>` +
    `<label class="inline"><input type="checkbox" data-gb="balancedContinuous" ${g.balancedContinuous ? 'checked' : ''}> Specify continuous beams balanced (Fbx- = Fbx+)${info(CTIP.balanced)}</label>` +
    `<div class="hint">${esc(bg.name)}: Fbx+ ${bg.Fbp}, Fbx- ${bg.Fbn}, Fv ${bg.Fv}, Fc perp ${bg.Fcperp} psi; Ex app ${bg.Ex}, Ex min ${bg.Exmin} x 10^6 psi (${esc(bg.src)}). ` +
    `${esc(cg.name)}: Fc ${cg.Fc}, Fc perp ${cg.Fcperp} psi; E ${cg.E}, Emin ${cg.Emin} x 10^6 psi (${esc(cg.src)}).</div>`;
  h += '<div class="hint">Price rises with width: ' + Object.entries(CAT.glW).map(([w, f]) => `${wl(+w)} x${f}`).join(', ') + '. Wider members need wider, costlier lamstock (Beck Group MTPI 2025). Auto-sizing limits beam depth to 6 x width.</div>';
  h += block('Erection', 'placeholder', [['crew', 'Crane and crew, $/hour', I.crew], ['pPanel', 'Panel picks per hour', I.pPanel], ['pBeam', 'Beam picks per hour', I.pBeam], ['pCol', 'Column picks per hour', I.pCol]], 'i');
  h += '<div class="hint">$3,000 per hour erection cost cited for one project in a WoodWorks contractor presentation. A study of CLT floor installation measured a typical 78.5 m² (845 sq ft) per hour, about 2 to 3 panels per hour.</div>';
  h += block('Connections, installed allowance', 'placeholder', [['pur', 'Per flush purlin end (hanger), $', C.pur], ['bear', 'Per purlin end bearing on a girder, $', C.bear], ['gir', 'Per girder end, $', C.gir], ['col', 'Per column (base, cap, splice), $', C.col]], 'c');
  h += block('Freight and border', 'estimate', [['rate', 'Flatbed, $/mile (all in)', F.rate], ['payload', 'Payload per load, lb', F.payload], ['osPct', 'Oversize surcharge, %', F.osPct], ['fixed', 'Per load fixed, $', F.fixed], ['broker', 'Customs broker per load, $', F.broker], ['tarCAUS', 'Tariff, Canada to US, %', F.tarCAUS], ['tarUSCA', 'Tariff, US to Canada, %', F.tarUSCA]], 'r');
  h += '<div class="hint">DAT flatbed spot linehaul ran about $2.60 to $2.90 per mile in fall 2026, before fuel. Tariff defaults assume CUSMA-compliant Canadian CLT and glulam (not on the August 2026 US tariff list) and Canada\'s 25% counter-tariff on US CLT and glulam. Both change often; confirm.</div>';
  h += block('Panel logistics', '', [['panW', 'Panel width, ft', L.panW], ['panMax', 'Max panel length, ft', L.panMax]], 'l');
  h += '<div class="actions" style="margin-top:16px"><button class="btn" data-act="reset-cat">Reset catalog to defaults</button></div>';
  $('catalog').innerHTML = h;
  $('mfrcat').innerHTML = '<h2>Manufacturers</h2><div style="overflow-x:auto"><table class="t"><tr><th>Use' + info(CTIP.muse) + '</th><th>Manufacturer</th><th>Plant</th><th>Country</th><th class="l">Makes</th><th>Max CLT w x L, ft' + info(CTIP.msize) + '</th><th>Grades' + info(CTIP.mgrade) + '</th><th>Price factor' + info(CTIP.pf) + '</th><th class="l">Verified' + info(CTIP.mver) + '</th><th class="l">Notes</th></tr>' +
    CAT.mfrs.map((m, i) => `<tr><td><input type="checkbox" data-m="${i}" data-f="on" ${m.on ? 'checked' : ''}></td><td>${esc(m.name)}</td><td>${esc(m.plant)}</td><td>${m.c}</td><td class="l">${[m.clt ? 'CLT' : '', m.gl ? 'glulam' : '', m.other || ''].filter(Boolean).join(', ')}</td>` +
      `<td>${m.clt ? `${m.clt.w} x ${m.clt.L} ${m.clt.known ? '<span class="tag real">published</span>' : '<span class="tag ph">assumed</span>'}` : '-'}</td><td>${m.grades ? m.grades.join(', ') : 'not checked'}</td>` +
      `<td><input type="number" data-m="${i}" data-f="pf" value="${m.pf}" step="0.05" style="width:70px"></td>` +
      `<td class="l">${[['cltSize', 'size'], ['grades', 'grades'], ['glulam', 'glulam']].map(([k2, t]) => `<span class="tag ${m.verified && m.verified[k2] ? 'real' : 'ph'}">${t}</span>`).join(' ')}</td>` +
      `<td class="l" style="white-space:normal;min-width:240px"><span class="hint">${esc(m.src)}</span></td></tr>`).join('') +
    '</table></div><div class="hint">Custom layups and grades come from each manufacturer\'s APA product report or ICC-ES report; not loaded yet. Glulam length assumed up to 60 ft everywhere. Price factor scales that plant\'s material prices. Green: from a published source; orange: assumed.</div>' +
    '<div class="actions" style="margin-top:12px"><button class="btn" data-act="mfr-json">Edit manufacturers as JSON</button></div>' +
    '<div id="mfr_json_box" style="display:none"><textarea id="mfr_json" class="copybox" style="height:280px" spellcheck="false"></textarea>' +
    '<div class="actions" style="margin-top:6px"><button class="btn primary" data-act="mfr-json-apply">Apply</button><button class="btn" data-act="mfr-json-cancel">Cancel</button><span class="hint" id="mfr_json_msg" style="margin:0;color:var(--bad)"></span></div>' +
    '<div class="hint">Fields: on, name, plant, ll [lat, lon], c ("US" or "CA"), clt (null or { w, L ft, t in., known }), gl, grades (null or a list), pf, other, src, verified { cltSize, grades, glulam }. Saved with the project file.</div></div>';
}
function onCatChange(e) {
  const el = e.target, d = el.dataset, val = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
  if (el.type === 'number' && !(val > 0) && d.r !== 'tarCAUS' && d.r !== 'tarUSCA') return;
  if (d.p != null) {
    const P = CAT.panels[+d.p];
    if (d.f === 'layers') {   // new layup: recompute from it and drop any overrides
      const L = String(val).split(/[\s,;]+/).map(Number).filter(x => x > 0);
      if (L.length >= 3 && L.length % 2 === 1) { P.layers = L; P.override = null; resolvePanels([P], CAT.lams); }
      renderCatalog();
    } else if (['EI', 'FbS', 'GA', 'Vs'].includes(d.f)) {
      P.override = Object.assign({}, P.override, { [d.f]: val, src: 'Entered on the Catalog tab' }); P[d.f] = val; renderCatalog();
    } else P[d.f] = val;
  }
  else if (d.gs) { CAT.gl[d.gs] = val; renderCatalog(); }
  else if (d.gb) CAT.gl[d.gb] = val;
  else if (d.m != null) CAT.mfrs[+d.m][d.f] = val;
  else if (d.g) CAT.gl[d.g] = val; else if (d.i) CAT.inst[d.i] = val; else if (d.c) CAT.conn[d.c] = val; else if (d.r) CAT.frt[d.r] = val; else if (d.l) CAT.logi[d.l] = val;
  fillSupplierSelect(); fillFixSelects(); render();
}
$('catalog').addEventListener('change', onCatChange); $('mfrcat').addEventListener('change', onCatChange);

/* ----- report ----- */
function renderReport(o) {
  const name = esc($('rp_name').value || 'Untitled project'), by = esc($('rp_by').value);
  const b = S.best, cur = S.cur.r, st = statusOf(cur);
  const inputs =
    row('Layout', o.layout === 'corr' ? `Double-loaded corridor, ${o.nb} bay${o.nb > 1 ? 's' : ''} each side, ${o.Wc} ft corridor` : 'One typical bay', '') +
    row('Column spacing A x bay depth B', `${o.A} x ${o.B}`, 'ft') +
    row('Design live / vibration live / superimposed dead', `${o.LLd} / ${o.LLv} / ${o.sdl}`, 'psf') +
    row('Floors per column, story height, fire', `${o.stories}, ${fmt(o.H, 1)} ft, ${o.fire ? o.fire + ' hr' : 'none'}`, '') +
    row('Max depth, crane limit, CLT appearance', `${o.maxD ? o.maxD + ' in.' : 'none'}, ${o.maxPick ? o.maxPick + ' kip' : 'none'}, ${o.appear > 1 ? 'architectural' : 'industrial'}`, '') +
    row('Site, supplier rule', `${o.site}, ${o.sup === 'auto' ? 'cheapest delivered' : mfrLabel(CAT.mfrs[+o.sup])}`, '') +
    row('Vibration targets', `${fmt(o.target, 1)} Hz, ${fmt(o.alim, 1)}% g, ${fmt(o.damp * 100, 1)}% damping`, '') + row('Optimized for', OBJ[o.obj].lab, '');
  const sl = S.ranked.slice(0, 5);
  const shortT = !sl.length ? '<p>No design passes every check.</p>' : '<table class="t"><tr><th>#</th><th class="l">Layout</th><th class="l">Members</th><th>$/sf</th><th>Depth</th><th>Hz</th></tr>' +
    sl.map((p, k) => `<tr><td>${k + 1}</td><td class="l">${sysShort(p.cfg)}</td><td class="l">${esc(members(p.r))}</td><td>${fmt(p.r.cpsf, 2)}</td><td>${fmt(p.r.depth, 1)}</td><td>${fmt(p.r.fn, 1)}</td></tr>`).join('') + '</table>';
  let sec = 0; const H2 = t => `<h2>${++sec}. ${t}</h2>`;
  $('report').innerHTML = `<div class="report">
    <h1>Mass timber floor system study</h1>
    <div class="hint">${name}${by ? ' &middot; ' + by : ''} &middot; ${new Date().toLocaleDateString()}</div>
    <p><span class="banner">Concept output. Simplified methods and placeholder values. Not for design or pricing.</span></p>
    ${H2('Summary')}
    <p style="margin:6px 0">${b ? `Best option (${OBJ[o.obj].lab.toLowerCase()}): <b>${esc(sysName(b.cfg))}</b>, ${esc(members(b.r))}, from ${esc(supplierText(b.r))}. About <b>$${fmt(b.r.cpsf, 2)} per sq ft</b> installed framing, <b>${fmt(b.r.depth, 1)} in.</b> structural depth, ${fmt(b.r.fn, 1)} Hz, ${fmt(b.r.ap, 2)}% g.` : 'No design passes every check.'}</p>
    <p style="margin:6px 0">Design detailed below: ${esc(sysName(cur.cfg))}, ${esc(members(cur))}. Result: <b>${st[1]}</b>.</p>
    ${H2('Design basis')}<table class="t">${inputs}</table>
    ${H2('Where the cost goes')}${costChart(cur)}
    ${H2('Plan')}${planSvg(o, cur)}
    ${H2('Design considerations')}<ul class="notes">${considerations(o, cur)}</ul>
    ${H2('Checks')}<div style="overflow-x:auto"><table class="t">${strRows(cur)}</table></div><table class="t" style="margin-top:8px">${vibRows(cur, o)}</table>
    ${H2('Quantities and cost')}<table class="t">${qtyRows(cur, o)}</table><table class="t" style="margin-top:8px">${costRows(cur)}</table>
    ${H2('Suppliers')}<div style="overflow-x:auto">${supplierRows(o, cur)}</div>
    ${H2('Options considered')}<div style="overflow-x:auto">${heatHtml(o)}</div>${shortT}
    ${gridRes ? H2('Grid comparison') + `<div style="overflow-x:auto">${gridHeat(gridRes)}</div>${gridBars(gridRes)}` : ''}
    ${H2('Runs')}${runsTable(false)}
    ${H2('Assumptions and limits')}
    <ul>
      <li>Members designed to NDS 2018 (${o.method}) with ASCE 7-22 gravity combinations and ${o.llr ? 'live load reduction per §4.7' : 'no live load reduction'}. CLT properties from the layup per PRG 320-2019 Appendix X3; glulam from NDS Supplement Tables 5A and 5B.</li>
      <li>Vibration: ${o.vibMethod === 'dg11' ? 'AISC DG 11 walking formula (not validated for timber).' : `guide 4.3 modal response analysis (resonant limit ${fmt(o.alim, 1)}% g, transient limit ${fmt(o.vlim, 0)} mips, walking up to ${o.fwMax} Hz). The response calculations reproduce the guide's worked examples; the modes are closed-form estimates, not FEM.`}</li>
      <li>Uniform loads; purlin reactions smeared along the girders. Corridor CLT priced but not checked. Exterior girders and columns sized like interior ones. Fire per NDS 2018 Chapter 16 (effective char, residual sections, Table 16.2.2) with connection protection screened only. See ASSUMPTIONS.md for the full list.</li>
      <li>Costs: CLT from the Beck Group MTPI; glulam, erection, connection, freight and tariff values are editable estimates. No general conditions, design assist, shop drawings, temporary protection, sales tax or markup.</li>
      <li>Supplier panel sizes marked assumed are not confirmed. Tariff status on cross-border timber has changed repeatedly in 2025 and 2026.</li>
    </ul>
    ${H2('Appendix: calc package for the design shown')}
    <div class="hint" style="margin-bottom:6px">${esc(sysName(cur.cfg))}: ${esc(members(cur))}. Every check with its equation, values and reference. Utilizations over 1.00 are shown in red.</div>
    ${calcPkgHtml(o, cur)}</div>`;
  lastReportText = reportText(o, b, cur, st);
}
/* ----- FEM verification (vib-engine) ----- */
let femRes = null;
function vibRatio(r, o) {
  const ev = r.vib.ev;
  if (r.vib.method !== 'guide' || !ev) return r.ap / o.alim;
  return Math.max(ev.res ? ev.apfwPct / o.alim : 0, ev.tr ? ev.vrms / o.vlim : 0);
}
function femBadge(r, o) {
  const why = needsFem(r, vibRatio(r, o));
  return why.length ? ` <span class="chip warn" title="${esc(why.join(' '))}">verify with FEM</span>` : '';
}
function femDesign(o, r) { return exportDesign(o, CAT, r, r.vib.fwMin, r.vib.fwMax); }
function femHtml(o, r) {
  const why = needsFem(r, vibRatio(r, o));
  const flag = why.length ? `<ul class="notes" style="margin-bottom:8px">${why.map(w => `<li class="warn">${esc(w)}</li>`).join('')}</ul>` : '';
  if (!femRes) return flag + '<div class="hint">Export this design, run <code>python fem_engine/run.py design.json results.json</code> in vib-engine (about a minute for a 3 x 3 bay patch), then import the results to compare. Findings above come from the engine\'s validation (VALIDATION.md sections 5 and 9).</div>';
  const s = femRes.summary, hm = femRes.hand_method || {}, d = femDesign(o, r), stale = femStale(femRes, d), ev = r.vib.ev;
  const f2 = x => x == null ? '-' : fmt(x, 2), f3 = x => x == null ? '-' : fmt(x, 3), f0 = x => x == null ? '-' : fmt(x, 0);
  const femTr = s.governing_check === 'transient' || s.governing_check === 'both';
  const femOk = s.ap_fw_pct_g <= o.alim && (!femTr || (s.vrms_fw_mips ?? 0) <= o.vlim);
  const mine = o.vibMethod === 'guide' ? 'This tool: guide 4.3, closed-form modes' : 'This tool: DG 11 option';
  let h = flag + `<div style="margin-bottom:8px"><span class="chip ${stale.length ? 'bad' : 'good'}">${stale.length ? 'stale: differs on ' + esc(stale.join(', ')) : 'matches this design'}</span>
    <span class="hint" style="margin-left:8px">${esc(femRes.engine.name)} ${esc(femRes.engine.version || '')}${femRes.engine.solver ? ', ' + esc(femRes.engine.solver) : ''}${femRes.engine.runtime_s ? `, ${fmt(femRes.engine.runtime_s, 0)} s` : ''}</span></div>`;
  h += '<div style="overflow-x:auto"><table class="t"><tr><th class="l">Quantity</th><th>' + esc(mine) + '</th><th>Engine hand check<br><span class="ref">DG 11 style: 65 lb, one mode, unweighted</span></th><th>FEM<br><span class="ref">CCIP-016: 168 lb, all modes, weighted</span></th><th class="l">Limit</th></tr>' +
    `<tr><td class="l">Fundamental frequency, Hz</td><td>${f2(r.fn)}</td><td>${f2(hm.f_dunkerley)}</td><td><b>${f2(s.f1_Hz)}</b></td><td class="l">target ${fmt(o.target, 1)}</td></tr>` +
    `<tr><td class="l">Peak acceleration, % g</td><td>${f3(r.ap)}</td><td>${f3(hm.ap_pct_g)}</td><td><b>${f3(s.ap_fw_pct_g)}</b>${s.fw_at_peak_Hz ? ` at ${f2(s.fw_at_peak_Hz)} Hz` : ''}</td><td class="l">${fmt(o.alim, 2)}</td></tr>` +
    `<tr><td class="l">RMS velocity, mips</td><td>${r.vrms ? f0(r.vrms) : '-'}</td><td>-</td><td>${f0(s.vrms_fw_mips)}</td><td class="l">${f0(o.vlim)}</td></tr>` +
    `<tr><td class="l">Response factor (accel. / vel.)</td><td>${ev ? `${f2(ev.Ra)} / ${ev.tr ? f2(ev.Rv) : '-'}` : '-'}</td><td>-</td><td>${f2(s.R_acc)} / ${f2(s.R_vel)}</td><td></td></tr>` +
    `<tr><td class="l">Governing check</td><td>${ev ? esc(ev.regime) : 'acceleration'}</td><td>-</td><td>${esc(s.governing_check || '-')}</td><td></td></tr>` +
    `<tr><td class="l">Passes the limits</td><td><span class="chip ${r.vibA ? 'good' : 'bad'}">${r.vibA ? 'yes' : 'no'}</span></td><td>-</td><td><span class="chip ${femOk ? 'good' : 'bad'}">${femOk ? 'yes' : 'no'}</span></td><td></td></tr>` +
    `<tr><td class="l">Acceleration, this tool / FEM</td><td>${s.ap_fw_pct_g ? f2(r.ap / s.ap_fw_pct_g) : '-'}</td><td>${hm.ap_pct_g && s.ap_fw_pct_g ? f2(hm.ap_pct_g / s.ap_fw_pct_g) : '-'}</td><td>1.00</td><td></td></tr></table></div>`;
  if (s.worst_point_in_bay_ft) h += `<div class="hint" style="margin-top:6px">Worst point in the centre bay: x = ${f2(s.worst_point_in_bay_ft[0])} ft along A (girder span), y = ${f2(s.worst_point_in_bay_ft[1])} ft along B, from the bay corner. This tool evaluates the bay centre only.</div>`;
  const pts = femRes.points ? Object.entries(femRes.points) : [];
  if (pts.length) h += '<h3 style="font-size:13px;margin:12px 0 4px">Points</h3><table class="t" style="width:auto"><tr><th class="l">Point</th><th>Peak accel., % g</th><th>RMS vel., mips</th></tr>' +
    pts.map(([k, v]) => `<tr><td class="l">${esc(k)}</td><td>${f3(v.ap_fw_pct_g)}</td><td>${f0(v.vrms_fw_mips)}</td></tr>`).join('') + '</table>';
  const modes = femRes.modes || [];
  if (modes.length) h += `<h3 style="font-size:13px;margin:12px 0 4px">FEM modes <span class="ref">first ${Math.min(8, modes.length)} of ${modes.length}; this tool's bay mode: ${f2(r.fn)} Hz${r.vib.fm ? `, ${fmt(r.vib.fm.M1, 1)} lbf-s^2/in.` : ''}</span></h3><table class="t" style="width:auto"><tr><th>Mode</th><th>f, Hz</th><th>Modal mass, lbf-s^2/in.</th><th>phi at centre</th></tr>` +
    modes.slice(0, 8).map(m => `<tr><td>${m.mode}</td><td>${f2(m.f_Hz)}</td><td>${fmt(m.modal_mass_lbf_s2_in, 1)}</td><td>${f3(m.phi_center)}</td></tr>`).join('') + '</table>';
  const w = femRes.warnings || [];
  h += `<h3 style="font-size:13px;margin:12px 0 4px">Engine warnings</h3>${w.length ? `<ul class="notes">${w.map(x => `<li class="warn">${esc(String(x))}</li>`).join('')}</ul>` : '<div class="hint">None.</div>'}`;
  return h;
}
function calcPkgHtml(o, r) {
  return calcPackage(o, CAT, r).map(s => `<h3 style="font-size:13px;margin:14px 0 4px">${esc(s.title)}</h3><div style="overflow-x:auto"><table class="t calcpkg"><tr><th class="l">Item</th><th class="l">Equation</th><th class="l">Values</th><th>Util.</th><th class="l">Reference</th></tr>` +
    s.lines.map(l => `<tr><td class="l">${esc(l.item)}</td><td class="l mono">${esc(l.eq)}</td><td class="l">${esc(l.val)}</td>${l.u != null ? utilTd(l.u, false) : '<td>-</td>'}<td class="l name">${esc(l.ref)}</td></tr>`).join('') + '</table></div>').join('');
}
function reportText(o, b, cur, st) {
  const L = [];
  L.push('MASS TIMBER FLOOR SYSTEM STUDY (concept output, not for design or pricing)');
  L.push(($('rp_name').value || 'Untitled project') + ($('rp_by').value ? ' - ' + $('rp_by').value : '') + ' - ' + new Date().toLocaleDateString(), '');
  L.push(`${o.layout === 'corr' ? `Corridor building, ${o.nb} bay(s) each side, ${o.Wc} ft corridor` : 'Typical bay'}; A x B ${o.A} x ${o.B} ft; site ${o.site}`, '');
  L.push(b ? `Best (${OBJ[o.obj].lab}): ${sysName(b.cfg)} - ${members(b.r)} - $${fmt(b.r.cpsf, 2)}/sf, ${fmt(b.r.depth, 1)} in., ${fmt(b.r.fn, 1)} Hz - ${supplierText(b.r)}` : 'No design passes every check.');
  L.push(`Shown: ${sysName(cur.cfg)} - ${members(cur)} - ${st[1]}`, '', 'Cost breakdown ($/sf, share):');
  Object.entries(cur.pr.parts).forEach(([k, v]) => L.push(`  ${k}: $${fmt(v / cur.q.area, 2)} (${fmt(v / cur.pr.total * 100, 0)}%)`));
  L.push('', 'Top options:');
  S.ranked.slice(0, 5).forEach((p, k) => L.push(`  ${k + 1}. ${sysShort(p.cfg)}: ${members(p.r)} - $${fmt(p.r.cpsf, 2)}/sf, ${fmt(p.r.depth, 1)} in.`));
  if (gridRes) { L.push('', 'Grid comparison:'); gridRes.cells.filter(c => c.best).sort((a, c) => a.best.r.cpsf - c.best.r.cpsf).forEach(c => L.push(`  ${c.A} x ${c.B} ft: $${fmt(c.best.r.cpsf, 2)}/sf, ${fmt(c.best.r.depth, 0)} in., ${sysShort(c.best.cfg)}`)); }
  L.push('', 'Runs:'); if (!runs.length) L.push('  none');
  runs.forEach(run => { const q = evalDesign(run.o, CAT, run.cfg); L.push(`  ${run.label}: ${run.o.A} x ${run.o.B} ft, ${members(q)} - $${fmt(q.cpsf, 2)}/sf - ${statusOf(q)[1]}`); });
  return L.join('\n');
}

/* ================= tooltips ================= */
const TAB_TIPS = {
  study: "Searches every allowed combination of panel, layout and member sizes for the grid in the sidebar and ranks the ones that pass. Start here.",
  design: "Full checks, plan, quantities and cost for one design. Change any member to see the effect; your selection stays until you press 'Use the optimizer's best'.",
  grid: "Repeats the study for several column spacings and bay depths to find the best grid. Most useful early, while the architect's grid is still open.",
  runs: "Saved designs for side-by-side comparison. Each run keeps its own inputs, so you can compare across grids, loads or suppliers.",
  catalog: "Every property, price, rate and manufacturer the tool uses. Orange tags are placeholders; replace them with project quotes.",
  report: "Printable summary of the study and the design on the Design tab. Print to save a PDF, or copy as text for an email."
};
const TIPS = {
  layout: "Double-loaded corridor prices a full strip A wide: bays on both sides plus the corridor, with a girder and column on every gridline. One typical bay prices a single interior bay.",
  nb: "Bays between the corridor and the exterior wall on each side. Two bays deepen the floor plate without longer spans but add a gridline of girders and columns.",
  Wc: "Gridline to gridline across the corridor. The corridor CLT spans this between the corridor girders. About 8 ft gives a 6 ft clear corridor.",
  gA: "Held fixed in the study. Column spacing along the corridor; the girders span this, so it drives girder depth more than anything else. Typical 20 to 30 ft. Vary it on the Grid comparison tab.",
  gB: "Held fixed in the study. Purlins, or the CLT when there are no purlins, span this from the corridor girder to the exterior girder. Residential 25 to 30 ft is common; offices often 30 ft or more.",
  sysF: "CLT on girders: no purlins, shallowest, limited by CLT span. Flush purlins: purlins hang from the girders with tops level; depth is CLT + girder. Dropped girders: purlins sit on top of the girders; deeper overall, but simple bearing connections and MEP crosses the girder line through the gaps between purlins.",
  fx_n: "Lock the number of purlins per bay, for example to match a window module or a planned duct spacing. Optimize tries every count that gives a 4 to 20 ft CLT span.",
  fx_pi: "Lock the panel, for example when the fire assembly or supplier is already chosen.",
  fx_pw: "Lock purlin width, for example to suit a hanger or a fire char allowance. Wider glulam costs more per cubic foot.",
  fx_pd: "Lock purlin depth, for example to keep a uniform duct pocket. If the locked size fails a check, every design using it is reported as failing.",
  fx_gw: "Lock girder width, for example to match the column width for a clean flush connection.",
  fx_gd: "Lock girder depth, for example to fit a fixed ceiling height or match an existing building.",
  fx_ci: "Lock the column size, for example to an architectural column module. Optimize picks the smallest size that passes.",
  occ: "First number: design live load for strength and deflection. Second: the smaller live load actually present in service, which the guide uses for vibration.",
  sdl: "Everything on or under the CLT besides the structure: topping, finishes, partitions, ceilings, MEP. A 1 1/2 in. concrete topping is about 18 psf. More mass lowers frequency but also lowers walking acceleration.",
  stories: "Floors whose load reaches each column, including this one. Only affects column size.",
  H: "Floor to floor height. Used for column length, buckling and cost.",
  fire: "Required rating for exposed timber. Adds a char allowance to beams, columns and the CLT underside; 3-ply panels often fail at 1 hour or more.",
  maxD: "Hard limit on depth below the top of the CLT, usually set by floor-to-floor height minus ceiling, MEP and finish zones. Deeper designs are rejected.",
  maxPick: "Heaviest piece the planned crane can set at its farthest reach. Usually a long girder or a large panel governs.",
  appear: "Architectural grade adds sanding and select faces. Use industrial where the ceiling will be covered.",
  site: "Sets road distance to each plant and whether a delivery crosses the border.",
  sup: "Cheapest delivered compares every plant that can make the design. Pick one plant to force it, for example a supplier already under contract.",
  split: "Lets the optimizer buy glulam from a different plant than the CLT, for example a glulam specialist closer to the site.",
  target: "Lower-bound floor frequency from the guide's simple method. A screening value, not a code limit; raising it pushes members deeper quickly. About 5 Hz is a reasonable start with the acceleration check also applied.",
  alim: "Peak walking acceleration limit. 0.5% g is the usual office limit; 0.3% g for premium offices, labs or quiet residential.",
  vibMethod: "Guide 4.3: modal response analysis (CCIP-016 resonant acceleration and transient RMS velocity) on closed-form mode estimates. DG 11: the AISC walking formula the concept used, kept for comparison.",
  fwMax: "Fastest walking frequency for the space (guide Table 3-7). The resonant check sweeps from 0.6 Hz below this, in 0.025 Hz steps; the transient check uses this value.",
  vlim: "RMS velocity limit for high-frequency floors (guide 3.7): 16,000 mips offices, 8,000 premium office or residential, 4,000 sensitive spaces.",
  topType: "Topping on the CLT. Its weight is added to the dead load. Concrete stiffness is credited for vibration only (dynamic modulus 1.35 Ec); gypcrete is mass only (guide 3.3.5).",
  topGamma: "Partial composite factor between topping and CLT for vibration (guide Table 3-6, low end of each range).",
  beamGamma: "Incidental composite action between the CLT and purlins or girders when clamped with screws (guide 3.4.3), for vibration only. Not applied to dropped girders.",
  damp: "Damping ratio for the vibration response (guide Table 3-2). Bare structure 1 to 2%; fitted-out office with ceilings and partitions 3 to 5%.",
  obj: "What 'best' means among the designs that pass. Cost is usual; shallowest structure helps when floor-to-floor height is tight.",
  lA: "Column spacings to try, separated by commas. Each value is combined with each B value.",
  lB: "Bay depths to try. Enter one value to hold a fixed room depth while the column spacing varies.",
  sc_y: "Second axis for the trade-off chart.",
  d_sys: "Framing system for this one design. The optimizer's choice is shown until you change something.",
  d_n: "Purlins per bay; sets the CLT span.", d_pi: "Panel for this design.", d_ci: "Auto picks the smallest column that passes.",
  d_pw: "Purlin width.", d_pd: "Purlin depth.", d_gw: "Girder width.", d_gd: "Girder depth.",
  rp_name: "Shown at the top of the report.", rp_by: "Shown at the top of the report.",
  method: "ASD uses D and D + L with load duration factors 0.9 and 1.0. LRFD uses 1.4D and 1.2D + 1.6L with time effect factors 0.6 and 0.8 and the NDS format conversion and resistance factors. Results are close; LRFD is usually slightly lighter for live-heavy floors.",
  panelCont: "Continuous designs each panel over the supports it is shipped across (up to 3 spans analysed), with live load placed on the worst spans. Interior supports then carry more load (1.25 x for two spans), which the purlins or girders below pick up.",
  purlinCont: "With two bays each side of the corridor, purlins sitting on dropped girders can run continuous over the middle girder. Lowers purlin moment and deflection, but the middle girder carries 1.25 x the load. Only applies to the dropped-girder system.",
  Ke: "Effective length factor for column buckling (NDS Appendix G). 1.0 for columns pinned at each floor, the usual assumption.",
  cltFallOff: "Lamination fall-off: each charred lamination falls away at the glue line and charring restarts on the next one (NDS eq. 16.2-3, Table 16.2.1B). Choose no fall-off only for CLT with adhesives qualified to PRG 320 Annex B; then the solid-wood char rate applies.",
  colExp: "Faces of the columns exposed to fire. 3 sides for columns built into a wall; 4 for free-standing columns.",
  llr: "Reduces design live load on members with large tributary areas (ASCE 7-22 4.7): columns use KLL = 4 and all floors above, beams KLL = 2. Not applied to 100 psf assembly loads. Deflections use the unreduced live load."
};
const CTIP = {
  use: "Untick to leave this panel out of the study.",
  layup: "Lamination thicknesses in inches, bottom to top, alternating major and minor direction (odd count). Properties are computed from this and the grade's PRG 320 lamination values.",
  bgrade: "Glulam stress class for purlins and girders (NDS Supplement Table 5A). 24F-1.8E is the common default.",
  cgrade: "Glulam combination for columns (NDS Supplement Table 5B). Douglas fir combination 2 is a common default.",
  balanced: "Continuous beams see negative moment over the support with the top in tension. Specifying a balanced layup gives Fbx- = Fbx+ (Table 5A footnote 1); otherwise the lower Fbx- applies.",
  grade: "PRG 320 grade. E grades use machine-rated lumber in the major direction (stiffer, pricier); V grades use visually graded lumber.",
  EI: "Effective bending stiffness per foot of width, major direction. Controls deflection and vibration. Take it from the manufacturer's product report.",
  FbS: "Effective bending moment capacity per foot of width, ASD reference value.",
  GA: "Effective shear stiffness per foot of width. Used to add shear deflection, which matters on short spans.",
  Vs: "Rolling shear capacity per foot of width. Often governs short, heavily loaded spans.",
  dens: "Used for self weight, pick weight and truck loads. Spruce-pine-fir is about 28 pcf; Douglas fir about 32 to 35 pcf.",
  price: "Supply price per cubic foot before freight. Replace with a supplier budget price when you have one.",
  E: "Glulam modulus of elasticity. 1.8 for 24F-1.8E beams.", Fb: "Glulam reference bending stress.", Fv: "Glulam reference shear stress.",
  Fc: "Column compression parallel to grain.", Emin: "Stability modulus for column buckling.", pcf: "Glulam density for self weight and freight.",
  cost: "Price per cubic foot for a 6 3/4 in. wide member. Other widths scale by the factors below.",
  crew: "Crane, operator and erection crew together, per hour. Biggest single lever on installation cost.",
  pPanel: "Floor panels set per crane hour. About 2 to 3 is typical for 8 to 10 ft wide panels.",
  pBeam: "Purlins and girders set per crane hour, including bolting or screwing off.",
  pCol: "Columns set per crane hour, including plumbing and base connection.",
  pur: "Concealed or exposed hanger, screws and fabrication for one purlin end hung from a girder.",
  bear: "Bearing clip or screws for one purlin end sitting on top of a girder. Usually far cheaper than a hanger.",
  gir: "Girder-to-column connection, hardware plus fabrication, per end.",
  col: "Column base, cap and splice hardware per column per floor.",
  rate: "All-in flatbed rate per mile including fuel. Ask a carrier for a lane quote once the site is known.",
  payload: "Usable payload per truck. Legal loads are usually 40,000 to 48,000 lb.",
  osPct: "Extra cost for permits, escorts and routing when panels are wider than 8 1/2 ft or longer than 53 ft.",
  fixed: "Per-load costs that do not scale with distance: loading, wait time, unloading.",
  broker: "Customs broker and border paperwork per load, cross-border only.",
  tarCAUS: "Tariff on Canadian CLT and glulam entering the US, as a percent of material value. Currently 0% for CUSMA-compliant product; confirm, it has changed often.",
  tarUSCA: "Canadian counter-tariff on US CLT and glulam, as a percent of material value.",
  panW: "Panel width used for piece counts and shipping. Over 8 1/2 ft ships oversize.",
  panMax: "Longest panel you want to ship and set. Longer panels mean fewer picks but heavier picks and oversize loads.",
  muse: "Untick to exclude this plant, for example if it is out of capacity for your schedule.",
  msize: "Largest panel the plant can press. Green: published by the manufacturer. Orange: assumed, confirm before relying on it.",
  mgrade: "Grades the plant is known to make. 'Not checked' means any grade is allowed.",
  mver: "Which of this plant's data come from a published source (green) and which are assumed (orange): press size, grade list, glulam capability.",
  pf: "Multiplies this plant's material prices. Use it to reflect a quote, for example 0.95 for a 5% lower bid."
};
const tipEl = document.createElement('div'); tipEl.id = 'tip'; document.body.appendChild(tipEl);
function placeTip(e) {
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 18;
  if (x + w > innerWidth - 8) x = innerWidth - w - 8;
  if (y + h > innerHeight - 8) y = e.clientY - h - 12;
  tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
}
document.addEventListener('mouseover', e => {
  const el = e.target.closest('.info[data-tip]');
  if (!el || !el.dataset.tip) { tipEl.style.display = 'none'; return; }
  tipEl.textContent = el.dataset.tip; tipEl.style.display = 'block'; placeTip(e);
});
document.addEventListener('mousemove', e => { if (tipEl.style.display === 'block') placeTip(e); });
function info(t) { return t ? `<span class="info" data-tip="${esc(t)}">\u24D8</span>` : ''; }
function applyTips() {
  Object.entries(TIPS).forEach(([id, t]) => {
    const el = $(id); if (!el) return;
    const lb = document.querySelector(`label[for="${id}"]`);
    if (lb) lb.insertAdjacentHTML('beforeend', info(t)); else el.insertAdjacentHTML('afterend', info(t));
  });
  document.querySelectorAll('.tab').forEach(b => b.insertAdjacentHTML('beforeend', info(TAB_TIPS[b.dataset.tab])));
}

/* ================= events ================= */
function fillSupplierSelect() {
  const cur = $('sup').value || 'auto';
  $('sup').innerHTML = '<option value="auto">Cheapest delivered</option>' + CAT.mfrs.map((m, i) => m.on && m.clt ? `<option value="${i}">${esc(mfrLabel(m))}</option>` : '').join('');
  $('sup').value = [...$('sup').options].some(op => op.value === cur) ? cur : 'auto';
}
$('site').innerHTML = Object.keys(CAT.sites).map(k => `<option>${k}</option>`).join(''); $('site').value = 'Seattle, WA';
fillSupplierSelect(); fillFixSelects();
IDS.concat(['rp_name', 'rp_by']).forEach(id => $(id).addEventListener(['split', 'llr'].includes(id) ? 'change' : 'input', render));
$('sc_y').addEventListener('change', () => { $('scatter').innerHTML = scatterSvg(S.o); });
['d_sys', 'd_n', 'd_pi', 'd_ci', 'd_pw', 'd_pd', 'd_gw', 'd_gd'].forEach(id => $(id).addEventListener('change', () => { pinned = cfgFromEditor(); render(); }));
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + name));
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
let runNo = 0;
document.addEventListener('click', e => {
  const act = e.target.closest('[data-act]'), pick = e.target.closest('[data-pick]'), g = e.target.closest('[data-ga]');
  if (act) {
    const a = act.dataset.act, o = readInputs();
    if (a === 'add-run') { runs.push({ label: 'Run ' + (++runNo), o, cfg: Object.assign({}, S.cur.cfg) }); showTab('runs'); }
    else if (a === 'run-one') { runs.push({ label: 'Run ' + (++runNo), o, cfg: Object.assign({}, S.pts[+act.dataset.pick].cfg) }); showTab('runs'); }
    else if (a === 'run-short') { S.ranked.slice(0, 5).forEach((p, k) => runs.push({ label: `Study ${o.A}x${o.B} #${k + 1}`, o, cfg: Object.assign({}, p.cfg) })); showTab('runs'); }
    else if (a === 'clear-runs') runs.length = 0;
    else if (a === 'del-run') runs.splice(+act.dataset.i, 1);
    else if (a === 'load-run') { const run = runs[+act.dataset.i]; setInputs(run.o); pinned = Object.assign({}, run.cfg); showTab('design'); }
    else if (a === 'use-best') pinned = null;
    else if (a === 'grid') { $('g_msg').textContent = 'Running...'; setTimeout(runGrid, 20); return; }
    else if (a === 'reset-cat') { CAT = defaultCatalog(); renderCatalog(); fillSupplierSelect(); fillFixSelects(); }
    else if (a === 'save-proj') { saveProject(o); return; }
    else if (a === 'fem-export') {
      const r = S.cur.r, d = femDesign(o, r);
      downloadJson(d, `design-${r.cfg.sys}-${o.A}x${o.B}.json`);
      $('fem_msg').textContent = `Exported. Run: python fem_engine/run.py design-${r.cfg.sys}-${o.A}x${o.B}.json results.json` + (d.source.notes.length ? ' Note: ' + d.source.notes.join(' ') : '');
      return;
    }
    else if (a === 'fem-import') { $('fem_file').value = ''; $('fem_file').click(); return; }
    else if (a === 'open-proj') { $('proj_file').value = ''; $('proj_file').click(); return; }
    else if (a === 'mfr-json') { const box = $('mfr_json'); box.value = JSON.stringify(CAT.mfrs, null, 1); $('mfr_json_box').style.display = 'block'; $('mfr_json_msg').textContent = ''; return; }
    else if (a === 'mfr-json-cancel') { $('mfr_json_box').style.display = 'none'; return; }
    else if (a === 'mfr-json-apply') {
      let m; try { m = JSON.parse($('mfr_json').value); } catch (err) { $('mfr_json_msg').textContent = 'Not valid JSON: ' + err.message; return; }
      const errs = validateMfrs(m);
      if (errs.length) { $('mfr_json_msg').textContent = errs.slice(0, 6).join(' | ') + (errs.length > 6 ? ` (+${errs.length - 6} more)` : ''); return; }
      CAT.mfrs = normalizeMfrs(m); renderCatalog(); fillSupplierSelect();
    }
    else if (a === 'print') { try { window.print(); } catch (err) { $('rp_msg').textContent = 'Printing is blocked here. Open the file in a browser and print from there.'; } return; }
    else if (a === 'copy') {
      const box = $('rp_box'); box.value = lastReportText; box.style.display = 'block';
      try { navigator.clipboard.writeText(lastReportText).then(() => { $('rp_msg').textContent = 'Copied.'; }, () => { $('rp_msg').textContent = 'Copy blocked. Select the text below.'; }); }
      catch (err) { $('rp_msg').textContent = 'Copy blocked. Select the text below.'; }
      return;
    }
    render(); return;
  }
  if (pick) { pinned = Object.assign({}, S.pts[+pick.dataset.pick].cfg); render(); showTab('design'); return; }
  if (g) { $('gA').value = g.dataset.ga; $('gB').value = g.dataset.gb; pinned = null; render(); showTab('study'); }
});
/* ----- project files ----- */
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function saveProject(o) {
  const name = $('rp_name').value.trim(), p = makeProject({ name, by: $('rp_by').value, inputs: o, catalog: CAT, runs, pinned, fem: femRes });
  const file = (name || 'mt-floor-project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.json';
  downloadJson(p, file);
  $('proj_msg').textContent = `Saved ${file}.`;
}
$('fem_file').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  try { femRes = parseFemResults(await file.text()); render(); $('fem_msg').textContent = `Imported ${file.name}.`; }
  catch (err) { $('fem_msg').textContent = 'Could not import: ' + err.message; }
});
$('proj_file').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  try {
    const { project, warnings } = readProject(await file.text());
    CAT = project.catalog; renderCatalog(); fillSupplierSelect();
    setInputs(project.inputs);
    runs.length = 0; project.runs.forEach(r => runs.push(r)); runNo = runs.length;
    pinned = project.pinned; $('rp_name').value = project.name; $('rp_by').value = project.by;
    femRes = null;
    if (project.fem) { try { femRes = parseFemResults(JSON.stringify(project.fem)); } catch (err) { warnings.push('Saved FEM results were unreadable and were dropped.'); } }
    render();
    $('proj_msg').textContent = `Opened ${file.name}${project.saved ? ' (saved ' + new Date(project.saved).toLocaleString() + ')' : ''}.` + (warnings.length ? ' ' + warnings.join(' ') : '');
  } catch (err) { $('proj_msg').textContent = 'Could not open: ' + err.message; }
});

applyTips();
renderCatalog();
render();
window.__mtStarted = true;   // tells the page's startup check that the app is running
