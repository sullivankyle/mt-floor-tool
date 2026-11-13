/**
 * Shared types for the calc engine. Units are US customary throughout and are
 * stated on every field. "per ft" means per foot of panel width.
 */

export type SystemType = 'T1' | 'T2' | 'T3'; // T1 CLT on girders; T2 CLT on flush purlins; T3 purlins over dropped girders
export type SystemFilter = 'all' | SystemType | 'T23';
export type Objective = 'cost' | 'depth' | 'vol' | 'picks' | 'freq';
export type Method = 'ASD' | 'LRFD';

/** PRG 320 Table A1 lamination values, one direction. Stresses psi, E 10^6 psi. */
export interface LamValues { Fb: number; E: number; Ft: number; Fc: number; Fv: number; Fs: number }
export interface LamGrade { major: LamValues; minor: LamValues }

/** CLT panel catalog entry. EI, FbS, GA, Vs, t, pl are filled from the layup (or override) by resolvePanels. */
export interface Panel {
  on: boolean;
  grade: string;      // PRG 320 grade, e.g. 'E1', 'V2'
  name: string;
  layers: number[];   // lamination thicknesses bottom to top, in.; alternating L/T starting with L
  override?: { EI?: number; FbS?: number; GA?: number; Vs?: number; src?: string } | null;
  t: number;          // thickness, in.
  pl: number;         // number of plies (-)
  EI: number;         // effective bending stiffness, major direction, 10^6 lbf-in^2/ft
  FbS: number;        // effective moment capacity (ASD reference), lbf-ft/ft
  GA: number;         // effective shear stiffness, 10^6 lbf/ft
  Vs: number;         // rolling shear capacity (ASD reference), lbf/ft
  pcf: number;        // density, lb/ft^3
  cost: number;       // supply price, $/ft^3
  real: boolean;      // true = computed from published lamination values or published panel values
  src: string;
}

/** Glulam stress class for bending members (NDS Supplement Table 5A). Stresses psi, E 10^6 psi. */
export interface BeamGrade { name: string; Fbp: number; Fbn: number; Fcperp: number; Fv: number; Extrue: number; Ex: number; Exmin: number; src: string; verified: boolean }
/** Glulam combination for axial members (NDS Supplement Table 5B). Stresses psi, E 10^6 psi. */
export interface ColumnGrade { name: string; Fc: number; Fcperp: number; E: number; Emin: number; src: string; verified: boolean }

/** Glulam selections and pricing. */
export interface Glulam {
  beamGrade: string;            // BeamGrade.name for purlins and girders
  colGrade: string;             // ColumnGrade.name for columns
  balancedContinuous: boolean;  // continuous beams specified balanced (Fbx- = Fbx+, Table 5A footnote 1)
  pcf: number;                  // density, lb/ft^3
  cost: number;                 // $/ft^3 for a 6 3/4 in. wide member
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
  lams: Record<string, LamGrade>;
  gl: Glulam;
  glGrades: { beams: BeamGrade[]; columns: ColumnGrade[] };
  glW: Record<string, number>;   // price factor by member width (in.), keyed as string
  inst: { crew: number; pPanel: number; pBeam: number; pCol: number };           // $/hr; picks/hr
  conn: { pur: number; bear: number; gir: number; col: number };                 // $ each
  frt: { rate: number; payload: number; osPct: number; fixed: number; broker: number; tarCAUS: number; tarUSCA: number }; // $/mi, lb, %, $/load, $/load, %, %
  logi: { panW: number; panMax: number };                                        // ft, ft
  connGeom: { concealedW: number; src?: string; verified?: boolean };            // concealed connector width, in.
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
  LLd: number;       // design live load, psf (unreduced)
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
  method: Method;    // ASD or LRFD (NDS 2018 with ASCE 7-22 combinations)
  panelCont: 'simple' | 'cont';   // CLT designed simple span, or continuous over the spans it is shipped across (max 3)
  purlinCont: 'simple' | 'two';   // T3 purlins two-span over the middle girder (needs 2 bays each side)
  llr: boolean;      // ASCE 7-22 §4.7 live load reduction
  Ke: number;        // column effective length factor (-), NDS Appendix G
  cltFallOff: boolean; // CLT char model with lamination fall-off (NDS 16.2-3)
  colExp: 3 | 4;     // column faces exposed to fire
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

/**
 * Utilizations (demand/capacity, -). b bending, v shear, dl live deflection, dt long-term total deflection,
 * f fire, br bearing (0 = not checked).
 */
export interface Util { b: number; v: number; dl: number; dt: number; f: number; br: number }

/** Inputs that member checks need besides geometry: design method and fire. */
export interface DesignBasis {
  method: Method;
  fire: number;          // required fire resistance, hours (0 to 2)
  cltFallOff: boolean;   // CLT char with lamination fall-off (NDS eq. 16.2-3) or without (16.2-2)
  colExp: 3 | 4;         // column faces exposed to fire
}

export const basisOf = (o: Inputs): DesignBasis =>
  ({ method: o.method, fire: o.fire, cltFallOff: o.cltFallOff !== false, colExp: o.colExp === 3 ? 3 : 4 });
