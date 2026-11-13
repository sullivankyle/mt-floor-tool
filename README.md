# Mass timber floor system study tool

Personal side project, not for design. A static web app that sizes CLT floors on glulam purlins and girders, checks strength, fire and vibration, counts quantities and crane picks, prices delivered supply from several manufacturers, and ranks the options.

## Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # engine tests (golden files and guide examples)
npm run build      # type check, then a single self-contained dist/index.html
```

`dist/index.html` opens straight from the file system; all JS and CSS are inlined.

## Layout

| Path | What |
|---|---|
| `src/engine/` | Calc engine. Pure functions, no DOM, US customary units, documented on each function. `clt`, `glulam`, `fire`, `columns`, `vibration`, `system` (one bay), `logistics`, `cost`, `optimizer`. |
| `src/data/` | Catalog data as JSON (panels, glulam, manufacturers, sites, costs, sections) and `catalog.ts`, which assembles it. |
| `src/ui/` | Page rendering and events. Ported verbatim from the concept; not type-checked yet (`@ts-nocheck`). |
| `tests/` | Vitest. `golden.test.ts` checks the engine against the original concept for 5 reference cases. `guide-examples.test.ts` holds the vibration guide's worked examples. |
| `concept/` | The original single-file concept (v7). Golden files are generated from it. |
| `refs/` | Code references (git-ignored). |
| `ASSUMPTIONS.md` | Every simplification and placeholder, with its code location. |

## Golden files

`npm run golden` loads `concept/vibration-concept.html` in jsdom, runs the 5 cases in `tests/golden/cases.mjs`, and writes `tests/golden/cases/*.json` (every sized design with its checks, quantities and pricing). Rerun it only if the concept changes. When a later phase changes results on purpose, update the expectations in the same commit and say why.

## Why TypeScript

The engine passes many numbers that look alike (psf vs plf, in. vs ft, values in units of 10^6). Typed inputs and results, with units noted on every field, catch mix-ups while the code is restructured, at no runtime cost.
