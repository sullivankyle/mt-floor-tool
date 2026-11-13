/**
 * Exchange with the FEM vibration engine (separate Python + CalculiX tool, ../vib-engine).
 * Contract: vib-engine/docs/integration.md and fem_engine/design.schema.json.
 *   1. exportDesign -> design JSON; the user runs `python fem_engine/run.py design.json results.json`.
 *   2. parseFemResults reads results JSON; femStale says whether it still matches the current design.
 * The FEM result is a verification run beside this tool's checks; it never changes them.
 */
import type { Catalog, Cfg, Inputs, Panel } from '../engine/types';
import type { DesignResult } from '../engine/cost';
import { defaultCatalog } from './catalog';

/** Design keys that define the run (integration.md section 1). */
export const FEM_KEYS = ['sys', 'n', 'pi', 'pw', 'pd', 'gw', 'gd', 'A', 'B', 'LLv', 'sdl', 'damp'] as const;

export interface FemDesign {
  sys: Cfg['sys']; n: number; pi: number; pw: number; pd: number; gw: number; gd: number;
  A: number; B: number; LLv: number; sdl: number; damp: number;
  fw_range: [number, number];
  panel?: { name: string; t: number; pl: number; EI: number; GA: number; pcf: number; grade: string };
  source: { app: 'mt-floor-tool'; exported: string; notes: string[] };
}

/**
 * Design JSON for the engine. The panel is always sent explicitly: this tool computes panel properties from the
 * layup (Phase 2), so they differ slightly from the concept catalog the engine indexes by `pi`.
 * The topping's weight is added to sdl (the engine models mass only); its stiffness is not sent.
 */
export function exportDesign(o: Inputs, cat: Catalog, r: DesignResult, fwMin: number, fwMax: number, now = new Date()): FemDesign {
  const c = r.cfg, P: Panel = cat.panels[c.pi], notes: string[] = [];
  if (r.topPsf > 0) notes.push(`sdl includes ${r.topPsf.toFixed(1)} psf of ${o.topType} topping; its stiffness and composite action are not modelled by the engine.`);
  if (o.beamGamma > 0) notes.push('CLT-to-beam composite action credited in this tool is not sent to the engine.');
  if (r.nPan > 1 || r.purSpans > 1) notes.push('Continuity in this tool comes from panel and purlin lengths; the engine models its own 3 x 3 bay patch.');
  if (c.sys !== 'T2') notes.push(`The engine schema (design.schema.json) lists T2 only; the integration note says T1, T2 and T3. Check the engine accepts ${c.sys}.`);
  return {
    sys: c.sys, n: Math.max(1, c.n), pi: c.pi,
    pw: c.pw as number, pd: c.pd as number, gw: c.gw, gd: c.gd as number,
    A: o.A, B: o.B, LLv: o.LLv, sdl: +(o.sdl + r.topPsf).toFixed(3), damp: o.damp,
    fw_range: [+fwMin.toFixed(3), +fwMax.toFixed(3)],
    panel: { name: P.name, t: P.t, pl: P.pl, EI: P.EI, GA: P.GA, pcf: P.pcf, grade: P.grade },
    source: { app: 'mt-floor-tool', exported: now.toISOString(), notes },
  };
}

export interface FemResults {
  engine: { name: string; version: string; solver?: string; method?: string; runtime_s?: number };
  input: Record<string, unknown>;
  summary: {
    f1_Hz: number; f1_centre_bay_Hz?: number; ap_fw_pct_g: number; ap_pct_g?: number; fw_at_peak_Hz?: number;
    R_acc?: number; vrms_fw_mips?: number; R_vel?: number; worst_point_in_bay_ft?: [number, number];
    governing_check?: string; resonant_cutoff_Hz?: number;
  };
  points?: Record<string, { ap_fw_pct_g?: number; vrms_fw_mips?: number }>;
  hand_method?: { wE?: number; f_panel?: number; f_purlin?: number; f_girder?: number; f_dunkerley?: number; W_lbf?: number; ap_pct_g?: number };
  modes?: { mode: number; f_Hz: number; modal_mass_lbf_s2_in: number; phi_center?: number }[];
  derived?: Record<string, unknown>;
  warnings?: string[];
  units?: Record<string, string>;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown) => typeof x === 'number' && isFinite(x);

/** Parses and checks an engine results file. Throws with a readable message. */
export function parseFemResults(text: string): FemResults {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new Error('Not a JSON file.'); }
  if (!isObj(j) || !isObj(j.engine) || j.engine.name !== 'fem_engine') throw new Error('Not a results file from fem_engine (engine.name missing).');
  if (!isObj(j.input)) throw new Error('Results file has no input block, so it cannot be matched to a design.');
  if (!isObj(j.summary) || !num(j.summary.f1_Hz) || !num(j.summary.ap_fw_pct_g)) throw new Error('Results file summary is missing f1_Hz or ap_fw_pct_g.');
  if (j.modes !== undefined && !Array.isArray(j.modes)) throw new Error('modes must be a list.');
  if (j.warnings !== undefined && !Array.isArray(j.warnings)) throw new Error('warnings must be a list.');
  return j as unknown as FemResults;
}

/** Keys on which the results' input differs from the design (integration.md: match on input, not file name). */
export function femStale(res: FemResults, d: FemDesign): string[] {
  const diff: string[] = [], inp = res.input;
  const ignore = new Set<string>(d.sys === 'T1' ? ['n', 'pw', 'pd'] : []);
  for (const k of FEM_KEYS) {
    if (ignore.has(k)) continue;
    const a = inp[k], b = (d as unknown as Record<string, unknown>)[k];
    if (k === 'damp' && a === undefined) continue;   // carried for Stage 2; older runs may omit it
    if (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b)) : a !== b) diff.push(k);
  }
  const ip = inp.panel;
  if (isObj(ip) && d.panel) for (const k of ['t', 'EI', 'GA', 'pcf'] as const) {
    if (num(ip[k]) && Math.abs((ip[k] as number) - d.panel[k]) > 1e-6 * Math.max(1, Math.abs(d.panel[k]))) diff.push('panel.' + k);
  }
  if (!isObj(ip) && d.panel) {
    // The run used the engine's catalog panel `pi`; compare it with ours (ours is computed from the layup).
    const ref = defaultCatalog().panels[d.pi];
    if (ref && ref.name !== d.panel.name) diff.push('panel');
  }
  return diff;
}

/**
 * Reasons a design should be checked with FEM (findings from vib-engine fem_engine/VALIDATION.md sections 5 and 9,
 * which compare the DG 11-style hand method with FEM): T1 and light 3-ply T2 bays came out 10 to 15% unconservative;
 * T3 responded about 30% more than the same members flush; and any result within 20% of the limit.
 * @param ratio governing vibration demand / limit for this tool's own check (0 if none)
 */
export function needsFem(r: DesignResult, ratio: number): string[] {
  const why: string[] = [];
  if (r.cfg.sys === 'T1') why.push('CLT on girders: hand methods came out 10 to 15% unconservative against FEM.');
  if (r.cfg.sys === 'T2' && r.P.pl <= 3) why.push('Light 3-ply panel on flush purlins: hand methods came out 10 to 15% unconservative against FEM.');
  if (r.cfg.sys === 'T3') why.push('Dropped girders responded about 30% more in FEM than the same members flush; hand methods do not tell them apart.');
  if (ratio >= 0.8 && ratio <= 1.2) why.push(`Vibration response is ${Math.round(ratio * 100)}% of the limit (within 20%${ratio > 1 ? '; FEM may show it passes' : ''}).`);
  return why;
}
