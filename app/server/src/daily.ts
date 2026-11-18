/**
 * Daily field record (Daily log).
 *  - Site staff submit one entry per work stretch per day: quantities done, labour, machines, time lost (hindrances), photos.
 *  - The ward's AEE / DEE accepts it or returns it for correction (never the person who submitted it).
 *  - An accepted entry moves the stretch's status forward to the running totals of all accepted entries, through the
 *    normal status update (history, compliance gates, stage, S-curve all follow). Totals only ever move status forward.
 *    Road restoration is reported in metres; its stages (with road type and photos) stay a normal status update.
 *  - Reports for a day or a period, by package or the whole project, on screen and as Excel.
 */
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addDays, DAILY_BACKDATE_DAYS, DAILY_LATE_AFTER_DAYS, EMPTY_QUANTITIES, HINDRANCES, indiaDate, LABOUR, MACHINES, pipeTotal,
  QUANTITY_FIELDS, type DailyQuantities, type WorkStatus,
} from 'shared';
import { HttpError, type SessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { checkFiles, gpsSchema } from './files.ts';
import { has } from './perms.ts';
import { cur } from './ulbctx.ts';
import { codeOf, inArea, iso, loadStretch, parse, saveStatus, type Q } from './works.ts';

const U = () => Number(cur());
const d10 = (v: unknown) => (v ? String(iso(v)).slice(0, 10) : null);
const r2 = (n: number) => Math.round(n * 100) / 100;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-18.');
const qty = z.number().min(0).max(100000).default(0);
const quantitiesSchema = z.object({
  excavation_m: qty, bedding_m: qty, manholes: z.number().int().min(0).max(500).default(0), ics: z.number().int().min(0).max(5000).default(0),
  backfill_m: qty, road_m: qty, pipe: z.record(z.string().regex(/^\d{2,4}$/), z.number().min(0).max(100000)).default({}),
}).default(EMPTY_QUANTITIES);
const entryBody = z.object({
  log_date: day,
  quantities: quantitiesSchema,
  labour: z.object(Object.fromEntries(LABOUR.map((l) => [l.key, z.number().int().min(0).max(2000).default(0)]))).default({}),
  machines: z.object(Object.fromEntries(MACHINES.map((m) => [m.key, z.number().int().min(0).max(200).default(0)]))).default({}),
  hindrances: z.array(z.object({ reason: z.enum(HINDRANCES.map((h) => h.key) as [string, ...string[]]), hours: z.number().min(0).max(24), note: z.string().trim().max(300).default('') })).max(10).default([]),
  remark: z.string().trim().max(2000).default(''),
  photos: z.array(z.string().uuid()).max(10).default([]),
  gps: gpsSchema,
});
const decideBody = z.object({ decision: z.enum(['accept', 'return']), note: z.string().trim().max(1000).default(''), override_reason: z.string().trim().max(1000).optional() });

interface LogRow {
  id: number; stretch_code: string; log_date: string; quantities: DailyQuantities; labour: Record<string, number>; machines: Record<string, number>;
  hindrances: { reason: string; hours: number; note: string }[]; remark: string; photos: string[]; status: 'submitted' | 'accepted' | 'returned'; late: boolean;
  submitted_by: string; submitted_by_name?: string | null; submitted_at: string; decided_by_name?: string | null; decided_at: string | null; decision_note: string; status_note: string;
}
const shapeLog = (r: Record<string, unknown>) => ({
  ...r, id: Number(r.id), log_date: d10(r.log_date), submitted_at: iso(r.submitted_at), decided_at: iso(r.decided_at),
  quantities: { ...EMPTY_QUANTITIES, ...(r.quantities as object ?? {}) },
}) as unknown as LogRow;

const LOG_SELECT = `SELECT l.*, su.name AS submitted_by_name, du.name AS decided_by_name, s.road_name, s.ward, s.admin_zone
  FROM daily_logs l JOIN stretches s ON s.code = l.stretch_code LEFT JOIN users su ON su.id = l.submitted_by LEFT JOIN users du ON du.id = l.decided_by`;

/** Running totals of a stretch's accepted entries. */
async function acceptedTotals(q: Q, code: string) {
  const rows = await q<{ quantities: DailyQuantities }>(`SELECT quantities FROM daily_logs WHERE stretch_code = $1 AND status = 'accepted'`, [code]);
  const t = { excavation_m: 0, pipe_m: 0, bedding_m: 0, manholes: 0, ics: 0, backfill_m: 0, road_m: 0 };
  for (const { quantities: x } of rows) {
    t.excavation_m += Number(x.excavation_m) || 0; t.pipe_m += pipeTotal(x); t.bedding_m += Number(x.bedding_m) || 0;
    t.manholes += Number(x.manholes) || 0; t.ics += Number(x.ics) || 0; t.backfill_m += Number(x.backfill_m) || 0; t.road_m += Number(x.road_m) || 0;
  }
  return t;
}

/**
 * The status the running totals call for. Only ever forward: anything already recorded higher stays as it is.
 * Restoration stages are not set from here: they need the road type and photos, so they stay a normal status update.
 */
export function statusFromTotals(prev: WorkStatus, length: number, planned: number, t: Awaited<ReturnType<typeof acceptedTotals>>): WorkStatus {
  const next: WorkStatus = { ...prev };
  const prevLaid = prev.pipeline === 'laid' ? length : prev.pipeline === 'partly' ? prev.pipe_laid_m ?? 0 : 0;
  if (t.pipe_m > prevLaid) {
    if (t.pipe_m >= length * 0.98) { next.pipeline = 'laid'; next.pipe_laid_m = null; }
    else { next.pipeline = 'partly'; next.pipe_laid_m = Math.round(t.pipe_m * 10) / 10; }
  }
  if (t.manholes > prev.manholes_built) next.manholes_built = planned ? Math.min(t.manholes, Math.max(planned, prev.manholes_built)) : t.manholes;
  if (t.ics > prev.ics_built) next.ics_built = t.ics;
  if (t.excavation_m > 0) {
    if (prev.cutting === 'none' || prev.cutting === 'road_cut') next.cutting = 'trench_open';
    const cut = Math.round(Math.min(t.excavation_m, length * 1.2));
    if (cut > (prev.cut_length_m ?? 0)) next.cut_length_m = cut;
  }
  const laidAll = next.pipeline === 'laid';
  if (t.backfill_m > 0 && laidAll && t.backfill_m >= Math.max(t.excavation_m, length) * 0.98 && next.cutting !== 'none') next.cutting = 'backfilled';
  if (next.cutting === 'backfilled' && next.restoration === 'not_due') next.restoration = 'pending';
  return next;
}

async function event(q: Q, logId: number, by: string, action: string, note = '') {
  await q('INSERT INTO daily_log_events (log_id, by_user, action, note) VALUES ($1, $2, $3, $4)', [logId, by, action, note]);
}

/** Wards of a package (null = whole project). */
async function packageWards(q: Q, pkg: number | null) {
  if (!pkg) return null;
  const r = (await q<{ wards: number[] }>(`SELECT wards FROM project_packages WHERE id = $1 AND ulb_id = ${U()}`, [pkg]))[0];
  if (!r) throw new HttpError(404, 'Package not found.');
  return (r.wards ?? []).map(Number);
}

// ---------------- reports ----------------
export async function dailyReport(q: Q, from: string, to: string, pkg: number | null) {
  const wards = await packageWards(q, pkg);
  const wardSql = wards ? ` AND s.ward = ANY($3::int[])` : '';
  const params: unknown[] = wards ? [from, to, wards] : [from, to];
  const logs = (await q<Record<string, unknown>>(`${LOG_SELECT} WHERE l.ulb_id = ${U()} AND l.log_date BETWEEN $1::date AND $2::date${wardSql} ORDER BY l.log_date, l.stretch_code`, params)).map(shapeLog) as (LogRow & { road_name: string; ward: number })[];
  const accepted = logs.filter((l) => l.status === 'accepted');
  const sumQ = (rows: LogRow[]) => {
    const t = { excavation_m: 0, pipe_m: 0, bedding_m: 0, manholes: 0, ics: 0, backfill_m: 0, road_m: 0 };
    for (const l of rows) {
      const x = l.quantities;
      t.excavation_m += +x.excavation_m || 0; t.pipe_m += pipeTotal(x); t.bedding_m += +x.bedding_m || 0; t.manholes += +x.manholes || 0;
      t.ics += +x.ics || 0; t.backfill_m += +x.backfill_m || 0; t.road_m += +x.road_m || 0;
    }
    return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, r2(v)])) as typeof t;
  };
  const labour: Record<string, number> = {}, machines: Record<string, number> = {}, hind: Record<string, number> = {};
  for (const l of accepted) {
    for (const [k, v] of Object.entries(l.labour ?? {})) labour[k] = (labour[k] ?? 0) + (+v || 0);
    for (const [k, v] of Object.entries(l.machines ?? {})) machines[k] = (machines[k] ?? 0) + (+v || 0);
    for (const h of l.hindrances ?? []) hind[h.reason] = r2((hind[h.reason] ?? 0) + (+h.hours || 0));
  }
  // per work stretch: this period and to date (accepted only), with its length
  const codes = [...new Set(logs.map((l) => l.stretch_code))];
  const st = codes.length ? await q<{ code: string; road_name: string; ward: number; length_m: number; stage: string }>(`SELECT code, road_name, ward, length_m, stage FROM stretches WHERE code = ANY($1::text[])`, [codes]) : [];
  const toDate = codes.length ? await q<{ stretch_code: string; quantities: DailyQuantities }>(`SELECT stretch_code, quantities FROM daily_logs WHERE status = 'accepted' AND log_date <= $2::date AND stretch_code = ANY($1::text[])`, [codes, to]) : [];
  const rows = st.map((s) => {
    const mine = accepted.filter((l) => l.stretch_code === s.code);
    const period = sumQ(mine);
    const todate = sumQ(toDate.filter((x) => x.stretch_code === s.code).map((x) => ({ quantities: x.quantities }) as LogRow));
    return {
      code: s.code, name: s.road_name, ward: Number(s.ward), stage: s.stage, length_m: Math.round(Number(s.length_m)), period, todate,
      pct: s.length_m ? Math.min(100, Math.round((todate.pipe_m / Number(s.length_m)) * 1000) / 10) : 0,
      pending: logs.filter((l) => l.stretch_code === s.code && l.status === 'submitted').length,
      hindrance_hours: r2(mine.flatMap((l) => l.hindrances ?? []).reduce((a, h) => a + (+h.hours || 0), 0)),
      labour: mine.reduce((a, l) => a + Object.values(l.labour ?? {}).reduce((x, y) => x + (+y || 0), 0), 0),
      remarks: mine.map((l) => l.remark).filter(Boolean),
    };
  }).sort((a, b) => b.period.pipe_m - a.period.pipe_m || a.code.localeCompare(b.code));
  // each day of the period
  // days of the period up to today (a week or month still running is planned and charted up to today)
  const last = to < indiaDate() ? to : indiaDate();
  const days: string[] = [];
  for (let d = from; d <= last && days.length < 400; d = addDays(d, 1)) days.push(d);
  const series = days.map((d) => ({ date: d, ...sumQ(accepted.filter((l) => l.log_date === d)) }));
  // planned in the period, from the monthly targets (a month's target shared by its days)
  const targets = await q<{ month: unknown; measure: string; planned: unknown }>(
    `SELECT month, measure, planned FROM project_targets WHERE ulb_id = ${U()} AND package_id = ANY($1::int[])`,
    [pkg ? [pkg] : (await q<{ id: number }>(`SELECT id FROM project_packages WHERE ulb_id = ${U()} AND active`)).map((x) => Number(x.id)).concat([0])]);
  const planned: Record<string, number> = { pipe_km: 0, manholes: 0, ics: 0, road_km: 0 };
  for (const t of targets) {
    const m = d10(t.month)!.slice(0, 7);
    const dim = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    const n = days.filter((d) => d.startsWith(m)).length;
    if (n) planned[t.measure] = (planned[t.measure] ?? 0) + (Number(t.planned) * n) / dim;
  }
  // the rest of the picture for the same period and area
  const area = wards ? ` AND ward = ANY($3::int[])` : '';
  const [iss] = await q<{ opened: string; resolved: string }>(`SELECT count(*) FILTER (WHERE created_at::date BETWEEN $1::date AND $2::date) AS opened, count(*) FILTER (WHERE resolved_at::date BETWEEN $1::date AND $2::date) AS resolved FROM issues WHERE ulb_id = ${U()}${area}`, params);
  const [gr] = await q<{ received: string; resolved: string }>(`SELECT count(*) FILTER (WHERE created_at::date BETWEEN $1::date AND $2::date) AS received, count(*) FILTER (WHERE resolved_at::date BETWEEN $1::date AND $2::date AND status = 'resolved') AS resolved FROM grievances WHERE ulb_id = ${U()}${area}`, params);
  const [cr] = await q<{ n: string }>(`SELECT count(*) AS n FROM compliance_records r JOIN stretches s ON s.code = r.stretch_code WHERE s.ulb_id = ${U()} AND r.recorded_at::date BETWEEN $1::date AND $2::date${wardSql}`, params);
  return {
    from, to, upto: last, package_id: pkg, generated_at: new Date().toISOString(),
    totals: sumQ(accepted), pending: { entries: logs.filter((l) => l.status === 'submitted').length, ...sumQ(logs.filter((l) => l.status === 'submitted')) },
    returned: logs.filter((l) => l.status === 'returned').length,
    entries: accepted.length, stretches_worked: new Set(accepted.map((l) => l.stretch_code)).size,
    labour, machines, hindrance_hours: hind, hindrance_total: r2(Object.values(hind).reduce((a, b) => a + b, 0)),
    planned: { pipe_m: Math.round(planned.pipe_km * 1000), manholes: Math.round(planned.manholes), ics: Math.round(planned.ics), road_m: Math.round(planned.road_km * 1000) },
    context: { issues_opened: +iss.opened, issues_resolved: +iss.resolved, grievances_received: +gr.received, grievances_resolved: +gr.resolved, compliance_records: +cr.n },
    rows, series,
    photos: accepted.flatMap((l) => (l.photos ?? []).map((id) => ({ id, code: l.stretch_code, date: l.log_date }))).slice(0, 12),
  };
}

async function reportWorkbook(rep: Awaited<ReturnType<typeof dailyReport>>, title: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UGD Tracker';
  const head = (ws: ExcelJS.Worksheet) => { const h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E1E45' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 34 }, { width: 18 }, { width: 18 }];
  sum.addRow([title]).font = { bold: true, size: 14 };
  sum.addRow([`Period: ${rep.from} to ${rep.to}`]);
  sum.addRow(['Only entries accepted by the AEE / DEE are counted.']);
  sum.addRow([]);
  sum.addRow(['Work done', 'Done', 'Planned']).font = { bold: true };
  sum.addRow(['Sewer pipe laid (m)', rep.totals.pipe_m, rep.planned.pipe_m]);
  sum.addRow(['Manholes built', rep.totals.manholes, rep.planned.manholes]);
  sum.addRow(['House connections (ICs)', rep.totals.ics, rep.planned.ics]);
  sum.addRow(['Road restored (m)', rep.totals.road_m, rep.planned.road_m]);
  sum.addRow(['Trench excavated (m)', rep.totals.excavation_m]);
  sum.addRow(['Bedding laid (m)', rep.totals.bedding_m]);
  sum.addRow(['Back-filled (m)', rep.totals.backfill_m]);
  sum.addRow([]);
  sum.addRow(['Work stretches worked on', rep.stretches_worked]);
  sum.addRow(['Entries accepted / waiting / returned', `${rep.entries} / ${rep.pending.entries} / ${rep.returned}`]);
  sum.addRow(['Labour (person-days)', Object.values(rep.labour).reduce((a, b) => a + b, 0)]);
  sum.addRow(['Time lost (hours)', rep.hindrance_total]);
  sum.addRow(['Issues opened / resolved', `${rep.context.issues_opened} / ${rep.context.issues_resolved}`]);
  sum.addRow(['Grievances received / resolved', `${rep.context.grievances_received} / ${rep.context.grievances_resolved}`]);
  sum.addRow(['Compliance records', rep.context.compliance_records]);
  const ws = wb.addWorksheet('Work stretches');
  ws.columns = [{ header: 'Work stretch', width: 16 }, { header: 'Name', width: 34 }, { header: 'Ward', width: 7 }, { header: 'Pipe laid (m)', width: 13 }, { header: 'Manholes', width: 10 }, { header: 'ICs', width: 8 },
    { header: 'Road restored (m)', width: 16 }, { header: 'Pipe laid to date (m)', width: 18 }, { header: 'Length (m)', width: 11 }, { header: '% laid', width: 8 }, { header: 'Labour (person-days)', width: 18 }, { header: 'Time lost (h)', width: 12 }, { header: 'Remarks', width: 50 }];
  head(ws);
  for (const r of rep.rows) ws.addRow([r.code, r.name, r.ward, r.period.pipe_m, r.period.manholes, r.period.ics, r.period.road_m, r.todate.pipe_m, r.length_m, r.pct, r.labour, r.hindrance_hours, r.remarks.join(' · ')]);
  const dz = wb.addWorksheet('By day');
  dz.columns = [{ header: 'Date', width: 12 }, ...QUANTITY_FIELDS.map((f) => ({ header: `${f.label}${f.unit ? ` (${f.unit})` : ''}`, width: 18 })), { header: 'Pipe laid (m)', width: 14 }];
  head(dz);
  for (const d of rep.series) dz.addRow([d.date, ...QUANTITY_FIELDS.map((f) => d[f.key as keyof typeof d]), d.pipe_m]);
  const hz = wb.addWorksheet('Time lost');
  hz.columns = [{ header: 'Reason', width: 26 }, { header: 'Hours', width: 10 }];
  head(hz);
  for (const h of HINDRANCES) if (rep.hindrance_hours[h.key]) hz.addRow([h.label, rep.hindrance_hours[h.key]]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Entries waiting for this person to verify, and entries returned to them (for My tasks). */
export async function dailyTasks(q: Q, u: SessionUser) {
  const out: { kind: string; tone: 'bad' | 'due' | 'wait'; title: string; detail: string; due: string | null; link: Record<string, string> }[] = [];
  if (has(u, 'daily.verify')) {
    const rows = await q<{ stretch_code: string; ward: number; admin_zone: string; submitted_by: string }>(
      `SELECT l.stretch_code, s.ward, s.admin_zone, l.submitted_by FROM daily_logs l JOIN stretches s ON s.code = l.stretch_code WHERE l.ulb_id = ${U()} AND l.status = 'submitted'`);
    const mine = rows.filter((r) => inArea(u, r) && (r.submitted_by !== u.id || has(u, 'compliance.verify_own')));
    if (mine.length) out.push({ kind: 'daily', tone: 'wait', title: `Verify ${mine.length} daily log entr${mine.length === 1 ? 'y' : 'ies'}`, detail: 'Daily log → To verify', due: null, link: { type: 'daily' } });
  }
  if (has(u, 'daily.submit')) {
    const back = await q<{ n: string }>(`SELECT count(*) AS n FROM daily_logs WHERE ulb_id = ${U()} AND status = 'returned' AND submitted_by = $1`, [u.id]);
    if (+back[0].n) out.push({ kind: 'daily', tone: 'bad', title: `${back[0].n} daily log entr${+back[0].n === 1 ? 'y' : 'ies'} returned for correction`, detail: 'Daily log → My entries', due: null, link: { type: 'daily', view: 'mine' } });
  }
  return out;
}

// ---------------- routes ----------------
export function registerDaily(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);
  const canSubmit = (u: SessionUser, st: { ward: number; admin_zone: string }) => has(u, 'daily.submit') && inArea(u, st);
  const canVerify = (u: SessionUser, st: { ward: number; admin_zone: string }) => has(u, 'daily.verify') && inArea(u, st);

  // a stretch's daily log
  app.get<{ Params: { code: string } }>('/api/stretches/:code/daily', async (req) => {
    const u = req.user!;
    const code = codeOf(req.params);
    const st = await loadStretch(q, code);
    const entries = (await q<Record<string, unknown>>(`${LOG_SELECT} WHERE l.stretch_code = $1 ORDER BY l.log_date DESC LIMIT 400`, [code])).map(shapeLog);
    const dias = [...new Set(((st as unknown as { pipes: [string, number][] }).pipes ?? []).map((p) => String(p[1])))].sort((a, b) => +a - +b);
    return { entries, totals: await acceptedTotals(q, code), length_m: Math.round(Number(st.length_m)), diameters: dias.length ? dias : ['200'], today: indiaDate(), can: { submit: canSubmit(u, st), verify: canVerify(u, st) } };
  });

  // submit (or correct a returned / waiting entry)
  app.post<{ Params: { code: string } }>('/api/stretches/:code/daily', async (req) => {
    const u = req.user!;
    const code = codeOf(req.params);
    const b = parse(entryBody, req.body);
    await checkFiles(db, b.photos, 'photo');
    const today = indiaDate();
    if (b.log_date > today) throw new HttpError(400, 'The date cannot be in the future.');
    if (b.log_date < addDays(today, -DAILY_BACKDATE_DAYS)) throw new HttpError(400, `Entries can be made for the last ${DAILY_BACKDATE_DAYS} days only.`);
    const q0 = b.quantities;
    const anything = pipeTotal(q0) + q0.excavation_m + q0.bedding_m + q0.manholes + q0.ics + q0.backfill_m + q0.road_m
      + Object.values(b.labour).reduce((a, x) => a + (x ?? 0), 0) + b.hindrances.length;
    if (!anything && !b.remark) throw new HttpError(400, 'Enter the work done, the people on site or the time lost.');
    return db.tx(async (t) => {
      const st = await loadStretch(t, code, true);
      if (!canSubmit(u, st)) throw new HttpError(403, 'Your role does not submit the daily log here.');
      // the running total may not run past the stretch by far
      const tot = await acceptedTotals(t, code);
      const was = (await t<{ id: string; status: string; submitted_by: string; quantities: DailyQuantities }>('SELECT id, status, submitted_by, quantities FROM daily_logs WHERE stretch_code = $1 AND log_date = $2 FOR UPDATE', [code, b.log_date]))[0];
      if (was?.status === 'accepted') throw new HttpError(409, `The ${b.log_date} entry is already accepted. Add today’s work as a new entry, or ask the AEE.`);
      if (tot.pipe_m + pipeTotal(q0) > Number(st.length_m) * 1.15 + 5) throw new HttpError(400, `Pipe laid would total ${Math.round(tot.pipe_m + pipeTotal(q0))} m, more than this ${Math.round(Number(st.length_m))} m work stretch. Check the figure.`);
      const late = b.log_date < addDays(today, -DAILY_LATE_AFTER_DAYS);
      const vals = [JSON.stringify(q0), JSON.stringify(b.labour), JSON.stringify(b.machines), JSON.stringify(b.hindrances), b.remark, JSON.stringify(b.photos), b.gps ? JSON.stringify(b.gps) : null, late, u.id];
      let id: number;
      if (was) {
        await t(`UPDATE daily_logs SET quantities = $2, labour = $3, machines = $4, hindrances = $5, remark = $6, photos = $7, gps = $8, late = $9, submitted_by = $10,
                 submitted_at = now(), status = 'submitted', decided_by = NULL, decided_at = NULL WHERE id = $1`, [was.id, ...vals]);
        id = Number(was.id);
        await event(t, id, u.id, was.status === 'returned' ? 'resubmitted' : 'changed');
      } else {
        const r = await t<{ id: string }>(`INSERT INTO daily_logs (ulb_id, stretch_code, log_date, quantities, labour, machines, hindrances, remark, photos, gps, late, submitted_by)
                 VALUES (${U()}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`, [code, b.log_date, ...vals]);
        id = Number(r[0].id);
        await event(t, id, u.id, 'submitted');
      }
      return { ok: true, id, late };
    });
  });

  // accept or return
  app.post<{ Params: { id: string } }>('/api/daily/:id/decide', async (req) => {
    const u = req.user!;
    const b = parse(decideBody, req.body);
    if (b.decision === 'return' && !b.note) throw new HttpError(400, 'Say what needs correcting, so it can be fixed.');
    return db.tx(async (t) => {
      const l = (await t<Record<string, unknown>>(`SELECT * FROM daily_logs WHERE id = $1 AND ulb_id = ${U()} FOR UPDATE`, [Number(req.params.id)]))[0];
      if (!l) throw new HttpError(404, 'Entry not found.');
      const log = shapeLog(l);
      if (log.status !== 'submitted') throw new HttpError(409, 'This entry was already decided.');
      const st = await loadStretch(t, log.stretch_code, true);
      if (!canVerify(u, st)) throw new HttpError(403, 'Only the AEE / DEE of the area verifies daily logs.');
      if (log.submitted_by === u.id && !has(u, 'compliance.verify_own')) throw new HttpError(403, 'Another person must verify your own entry.');
      let statusNote = '';
      if (b.decision === 'accept') {
        await t(`UPDATE daily_logs SET status = 'accepted' WHERE id = $1`, [log.id]);
        const tot = await acceptedTotals(t, log.stretch_code);
        const next = statusFromTotals(st.status, Number(st.length_m), Number(st.planned_manholes) || 0, tot);
        try {
          await saveStatus(t, u, log.stretch_code, next, {
            note: `Daily log of ${log.log_date} accepted (submitted by ${(await t<{ name: string }>('SELECT name FROM users WHERE id = $1', [log.submitted_by]))[0]?.name ?? '—'})`,
            photos: log.photos, gps: null, override_reason: b.override_reason,
          });
          statusNote = 'Status updated from the running totals.';
        } catch (e) {
          if (e instanceof HttpError && e.code === 'NO_CHANGE') statusNote = 'Status already up to date.';
          else if (e instanceof HttpError) throw new HttpError(e.status, `Not accepted: the status could not move forward. ${e.message}`, e.code);
          else throw e;
        }
      }
      await t(`UPDATE daily_logs SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, status_note = $5 WHERE id = $1`,
        [log.id, b.decision === 'accept' ? 'accepted' : 'returned', u.id, b.note, statusNote]);
      await event(t, log.id, u.id, b.decision === 'accept' ? 'accepted' : 'returned', b.note);
      return { ok: true, status_note: statusNote };
    });
  });

  // entries to verify (verifiers), or my own entries
  app.get<{ Querystring: { view?: string } }>('/api/daily/queue', async (req) => {
    const u = req.user!;
    const mine = req.query.view === 'mine';
    const rows = (await q<Record<string, unknown>>(
      `${LOG_SELECT} WHERE l.ulb_id = ${U()} AND ${mine ? 'l.submitted_by = $1' : `l.status = 'submitted'`} ORDER BY l.log_date DESC, l.stretch_code LIMIT 500`, mine ? [u.id] : []))
      .map(shapeLog) as (LogRow & { ward: number; admin_zone: string; road_name: string })[];
    const list = mine ? rows : rows.filter((r) => canVerify(u, r) && (r.submitted_by !== u.id || has(u, 'compliance.verify_own')));
    return { entries: list, can: { submit: has(u, 'daily.submit'), verify: has(u, 'daily.verify') } };
  });

  // reports: a day or a period; Excel with format=xlsx
  const repQuery = z.object({ from: day, to: day, package: z.coerce.number().int().min(0).default(0), format: z.enum(['json', 'xlsx']).default('json') });
  app.get('/api/daily/report', async (req, reply) => {
    const f = parse(repQuery, req.query);
    if (f.to < f.from) throw new HttpError(400, 'The end date is before the start date.');
    if (f.to > addDays(f.from, 370)) throw new HttpError(400, 'Choose a period of a year or less.');
    const rep = await dailyReport(q, f.from, f.to, f.package || null);
    if (f.format === 'json') return rep;
    const pk = f.package ? (await q<{ code: string }>(`SELECT code FROM project_packages WHERE id = $1`, [f.package]))[0]?.code : '';
    const title = `${f.from === f.to ? 'Daily' : 'Progress'} report${pk ? ` · ${pk}` : ''} · ${f.from === f.to ? f.from : `${f.from} to ${f.to}`}`;
    return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="report-${f.from}${f.from === f.to ? '' : `-to-${f.to}`}${pk ? `-${pk}` : ''}.xlsx"`).send(await reportWorkbook(rep, title));
  });
}
