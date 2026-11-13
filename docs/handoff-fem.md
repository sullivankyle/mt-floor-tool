# Handoff: open-source FEM engine for floor vibration (Stage 1)

Paste the prompt below into a **Claude Code** session (it installs CalculiX and Python packages and runs scripts). Attach `vibration-concept.html` and the WoodWorks *U.S. Mass Timber Floor Vibration Design Guide* (2023) PDF. If you are using the `mt-floor-tool` repo from the build-out handoff, save this file as `docs/handoff-fem.md`, put the engine in `fem_engine/` at the repo root, and leave `concept/` and `src/` alone.

Scope is deliberately small: one bay, eigen analysis only, one pass/fail gate. Stage 2 is listed at the bottom and waits for a go-ahead.

---

## Prompt to paste

I'm building a web tool for mass timber floor vibration design (concept HTML attached). It currently uses the WoodWorks Mass Timber Floor Vibration Design Guide's simple hand method: simple-span frequencies combined by Dunkerley, plus a DG 11-style walking acceleration placeholder. This is a personal concept project, not a product, so licensing is not a concern right now. I want a free, open-source FEM engine for "verification runs" on a few designs per project.

**Goal for this session (Stage 1):** a Python prototype that takes one bay design as JSON and returns modal results as JSON, and a check that its frequencies agree with the guide's FEM worked example. Keep it small. Stop at the gate below.

**Keep token use low.** Do not read the whole HTML or the whole PDF. From the HTML, read only: `defaultCatalog` (panel and glulam properties), `psfOf`, `freqFromDefl`, `dunkerley`, `stripDeflection`, and `evalStructure` (the design object and the hand-method frequency calc). From the PDF, read only the FEM worked examples (the earlier plan cited Chapters 8 and 9, the 24F-V4 glulam / 3-ply V2 CLT examples; confirm in the PDF) and the FEM modeling guidance they rely on. Keep replies short and skip narration between steps.

1. **Setup.** Install CalculiX (`ccx`) with your package manager (apt `calculix-ccx`, conda-forge `calculix`, or similar) and numpy/scipy. Run a trivial cantilever eigen job to confirm the toolchain works before building anything else.
2. **Model (one bay only):**
   - CLT as an orthotropic shell using an equivalent single layer from the panel's `EI` (lbf-in^2/ft x 10^6), `GA` (lbf/ft x 10^6) and thickness, as stored in the HTML catalog. In the HTML's `T2` system the panel spans between purlins (span A / n, along A), so the strong direction runs along A, perpendicular to the purlins, which span B. Confirm this against the guide's example before relying on it. For the minor direction, use the guide's approach; if it gives none, state your assumption.
   - Flush purlins (the HTML's system `T2`: purlins hung from girders, tops level with girder tops): glulam beam elements offset below the shell, purlin ends pinned to the girders (translations tied, rotations free).
   - Girders: glulam beam elements along A, offset below the shell, pinned at the columns. Columns are pinned supports at the four corners.
   - Mass = panel self weight + superimposed dead + vibration live load (`LLv`), the same quantities the HTML uses in its `wE`, plus member self weight. Convert weight to mass with g = 386.1 in/s^2 so the units stay consistent.
3. **Eigen analysis:** first 10 modes. Report frequency, generalized (modal) mass and the mode shape value at bay center, as JSON.
4. **Input JSON** matches the HTML design object: `sys`, `n`, panel index (`pi`), purlin width and depth (`pw`, `pd`), girder width and depth (`gw`, `gd`), `A`, `B`, loads (`LLv`, `sdl`), `damp`. Write a short `design.schema.json`.
5. **Gate (do this before anything else):**
   - Reproduce the frequencies of the guide's FEM worked example. Pick the one closest to a single bay on flush purlins and say which. Target: within 5%.
   - Then run the same bay through the HTML hand method (`evalStructure`) and show both side by side: panel, purlin and girder simple-span frequencies, Dunkerley floor frequency, and the FEM fundamental. Explain the differences; do not tune the FEM to match the hand method.
6. **Deliverables:** `fem_engine/` with `model.py` (writes the `.inp`), `solve.py` (runs `ccx`, parses modal output to JSON), `validate.py`, `design.schema.json`, a short README (how to run, assumptions, units), and a half-page validation note with the comparison table.

**Stop after the gate** and report: did the frequency land within 5%, what are the biggest differences from the hand method, and what do you recommend for Stage 2. Ask before starting Stage 2, and ask before adding any web backend.

---

## Stage 2 (only after the Stage 1 gate passes and Kyle says go)

- Walking response by modal superposition in numpy/scipy, following the guide's FEM-based procedure (resonant response for low-frequency floors, transient for high-frequency). Peak acceleration (% g) or response factor at bay center and quarter points.
- Reproduce the guide's second worked example, targeting accelerations within 15%.
- Dropped-girder case (`T3`: purlins bearing on top of girders), CLT on girders only (`T1`), 3 x 3 bay patch, layered composite shell (needs E0, E90 = E0/30, G = E0/16 and rolling shear per lamination, which the HTML catalog does not store).
- Compare against the hand method for 5 bays and explain the differences.

---

## Background

- **Can open source do vibration design?** It can do the analysis: modal (eigen) analysis and time-history or modal-superposition response. It has no built-in timber vibration code check, so the acceptance criteria (guide, DG 11, CCIP-016) are written in Python on top of the solver.
- **Precedent:** the European STROBE project built a floor vibration tool with a Python pre- and post-processor and CalculiX as the eigen solver, validated against design guide P354.
- **Solver choice:** CalculiX (GPL), run as a separate process. OpenSeesPy is an option for quick cross-checks. Licensing only matters if this is ever sold or offered as a paid service: OpenSees would need a commercial license from UC Berkeley, and CalculiX's GPL needs a quick legal read. Not needed for the concept stage.
- **Validation data:** the guide's worked FEM examples; WoodWorks case studies; published measured CLT floor tests (for example, the 2025 Journal of Building Engineering paper by Cheraghi-Shirazi, Malek et al., with Degenkolb, on timber composite floors).
- **Relation to the web app build-out:** the Claude Code build-out handoff (Phase 4) re-implements the guide's own methods in JavaScript. This FEM engine is a separate Python tool for verification runs and should not modify that code.
