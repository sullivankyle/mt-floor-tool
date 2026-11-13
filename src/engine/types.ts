/**
 * Shared types for the calc engine. Units are US customary throughout and are
 * stated on every field. "per ft" means per foot of panel width.
 */

export type SystemType = 'T1' | 'T2' | 'T3'; // T1 CLT on girders; T2 CLT on flush purlins; T3 purlins over dropped girders
export type SystemFilter = 'all' | SystemType | 'T23';
export type Objective = 'cost' | 'depth' | 'vol' | 'picks' | 'freq';

/** CLT panel catalog entry. */
export interface Panel {
  on: boolean;
  grade: string;      // PRG 320 grade, e.g. 'E1', 'V2'
  name: string;
  t: number;          // thickness, in.
  pl: number;         // number of plies (-)
  EI: number;         // effective bending stiffness, 10^6 lbf-in^2/ft
  FbS: number;        // effective moment capacity (ASD reference), lbf-ft/ft
  GA: number;         // effective shear stiffness, 10^6 lbf/ft
  Vs: number;         // rolling shear capacity (ASD reference), lbf/ft
  pcf: number;        // density, lb/ft^3
  cost: number;       // supply price, $/ft^3
  real: boolean;      // true = published value, false = placeholder/derived
  src: string;
}

/** Generic glulam properties (one grade for all members in the concept). */
export interface Glulam {
  E: number;     // modulus of elasticity, 10^6 psi
  Fb: number;    // reference bending stress, psi
  Fv: number;    // reference shear stress, psi
  Fc: number;    // reference compression parallel to grain, psi
  Emin: number;  // stability modulus, 10^6 psi
  pcf: number;   // density, lb/ft^3
  cost: number;  // $/ft^3 for a 6 3/4 in. wide member
}

export interface Manufacturer {
  on: boolean;
  name: string;
  plant: string;
  ll: [number, number];  // [lat, lon], degrees
  c: 'US' | 'CA';
  clt: { w: number; L: number; t: number; known: boolean } | null; // max press width ft, length ft, thickness in.
  gl: boolean;
  grades: string[] | null;
  pf: number;            // price factor on material (-)
  other?: string;
  src: string;
}

export type Site = [number, number, 'US' | 'CA']; // [lat deg, lon deg, country]

export interface Catalog {
  panels: Panel[];
  gl: Glulam;
  glW: Record<string, number>;   // price factor by member width (in.), keyed as string
  inst: { crew: number; pPanel: number; pBeam: number; pCol: number };           // $/hr; picks/hr
  conn: { pur: number; bear: number; gir: number; col: number };                 // $ each
  frt: { rate: number; payload: number; osPct: number; fixed: number; broker: number; tarCAUS: number; tarUSCA: number }; // $/mi, lb, %, $/load, $/load, %, %
  logi: { panW: number; panMax: number };                                        // ft, ft
  mfrs: Manufacturer[];
  sites: Record<string, Site>;
}

/** Members fixed by the user; null = let the optimizer choose. */
export interface Fix {
  n: number | null; pi: number | null; pw: number | null; pd: number | null; gw: number | null; gd: number | null; ci: number | null;
}

/** Study inputs (the sidebar). */
export interface Inputs {
  layout: 'corr' | 'bay';
  nb: number;        // bays each side of the corridor (-)
  Wc: number;        // corridor width, ft
  A: number;         // column spacing along corridor = girder span, ft
  B: number;         // bay depth = purlin span (or CLT span for T1), ft
  sysF: SystemFilter;
  LLd: number;       // design live load, psf
  LLv: number;       // live load counted for vibration, psf
  sdl: number;       // superimposed dead load, psf
  stories: number;   // floors carried by each column (-)
  H: number;         // story height, ft
  fire: number;      // fire resistance, hours (0, 1, 2)
  maxD: number;      // max structural depth, in. (0 = no limit)
  maxPick: number;   // heaviest crane pick, kip (0 = no limit)
  appear: number;    // CLT appearance price factor (-)
  site: string;
  sup: string;       // 'auto' or manufacturer index as string
  split: boolean;    // allow separate glulam supplier
  target: number;    // minimum floor frequency, Hz
  alim: number;      // peak acceleration limit, % g
  damp: number;      // damping ratio (-), e.g. 0.03
  obj: Objective;
  fix: Fix;
}

/** One design configuration. Member sizes in in. */
export interface Cfg {
  sys: SystemType;
  n: number;          // purlins per bay (0 for T1)
  pi: number;         // panel index into catalog
  pw?: number;        // purlin width, in.
  pd?: number;        // purlin depth, in.
  gw: number;         // girder width, in.
  gd?: number;        // girder depth, in.
  ci?: number | null; // column index into COLS, null = auto-size
}

/** Utilizations (demand/capacity, -). b bending, v shear, dl live defl, dt total defl, f fire. */
export interface Util { b: number; v: number; dl: number; dt: number; f: number }
