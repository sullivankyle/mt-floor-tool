/**
 * Calc package: every check for one design as equation, substituted values, result and code reference.
 * Pure (no DOM); the report renders it. Values come from the same results the design checks use, so the
 * package cannot drift from the checks.
 */
import type { Catalog, Inputs } from './types';
import type { DesignResult } from './cost';
import { combos } from './loads';
import { beamGrade } from './glulam';
import { columnGrade } from './columns';
import { cltSpanLimit } from './clt';

export interface CalcLine {
  item: string;      // what is calculated
  eq: string;        // equation in symbols
  val: string;       // result with units (and substituted inputs where short)
  ref: string;       // code or guide reference
  u?: number;        // utilization if this line is a check
}
export interface CalcSection { title: string; lines: CalcLine[] }

const f = (x: number | null | undefined, n = 2) => x == null || !isFinite(x) ? '-' : Number(x).toLocaleString('en-US', { maximumFractionDigits: n, minimumFractionDigits: n });
const k = (x: number, n = 1) => f(x / 1000, n);

export function calcPackage(o: Inputs, cat: Catalog, r: DesignResult): CalcSection[] {
  const S: CalcSection[] = [], add = (title: string, lines: CalcLine[]) => S.push({ title, lines });
  const lrfd = o.method === 'LRFD', cb = combos(o.method), g = beamGrade(cat), cg = columnGrade(cat), P = r.P;
  // ---- basis and loads
  add('Design basis and loads', [
    { item: 'Method and combinations', eq: lrfd ? 'U = 1.4D; U = 1.2D + 1.6L' : 'D; D + L', val: cb.map(c => `${c.name} (${lrfd ? 'lambda' : 'CD'} ${c.time})`).join('; '), ref: `ASCE 7-22 ${lrfd ? '2.3.1' : '2.4.1'}; NDS 2018 ${lrfd ? 'Table N3' : 'Table 2.3.2'}` },
    { item: 'Dead load on CLT', eq: 'D = w_panel + SDL + topping', val: `${f(P.pcf * P.t / 12)} + ${f(o.sdl, 1)} + ${f(r.topPsf)} = ${f(P.pcf * P.t / 12 + o.sdl + r.topPsf)} psf`, ref: 'ASCE 7-22 3.1' },
    { item: 'Live load', eq: 'Lo', val: `${f(o.LLd, 0)} psf`, ref: 'ASCE 7-22 Table 4.3-1' },
    { item: 'Live load reduction factors (panel, purlin, girder, column)', eq: 'L/Lo = 0.25 + 15/sqrt(KLL AT), >= 0.5 (1 floor), 0.4 (2+)', val: [r.llf.pan, r.T2 ? r.llf.pur : null, r.llf.gir, r.llf.col].map(x => x == null ? '-' : f(x)).join(', '), ref: 'ASCE 7-22 4.7.2, Table 4.7-1' },
  ]);
  // ---- CLT
  const pan = r.pan, Lin = r.Lp * 12;
  add(`CLT panel: ${P.name}, ${f(r.Lp, 1)} ft span${r.nPan > 1 ? `, ${r.nPan} continuous spans` : ''}`, [
    { item: 'Layup properties (major direction)', eq: 'EI = sum Ei b (ti^3/12 + ti zi^2); GA per X3-5; FbS = 0.85 Fb Seff/12; Vs = Fs (2/3) A', val: `EI ${f(P.EI, 0)}e6 lbf-in^2/ft, GA ${f(P.GA)}e6 lbf/ft, FbS ${f(P.FbS, 0)} lbf-ft/ft, Vs ${f(P.Vs, 0)} lbf/ft`, ref: 'PRG 320-2019 Appendix X3 (eqs X3-1, X3-3, X3-5, X3-7); Table A1' },
    { item: 'Bending', eq: `M <= FbS' = FbS ${lrfd ? 'KF phi lambda' : 'CD'} (CL = 1)`, val: `M ${f(pan.M, 0)} lbf-ft/ft (${pan.gov}) vs ${f(pan.FbSp, 0)}`, ref: 'NDS 2018 10.3, Table 10.3.1', u: pan.u.b },
    { item: 'Rolling shear', eq: `V <= Vs' = Vs${lrfd ? ' KF phi (2.00 x 0.75)' : ''} (no CD or lambda)`, val: `V ${f(pan.V, 0)} lbf/ft vs ${f(pan.Vsp, 0)}`, ref: 'NDS 2018 Table 10.3.1', u: pan.u.v },
    { item: 'Live load deflection', eq: 'delta_L (bending + 1.2 M/GA shear) <= L/360', val: `${f(pan.dL, 3)} in. vs ${f(Lin / 360, 3)} in.`, ref: 'IBC Table 1604.3; NDS 10.4.1 (Ks = 11.5 equivalent)', u: pan.u.dl },
    { item: 'Long-term deflection', eq: 'Kcr delta_D + delta_L <= L/240, Kcr = 2.0', val: `${f(pan.dT, 3)} in. vs ${f(Lin / 240, 3)} in.`, ref: 'NDS 2018 3.5.2', u: pan.u.dt },
    ...(pan.fire ? [{ item: `Fire, ${o.fire} hr`, eq: `a_eff = 1.2 a_char${o.cltFallOff ? ' (lamination fall-off, 16.2-3)' : ''}; M <= 2.85 FbS (Seff,res / Seff)`, val: `a_eff ${f(pan.fire.aeff)} in., ratio ${f(pan.fr, 3)}; M ${f(pan.fire.M, 0)} vs ${f(pan.fire.cap, 0)} lbf-ft/ft`, ref: 'NDS 2018 16.2.1.3, 16.2.1.4, 16.2.1.5, Table 16.2.2', u: pan.u.f }] : []),
  ]);
  // ---- beams
  const beam = (name: string, m: DesignResult['gir'], lu: string) => {
    const L12 = m.L * 12, lines: CalcLine[] = [
      { item: 'Loads', eq: 'w = wD + self weight + (Lo x LLR)', val: `wD ${f(m.wD, 0)} + sw ${f(m.sw, 0)} plf; wL ${f(m.wL, 0)} plf x ${f(m.llf)}`, ref: 'Load path from members above' },
      { item: 'Volume factor', eq: 'CV = (21/L0)^0.1 (12/d)^0.1 (5.125/b)^0.1 <= 1', val: f(m.CV, 3) + (m.spans > 1 ? ' (L0 = 0.75 L positive)' : ''), ref: 'NDS 2018 5.3.6; Supplement Table 5A adj.' },
      { item: 'Beam stability', eq: 'CL = (1 + FbE/Fb*)/1.9 - sqrt(((1 + FbE/Fb*)/1.9)^2 - (FbE/Fb*)/0.95), FbE = 1.20 Emin\'/RB^2', val: `CL ${f(m.CL, 3)} (${lu})`, ref: 'NDS 2018 3.3.3, eq. 3.3-6, Table 3.3.3' },
      { item: 'Bending', eq: `fb = M/S <= Fb' = Fbx ${lrfd ? 'KF phi lambda' : 'CD'} min(CL, CV)`, val: `M ${k(m.M / 12)} kip-ft (${m.gov}); fb ${f(m.M / (m.b * m.d * m.d / 6), 0)} vs Fb' ${f(m.Fbp, 0)} psi`, ref: 'NDS 2018 5.3, Table 5.3.1; ' + g.name, u: m.u.b },
      { item: 'Shear at d from support', eq: `fv = 1.5 V/(b d) <= Fv' = Fvx ${lrfd ? 'KF phi lambda' : 'CD'}`, val: `V ${k(m.V)} kip; fv ${f(1.5 * m.V / (m.b * m.d), 0)} vs ${f(m.Fvp, 0)} psi`, ref: 'NDS 2018 3.4.2, 3.4.3.1(a)', u: m.u.v },
      { item: 'Live load deflection', eq: 'delta_L <= L/360 (Ex app)', val: `${f(m.dL, 3)} in. vs ${f(L12 / 360, 3)} in.`, ref: 'IBC Table 1604.3; NDS 5.2.7', u: m.u.dl },
      { item: 'Long-term deflection', eq: 'Kcr delta_D + delta_L <= L/240, Kcr = 1.5', val: `${f(m.dT, 3)} in. vs ${f(L12 / 240, 3)} in.`, ref: 'NDS 2018 3.5.2', u: m.u.dt },
    ];
    if (m.lb) lines.push({ item: 'Bearing on dropped girder', eq: `fc_perp = R/(b lb) <= Fc_perp Cb${lrfd ? ' KF phi' : ''}, Cb = (lb + 0.375)/lb`, val: `R ${k(m.R)} kip on ${f(m.b * m.lb, 1)} in^2, Cb ${f(m.Cb, 3)}`, ref: 'NDS 2018 3.10.2, 3.10.4', u: m.u.br });
    if (m.fire) lines.push({ item: `Fire, ${o.fire} hr, 3 sides`, eq: 'section (b - 2a)(d - a); M <= 2.85 Fb min(CV, CL_fire) S_fire', val: `a ${f(m.fire.a)} in., ${f(m.fire.bf)} x ${f(m.fire.df)} in.; M ${k(m.fire.M / 12)} vs ${k(m.fire.cap / 12)} kip-ft`, ref: 'NDS 2018 16.2.1.2, 16.2.1.4, Table 16.2.2', u: m.u.f });
    add(`${name}: ${m.b} x ${m.d} ${g.name}, ${f(m.L, 0)} ft${m.spans > 1 ? ' x 2 spans' : ''}`, lines);
  };
  if (r.T2 && r.pur) beam('Purlin', r.pur, 'top edge braced by CLT');
  beam('Girder', r.gir, r.stack ? `braced at purlins, lu = ${f(r.s, 1)} ft` : 'top edge braced');
  // ---- column
  const c = r.col, Le = o.Ke * o.H * 12;
  add(`Column: ${c.b} x ${c.d} ${cg.name}, ${o.stories} floor${o.stories > 1 ? 's' : ''}`, [
    { item: 'Load', eq: 'P = floors x (D + framing) x A B + floors x Lo A B x LLR', val: `PD ${k(c.PD)} kip, PL ${k(c.PL)} kip (LLR ${f(r.llf.col)})`, ref: 'ASCE 7-22 4.7' },
    { item: 'Slenderness', eq: 'le/d = Ke l / d <= 50', val: `${f(Le, 0)} / ${f(Math.min(c.b, c.d))} = ${f(c.leOverD, 1)}`, ref: 'NDS 2018 3.7.1.2 to 3.7.1.4' },
    { item: 'Column stability', eq: 'CP = (1 + FcE/Fc*)/(2c) - sqrt(((1 + FcE/Fc*)/(2c))^2 - (FcE/Fc*)/c), c = 0.9, FcE = 0.822 Emin\'/(le/d)^2', val: `CP ${f(c.CP, 3)}`, ref: 'NDS 2018 3.7.1.5, eq. 3.7-1' },
    { item: 'Compression', eq: `P <= Fc' A = Fc ${lrfd ? 'KF phi lambda' : 'CD'} CP A`, val: `P ${k(c.P)} kip (${c.gov}) vs ${k(c.cap)} kip`, ref: 'NDS 2018 3.6, 5.3; Supplement Table 5B', u: c.u.n },
    ...(c.fire ? [{ item: `Fire, ${o.fire} hr, ${o.colExp} sides`, eq: 'P <= 2.58 Fc CP_fire A_fire, FcE x 2.03', val: `${f(c.fire.bf)} x ${f(c.fire.df)} in.; ${k(c.fire.P)} vs ${k(c.fire.cap)} kip`, ref: 'NDS 2018 Table 16.2.2', u: c.u.f }] : []),
  ]);
  // ---- vibration
  const v = r.vib;
  if (v.method === 'guide' && v.fm && v.ev) {
    const fm = v.fm, ev = v.ev;
    const lines: CalcLine[] = [
      { item: 'Vibration weight', eq: 'w = panel + SDL + topping + expected live', val: `${f(r.wE, 1)} psf`, ref: 'Guide 3.1, Table 3-1' },
      { item: 'Panel plate mode', eq: 'f = (pi/2) sqrt([Dx/Lx^4 + 2H/(Lx Ly)^2 + Dy/Ly^4]/m); M = m Lx Ly/4 x spans', val: `${f(fm.fp)} Hz, ${f(fm.Mp, 1)} lbf-s^2/in.`, ref: 'Orthotropic plate theory; guide 3.3.3, 3.5.1' },
      ...(r.T2 ? [{ item: 'Purlin', eq: 'f = 0.18 sqrt(g/delta); Bj = 2.0 (Ds/Dj)^0.25 Lj; M = W/(2g)', val: `${f(fm.fj)} Hz, Bj ${f(fm.Bj, 1)} ft, ${f(fm.Mj, 1)} lbf-s^2/in.`, ref: 'Guide 4.2.1; AISC DG 11 ch. 4 effective width' }] : []),
      { item: 'Girder', eq: 'f = 0.18 sqrt(g/delta); Bg = 1.8 (Dj/Dg)^0.25 Lg; M = W/(2g)', val: `${f(fm.fg)} Hz, Bg ${f(fm.Bg, 1)} ft, ${f(fm.Mg, 1)} lbf-s^2/in.`, ref: 'Guide 4.2.1; AISC DG 11 ch. 4 effective width' },
      { item: 'Bay mode', eq: '1/f1^2 = sum 1/fi^2; M1 = sum(delta_i M_i)/sum(delta_i)', val: `${f(fm.f1)} Hz, ${f(fm.M1, 1)} lbf-s^2/in.`, ref: 'Guide 4.2.1 (Dunkerley)', u: o.target > 0 ? o.target / fm.f1 : undefined },
    ];
    if (ev.res) lines.push({ item: `Resonant, fw ${f(v.fwMin)} to ${f(v.fwMax)} Hz`, eq: 'a = sum_h sqrt(re^2 + im^2) W(fh); re, im = (fh/fm)^2 alpha_h P mu^2 rho/M [A, B]/(A^2 + B^2)', val: `governing fw ${f(ev.res.fw, 3)} Hz: ${f(ev.apfwPct, 3)}% g vs ${f(o.alim, 2)}% g (R = ${f(ev.Ra, 1)})`, ref: 'Guide 4.3.1, Table 4-3 (CCIP-016)', u: ev.apfwPct / o.alim });
    if (ev.tr) lines.push({ item: `Transient at ${f(v.fwMax)} Hz`, eq: 'I = P fw^1.43/(17.8 fm^1.3); v_m = mu^2 I/M e^(-2 pi zeta fm t) sin(2 pi fm t); vRMS over 1/fw', val: `${f(ev.vrms, 0)} mips vs ${f(o.vlim, 0)} mips (R = ${f(ev.Rv, 1)})`, ref: 'Guide 4.3.2', u: ev.vrms / o.vlim });
    const w = P.pcf * P.t / 12;
    lines.push({ item: 'CLT Handbook span limit (information)', eq: 'Llim = EI^0.293/(13.34 w^0.122)', val: `${f(cltSpanLimit(P.EI * 1e6, w), 1)} ft vs ${f(r.Lp, 1)} ft`, ref: 'Guide 4.2.2' });
    add('Vibration (closed-form modes)', lines);
  } else add('Vibration (AISC DG 11 option)', [
    { item: 'Floor frequency', eq: '1/fn^2 = sum 1/fi^2, fi = 0.18 sqrt(g/delta_i)', val: `${f(r.fn)} Hz`, ref: 'Guide 4.2.1' },
    { item: 'Peak acceleration', eq: 'ap/g = Po exp(-0.35 fn)/(beta W), Po = 65 lb', val: `${f(r.ap, 3)}% g vs ${f(o.alim, 2)}% g; W ${k(r.W)} kip`, ref: 'AISC DG 11 ch. 4', u: r.ap / o.alim },
  ]);
  return S;
}
