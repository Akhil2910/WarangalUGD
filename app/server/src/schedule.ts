/**
 * Project definition and timeline (the Project tab).
 *  - Definition: sanction and funding details, scope; packages (contractor, agreement, value, dates, wards).
 *  - Timeline: phases, activities and milestones (Gantt) per package or for the whole project; the first plan is kept as the baseline.
 *  - Monthly targets (pipe km, manholes, house connections, road restored km), shown against actual progress (S-curve).
 *    Actual progress is worked out from the work-stretch updates, month by month, in each package's wards.
 *  - Extensions of time with their history; the latest one gives the revised completion date.
 *  - The plan can be downloaded and uploaded as an Excel work programme (preview first), and edited line by line.
 * package_id 0 = the whole project.
 */
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDays, indiaDate, type WorkStatus } from 'shared';
import { HttpError, type SessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { checkFiles } from './files.ts';
import { has } from './perms.ts';
import { cur } from './ulbctx.ts';
import { iso, parse, type Q } from './works.ts';

const U = () => Number(cur());
export const MEASURES = [
  { key: 'pipe_km', label: 'Sewer pipe laid', unit: 'km' },
  { key: 'manholes', label: 'Manholes built', unit: '' },
  { key: 'ics', label: 'House connections (ICs)', unit: '' },
  { key: 'road_km', label: 'Road restored', unit: 'km' },
] as const;
type Measure = (typeof MEASURES)[number]['key'];
const MKEYS = MEASURES.map((m) => m.key) as Measure[];

const d10 = (v: unknown) => (v ? String(iso(v)).slice(0, 10) : null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31.');
const optDay = day.nullable().optional();
const monthKey = (d: string) => d.slice(0, 7);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const nextMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Pkg { id: number; code: string; name: string; contractor: string; agreement_no: string; agreement_date: string | null; appointed_date: string | null; original_completion: string | null; value_cr: number | null; wards: number[]; note: string; sort: number; active: boolean }
interface Act { id: number; package_id: number; code: string; parent_code: string; name: string; kind: 'phase' | 'activity' | 'milestone'; planned_start: string | null; planned_finish: string | null; baseline_start: string | null; baseline_finish: string | null; actual_start: string | null; actual_finish: string | null; pct: number; weight: number; note: string; sort: number }

async function event(q: Q, by: string | null, kind: string, ref: string, detail: unknown = {}) {
  await q(`INSERT INTO project_plan_events (ulb_id, by_user, kind, ref, detail) VALUES (${U()}, $1, $2, $3, $4)`, [by, kind, ref, JSON.stringify(detail)]);
}

// ---------------- reading everything ----------------
async function loadPlan(q: Q) {
  const [s] = await q<{ name: string; work_start: unknown; completion: unknown; definition: Record<string, unknown> }>(
    `SELECT name, work_start, completion, definition FROM project_settings WHERE ulb_id = ${U()}`);
  const packages = (await q<Pkg & { agreement_date: unknown; appointed_date: unknown; original_completion: unknown; value_cr: unknown }>(
    `SELECT id, code, name, contractor, agreement_no, agreement_date, appointed_date, original_completion, value_cr, wards, note, sort, active FROM project_packages WHERE ulb_id = ${U()} ORDER BY sort, code`))
    .map((p) => ({ ...p, id: Number(p.id), agreement_date: d10(p.agreement_date), appointed_date: d10(p.appointed_date), original_completion: d10(p.original_completion), value_cr: p.value_cr == null ? null : Number(p.value_cr), wards: (p.wards ?? []).map(Number) }));
  const activities = (await q<Record<string, unknown>>(
    `SELECT id, package_id, code, parent_code, name, kind, planned_start, planned_finish, baseline_start, baseline_finish, actual_start, actual_finish, pct, weight, note, sort
     FROM project_activities WHERE ulb_id = ${U()} AND active ORDER BY package_id, sort, code`))
    .map((a) => ({
      ...a, id: Number(a.id), package_id: Number(a.package_id), pct: Number(a.pct), weight: Number(a.weight), sort: Number(a.sort),
      planned_start: d10(a.planned_start), planned_finish: d10(a.planned_finish), baseline_start: d10(a.baseline_start), baseline_finish: d10(a.baseline_finish),
      actual_start: d10(a.actual_start), actual_finish: d10(a.actual_finish),
    }) as Act);
  const targets = (await q<{ package_id: number; month: unknown; measure: Measure; planned: unknown }>(`SELECT package_id, month, measure, planned FROM project_targets WHERE ulb_id = ${U()} ORDER BY month`))
    .map((t) => ({ package_id: Number(t.package_id), month: monthKey(d10(t.month)!), measure: t.measure, planned: Number(t.planned) }));
  const eots = (await q<Record<string, unknown>>(
    `SELECT e.id, e.package_id, e.eot_no, e.approved_on, e.to_date, e.reason, e.files, e.created_at, u.name AS by_name FROM project_eots e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.ulb_id = ${U()} ORDER BY e.package_id, e.to_date, e.id`))
    .map((e) => ({ ...e, id: Number(e.id), package_id: Number(e.package_id), approved_on: d10(e.approved_on), to_date: d10(e.to_date), created_at: iso(e.created_at) }));
  const settings = { name: s?.name ?? 'UGD Project', work_start: d10(s?.work_start), completion: d10(s?.completion), ...(s?.definition ?? {}) };
  return { settings, packages, activities, targets, eots: eots as { id: number; package_id: number; eot_no: string; approved_on: string | null; to_date: string; reason: string; files: unknown; created_at: string; by_name: string | null }[] };
}

/** Actual progress at the end of each month, from the work-stretch updates (cumulative), for the whole project and each package. */
async function actualByMonth(q: Q, months: string[], packages: Pkg[], today: string) {
  const out: Record<number, Record<Measure, (number | null)[]>> = {};
  const blank = () => Object.fromEntries(MKEYS.map((k) => [k, months.map((m) => (m <= monthKey(today) ? 0 : null))])) as Record<Measure, (number | null)[]>;
  out[0] = blank();
  for (const p of packages) out[p.id] = blank();
  if (!months.length) return out;
  const st = await q<{ code: string; ward: number; length_m: number }>(`SELECT code, ward, length_m FROM stretches WHERE ulb_id = ${U()} AND source = 'site' AND deleted_at IS NULL AND NOT hidden`);
  const hist = await q<{ stretch_code: string; at: unknown; snapshot: { status?: WorkStatus } }>(
    `SELECT h.stretch_code, h.at, h.snapshot FROM stretch_history h JOIN stretches s ON s.code = h.stretch_code
     WHERE s.ulb_id = ${U()} AND s.source = 'site' AND s.deleted_at IS NULL AND NOT s.hidden ORDER BY h.stretch_code, h.at, h.id`);
  const byCode = new Map<string, { at: string; s: WorkStatus }[]>();
  for (const h of hist) if (h.snapshot?.status) byCode.set(h.stretch_code, [...(byCode.get(h.stretch_code) ?? []), { at: indiaDate(new Date(String(iso(h.at)))), s: h.snapshot.status }]);
  const val = (s: WorkStatus, len: number): Record<Measure, number> => ({
    pipe_km: (s.pipeline === 'laid' ? len : s.pipeline === 'partly' ? Math.min(s.pipe_laid_m ?? 0, len) : 0) / 1000,
    manholes: s.manholes_built ?? 0, ics: s.ics_built ?? 0, road_km: s.restoration === 'done' ? len / 1000 : 0,
  });
  const pkgOf = (ward: number) => packages.filter((p) => p.wards.includes(ward)).map((p) => p.id);
  for (const w of st) {
    const snaps = byCode.get(w.code) ?? [];
    if (!snaps.length) continue;
    const targets = [0, ...pkgOf(Number(w.ward))];
    let k = 0;
    let curV: Record<Measure, number> | null = null;
    months.forEach((m, i) => {
      if (m > monthKey(today)) return;
      const end = monthEnd(m);
      while (k < snaps.length && snaps[k].at <= end) curV = val(snaps[k++].s, Number(w.length_m));
      if (!curV) return;
      for (const t of targets) for (const mk of MKEYS) out[t][mk][i] = (out[t][mk][i] ?? 0) + curV[mk];
    });
  }
  for (const t of Object.values(out)) for (const mk of MKEYS) t[mk] = t[mk].map((v) => (v == null ? null : r2(v)));
  return out;
}

/** Everything the Project tab shows. */
export async function projectPlan(q: Q, u: SessionUser | null, today = indiaDate()) {
  const p = await loadPlan(q);
  const live = p.packages.filter((x) => x.active);
  // months shown: from the earliest start to the latest finish (and at least to this month)
  const dates = [p.settings.work_start, p.settings.completion, ...live.flatMap((x) => [x.appointed_date, x.original_completion]), ...p.eots.map((e) => e.to_date),
    ...p.activities.flatMap((a) => [a.planned_start, a.planned_finish, a.baseline_start, a.baseline_finish, a.actual_start, a.actual_finish]), ...p.targets.map((t) => `${t.month}-01`), today]
    .filter(Boolean) as string[];
  const first = monthKey(dates.reduce((a, b) => (a < b ? a : b), today));
  const last = monthKey(dates.reduce((a, b) => (a > b ? a : b), today));
  const months: string[] = [];
  for (let m = first; m <= last && months.length < 180; m = nextMonth(m)) months.push(m);
  const actual = await actualByMonth(q, months, live, today);

  // planned (cumulative) per scope and measure; the whole project = its own targets, or else the sum of the packages'
  const planned: Record<number, Record<Measure, number[]>> = {};
  const scopes = [0, ...live.map((x) => x.id)];
  for (const sc of scopes) {
    const own = p.targets.filter((t) => t.package_id === sc);
    const rows = sc === 0 && !own.length ? p.targets.filter((t) => live.some((x) => x.id === t.package_id)) : own;
    planned[sc] = Object.fromEntries(MKEYS.map((mk) => {
      let c = 0;
      return [mk, months.map((m) => (c += rows.filter((t) => t.month === m && t.measure === mk).reduce((a, t) => a + t.planned, 0), r2(c)))];
    })) as Record<Measure, number[]>;
  }

  // summary per scope
  const thisMonth = months.indexOf(monthKey(today));
  const summary = scopes.map((sc) => {
    const pk = live.find((x) => x.id === sc);
    const start = pk?.appointed_date ?? pk?.agreement_date ?? p.settings.work_start ?? null;
    const original = pk?.original_completion ?? p.settings.completion ?? null;
    const ext = p.eots.filter((e) => e.package_id === sc).sort((a, b) => (a.to_date < b.to_date ? -1 : 1));
    let revised = ext.length ? ext[ext.length - 1].to_date : original;
    // the whole project ends when its last package ends (with their extensions)
    if (sc === 0) for (const x of live) {
      const xe = p.eots.filter((e) => e.package_id === x.id).map((e) => e.to_date).sort();
      const xr = xe.length ? xe[xe.length - 1] : x.original_completion;
      if (xr && (!revised || xr > revised)) revised = xr;
    }
    const allExt = sc === 0 ? p.eots.length : ext.length;
    const time_pct = start && revised && revised > start ? Math.max(0, Math.min(100, Math.round((daysBetween(start, today) / daysBetween(start, revised)) * 1000) / 10)) : null;
    const acts = p.activities.filter((a) => (sc === 0 ? true : a.package_id === sc) && a.kind === 'activity');
    const wsum = acts.reduce((a, x) => a + x.weight, 0);
    const work_pct = wsum ? Math.round((acts.reduce((a, x) => a + x.weight * (x.actual_finish ? 100 : x.pct), 0) / wsum) * 10) / 10 : null;
    const pl = planned[sc].pipe_km;
    const totalPlan = pl[pl.length - 1] ?? 0;
    const plannedNow = thisMonth >= 0 ? pl[thisMonth] : 0;
    const actualNow = thisMonth >= 0 ? actual[sc]?.pipe_km[thisMonth] ?? 0 : 0;
    // slippage: how long ago the plan reached today's actual progress
    let slip_days = 0;
    if (totalPlan && actualNow! < plannedNow) {
      const i = pl.findIndex((v) => v >= actualNow!);
      if (i >= 0) {
        const prev = i ? pl[i - 1] : 0;
        const frac = pl[i] > prev ? (actualNow! - prev) / (pl[i] - prev) : 1;
        const startOfMonth = `${months[i]}-01`;
        const reached = addDays(startOfMonth, Math.round(frac * daysBetween(startOfMonth, monthEnd(months[i]))));
        slip_days = Math.max(0, daysBetween(reached, today));
      }
    }
    const items = p.activities.filter((a) => sc === 0 || a.package_id === sc);
    const late = items.filter((a) => a.kind !== 'phase' && !a.actual_finish && a.planned_finish && a.planned_finish < today);
    const next = items.filter((a) => a.kind === 'milestone' && !a.actual_finish && a.planned_finish && a.planned_finish >= today).sort((a, b) => (a.planned_finish! < b.planned_finish! ? -1 : 1)).slice(0, 3);
    return {
      package_id: sc, start, original_completion: original, revised_completion: revised, extension_days: original && revised ? Math.max(0, daysBetween(original, revised)) : 0, eots: allExt,
      time_pct, work_pct, pipe_planned_now: plannedNow, pipe_actual_now: actualNow, pipe_planned_total: totalPlan, slip_days,
      late: late.map((a) => ({ id: a.id, package_id: a.package_id, code: a.code, name: a.name, kind: a.kind, planned_finish: a.planned_finish, days: daysBetween(a.planned_finish!, today) })),
      next: next.map((a) => ({ id: a.id, package_id: a.package_id, code: a.code, name: a.name, planned_finish: a.planned_finish })),
    };
  });
  return {
    today, settings: p.settings, packages: p.packages, activities: p.activities, targets: p.targets, eots: p.eots,
    months, planned, actual, summary, measures: MEASURES,
    can: { plan: !!u && has(u, 'project.plan'), progress: !!u && (has(u, 'project.progress') || has(u, 'project.plan')) },
  };
}

/** Late activities and milestones for My tasks (people who plan or record progress). */
export async function scheduleTasks(q: Q, u: SessionUser) {
  if (!has(u, 'project.plan') && !has(u, 'project.progress')) return [];
  const today = indiaDate();
  const rows = await q<{ id: string; code: string; name: string; kind: string; planned_finish: unknown; package_id: number }>(
    `SELECT id, code, name, kind, planned_finish, package_id FROM project_activities WHERE ulb_id = ${U()} AND active AND kind <> 'phase' AND actual_finish IS NULL
     AND planned_finish IS NOT NULL AND planned_finish <= $1::date ORDER BY planned_finish LIMIT 20`, [addDays(today, 7)]);
  return rows.map((r) => {
    const due = d10(r.planned_finish)!;
    return { kind: 'project', tone: (due < today ? 'bad' : 'due') as 'bad' | 'due', title: `${r.kind === 'milestone' ? 'Milestone' : 'Activity'} ${r.code}: ${r.name}`,
      detail: due < today ? `Late by ${daysBetween(due, today)} days` : `Due ${due}`, due, link: { type: 'timeline', id: String(r.id) } };
  });
}

// ---------------- Excel work programme ----------------
const SHEETS = { packages: 'Packages', activities: 'Activities', targets: 'Monthly targets' };
const PKG_COLS = ['Code', 'Name', 'Contractor', 'Agreement no', 'Agreement date', 'Appointed date', 'Completion date', 'Value (Rs crore)', 'Wards'];
const ACT_COLS = ['Package', 'Code', 'Parent', 'Name', 'Type', 'Planned start', 'Planned finish', 'Weight'];
const TGT_COLS = ['Package', 'Month', 'Pipe km', 'Manholes', 'House connections', 'Road restored km'];

export async function planWorkbook(q: Q) {
  const p = await loadPlan(q);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UGD Tracker';
  const help = wb.addWorksheet('How to fill');
  help.columns = [{ width: 110 }];
  for (const line of [
    'Work programme: fill the three sheets and upload the file in Project → Plan. You see what will change before anything is saved.',
    'Packages: one row per contract package. Wards: ward numbers separated by commas (progress of those wards counts for the package). Leave the sheet empty for a single contract.',
    'Activities: Package = package code, or empty for the whole project. Code = your own number (1, 1.1, 1.2 …), kept when you upload again. Parent = code of the phase it belongs to.',
    'Type = Phase, Activity or Milestone. A milestone needs only Planned finish. Weight = share of the work (used for % done; default 1).',
    'Monthly targets: Month = any date in the month (or "Apr 2027"). Amounts are for that month only (not running totals). Package empty = whole project.',
    'Uploading again updates the plan: rows with the same Package + Code are changed, new rows added, rows no longer in the file are removed. Actual dates and % done are kept.',
    'Dates: Excel dates, or written as 2027-03-31 or 31-03-2027.',
  ]) help.addRow([line]);
  const sheet = (name: string, cols: string[], rows: unknown[][]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(cols).font = { bold: true };
    ws.columns = cols.map((c) => ({ width: Math.max(12, c.length + 4) }));
    for (const r of rows) ws.addRow(r);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const dt = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);
  const codeOf = (id: number) => p.packages.find((x) => x.id === id)?.code ?? '';
  sheet(SHEETS.packages, PKG_COLS, p.packages.filter((x) => x.active).map((x) => [x.code, x.name, x.contractor, x.agreement_no, dt(x.agreement_date), dt(x.appointed_date), dt(x.original_completion), x.value_cr, x.wards.join(', ')]));
  sheet(SHEETS.activities, ACT_COLS, p.activities.map((a) => [codeOf(a.package_id), a.code, a.parent_code, a.name, a.kind[0].toUpperCase() + a.kind.slice(1), dt(a.planned_start), dt(a.planned_finish), a.weight]));
  const tk = new Map<string, Record<string, number>>();
  for (const t of p.targets) {
    const k = `${t.package_id}|${t.month}`;
    tk.set(k, { ...(tk.get(k) ?? {}), [t.measure]: t.planned });
  }
  sheet(SHEETS.targets, TGT_COLS, [...tk.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => {
    const [pid, m] = k.split('|');
    return [codeOf(Number(pid)), dt(`${m}-01`), v.pipe_km ?? null, v.manholes ?? null, v.ics ?? null, v.road_km ?? null];
  }));
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => { if (c.value instanceof Date) c.numFmt = 'dd-mmm-yyyy'; }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * The work-programme template: "How to fill", then the three sheets with example rows (shaded yellow) for two packages,
 * dated from the project's start month. Uploading it unchanged works (the examples pass every check).
 */
export async function planTemplate(start: string) {
  const NAVY = 'FF0E1E45', BLUE = 'FF2563EB', EX = 'FFFFF8E1';
  const y0 = Number(start.slice(0, 4)), m0 = Number(start.slice(5, 7)) - 1;
  const first = (m: number) => new Date(Date.UTC(y0, m0 + m, 1));
  const last = (m: number) => new Date(Date.UTC(y0, m0 + m + 1, 0));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UGD Tracker';

  const help = wb.addWorksheet('How to fill', { properties: { tabColor: { argb: BLUE } } });
  help.columns = [{ width: 4 }, { width: 120 }];
  const lines: [string, string][] = [
    ['h', 'UGD Tracker · Work programme template'],
    ['', 'Fill the three sheets, save as Excel Workbook (.xlsx), then upload it: Project → Plan → Upload Excel. You see what will change before anything is saved.'],
    ['', 'The yellow rows are EXAMPLES. Replace them with your own programme, or delete them.'],
    ['h', '1. Packages (leave empty if the whole project is one contract)'],
    ['', 'Code: up to 12 letters or digits, e.g. PKG-1. It links Activities and Monthly targets to the package.'],
    ['', 'Agreement date, Appointed date (work start) and Completion date as per the agreement. Value (Rs crore): contract value, e.g. 214.2.'],
    ['', 'Wards: ward numbers separated by commas, e.g. 1, 2, 3. Work done in these wards counts as this package’s actual progress.'],
    ['h', '2. Activities (the Gantt timeline)'],
    ['', 'Package: the package code, or empty for a whole-project line.'],
    ['', 'Code: your own numbering (1, 1.1, 1.2 …). Keep it the same when you upload again: lines are matched by Package + Code.'],
    ['', 'Parent: the Code of the phase the line belongs to (empty for a top-level phase).'],
    ['', 'Type: Phase, Activity or Milestone (choose from the list). A phase without dates spans its activities. A milestone needs only Planned finish.'],
    ['', 'Weight: share of the work used for “% work done” (bigger = more important). Default 1; milestones 0.'],
    ['h', '3. Monthly targets (the planned S-curve)'],
    ['', 'Package: the package code, or empty for the whole project. If only packages have targets, the whole project is their total.'],
    ['', 'Month: any date in that month, or text like “Apr 2026”.'],
    ['', 'Quantities are FOR THAT MONTH ONLY, not running totals: Pipe km, Manholes, House connections, Road restored km. Leave a cell empty if nothing is planned.'],
    ['h', 'Uploading again'],
    ['', 'Changed lines are updated, new lines added, lines no longer in the file removed. Actual dates and % done already recorded are kept.'],
    ['', 'The original plan (baseline) is kept unless you tick “Make these dates the new original plan”, so slippage stays visible.'],
    ['', 'Project → Plan → Download current plan gives the same sheets filled with what is saved now, to edit and upload again.'],
    ['h', 'Dates'],
    ['', 'Excel dates, or written as 2026-03-31 or 31-03-2026.'],
  ];
  for (const [k, t] of lines) {
    const r = help.addRow(['', t]);
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    if (k === 'h') { r.getCell(2).font = { bold: true, size: 13, color: { argb: NAVY } }; r.height = 24; }
  }
  help.getRow(1).getCell(2).font = { bold: true, size: 16, color: { argb: BLUE } };

  const sheet = (name: string, cols: string[], widths: number[], rows: unknown[][]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c, i) => ({ header: c, width: widths[i] }));
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    h.height = 22;
    for (const r of rows) {
      const row = ws.addRow(r);
      for (let n = 1; n <= cols.length; n++) row.getCell(n).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EX } };
    }
    return ws;
  };

  const wsP = sheet(SHEETS.packages, PKG_COLS, [12, 28, 26, 16, 16, 16, 16, 16, 40], [
    ['PKG-1', 'Package 1 (East)', '[Contractor name]', 'AG/UGD/01', first(-1), first(0), last(23), 214.2, '1, 2, 3, 4, 5, 6, 7, 8, 9, 10'],
    ['PKG-2', 'Package 2 (West)', '[Contractor name]', 'AG/UGD/02', first(0), first(1), last(24), 198.3, '11, 12, 13, 14, 15, 16, 17, 18, 19, 20'],
  ]);
  for (const c of [5, 6, 7]) wsP.getColumn(c).numFmt = 'dd-mmm-yyyy';
  wsP.getColumn(8).numFmt = '0.00';

  const acts: unknown[][] = [];
  for (const [pkg, off] of [['PKG-1', 0], ['PKG-2', 1]] as const) {
    const s = (m: number) => first(m + off), e = (m: number) => last(m + off);
    acts.push(
      [pkg, '1', '', 'Survey, design and approvals', 'Phase', null, null, null],
      [pkg, '1.1', '1', 'Topographic and utility survey', 'Activity', s(0), e(2), 1],
      [pkg, '1.2', '1', 'Network design and drawings', 'Activity', s(2), e(4), 1],
      [pkg, '1.3', '1', 'Design approval', 'Milestone', null, e(4), 0],
      [pkg, '1.4', '1', 'Road-cutting and tree permissions', 'Activity', s(1), e(5), 1],
      [pkg, '2', '', 'Sewer network', 'Phase', null, null, null],
      [pkg, '2.1', '2', 'Trunk sewers', 'Activity', s(5), e(14), 4],
      [pkg, '2.2', '2', 'Lateral sewers and manholes', 'Activity', s(6), e(19), 5],
      [pkg, '2.3', '2', 'House service connections', 'Activity', s(9), e(21), 3],
      [pkg, '2.4', '2', '50% of network laid', 'Milestone', null, e(12), 0],
      [pkg, '3', '', 'Pumping stations', 'Phase', null, null, null],
      [pkg, '3.1', '3', 'Civil works', 'Activity', s(6), e(15), 2],
      [pkg, '3.2', '3', 'Electro-mechanical works', 'Activity', s(14), e(20), 2],
      [pkg, '4', '', 'Road restoration', 'Activity', s(8), e(22), 2],
      [pkg, '5', '', 'Testing, commissioning and handover', 'Phase', null, null, null],
      [pkg, '5.1', '5', 'Hydraulic and manhole tests', 'Activity', s(10), e(22), 1],
      [pkg, '5.2', '5', 'Package completed', 'Milestone', null, e(23), 0],
    );
  }
  acts.push(['', 'M1', '', 'STP trial run', 'Milestone', null, last(21), 0], ['', 'M2', '', 'Commissioning and handover', 'Milestone', null, last(24), 0]);
  const wsA = sheet(SHEETS.activities, ACT_COLS, [12, 8, 8, 44, 12, 16, 16, 10], acts);
  for (let r = 2; r <= 500; r++) {
    wsA.getCell(`E${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Phase,Activity,Milestone"'], showErrorMessage: true, errorTitle: 'Type', error: 'Choose Phase, Activity or Milestone.' };
    wsA.getCell(`F${r}`).numFmt = 'dd-mmm-yyyy';
    wsA.getCell(`G${r}`).numFmt = 'dd-mmm-yyyy';
  }

  // example targets: a gentle S-curve over 18 months per package
  const curve = (n: number, total: number) => { const w = Array.from({ length: n }, (_, i) => Math.sin((Math.PI * (i + 0.5)) / n)); const t = w.reduce((a, b) => a + b); return w.map((x) => (x / t) * total); };
  const tg: unknown[][] = [];
  for (const [pkg, from, km, mh, hsc, road] of [['PKG-1', 5, 72, 2900, 16000, 66], ['PKG-2', 6, 64, 2600, 14000, 58]] as const) {
    const [a, b, c, d] = [curve(18, km), curve(18, mh), curve(18, hsc), curve(18, road)];
    for (let i = 0; i < 18; i++) tg.push([pkg, first(from + i), +a[i].toFixed(2), Math.round(b[i]), i >= 3 ? Math.round(c[i] * 1.2) : null, i >= 3 ? +d[i].toFixed(2) : null]);
  }
  const wsT = sheet(SHEETS.targets, TGT_COLS, [12, 14, 12, 12, 18, 18], tg);
  for (let r = 2; r <= 500; r++) wsT.getCell(`B${r}`).numFmt = 'mmm yyyy';
  wsT.getColumn(3).numFmt = '0.00';
  wsT.getColumn(6).numFmt = '0.00';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join('').trim();
    if (o.result !== undefined) return cellText(o.result as ExcelJS.CellValue);
    if (o.text) return String(o.text).trim();
  }
  return String(v).trim();
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function toDate(v: ExcelJS.CellValue): string | null | 'bad' {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10) : 'bad';
  const s = cellText(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s,]+(\d{4})$/);
  if (m && MONTHS.includes(m[2].toLowerCase())) return `${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^([A-Za-z]{3})[a-z]*[-\s,]+(\d{4})$/);
  if (m && MONTHS.includes(m[1].toLowerCase())) return `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}-01`;
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-01`;
  return 'bad';
}
const toNum = (v: ExcelJS.CellValue) => { const s = cellText(v).replace(/[, ]/g, ''); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };

interface ImportResult {
  ok: boolean; errors: string[]; warnings: string[];
  changes: { packages: { added: string[]; changed: string[] }; activities: { added: number; changed: number; removed: number }; targets: { months: number; packages: string[] } };
}

/** Read an uploaded work programme; with apply, save it (only when there are no errors). */
export async function importPlan(db: Db, u: SessionUser, buf: Buffer, apply: boolean, rebaseline: boolean): Promise<ImportResult> {
  const q: Q = db.query.bind(db);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw new HttpError(400, 'This file could not be read as an Excel workbook (.xlsx). Save it as "Excel Workbook" and try again.'); }
  const errors: string[] = [];
  const warnings: string[] = [];
  const find = (name: string) => wb.worksheets.find((w) => w.name.trim().toLowerCase() === name.toLowerCase());
  const rowsOf = (ws: ExcelJS.Worksheet | undefined, cols: string[]) => {
    if (!ws) return [] as { line: number; get: (c: string) => ExcelJS.CellValue }[];
    // row values from exceljs have gaps (index 0 is always empty): fill them so every column is checked
    const head = Array.from(ws.getRow(1).values as ExcelJS.CellValue[], (v) => cellText(v ?? null).toLowerCase());
    const idx = Object.fromEntries(cols.map((c) => [c, head.findIndex((h) => h === c.toLowerCase() || h.startsWith(c.toLowerCase().split(' (')[0]))]));
    const out: { line: number; get: (c: string) => ExcelJS.CellValue }[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const vals = row.values as ExcelJS.CellValue[];
      if (!vals.some((v) => cellText(v))) return;
      out.push({ line: n, get: (c) => (idx[c] > 0 ? vals[idx[c]] : null) });
    });
    return out;
  };
  const wsP = find(SHEETS.packages), wsA = find(SHEETS.activities), wsT = find(SHEETS.targets);
  if (!wsA && !wsT && !wsP) throw new HttpError(400, 'No "Packages", "Activities" or "Monthly targets" sheet found. Download the template from Project → Plan and fill it in.');

  const cur0 = await loadPlan(q);
  // packages
  const pkgRows = rowsOf(wsP, PKG_COLS).map((r) => {
    const code = cellText(r.get('Code')).toUpperCase().replace(/\s+/g, '-');
    const dates = (['Agreement date', 'Appointed date', 'Completion date'] as const).map((c) => toDate(r.get(c)));
    dates.forEach((d, i) => { if (d === 'bad') errors.push(`Packages row ${r.line}: ${['Agreement date', 'Appointed date', 'Completion date'][i]} is not a date.`); });
    const value = toNum(r.get('Value (Rs crore)'));
    if (Number.isNaN(value)) errors.push(`Packages row ${r.line}: value is not a number.`);
    if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(code)) errors.push(`Packages row ${r.line}: code "${code}" — use up to 12 letters / digits (e.g. PKG-1).`);
    const name = cellText(r.get('Name'));
    if (!name) errors.push(`Packages row ${r.line}: name is missing.`);
    const wards = cellText(r.get('Wards')).split(/[;,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return { code, name, contractor: cellText(r.get('Contractor')), agreement_no: cellText(r.get('Agreement no')), agreement_date: dates[0] as string | null, appointed_date: dates[1] as string | null, original_completion: dates[2] as string | null, value_cr: Number.isNaN(value) ? null : value, wards, line: r.line };
  });
  const dupP = pkgRows.map((x) => x.code).filter((c, i, a) => c && a.indexOf(c) !== i);
  if (dupP.length) errors.push(`Package code used twice: ${[...new Set(dupP)].join(', ')}.`);
  const pkgCodes = new Set([...cur0.packages.filter((x) => x.active).map((x) => x.code), ...pkgRows.map((x) => x.code)]);
  const pkgOfCode = (c: string, where: string) => {
    const code = c.toUpperCase().replace(/\s+/g, '-');
    if (!code) return '';
    if (!pkgCodes.has(code)) { errors.push(`${where}: package "${c}" is not in the Packages sheet or the project.`); return null; }
    return code;
  };

  // activities
  const actRows = rowsOf(wsA, ACT_COLS).map((r) => {
    const where = `Activities row ${r.line}`;
    const pkg = pkgOfCode(cellText(r.get('Package')), where);
    const code = cellText(r.get('Code'));
    const name = cellText(r.get('Name'));
    const tRaw = cellText(r.get('Type'));
    const t = tRaw.toLowerCase();
    const kind = (t.startsWith('ph') ? 'phase' : t.startsWith('mi') ? 'milestone' : t === '' || t.startsWith('ac') || t.startsWith('ta') ? 'activity' : null) as Act['kind'] | null;
    let ps = toDate(r.get('Planned start')), pf = toDate(r.get('Planned finish'));
    const w = toNum(r.get('Weight'));
    if (!code) errors.push(`${where}: Code is missing.`);
    if (!name) errors.push(`${where}: Name is missing.`);
    if (!kind) errors.push(`${where}: Type "${tRaw}" — use Phase, Activity or Milestone.`);
    if (ps === 'bad') { errors.push(`${where}: Planned start is not a date.`); ps = null; }
    if (pf === 'bad') { errors.push(`${where}: Planned finish is not a date.`); pf = null; }
    if (kind === 'milestone') { if (!pf && ps) pf = ps; ps = pf; }
    if (kind && kind !== 'phase' && !pf) errors.push(`${where}: Planned finish is missing.`);
    if (ps && pf && pf < ps) errors.push(`${where}: Planned finish is before Planned start.`);
    if (w !== null && (Number.isNaN(w) || w < 0)) errors.push(`${where}: Weight must be a number of 0 or more.`);
    return { pkg, code: code.slice(0, 30), parent_code: cellText(r.get('Parent')).slice(0, 30), name: name.slice(0, 200), kind, planned_start: ps, planned_finish: pf, weight: w == null || Number.isNaN(w) ? 1 : w, line: r.line };
  });
  const keyA = (pkg: string | null, code: string) => `${pkg ?? ''}|${code}`;
  const dupA = actRows.map((a) => keyA(a.pkg, a.code)).filter((k, i, arr) => arr.indexOf(k) !== i);
  if (dupA.length) errors.push(`Activity code used twice in the same package: ${[...new Set(dupA)].slice(0, 10).map((k) => k.replace('|', ' ').trim()).join(', ')}.`);
  const codesByPkg = new Map<string, Set<string>>();
  for (const a of actRows) codesByPkg.set(a.pkg ?? '', new Set([...(codesByPkg.get(a.pkg ?? '') ?? []), a.code]));
  for (const a of actRows) if (a.parent_code && !codesByPkg.get(a.pkg ?? '')?.has(a.parent_code)) warnings.push(`Activities row ${a.line}: parent "${a.parent_code}" is not in the same package; shown at the top level.`);

  // monthly targets
  const tgtRows = rowsOf(wsT, TGT_COLS).flatMap((r) => {
    const where = `Monthly targets row ${r.line}`;
    const pkg = pkgOfCode(cellText(r.get('Package')), where);
    const m = toDate(r.get('Month'));
    if (!m || m === 'bad') { errors.push(`${where}: Month is not a date (use a date in the month, or "Apr 2027").`); return []; }
    const vals = { pipe_km: toNum(r.get('Pipe km')), manholes: toNum(r.get('Manholes')), ics: toNum(r.get('House connections')), road_km: toNum(r.get('Road restored km')) };
    for (const [k, v] of Object.entries(vals)) if (v !== null && (Number.isNaN(v) || v < 0)) errors.push(`${where}: ${k.replace('_', ' ')} must be a number of 0 or more.`);
    return Object.entries(vals).filter(([, v]) => v !== null && !Number.isNaN(v)).map(([k, v]) => ({ pkg, month: monthKey(m), measure: k as Measure, planned: v as number }));
  });

  // what will change
  const pkgId = new Map(cur0.packages.map((x) => [x.code, x.id]));
  const changes: ImportResult['changes'] = {
    packages: {
      added: pkgRows.filter((x) => !pkgId.has(x.code)).map((x) => x.code),
      changed: pkgRows.filter((x) => { const o = cur0.packages.find((y) => y.code === x.code); return o && (o.name !== x.name || o.contractor !== x.contractor || o.agreement_no !== x.agreement_no || o.agreement_date !== x.agreement_date || o.appointed_date !== x.appointed_date || o.original_completion !== x.original_completion || o.value_cr !== x.value_cr || o.wards.join() !== x.wards.join() || !o.active); }).map((x) => x.code),
    },
    activities: { added: 0, changed: 0, removed: 0 },
    targets: { months: new Set(tgtRows.map((t) => t.month)).size, packages: [...new Set(tgtRows.map((t) => t.pkg || 'Whole project'))] },
  };
  const codeOfId = (id: number) => (id === 0 ? '' : cur0.packages.find((x) => x.id === id)?.code ?? '?');
  const existing = new Map(cur0.activities.map((a) => [keyA(codeOfId(a.package_id), a.code), a]));
  if (wsA) {
    for (const a of actRows) {
      const o = existing.get(keyA(a.pkg, a.code));
      if (!o) changes.activities.added++;
      else if (o.name !== a.name || o.kind !== a.kind || o.parent_code !== a.parent_code || o.planned_start !== a.planned_start || o.planned_finish !== a.planned_finish || o.weight !== a.weight) changes.activities.changed++;
    }
    const inFile = new Set(actRows.map((a) => keyA(a.pkg, a.code)));
    changes.activities.removed = [...existing.keys()].filter((k) => !inFile.has(k)).length;
  }
  if (errors.length || !apply) return { ok: !errors.length, errors: errors.slice(0, 200), warnings: warnings.slice(0, 100), changes };

  // save, all or nothing
  await db.tx(async (t) => {
    for (const [i, x] of pkgRows.entries()) {
      await t(`INSERT INTO project_packages (ulb_id, code, name, contractor, agreement_no, agreement_date, appointed_date, original_completion, value_cr, wards, sort, active, updated_by, updated_at)
               VALUES (${U()}, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11, now())
               ON CONFLICT (ulb_id, code) DO UPDATE SET name = EXCLUDED.name, contractor = EXCLUDED.contractor, agreement_no = EXCLUDED.agreement_no, agreement_date = EXCLUDED.agreement_date,
                 appointed_date = EXCLUDED.appointed_date, original_completion = EXCLUDED.original_completion, value_cr = EXCLUDED.value_cr, wards = EXCLUDED.wards, sort = EXCLUDED.sort,
                 active = true, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [x.code, x.name, x.contractor, x.agreement_no, x.agreement_date, x.appointed_date, x.original_completion, x.value_cr, x.wards, (i + 1) * 10, u.id]);
    }
    const ids = new Map((await t<{ id: number; code: string }>(`SELECT id, code FROM project_packages WHERE ulb_id = ${U()}`)).map((x) => [x.code, Number(x.id)]));
    const pid = (c: string | null) => (c ? ids.get(c)! : 0);
    if (wsA) {
      for (const [i, a] of actRows.entries()) {
        await t(`INSERT INTO project_activities (ulb_id, package_id, code, parent_code, name, kind, planned_start, planned_finish, baseline_start, baseline_finish, weight, sort, active, updated_by, updated_at)
                 VALUES (${U()}, $1,$2,$3,$4,$5,$6,$7,$6,$7,$8,$9,true,$10, now())
                 ON CONFLICT (ulb_id, package_id, code) DO UPDATE SET parent_code = EXCLUDED.parent_code, name = EXCLUDED.name, kind = EXCLUDED.kind,
                   planned_start = EXCLUDED.planned_start, planned_finish = EXCLUDED.planned_finish,
                   baseline_start = CASE WHEN $11::boolean OR project_activities.baseline_finish IS NULL THEN EXCLUDED.planned_start ELSE project_activities.baseline_start END,
                   baseline_finish = CASE WHEN $11::boolean OR project_activities.baseline_finish IS NULL THEN EXCLUDED.planned_finish ELSE project_activities.baseline_finish END,
                   weight = EXCLUDED.weight, sort = EXCLUDED.sort, active = true, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [pid(a.pkg), a.code, a.parent_code, a.name, a.kind, a.planned_start, a.planned_finish, a.weight, (i + 1) * 10, u.id, rebaseline]);
      }
      const keep = actRows.map((a) => `${pid(a.pkg)}|${a.code}`);
      await t(`UPDATE project_activities SET active = false, updated_at = now() WHERE ulb_id = ${U()} AND active AND NOT ((package_id::text || '|' || code) = ANY($1::text[]))`, [keep]);
    }
    if (wsT) {
      const pids = [...new Set(tgtRows.map((x) => pid(x.pkg)))];
      if (pids.length) await t(`DELETE FROM project_targets WHERE ulb_id = ${U()} AND package_id = ANY($1::int[])`, [pids]);
      const sum = new Map<string, number>();
      for (const x of tgtRows) { const k = `${pid(x.pkg)}|${x.month}|${x.measure}`; sum.set(k, (sum.get(k) ?? 0) + x.planned); }
      for (const [k, v] of sum) {
        const [p, m, mk] = k.split('|');
        await t(`INSERT INTO project_targets (ulb_id, package_id, month, measure, planned) VALUES (${U()}, $1, $2, $3, $4)`, [Number(p), `${m}-01`, mk, v]);
      }
    }
    await event(t, u.id, 'plan_imported', '', { ...changes, rebaseline });
  });
  return { ok: true, errors: [], warnings, changes };
}

// ---------------- routes ----------------
const definitionBody = z.object({
  name: z.string().trim().min(3).max(160), work_start: optDay, completion: optDay,
  scheme: z.string().trim().max(160).default(''), description: z.string().trim().max(2000).default(''),
  as_no: z.string().trim().max(80).default(''), as_date: optDay, ts_no: z.string().trim().max(80).default(''), ts_date: optDay,
  sanctioned_cost_cr: z.number().min(0).max(1e6).nullable().optional(), dlp_months: z.number().int().min(0).max(240).nullable().optional(),
  scope: z.object({ pipe_km: z.number().min(0).nullable().optional(), manholes: z.number().int().min(0).nullable().optional(), ics: z.number().int().min(0).nullable().optional(), road_km: z.number().min(0).nullable().optional(), pumping_stations: z.number().int().min(0).nullable().optional(), stp_mld: z.number().min(0).nullable().optional() }).default({}),
});
const packageBody = z.object({
  id: z.number().int().optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,11}$/, 'Code: up to 12 letters or digits (e.g. PKG-1).'),
  name: z.string().trim().min(2).max(160), contractor: z.string().trim().max(160).default(''), agreement_no: z.string().trim().max(80).default(''),
  agreement_date: optDay, appointed_date: optDay, original_completion: optDay, value_cr: z.number().min(0).max(1e6).nullable().optional(),
  wards: z.array(z.number().int().min(1).max(500)).max(500).default([]), note: z.string().max(1000).default(''), active: z.boolean().default(true),
});
const activityBody = z.object({
  id: z.number().int().optional(), package_id: z.number().int().min(0).default(0), code: z.string().trim().min(1).max(30), parent_code: z.string().trim().max(30).default(''),
  name: z.string().trim().min(2).max(200), kind: z.enum(['phase', 'activity', 'milestone']), planned_start: optDay, planned_finish: optDay, weight: z.number().min(0).max(1e6).default(1),
});
const progressBody = z.object({ actual_start: optDay, actual_finish: optDay, pct: z.number().min(0).max(100).optional(), note: z.string().trim().max(1000).default('') });
const eotBody = z.object({
  package_id: z.number().int().min(0).default(0), eot_no: z.string().trim().max(80).default(''), approved_on: optDay, to_date: day,
  reason: z.string().trim().min(5, 'Give the reason for the extension.').max(2000), files: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200), kind: z.enum(['photo', 'document']) })).max(10).default([]),
});

export function registerSchedule(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 200 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  }
  const planner = (u: SessionUser) => { if (!has(u, 'project.plan')) throw new HttpError(403, 'Your role cannot change the project plan.'); return u; };
  const pkgExists = async (id: number) => { if (id && !(await q(`SELECT 1 FROM project_packages WHERE id = $1 AND ulb_id = ${U()}`, [id])).length) throw new HttpError(400, 'Package not found.'); };

  app.get('/api/project/plan', async (req) => projectPlan(q, req.user!));

  app.post('/api/project/definition', async (req) => {
    const u = planner(req.user!);
    const b = parse(definitionBody, req.body);
    if (b.work_start && b.completion && b.completion < b.work_start) throw new HttpError(400, 'Completion is before the work start.');
    const { name, work_start, completion, ...def } = b;
    await q(`UPDATE project_settings SET name = $1, work_start = $2, completion = $3, definition = $4, updated_at = now(), updated_by = $5 WHERE ulb_id = ${U()}`,
      [name, work_start ?? null, completion ?? null, JSON.stringify(def), u.id]);
    await event(q, u.id, 'definition_saved', '', b);
    return { ok: true };
  });

  app.post('/api/project/packages', async (req) => {
    const u = planner(req.user!);
    const b = parse(packageBody, req.body);
    if (b.appointed_date && b.original_completion && b.original_completion < b.appointed_date) throw new HttpError(400, 'Completion is before the appointed date.');
    const clash = (await q<{ id: number }>(`SELECT id FROM project_packages WHERE ulb_id = ${U()} AND code = $1`, [b.code]))[0];
    if (clash && Number(clash.id) !== b.id) throw new HttpError(409, `A package with the code ${b.code} already exists.`);
    const vals = [b.code, b.name, b.contractor, b.agreement_no, b.agreement_date ?? null, b.appointed_date ?? null, b.original_completion ?? null, b.value_cr ?? null, b.wards, b.note, b.active, u.id];
    if (b.id) {
      const r = await q(`UPDATE project_packages SET code=$1, name=$2, contractor=$3, agreement_no=$4, agreement_date=$5, appointed_date=$6, original_completion=$7, value_cr=$8, wards=$9, note=$10, active=$11, updated_by=$12, updated_at=now()
                         WHERE id = $13 AND ulb_id = ${U()} RETURNING id`, [...vals, b.id]);
      if (!r.length) throw new HttpError(404, 'Package not found.');
    } else {
      await q(`INSERT INTO project_packages (ulb_id, code, name, contractor, agreement_no, agreement_date, appointed_date, original_completion, value_cr, wards, note, active, updated_by, sort)
               VALUES (${U()}, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, (SELECT COALESCE(max(sort), 0) + 10 FROM project_packages WHERE ulb_id = ${U()}))`, vals);
    }
    await event(q, u.id, b.id ? 'package_changed' : 'package_added', b.code, b);
    return { ok: true };
  });

  app.post('/api/project/activities', async (req) => {
    const u = planner(req.user!);
    const b = parse(activityBody, req.body);
    await pkgExists(b.package_id);
    let ps = b.planned_start ?? null, pf = b.planned_finish ?? null;
    if (b.kind === 'milestone') { pf = pf ?? ps; ps = pf; }
    if (b.kind !== 'phase' && !pf) throw new HttpError(400, 'Give the planned finish date.');
    if (ps && pf && pf < ps) throw new HttpError(400, 'Planned finish is before planned start.');
    const clash = (await q<{ id: number }>(`SELECT id FROM project_activities WHERE ulb_id = ${U()} AND package_id = $1 AND code = $2`, [b.package_id, b.code]))[0];
    if (clash && Number(clash.id) !== b.id) {
      if (!b.id) { // a removed line with the same code comes back
        await q(`UPDATE project_activities SET active = true WHERE id = $1`, [clash.id]);
        b.id = Number(clash.id);
      } else throw new HttpError(409, `Code ${b.code} is already used in this package.`);
    }
    if (b.id) {
      const r = await q(`UPDATE project_activities SET package_id=$1, code=$2, parent_code=$3, name=$4, kind=$5, planned_start=$6, planned_finish=$7, weight=$8,
                           baseline_start = COALESCE(baseline_start, $6), baseline_finish = COALESCE(baseline_finish, $7), updated_by=$9, updated_at=now()
                         WHERE id = $10 AND ulb_id = ${U()} RETURNING id`, [b.package_id, b.code, b.parent_code, b.name, b.kind, ps, pf, b.weight, u.id, b.id]);
      if (!r.length) throw new HttpError(404, 'Activity not found.');
    } else {
      await q(`INSERT INTO project_activities (ulb_id, package_id, code, parent_code, name, kind, planned_start, planned_finish, baseline_start, baseline_finish, weight, updated_by, sort)
               VALUES (${U()}, $1,$2,$3,$4,$5,$6,$7,$6,$7,$8,$9, (SELECT COALESCE(max(sort), 0) + 10 FROM project_activities WHERE ulb_id = ${U()}))`,
        [b.package_id, b.code, b.parent_code, b.name, b.kind, ps, pf, b.weight, u.id]);
    }
    await event(q, u.id, b.id ? 'activity_changed' : 'activity_added', b.code, { ...b, planned_start: ps, planned_finish: pf });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/project/activities/:id/remove', async (req) => {
    const u = planner(req.user!);
    const r = await q<{ code: string }>(`UPDATE project_activities SET active = false, updated_by = $2, updated_at = now() WHERE id = $1 AND ulb_id = ${U()} AND active RETURNING code`, [Number(req.params.id), u.id]);
    if (!r.length) throw new HttpError(404, 'Activity not found.');
    await event(q, u.id, 'activity_removed', r[0].code);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/project/activities/:id/progress', async (req) => {
    const u = req.user!;
    if (!has(u, 'project.progress') && !has(u, 'project.plan')) throw new HttpError(403, 'Your role does not record progress on the timeline.');
    const b = parse(progressBody, req.body);
    const today = indiaDate();
    for (const d of [b.actual_start, b.actual_finish]) if (d && d > today) throw new HttpError(400, 'An actual date cannot be in the future.');
    if (b.actual_start && b.actual_finish && b.actual_finish < b.actual_start) throw new HttpError(400, 'Actual finish is before actual start.');
    const a = (await q<{ code: string; kind: string; pct: number }>(`SELECT code, kind, pct FROM project_activities WHERE id = $1 AND ulb_id = ${U()} AND active`, [Number(req.params.id)]))[0];
    if (!a) throw new HttpError(404, 'Activity not found.');
    const pct = b.actual_finish ? 100 : a.kind === 'milestone' ? 0 : b.pct ?? Number(a.pct);
    await q(`UPDATE project_activities SET actual_start = $2, actual_finish = $3, pct = $4, note = $5, updated_by = $6, updated_at = now() WHERE id = $1`,
      [Number(req.params.id), a.kind === 'milestone' ? b.actual_finish ?? null : b.actual_start ?? null, b.actual_finish ?? null, pct, b.note, u.id]);
    await event(q, u.id, 'progress', a.code, { ...b, pct });
    return { ok: true };
  });

  app.post('/api/project/eots', async (req) => {
    const u = planner(req.user!);
    const b = parse(eotBody, req.body);
    await pkgExists(b.package_id);
    await checkFiles(db, b.files.map((f) => f.id), 'document');
    await q(`INSERT INTO project_eots (ulb_id, package_id, eot_no, approved_on, to_date, reason, files, created_by) VALUES (${U()}, $1,$2,$3,$4,$5,$6,$7)`,
      [b.package_id, b.eot_no, b.approved_on ?? null, b.to_date, b.reason, JSON.stringify(b.files), u.id]);
    await event(q, u.id, 'eot_added', b.eot_no, b);
    return { ok: true };
  });

  app.get('/api/project/plan/history', async () => ({
    events: (await q<Record<string, unknown>>(`SELECT e.id, e.at, e.kind, e.ref, e.detail, u.name AS by_name FROM project_plan_events e LEFT JOIN users u ON u.id = e.by_user
      WHERE e.ulb_id = ${U()} ORDER BY e.at DESC, e.id DESC LIMIT 200`)).map((e) => ({ ...e, id: Number(e.id), at: iso(e.at) })),
  }));

  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  app.get('/api/project/plan/workbook.xlsx', async (_req, reply) => {
    const buf = await planWorkbook(q);
    return reply.header('content-type', XLSX).header('content-disposition', 'attachment; filename="work-programme.xlsx"').send(buf);
  });
  // the empty template with instructions and example rows (anyone signed in may download it)
  app.get('/api/project/plan/template.xlsx', async (_req, reply) => {
    const [s] = await q<{ work_start: unknown }>(`SELECT work_start FROM project_settings WHERE ulb_id = ${U()}`);
    const buf = await planTemplate(d10(s?.work_start) ?? indiaDate());
    return reply.header('content-type', XLSX).header('content-disposition', 'attachment; filename="work-programme-template.xlsx"').send(buf);
  });

  app.post<{ Querystring: { apply?: string; rebaseline?: string } }>('/api/project/plan/import', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const u = planner(req.user!);
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, 'The file is empty.');
    return importPlan(db, u, buf, req.query.apply === '1', req.query.rebaseline === '1');
  });
}
