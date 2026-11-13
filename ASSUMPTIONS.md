# Assumptions, simplifications and placeholders

One line per item, with the code location and the reference. Status: **S** simplification, **P** placeholder value, **B** known bug kept for now, **V** not verified against the source document.
Current as of Phase 6 (data, project files, calc package). Phase 5 (connections) was skipped by choice: connections remain cost allowances with no capacity check. When an item is fixed, delete its line in the same commit.

References: NDS 2018 and NDS Supplement 2018 (in `refs/`; the handoff named NDS 2024, but 2018 is the edition supplied), PRG 320-2019, ASCE 7-22 (not in `refs/`), WoodWorks *U.S. Mass Timber Floor Vibration Design Guide* (2023, "the guide"), AISC DG 11. APA PR-L332(C) in `refs/` is the Canadian (LSD/CSA O86) edition, so it is not used for U.S. values.

## Loads and combinations
- S: Gravity only, D and L: ASD D and D + L (CD 0.9, 1.0); LRFD 1.4D and 1.2D + 1.6L (lambda 0.6, 0.8). No roof, snow, wind or seismic. `engine/loads.ts:combos`
- V: ASCE 7-22 §2.3.1, §2.4.1 and §4.7 are taken from the standard as commonly published; no copy in `refs/` to cite pages from. `engine/loads.ts`
- S: Live load reduction (§4.7.2): panels KLL 1 with AT = span x 1.5 span (one-way slab limit); purlins KLL 2, AT = spacing x span; girders KLL 2, AT = A x B; columns KLL 4, AT = floors x A x B. `engine/system.ts`
- S: 100 psf is treated as assembly and not reduced; above 100 psf, 20% reduction for members carrying 2 or more floors. `engine/loads.ts:liveLoadReduction`
- S: Deflections use the unreduced live load. `engine/clt.ts:panelCheck`, `engine/glulam.ts:memberCheck`
- S: Long-term deflection: Kcr x (dead deflection) + live deflection; no part of the live load is treated as sustained. `engine/clt.ts`, `engine/glulam.ts`
- S: Column load = floors x (panel + SDL + framing + LL) x A x B; no eccentricity or roof or wall loads, and no extra load from continuity of beams above. `engine/system.ts`
- S: Fire checks use ASD D + L with reduced live load in both ASD and LRFD mode (NDS Ch. 16 is ASD-based). `engine/clt.ts`, `engine/glulam.ts`, `engine/columns.ts`

## Analysis
- S: Equal spans, uniform load per span, pinned supports, no settlement; live load patterned over every combination of spans. `engine/beam.ts:envelope`
- S: Continuous-member shear deflection = 1.2 (M - chord)/GA (Timoshenko). This reproduces NDS Table 10.4.1.1 Ks = 11.5 (simple) and 57.6 (fixed), but shear flexibility does not redistribute moments. `engine/beam.ts:analyzeSpans`
- S: Panels are continuous over the spans one shipped panel covers (floor(max length / span)), analysed with up to 3 spans; 4 or more are treated as 3. `engine/system.ts`
- S: Loads on a supporting line = the largest support reaction of the member run above (two end reactions at joints, interior reaction otherwise), smeared per foot. Purlin point loads on girders are treated as uniform. `engine/beam.ts:supportLoad`, `engine/system.ts`
- S: Two-span purlins only for the dropped-girder system with 2 bays each side of the corridor. `engine/system.ts`

## CLT (PRG 320-2019, NDS Ch. 10)
- S: Properties from the layup by PRG 320 Appendix X3 (symmetric layups alternating major and minor; no adjacent parallel layers or "EL" layups). Tests match Table A2 within its rounding for 7 grades x 3 layups. `engine/clt.ts:cltLayupProps`
- S: Neutral axis is E-weighted; for symmetric layups this is mid-depth as in X3. `engine/clt.ts:cltLayupProps`
- P: The 9-ply E1 12 3/8 in. layup is computed only; PRG 320 Table A2 does not list it. `data/panels.json`
- S: Flatwise bending CL = 1.0; CM = Ct = 1.0 (dry, normal temperature). `engine/clt.ts:panelCheck`
- S: Rolling shear checked at the support face (no reduction within d). `engine/clt.ts:panelCheck`
- S: Minor-direction (cross-span) bending is not checked. `engine/clt.ts`
- S: The corridor CLT is priced but not checked. `engine/logistics.ts:quantities`
- S: Panel bearing on purlins/girders is not checked. `engine/clt.ts`

## Glulam beams (NDS Ch. 3 and 5, Supplement Table 5A)
- S: One stress class for all beams (default 24F-1.8E); CM = Ct = 1.0; Cfu, Cc and CI not applicable. `engine/glulam.ts`
- S: CL vs CV per NDS 5.3.6 (lesser applies). Purlins and flush or no-purlin girders: compression edge braced continuously by the CLT, so CL = 1.0 (NDS 3.3.3.3). Dropped girders: braced at purlin points only, le from Table 3.3.3 for n-1 equal loads with lateral support at the loads. `engine/system.ts`, `engine/glulam.ts:lePointFactor`
- S: Two-span negative moment: bottom edge unbraced from the support to the inflection point, lu = 0.25 L, le from Table 3.3.3 footnote 1 (single-span rules; footnote 2 calls for engineering analysis). `engine/glulam.ts:memberCheck`
- S: CV uses the length between zero-moment points: L (simple), 0.75 L positive and 0.5 L negative (two-span); b capped at 10.75 in. `engine/glulam.ts:volFactor`
- S: Continuous beams are specified balanced (Fbx- = Fbx+) by default; this can be switched off in the catalog. `data/glulam.json:gl.balancedContinuous`
- S: Shear at distance d from the support (NDS 3.4.3.1(a)); Cvr = 1.0 (prismatic, unnotched; hanger connections in Phase 5). `engine/glulam.ts:memberCheck`
- S: Bearing checked only where a purlin sits on a dropped girder (bearing area = purlin width x girder width; Cb at the interior support of two-span purlins). Girder-to-column and hanger bearing are left to Phase 5. `engine/glulam.ts`, `engine/system.ts`
- S: Exterior and corridor girders are sized like interior girders. `engine/system.ts`
- S: Auto-sized beam depth limited to 6 x width. `data/sections.json:maxDepthToWidth`

## Columns (NDS 3.7, Supplement Table 5B)
- S: One combination for all columns (default DF #2, 4+ laminations); axial load only; Le = Ke x story height with Ke from input (default 1.0); le/d <= 50. `engine/columns.ts`
- S: The smallest passing size from a fixed list is picked, for the most heavily loaded (lowest) floor; no splices or size changes up the building. `engine/system.ts`, `data/sections.json`

## Fire (NDS 2018 Chapter 16)
- S: Nominal char rate beta_n = 1.5 in./hr for glulam and CLT (16.2.1.1); a_char = beta_n t^0.813, a_eff = 1.2 a_char (16.2-2, 16.2-4). The 1.2 factor stands in for a separate zero-strength layer. `engine/fire.ts:charDepth`
- S: CLT char with lamination fall-off per eq. 16.2-3, applied lamination by lamination (so unequal layups are allowed); the no-fall-off option uses 16.2-2. Tests reproduce Table 16.2.1B within 0.052 in. (the table rounds inconsistently). `engine/fire.ts:cltCharDepth`
- S: CLT residual section (16.2.1.5) from the actual layup with the PRG 320 X3 assumptions (transverse E/30), E-weighted neutral axis, extreme major fibre; capacity = 2.85 x FbS x (residual / original Seff), so the 0.85 in FbS carries through and product-report overrides scale. `engine/fire.ts:cltFireRatio`, `engine/clt.ts:panelCheck`
- S: Beams exposed on 3 sides (CLT on top). Columns on 4 sides, or 3 by input with one depth face protected; column slenderness on the smaller reduced dimension. `engine/fire.ts:reducedSection`, `engine/columns.ts`
- S: Table 16.2.2: bending 2.85 Fb x lesser of CV (original section) and CL (reduced section, FbE x 2.03); compression 2.58 Fc x CP (FcE x 2.03). Table 16.2.2 has no shear factor, so shear isn't checked in fire (the concept used 2.75 Fv). `engine/glulam.ts`, `engine/columns.ts`
- S: Load for fire = ASD D + L with the member's live load reduction, in both ASD and LRFD mode. `engine/clt.ts`, `engine/glulam.ts`, `engine/columns.ts`
- S: Continuous members are checked in fire for both moment signs on the same reduced section; CLT negative moment uses the smaller extreme-fibre section modulus. `engine/glulam.ts`, `engine/clt.ts`
- S: Fire only checks strength; thermal separation (burn-through) and gypsum or topping protection credits are not modelled. `engine/fire.ts`
- S: NDS 16.2.4 glulam fire layups are a specification note only. `ui/main.ts:considerations`
- P: Connection protection (16.3) is screened by geometry: a concealed connector 1.5 in. wide (placeholder) needs a member width >= 1.5 + 2 a_eff; other connections get cover notes only. `engine/fire.ts:connectionProtection`, `data/connections.json`

## Vibration (guide §4.3 with closed-form modes; Phase 4)
- S: **Modes are estimated in closed form, not by FEM (the largest uncertainty in the tool).** The fundamental bay mode takes its frequency from Dunkerley (§4.2.1) over panel, purlin and girder, and its modal mass is deflection-weighted from the components. `engine/vibration.ts:floorModes`
- S: Panel component: simply supported orthotropic plate (1,n) modes over span x field width (B for purlin systems, A for CLT on girders), with Timoshenko shear reduction on the span. Modal mass = m Lx Ly / 4 per span, times the number of continuous spans (the guide's Example 1: same frequency, double the modal mass). Checked against Example 1's FEM: within 5% on frequency and 10% on modal mass. `engine/vibration.ts:plateModes`
- P: Plate torsion H = 0.25 sqrt(Dx Dy), calibrated to the one guide example with FEM results (Example 1). `data/vibration.json:kH`
- S: Beam components: AISC DG 11 effective widths (Bj = 2.0 (Ds/Dj)^0.25 Lj, Bg = 1.8 (Dj/Dg)^0.25 Lg), capped at 2/3 of the floor width (girders: corridor building width or 3 B; purlins: 2 A, so the floor is assumed at least 3 bays long). Modal mass = W / 2g, the value for a sine-shaped span of uniform width. DG 11's own formula implies W / g with a 0.5 reduction factor, so this tool predicts roughly twice DG 11's acceleration for beam-dominated bays. Not validated against FEM for beam-supported floors; confirm with a model. `engine/vibration.ts:floorModes`
- S: First FEM data point (vib-engine example, T2 30 x 25 ft, V2 5-ply, 6 3/4 x 21 purlins, 10 3/4 x 30 girders): FEM 4.38 Hz, 179.8 lbf-s^2/in., 0.584% g (worst point). This tool's guide method: 3.38 Hz, 81.3 lbf-s^2/in., 0.662% g, so 1.13 x FEM (frequency low because continuity and fixity are not credited, modal mass about half; the two partly cancel). The DG 11 option: 1.025% g (1.76 x FEM), matching the engine's own hand check exactly. One bay only; the engine's VALIDATION.md finds hand methods 10 to 15% unconservative for T1 and light 3-ply T2, which the "verify with FEM" badge flags. `tests/fem.test.ts`
- S: Higher modes: panel (1,n) plate modes on rigid supports only; no separate beam higher modes; no exterior-wall or facade support springs; connections pinned (the guide's examples use fixity, which raises frequencies). `engine/vibration.ts:floorModes`
- S: Response at the bay centre with self-excitation (mu_e = mu_r = 1 for the bay mode, sin(n pi/2) for plate modes); no walking paths or separate receiver points. `engine/vibration.ts`
- S: Resonant check per §4.3.1 (CCIP-016 harmonics, rho with path = max(A, bays x B), stride 2.5 ft, walker 168 lbf) over modes below 15 Hz, sweeping fw from max(1.25, fw,max - 0.6) to fw,max in 0.025 Hz steps; frequency-weighted peak acceleration against the limit. Transient per §4.3.2 at fw,max over modes up to 2 f1, RMS over one footfall in 200 steps, weighted if f1 < 8 Hz, total RMS against the limit (the 1/3-octave value is reported). Regimes per §4.3.2: resonant if f1 < 4 fw + 2, transient if f1 > 4 fw. `engine/vibration.ts:guideEvaluate`
- S: Tests reproduce the post-processing in Examples 1, 2 and 3 from their published modal data (Tables 7-2/7-5, 8-6, 9-11) to within 1 to 5%; the residual comes from rounding in the published tables. `tests/vibration-guide.test.ts`
- S: Topping: weight added to the dead load (strength and vibration). Concrete stiffness credited for vibration only, E = 1.35 x 57,000 sqrt(f'c) and G = 0.4 E (§3.3.5), by the gamma method (§3.4.1, gamma moved to the component without the neutral axis; reproduces Example 3's 1,155,000 k-in^2/ft); gypcrete is mass only. Factors are the low end of Table 3-6. `engine/vibration.ts:compositeEI`, `engine/system.ts:vibrationOf`
- P: Topping densities 145 pcf (concrete) and 115 pcf (gypcrete), f'c 4,000 psi. `data/vibration.json`
- S: CLT-to-beam incidental composite action (§3.4.3) is optional (gamma 0.5) for vibration only: purlins and no-purlin girders use the CLT minor direction, flush girders the major direction, dropped girders none; flange width min(L/2.5, spacing). `engine/system.ts:vibrationOf`
- S: The minimum-frequency target is kept as a separate screening input (default 5 Hz; the guide says floors below 3 to 4 Hz are not recommended). `engine/system.ts`
- S: The CLT Handbook span limit (§4.2.2, -10% when topping > 2 x panel weight) is shown for information only; it applies to bearing-wall floors. `ui/main.ts:vibRows`
- S: The AISC DG 11 option is the concept's method (Po = 65 lb, effective widths without caps, panel strip frequency) with topping and composite stiffness now included. `engine/vibration.ts:bayVibration`

## Connections
- P: Priced as installed allowances per end or per column; no capacity check. `data/costs.json:conn`, `engine/cost.ts:priceWith`

## Cost, freight and logistics
- P: CLT $43/cf (V2) and $47/cf (E1), from the Beck Group MTPI 2025; the E1 premium is a placeholder. `data/panels.json`
- P: Glulam $55/cf base with width factors; the price doesn't depend on stress class. `data/glulam.json`
- P: Erection $3,000/hr crane and crew; 2.5 panel, 4 beam and 3 column picks per hour. `data/costs.json:inst`
- P: Freight $3.25/mi all in, 44,000 lb payload, $250 per load fixed, $300 broker for cross-border loads, +35% oversize. `data/costs.json:frt`
- S: Road distance = great circle x 1.25; partial truckloads charged pro rata. `engine/logistics.ts:miles`, `engine/logistics.ts:haul`
- S: Oversize if panel width > 8.5 ft or length > 53 ft; glulam is oversize if A > 53 ft. `engine/cost.ts:priceWith`
- P: Tariffs 0% Canada to US (CUSMA) and 25% US to Canada. `data/costs.json:frt`
- P: Panel press sizes tagged "assumed" (10 x 40 ft x 12.5 in.) are not confirmed. `data/manufacturers.json`
- S: Every plant is assumed able to make glulam up to 60 ft long, in every stress class. `engine/logistics.ts:glReason`
- S: Panels are cut to a whole number of spans, up to the max length; corridor panels are A / panel width pieces. `engine/system.ts`, `engine/logistics.ts:quantities`
- S: No general conditions, design assist, shop drawings, protection, tax or markup. `engine/cost.ts`

## Optimizer
- S: Discrete section lists; depths increase in 1.5 in. steps from a strength and stiffness estimate. This is a local search, not a global optimum, and widths are enumerated, not optimized (a bearing failure is fixed only by a wider combination). `engine/optimizer.ts:autosize`
- S: Purlin counts searched from ceil(A/20) to floor(A/4), capped at 2 to 12. `engine/optimizer.ts:layouts`

## Data, project files and report (Phase 6)
- S: Manufacturer verified flags were set from what each source note records: press size = the concept's "known" flag; grades = a grade list was given; glulam = the note mentions glulam. Everything else is marked assumed. `data/manufacturers.json`
- S: Project files hold the inputs, the whole edited catalog, runs, the pinned design and the report header. On opening, objects merge over the current defaults, lists (panels, manufacturers) replace, inputs added later take their defaults (with a warning), and an invalid manufacturer list is reset. `data/project.ts`
- S: FEM export (vib-engine integration.md): the panel is always sent explicitly, because this tool's layup-computed properties differ slightly from the concept catalog the engine indexes by `pi`. Topping weight is added to sdl (the engine models mass only); topping stiffness, CLT-to-beam composite action and this tool's continuity are not sent (the export notes say so). EI90 is left for the engine to derive. The engine schema lists T2 only while the integration note says T1 to T3; T1 and T3 are exported with a note. `data/fem.ts:exportDesign`
- S: Imported results are matched to the design on the section-1 keys and the panel (not the file name); any difference marks them stale. The "verify with FEM" badge flags T1, T2 with 3-ply panels, T3, and any vibration result within 20% of its limit on either side. `data/fem.ts:femStale`, `data/fem.ts:needsFem`
- S: The calc package covers the design shown on the Design tab and lists the governing combination only, not every combination. `engine/calcpackage.ts`

## Known bugs kept from the concept
- B: `fillFixSelects()` returns at once, so there are no member-lock controls; the `fx_*` tooltips are unused (Phase 6). `ui/main.ts:fillFixSelects`
- B: `price()` changes its input object in place. `engine/cost.ts:price`
