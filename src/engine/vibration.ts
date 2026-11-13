/**
 * Floor vibration per the U.S. Mass Timber Floor Vibration Design Guide (WoodWorks 2023, "the guide").
 *
 *  - Frequency estimates: §4.2.1 (0.18 sqrt(g/delta), Dunkerley).
 *  - CLT Handbook span limit: §4.2.2.
 *  - Modal response analysis: §4.3.1 resonant (CCIP-016 harmonics, sub-resonance factor, frequency weighting)
 *    and §4.3.2 transient (effective impulse, RMS velocity, 1/3-octave bands). These post-processors take a list
 *    of modes (frequency, modal mass, mode amplitude at the point) and are tested against the guide's examples
 *    using the published FEM modal data.
 *  - Modal properties for a design are ESTIMATED in closed form (no FEM): orthotropic-plate panel modes and a
 *    combined bay mode whose modal mass weights panel, purlin and girder participation by their deflections
 *    (the same weighting AISC DG 11 uses for effective weight). See ASSUMPTIONS.md.
 *  - Composite stiffness: §3.4.1 gamma method, §3.3.5 dynamic concrete modulus.
 *  - AISC DG 11 walking formula kept as an alternative method (bayVibration).
 * Units: in., lbf, s; mass lbf-s^2/in.; acceleration in./s^2 unless stated; velocity micro-in./s (mips).
 */

/** Acceleration of gravity, in./s^2. */
export const G = 386.1;

/** Natural frequency from self-weight deflection, f = 0.18 sqrt(g / delta) (guide §4.2.1). delta in. -> Hz */
export const freqFromDefl = (d: number): number => 0.18 * Math.sqrt(G / d);

/** Inverse of freqFromDefl: equivalent deflection for a frequency. Hz -> in. */
export const deflFromFreq = (f: number): number => G * (0.18 / f) ** 2;

/** Dunkerley combination 1/f^2 = sum 1/fi^2 (guide §4.2.1). Hz -> Hz */
export const dunkerley = (fs: number[]): number => 1 / Math.sqrt(fs.reduce((s, f) => s + 1 / (f * f), 0));

/** Simple-span beam midspan deflection: w plf, L ft, E psi, I in^4 -> in. (E and I kept separate to keep the concept's float order) */
const beamDefl = (w: number, Lft: number, E: number, I: number): number => 5 * (w / 12) * Math.pow(Lft * 12, 4) / (384 * E * I);

// ---------------------------------------------------------------------------------------------
// Composite stiffness (guide §3.4.1, gamma method)

export interface Layer { EI: number; EA: number; h: number }   // lbf-in^2, lbf, in. (per ft width or per beam)

/**
 * Two components in contact, 1 on top of 2, partial composite action gamma (Table 3-6).
 * gamma applies to the component that does NOT contain the composite neutral axis (§3.4.1): it is first applied
 * to component 1; if the neutral axis then falls inside component 1 it is moved to component 2.
 * EI = EI1 + EI2 + g1 EA1 a1^2 + g2 EA2 a2^2, a1 = g2 EA2 r / (g1 EA1 + g2 EA2), r = (h1 + h2)/2.
 */
export function compositeEI(c1: Layer, c2: Layer, gamma: number): { EI: number; on: 1 | 2; z: number } {
  const r = (c1.h + c2.h) / 2;
  const calc = (g1: number, g2: number) => {
    const a1 = g2 * c2.EA * r / (g1 * c1.EA + g2 * c2.EA), a2 = r - a1;
    return { EI: c1.EI + c2.EI + g1 * c1.EA * a1 * a1 + g2 * c2.EA * a2 * a2, z: c2.h / 2 + a2 };
  };
  if (!(gamma > 0)) return { EI: c1.EI + c2.EI, on: 1, z: NaN };
  const t = calc(gamma, 1);
  if (t.z <= c2.h) return { ...t, on: 1 };
  return { ...calc(1, gamma), on: 2 };
}

/** Normal-weight concrete per ft width, dynamic (guide §3.3.5): Ec = 57,000 sqrt(f'c) x 1.35, G = 0.4 Ec. */
export function concreteLayer(t: number, fc: number, dyn = 1.35): Layer & { GA: number } {
  const E = 57000 * Math.sqrt(fc) * dyn;
  return { EI: E * 12 * t ** 3 / 12, EA: E * 12 * t, h: t, GA: 0.4 * E * 12 * t };
}

// ---------------------------------------------------------------------------------------------
// CLT Handbook span limit (§4.2.2)

/**
 * L_lim = (1/12.05) EI^0.293 / (rho A)^0.122, EI lbf-in^2/ft, rho specific gravity, A in^2/ft -> ft.
 * Equivalent form with panel weight w psf: (1/13.34) EI^0.293 / w^0.122.
 */
export const cltSpanLimitRho = (EI: number, rho: number, A: number): number => Math.pow(EI, 0.293) / Math.pow(rho * A, 0.122) / 12.05;
// the weight form (1/13.34) EI^0.293 / w^0.122 is cltSpanLimit in clt.ts

// ---------------------------------------------------------------------------------------------
// Modal response analysis (§4.3)

export interface Mode {
  f: number;     // natural frequency, Hz
  M: number;     // modal mass, lbf-s^2/in. (consistent with mu)
  mu: number;    // mode amplitude at the excitation = response point (self-excitation)
  muR?: number;  // amplitude at a different response point, if any
  name?: string;
}

export interface Walk {
  P: number;      // walker weight, lbf (guide 3.6.2: 168)
  damp: number;   // modal damping ratio (-)
  stride: number; // stride length, ft (3.6.3)
  path: number;   // walking path length, ft (for the sub-resonance factor); 0 = rho taken as 1
}

/** CCIP-016 design harmonic coefficients (guide Table 4-3). fh harmonic frequency, Hz. */
export function harmonicCoeff(h: number, fh: number): number {
  return h === 1 ? Math.min(0.56, 0.41 * (fh - 0.95)) : h === 2 ? 0.069 + 0.0056 * fh : h === 3 ? 0.033 + 0.0064 * fh : h === 4 ? 0.013 + 0.0065 * fh : 0;
}

/** Acceleration frequency weighting (guide §4.3.1.3). fh Hz -> factor */
export const accWeight = (fh: number): number => fh < 4 ? Math.sqrt(fh) / 2 : fh <= 8 ? 1 : 8 / fh;

/** Sub-resonant correction (guide §4.3.1.1): rho = 1 - exp(-2 pi zeta N_h), N_h = 0.55 h L / l. */
export const subResonance = (h: number, damp: number, path: number, stride: number): number =>
  path > 0 ? 1 - Math.exp(-2 * Math.PI * damp * 0.55 * h * path / stride) : 1;

export interface ResonantAt { fw: number; ah: number[]; ahfw: number[]; ap: number; apfw: number } // in./s^2

/**
 * Resonant response at one walking frequency (guide §4.3.1.2): for each harmonic h = 1..4 and mode m (f < fCut),
 * a = (fh/fm)^2 Fh mu_e mu_r rho / M x [A, B] / (A^2 + B^2), A = 1 - (fh/fm)^2, B = 2 zeta fh/fm;
 * real and imaginary parts summed over modes; harmonics combined by SRSS, with and without weighting.
 */
export function resonantAt(modes: Mode[], fw: number, walk: Walk, fCut = 15): ResonantAt {
  const ah: number[] = [], ahfw: number[] = [];
  for (let h = 1; h <= 4; h++) {
    const fh = h * fw, F = harmonicCoeff(h, fh) * walk.P, rho = subResonance(h, walk.damp, walk.path, walk.stride);
    let re = 0, im = 0;
    for (const m of modes) {
      if (!(m.f < fCut)) continue;
      const r = fh / m.f, A = 1 - r * r, B = 2 * walk.damp * r, k = r * r * F * m.mu * (m.muR ?? m.mu) * rho / m.M / (A * A + B * B);
      re += k * A; im += k * B;
    }
    const a = Math.hypot(re, im);
    ah.push(a); ahfw.push(a * accWeight(fh));
  }
  const srss = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return { fw, ah, ahfw, ap: srss(ah), apfw: srss(ahfw) };
}

/** Sweep of walking frequencies (guide §4.3.1.1, 0.025 Hz steps); returns the governing (max weighted) point. */
export function resonantSweep(modes: Mode[], fwMin: number, fwMax: number, walk: Walk, step = 0.025, fCut = 15): ResonantAt & { apMax: number } {
  let best: ResonantAt | null = null, apMax = 0;
  const n = Math.max(0, Math.round((fwMax - fwMin) / step));
  for (let i = 0; i <= n; i++) {
    const r = resonantAt(modes, fwMin + i * step, walk, fCut);
    apMax = Math.max(apMax, r.ap);
    if (!best || r.apfw > best.apfw) best = r;
  }
  return { ...(best as ResonantAt), apMax };
}

/** Effective footfall impulse (guide §4.3.2.1): I = P fw^1.43 / (17.8 fm^1.3), lbf-s. */
export const effImpulse = (P: number, fw: number, fm: number): number => P * Math.pow(fw, 1.43) / (17.8 * Math.pow(fm, 1.3));

/** Velocity frequency weighting (guide §4.3.2.2): 1 if f1 >= 8 Hz, else f1/8. */
export const velWeight = (f1: number): number => f1 >= 8 ? 1 : f1 / 8;

export interface Transient { vrms: number; vrmsFw: number; band: { fc: number; vrms: number } | null; modes: number } // mips

/**
 * Transient response to one footfall at walking frequency fw (guide §4.3.2):
 * v_m(t) = mu_e mu_r I_eff,m / M_m exp(-2 pi zeta f_m t) sin(2 pi f_m t), summed over modes up to 2 f1,
 * RMS over Tw = 1/fw by N steps (the guide's Example 1 uses N = 200). Also the largest 1/3-octave band RMS
 * (centres 8 x 2^(k/3), band 2^(+-1/6)).
 * @returns velocities in micro-in./s
 */
export function transientAt(modes: Mode[], fw: number, P: number, damp: number, steps = 200): Transient {
  const used = modes.filter(m => m.mu !== 0 || (m.muR ?? 0) !== 0);
  if (!used.length) return { vrms: 0, vrmsFw: 0, band: null, modes: 0 };
  const f1 = Math.min(...modes.map(m => m.f));
  const inc = used.filter(m => m.f <= 2 * f1);
  const Tw = 1 / fw, dt = Tw / steps;
  const amp = inc.map(m => m.mu * (m.muR ?? m.mu) * effImpulse(P, fw, m.f) / m.M * 1e6);
  const rms = (sel: number[]) => {
    let s = 0;
    for (let i = 0; i < steps; i++) {
      const t = i * dt; let v = 0;
      for (const k of sel) { const m = inc[k]; v += amp[k] * Math.exp(-2 * Math.PI * damp * m.f * t) * Math.sin(2 * Math.PI * m.f * t); }
      s += v * v * dt;
    }
    return Math.sqrt(s / Tw);
  };
  const all = inc.map((_, k) => k), vrms = rms(all);
  let band: Transient['band'] = null;
  for (let k = -6; k <= 9; k++) {
    const fc = 8 * Math.pow(2, k / 3), lo = fc * Math.pow(2, -1 / 6), hi = fc * Math.pow(2, 1 / 6);
    const sel = all.filter(i => inc[i].f >= lo && inc[i].f < hi);
    if (!sel.length) continue;
    const v = rms(sel);
    if (!band || v > band.vrms) band = { fc, vrms: v };
  }
  return { vrms, vrmsFw: vrms * velWeight(f1), band, modes: inc.length };
}

/** Response-factor baselines (guide §3.7.1): peak acceleration 0.071% g; RMS velocity 1e-4 m/s = 3,937 mips. */
export const R_BASE = { accPctG: 0.071, velMips: 1e-4 / 0.0254 * 1e6 };

// ---------------------------------------------------------------------------------------------
// Closed-form modal estimate

/**
 * Simply supported orthotropic plate, mode (1, n) with one half-wave along the span Lx and n across Ly:
 * f = (pi/2) sqrt([Dx/Lx^4 + 2 H n^2/(Lx^2 Ly^2) + Dy n^4/Ly^4] / m), H = kH sqrt(Dx Dy).
 * Dx is reduced for shear deformation of the span, 1/(1 + 1.2 pi^2 EI / (GA Lx^2)) (Timoshenko, first mode).
 * Unit-normalized sine shape: modal mass = m Lx Ly / 4 per span; nCont equal continuous spans multiply it
 * (guide Example 1, Table 7-2: same frequency, twice the modal mass for two spans).
 * @param EIx, EIy lbf-in^2/ft; @param GAx lbf/ft; @param w psf (vibration weight); @param Lx, Ly ft
 */
export function plateModes(EIx: number, EIy: number, GAx: number, w: number, Lx: number, Ly: number, nCont: number, kH: number, nMax = 6): Mode[] {
  const lx = Lx * 12, ly = Ly * 12, m = w / 144 / G;
  const shear = isFinite(GAx) && GAx > 0 ? 1 / (1 + 1.2 * Math.PI ** 2 * EIx / (GAx * lx * lx)) : 1;
  const Dx = EIx / 12 * shear, Dy = EIy / 12, H = kH * Math.sqrt(Dx * Dy);
  const M = nCont * m * lx * ly / 4, out: Mode[] = [];
  for (let n = 1; n <= nMax; n++) {
    const k = Dx / lx ** 4 + 2 * H * n * n / (lx * lx * ly * ly) + Dy * n ** 4 / ly ** 4;
    out.push({ f: Math.PI / 2 * Math.sqrt(k / m), M, mu: Math.round(Math.sin(n * Math.PI / 2)), name: `panel (1,${n})` });
  }
  return out;
}

export interface FloorVibIn {
  T2: boolean;                 // has purlins
  A: number; B: number;        // ft
  s: number | null;            // purlin spacing, ft
  Lp: number; Ly: number;      // panel span and transverse extent of the panel field, ft
  nPan: number; purSpans: number;
  wE: number;                  // vibration weight, psf (panel + SDL + topping + expected live)
  panel: { EIx: number; EIy: number; GAx: number }; // vibration stiffness incl. topping, per ft
  E: number;                   // glulam E for vibration, psi
  Ij: number | null; Ig: number; // beam I for vibration (composite where credited), in^4
  purSW: number; girSW: number; extra: number; // plf
  capJ: number; capG: number;  // effective-width limits (2/3 floor width), ft
  kH: number;
}

export interface FloorModes {
  modes: Mode[];
  fp: number; fj: number | null; fg: number; f1: number; // Hz
  dp: number; dj: number | null; dg: number;             // equivalent self-weight deflections, in.
  Mp: number; Mj: number | null; Mg: number; M1: number;  // component and combined modal masses, lbf-s^2/in.
  Bj: number | null; Bg: number;                           // effective widths, ft
}

/**
 * Bay mode set. The fundamental bay mode combines panel, purlin and girder flexibility:
 * f1 by Dunkerley (§4.2.1); modal mass M1 = sum(delta_i M_i) / sum(delta_i) with
 *  panel   M_p = plate (1,1) modal mass (above);
 *  purlin  M_j = W_j / (2 g) x spans, W_j = (w_j) B_j L_j, B_j = 2.0 (Ds/Dj)^0.25 L_j <= cap (AISC DG 11 effective width);
 *  girder  M_g = W_g / (2 g),          B_g = 1.8 (Dj/Dg)^0.25 L_g <= cap.
 * (W/2g is the modal mass of a sine-shaped span with a uniform effective width.) Higher panel modes (1,n) on rigid
 * supports are added with mode amplitude sin(n pi/2) at the bay centre.
 */
export function floorModes(v: FloorVibIn): FloorModes {
  const pm = plateModes(v.panel.EIx, v.panel.EIy, v.panel.GAx, v.wE, v.Lp, v.Ly, v.nPan, v.kH);
  const fp = pm[0].f, dp = deflFromFreq(fp), Mp = pm[0].M;
  const lg = v.wE * v.B + v.extra + v.girSW, dg = beamDefl(lg, v.A, v.E, v.Ig), fg = freqFromDefl(dg);
  const Ds = v.panel.EIx / 12, Dg = v.E * v.Ig / (v.B * 12);
  let dj: number | null = null, fj: number | null = null, Mj: number | null = null, Bj: number | null = null, Bg: number;
  if (v.T2) {
    const s = v.s as number, Ij = v.Ij as number, lj = v.wE * s + v.purSW;
    dj = beamDefl(lj, v.B, v.E, Ij); fj = freqFromDefl(dj);
    const Dj = v.E * Ij / (s * 12);
    Bj = Math.min(v.capJ, Math.max(s, 2.0 * Math.pow(Ds / Dj, 0.25) * v.B));
    Mj = (lj / s) * Bj * v.B / (2 * G) * v.purSpans;
    Bg = Math.min(v.capG, 1.8 * Math.pow(Dj / Dg, 0.25) * v.A);
  } else Bg = Math.min(v.capG, 1.8 * Math.pow(Ds / Dg, 0.25) * v.A);
  const Mg = (lg / v.B) * Bg * v.A / (2 * G);
  const parts: [number, number][] = [[dp, Mp], [dg, Mg]];
  if (v.T2) parts.push([dj as number, Mj as number]);
  const f1 = dunkerley(v.T2 ? [fp, fj as number, fg] : [fp, fg]);
  const M1 = parts.reduce((s, [d, M]) => s + d * M, 0) / parts.reduce((s, [d]) => s + d, 0);
  const modes: Mode[] = [{ f: f1, M: M1, mu: 1, name: 'bay' }, ...pm.slice(1).filter(m => m.f > f1)];
  return { modes, fp, fj, fg, f1, dp, dj, dg, Mp, Mj, Mg, M1, Bj, Bg };
}

export interface GuideCriteria {
  walk: Walk;
  fwMax: number; fwMin: number; step: number;
  alim: number;  // peak acceleration limit, % g
  vlim: number;  // RMS velocity limit, mips
}

export interface GuideResult {
  regime: 'resonant' | 'transient' | 'both';
  res: (ResonantAt & { apMax: number }) | null;  // in./s^2
  apfwPct: number;   // governing weighted peak acceleration, % g (0 if not checked)
  tr: Transient | null;
  vrms: number;      // governing weighted RMS velocity, mips (0 if not checked)
  Ra: number; Rv: number; // response factors
  okA: boolean; okV: boolean;
}

/**
 * Guide §4.3 evaluation of a mode set: resonant if f1 < 4 fw,max + 2 Hz, transient if f1 > 4 fw,max (both in between).
 */
export function guideEvaluate(modes: Mode[], c: GuideCriteria): GuideResult {
  const f1 = Math.min(...modes.map(m => m.f));
  const doRes = f1 < 4 * c.fwMax + 2, doTr = f1 > 4 * c.fwMax;
  const res = doRes ? resonantSweep(modes, c.fwMin, c.fwMax, c.walk, c.step) : null;
  const tr = doTr ? transientAt(modes, c.fwMax, c.walk.P, c.walk.damp) : null;
  const apfwPct = res ? res.apfw / G * 100 : 0, vrms = tr ? tr.vrmsFw : 0;
  return { regime: doRes && doTr ? 'both' : doRes ? 'resonant' : 'transient', res, apfwPct, tr, vrms,
    Ra: apfwPct / R_BASE.accPctG, Rv: vrms / R_BASE.velMips, okA: !res || apfwPct <= c.alim, okV: !tr || vrms <= c.vlim };
}

// ---------------------------------------------------------------------------------------------
// AISC DG 11 walking formula (concept method, kept as an option)

export interface VibInput {
  T2: boolean; A: number; B: number; s: number | null;
  wE: number; Ds: number; dp: number; E: number;
  gw: number; gd: number; pw?: number; pd?: number;
  girSW: number; purSW: number; extra: number; damp: number;
  Ig?: number; Ij?: number;    // override beam I (composite), in^4
}

export interface VibResult {
  fp: number; dj: number | null; fj: number | null; dg: number; fg: number; fn: number;
  W: number;   // effective weight, lb
  ap: number;  // peak acceleration, % g
}

/**
 * Frequencies and DG 11-style acceleration of one bay (concept v7).
 * Effective widths: joist 2.0 (Ds/Dj)^0.25 Lj; girder 1.8 (Dj/Dg)^0.25 Lg (AISC DG 11 ch. 4, Cj = 2.0, Cg = 1.8), no width limits.
 * ap/g = Po exp(-0.35 fn) / (beta W), Po = 65 lb. Returned in % g.
 */
export function bayVibration(v: VibInput): VibResult {
  const { T2, A, B, s, wE, Ds, dp, E } = v;
  const fp = freqFromDefl(dp);
  const Ig = v.Ig ?? v.gw * Math.pow(v.gd, 3) / 12, lg = wE * B + v.extra + v.girSW;
  const dg = beamDefl(lg, A, E, Ig), fg = freqFromDefl(dg);
  let dj: number | null = null, fj: number | null = null, W: number;
  if (T2) {
    const sp = s as number;
    const Ip = v.Ij ?? (v.pw as number) * Math.pow(v.pd as number, 3) / 12, lj = wE * sp + v.purSW;
    dj = beamDefl(lj, B, E, Ip); fj = freqFromDefl(dj);
    const Dj = E * Ip / sp, Dg = E * Ig / B;
    const Wj = (lj / sp) * 2.0 * Math.pow(Ds / Dj, 0.25) * B * B, Wg = (lg / B) * 1.8 * Math.pow(Dj / Dg, 0.25) * A * A;
    W = (dj * Wj + dg * Wg) / (dj + dg);
  } else {
    const Dg = E * Ig / B, Wj = wE * 2.0 * B * B, Wg = (lg / B) * 1.8 * Math.pow(Ds / Dg, 0.25) * A * A;
    W = (dp * Wj + dg * Wg) / (dp + dg);
  }
  const fn = dunkerley(T2 ? [fp, fj as number, fg] : [fp, fg]);
  const ap = 65 * Math.exp(-0.35 * fn) / (v.damp * W) * 100;
  return { fp, dj, fj, dg, fg, fn, W, ap };
}
