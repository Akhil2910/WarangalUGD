# Work status and compliance: what is built (16 Nov 2026)

> **Latest change (16 Nov 2026, evening): how work is set up now.** This replaces the road stretches in
> section 1, the work stretch groups in section 7, and the drawing tools in section 8.
>
> **What changed:**
> - The pre-made DPR road stretches are **no longer used**: hidden, kept in the database, never shown or counted.
>   The trial records made while testing are hidden the same way.
> - From the DPR, only its **pipes and manholes** are shown, as the plan.
> - The colours, the status form and the compliance rules are unchanged.
>
> **Making a work stretch:** an AEE, DEE or the Commissioner presses **+ New work stretch** (on the map or the
> Works page).
> 1. **Choose the pipes:**
>    - **Tap pipes:** tap DPR pipes (pink) or drawn pipes (white) to add them. They turn yellow; tap again to
>      remove one.
>    - **Draw a new pipe:** choose the diameter and material, then tap the first manhole and the next one. A
>      manhole can be a DPR manhole, a drawn one, or any point on the image. Each new pipe is added to the work
>      stretch. **Undo last** removes the last new pipe or manhole.
>    - The panel shows the number of pipes, the metres and the manholes. If the pipes don't join end to end, it
>      notes how many **separate pieces** there are. That is allowed.
>    - **A pipe can be in only one work stretch.**
> 2. **Name it and save.** It gets a code `W<ward>-S<number>` and opens with **Status, Compliance, Issues and
>    History**.
>
> **Changing a work stretch later:** "Change pipes on the map" on its card adds or removes pipes. The change is
> recorded in its history.
>
> **Screen:**
> - **Layout:** light theme. The top bar has **Map · Works · Issues · Compliance**, search, and **A− / A+** for
>   text size.
> - **On the map:** one **Layers** button with eight switches:
>   - Satellite
>   - Work stretches
>   - DPR pipes and manholes
>   - Drawn pipes and manholes
>   - Issues
>   - Ward, GWMC zone and sewerage zone boundaries
>
>   It also holds the colour choice (work stage or compliance) and the pipe-width legend.
> - **Pipes:** one colour, with a thicker line for a bigger diameter.
> - **Boundaries:** tap inside one to select it, then **Zoom to** or **Works here**.
> - **Works page:** a count for each stage, simple filters, and one row per work stretch with a **Map** button.
> - **Full page:** "Full page" on a card opens it on its own page (`/stretch/<code>`).
>
> **Progress figures** (reports phase): work done on work stretches is shown against the DPR plan totals,
> **kept apart, not mixed**.

This adds work-status updating, monitoring and stage-wise compliance to the map app. It covers the core of
phases 2 and 3 in `docs/01` §8. The rules come from the brief (§6.1–6.8, §7). The compliance list is the
22-item list from `UGD_Compliance_Stagewise.xlsx`.

## 1. Road stretches in the database

- **36,206 stretches** were loaded from the DPR network, all *Not started*.
- Each stretch carries:
  - ward, zone, catchment and road name
  - length, pipes and planned manholes
  - metres per diameter, and the greatest depth
  - its line on the map
- **A pipe belongs to only one stretch.** The database enforces this.
- Every change adds a **history row**. It records:
  - who made the change and when
  - each field, from old to new
  - a full snapshot of the status
  - note and photos
  - GPS, and the distance from the road
  - any warnings, and any Commissioner override
- **Two people editing at once:** if someone saved after you opened the stretch, your save is refused. You
  are told to reopen the stretch, so nobody overwrites another person's update unknowingly.

## 2. Updating work status (stretch card → Status)

Open a stretch by clicking it on the map, from search, or from the Works list. Then press **Update status**.
The 18 items are in 6 groups:

| Group | Items |
|---|---|
| A Sewer work | Pipeline (not started / partly laid with metres / laid), manholes built (of planned), inspection chambers |
| B Road cutting | Not cut / road cut / trench open / back-filled, optional cut length |
| C Road restoration | Road type (CC, BT, Gravel/WBM, Earthen, Paver/tile, Brick). Restoration steps are worded for the road type. |
| D Motorability | Motorable / with difficulty / not motorable |
| E Utilities | Taps broken and restored, leakages and fixed, drain clogged |
| F Hazards | Water stagnation, potholes, uneven back-fill |

**Rules applied on the phone and again on the server:**
- **Refused:**
  - restored more than broken
  - fixed more than leakages
  - partly laid without metres, or with more metres than the stretch allows
  - a restoration step recorded with no road type
  - a road marked restored with no photo
- **Allowed, with a warning:**
  - more manholes than planned
  - back-filled before the pipeline is started
  - a cut length that is too long

**Stage (map colour)** is worked out from the status:

| Stage | When |
|---|---|
| Not started | Nothing recorded |
| Work in progress | Cut, trench open, pipe being laid, or manholes built |
| Back-filled, restoration pending | Back-filling sets restoration to *pending* automatically |
| Restoration under way | The middle restoration step of the road type |
| Restoration done, awaiting approval | Final step recorded, not yet approved |
| Restored and approved | Approved by a DEE or the Commissioner |

**Approval:**
- Approving or rejecting needs a DEE or the Commissioner. A rejection needs a reason.
- After a rejection, record the corrected work with a new photo to send it back for approval.
- Changing the road type after approval also sends it back.

## 3. Compliance against each work stage (stretch card → Compliance)

The checklist is grouped by the 9 stages of the workbook. Each item **falls due** when the work reaches its
stage (read from the status above), and **guards** a later step:

| Stage | Falls due when | Guards |
|---|---|---|
| 1 Before road cutting | Cutting or pipe work first recorded | Opening the road |
| 2 While the trench is open | Road cut / trench open | Back-filling |
| 3 During pipe laying | Pipe partly laid or laid | Marking the pipe Laid |
| 4 After pipe laying | Pipe laid | Back-filling |
| 5 Before back-fill | Pipe laid or back-filled | Back-filling |
| 6 After back-fill | Back-filled | Restoration |
| 7 Before restoration | Back-filled or restoration started | Restoration |
| 8 After restoration | Restoration done | Approval |
| 9 At completion | Restoration done | (counts in the score only) |

**Item states:**
- Not due yet
- Due
- Overdue (after its grace days, India time)
- Complied, to verify
- Verified
- Not complied
- Not applicable (with a reason)

**Recording:**
- The required evidence is enforced: photo, document, measured value, date or reference number.
- GPS and the distance from the road are stored with each record.
- **Per-unit items:** leak tests are recorded per reach, and invert levels and manhole tests per manhole, for
  pipes of 250 mm and above. Smaller ones are recorded together. Progress shows as, for example, "Leak test:
  2 of 6 reaches".
- **Measured values are checked against the pass rule.** A field density below 95%, or an invert level more
  than 50 mm from the design, is saved as **Not complied**. The design invert is shown on the form.
- **Repeating items:** barricading and night lighting must be confirmed every day the trench is open.
- **Rules by depth and road type:** shoring applies only where the design depth is 1.5 m or more. The cube
  test applies only to CC roads.

**Verifying:**
- An AEE, a DEE or the Commissioner verifies. They do this on the stretch card, or on
  **Compliance → Records and verification**.
- Nobody verifies their own record, except the Commissioner.
- A rejection needs a reason, and the item becomes due again.

**Gates:**
- Recording a guarded step while an item is not complied either **warns**: the step is saved, and the
  warning is kept in the history.
- Or it **blocks**: the save is refused, with the missing item named.
- As agreed in `docs/01`, only **"Every required permission valid"** blocks. All other items warn.
- The Commissioner may override a block, with a reason, and the reason is recorded.

**Compliance colour of a stretch:**
- grey: nothing due
- green: all due items complied
- amber: some pending
- red: a non-compliance, or an overdue mandatory item

A red stretch gets the **C** badge on the map, and tags such as "Overdue: Barricading…".

**The compliance list** is on **Compliance → Compliance list**. The Commissioner can:
- **edit** an item: this saves a new version, and old records keep the version they were made against
- add new items
- retire items, and restore them

## 4. Monitoring

- **Map:** stretches are coloured live, by **Work stage** or by **Compliance** (switch in the side panel).
  - Started stretches show from zoom 11; untouched ones from zoom 14.
  - Letter badges: T taps, L leak, D drain, W stagnation, P potholes, C non-compliance.
  - Other people's updates appear within 2 minutes, or at once after your own save.
- **Works page:**
  - count and km for each stage
  - count for each compliance colour
  - restorations awaiting approval, and records waiting for verification
  - filters by zone, ward, stage, compliance, approval, and stretch code or road
  - a sortable list; click a row to open the stretch

## 5. Trial accounts

These are for testing only. Disable them before real use.

- Trial DEE, AEE and Field Inspector: added to `app/server/seed/accounts.json`, covering the whole city.
  Their passwords are in `app-state/trial-logins.txt`.
- The Commissioner's one-time password is still in `app-state/initial-passwords.txt`, unused.
- Test entries made during the check: one stretch, **W56-0100**, has a trial permission record, "Trench
  open", and a verified barricading record. They are kept in the history; nothing is ever deleted.

## 6. Issues (added the same day)

**Three ways an issue is raised:**
- **From the stretch status, automatically.** There is one issue per kind, with a count: taps broken,
  water leakage, drain clogged, not motorable, stagnation, potholes, uneven back-fill.
  - The count follows the status, and the issue closes by itself when the damage is recorded as fixed.
  - **Resolving it** (AEE and above) also clears the damage on the stretch.
  - **Re-opening it** brings the damage back, so the next status save does not close it again.
- **From compliance, automatically.** "Compliance not met: \<item\>" is raised when an item is recorded as
  not complied (for example a failed test), or when a mandatory item is overdue.
  - It takes the item's severity.
  - It closes by itself only when the item is complied **and verified**. It cannot be closed by hand.
- **Reported by staff** from the stretch card's **Issues** tab. Kinds are drain damaged, culvert broken or
  other. A remark is required; a photo is optional.

**Each issue has:**
- a code (`I-0001`)
- its stretch, ward and zone
- a count and a severity
- a status: open, assigned or resolved
- an assignee and a due date
- photos and a full history

**Due dates:**
- **Default:** 2 days for high severity, 7 for medium, 14 for low. This is my proposal; the brief gives no
  default.
- An issue becomes **overdue** the day after its due date, India time.

**Who does what:**
- **Report:** field staff and officers of the area.
- **Resolve or re-open:** AEE and above. A note is required; a photo of the fix is optional.
- **Assign, and change the due date:** DEE and above.
- **Delete permanently:** the Commissioner only, singly or several at once, with a reason.
  - The reason and a copy of the issue are kept in the admin log.
  - Photos that nothing else uses are removed.
  - Road damage that was still open is cleared on the stretch.

**Issues page:**
- figures for open, high-severity, overdue, assigned and resolved issues
- filters: kind, zone, ward, severity, status, "assigned to me", and search
- a table that sorts by any column and remembers the choice
- a board view
- **⬇ Excel (CSV)**, which downloads exactly the filtered list in the same order. A proper .xlsx workbook
  comes with the phase-4 exports.

**Elsewhere:**
- **Map:** open issues show as pins coloured by severity. Clicking a pin opens its stretch.
- **Works list:** shows the count of open issues on each stretch.

## 7. Work stretches (one road or several, made on the map)

**Making one:**
- An **AEE, DEE or the Commissioner** presses **+ Work stretch** on the map.
- They tap roads to add them (they turn yellow); a second tap removes a road.
- The panel shows the running total: roads, km, planned manholes, wards and zones.
- Give it a name, and optionally the contractor, package and start date. It gets a code, `WS-0001`.
- **A road can be in only one work stretch.** The panel warns if a road is already in another one.

**On the map:**
- Its roads get a **cyan outline** and a label with the name, the code and the pipe laid %.
- Tapping any of its roads opens the work stretch.
- From the work stretch, each road's own card is one tap away.

**Work stretch card:**
- **Header:** pipe laid % and restored %, manholes built against planned, the compliance score, open issues, and a
  strip showing how much of the length is at each stage.
- **Status:**
  - **The table:** each road with its own stage, pipe, manholes, cutting, restoration and compliance.
  - **"Update selected roads":** tick the roads and record the same change on all of them at once, for example
    "Trench open" or "Back-filled". Each road gets its own history row.
  - **All or nothing:** if any road refuses the change (a blocking compliance, a validation error, or someone else
    updated it), nothing is saved and the reason is shown for each road.
  - **Counts are entered on each road's own card:** metres partly laid, manholes built, taps, leaks.
- **Compliance:**
  - Every item shows how many roads have it done ("2 of 3 roads").
  - Expanding an item shows each road's state.
  - **Recording for several roads:** whole-road items (permission, work board, barricading, compaction and so on)
    can be recorded **once for several roads**. Each road still gets its own record.
  - **Per-unit items** are recorded on each road: leak tests per reach, and invert levels and manhole tests per
    manhole.
  - **Verifying a batch:** a batch recorded together can be **verified or rejected in one go** by an AEE or DEE, never
    by the person who recorded it.
- **History:** the work stretch's own events (created, renamed, roads added or removed, several roads updated) and
  every change on its roads, newest first.
- **Details:** name, contractor, package, start date and note, plus **Add / remove roads on the map**. These are
  for AEE and above.

**Works page:** opens on **Work stretches**, a list with each one's roads, km, pipe laid %, restored %,
manholes, compliance and open issues. **All roads** still lists every road.

## 8. Drawing the actual work on the image (site network)

**Who can draw:** AEE, DEE and the Commissioner. Press **+ Draw work** on the map, or "Draw manholes, pipelines,
work stretch" in the side panel.

**The three tools:**
1. **① Manhole:** tap the image where a manhole is.
   - It gets a number such as `SMH-0001`, which you can change to your own number.
   - Add its depth, invert level and a note.
   - Tap an existing manhole to edit it.
2. **② Pipeline:** choose the diameter and material, then tap manhole after manhole.
   - Each tap lays a pipeline from the last point, and its length is measured.
   - Tapping empty ground places a new manhole there; tapping near an existing one joins to it.
   - **End this line** starts a new line, and **Undo last** removes the last manhole or pipeline.
3. **③ Work stretch:** tap the pipelines that make up the road or work (they turn yellow), give it a name, and press
   **Create**.
   - It gets a code such as `W56-S001`, and opens with **Status, Compliance, Issues and History**, exactly like any road.
   - It can also join a work stretch group.

**Changing it later:** "Change its pipelines on the map" on its card adds or removes pipelines, and the change is
kept in its history.

**Safeguards:**
- Pipelines that belong to a work stretch can't be deleted.
- Their manholes can't be moved or renumbered until those pipelines are taken out of the stretch.

**DPR and site networks side by side:** the DPR network stays as the plan, for comparison. The site network is the
actual work.

## 9. Map, text and pages

**Side panel sections:**
- Add work
- Boundaries
- Networks
- Colour work stretches by
- Pipelines legend
- Other layers

**Networks:**
- **DPR network (plan)** on or off.
- **Site network (drawn)** on or off.

**Boundaries:**
- Separate switches for wards, GWMC zones and sewerage zones.
- **Tap inside a boundary** to select it. It is outlined, and a box shows its details (for a ward: zone, corporator
  and population), with **Zoom to** and **Works in this ward/zone**.
- Zone buttons jump to any GWMC or sewerage zone.

**Pipelines:** one colour. **Line width shows the diameter**, from 150 mm (thin) to 1,400 mm and above (thick). DPR
pipes are pink and site pipes white.

**Finding places:**
- **Search** finds work stretches, site manholes, DPR stretches and manholes, wards, roads, or a position typed as
  latitude, longitude.
- **📍** next to every row in Works, Work stretches and Issues shows it on the map.
- The map has buttons for **my location** (follows you as you walk) and **full screen**.

**Text size:** larger by default. **A− / A+** in the header changes it for you on that device.

**Full page:** **⤢ Full page** on any card opens it on a page of its own, such as `/stretch/W56-S001` or
`/work/WS-0001`, in a new tab. The link can be bookmarked or sent to another signed-in user.

## 10. Not built yet (next steps)

**Field workflows still to build:**
- Change requests: split, merge or redraw a stretch; add a manhole or pipe
- Labour log
- Bulk updates across several stretches
- Rolling a stretch back to an earlier version

**Behaviour still to add:**
- Offline saving on the phone (outbox)
- Instant live updates (now a 2-minute refresh)

**Pages and records still to add:**
- Users page, and assigning areas to people. Accounts are created only from the seed file for now.
- Excel / KML exports, dashboard and ward reports

**Two departures from `docs/01` §7.4, for your decision:**
- Every signed-in user can **view** any stretch, while the table said "area". The whole map is visible to
  everyone anyway. **Updating** is limited to each person's area.
- The permission register does not exist yet, so "Every required permission valid" is recorded by hand,
  with the reference number and document.
