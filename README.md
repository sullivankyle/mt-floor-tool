# Mass timber floor system study tool

Personal side project, not for design. A static web app that sizes CLT floors on glulam purlins and girders, checks strength, fire and vibration, counts quantities and crane picks, prices delivered supply from several manufacturers, and ranks the options.

## Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # engine tests (golden files and guide examples)
npm run build      # type check, then a single self-contained dist/index.html
```

**To just use the tool, double-click `mt-floor-tool.html`** in the repo root. It is the single-file build (all JS and CSS inlined), refreshed by every `npm run build`. The root `index.html` is the source page; it only runs through `npm run dev`, and it says so if opened from disk.

## Layout

| Path | What |
|---|---|
| `src/engine/` | Calc engine. Pure functions, no DOM, US customary units, documented on each function. `loads` (combinations, live load reduction), `beam` (continuous spans), `clt`, `glulam`, `fire`, `columns`, `vibration`, `system` (one bay), `logistics`, `cost`, `optimizer`. |
| `src/data/` | Catalog data as JSON (panels, glulam, manufacturers, sites, costs, sections) and `catalog.ts`, which assembles it. |
| `src/ui/` | Page rendering and events. Ported verbatim from the concept; not type-checked yet (`@ts-nocheck`). |
| `tests/` | Vitest. `golden.test.ts` checks the engine against the original concept for 5 reference cases. `guide-examples.test.ts` holds the vibration guide's worked examples. |
| `concept/` | The original single-file concept (v7). Golden files are generated from it. |
| `refs/` | Code references (git-ignored). |
| `ASSUMPTIONS.md` | Every simplification and placeholder, with its code location. |

## Golden files

- `tests/golden/concept-v7/` holds the original concept's outputs for the 5 cases in `tests/golden/cases.mjs` (every sized design with its checks, quantities and pricing). `npm run golden` regenerates them by loading `concept/vibration-concept.html` in jsdom. Phase 1 matched them exactly.
- `tests/golden/engine/` holds snapshots of the current engine, which `npm test` checks. After an intended change in results, run `npm run golden:update` and say why in the commit.
- `npm run compare:concept` prints how each case's best design differs from the concept.

## Design basis (Phase 2)

NDS 2018 with ASCE 7-22 gravity combinations, selectable ASD or LRFD. CLT properties are computed from the layup (PRG 320-2019 Appendix X3); glulam values come from NDS Supplement Tables 5A and 5B. Panels and two-span purlins are analysed as continuous beams with pattern live load. Live load reduction follows ASCE 7-22 §4.7. See `ASSUMPTIONS.md` for everything simplified.

## Fire (Phase 3)

NDS 2018 Chapter 16 with ratings up to 2 hours. Effective char a_eff = 1.2 a_char. CLT chars from the soffit with or without lamination fall-off (eq. 16.2-3 or 16.2-2), and its residual section is computed from the actual layup. Glulam beams are exposed on 3 sides and columns on 3 or 4. Strengths use the Table 16.2.2 factors, with CL and CP recomputed on the reduced section. Connection protection (16.3) is screened by member width against the effective char depth.

## Vibration (Phase 4)

The WoodWorks guide's §4.3 modal response analysis: resonant peak acceleration (CCIP-016 harmonics, walking-frequency sweep, frequency weighting) and transient RMS velocity (effective impulse, 1/3-octave bands). The response calculations reproduce the guide's three worked examples from their published modal data. Modes for each design are estimated in closed form: orthotropic plate panel modes and a combined bay mode. They are not FEM results, so confirm a final design with a model (see `docs/handoff-fem.md`). Toppings and CLT-to-beam composite action follow §3.3.5 and §3.4. The AISC DG 11 walking formula remains available as an option.

## Projects and report (Phase 6)

- **Save project / Open project** (top of the page) writes and reads one JSON file with the inputs, every catalog edit, runs, the pinned design and the report header.
- **Catalog tab:** manufacturer data shows a published (green) or assumed (orange) flag for press size, grades and glulam, and the whole list can be edited as JSON (validated before it is applied).
- **Report:** ends with a calc package for the design shown: every check with its equation, values, utilization and code reference.

## Why TypeScript

The engine passes many numbers that look alike (psf vs plf, in. vs ft, values in units of 10^6). Typed inputs and results, with units noted on every field, catch mix-ups while the code is restructured, at no runtime cost.
