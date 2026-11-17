/**
 * Road stretches: work status updates, restoration approval, compliance recording and verification,
 * the compliance list (Commissioner) and the monitoring lists. Rules live in the shared module.
 *
 * Permissions (docs/01 §7.4): field staff, AEE, DEE update status and record compliance in their area;
 * AEE and above verify (never their own record, except the Commissioner); DEE and above approve
 * restorations; only the Commissioner edits the compliance list or overrides a blocking gate.
 * Everyone signed in may look at any stretch (the whole map is visible to all).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { projectGates } from './project.ts';
import {
  CUTTING, MOTORABILITY, PIPELINE, RESTORATION, ROAD_TYPES, ROLE_RANK, COMPLIANCE_STAGES, COMPLIANCE_CATEGORIES, EVIDENCE_KINDS,
  deriveStage, evaluateItem, gatesHit, itemUnits, nextApproval, normaliseStatus, passes, statusBadges, statusChanges, statusTags,
  summarise, updateMilestones, validateStatus, UNIT_STATE_LABEL, APPROVAL,
  type ComplianceItem, type ComplianceRecord, type Milestones, type WorkStatus, type Approval, type StretchForCompliance,
} from 'shared';
import { audit, HttpError, type SessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { checkFiles, gpsSchema } from './files.ts';
import { issuesForCard, syncIssues } from './issues.ts';

export type Q = Db['query'];

export interface StretchRow extends StretchForCompliance {
  code: string; ward: number; admin_zone: string; sewer_zone: string; catchment: string; package: string; road_name: string;
  length_m: number; planned_manholes: number; dia_m: Record<string, number>; outside_ward: boolean; geom: { type: string; coordinates: unknown };
  status: WorkStatus; approval: Approval; stage: string; milestones: Milestones; compliance: Record<string, unknown>;
  tags: string[]; badges: string; version: number; updated_at: Date; updated_by: string | null;
}

const ITEM_COLS = `id, key, version, sort, name, description, category, due_at, applies, per, evidence, value_label, unit, pass_rule,
  recurring_days, mandatory, severity, gate, grace_days, retired_at, is_current, created_at`;

export const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

export async function currentItems(q: Q, includeRetired = false): Promise<(ComplianceItem & { retired_at: string | null })[]> {
  const rows = await q<ComplianceItem & { retired_at: unknown }>(
    `SELECT ${ITEM_COLS} FROM compliance_items WHERE is_current ${includeRetired ? '' : 'AND retired_at IS NULL'} ORDER BY sort, key`,
  );
  return rows.map((r) => ({ ...r, retired_at: iso(r.retired_at) }));
}

export async function recordsFor(q: Q, code: string): Promise<(ComplianceRecord & Record<string, unknown>)[]> {
  const rows = await q<Record<string, unknown>>(
    `SELECT r.*, u.name AS recorded_by_name, v.name AS verified_by_name
     FROM compliance_records r JOIN users u ON u.id = r.recorded_by LEFT JOIN users v ON v.id = r.verified_by
     WHERE r.stretch_code = $1 ORDER BY r.recorded_at DESC, r.id DESC`,
    [code],
  );
  return rows.map((r) => ({
    ...r, id: Number(r.id), recorded_at: iso(r.recorded_at)!, verified_at: iso(r.verified_at),
    value_date: r.value_date ? iso(r.value_date)!.slice(0, 10) : null,
  })) as never;
}

export async function loadStretch(q: Q, code: string, lock = false): Promise<StretchRow> {
  const rows = await q<StretchRow>(`SELECT * FROM stretches WHERE code = $1 AND deleted_at IS NULL AND NOT hidden ${lock ? 'FOR UPDATE' : ''}`, [code]);
  if (!rows.length) throw new HttpError(404, `Road stretch ${code} not found.`);
  return rows[0];
}

function inArea(u: SessionUser, st: { admin_zone: string; ward: number }) {
  if (u.role === 'commissioner') return true;
  const a = u.areas as { all?: boolean; admin_zones?: string[]; wards?: (number | string)[] };
  if (a.all) return true;
  return (a.admin_zones ?? []).includes(st.admin_zone) || (a.wards ?? []).map(Number).includes(st.ward);
}
export const can = (u: SessionUser, st: { admin_zone: string; ward: number }) => ({
  update: ROLE_RANK[u.role] >= 1 && u.role !== 'viewer' && inArea(u, st),
  record_compliance: ROLE_RANK[u.role] >= 1 && u.role !== 'viewer' && inArea(u, st),
  // PIU officers do the work, so PMU (or the AEE/DEE/Commissioner) verifies and approves it
  verify: ((ROLE_RANK[u.role] >= 3 && u.role !== 'piu_officer') || u.role === 'pmu_officer') && inArea(u, st),
  approve: ((ROLE_RANK[u.role] >= 4 && u.role !== 'piu_officer') || u.role === 'pmu_officer') && inArea(u, st),
  override: u.role === 'commissioner',
  report_issue: ROLE_RANK[u.role] >= 1 && u.role !== 'viewer' && inArea(u, st),
  resolve_issue: ROLE_RANK[u.role] >= 3 && inArea(u, st),
  assign_issue: ROLE_RANK[u.role] >= 4 && inArea(u, st),
  delete_issue: u.role === 'commissioner',
});

/** Distance (m) from a point to the stretch line. */
export function distanceToLine(geom: { type: string; coordinates: unknown }, lon: number, lat: number): number {
  const lines = (geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates]) as number[][][];
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  let best = Infinity;
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1][0] - lon) * kx, ay = (line[i - 1][1] - lat) * ky;
      const bx = (line[i][0] - lon) * kx, by = (line[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  return Math.round(best);
}

/** A point in the middle of the stretch line (for its badge). */
export function midpoint(geom: { type: string; coordinates: unknown }): [number, number] {
  const lines = (geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates]) as number[][][];
  const line = lines[Math.floor(lines.length / 2)];
  const p = line[Math.floor(line.length / 2)];
  return [p[0], p[1]];
}

export function evaluate(st: StretchRow, items: ComplianceItem[], records: ComplianceRecord[], now = new Date()) {
  const its = items.map((i) => evaluateItem(i, st, st.status, st.milestones ?? {}, records, now));
  return { items: its, summary: summarise(its) };
}

const FIRST_TAGS = /^(Not motorable|Drain clogged|\d+ taps broken|\d+ water leaks)$/;
function tagsAndBadges(st: StretchRow, summary: ReturnType<typeof summarise>) {
  const t = statusTags(st.status, st.planned_manholes);
  const first = t.filter((x) => FIRST_TAGS.test(x));
  const rest = t.filter((x) => !FIRST_TAGS.test(x));
  return { tags: [...first, ...summary.non_compliance_tags, ...rest], badges: statusBadges(st.status) + (summary.theme === 'non_compliance' ? 'C' : '') };
}

/** Recompute and store a stretch's compliance summary, tags, badges and its automatic issues. */
export async function refresh(q: Q, code: string, actor: string | null = null) {
  const st = await loadStretch(q, code);
  const ev = evaluate(st, await currentItems(q), await recordsFor(q, code));
  const { tags, badges } = tagsAndBadges(st, ev.summary);
  const openIssues = await syncIssues(q, st, ev.items, actor);
  await q('UPDATE stretches SET compliance = $2, tags = $3, badges = $4, open_issues = $5 WHERE code = $1',
    [code, JSON.stringify(ev.summary), JSON.stringify(tags), badges, openIssues]);
  return ev.summary;
}

// Overdue states change with time: refresh stored summaries of started stretches at most every 10 minutes.
let lastSweep = 0;
export async function sweep(db: Db, force = false) {
  if (!force && Date.now() - lastSweep < 10 * 60 * 1000) return;
  lastSweep = Date.now();
  const rows = await db.query<{ code: string }>(
    `SELECT code FROM stretches WHERE deleted_at IS NULL AND NOT hidden AND (milestones <> '{}'::jsonb OR open_issues > 0
       OR code IN (SELECT DISTINCT stretch_code FROM compliance_records))`,
  );
  for (const r of rows) await refresh(db.query.bind(db), r.code);
}

export async function card(q: Q, u: SessionUser, code: string) {
  const st = await loadStretch(q, code);
  const items = await currentItems(q);
  const records = await recordsFor(q, code);
  const ev = evaluate(st, items, records);
  const { tags, badges } = tagsAndBadges(st, ev.summary);
  const upd = st.updated_by ? await q<{ name: string }>('SELECT name FROM users WHERE id = $1', [st.updated_by]) : [];
  const { pipes, manholes, ...rest } = st;
  return {
    stretch: { ...rest, updated_at: iso(st.updated_at), updated_by_name: upd[0]?.name ?? null, pipes_count: pipes.length, manholes_count: manholes.length, pipes_detail: pipes },
    tags, badges,
    compliance: {
      summary: ev.summary,
      stages: COMPLIANCE_STAGES.map((s) => ({
        ...s,
        reached_at: st.milestones?.[s.key] ?? null,
        items: ev.items.filter((i) => i.item.due_at === s.key).map((i) => ({
          item: i.item, applies: i.applies, state: i.state, state_label: UNIT_STATE_LABEL[i.state], progress: i.progress,
          units: i.units.map((x) => ({ ...x, state_label: UNIT_STATE_LABEL[x.state] })),
        })),
      })),
      records: records.slice(0, 200),
    },
    issues: await issuesForCard(q, code),
    // project-level pre-work items that would stop work starting on this road
    project_blocks: st.status.cutting === 'none' && st.status.pipeline === 'not_started' ? (await projectGates(q)).filter((g) => g.gate === 'block').map((g) => g.message) : [],
    can: can(u, st),
  };
}

// ---------- input schemas ----------
const keys = <T extends readonly { key: string }[]>(a: T) => a.map((x) => x.key) as [T[number]['key'], ...T[number]['key'][]];
const count = z.number().int().min(0).max(100000);
export const statusSchema = z.object({
  pipeline: z.enum(keys(PIPELINE)), pipe_laid_m: z.number().min(0).max(100000).nullable(),
  manholes_built: count, ics_built: count,
  cutting: z.enum(keys(CUTTING)), cut_length_m: z.number().min(0).max(100000).nullable(),
  road_type: z.enum(keys(ROAD_TYPES)).nullable(), restoration: z.enum(RESTORATION),
  motorability: z.enum(keys(MOTORABILITY)),
  taps_broken: count, taps_restored: count, leaks: count, leaks_fixed: count, drain_clogged: z.boolean(),
  stagnation: z.boolean(), potholes: z.boolean(), uneven_backfill: z.boolean(),
});
export const uuidList = z.array(z.string().uuid()).max(20).default([]);
const statusBody = z.object({
  status: statusSchema, note: z.string().max(2000).default(''), photos: uuidList, gps: gpsSchema,
  version: z.number().int(), override_reason: z.string().max(1000).optional(),
});
const approvalBody = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(2000).default(''), override_reason: z.string().max(1000).optional() });
export const recordBody = z.object({
  item_key: z.string().max(80), unit: z.string().max(80).default(''),
  result: z.enum(['complied', 'not_complied', 'not_applicable']),
  value: z.number().finite().nullable().optional(), value_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reference: z.string().max(200).default(''), reason: z.string().max(2000).default(''),
  photos: uuidList, documents: uuidList, gps: gpsSchema,
});
const verifyBody = z.object({ decision: z.enum(['accept', 'reject']), note: z.string().max(2000).default('') });
const itemBody = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, 'Item code: lower-case letters, digits and _ only.'),
  sort: z.number().int().min(0).max(1000), name: z.string().min(3).max(200), description: z.string().max(2000).default(''),
  category: z.enum(COMPLIANCE_CATEGORIES), due_at: z.enum(keys(COMPLIANCE_STAGES)),
  applies: z.object({
    road_types: z.array(z.enum(keys(ROAD_TYPES))).optional(), min_depth_m: z.number().min(0).max(30).optional(),
    min_dia_mm: z.number().int().min(0).max(5000).optional(), unit_min_dia_mm: z.number().int().min(0).max(5000).optional(),
    admin_zones: z.array(z.string().max(10)).optional(),
  }).default({}),
  per: z.enum(['stretch', 'reach', 'manhole']), evidence: z.array(z.enum(keys(EVIDENCE_KINDS))).min(1, 'Choose at least one kind of evidence.'),
  value_label: z.string().max(100).nullable().default(null), unit: z.string().max(20).nullable().default(null),
  pass_rule: z.object({ op: z.enum(['>=', '<=', 'design_within']), value: z.number().finite() }).nullable().default(null),
  recurring_days: z.number().int().min(1).max(365).nullable().default(null), mandatory: z.boolean(),
  severity: z.enum(['low', 'medium', 'high']), gate: z.enum(['none', 'warn', 'block']), grace_days: z.number().int().min(0).max(365),
});

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const p = schema.safeParse(body);
  if (!p.success) {
    const i = p.error.issues[0];
    throw new HttpError(400, i?.message && !i.message.startsWith('Invalid') ? i.message : `Check the field "${i?.path.join('.') || 'input'}".`);
  }
  return p.data;
}
const CODE = /^W\d{1,3}-S?\d{3,5}$/; // DPR W12-034, site W12-S001
export function codeOf(p: { code: string }) {
  if (!CODE.test(p.code)) throw new HttpError(404, 'Road stretch not found.');
  return p.code;
}

export interface SaveOptions {
  version?: number; // the version the person saw; omitted = no conflict check (bulk updates check their own)
  note: string;
  photos: string[];
  gps?: { lat: number; lon: number; accuracy_m?: number } | null;
  override_reason?: string;
}

/** Validate and save a stretch's new status, with history and refreshed compliance and issues. */
export async function saveStatus(t: Q, u: SessionUser, code: string, raw: WorkStatus, o: SaveOptions) {
  const st = await loadStretch(t, code, true);
  if (!can(u, st).update) throw new HttpError(403, `${code}: you cannot update road stretches outside your area.`);
  if (o.version !== undefined && o.version !== st.version) throw new HttpError(409, 'Someone else updated this stretch after you opened it. Close and open it again to see the latest status.', 'CONFLICT');
  const prev = st.status;
  const next = normaliseStatus(raw);
  const changes = statusChanges(prev, next);
  if (!changes.length) throw new HttpError(400, 'Nothing has changed.', 'NO_CHANGE');
  const check = validateStatus(prev, next, st, o.photos.length, st.approval);
  if (check.errors.length) throw new HttpError(400, check.errors.join(' '), 'VALIDATION');
  const now = new Date();
  const items = await currentItems(t);
  const records = await recordsFor(t, code);
  const gates: { gate: string; message: string }[] = gatesHit(items, st, prev, next, st.milestones ?? {}, records, now);
  // starting work on a road (road cut, or pipe laying begun): project-level pre-work items apply too
  if ((prev.cutting === 'none' && next.cutting !== 'none') || (prev.pipeline === 'not_started' && next.pipeline !== 'not_started')) gates.push(...(await projectGates(t)));
  const blocks = gates.filter((g) => g.gate === 'block');
  let override = '';
  if (blocks.length) {
    if (!(u.role === 'commissioner' && o.override_reason?.trim()))
      throw new HttpError(409, `Not saved. First record these on this work stretch (Compliance tab): ${blocks.map((g) => g.message).join(' ')}${u.role === 'commissioner' ? ' (As Commissioner you may override with a reason.)' : ''}`, 'GATE_BLOCK');
    override = o.override_reason!.trim();
  }
  const warnings = [...check.warnings, ...gates.filter((g) => g.gate === 'warn').map((g) => `Compliance: ${g.message}`), ...(override ? blocks.map((g) => `Overridden: ${g.message}`) : [])];
  const approval = nextApproval(prev, next, st.approval, o.photos.length);
  const allChanges: { field: string; label: string; from: string; to: string }[] = [...changes];
  if (approval !== st.approval) allChanges.push({ field: 'approval', label: 'Approval', from: APPROVAL.find((a) => a.key === st.approval)!.label, to: APPROVAL.find((a) => a.key === approval)!.label });
  const stage = deriveStage(next, approval);
  const milestones = updateMilestones(st.milestones ?? {}, next, now.toISOString());
  const version = st.version + 1;
  const distance = o.gps ? distanceToLine(st.geom, o.gps.lon, o.gps.lat) : null;
  await t(
    `UPDATE stretches SET status = $2, approval = $3, stage = $4, milestones = $5, version = $6,
            updated_at = now(), updated_by = $7 WHERE code = $1`,
    [code, JSON.stringify(next), approval, stage, JSON.stringify(milestones), version, u.id],
  );
  await t(
    `INSERT INTO stretch_history (stretch_code, version, kind, by_user, changes, snapshot, note, photos, gps, distance_m, warnings, override)
     VALUES ($1, $2, 'status', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [code, version, u.id, JSON.stringify(allChanges), JSON.stringify({ status: next, approval, stage }), o.note, JSON.stringify(o.photos),
      o.gps ? JSON.stringify(o.gps) : null, distance, JSON.stringify(warnings), override],
  );
  await refresh(t, code, u.id);
  return { warnings, distance };
}

export interface RecordInput {
  item_key: string; unit: string; result: 'complied' | 'not_complied' | 'not_applicable';
  value?: number | null; value_date?: string | null; reference: string; reason: string;
  photos: string[]; documents: string[]; gps?: { lat: number; lon: number; accuracy_m?: number } | null;
}

/** Record one compliance on one stretch (evidence and pass rule checked). bulkId links records made together. */
export async function recordCompliance(t: Q, u: SessionUser, code: string, b: RecordInput, bulkId: string | null) {
  const st = await loadStretch(t, code, true);
  if (!can(u, st).record_compliance) throw new HttpError(403, `${code}: you cannot record compliances outside your area.`);
  const item = (await currentItems(t)).find((i) => i.key === b.item_key);
  if (!item) throw new HttpError(400, 'This compliance item is not in the current list.');
  const unit = itemUnits(item, st).find((x) => x.id === b.unit);
  if (!unit) throw new HttpError(400, 'Choose which reach or manhole this record is for.');
  let result = b.result;
  const msgs: string[] = [];
  if (result === 'not_applicable' && !b.reason.trim()) throw new HttpError(400, 'Give the reason why this item does not apply.');
  if (result === 'not_complied' && !b.reason.trim() && (b.value === null || b.value === undefined)) throw new HttpError(400, 'Say what was not complied (reason or the measured value).');
  if (result === 'complied') {
    const missing = item.evidence.filter((e) =>
      (e === 'photo' && !b.photos.length) || (e === 'document' && !b.documents.length) || (e === 'value' && (b.value === null || b.value === undefined)) ||
      (e === 'date' && !b.value_date) || (e === 'reference' && !b.reference.trim()));
    if (missing.length) throw new HttpError(400, `Evidence needed: ${missing.map((m) => EVIDENCE_KINDS.find((k) => k.key === m)!.label.toLowerCase()).join(', ')}.`);
  }
  const design = item.pass_rule?.op === 'design_within' ? unit.design_invert ?? null : null;
  if (b.value !== null && b.value !== undefined && result !== 'not_applicable') {
    const ok = passes(item.pass_rule, b.value, design);
    if (ok === false) {
      result = 'not_complied';
      msgs.push(`The measured value ${b.value} ${item.unit ?? ''} fails the rule, so this is recorded as not complied.`);
    }
  }
  const distance = b.gps ? distanceToLine(st.geom, b.gps.lon, b.gps.lat) : null;
  const rec = await t<{ id: string }>(
    `INSERT INTO compliance_records (stretch_code, item_id, item_key, item_version, unit, result, value, design_value, value_date, reference,
                                     reason, photos, documents, gps, distance_m, recorded_by, bulk_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [code, item.id, item.key, item.version, unit.id, result, b.value ?? null, design, b.value_date ?? null, b.reference.trim(), b.reason.trim(),
      JSON.stringify(b.photos), JSON.stringify(b.documents), b.gps ? JSON.stringify(b.gps) : null, distance, u.id, bulkId],
  );
  const word = { complied: 'Complied', not_complied: 'Not complied', not_applicable: 'Not applicable' }[result];
  await t(
    `INSERT INTO stretch_history (stretch_code, version, kind, by_user, changes, snapshot, note, photos, gps, distance_m, warnings)
     VALUES ($1, $2, 'compliance', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [code, st.version, u.id, JSON.stringify([{ field: `compliance:${item.key}`, label: `${item.name}${unit.id ? ` (${unit.label})` : ''}`, from: '', to: word }]),
      JSON.stringify({ status: st.status, approval: st.approval, stage: st.stage }), b.reason, JSON.stringify(b.photos),
      b.gps ? JSON.stringify(b.gps) : null, distance, JSON.stringify(msgs)],
  );
  await refresh(t, code, u.id);
  return { id: Number(rec[0].id), result, messages: msgs };
}

/** Accept or reject one compliance record. Returns its stretch code. */
export async function verifyRecord(t: Q, u: SessionUser, id: number, decision: 'accept' | 'reject', note: string) {
  const rows = await t<{ stretch_code: string; recorded_by: string; verification: string; item_key: string }>(
    'SELECT stretch_code, recorded_by, verification, item_key FROM compliance_records WHERE id = $1 FOR UPDATE', [id]);
  if (!rows.length) throw new HttpError(404, 'Record not found.');
  const r = rows[0];
  const st = await loadStretch(t, r.stretch_code);
  if (!can(u, st).verify) throw new HttpError(403, 'Only the AEE or DEE of the area, the PMU officer or the Commissioner can verify compliances.');
  if (r.recorded_by === u.id && u.role !== 'commissioner') throw new HttpError(403, 'You cannot verify your own record. Another officer must verify it.');
  if (r.verification !== 'waiting') throw new HttpError(400, 'This record has already been verified or rejected.');
  if (decision === 'reject' && !note.trim()) throw new HttpError(400, 'Give the reason for rejecting.');
  await t(`UPDATE compliance_records SET verification = $2, verified_by = $3, verified_at = now(), verify_note = $4 WHERE id = $1`,
    [id, decision === 'accept' ? 'accepted' : 'rejected', u.id, note.trim()]);
  const item = await t<{ name: string }>('SELECT name FROM compliance_items WHERE key = $1 AND is_current', [r.item_key]);
  await t(
    `INSERT INTO stretch_history (stretch_code, version, kind, by_user, changes, snapshot, note)
     VALUES ($1, $2, 'verification', $3, $4, $5, $6)`,
    [st.code, st.version, u.id, JSON.stringify([{ field: `verify:${r.item_key}`, label: item[0]?.name ?? r.item_key, from: 'Waiting for verification', to: decision === 'accept' ? 'Verified' : 'Rejected (due again)' }]),
      JSON.stringify({ status: st.status, approval: st.approval, stage: st.stage }), note.trim()],
  );
  await refresh(t, st.code, u.id);
  return st.code;
}

export function registerWorks(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);

  /** Stage, compliance colour and badges of every stretch that is not plain "not started" (for the map). */
  app.get('/api/stretches/states', async () => {
    await sweep(db);
    const rows = await q<{ code: string; stage: string; theme: string | null; badges: string; geom: StretchRow['geom'] }>(
      `SELECT code, stage, compliance->>'theme' AS theme, badges, CASE WHEN badges <> '' THEN geom END AS geom FROM stretches
       WHERE deleted_at IS NULL AND NOT hidden AND (stage <> 'not_started' OR coalesce(compliance->>'theme', 'nothing_due') <> 'nothing_due' OR badges <> '')`,
    );
    // [code, stage, compliance theme, badges, lon, lat] (position only for stretches with badges)
    return {
      states: rows.map((r) => {
        const mid = r.geom ? midpoint(r.geom) : null;
        return [r.code, r.stage, r.theme ?? 'nothing_due', r.badges, ...(mid ?? [])];
      }),
    };
  });

  app.get<{ Params: { code: string } }>('/api/stretches/:code', async (req) => card(q, req.user!, codeOf(req.params)));

  app.get<{ Params: { code: string } }>('/api/stretches/:code/history', async (req) => {
    const code = codeOf(req.params);
    const rows = await q<Record<string, unknown>>(
      `SELECT h.id, h.version, h.kind, h.at, h.changes, h.snapshot, h.note, h.photos, h.gps, h.distance_m, h.warnings, h.override,
              u.name AS by_name, u.role AS by_role
       FROM stretch_history h LEFT JOIN users u ON u.id = h.by_user WHERE h.stretch_code = $1 ORDER BY h.at DESC, h.id DESC LIMIT 500`,
      [code],
    );
    return { history: rows.map((r) => ({ ...r, id: Number(r.id), at: iso(r.at) })) };
  });

  // ---------- status update ----------
  app.post<{ Params: { code: string } }>('/api/stretches/:code/status', async (req) => {
    const u = req.user!;
    const code = codeOf(req.params);
    const b = parse(statusBody, req.body);
    await checkFiles(db, b.photos, 'photo');
    const result = await db.tx((t) => saveStatus(t, u, code, b.status as WorkStatus, b));
    return { ok: true, ...result, card: await card(q, u, code) };
  });

  // ---------- restoration approval ----------
  app.post<{ Params: { code: string } }>('/api/stretches/:code/approval', async (req) => {
    const u = req.user!;
    const code = codeOf(req.params);
    const b = parse(approvalBody, req.body);
    const result = await db.tx(async (t) => {
      const st = await loadStretch(t, code, true);
      if (!can(u, st).approve) throw new HttpError(403, 'Only the DEE of the area, the PMU officer or the Commissioner can approve or reject a restoration.');
      if (st.approval !== 'pending') throw new HttpError(400, 'This restoration is not waiting for approval.');
      if (b.decision === 'reject' && !b.note.trim()) throw new HttpError(400, 'Give the reason for rejecting.');
      const now = new Date();
      let warnings: string[] = [];
      let override = '';
      if (b.decision === 'approve') {
        const gates = gatesHit(await currentItems(t), st, st.status, st.status, st.milestones ?? {}, await recordsFor(t, code), now, true);
        const blocks = gates.filter((g) => g.gate === 'block');
        if (blocks.length) {
          if (!(u.role === 'commissioner' && b.override_reason?.trim())) throw new HttpError(409, `Not approved. Complete these compliances first: ${blocks.map((g) => g.message).join(' ')}`, 'GATE_BLOCK');
          override = b.override_reason!.trim();
        }
        warnings = gates.filter((g) => g.gate === 'warn').map((g) => `Compliance: ${g.message}`);
      }
      const approval: Approval = b.decision === 'approve' ? 'approved' : 'rejected';
      const stage = deriveStage(st.status, approval);
      const version = st.version + 1;
      await t('UPDATE stretches SET approval = $2, stage = $3, version = $4, updated_at = now(), updated_by = $5 WHERE code = $1', [code, approval, stage, version, u.id]);
      await t(
        `INSERT INTO stretch_history (stretch_code, version, kind, by_user, changes, snapshot, note, warnings, override)
         VALUES ($1, $2, 'approval', $3, $4, $5, $6, $7, $8)`,
        [code, version, u.id, JSON.stringify([{ field: 'approval', label: 'Approval', from: 'Awaiting approval', to: approval === 'approved' ? 'Approved' : 'Rejected' }]),
          JSON.stringify({ status: st.status, approval, stage }), b.note, JSON.stringify(warnings), override],
      );
      await refresh(t, code, u.id);
      return { warnings };
    });
    await audit(db, u.id, `restoration_${b.decision}`, { code });
    return { ok: true, ...result, card: await card(q, u, code) };
  });

  // ---------- compliance: record ----------
  app.post<{ Params: { code: string } }>('/api/stretches/:code/compliance', async (req) => {
    const u = req.user!;
    const code = codeOf(req.params);
    const b = parse(recordBody, req.body);
    await checkFiles(db, b.photos, 'photo');
    await checkFiles(db, b.documents, 'document');
    const out = await db.tx((t) => recordCompliance(t, u, code, b, null));
    return { ok: true, ...out, card: await card(q, u, code) };
  });

  // ---------- compliance: verify ----------
  app.post<{ Params: { id: string } }>('/api/compliance/records/:id/verify', async (req) => {
    const u = req.user!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Record not found.');
    const b = parse(verifyBody, req.body);
    const code = await db.tx((t) => verifyRecord(t, u, id, b.decision, b.note));
    return { ok: true, card: await card(q, u, code) };
  });

  // ---------- monitoring lists ----------
  const listQuery = z.object({
    zone: z.string().max(10).optional(), ward: z.coerce.number().int().optional(), stage: z.string().max(40).optional(),
    theme: z.string().max(40).optional(), approval: z.string().max(20).optional(), q: z.string().max(80).optional(),
    source: z.enum(['dpr', 'site']).optional(),
    sort: z.enum(['code', 'ward', 'length_m', 'stage', 'updated_at', 'score']).default('updated_at'), dir: z.enum(['asc', 'desc']).default('desc'),
    limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0),
  });
  app.get('/api/works', async (req) => {
    await sweep(db);
    const f = parse(listQuery, req.query);
    const where: string[] = ['s.deleted_at IS NULL', 'NOT s.hidden'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (f.zone) add('s.admin_zone = ?', f.zone);
    if (f.ward) add('s.ward = ?', f.ward);
    if (f.source) add('s.source = ?', f.source);
    if (f.q) {
      params.push(`%${f.q}%`);
      where.push(`(s.code ILIKE $${params.length} OR s.road_name ILIKE $${params.length})`);
    }
    const baseWhere = where.join(' AND ');
    const baseParams = [...params];
    if (f.stage) add('s.stage = ?', f.stage);
    if (f.theme) add("coalesce(s.compliance->>'theme', 'nothing_due') = ?", f.theme);
    if (f.approval) add('s.approval = ?', f.approval);
    const order = {
      code: 's.ward, s.code', ward: 's.ward', length_m: 's.length_m', stage: 's.stage', updated_at: 's.updated_at',
      score: "coalesce((s.compliance->>'score')::numeric, -1)",
    }[f.sort];
    const rows = await q<Record<string, unknown>>(
      `SELECT s.code, s.ward, s.admin_zone, s.road_name, s.length_m, s.stage, s.approval, s.tags, s.badges, s.compliance, s.open_issues, s.source, s.work_group, s.start_point, s.end_point, s.status->>'road_type' AS road_type,
              s.updated_at, u.name AS updated_by_name, count(*) OVER () AS total
       FROM stretches s LEFT JOIN users u ON u.id = s.updated_by
       WHERE ${where.join(' AND ')} ORDER BY ${order} ${f.dir.toUpperCase()} NULLS LAST, s.code LIMIT ${f.limit} OFFSET ${f.offset}`,
      params,
    );
    const stages = await q<{ stage: string; n: string; km: number }>(
      `SELECT s.stage, count(*) AS n, sum(s.length_m) / 1000 AS km FROM stretches s WHERE ${baseWhere} GROUP BY s.stage`, baseParams);
    const themes = await q<{ theme: string; n: string; km: number }>(
      `SELECT coalesce(s.compliance->>'theme', 'nothing_due') AS theme, count(*) AS n, sum(s.length_m) / 1000 AS km FROM stretches s WHERE ${baseWhere} GROUP BY 1`, baseParams);
    const waiting = await q<{ approvals: string; verifications: string }>(
      `SELECT (SELECT count(*) FROM stretches s WHERE ${baseWhere} AND s.approval = 'pending') AS approvals,
              (SELECT count(*) FROM compliance_records r JOIN stretches s ON s.code = r.stretch_code WHERE ${baseWhere} AND r.verification = 'waiting') AS verifications`,
      baseParams);
    return {
      total: rows.length ? Number(rows[0].total) : 0,
      rows: rows.map(({ total: _t, ...r }) => ({ ...r, updated_at: iso(r.updated_at) })),
      by_stage: stages.map((s) => ({ stage: s.stage, n: Number(s.n), km: Number(s.km) })),
      by_theme: themes.map((s) => ({ theme: s.theme, n: Number(s.n), km: Number(s.km) })),
      waiting: { approvals: Number(waiting[0].approvals), verifications: Number(waiting[0].verifications) },
    };
  });

  const recQuery = z.object({
    verification: z.enum(['waiting', 'accepted', 'rejected']).optional(), result: z.enum(['complied', 'not_complied', 'not_applicable']).optional(),
    zone: z.string().max(10).optional(), ward: z.coerce.number().int().optional(), item: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200), offset: z.coerce.number().int().min(0).default(0),
  });
  app.get('/api/compliance/records', async (req) => {
    const f = parse(recQuery, req.query);
    const where: string[] = ['true'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (f.verification) add('r.verification = ?', f.verification);
    if (f.result) add('r.result = ?', f.result);
    if (f.zone) add('s.admin_zone = ?', f.zone);
    if (f.ward) add('s.ward = ?', f.ward);
    if (f.item) add('r.item_key = ?', f.item);
    const rows = await q<Record<string, unknown>>(
      `SELECT r.id, r.stretch_code, s.ward, s.admin_zone, r.item_key, i.name AS item_name, i.category, i.mandatory, r.unit, r.result, r.value, r.design_value,
              r.value_date, r.reference, r.reason, r.photos, r.documents, r.distance_m, r.recorded_at, u.name AS recorded_by_name, r.recorded_by,
              r.verification, r.verified_at, v.name AS verified_by_name, r.verify_note, count(*) OVER () AS total
       FROM compliance_records r JOIN stretches s ON s.code = r.stretch_code AND NOT s.hidden JOIN compliance_items i ON i.id = r.item_id
            JOIN users u ON u.id = r.recorded_by LEFT JOIN users v ON v.id = r.verified_by
       WHERE ${where.join(' AND ')} ORDER BY r.recorded_at DESC, r.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
      params,
    );
    const u = req.user!;
    return {
      total: rows.length ? Number(rows[0].total) : 0,
      rows: rows.map(({ total: _t, ...r }) => ({
        ...r, id: Number(r.id), recorded_at: iso(r.recorded_at), verified_at: iso(r.verified_at),
        value_date: r.value_date ? iso(r.value_date)!.slice(0, 10) : null,
        can_verify: r.verification === 'waiting' && can(u, { admin_zone: r.admin_zone as string, ward: r.ward as number }).verify && (r.recorded_by !== u.id || u.role === 'commissioner'),
      })),
    };
  });

  // ---------- the compliance list (Settings > Compliance; Commissioner edits) ----------
  app.get('/api/compliance/items', async () => ({ items: await currentItems(q, true), stages: COMPLIANCE_STAGES, categories: COMPLIANCE_CATEGORIES }));

  app.get<{ Params: { key: string } }>('/api/compliance/items/:key/versions', async (req) => {
    const rows = await q<Record<string, unknown>>(`SELECT ${ITEM_COLS} FROM compliance_items WHERE key = $1 ORDER BY version DESC`, [req.params.key]);
    return { versions: rows.map((r) => ({ ...r, created_at: iso(r.created_at), retired_at: iso(r.retired_at) })) };
  });

  app.post('/api/compliance/items', async (req) => {
    const u = req.user!;
    if (u.role !== 'commissioner') throw new HttpError(403, 'Only the Commissioner can change the compliance list.');
    const b = parse(itemBody, req.body);
    if (b.pass_rule && !b.evidence.includes('value')) throw new HttpError(400, 'A pass rule needs "Measured value" as evidence.');
    const out = await db.tx(async (t) => {
      const cur = await t<{ version: number }>('SELECT version FROM compliance_items WHERE key = $1 AND is_current FOR UPDATE', [b.key]);
      const version = cur.length ? cur[0].version + 1 : 1;
      await t('UPDATE compliance_items SET is_current = false WHERE key = $1 AND is_current', [b.key]);
      const rows = await t<{ id: number }>(
        `INSERT INTO compliance_items (key, version, sort, name, description, category, due_at, applies, per, evidence, value_label, unit, pass_rule,
                                       recurring_days, mandatory, severity, gate, grace_days, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [b.key, version, b.sort, b.name, b.description, b.category, b.due_at, JSON.stringify(b.applies), b.per, JSON.stringify(b.evidence), b.value_label,
          b.unit, b.pass_rule ? JSON.stringify(b.pass_rule) : null, b.recurring_days, b.mandatory, b.severity, b.gate, b.grace_days, u.id],
      );
      return { id: rows[0].id, version };
    });
    await audit(db, u.id, 'compliance_item_saved', { key: b.key, version: out.version });
    await sweep(db, true);
    return { ok: true, ...out };
  });

  app.post<{ Params: { key: string } }>('/api/compliance/items/:key/retire', async (req) => {
    const u = req.user!;
    if (u.role !== 'commissioner') throw new HttpError(403, 'Only the Commissioner can change the compliance list.');
    const b = parse(z.object({ retire: z.boolean() }), req.body);
    const rows = await q('UPDATE compliance_items SET retired_at = $2 WHERE key = $1 AND is_current RETURNING id', [req.params.key, b.retire ? new Date().toISOString() : null]);
    if (!rows.length) throw new HttpError(404, 'Item not found.');
    await audit(db, u.id, b.retire ? 'compliance_item_retired' : 'compliance_item_restored', { key: req.params.key });
    await sweep(db, true);
    return { ok: true };
  });
}
