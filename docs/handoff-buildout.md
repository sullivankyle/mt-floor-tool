# Handoff: Claude Code build-out of the mass timber floor system tool

## Set up first (about 10 minutes)

1. Create a **private** Git repo (references below must not be public), e.g. `mt-floor-tool`.
2. Add these files:
   - `concept/vibration-concept.html` (latest version, v7)
   - `refs/` (git-ignore this folder if you'd rather not commit the PDFs):
     - WoodWorks *U.S. Mass Timber Floor Vibration Design Guide* (2023)
     - NDS 2024 and NDS Supplement
     - PRG 320-2019
     - Kalesnikoff APA PR-L332
     - AISC DG 11 (optional)
     - any manufacturer product reports you have
   - `docs/handoff-fem.md` (the FEM handoff in this project, for later)
3. Open Claude Code in the repo and paste the prompt below.

---

## Prompt to paste into Claude Code

You're taking over a working concept tool: `concept/vibration-concept.html`, a single-file web app for mass timber floor system studies (CLT on girders, CLT on flush purlins, and purlins over dropped girders). It sizes members, checks strength, fire and vibration, counts quantities and picks, prices with freight and tariffs from 13 manufacturers, ranks designs, compares grids, and prints a report. Read it fully before changing anything. It is a personal side project, not production. I want it taken as far as possible with real calcs; perfect accuracy isn't required, but every simplification must be listed. Code references are in `refs/`; use them directly and cite section numbers in code comments.

**Ground rules**
- Keep it a static web app (no backend yet) that opens from a file or a simple static host.
- Separate the calc engine (pure functions, no DOM) from the UI and from the data.
- Every calc module gets tests. The guide's worked examples are the first tests, and they must keep passing.
- Units: US customary internally; document units on every function.
- Keep `ASSUMPTIONS.md` updated: one line per simplification or placeholder, with a code reference.
- Commit after each phase with a clear message. Stop and summarize at the end of each phase.

**Phase 1: restructure (no behavior change)**
- Vite + vanilla JS or TypeScript (your call; explain why). Structure: `src/engine/` (clt, glulam, fire, vibration, columns, optimizer, cost, logistics), `src/data/` (panels, glulam grades, manufacturers, sites, costs as JSON), `src/ui/`, `tests/`.
- Port the concept so the output matches it exactly for 5 saved reference cases (store them as golden-file tests).

**Phase 2: real member design (NDS)**
- ASD and LRFD selectable; load combinations from ASCE 7.
- Glulam: reference values by stress class from the NDS Supplement; CD, CM, Ct, CL (beam stability with the CLT bracing assumption stated), Cv per NDS 5.3.6 (lesser of CL and Cv), Kcr creep deflection, bearing.
- CLT: properties computed from the layup by the shear analogy (PRG 320 Annex), so custom layups and product-report values can both be entered. Bending, rolling shear and deflection with shear deformation. One-span, two-span and continuous panels.
- Columns: NDS 3.7 with real Fc, Emin and grades; multi-floor loads with live load reduction (ASCE 7 4.7).
- Purlins: simple and two-span over dropped girders.

**Phase 3: fire (NDS Chapter 16)**
- Char rate, effective char, zero-strength layer, and 3-sided and 4-sided exposure.
- CLT layer-by-layer char, including lamination fall-off, from the NDS and PRG 320 provisions.
- Connection protection flag.

**Phase 4: vibration (the guide)**
- Implement the guide's own methods in full: frequency methods, and its acceleration / response-factor procedures for the floor types it covers. Replace the DG 11 placeholder, but keep it as an option.
- Effect of support stiffness, continuity and topping. Reproduce every worked example in the guide as a test.

**Phase 5: connections (screening level)**
- Capacity tables for common hangers and bearing details by reaction; screw count estimate; cost from count. Flag when the reaction exceeds the screening table.

**Phase 6: data and UI polish**
- Manufacturer data as editable JSON with source and verified/assumed flags.
- Save and load projects (JSON download/upload).
- Report: add a calc-package appendix showing every check with its equation and code reference.

At the start, read the concept and the references, then give me a short plan for Phase 1 and any questions before writing code.

---

## Notes for later
- FEM verification engine: see `docs/handoff-fem.md` (CalculiX recommended; OpenSees needs a commercial license for a paid product).
- Validation set: 10 to 20 WoodWorks Innovation Network or Kingworks projects with known grids, member sizes and costs.
