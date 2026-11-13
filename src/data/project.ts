/**
 * Project files: everything needed to reopen a study (inputs, the edited catalog, runs, the pinned design and the
 * report header) as one JSON document. Pure functions; the UI handles download and upload.
 */
import type { Catalog, Cfg, Inputs, Manufacturer } from '../engine/types';
import { resolvePanels } from '../engine/clt';
import { defaultCatalog, DESIGN_DEFAULTS } from './catalog';

export const PROJECT_APP = 'mt-floor-tool';
export const PROJECT_VERSION = 1;

export interface Run { label: string; o: Inputs; cfg: Cfg }
export interface Project {
  app: typeof PROJECT_APP; version: number; saved: string;
  name: string; by: string;
  inputs: Inputs; catalog: Catalog; runs: Run[]; pinned: Cfg | null;
}

export function makeProject(p: Omit<Project, 'app' | 'version' | 'saved'>, now = new Date()): Project {
  return { app: PROJECT_APP, version: PROJECT_VERSION, saved: now.toISOString(), ...JSON.parse(JSON.stringify(p)) };
}

/** Fills design-basis fields added after a file was saved. */
export const withDefaults = (o: Inputs): Inputs =>
  ({ ...DESIGN_DEFAULTS, ...o, fix: Object.assign({ n: null, pi: null, pw: null, pd: null, gw: null, gd: null, ci: null }, o.fix || {}) });

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Saved catalog over the current defaults: objects merge key by key, arrays (panels, manufacturers) replace. */
export function mergeCatalog(saved: unknown): Catalog {
  const base = defaultCatalog() as unknown as Record<string, unknown>;
  if (isObj(saved)) for (const [k, v] of Object.entries(saved)) {
    if (!(k in base)) continue;
    base[k] = isObj(base[k]) && isObj(v) ? { ...(base[k] as object), ...v } : v;
  }
  const cat = base as unknown as Catalog;
  resolvePanels(cat.panels, cat.lams);
  return cat;
}

/** Checks a manufacturer list (Catalog tab JSON editor and project files). Returns error messages; empty = valid. */
export function validateMfrs(m: unknown): string[] {
  if (!Array.isArray(m)) return ['Manufacturers must be a JSON array.'];
  const e: string[] = [];
  m.forEach((x, i) => {
    const at = `#${i + 1}${isObj(x) && x.name ? ` (${x.name})` : ''}`;
    if (!isObj(x)) { e.push(`${at}: not an object`); return; }
    if (typeof x.name !== 'string' || !x.name) e.push(`${at}: name is required`);
    if (typeof x.plant !== 'string') e.push(`${at}: plant is required`);
    if (!Array.isArray(x.ll) || x.ll.length !== 2 || !x.ll.every(v => typeof v === 'number' && isFinite(v))) e.push(`${at}: ll must be [lat, lon]`);
    if (x.c !== 'US' && x.c !== 'CA') e.push(`${at}: c must be "US" or "CA"`);
    if (x.clt !== null && !(isObj(x.clt) && ['w', 'L', 't'].every(k => typeof (x.clt as Record<string, unknown>)[k] === 'number' && ((x.clt as Record<string, number>)[k]) > 0)))
      e.push(`${at}: clt must be null or { w, L, t } with positive numbers`);
    if (typeof x.gl !== 'boolean') e.push(`${at}: gl must be true or false`);
    if (x.grades !== null && !(Array.isArray(x.grades) && x.grades.every(g => typeof g === 'string'))) e.push(`${at}: grades must be null or a list of grade names`);
    if (!(typeof x.pf === 'number' && x.pf > 0)) e.push(`${at}: pf must be a positive number`);
  });
  return e;
}

/** Normalizes a validated manufacturer list (defaults for optional fields). */
export const normalizeMfrs = (m: Manufacturer[]): Manufacturer[] => m.map(x => Object.assign({ src: '' }, x, {
  on: x.on !== false,
  verified: Object.assign({ cltSize: !!(x.clt && x.clt.known), grades: x.grades != null, glulam: false }, x.verified),
}));

/** Parses and checks a project file. Throws with a readable message if it cannot be used. */
export function readProject(text: string): { project: Project; warnings: string[] } {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new Error('Not a JSON file.'); }
  if (!isObj(j) || j.app !== PROJECT_APP) throw new Error('Not a project file from this tool.');
  if (typeof j.version !== 'number' || j.version > PROJECT_VERSION) throw new Error(`Project file version ${String(j.version)} is newer than this tool (${PROJECT_VERSION}).`);
  if (!isObj(j.inputs)) throw new Error('Project file has no inputs.');
  const warnings: string[] = [];
  const catalog = mergeCatalog(j.catalog);
  const me = validateMfrs(catalog.mfrs);
  if (me.length) { warnings.push('Manufacturer list was invalid and has been reset: ' + me.slice(0, 3).join('; ')); catalog.mfrs = defaultCatalog().mfrs; }
  catalog.mfrs = normalizeMfrs(catalog.mfrs);
  const missing = Object.keys(DESIGN_DEFAULTS).filter(k => !(k in (j.inputs as object)));
  if (missing.length) warnings.push(`Saved before these inputs existed, so defaults were used: ${missing.join(', ')}.`);
  const runs = Array.isArray(j.runs) ? (j.runs as Run[]).filter(r => isObj(r) && isObj(r.o) && isObj(r.cfg)).map(r => ({ ...r, o: withDefaults(r.o) })) : [];
  const project: Project = {
    app: PROJECT_APP, version: PROJECT_VERSION, saved: String(j.saved ?? ''),
    name: String(j.name ?? ''), by: String(j.by ?? ''),
    inputs: withDefaults(j.inputs as unknown as Inputs), catalog, runs, pinned: isObj(j.pinned) ? (j.pinned as unknown as Cfg) : null,
  };
  return { project, warnings };
}
