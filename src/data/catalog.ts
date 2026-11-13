import type { Catalog, Inputs } from '../engine/types';
import { resolvePanels } from '../engine/clt';
import panels from './panels.json';
import glulam from './glulam.json';
import lams from './laminations.json';
import costs from './costs.json';
import mfrs from './manufacturers.json';
import sites from './sites.json';
import sections from './sections.json';
import conn from './connections.json';

const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_'))) as T;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** A fresh, editable copy of the default catalog, with CLT properties computed from the layups. */
export function defaultCatalog(): Catalog {
  const cat = clone({
    panels: panels.panels,
    lams: lams.grades,
    gl: glulam.gl,
    glGrades: { beams: glulam.beamGrades, columns: glulam.columnGrades },
    glW: glulam.widthFactor,
    inst: strip(costs.inst), conn: strip(costs.conn), frt: strip(costs.frt), logi: strip(costs.logi),
    mfrs: mfrs.mfrs,
    sites: sites.sites,
    connGeom: conn.connGeom,
  }) as unknown as Catalog;   // JSON tuples widen to arrays; shapes are checked by tests
  resolvePanels(cat.panels, cat.lams);
  return cat;
}

/** Defaults for the Phase 2 design-basis inputs (merged into older saved inputs). */
export const DESIGN_DEFAULTS: Pick<Inputs, 'method' | 'panelCont' | 'purlinCont' | 'llr' | 'Ke' | 'cltFallOff' | 'colExp'> =
  { method: 'ASD', panelCont: 'cont', purlinCont: 'two', llr: true, Ke: 1.0, cltFallOff: true, colExp: 4 };

/** Standard glulam sections. All in in. */
export const PWS: number[] = sections.purlinWidths;
export const GWS: number[] = sections.girderWidths;
export const DEP: number[] = [];
for (let d = sections.depth.min; d <= sections.depth.max; d += sections.depth.step) DEP.push(d);
export const COLS: [number, number][] = sections.columns as [number, number][];
/** Auto-sizing limits beam depth to this multiple of width (-). */
export const MAXDB: number = sections.maxDepthToWidth;
