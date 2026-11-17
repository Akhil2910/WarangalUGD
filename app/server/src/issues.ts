/**
 * Issues (brief §6.9; rules in shared/issues.ts).
 *  - syncIssues(): run on every stretch refresh. Raises, re-counts and closes the status-raised and the
 *    compliance-raised issues of a stretch.
 *  - Routes: list (+ CSV for Excel), one issue with its history, report, assign, resolve, re-open,
 *    permanent delete (Commissioner, with a reason kept in the admin log).
 * Permissions (docs/01 §7.4): report = staff of the area; resolve / re-open = AEE and above of the area;
 * assign = DEE and above of the area; delete = Commissioner.
 */
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DUE_DAYS, ISSUE_KINDS, ROLE_RANK, STATUS_KINDS, addDays, clearStatusFor, deriveStage, indiaDate, issueKind, issueOverdue,
  restoreStatusFor, statusChanges, statusIssueCounts, type ItemStatus, type Severity, type WorkStatus,
} from 'shared';
import { audit, HttpError, type SessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { checkFiles, FILES_DIR, gpsSchema } from './files.ts';
import { nextNo } from './site.ts';
import { nearCity, wardAt } from './geo.ts';
import { can, card, codeOf, distanceToLine, loadStretch, midpoint, parse, refresh, sweep, type Q, type StretchRow } from './works.ts';
import { has, ulbOf } from './perms.ts';
import { cur, curPrefix } from './ulbctx.ts';
/** The current ULB as a plain number (safe to put straight into SQL). */
const U = () => Number(cur());

interface IssueRow {
  id: number; code: string; kind: string; source: string; item_key: string; stretch_code: string | null; count: number;
  severity: Severity; status: string; title: string; assignee: string | null; due_date: string | null;
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const dateStr = (d: unknown) => (d ? (d instanceof Date ? indiaDate(d) : String(d).slice(0, 10)) : null);

async function newCode(q: Q) {
  return `${curPrefix()}I-${String(await nextNo(q, 'issues', '^I-(\\d+)$')).padStart(4, '0')}`;
}

async function event(q: Q, issueId: number, by: string | null, action: string, note = '', photos: string[] = [], detail: Record<string, unknown> = {}) {
  await q('INSERT INTO issue_events (issue_id, by_user, action, note, photos, detail) VALUES ($1,$2,$3,$4,$5,$6)',
    [issueId, by, action, note, JSON.stringify(photos), JSON.stringify(detail)]);
}

async function createIssue(q: Q, st: StretchRow | null, f: { kind: string; source: string; item_key?: string; count: number; severity: Severity; title: string;
  remark?: string; photos?: string[]; lon?: number; lat?: number; by: string | null; note: string; ward?: number; admin_zone?: string }) {
  const [lon, lat] = f.lon !== undefined && f.lat !== undefined ? [f.lon, f.lat] : midpoint(st!.geom);
  const due = addDays(indiaDate(), (await ulbOf(q)).settings.issue_due_days[f.severity] ?? DUE_DAYS[f.severity]);
  const rows = await q<{ id: string }>(
    `INSERT INTO issues (code, kind, source, item_key, stretch_code, lon, lat, ward, admin_zone, package, count, severity, title, remark, photos, due_date, created_by, ulb_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,${U()}) RETURNING id`,
    [await newCode(q), f.kind, f.source, f.item_key ?? '', st?.code ?? null, lon, lat, st?.ward ?? f.ward, st?.admin_zone ?? f.admin_zone ?? '', st?.package ?? '', f.count, f.severity, f.title,
      f.remark ?? '', JSON.stringify(f.photos ?? []), due, f.source === 'manual' ? f.by : null],
  );
  const id = Number(rows[0].id);
  await event(q, id, f.by, 'opened', f.note, f.photos ?? [], { count: f.count });
  return id;
}

/** Report an issue by hand (at a place, at the phone's GPS, or on a work stretch). Returns its code. Used by the issue form and by grievances. */
export async function reportIssue(t: Q, u: SessionUser, b: {
  stretch_code?: string; lon?: number; lat?: number; kind: string; remark: string; severity?: Severity; count: number; photos: string[]; gps?: { lon: number; lat: number } | null;
}) {
  const st = b.stretch_code ? await loadStretch(t, codeOf({ code: b.stretch_code })) : null;
  const k = issueKind(b.kind)!;
  let lon = b.lon, lat = b.lat;
  if (st && (lon === undefined || lat === undefined) && b.gps && distanceToLine(st.geom, b.gps.lon, b.gps.lat) <= 200) [lon, lat] = [b.gps.lon, b.gps.lat];
  if (!st && (lon === undefined || lat === undefined)) {
    if (!b.gps) throw new HttpError(400, 'Tap the place of the issue on the map, or turn on GPS.');
    [lon, lat] = [b.gps.lon, b.gps.lat];
  }
  if (lon !== undefined && lat !== undefined && !nearCity(lon, lat)) throw new HttpError(400, 'That place is outside the city area.');
  const w = st ? { ward: st.ward, admin_zone: st.admin_zone } : wardAt(lon!, lat!);
  if (!can(u, w).report_issue) throw new HttpError(403, 'You cannot report issues outside your area.');
  const id = await createIssue(t, st, {
    kind: k.key, source: 'manual', count: b.count, severity: b.severity ?? k.severity, title: k.label, remark: b.remark, photos: b.photos,
    lon, lat, by: u.id, note: b.remark, ward: w.ward, admin_zone: w.admin_zone,
  });
  if (st) await refresh(t, st.code, u.id);
  return (await t<{ code: string }>('SELECT code FROM issues WHERE id = $1', [id]))[0].code;
}

/** Bring the automatic issues of a stretch in line with its status and compliance. Returns its open-issue count. */
export async function syncIssues(q: Q, st: StretchRow, items: ItemStatus[], actor: string | null): Promise<number> {
  const open = await q<IssueRow>(`SELECT id, code, kind, source, item_key, count, severity, status FROM issues
                                  WHERE stretch_code = $1 AND status <> 'resolved' AND source <> 'manual'`, [st.code]);
  // status-raised: one per kind, with a count
  const counts = statusIssueCounts(st.status);
  for (const k of STATUS_KINDS) {
    const n = counts[k.key];
    const cur = open.find((i) => i.source === 'status' && i.kind === k.key);
    if (n > 0 && !cur) {
      await createIssue(q, st, { kind: k.key, source: 'status', count: n, severity: k.severity, title: k.label, by: actor, note: 'Raised from the status recorded on the stretch' });
    } else if (cur && n > 0 && n !== cur.count) {
      await q('UPDATE issues SET count = $2, updated_at = now() WHERE id = $1', [cur.id, n]);
      await event(q, cur.id, actor, 'count', '', [], { from: cur.count, to: n });
    } else if (cur && n === 0) {
      await q(`UPDATE issues SET status = 'resolved', resolved_at = now(), resolved_by = $2, resolution_note = $3, updated_at = now() WHERE id = $1`,
        [cur.id, actor, 'Cleared on the stretch status']);
      await event(q, cur.id, actor, 'auto_resolved', 'Cleared on the stretch status');
    }
  }
  // compliance-raised: a non-compliance, or a mandatory item overdue; closes when complied and verified
  for (const it of items) {
    const cur = open.find((i) => i.source === 'compliance' && i.item_key === it.item.key);
    const failing = it.units.filter((u) => u.state === 'not_complied' || (it.item.mandatory && u.state === 'overdue')).length;
    const remaining = it.units.filter((u) => !['verified', 'not_applicable'].includes(u.state)).length;
    if (!cur && it.applies && failing > 0) {
      const what = it.units.some((u) => u.state === 'not_complied') ? 'not complied' : 'overdue';
      await createIssue(q, st, { kind: 'compliance', source: 'compliance', item_key: it.item.key, count: failing, severity: it.item.severity,
        title: `Compliance not met: ${it.item.name}`, by: actor, note: `Item ${what}` });
    } else if (cur && (!it.applies || remaining === 0)) {
      await q(`UPDATE issues SET status = 'resolved', resolved_at = now(), resolved_by = $2, resolution_note = $3, updated_at = now() WHERE id = $1`,
        [cur.id, actor, it.applies ? 'Complied and verified' : 'Item no longer applies']);
      await event(q, cur.id, actor, 'auto_resolved', it.applies ? 'Complied and verified' : 'Item no longer applies');
    } else if (cur && remaining !== cur.count) {
      await q('UPDATE issues SET count = $2, updated_at = now() WHERE id = $1', [cur.id, remaining]);
      await event(q, cur.id, actor, 'count', '', [], { from: cur.count, to: remaining });
    }
  }
  // compliance issues of retired items close too
  for (const cur of open.filter((i) => i.source === 'compliance' && !items.some((it) => it.item.key === i.item_key))) {
    await q(`UPDATE issues SET status = 'resolved', resolved_at = now(), resolution_note = 'Item retired from the compliance list', updated_at = now() WHERE id = $1`, [cur.id]);
    await event(q, cur.id, actor, 'auto_resolved', 'Item retired from the compliance list');
  }
  const n = await q<{ n: string }>(`SELECT count(*) AS n FROM issues WHERE stretch_code = $1 AND status <> 'resolved'`, [st.code]);
  return Number(n[0].n);
}

const LIST_COLS = `i.id, i.code, i.kind, i.source, i.item_key, i.stretch_code, i.lon, i.lat, i.ward, i.admin_zone, i.package, i.count, i.severity,
  i.status, i.title, i.remark, i.photos, i.assignee, a.name AS assignee_name, i.due_date, i.created_at, c.name AS created_by_name, i.updated_at,
  i.resolved_at, r.name AS resolved_by_name, i.resolution_note, i.resolution_photos`;
const LIST_FROM = `issues i LEFT JOIN stretches hs ON hs.code = i.stretch_code LEFT JOIN users a ON a.id = i.assignee LEFT JOIN users c ON c.id = i.created_by LEFT JOIN users r ON r.id = i.resolved_by`;

function shape(r: Record<string, unknown>): Record<string, unknown> & { overdue: boolean } {
  const due = dateStr(r.due_date);
  return {
    ...r, id: Number(r.id), due_date: due, created_at: iso(r.created_at), updated_at: iso(r.updated_at), resolved_at: iso(r.resolved_at),
    kind_label: issueKind(r.kind as string)?.label ?? r.kind, overdue: issueOverdue(due, r.status as string),
  };
}

export async function issuesForCard(q: Q, code: string) {
  const rows = await q<Record<string, unknown>>(
    `SELECT ${LIST_COLS} FROM ${LIST_FROM} WHERE i.stretch_code = $1
     ORDER BY (i.status = 'resolved'), i.created_at DESC LIMIT 50`, [code]);
  return rows.map(shape);
}

const listQuery = z.object({
  kind: z.string().max(40).optional(), source: z.enum(['status', 'compliance', 'manual']).optional(),
  zone: z.string().max(10).optional(), ward: z.coerce.number().int().optional(), package: z.string().max(40).optional(),
  severity: z.enum(['low', 'medium', 'high']).optional(), status: z.enum(['open', 'assigned', 'resolved', 'active']).optional(),
  overdue: z.enum(['1']).optional(), assignee: z.enum(['me']).optional(), stretch: z.string().max(20).optional(), q: z.string().max(80).optional(),
  sort: z.enum(['code', 'kind', 'stretch_code', 'ward', 'admin_zone', 'count', 'severity', 'status', 'assignee_name', 'due_date', 'created_at', 'updated_at']).default('created_at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(5000).default(100), offset: z.coerce.number().int().min(0).default(0),
  format: z.enum(['json', 'csv']).default('json'),
});

const SEV_ORDER = "CASE i.severity WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END";

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function registerIssues(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);

  app.get('/api/issues', async (req, reply) => {
    await sweep(db);
    const f = parse(listQuery, req.query);
    const u = req.user!;
    const where: string[] = ['NOT coalesce(hs.hidden, false)', `i.ulb_id = ${U()}`];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (f.kind) add('i.kind = ?', f.kind);
    if (f.source) add('i.source = ?', f.source);
    if (f.zone) add('i.admin_zone = ?', f.zone);
    if (f.ward) add('i.ward = ?', f.ward);
    if (f.package) add('i.package = ?', f.package);
    if (f.severity) add('i.severity = ?', f.severity);
    if (f.status === 'active') where.push("i.status <> 'resolved'");
    else if (f.status) add('i.status = ?', f.status);
    if (f.overdue) add("i.status <> 'resolved' AND i.due_date < ?::date", indiaDate());
    if (f.assignee === 'me') add('i.assignee = ?', u.id);
    if (f.stretch) add('i.stretch_code = ?', f.stretch);
    if (f.q) add('(i.code ILIKE ? OR i.title ILIKE ? OR i.remark ILIKE ? OR i.stretch_code ILIKE ?)', `%${f.q}%`);
    const order = f.sort === 'severity' ? SEV_ORDER : f.sort === 'assignee_name' ? 'a.name' : `i.${f.sort}`;
    const sql = `SELECT ${LIST_COLS}, count(*) OVER () AS total FROM ${LIST_FROM} WHERE ${where.join(' AND ')}
                 ORDER BY ${order} ${f.dir.toUpperCase()} NULLS LAST, i.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`;
    const rows = (await q<Record<string, unknown>>(sql, params)).map(shape);
    if (f.format === 'csv') {
      const head = ['Issue', 'Kind', 'Title', 'Stretch', 'Ward', 'Zone', 'Package', 'Count', 'Severity', 'Status', 'Overdue', 'Assigned to', 'Due date',
        'Raised', 'Raised by', 'Remark', 'Resolved', 'Resolved by', 'Resolution note', 'Latitude', 'Longitude'];
      const lines = rows.map((r) => [r.code, r.kind_label, r.title, r.stretch_code, r.ward, r.admin_zone, r.package, r.count, r.severity, r.status,
        r.overdue ? 'Yes' : 'No', r.assignee_name, r.due_date, r.created_at, r.created_by_name ?? 'System', r.remark, r.resolved_at, r.resolved_by_name,
        r.resolution_note, r.lat, r.lon].map(csvCell).join(','));
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="issues-${indiaDate()}.csv"`);
      return '﻿' + [head.join(','), ...lines].join('\r\n'); // BOM so Excel reads the text correctly
    }
    const counts = await q<{ status: string; severity: string; n: string; overdue: string }>(
      `SELECT status, severity, count(*) AS n, count(*) FILTER (WHERE status <> 'resolved' AND due_date < $1::date) AS overdue FROM issues WHERE ulb_id = ${U()} AND (stretch_code IS NULL OR stretch_code IN (SELECT code FROM stretches WHERE NOT hidden)) GROUP BY 1, 2`, [indiaDate()]);
    return {
      total: rows.length ? Number(rows[0].total) : 0,
      rows: rows.map(({ total: _t, ...r }) => r),
      counts: counts.map((c) => ({ status: c.status, severity: c.severity, n: Number(c.n), overdue: Number(c.overdue) })),
    };
  });

  app.get('/api/users/assignable', async () => {
    const rows = await q<{ id: string; name: string; role: string; designation: string }>(
      `SELECT id, name, role, designation FROM users WHERE active AND role <> 'viewer' AND ulb_id = ${U()} ORDER BY name`);
    return { users: rows };
  });

  async function loadIssue(t: Q, code: string, lock = false) {
    if (!/^([A-Z][A-Z0-9]{1,9}-)?I-\d{4,7}$/.test(code)) throw new HttpError(404, 'Issue not found.');
    const rows = await t<IssueRow & { ward: number; admin_zone: string }>(`SELECT * FROM issues WHERE code = $1 AND ulb_id = ${U()} AND (stretch_code IS NULL OR stretch_code IN (SELECT code FROM stretches WHERE NOT hidden)) ${lock ? 'FOR UPDATE' : ''}`, [code]);
    if (!rows.length) throw new HttpError(404, 'Issue not found.');
    return rows[0];
  }
  const areaOf = (i: { ward: number; admin_zone: string }) => ({ ward: i.ward, admin_zone: i.admin_zone });

  app.get<{ Params: { code: string } }>('/api/issues/:code', async (req) => {
    const i = await loadIssue(q, req.params.code);
    const row = (await q<Record<string, unknown>>(`SELECT ${LIST_COLS} FROM ${LIST_FROM} WHERE i.id = $1`, [i.id]))[0];
    const events = await q<Record<string, unknown>>(
      `SELECT e.id, e.at, e.action, e.note, e.photos, e.detail, u.name AS by_name FROM issue_events e LEFT JOIN users u ON u.id = e.by_user
       WHERE e.issue_id = $1 ORDER BY e.at, e.id`, [i.id]);
    return { issue: shape(row), events: events.map((e) => ({ ...e, id: Number(e.id), at: iso(e.at) })), can: can(req.user!, areaOf(i)) };
  });

  // ---- report (manual) ----
  // reported anywhere on the map (a point), or on a work stretch; any kind except "compliance not met" (raised by the app).
  // A report stands on its own: it does not change the work stretch's status counts.
  const reportBody = z.object({
    stretch_code: z.string().max(20).optional(), lon: z.number().min(-180).max(180).optional(), lat: z.number().min(-90).max(90).optional(),
    kind: z.enum(ISSUE_KINDS.filter((k) => k.key !== 'compliance').map((k) => k.key) as [string, ...string[]]),
    remark: z.string().trim().min(3, 'Write a remark describing the issue.').max(2000), severity: z.enum(['low', 'medium', 'high']).optional(),
    count: z.number().int().min(1).max(10000).default(1), photos: z.array(z.string().uuid()).max(10).default([]), gps: gpsSchema,
  });
  app.post('/api/issues', async (req) => {
    const u = req.user!;
    const b = parse(reportBody, req.body);
    await checkFiles(db, b.photos, 'photo');
    const out = await db.tx((t) => reportIssue(t, u, b));
    return { ok: true, code: out };
  });

  // ---- assign ----
  const assignBody = z.object({ assignee: z.string().uuid().nullable(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), note: z.string().max(2000).default('') });
  app.post<{ Params: { code: string } }>('/api/issues/:code/assign', async (req) => {
    const u = req.user!;
    const b = parse(assignBody, req.body);
    await db.tx(async (t) => {
      const i = await loadIssue(t, req.params.code, true);
      if (!can(u, areaOf(i)).assign_issue) throw new HttpError(403, 'Only the DEE of the area or the Commissioner can assign issues.');
      if (i.status === 'resolved') throw new HttpError(400, 'This issue is resolved. Re-open it first.');
      let name = '';
      if (b.assignee) {
        const a = await t<{ name: string; role: string }>(`SELECT name, role FROM users WHERE id = $1 AND active AND ulb_id = ${U()}`, [b.assignee]);
        if (!a.length || a[0].role === 'viewer') throw new HttpError(400, 'Choose an active officer or field staff member.');
        name = a[0].name;
      }
      const due = b.due_date === undefined ? i.due_date : b.due_date;
      await t(`UPDATE issues SET assignee = $2, status = $3, due_date = $4, updated_at = now() WHERE id = $1`,
        [i.id, b.assignee, b.assignee ? 'assigned' : 'open', due]);
      await event(t, i.id, u.id, 'assigned', b.note, [], { to: name || 'nobody', due_date: due });
    });
    return { ok: true };
  });

  // ---- resolve ----
  const resolveBody = z.object({ note: z.string().trim().min(3, 'Write a note on how it was resolved.').max(2000), photos: z.array(z.string().uuid()).max(10).default([]) });
  app.post<{ Params: { code: string } }>('/api/issues/:code/resolve', async (req) => {
    const u = req.user!;
    const b = parse(resolveBody, req.body);
    await checkFiles(db, b.photos, 'photo');
    await db.tx(async (t) => {
      const i = await loadIssue(t, req.params.code, true);
      if (!can(u, areaOf(i)).resolve_issue) throw new HttpError(403, 'Only the AEE or DEE of the area, or the Commissioner, can resolve issues.');
      if (i.status === 'resolved') throw new HttpError(400, 'This issue is already resolved.');
      if (i.source === 'compliance') throw new HttpError(400, 'A compliance issue closes by itself when the item is complied and verified. Record the compliance on the stretch.');
      await t(`UPDATE issues SET status = 'resolved', resolved_at = now(), resolved_by = $2, resolution_note = $3, resolution_photos = $4, updated_at = now() WHERE id = $1`,
        [i.id, u.id, b.note, JSON.stringify(b.photos)]);
      await event(t, i.id, u.id, 'resolved', b.note, b.photos);
      if (i.source === 'status' && i.stretch_code) {
        // resolving clears the damage on the stretch (e.g. restored = broken)
        await changeStretchStatus(t, i.stretch_code, u.id, (s) => clearStatusFor(i.kind, s), `Issue ${i.code} resolved: ${b.note}`, b.photos);
      }
      if (i.stretch_code) await refresh(t, i.stretch_code, u.id);
    });
    return { ok: true };
  });

  // ---- re-open ----
  const reopenBody = z.object({ note: z.string().trim().min(3, 'Say why it is re-opened.').max(2000) });
  app.post<{ Params: { code: string } }>('/api/issues/:code/reopen', async (req) => {
    const u = req.user!;
    const b = parse(reopenBody, req.body);
    await db.tx(async (t) => {
      const i = await loadIssue(t, req.params.code, true);
      if (!can(u, areaOf(i)).resolve_issue) throw new HttpError(403, 'Only the AEE or DEE of the area, or the Commissioner, can re-open issues.');
      if (i.status !== 'resolved') throw new HttpError(400, 'This issue is not resolved.');
      if (i.source === 'compliance') throw new HttpError(400, 'A compliance issue is raised again by itself if the item is not met. Record "not complied" on the stretch instead.');
      if (i.source === 'status' && i.stretch_code) {
        const other = await t('SELECT 1 FROM issues WHERE stretch_code = $1 AND kind = $2 AND status <> $3 AND id <> $4', [i.stretch_code, i.kind, 'resolved', i.id]);
        if (other.length) throw new HttpError(400, 'This damage already has an open issue on the stretch.');
      }
      await t(`UPDATE issues SET status = $2, resolved_at = NULL, resolved_by = NULL, resolution_note = '', updated_at = now() WHERE id = $1`,
        [i.id, i.assignee ? 'assigned' : 'open']);
      await event(t, i.id, u.id, 'reopened', b.note);
      if (i.source === 'status' && i.stretch_code) {
        // re-opening brings the damage back on the stretch, so the next save does not close it again
        await changeStretchStatus(t, i.stretch_code, u.id, (s) => restoreStatusFor(i.kind, s, i.count), `Issue ${i.code} re-opened: ${b.note}`, []);
      }
      if (i.stretch_code) await refresh(t, i.stretch_code, u.id);
    });
    return { ok: true };
  });

  // ---- permanent delete (Commissioner) ----
  const deleteBody = z.object({ codes: z.array(z.string()).min(1).max(500), reason: z.string().trim().min(5, 'Give the reason for deleting.').max(2000) });
  app.post('/api/issues/delete', async (req) => {
    const u = req.user!;
    if (!has(u, 'issue.delete')) throw new HttpError(403, 'Your role cannot delete issues.');
    const b = parse(deleteBody, req.body);
    const removedFiles: string[] = [];
    const deleted = await db.tx(async (t) => {
      const out: string[] = [];
      for (const code of b.codes) {
        const i = await loadIssue(t, code, true);
        const full = (await t<Record<string, unknown>>('SELECT * FROM issues WHERE id = $1', [i.id]))[0];
        const events = await t<{ photos: string[] }>('SELECT photos FROM issue_events WHERE issue_id = $1', [i.id]);
        if (i.source === 'status' && i.status !== 'resolved' && i.stretch_code) {
          await changeStretchStatus(t, i.stretch_code, u.id, (s) => clearStatusFor(i.kind, s), `Issue ${i.code} deleted by the Commissioner: ${b.reason}`, []);
        }
        await t('DELETE FROM issue_events WHERE issue_id = $1', [i.id]);
        await t('DELETE FROM issues WHERE id = $1', [i.id]);
        // photos used only by this issue are removed
        const ids = new Set<string>([...(full.photos as string[]), ...(full.resolution_photos as string[]), ...events.flatMap((e) => e.photos)]);
        for (const id of ids) {
          const used = await t(
            `SELECT 1 FROM stretch_history WHERE photos ? $1
             UNION ALL SELECT 1 FROM compliance_records WHERE photos ? $1 OR documents ? $1
             UNION ALL SELECT 1 FROM issues WHERE photos ? $1 OR resolution_photos ? $1
             UNION ALL SELECT 1 FROM issue_events WHERE photos ? $1 LIMIT 1`, [id]);
          if (!used.length) {
            await t('DELETE FROM files WHERE id = $1', [id]);
            removedFiles.push(id);
          }
        }
        await t('INSERT INTO audit_log (actor, action, detail) VALUES ($1, $2, $3)',
          [u.id, 'issue_deleted', JSON.stringify({ code: i.code, reason: b.reason, issue: full, events: events.length })]);
        if (i.stretch_code) await refresh(t, i.stretch_code, u.id);
        out.push(i.code);
      }
      return out;
    });
    for (const id of removedFiles) {
      const f = path.join(FILES_DIR, id);
      if (existsSync(f)) unlinkSync(f);
    }
    return { ok: true, deleted, photos_removed: removedFiles.length };
  });

  // stretch card refresh for the web app after an issue action
  app.get<{ Params: { code: string } }>('/api/issues/:code/stretch', async (req) => {
    const i = await loadIssue(q, req.params.code);
    if (!i.stretch_code) throw new HttpError(404, 'This issue is not on a stretch.');
    return card(q, req.user!, i.stretch_code);
  });
}

/** Change a stretch's status as a side effect of an issue action; recorded as a new version with history. */
async function changeStretchStatus(t: Q, code: string, by: string, fn: (s: WorkStatus) => WorkStatus, note: string, photos: string[]) {
  const st = await loadStretch(t, code, true);
  const next = fn(st.status);
  const changes = statusChanges(st.status, next);
  if (!changes.length) return;
  const stage = deriveStage(next, st.approval);
  const version = st.version + 1;
  await t('UPDATE stretches SET status = $2, stage = $3, version = $4, updated_at = now(), updated_by = $5 WHERE code = $1',
    [code, JSON.stringify(next), stage, version, by]);
  await t(`INSERT INTO stretch_history (stretch_code, version, kind, by_user, changes, snapshot, note, photos)
           VALUES ($1, $2, 'issue', $3, $4, $5, $6, $7)`,
    [code, version, by, JSON.stringify(changes), JSON.stringify({ status: next, approval: st.approval, stage }), note, JSON.stringify(photos)]);
}

