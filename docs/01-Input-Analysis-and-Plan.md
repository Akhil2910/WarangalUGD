# Warangal UGD Tracker: input analysis and plan (for approval)

Prepared 16 November 2026. Covers section 3 of the build brief. **Nothing has been built yet.**
The evidence files are in `docs/analysis/`. The scripts that produced every number below are in
`pipeline/analysis/` and can be re-run.

---

## 1. Inventory: what we have

The input folder is `C:\Users\jaipa\Desktop\WGL_V2`. I unzipped every archive next to its original. The
originals are untouched.

| Group | File(s) | What it really is | Use |
|---|---|---|---|
| **Imagery** | `GWMC_SATELLITE.zip` → `GWMC.jp2` (378 MB), `.j2w`, `.prj`, `.aux.xml` | One RGB mosaic, **0.25 m per pixel**, 109,502 × 109,429 px, covering 27.4 × 27.4 km, in UTM 44N (EPSG:32644). Compressed with the ECW JPEG 2000 SDK. | Base map |
| **DPR network (geometry)** | `UGSS_Files.zip` → 11 shapefile sets (`Co`/`Co_Combined` = pipes, `MH` = manholes, `STP_&_SPS` = plants and stations) for Zones 1, 2, 3&4, 5, 6, 7 | 126,974 pipe lines and 126,974 manhole points, in **real UTM 44N coordinates**. Attributes: pipe **diameter `D`** and label `CO-n`. Manhole label `MH-n`. No levels, no material, no road names. | Network geometry |
| **DPR network (design tables)** | `Sewer Network Design\Zone -1…7 Design.docx` (6 files, up to 41 MB) | One table per catchment (22 catchments). For every reach: line no., from/to manhole, length, flow, **diameter**, slope, velocities, **upstream/downstream invert and ground levels, depths**. 114,288 reaches, 2,738.5 km. | Network attributes (authoritative) |
| **DPR quantities** | `Sewer Network Estimate\*.xlsx` (24 files, one per catchment) | Bill of quantities (BOQ) and abstract on the Telangana Schedule of Rates 2025-26. **2,738.5 km of pipe, 114,262 manholes, 228,761 house connections**, Rs 4,142 Cr. | Totals check only |
| DPR other estimates | STP, main and sewage pumping stations, pumping mains, lift stations, septic tanks, solar, O&M, overall cost abstract (Rs 5,257 Cr), vendor quotations | Background. Not needed by the app. | Reference |
| **Boundaries** | `UGSS_Files\Extra Data\Ward_Boundary.shp` (66 wards with corporator, 2011 population, density class), `Zone_Boundary.shp` (6 sewer zones, but in **degrees**, see §2), `Assembly_Boundary.shp` (5 constituencies) | | Wards, sewer zones |
| Boundaries (city base map) | `Warangal_KML\Warangal_KML\*.kml` (10 layers, WGS84) | 66 wards (IDs only), **8 GWMC administrative zones** (Z01–Z08), 2,338 km of existing RCC drains **with road and locality names**, 1 m contours (236–345 m), streams and canals, 24 drainage pumping stations, 1 existing STP, water assets | Admin zones, **road names**, reference layers |
| **Compliance list** | `UGD_Compliance_Stagewise.xlsx` (22 MB) | A 22-item stage-wise compliance list with gates, evidence, grace days and a road-type matrix (6 road types, adding **Paver/tile** and **Brick paving**). Plus a stretch-wise sheet of 126,969 stretches, all "not started". It was produced by an earlier tracker app. | Starting point for §7 |
| ArcMap projects | 11 `.mxd` files | Their data paths point to other machines, so they open broken. | Not used |
| Not found | — | **No CAD (DWG/DXF), no PDF drawing sheets, no L-sections, no contract packages, no user list, no branding, no imagery licence or acquisition date** | See §5 |

**Duplicates and versions:**
- Two pump technical offers and two screen quotations are the same documents, re-saved.
- The GIS network and the design tables are **two different versions** of the network (§4).
- An earlier tracker app (versions 0.5 and 0.6) sits in `Desktop\Complaince Monitoring`. Your brief says to
  build fresh, so I have **not** used it. Its compliance list does reach us through the workbook above.

---

## 2. Spatial check

| Layer | Coordinate system | Evidence | Extent / notes |
|---|---|---|---|
| Imagery | UTM 44N | `.prj`, and the world file | 333,312–360,688 E; 1,975,689–2,003,046 N. **Covers 100% of the network** (all 318,912 vertices). |
| Pipes, manholes, STP/SPS, wards, assembly | UTM 44N | `.prj` files | Network spans 334,160–359,561 E, 1,977,599–2,001,651 N |
| Sewer `Zone_Boundary.shp` | Declared UTM, **but its areas are 11–79 "square units"** | The coordinates are really degrees. | It must be reprojected as WGS84 lon/lat. I'll confirm this in the map phase. |
| KML layers | WGS84 (as KML requires) | — | The ward layer has the same 66 wards (405 km²) as the shapefile. |

**Imagery findings:**
- **0.25 m resolution.** Roads, lanes, buildings and manhole-sized objects are visible (see the close-ups).
- **The file carries two conflicting georeferences.** The internal GML box is shifted one full image height
  (27.36 km) north. The world file is correct. GDAL 3.12 picks the right one, but older GIS software may
  not. The pipeline will force the world file and check the result.
- **There is no acquisition date, vendor name or licence text in the delivery.** I need these for the
  on-map credit (brief §4).

**Alignment of the network on the imagery** (`docs/analysis/overlay-closeups/`):
- In the built-up areas I checked, pipes follow the roads and lanes.
- Some lines run a few metres to one side of the carriageway, and a few cross the corners of plots.
- This looks like a road centreline digitised from another base map, not a sheet-by-sheet CAD problem.
- The map phase will measure the offset properly (§6.2).

---

## 3. Content check: how the network is described

- **Pipe:**
  - The GIS line carries `D` (mm) and `LABEL` = `CO-n`. Labels restart in every catchment, so `CO-1`
    exists many times in a zone.
  - The design table row gives catchment, `CO-n`, from `MH-a`, to `MH-b`, length, diameter, slope, invert
    and ground levels at both ends, and depths.
- **Manhole:**
  - The GIS point carries `MH-n` only.
  - **Every manhole point sits exactly on a pipe end** (all 126,974, within 0.1 m).
  - Manhole numbers also restart per catchment, but **no number repeats at two places within one
    catchment**.
- **Plants and stations:** 40 labelled points (STP-1 to STP-7, 23 SPS, 4 lift stations, 9 septic tanks).
- **Not in the DPR files:** material, road names, road widths, road types, house connections per reach,
  outfalls as lines, contract packages.
  - Material can be read from the BOQ rule: DWC for 150–300 mm, RCC NP4 for 350 mm and above.
  - Road names can be borrowed from the KML drains layer by proximity.

**Proposed mapping to the data model (§6 of the brief):**

| Brief field | Source |
|---|---|
| Pipe id, from/to manhole | Design table (catchment + `CO-n`, from/to `MH-n`) |
| Diameter, slope, length, GL/IL, depth | Design table; GIS length for the drawn geometry |
| Material | BOQ rule, by diameter |
| Pipe geometry | GIS line |
| Manhole number, position | `MH-n` + catchment; GIS point |
| Flow direction | Design from → to (cross-checked with inverts: all fall downstream) |
| Ward | Ward polygon; nearest ward if outside |
| Zone | **Choice needed** (§5, question 2) |
| Road name | KML drains layer, nearest within 15 m, else blank |
| Road type | Not in the inputs; chosen by staff (brief §6.3) |
| Package | Not in the inputs (§5) |

---

## 4. Quality check of the network

### 4.1 The two versions of the network disagree

| | GIS shapefiles | Design tables | DPR BOQ (24 estimates) |
|---|---|---|---|
| Reaches | 126,974 | 114,288 | (114,262 manholes) |
| Length | **3,049.3 km** | **2,738.5 km** | **2,738.5 km** |

The design tables and the BOQ agree exactly, catchment by catchment. The GIS is **11.4% longer**. Matching
every GIS line to the design table (same catchment area, same `CO-n` label, length within 2%) explains the
gap completely:

| Finding | Reaches | km | Meaning |
|---|---|---|---|
| Same label, length and diameter | 99,160 | 2,377.9 | Agree |
| Same label and length, **different diameter** | 14,937 | ~350 | The GIS has an older sizing. Mostly 200 → 150 mm (13,241); also 200 → 250, 250 → 300, 700 → 800, 1000 → 1100, 600 → 300. **The design value is the one in the BOQ.** |
| In the GIS, **not in the design at all** | 12,613 | **309.1** | Almost all 150 mm (263 km) and 200 mm (46 km) branches dropped from the final design. Largest in Zone-1 Part-2 (115 km), Zone-2 Part-1 (70 km) and Zone-3,4 Part-1 (42 km). List in `docs/analysis/gis_only.csv`. |
| In the design, no GIS line found | 123 | 2.7 | SPS-2/B, SPS-2/A, STP-2. Need geometry; I'll trace them in the map phase. |
| Same label, length and diameter both differ | 264 | small | To review in the map phase |

**Result: 114,165 of 114,288 design reaches (99.9%) have a GIS line.** The plan the app counts against will
therefore be **2,738.5 km**, the DPR figure, within about 3 km.

**Per zone (km):**

| Zone | GIS | Design = BOQ | Difference |
|---|---|---|---|
| 1 | 540.6 | 388.8 | GIS +39% (Zone-1 Part-2 has 115 km of dropped branches) |
| 2 | 1,644.8 | 1,565.8 | +5% |
| 3&4 | 452.5 | 394.9 | +15% |
| 5 | 161.3 | 159.9 | +1% |
| 6 | 118.2 | 113.6 | +4% (SPS-6/A and STP-6 equal; the 4.6 km gap is still to be traced) |
| 7 | 132.2 | 115.5 | +14% |

### 4.2 Other checks

| Check | Result |
|---|---|
| Pipes with no diameter | None |
| Manholes not on a pipe end | None |
| Duplicate manhole numbers at different places (same catchment) | None |
| Duplicate pipes (same two end points) | 30 lines, 10 of them in the dropped set |
| Inverts that make flow run uphill | **None** (all 114,288 design reaches fall downstream) |
| Depth ≠ GL − IL | **None** (all within 5 cm) |
| Minimum invert depth | 0.75 m everywhere. 61,641 reaches have an end shallower than 0.9 m: that is the design minimum, not an error. |
| Deepest | 7.69 m (inlet of the existing STP-5); about 6.7 m in Zone 2 |
| Hydraulics (from the design tables) | A few reaches over capacity (Zone 2 at SPS-2/C, Zone 5); about 40 above 80% full. These are design issues for the engineers, not data errors. |
| Pieces of network | 37 connected pieces: the 22 catchments, plus septic-tank and lift-station sub-networks |
| Features outside the ward outlines | 63 pipes (1.6 km), at most 53 m outside. They will go to the nearest ward and be flagged. |
| Wards without zones | The ward layer's "Zone" column is a **density class** (V Low … V High), not an administrative zone. The zone comes from overlaying the zone polygons (§5). |
| Gaps between sheets | Not applicable: there are no sheets, and the network is continuous GIS data. |

---

## 5. Gaps and choices: what I need from you

1. **DPR drawing sheets.** The brief asks for a "DPR sheet" layer: the drawings shown over the imagery.
   There are no DWG, DXF or PDF sheets in the inputs.
   - If you have them, please add them. The layer will then show them, aligned to the network.
   - If not, I'll show the original GIS lines as the "DPR as delivered" layer instead.
2. **Which "zone" the app uses.** There are two zone systems:
   - **Sewer zones** 1, 2, 3&4, 5, 6, 7: how the DPR, design and BOQ are organised.
   - **GWMC administrative zones** Z01–Z08: how the corporation is organised.

   **Recommendation:** keep both. The admin zone is the "zone" for staff areas, labour and reports. The sewer
   zone and catchment are fields shown on every pipe and in reports.
3. **Network version.** **Recommendation:**
   - The plan = the design tables (it matches the DPR BOQ), with GIS geometry.
   - The 309 km of dropped GIS branches become a grey reference layer, "GIS branches not in final design",
     not counted.
   - Where diameters differ, the design diameter wins and the GIS value is kept as a note.
4. **Imagery licence.** The vendor name, acquisition date and licence terms, for the on-map credit.
5. **Contract packages, users, branding.** Not in the inputs. The app works without packages. They can be
   added from Settings or a file later.
6. **Software on this PC.** Imagery processing needs **GDAL** with JPEG 2000 support. This PC has no GDAL
   tools and no Docker.
   - **Proposal:** install Miniforge (a free Python distribution) in your user folder, with GDAL and
     tippecanoe.
   - Docker Desktop is needed later for the deployment package test. I will ask before installing either.

---

## 6. How the DPR goes onto the imagery

### 6.1 Pipeline (`pipeline/`, re-runnable)

1. **Imagery → PMTiles:**
   - Steps: force the world-file georeference, warp to Web Mercator, tile up to zoom 19 (0.28 m, close to
     the native 0.25 m), with WebP quality 85.
   - Estimate: about 190,000 tiles, **7–11 GB**, **4–8 hours** of processing, mostly spent decoding the
     JPEG 2000.
   - Served by HTTP Range to signed-in users only.
2. **Network → WGS84 layers:**
   - Join GIS lines to design rows (as in §4.1) and keep every original label and attribute.
   - Add material, ward, admin zone, sewer zone, catchment and road name.
   - Output as PMTiles vector tiles: the network is about 115,000 lines and 114,000 manholes, too heavy as
     GeoJSON for a phone.
3. **Graph:** manholes are nodes and reaches are edges. Flow runs from → to, as the design says
   (confirmed by the inverts).
4. **Reports:**
   - totals per diameter, ward, admin zone, sewer zone and catchment, against the BOQ
   - the change report for later DPR revisions

### 6.2 Alignment evidence for the map phase

- Measure the network's offset from the imagery at about **60 control points**: road junctions and culverts
  spread over all zones, each picked on the imagery and on the network.
- **If the offset is systematic** (the same shift everywhere): apply one similarity transform for the whole
  network. Report the residuals in metres; the target is 2–3 m.
- **If it varies by area:** propose a per-zone transform, and only then rubber-sheeting, with your approval.
- Deliverables:
  - overlay images per zone, plus junction close-ups
  - a list of places where pipes cross buildings or water bodies, from a building-footprint check on the
    imagery and the KML water layers
  - the "DPR as delivered" layer with an opacity slider

---

## 7. Proposals

### 7.1 Stretch split (pre-generated)

- **Method:**
  - Chain the pipe reaches between **junction manholes** (where three or more pipes meet, or a pipe ends).
  - Never cross a ward or catchment boundary.
  - Cap a stretch at 250 m.
  - Then merge dead-end stubs under 30 m into the stretch they join.
  - Carry the road name over from the KML drains where it is within 15 m.
- **Measured on this network (before the stub merge):**
  - **about 39,900 stretches**, median 43 m, 90% shorter than 122 m
  - 28,154 dead ends: most lanes are short branches
- **After the stub merge:** roughly 30,000–33,000 stretches. I'll report the exact figure with the map.
- **Comparison:** the earlier app's workbook has 126,969 stretches of about 24 m, one per pipe. That is too
  fine for road-by-road work.
- **Codes:** `W<ward>-NNN`, numbered along the flow within each ward (e.g. `W12-047`).
- Staff can split, merge or redraw stretches later through change requests.

### 7.2 Manhole numbering

- **Keep the DPR numbers.** Since `MH-n` repeats across catchments, the displayed number becomes
  **`<catchment>/MH-n`**, e.g. `SPS-2C/MH-457`, which is exactly as written in the design tables.
- **App-generated numbers** (for proposed manholes, or design rows with no GIS point):
  `<catchment>/MH-A0001`, flagged "number generated by the app".
- **Pipes:** `SPS-2C/MH-457 → SPS-2C/MH-458`, plus the design line number `CO-n` and an internal id.
- **DPR revisions:** match by catchment + number first, then by position within **2 m**. Anything else is
  reported as added, removed or moved for your approval.

### 7.3 Diameter classes (from the design: 150 mm to 1,400 mm)

| Class | Diameters | Design km (approx.) |
|---|---|---|
| Laterals | 150–200 mm | about 2,430 |
| Sub-mains | 250–450 mm | about 210 |
| Trunk mains | 500 mm and above | about 100 |

(The exact split will be computed from the design diameters in the pipeline.)

### 7.4 Permission table (role × action × area)

"Area" means the user's assigned admin zones, wards and packages. **Commissioner:** everything, everywhere.
**Viewer:** read only, everywhere.

| Action | Contr. Asst | Field Insp. | AEE | DEE | Commissioner |
|---|---|---|---|---|---|
| View map, stretches, dashboard | area | area | area | area | all |
| Update stretch status | area | area | area | area | all |
| Record compliance (with evidence) | area | area | area | area | all |
| **Verify** compliance | — | — | area (not their own record) | area | all |
| Report issue | area | area | area | area | all |
| Assign / close issue | — | — | resolve own area | area | all |
| Re-open issue | — | — | area | area | all |
| Permanently delete issue | — | — | — | — | yes |
| Propose network change (stretch / manhole / pipe / realign / delete) | area | area | area | area | applies at once |
| Decide change request | — | — | — | area (first level) | all |
| Approve / reject restoration | — | — | — | area (first level) | all |
| Labour: log | area | area | area | area | all |
| Labour: correct own entry | 48 h | 48 h | 48 h | any time | any time |
| Labour: correct others' entries | — | — | 48 h if supervisor flag | area, any time | all, any time |
| Roll back a stretch version | — | — | — | — | yes |
| Users, Settings, compliance list, Storage, start-fresh | — | — | — | — | yes |
| Excel / KML exports | area | area | area | area | all |

**Proposed default for DEE decisions:**
- **Final:** restoration approvals, compliance verifications, and change requests that add or realign
  under 100 m.
- **Also need the Commissioner's confirmation:** deletions of network, new stretches over 100 m, and any
  reversal of an earlier approval.
- The Commissioner can change this in Settings.

### 7.5 Default compliance list

**Proposal:** start from the 22-item list in `UGD_Compliance_Stagewise.xlsx`, which already refines brief
§7.5. It covers 9 stages, evidence types, pass rules (field density ≥ 95%, invert within ± 0.05 m), daily
recurrence for barricading and lighting, and the shoring-by-depth rule. Changes I suggest:

| Item | Change | Reason |
|---|---|---|
| "Every required permission valid" (Block) | Keep it as the only **blocking** item, **but** as a normal recorded item (reference number + document) until a permission register exists. | The brief has no permission register. Blocking road cutting without a road-cutting permission is the right control. |
| Barricading, night lighting (daily) | Make them **blocking for "trench open"** after a 1-day grace period. | They are the main public-safety risks named in the brief. |
| Leak test, manhole test | Per reach / per manhole on pipes **250 mm and above**; smaller pipes per stretch | As in the workbook. Keeps phone work practical for about 2,430 km of laterals. |
| Shoring | Applies automatically where the **design depth** exceeds 1.5 m | The design tables have depths for every reach. |
| CC cube test | Pass mark 25 N/mm² at 28 days, if your road specification is M25. | Otherwise "record only". |
| Road types | Keep the 6 types (CC, BT, Gravel/WBM, Earthen, **Paver/tile, Brick paving**). The Commissioner may add more later. | Matches the workbook |
| All others | Warn, 2 grace days, AEE verifies | As in the brief |

The full list with evidence and rules will go in `docs/compliance-guide` once you approve it.

---

## 8. Build plan (phases, each stopping for your review)

| Phase | Content | Stop for review with |
|---|---|---|
| 0 (now) | This analysis | Your answers to §5 and approval of §7 |
| 1 Map | Install GDAL; imagery PMTiles; network join; reprojection of the sewer zone layer; control-point alignment; stretch generation; app shell with sign-in and map only | Alignment report (residuals), overlays per zone, crossings list, stretch map, totals vs BOQ |
| 2 Field workflows | Stretches and status (18 items, road types, stages, themes, badges, validation), issues, change requests, labour, approvals, offline outbox, live updates | Demo on phone + end-to-end API test results |
| 3 Compliance | Settings list with versions, Compliance tab, gates, due/overdue, verification, bulk recording, compliance issues | Test results + walk-through |
| 4 Dashboard and reports | Shared figures module, dashboard, map layers, Excel/KML/GeoJSON, printable ward reports | Dashboard on the full network + phone performance numbers |
| 5 Deployment | Docker Compose, Caddy, backups and tested restore, upgrade check, release zip, AWS and Linux guides, Word guides | Clean install + upgrade check results |

**Technology:** as in the brief (Node 24 LTS + Fastify, PostgreSQL / PGlite, TypeScript shared rules, React +
Vite + MapLibre + PMTiles, PWA). Node 24 is already installed here.

**Project layout (proposed):** inside `C:\Users\jaipa\Desktop\WGL_V2`:
- `inputs/`: the originals, moved here unchanged
- `pipeline/`
- `app/` (server, web, shared)
- `docs/`
- `NOTES.md` (working notes)

**Telugu:** possible later. All screen text will sit in one translation file from the start. Adding Telugu
means translating about 600 strings, plus Telugu fonts in the Word guides.
