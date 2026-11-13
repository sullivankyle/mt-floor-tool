/**
 * Equal-span continuous beam under uniform load per span, by the three-moment equation.
 * Supports pinned, no settlement. Bending plus shear deformation (Timoshenko with shear correction 1.2,
 * which reproduces NDS 2018 Table 10.4.1.1 Ks = 11.5 for a simple span and 57.6 for fixed ends).
 * Used for CLT panels (1 to 3 spans) and two-span purlins. Pure functions; units as noted.
 */

export interface SpanAnalysis {
  Msup: number[];     // support moments, lbf-ft (negative = hogging), length n+1
  R: number[];        // support reactions, lbf (per ft of width for panels), length n+1
  Mpos: number;       // max sagging moment over all spans, lbf-ft
  Mneg: number;       // max hogging moment magnitude, lbf-ft
  Vmax: number;       // max shear at a support face, lbf
  Vd: number;         // max shear at distance d from a support face (NDS 3.4.3.1(a)), lbf
  defl: number;       // max downward deflection, in.
}

/**
 * @param n number of equal spans (1 to 6)
 * @param L span, ft
 * @param w uniform load on each span, plf (lbf per ft of length), length n
 * @param EI bending stiffness, lbf-in^2
 * @param GA shear stiffness, lbf (Infinity to ignore shear deformation)
 * @param d member depth for the shear-at-d reduction, in. (0 = none)
 */
export function analyzeSpans(n: number, L: number, w: number[], EI: number, GA = Infinity, d = 0, wantDefl = true): SpanAnalysis {
  if (n === 1) {   // closed form, simple span
    const w0 = w[0], R0 = w0 * L / 2, Lin = L * 12;
    const defl = wantDefl ? 5 * (w0 / 12) * Lin ** 4 / (384 * EI) + (isFinite(GA) ? 1.2 * (w0 / 12) * Lin * Lin / (8 * GA) : 0) : 0;
    return { Msup: [0, 0], R: [R0, R0], Mpos: w0 * L * L / 8, Mneg: 0, Vmax: Math.abs(R0), Vd: Math.max(0, Math.abs(R0) - w0 * d / 12), defl };
  }
  // three-moment equation, equal spans: M(i-1) + 4 M(i) + M(i+1) = -(w(i) + w(i+1)) L^2 / 4, sagging positive
  const M = new Array(n + 1).fill(0);
  if (n > 1) {
    const m = n - 1, a = new Array(m).fill(1), b = new Array(m).fill(4), c = new Array(m).fill(1), r = new Array(m);
    for (let i = 0; i < m; i++) r[i] = -(w[i] + w[i + 1]) * L * L / 4;
    for (let i = 1; i < m; i++) { const k = a[i] / b[i - 1]; b[i] -= k * c[i - 1]; r[i] -= k * r[i - 1]; } // Thomas algorithm
    const x = new Array(m); x[m - 1] = r[m - 1] / b[m - 1];
    for (let i = m - 2; i >= 0; i--) x[i] = (r[i] - c[i] * x[i + 1]) / b[i];
    for (let i = 0; i < m; i++) M[i + 1] = x[i];
  }
  const R = new Array(n + 1).fill(0);
  let Mpos = 0, Vmax = 0, Vd = 0, defl = 0;
  const Lin = L * 12, dft = d / 12;
  for (let i = 0; i < n; i++) {
    const Ml = M[i], Mr = M[i + 1], wi = w[i];
    const Vs = (Mr - Ml) / L + wi * L / 2, Ve = (Mr - Ml) / L - wi * L / 2;   // lbf, at left and right ends
    R[i] += Vs; R[i + 1] -= Ve;
    Vmax = Math.max(Vmax, Math.abs(Vs), Math.abs(Ve));
    Vd = Math.max(Vd, Math.abs(Vs) - wi * dft, Math.abs(Ve) - wi * dft);
    if (wi > 0) {
      const xs = Math.min(L, Math.max(0, L / 2 + (Mr - Ml) / (wi * L)));
      Mpos = Math.max(Mpos, Ml + (Mr - Ml) * xs / L + wi * xs * (L - xs) / 2);
    }
    Mpos = Math.max(Mpos, Ml, Mr);
    // deflection (in.): simple-beam uniform + end moments (bending), plus shear term 1.2 w x (L - x) / (2 GA)
    const win = wi / 12, MlIn = Ml * 12, MrIn = Mr * 12;
    for (let k = 1; wantDefl && k < 40; k++) {
      const x = Lin * k / 40;
      const vb = win * x * (Lin ** 3 - 2 * Lin * x * x + x ** 3) / (24 * EI)
        + MlIn * x * (Lin - x) * (2 * Lin - x) / (6 * EI * Lin)
        + MrIn * x * (Lin - x) * (Lin + x) / (6 * EI * Lin);
      const vs = isFinite(GA) ? 1.2 * win * x * (Lin - x) / (2 * GA) : 0;
      defl = Math.max(defl, vb + vs);
    }
  }
  const Mneg = Math.max(0, ...M.map(v => -v));
  return { Msup: M, R, Mpos, Mneg, Vmax, Vd: Math.max(0, Vd), defl };
}

export interface Envelope {
  Mpos: number; Mneg: number; Vmax: number; Vd: number; // lbf-ft, lbf-ft, lbf, lbf
  defl: number;               // in.
  Rmax: number;               // largest support reaction, lbf
}

/**
 * Envelope over live load patterns (every subset of loaded spans) for wD on all spans and wL patterned.
 * @param wD dead load (factored if needed), plf; @param wL live load (factored if needed), plf
 */
export function envelope(n: number, L: number, wD: number, wL: number, EI: number, GA = Infinity, d = 0, wantDefl = true): Envelope {
  const env: Envelope = { Mpos: 0, Mneg: 0, Vmax: 0, Vd: 0, defl: 0, Rmax: 0 };
  const pats = wL > 0 && n > 1 ? 1 << n : 1;
  for (let p = pats === 1 ? 0 : 1; p < pats; p++) {
    const w = Array.from({ length: n }, (_, i) => wD + (pats === 1 ? wL : (p >> i) & 1 ? wL : 0));
    const a = analyzeSpans(n, L, w, EI, GA, d, wantDefl);
    env.Mpos = Math.max(env.Mpos, a.Mpos); env.Mneg = Math.max(env.Mneg, a.Mneg);
    env.Vmax = Math.max(env.Vmax, a.Vmax); env.Vd = Math.max(env.Vd, a.Vd);
    env.defl = Math.max(env.defl, a.defl); env.Rmax = Math.max(env.Rmax, ...a.R);
  }
  return env;
}

/**
 * Largest load delivered to one supporting line by a run of identical members of n spans laid end to end
 * (end supports receive two end reactions; interior supports one interior reaction).
 * Returns the dead and live parts (unfactored) of the governing support, per ft of supporting line
 * when wD, wL are per ft of member width.
 */
export function supportLoad(n: number, L: number, wD: number, wL: number): { D: number; L: number } {
  if (n === 1) return { D: wD * L, L: wL * L };
  const all = (w: number) => analyzeSpans(n, L, new Array(n).fill(w), 1, Infinity, 0, false).R;
  const RD = all(wD);
  const endD = 2 * RD[0], intD = n > 1 ? Math.max(...RD.slice(1, n)) : 0;
  // live: worst pattern for each support type
  let endL = 0, intL = 0;
  for (let p = 1; p < 1 << n; p++) {
    const w = Array.from({ length: n }, (_, i) => (p >> i) & 1 ? wL : 0);
    const R = analyzeSpans(n, L, w, 1, Infinity, 0, false).R;
    endL = Math.max(endL, R[0]);
    if (n > 1) intL = Math.max(intL, ...R.slice(1, n));
  }
  endL *= 2;   // two member ends meet at a joint; each can see its own worst pattern
  return n > 1 && intD + intL >= endD + endL ? { D: intD, L: intL } : { D: endD, L: endL };
}
