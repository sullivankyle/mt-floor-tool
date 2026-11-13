import type { Catalog } from '../engine/types';
import panels from './panels.json';
import glulam from './glulam.json';
import costs from './costs.json';
import mfrs from './manufacturers.json';
import sites from './sites.json';
import sections from './sections.json';

const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_'))) as T;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** A fresh, editable copy of the default catalog (concept defaultCatalog()). */
export function defaultCatalog(): Catalog {
  return clone({
    panels: panels.panels,
    gl: glulam.gl,
    glW: glulam.widthFactor,
    inst: strip(costs.inst), conn: strip(costs.conn), frt: strip(costs.frt), logi: strip(costs.logi),
    mfrs: mfrs.mfrs,
    sites: sites.sites,
  }) as unknown as Catalog;   // JSON tuples widen to arrays; shapes are checked by tests
}

/** Standard glulam sections. All in in. */
export const PWS: number[] = sections.purlinWidths;
export const GWS: number[] = sections.girderWidths;
export const DEP: number[] = [];
for (let d = sections.depth.min; d <= sections.depth.max; d += sections.depth.step) DEP.push(d);
export const COLS: [number, number][] = sections.columns as [number, number][];
/** Auto-sizing limits beam depth to this multiple of width (-). */
export const MAXDB: number = sections.maxDepthToWidth;
