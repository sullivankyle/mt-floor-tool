# Assumptions, simplifications and placeholders

One line per item, with the code location and the reference. Status: **S** simplification, **P** placeholder value, **B** known bug kept for now.
State as of Phase 1 (straight port of concept v7, no behavior change). Later phases remove items; when one is fixed, delete its line here in the same commit.

Code references: NDS 2018 and NDS Supplement 2018 (in `refs/`; the handoff named NDS 2024, but 2018 is the edition supplied), PRG 320-2019, ASCE 7-22, WoodWorks *U.S. Mass Timber Floor Vibration Design Guide* (2023, "the guide"), AISC DG 11.

## Loads and combinations
- S: ASD with D + L only; no other ASCE 7-22 combinations, no LRFD. `engine/clt.ts:panelCheck`, `engine/glulam.ts:memberCheck`, `engine/columns.ts:columnCheck`
- S: No load duration factor (CD = 1.0) on any member. Same files.
- S: No live load reduction on columns or girders (ASCE 7-22 §4.7 not applied). `engine/system.ts:evalStructure`
- S: Column load = floors x (panel + SDL + framing + LL) x A x B; no eccentricity, no roof or wall loads. `engine/system.ts:evalStructure`
- S: Fire checks use the same D + L load as the normal check, not a reduced fire combination. `engine/clt.ts`, `engine/glulam.ts`, `engine/columns.ts`

## CLT
- P: Panel properties are fixed catalog values, not computed from the layup. `data/panels.json`
- P: V2 values come from E1 values: EI x 1.4/1.7, strength x 875/1950. `data/panels.json`
- S: Simple span only; no two-span or continuous panels. `engine/clt.ts:panelCheck`
- S: Shear deformation from PRG 320 apparent stiffness with Ks = 11.5 (uniform load, simple span). `engine/clt.ts:panelCheck`
- S: Rolling shear uses Vs directly; no adjustment factors. `engine/clt.ts:panelCheck`
- S: Deflection limits L/360 live and L/240 total; no creep factor (NDS 3.5.2 Kcr not applied). `engine/clt.ts:panelCheck`
- S: The panel span is the purlin spacing (or B); the corridor CLT is priced but not checked. `engine/system.ts`, `engine/logistics.ts:quantities`

## Glulam beams (purlins, girders)
- P: One generic grade for every beam and column (E 1.8, Fb 2400, Fv 265, Fc 1650, Emin 0.95). `data/glulam.json`
- S: Only the volume factor Cv (NDS 5.3.6, x = 10) is applied; no CD, CM, Ct, CL, so the CLT is assumed to fully brace the beams. `engine/glulam.ts:memberCheck`
- S: Simple span, uniform load. Purlin reactions on the girder are smeared into a uniform load. `engine/system.ts:evalStructure`
- S: Shear checked at full V, with no reduction for load near the supports. `engine/glulam.ts:memberCheck`
- S: No bearing check. `engine/glulam.ts`
- S: Exterior and corridor girders are sized like interior girders (full B tributary on one side only). `engine/system.ts:evalStructure`
- S: Auto-sized beam depth limited to 6 x width. `data/sections.json:maxDepthToWidth`

## Columns
- S: Pinned-pinned, Le = story height, NDS 3.7.1 with c = 0.9; reference Fc with no other factors. `engine/columns.ts`
- S: The smallest passing size from a fixed list is picked, for the first floor only; no splices or stacking. `engine/system.ts`, `data/sections.json`

## Fire
- S: Effective char depth 1.2 x 1.5 in./hr x t^0.813, i.e. NDS 16.2.1 with beta_n = 1.5 in./hr. `engine/fire.ts:charDepth`
- S: Beams charred on 3 sides, columns on 4 sides, CLT from the underside only. `engine/glulam.ts`, `engine/columns.ts`, `engine/clt.ts`
- S: CLT residual section counts major-direction plies only, with no lamination fall-off. `engine/fire.ts:cltFireRatio`
- S: Fire strength factors 2.85 (bending), 2.75 (shear), 2.58 (compression), 2.03 (Emin), after NDS Table 16.2.2; no Cv or CL in fire. `engine/glulam.ts`, `engine/columns.ts`, `engine/clt.ts`
- S: Connection protection is only a note, not a check. `ui/main.ts:considerations`

## Vibration
- S: Frequency of each component from its own simple-span deflection, f = 0.18 sqrt(g/delta), combined by Dunkerley (guide §4.2.1). `engine/vibration.ts`
- S: Panel frequency uses EI with no shear deformation and simple supports; support stiffness enters only through Dunkerley. `engine/system.ts`
- S: Vibration weight = panel + SDL + vibration live load (occupancy table); beam self weight added on beam lines. `engine/system.ts`, `engine/vibration.ts`
- P: Peak acceleration uses the AISC DG 11 walking formula (Po = 65 lb, exp(-0.35 fn)) as a stand-in. It is not the guide's method and not validated for timber (guide §4.3 not implemented). `engine/vibration.ts:bayVibration`
- S: DG 11 style effective widths with Cj = 2.0 and Cg = 1.8; no limits on effective width (floor width, 2/3 rule). With no purlins the panel is treated as the joist with width 2.0 B. `engine/vibration.ts:bayVibration`
- S: One damping ratio for the whole floor (user input). `engine/types.ts:Inputs.damp`
- S: The CLT Handbook span limit (guide §4.2.2) is only shown as a method check, not used in design. `engine/clt.ts:cltSpanLimit`

## Connections
- P: Connections are priced as installed allowances per end or per column; no capacity check. `data/costs.json:conn`, `engine/cost.ts:priceWith`

## Cost, freight and logistics
- P: CLT $43/cf (V2) and $47/cf (E1), from the Beck Group MTPI 2025; the E1 premium is a placeholder. `data/panels.json`
- P: Glulam $55/cf base with width factors. `data/glulam.json`
- P: Erection $3,000/hr crane and crew; 2.5 panel, 4 beam and 3 column picks per hour. `data/costs.json:inst`
- P: Freight $3.25/mi all in, 44,000 lb payload, $250 per load fixed, $300 broker for cross-border loads, +35% oversize. `data/costs.json:frt`
- S: Road distance = great circle x 1.25; partial truckloads charged pro rata. `engine/logistics.ts:miles`, `engine/logistics.ts:haul`
- S: Oversize if panel width > 8.5 ft or length > 53 ft; glulam is oversize if A > 53 ft. `engine/cost.ts:priceWith`
- P: Tariffs 0% Canada to US (CUSMA) and 25% US to Canada. `data/costs.json:frt`
- P: Panel press sizes tagged "assumed" (10 x 40 ft x 12.5 in.) are not confirmed. `data/manufacturers.json`
- S: Every plant is assumed able to make glulam up to 60 ft long. `engine/logistics.ts:glReason`
- S: Panels are cut to a whole number of spans, up to the max length; corridor panels are A / panel width pieces. `engine/system.ts`, `engine/logistics.ts:quantities`
- S: No general conditions, design assist, shop drawings, protection, tax or markup. `engine/cost.ts`

## Optimizer
- S: Discrete section lists; depths increase in 1.5 in. steps from a strength and stiffness estimate. This is a local search, not a global optimum. `engine/optimizer.ts:autosize`
- S: Purlin counts searched from ceil(A/20) to floor(A/4), capped at 2 to 12. `engine/optimizer.ts:layouts`

## Known bugs kept from the concept (fix in Phase 2 or Phase 6)
- B: Catalog-tab edits to glulam, erection, connection, freight and logistics fields are ignored; the inputs render as `data-data-g` etc., so `onCatChange` never matches. Panel and manufacturer edits work. `ui/main.ts:renderCatalog`
- B: `fillFixSelects()` returns at once, so there are no member-lock controls; the `fx_*` tooltips are unused. `ui/main.ts:fillFixSelects`
- B: `price()` changes its input object in place. `engine/cost.ts:price`
