/**
 * Fire design of exposed wood members, NDS 2018 Chapter 16 (calculation limited to 2 hours, 16.2).
 */
import type { LamGrade } from './types';

/** Nominal char rate, in./hr (NDS 16.2.1.1: commonly assumed for glulam and CLT). */
export const BETA_N = 1.5;

/** NDS Table 16.2.2 ASD fire adjustment factors (design stress to member strength). */
export const FIRE = { Fb: 2.85, FbE: 2.03, Ft: 2.85, Fc: 2.58, FcE: 2.03 } as const;

/**
 * Char depth for glulam and solid sections, NDS eq. 16.2-1 and 16.2-2: a_char = beta_t t^0.813,
 * with beta_t = beta_n / (1 hr)^0.187, i.e. a_char = beta_n t^0.813 for t in hours.
 * @param hr exposure, hours; @param betaN nominal char rate, in./hr. @returns in.
 */
export const charDepthSolid = (hr: number, betaN = BETA_N): number => hr > 0 ? betaN * Math.pow(hr, 0.813) : 0;

/** Effective char depth for glulam and solid sections, NDS eq. 16.2-4: a_eff = 1.2 a_char. hr -> in. */
export const charDepth = (hr: number, betaN = BETA_N): number => 1.2 * charDepthSolid(hr, betaN);

export interface CltChar { achar: number; aeff: number; nlam: number } // in., in., laminations fully charred

/**
 * CLT char depth from the exposed (bottom) face.
 * With lamination fall-off (NDS eq. 16.2-3): each lamination chars through in t_gi = (h_lam / beta_t)^1.23 hours,
 * then the char rate restarts on the next lamination. Applied lamination by lamination, which equals 16.2-3 for
 * equal laminations and extends it to unequal ones.
 * Without fall-off (adhesives qualified to PRG 320 Annex B, so the char front passes glue lines), eq. 16.2-2 applies.
 * a_eff = 1.2 a_char (16.2-4).
 * @param layers lamination thicknesses, bottom (exposed) to top, in.; @param hr hours
 */
export function cltCharDepth(layers: number[], hr: number, fallOff = true, betaN = BETA_N): CltChar {
  if (!(hr > 0)) return { achar: 0, aeff: 0, nlam: 0 };
  if (!fallOff) { const a = charDepthSolid(hr, betaN); return { achar: a, aeff: 1.2 * a, nlam: 0 }; }
  let t = hr, depth = 0, nlam = 0;
  for (const h of layers) {
    const tgi = Math.pow(h / betaN, 1.23);
    if (t >= tgi) { depth += h; t -= tgi; nlam++; continue; }
    depth += betaN * Math.pow(t, 0.813); t = 0; break;
  }
  if (t > 0) depth += betaN * Math.pow(t, 0.813);   // charred through every layer
  return { achar: depth, aeff: 1.2 * depth, nlam };
}

/** Residual layers after removing a depth a from the bottom: [thickness in., major direction?]. */
export function cltResidual(layers: number[], a: number): [number, boolean][] {
  const out: [number, boolean][] = []; let y = 0;
  layers.forEach((t, i) => { const bot = Math.max(y, a), top = y + t; if (top - bot > 1e-9) out.push([top - bot, i % 2 === 0]); y = top; });
  return out;
}

/**
 * Major-direction effective section modulus of a (possibly charred, unsymmetric) CLT section by the
 * PRG 320 X3 shear-analogy assumptions (transverse E = E/30), about the E-weighted neutral axis, to the
 * extreme fibre of the outermost remaining major layers. NDS 16.2.1.5 asks for the actual layup.
 * @returns Seff, in.^3/ft (0 if no major layer remains)
 */
export function cltSeff(g: LamGrade, residual: [number, boolean][]): number {
  const b = 12, Emaj = g.major.E * 1e6, Emin = g.minor.E * 1e6;
  let y = 0, EA = 0, EAy = 0; const L: { y0: number; y1: number; E: number; maj: boolean }[] = [];
  residual.forEach(([t, maj]) => { const E = maj ? Emaj : Emin / 30; L.push({ y0: y, y1: y + t, E, maj }); EA += E * t; EAy += E * t * (y + t / 2); y += t; });
  if (!L.some(l => l.maj)) return 0;
  const na = EAy / EA;
  let EI = 0; L.forEach(l => { const t = l.y1 - l.y0, yc = (l.y0 + l.y1) / 2; EI += l.E * b * (t ** 3 / 12 + t * (yc - na) ** 2); });
  const ymax = Math.max(...L.filter(l => l.maj).map(l => Math.max(Math.abs(l.y0 - na), Math.abs(l.y1 - na))));
  return EI / (Emaj * ymax);
}

/**
 * Ratio of residual to original major-direction section modulus of a CLT panel charred from below.
 * The fire moment capacity is 2.85 x FbS x ratio, so product-report FbS values scale consistently.
 */
export function cltFireRatio(g: LamGrade, layers: number[], aeff: number): number {
  const S0 = cltSeff(g, cltResidual(layers, 0));
  return S0 > 0 ? cltSeff(g, cltResidual(layers, aeff)) / S0 : 0;
}

/** Reduced rectangular section. exposed: 3 = bottom and both sides; 4 = all faces. b, d, a in. */
export function reducedSection(b: number, d: number, a: number, exposed: 3 | 4): { bf: number; df: number } {
  return { bf: b - 2 * a, df: d - (exposed === 4 ? 2 : 1) * a };
}

export interface ConnFlag {
  name: string;        // connection type
  count: string;       // where it occurs
  cover: number;       // wood cover needed on exposed faces, in. (= a_eff)
  ok: boolean;         // false = cannot be concealed in the wood as sized; needs gypsum, intumescent or a rated product
  note: string;
}

/**
 * Connection protection (NDS 16.3): connectors, fasteners and the wood counted in the connection must be protected
 * for the rating period by wood, fire-rated gypsum or other approved materials. Screening: a concealed connector of
 * width wc is protected by wood if the member is at least wc + 2 a_eff wide and the connector sits a_eff above the
 * soffit. Connector width is a placeholder until Phase 5.
 * @param hr rating; @param sys framing system; @param pw purlin width, in.; @param gw girder width; @param cb, cd column b, d; @param wc connector width, in.
 */
export function connectionProtection(hr: number, sys: 'T1' | 'T2' | 'T3', pw: number, gw: number, cb: number, wc: number): ConnFlag[] {
  if (!(hr > 0)) return [];
  const a = charDepth(hr), need = wc + 2 * a, F: ConnFlag[] = [];
  if (sys === 'T2') F.push({ name: 'Purlin-to-girder hanger', count: 'each purlin end', cover: a, ok: pw >= need,
    note: pw >= need ? `concealed hanger fits: ${pw} in. purlin >= ${need.toFixed(2)} in.` : `purlin ${pw} in. < ${need.toFixed(2)} in. needed to conceal a ${wc} in. hanger; protect with gypsum or use a rated hanger` });
  if (sys === 'T3') F.push({ name: 'Purlin bearing on girder', count: 'each purlin bearing', cover: a, ok: true,
    note: 'clips or screws inside the bearing, covered by the purlin and girder; keep fasteners a_eff from exposed faces' });
  F.push({ name: 'Girder-to-column', count: 'each girder end', cover: a, ok: gw >= need && cb >= need,
    note: gw >= need && cb >= need ? `concealed connector fits (${need.toFixed(2)} in. needed)` : `girder ${gw} in. or column ${cb} in. < ${need.toFixed(2)} in. to conceal a ${wc} in. connector; protect or upsize` });
  F.push({ name: 'Column base, cap and splice', count: 'each column per floor', cover: a, ok: true,
    note: 'usually within the floor build-up; protect any exposed steel for the rating' });
  F.push({ name: 'CLT-to-beam screws', count: 'along each beam', cover: a, ok: true,
    note: 'driven from above; tips must stop a_eff above exposed beam faces' });
  return F;
}
