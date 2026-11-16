# Warangal UGD Tracker: map phase report (for acceptance)

Phase 1 of the build brief: the imagery, boundaries and the DPR network laid on the imagery, with the
alignment evidence, the road stretches, and a working app with sign-in and the map.
Every number below comes from a script in `pipeline/` and can be re-run from the original inputs.

**Status:** complete. The full 0.25 m imagery is in the app (16 Nov 2026, 15:55), and so are the per-zone overlays. The automatic check for pipes over ponds and tanks did not work (section 5).

---

## 1. What you can open now

| What | Where |
|---|---|
| The app (sign-in + map) | `http://localhost:8787` on this PC, after starting it (see §8) |
| Overlay images per GWMC zone | `docs/map-phase/zone-overlays/Z01.jpg … Z08.jpg` |
| Junction close-ups (control points) | `docs/map-phase/control-points/cp_sheet_01.jpg … 12.jpg` |
| Lists for the engineers | `docs/map-phase/*.csv` (§5) |

---

## 2. The network in the app

The app's network is **the final design**: the design tables in the DPR Word files, drawn with the GIS lines.

| | Result |
|---|---|
| Design reaches | **114,288**, all on the map |
| Matched to a GIS line by line number **and both end manholes** | 114,164 (99.9%) |
| Matched by line number and one manhole, or by length | 122 |
| Drawn as a straight line between its two known manholes (no GIS line) | 2 |
| Pipe length (plan) | **2,738.54 km** |
| Manholes (plan) | **114,304** |
| Plants and stations | 41 points (STPs, SPS, lift stations, septic tanks) |
| GIS lines not in the final design | 12,688 lines, 310.9 km (grey reference layer, not counted) |
| Pipes whose diameter differs between GIS and design | 15,073 (the design value is used; the GIS value is kept on the pipe) |

**Against the DPR bill of quantities:**
- **Length:** equal to the DPR estimates in every catchment, to within 0.01 km. For example STP-2: 815.38 km in the
  plan against 815.38 km in Parts A + B + C.
- **Manholes:** 114,304 against 114,262 in the BOQ (+42, 0.04%).
  - The app counts every distinct manhole at a pipe end, including one per network outlet.
  - The BOQ count differs by a few in SPS-2/C (+24), STP-2 (+10), SPS-1/C (+3), SPS-1/D (+2), SPS-4/B and SPS-2/B (+1 each).
  - Every difference is under 2%.

**Length by diameter (km):**

| 150 | 200 | 250 | 300 | 350 | 400 | 450 | 500 | 600 | 700 | 800 | 900 | 1000 | 1100 | 1200 | 1400 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1,666.8 | 667.0 | 154.7 | 93.2 | 14.1 | 42.9 | 22.2 | 13.6 | 41.1 | 11.0 | 3.2 | 4.0 | 1.4 | 3.0 | 0.2 | 0.1 |

| Diameter class | km | reaches |
|---|---|---|
| Laterals 150–200 mm | 2,333.8 | 99,031 |
| Sub-mains 250–450 mm | 327.0 | 12,669 |
| Trunk mains 500 mm and above | 77.7 | 2,588 |

**By sewer zone (km):** 1: 388.8 · 2: 1,565.8 · 3&4: 394.9 · 5: 159.9 · 6: 113.6 · 7: 115.5

**Every pipe carries:**
- identity: pipe id, DPR line number, from/to manhole, catchment, sewer zone
- design: diameter, material (DWC up to 300 mm, RCC NP4 from 350 mm, as in the BOQ), length, slope, flow, and invert, ground level and depth at both ends
- location: ward, GWMC zone, and road name where the GWMC drains layer has one within 15 m (61% of pipes)

**Manhole numbers** are shown as `<catchment>/MH-n` (e.g. `SPS-2C/MH-457`), exactly as in the design tables.
All 114,304 have a DPR number, so none had to be generated.

---

## 3. Alignment: is the DPR on the right roads?

### How it was checked
- The DPR network came as GIS files in real coordinates (UTM 44N), not as drawing sheets, so no sheet-by-sheet
  georeferencing was needed.
- What needs checking is whether the drawn lines sit on the roads in **your** imagery.
- **Control points:** 48 junction manholes, spread over all six sewer zones (at least 4 per zone).
  - Each was shown on the imagery at full resolution (60 m × 60 m, 5 m grid; sheets in
    `docs/map-phase/control-points/`).
  - The road-junction centre was read against the manhole.
  - 8 were rejected: too dark under trees, open land with no visible junction, or a divided highway where the
    sewer runs on the carriageway edge by design.

### Results (40 control points)
| Measure | Result |
|---|---|
| Offset of the junction manhole from the road-junction centre, as drawn | **median 1.0 m, RMS 1.8 m**, max 6.3 m; 37 of 40 within 3 m |
| Best single shift for the whole network | 0.3 m east, 0.6 m north (smaller than the reading precision) |
| RMS after that shift | 1.64 m |
| RMS after a full similarity fit (shift + rotation + scale) | 1.58 m (scale 1.00007, rotation −0.001°) |
| Excluding 7 pipes laid along one side of a wide road by design | RMS 0.94 m, max 2 m |
| By sewer zone (RMS) | 1: 1.3 m · 2: 1.0 m · 3&4: 1.1 m · 5: 2.3 m · 6: 3.0 m · 7: 0.9 m |

**Recommendation: apply no transform.**
- The network already sits within the 2–3 m target.
- A shift or a similarity fit improves it by only about 0.2 m, which is less than the reading precision.
- Rubber-sheeting is not justified.
- The remaining scatter is local. On wide roads the design puts sewers along one side (sometimes one on each side),
  and in Zone 6 some outer lines were drawn a few metres off rural tracks.

**Reading precision:** each point was read by eye at the imagery's 0.25 m resolution. I estimate ±1 m on a clear
junction and ±2 m on a dark or narrow lane, marked "low" in `control_points.csv`.

### What I tried and did not use
- I also tried an automatic measurement: the road centre found by symmetry across about 700–1,300 straight reaches.
- A visual check showed it was right on clear tracks but fooled by uniform fields, plot edges and divided highways.
- It is therefore **not** used for any figure. The script remains in `pipeline/measure_alignment.py` for reference.

---

## 4. Road stretches (pre-generated)

| | Result |
|---|---|
| Stretches | **36,206**; every design pipe in exactly one (checked by the script) |
| Length | median 58 m; 10% shorter than 24 m; 90% shorter than 160 m; longest 283 m |
| Codes | `W<ward>-NNN`, numbered from the outlet upstream within each ward. The largest ward (56) has 1,498 stretches, so its codes have 4 digits. |
| With a road name (from the GWMC drains layer) | 26,440 (73%) |
| State | all **Not started** (grey) |

**Rule:**
1. Chain pipe reaches through manholes where exactly two pipes meet.
2. Break at junctions, dead ends, plants, ward boundaries and catchment boundaries.
3. Cut runs longer than 250 m into equal parts at manholes.
4. Merge dead-end stubs under 30 m (4,180 of them) into the stretch they join.

Each stretch stores its pipes, length, planned manholes, metres per diameter and deepest point. Staff can later
split, merge or redraw stretches through change requests.

**Things to look at on the map:**
- **Lane combs:** many short dead-end lanes of 30–60 m off one road each became their own stretch.
- **Your choice:** if you prefer, lanes up to 60 m can be merged into the road they branch from. That gives
  about 30,000 stretches; field staff would then record a road and its lanes together.

---

## 5. Lists for the engineers (`docs/map-phase/`)

| File | Rows | What |
|---|---|---|
| `crossings_water.csv` | 848 | Pipes that cross (460) or run within 4 m along (388) a stream, canal or drain in the GWMC layer, in 363 stretches. 131 of the crossings are trunk mains (500 mm and above). These need crossing works, or are drawing errors. |
| (pipes over ponds and tanks) | not usable | The colour test on the imagery flagged 52,472 pipes: dark roads, shadows and trees look like water to it. The list was kept out of this folder (`work/network/pipes_through_water_UNRELIABLE.csv`). Tanks need a drawn outline, from the GWMC water-body layer if one exists, or traced on the imagery. |
| `review_length_and_position.csv` | 89 (10 manholes + 79 reaches) | Manholes whose pipes end at different places (all 10 in SPS-2/A, up to 400 m apart), and reaches whose drawn length differs from the design by more than 2%. The GIS and the design disagree here; an engineer should check. |
| `gis_not_in_design.csv` | 12,688 | GIS lines dropped from the final design (mostly 150/200 mm) |
| `design_vs_gis_diameter.csv` | 15,073 | Pipes resized between the GIS and the final design |
| `outside_wards.csv` | 56 | Pipes outside every ward outline (at most 53 m): assigned to the nearest ward and flagged |

**Pipes crossing buildings: not done yet.** There is no building layer in the inputs. The automatic road detector
proved unreliable, so it cannot reliably tell a roof from a road either. Two options:
- **(a) Recommended:** use Google's *Open Buildings* footprints (free, CC BY 4.0, good coverage of Indian cities).
  This means downloading a public dataset of a few hundred MB for the Warangal area. The list is then computed exactly.
- **(b)** Spot-check by eye on the map. Practical for trunk mains only.

---

## 6. Boundaries

- **66 wards** from the ward shapefile: corporator, 2011 population and density class kept.
- **8 GWMC zones** (Z01–Z08) from the GWMC KML.
  - Each ward is assigned to the zone holding most of its area.
  - Two wards straddle zones: ward 29 (94% in Z03) and ward 66 (55% in Z08).
- **6 sewer zones** (1, 2, 3&4, 5, 6, 7) from the sewer-zone shapefile.
  - Correction to the analysis report: this layer is in UTM metres. Only its stored area field uses different units.

---

## 7. Imagery

**Source:**
- `GWMC.jp2`: 0.25 m colour, 109,502 × 109,429 pixels, in UTM zone 44N (EPSG:32644).
- **Georeference:** the file's built-in position box is shifted 27.36 km north (one image height). The world file
  (`.j2w`) is correct, so the pipeline uses that, and the whole network falls inside the image.

**Tiles made for the app:**
- **Full imagery:** zoom 10 to 19, WebP at quality 85. That is 191,529 tiles in one 0.37 GB file
  (`imagery.pmtiles`).
  - Tiling took 3 h 01 min (11 processes); packing took 13 min.
  - **Zoom 19 is about 0.28 m per pixel** at Warangal, the full detail of the source. Single houses, trees and
    road edges are sharp.
- **Quick preview:** 4 m, zoom 10 to 16, 11 MB, made in about 10 minutes from the file's built-in overview.
  - It sits under the full imagery and fills any gap at the edge of the image.
  - It is what the app showed while the full tiles were being made.
- Both are served only to signed-in users.

**Per-zone overlays:** `docs/map-phase/zone-overlays/Z01.jpg` to `Z08.jpg`.
- They show pipes (coloured by size), wards and the zone outline on the zoom-15 imagery, at about 4.5 m per pixel.
- Network and imagery agree across every zone: the pipes follow the streets.

**Vendor, capture date and licence** are still to be confirmed. The credit line in the app says so.

---

## 8. The app (phase 1 scope: sign-in and map)

**Running it on this PC:** `npm start` in `app/` serves it on port 8787 (Windows reserves 8080 here). It uses the
embedded PGlite database in `app-state/`.

**What works now:**
- **Sign-in** with email and password.
  - Starting accounts are created once from `app/server/seed/accounts.json`.
  - The one-time password must be changed before anything else (enforced by the server).
  - Sessions last 14 days.
  - Changing the password signs out other devices.
  - 8 failed sign-ins in 15 minutes lock that email from that address.
  - Every change request carries a security header.
- **Map data only for signed-in users.**
  - `/data/...` refuses anyone not signed in, and anyone who has not yet changed a one-time password.
  - Tiles are served by HTTP Range.
- **Map layers:**
  - satellite imagery
  - the final-design network: pipes coloured and sized by diameter class, manholes from zoom 15, labels from zoom 18
  - plants and stations
  - road stretches (grey = not started), one label each from zoom 17
  - wards, GWMC zones, sewer zones
  - "DPR GIS as delivered", with an **opacity slider** (the stand-in for the DPR-sheet layer until drawing sheets are supplied)
  - GIS branches not in the final design
  - stream/canal crossings
  - the alignment control points
- **Click** a pipe, manhole, station or stretch for its details (the stretch underneath is listed too).
- **Search** stretch codes, manhole numbers, wards, road names and stations; pick a result to fly there.
- **Zone chips** jump to a GWMC or sewer zone; the "% laid" figures stay at 0 until phase 2.
- **The address keeps the map position**, so a link opens the same view.
- **Phone layout:** the panel folds behind ☰.

**Tests run** (`npm test -w server`): 14 API checks. They pass on PGlite **and** on PostgreSQL 16:
- health
- refusal without sign-in
- the security header, including an encoded path
- bad input → 400, never 500
- wrong password
- the one-time password forced change
- short password
- other devices signed out after a password change
- data with HTTP Range
- path tricks refused
- search
- sign-out
- the brute-force lock
- the audit log

**Checked in the browser** (desktop and phone size):
- sign-in → forced password change → map
- layers, popups, search and fly-to
- labels
- no errors after the fixes listed in `NOTES.md`

**Not in phase 1** (as planned): status recording, issues, compliance, dashboard, offline/PWA and deployment.

---

## 9. Decisions for you before phase 2

1. **Accept the alignment:** the DPR network as drawn, with no transform (§3).
2. **Stretch split:** keep 36,206 (each lane its own stretch), or merge lanes up to 60 m into their road, giving about 30,000 (§4).
3. **Buildings check:** may I download Google Open Buildings for the Warangal area to list pipes crossing buildings (§5)?
4. **Still open from phase 0:**
   - the imagery vendor, date and licence (for the on-map credit)
   - DPR drawing sheets, if they exist
   - contract packages
   - the user list
   - branding
