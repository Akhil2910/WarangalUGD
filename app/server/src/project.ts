/**
 * Project-level compliance (Pre-work, During work, Post-work) and "My tasks".
 * Statuses and due dates are worked out by the shared rules (shared/src/project.ts) on every read.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_PROJECT_ITEMS, FREQUENCIES, indiaDate, isAsked, isDone, PHASES, periodsFor, PROJECT_CATEGORIES, PROJECT_EVIDENCE, PROJECT_STATUS,
  PROJECT_SUBMIT_ROLES, PROJECT_VERIFY_ROLES, projectStatus, ROLE_RANK, type Phase, type ProjectItem, type ProjectStatus,
} from 'shared';
import { audit, HttpError, type SessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { iso, type Q } from './works.ts';
import { has } from './perms.ts';
import { scheduleTasks } from './schedule.ts';
import { cur, curPrefix } from './ulbctx.ts';
/** The current ULB as a plain number (safe to put straight into SQL). */
const U = () => Number(cur());

const ORDER: ProjectStatus[] = ['expired', 'overdue', 'rejected', 'expiring', 'due', 'waiting', 'verified', 'not_due', 'event'];
const worst = (a: ProjectStatus[]) => (a.length ? a.reduce((x, y) => (ORDER.indexOf(y) < ORDER.indexOf(x) ? y : x)) : 'not_due');
const dateText = (d: unknown) => (d ? String(d).slice(0, 10) : null);

/** The standard project compliance list. GWMC keeps the plain keys; another ULB's keys start with its code ("KMC:..."). */
export async function loadDefaultProjectItems(db: Pick<Db, 'query'>, ulb = 1, keyPrefix = '') {
  let i = 0;
  for (const it of DEFAULT_PROJECT_ITEMS) {
    i += 10;
    await db.query(
      `INSERT INTO project_items (key, sort, phase, category, name, description, frequency, due_day, has_validity, evidence, gate, mandatory, ulb_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (key) DO NOTHING`,
      [keyPrefix + it.key, i, it.phase, it.category, it.name, it.description, it.frequency, it.due_day, it.has_validity, JSON.stringify(it.evidence), it.gate, it.mandatory, ulb]);
  }
}

interface Rec {
  id: number; item_key: string; period: string; status: 'submitted' | 'verified' | 'rejected'; reference: string; doc_date: string | null; valid_from: string | null; valid_to: string | null;
  note: string; files: { id: string; name: string; kind: string }[]; submitted_by: string; submitted_by_name: string | null; submitted_at: string | null;
  decided_by_name: string | null; decided_at: string | null; decision_note: string; override: string;
}

export const canSubmit = (u: SessionUser) => has(u, 'project.submit');
export const canVerifyRole = (u: SessionUser) => has(u, 'project.verify');

export async function projectState(q: Q, u: SessionUser | null, today = indiaDate()) {
  const [s] = await q<{ name: string; work_start: unknown; completion: unknown }>(`SELECT name, work_start, completion FROM project_settings WHERE ulb_id = ${U()}`);
  const settings = { name: s?.name ?? 'UGD Project', work_start: dateText(s?.work_start), completion: dateText(s?.completion) };
  const items = await q<ProjectItem & { evidence: string[] }>(`SELECT key, sort, phase, category, name, description, frequency, due_day, has_validity, evidence, gate, mandatory, active FROM project_items WHERE ulb_id = ${U()} ORDER BY sort, key`);
  const recs = (await q<Rec & { valid_to: unknown; valid_from: unknown; doc_date: unknown; submitted_at: unknown; decided_at: unknown }>(
    `SELECT r.*, su.name AS submitted_by_name, du.name AS decided_by_name FROM project_records r
     LEFT JOIN users su ON su.id = r.submitted_by LEFT JOIN users du ON du.id = r.decided_by WHERE r.ulb_id = ${U()} ORDER BY r.id DESC`))
    .map((r) => ({ ...r, id: Number(r.id), valid_to: dateText(r.valid_to), valid_from: dateText(r.valid_from), doc_date: dateText(r.doc_date), submitted_at: iso(r.submitted_at), decided_at: iso(r.decided_at) }));
  const latest = new Map<string, Rec>();
  for (const r of recs) if (!latest.has(`${r.item_key}|${r.period}`)) latest.set(`${r.item_key}|${r.period}`, r);
  const open: Record<Phase, boolean> = {
    pre: true,
    during: !!settings.work_start && settings.work_start <= today,
    post: !!settings.completion && settings.completion <= today,
  };
  const rows = items.filter((i) => i.active).map((it) => {
    const periods = it.frequency === 'event'
      ? recs.filter((r) => r.item_key === it.key).slice(0, 24).map((r) => ({ key: r.period, label: r.doc_date ? `Event of ${r.doc_date}` : 'Event', due: null as string | null, record: r, status: projectStatus(it, null, r, today, true) }))
      : periodsFor(it, { work_start: settings.work_start, completion: settings.completion }, today).map((p) => {
        const record = latest.get(`${it.key}|${p.key}`) ?? null;
        return { ...p, record, status: projectStatus(it, p.due, record, today, open[it.phase]) };
      }).reverse();
    const status: ProjectStatus = it.frequency === 'event'
      ? (periods.some((p) => p.status === 'waiting') ? 'waiting' : 'event')
      : periods.length ? worst(periods.map((p) => p.status)) : 'not_due';
    const mine = (p: (typeof periods)[number]) => {
      if (!u) return { can_submit: false, can_verify: false };
      const st = p.status;
      return {
        can_submit: canSubmit(u) && (['due', 'overdue', 'rejected', 'expired', 'expiring'].includes(st) || (it.frequency === 'event')),
        can_verify: canVerifyRole(u) && st === 'waiting' && (p.record?.submitted_by !== u.id || has(u, 'compliance.verify_own')),
      };
    };
    return {
      ...it, status, status_label: PROJECT_STATUS[status].label,
      periods: periods.map((p) => ({ ...p, status_label: PROJECT_STATUS[p.status].label, ...mine(p) })),
      can_override: !!u && has(u, 'override'),
    };
  });
  const summary = PHASES.map((ph) => {
    const pr = rows.filter((r) => r.phase === ph.key).flatMap((r) => r.periods.map((p) => p.status));
    const asked = pr.filter(isAsked);
    return {
      phase: ph.key, label: ph.label, open: open[ph.key],
      items: rows.filter((r) => r.phase === ph.key).length,
      asked: asked.length, done: asked.filter(isDone).length,
      overdue: pr.filter((x) => x === 'overdue' || x === 'expired' || x === 'rejected').length,
      expiring: pr.filter((x) => x === 'expiring').length,
      waiting: pr.filter((x) => x === 'waiting').length,
      score: asked.length ? Math.round((asked.filter(isDone).length / asked.length) * 100) : null,
    };
  });
  return { settings, items: rows, summary, today };
}

/** Project items that stop (block) or warn when work starts on a road and they are not verified. */
export async function projectGates(q: Q) {
  const st = await projectState(q, null);
  return st.items.filter((i) => i.gate !== 'none' && i.phase === 'pre' && !isDone(i.status as ProjectStatus))
    .map((i) => ({ gate: i.gate as 'warn' | 'block', key: i.key, message: `Project: ${i.name} — ${PROJECT_STATUS[i.status as ProjectStatus].label.toLowerCase()}.` }));
}

const fileRef = z.object({ id: z.string().regex(/^[0-9a-f-]{36}$/), name: z.string().max(200).default(''), kind: z.enum(['photo', 'document']) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const submitBody = z.object({
  period: z.string().max(40).default(''),
  reference: z.string().trim().max(120).default(''),
  doc_date: day.nullable().optional(),
  valid_from: day.nullable().optional(),
  valid_to: day.nullable().optional(),
  note: z.string().trim().max(2000).default(''),
  files: z.array(fileRef).max(10).default([]),
});
const itemBody = z.object({
  key: z.string().regex(/^[a-z0-9_]{3,40}$/).optional(),
  phase: z.enum(['pre', 'during', 'post']),
  category: z.enum(PROJECT_CATEGORIES),
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().max(1000).default(''),
  frequency: z.enum(FREQUENCIES.map((f) => f.key) as ['once', 'monthly', 'quarterly', 'event']),
  due_day: z.number().int().min(0).max(365),
  has_validity: z.boolean(),
  evidence: z.array(z.enum(PROJECT_EVIDENCE.map((e) => e.key) as ['document', 'photo', 'reference', 'date'])).min(1),
  gate: z.enum(['none', 'warn', 'block']),
  mandatory: z.boolean(),
  active: z.boolean().default(true),
});

export function registerProject(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);
  const parse = <T>(s: z.ZodType<T>, v: unknown): T => {
    const r = s.safeParse(v);
    if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; '));
    return r.data;
  };
  const event = (t: Q, rec: number | null, key: string, period: string, kind: string, by: string, note = '', detail: unknown = {}) =>
    t(`INSERT INTO project_events (record_id, item_key, period, kind, note, detail, by_user, ulb_id) VALUES ($1,$2,$3,$4,$5,$6,$7,${U()})`, [rec, key, period, kind, note, JSON.stringify(detail), by]);

  app.get('/api/project', async (req) => projectState(q, req.user!));

  app.get<{ Params: { key: string }; Querystring: { period?: string } }>('/api/project/items/:key/history', async (req) => {
    const rows = await q<{ kind: string; note: string; detail: unknown; at: unknown; by_name: string | null; by_role: string | null; period: string }>(
      `SELECT e.kind, e.note, e.detail, e.at, e.period, u.name AS by_name, u.role AS by_role FROM project_events e LEFT JOIN users u ON u.id = e.by_user
       WHERE e.item_key = $1 AND e.ulb_id = ${U()} ${req.query.period !== undefined ? 'AND e.period = $2' : ''} ORDER BY e.at DESC LIMIT 200`,
      req.query.period !== undefined ? [req.params.key, req.query.period] : [req.params.key]);
    return { history: rows.map((r) => ({ ...r, at: iso(r.at) })) };
  });

  app.post<{ Params: { key: string } }>('/api/project/items/:key/submit', async (req) => {
    const u = req.user!;
    if (!canSubmit(u)) throw new HttpError(403, 'Your role does not submit project compliance. The Contractor, PIU, AEE or DEE submits.');
    const b = parse(submitBody, req.body);
    return db.tx(async (t) => {
      const st = await projectState(t, u);
      const it = st.items.find((i) => i.key === req.params.key);
      if (!it) throw new HttpError(404, 'Compliance item not found.');
      let period = b.period;
      if (it.frequency === 'event') period = new Date().toISOString();
      else {
        const p = it.periods.find((x) => x.key === period);
        if (!p) throw new HttpError(400, 'That period is not asked for.');
        if (p.status === 'waiting') throw new HttpError(409, 'This is already waiting for verification.');
        if (p.status === 'verified') throw new HttpError(409, 'This is already verified.');
      }
      const needsFile = it.evidence.includes('document') || it.evidence.includes('photo');
      if (needsFile && !b.files.length) throw new HttpError(400, 'Attach the document or photo.');
      if (it.evidence.includes('reference') && !b.reference) throw new HttpError(400, 'Enter the reference number.');
      if (it.evidence.includes('date') && !b.doc_date) throw new HttpError(400, 'Enter the date.');
      if (it.has_validity && !b.valid_to) throw new HttpError(400, 'Enter the date it is valid until.');
      if (b.valid_from && b.valid_to && b.valid_to < b.valid_from) throw new HttpError(400, '"Valid until" is before "valid from".');
      for (const f of b.files) if (!(await t(`SELECT 1 FROM files WHERE id = $1 AND ulb_id = ${U()}`, [f.id])).length) throw new HttpError(400, 'An attached file was not found. Attach it again.');
      const [r] = await t<{ id: string }>(
        `INSERT INTO project_records (item_key, period, status, reference, doc_date, valid_from, valid_to, note, files, submitted_by, ulb_id)
         VALUES ($1,$2,'submitted',$3,$4,$5,$6,$7,$8,$9,${U()}) RETURNING id`,
        [it.key, period, b.reference, b.doc_date ?? null, b.valid_from ?? null, b.valid_to ?? null, b.note, JSON.stringify(b.files), u.id]);
      await event(t, Number(r.id), it.key, period, 'submitted', u.id, b.note, { reference: b.reference, valid_to: b.valid_to ?? null, files: b.files.length });
      return { ok: true, id: Number(r.id) };
    });
  });

  const decideBody = z.object({ decision: z.enum(['verify', 'reject']), note: z.string().trim().max(1000).default('') });
  app.post<{ Params: { id: string } }>('/api/project/records/:id/decide', async (req) => {
    const u = req.user!;
    if (!canVerifyRole(u)) throw new HttpError(403, 'Only the PMU officer or the Commissioner verifies project compliance.');
    const b = parse(decideBody, req.body);
    if (b.decision === 'reject' && !b.note) throw new HttpError(400, 'Give the reason for rejecting, so it can be corrected.');
    return db.tx(async (t) => {
      const rows = await t<{ id: string; item_key: string; period: string; status: string; submitted_by: string }>(`SELECT id, item_key, period, status, submitted_by FROM project_records WHERE id = $1 AND ulb_id = ${U()} FOR UPDATE`, [Number(req.params.id)]);
      const r = rows[0];
      if (!r) throw new HttpError(404, 'Record not found.');
      if (r.status !== 'submitted') throw new HttpError(409, 'This was already decided.');
      if (r.submitted_by === u.id && !has(u, 'compliance.verify_own')) throw new HttpError(403, 'You cannot verify your own submission.');
      const status = b.decision === 'verify' ? 'verified' : 'rejected';
      await t('UPDATE project_records SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1', [r.id, status, u.id, b.note]);
      await event(t, Number(r.id), r.item_key, r.period, status, u.id, b.note);
      return { ok: true };
    });
  });

  const overrideBody = z.object({ period: z.string().max(40).default(''), reason: z.string().trim().min(5, 'Give the reason').max(1000) });
  app.post<{ Params: { key: string } }>('/api/project/items/:key/override', async (req) => {
    const u = req.user!;
    if (!has(u, 'override')) throw new HttpError(403, 'Your role cannot override.');
    const b = parse(overrideBody, req.body);
    return db.tx(async (t) => {
      const it = (await projectState(t, u)).items.find((i) => i.key === req.params.key);
      if (!it) throw new HttpError(404, 'Compliance item not found.');
      if (it.frequency !== 'event' && !it.periods.some((p) => p.key === b.period)) throw new HttpError(400, 'That period is not asked for.');
      const [r] = await t<{ id: string }>(
        `INSERT INTO project_records (item_key, period, status, note, submitted_by, decided_by, decided_at, override, ulb_id) VALUES ($1,$2,'verified',$3,$4,$4,now(),$3,${U()}) RETURNING id`,
        [it.key, b.period, b.reason, u.id]);
      await event(t, Number(r.id), it.key, b.period, 'overridden', u.id, b.reason);
      await t(`INSERT INTO audit_log (actor, action, detail, ulb_id) VALUES ($1, $2, $3, ${U()})`, [u.id, 'project_override', JSON.stringify({ item: it.key, period: b.period })]);
      return { ok: true };
    });
  });

  const settingsBody = z.object({ name: z.string().trim().min(3).max(120).optional(), work_start: day.nullable().optional(), completion: day.nullable().optional() });
  app.post('/api/project/settings', async (req) => {
    const u = req.user!;
    if (!has(u, 'project.settings')) throw new HttpError(403, 'Your role cannot change the project dates.');
    const b = parse(settingsBody, req.body);
    if (b.work_start && b.completion && b.completion < b.work_start) throw new HttpError(400, 'Completion is before the work start.');
    await q(`UPDATE project_settings SET name = COALESCE($1, name), work_start = CASE WHEN $2::boolean THEN $3::date ELSE work_start END,
             completion = CASE WHEN $4::boolean THEN $5::date ELSE completion END, updated_at = now(), updated_by = $6 WHERE ulb_id = ${U()}`,
      [b.name ?? null, b.work_start !== undefined, b.work_start ?? null, b.completion !== undefined, b.completion ?? null, u.id]);
    await audit(db, u.id, 'project_settings', b);
    return { ok: true };
  });

  app.get('/api/project/items', async () => ({
    items: await q(`SELECT key, sort, phase, category, name, description, frequency, due_day, has_validity, evidence, gate, mandatory, active FROM project_items WHERE ulb_id = ${U()} ORDER BY sort, key`),
  }));
  app.post('/api/project/items', async (req) => {
    const u = req.user!;
    if (!has(u, 'project.settings')) throw new HttpError(403, 'Your role cannot change the project compliance list.');
    const b = parse(itemBody, req.body);
    const kp = curPrefix() ? `${curPrefix().slice(0, -1)}:` : '';
    const key = b.key ?? `${kp}${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32)}_${Date.now().toString(36).slice(-4)}`;
    const exists = (await q(`SELECT 1 FROM project_items WHERE key = $1 AND ulb_id = ${U()}`, [key])).length > 0;
    if (!exists && b.key && (await q('SELECT 1 FROM project_items WHERE key = $1', [key])).length) throw new HttpError(404, 'Compliance item not found.');
    if (exists) {
      await q(`UPDATE project_items SET phase=$2, category=$3, name=$4, description=$5, frequency=$6, due_day=$7, has_validity=$8, evidence=$9, gate=$10, mandatory=$11, active=$12, updated_at=now() WHERE key=$1 AND ulb_id = ${U()}`,
        [key, b.phase, b.category, b.name, b.description, b.frequency, b.due_day, b.has_validity, JSON.stringify(b.evidence), b.gate, b.mandatory, b.active]);
    } else {
      const [{ s }] = await q<{ s: number }>(`SELECT COALESCE(max(sort), 0) + 10 AS s FROM project_items WHERE ulb_id = ${U()}`);
      await q(`INSERT INTO project_items (key, sort, phase, category, name, description, frequency, due_day, has_validity, evidence, gate, mandatory, active, ulb_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,${U()})`,
        [key, Number(s), b.phase, b.category, b.name, b.description, b.frequency, b.due_day, b.has_validity, JSON.stringify(b.evidence), b.gate, b.mandatory, b.active]);
    }
    await audit(db, u.id, exists ? 'project_item_changed' : 'project_item_added', { key });
    return { ok: true, key };
  });

  // ---------------- My tasks ----------------
  app.get('/api/my-tasks', async (req) => {
    const u = req.user!;
    const tasks: { kind: string; tone: 'bad' | 'due' | 'wait'; title: string; detail: string; due: string | null; link: Record<string, string> }[] = [];
    const st = await projectState(q, u);
    for (const it of st.items) {
      for (const p of it.periods) {
        const what = `${it.name}${p.label ? `, ${p.label}` : ''}`;
        if (p.can_verify) tasks.push({ kind: 'project', tone: 'wait', title: `Verify: ${what}`, detail: `Submitted by ${p.record?.submitted_by_name ?? 'someone'}`, due: null, link: { type: 'project', key: it.key, period: p.key } });
        else if (p.can_submit && it.frequency !== 'event') {
          const tone = p.status === 'due' ? 'due' : 'bad';
          const soon = p.status !== 'due' || !p.due || p.due <= addDays(st.today, 15);
          if (soon) tasks.push({ kind: 'project', tone, title: `${p.status === 'expiring' || p.status === 'expired' ? 'Renew' : 'Submit'}: ${what}`, detail: p.status_label + (p.due ? ` · due ${p.due}` : ''), due: p.due, link: { type: 'project', key: it.key, period: p.key } });
        }
      }
    }
    // work-stretch compliance waiting for verification (AEE / DEE / PMU / Commissioner)
    if (has(u, 'compliance.verify')) {
      const [{ n }] = await q<{ n: string }>(`SELECT count(*) AS n FROM compliance_records WHERE verification = 'waiting' AND recorded_by <> $1 AND stretch_code IN (SELECT code FROM stretches WHERE ulb_id = ${U()})`, [u.id]);
      if (Number(n)) tasks.push({ kind: 'stretch', tone: 'wait', title: `Verify ${n} work-stretch compliance record${Number(n) === 1 ? '' : 's'}`, detail: 'Compliance → Work stretches', due: null, link: { type: 'stretch_compliance' } });
    }
    const iss = await q<{ code: string; title: string; due_date: unknown; stretch_code: string | null }>(
      `SELECT code, COALESCE(NULLIF(remark, ''), kind) AS title, due_date, stretch_code FROM issues WHERE assignee = $1 AND ulb_id = ${U()} AND status NOT IN ('resolved') ORDER BY due_date NULLS LAST LIMIT 20`, [u.id]).catch(() => []);
    for (const i of iss) tasks.push({ kind: 'issue', tone: dateText(i.due_date) && dateText(i.due_date)! < st.today ? 'bad' : 'due', title: `Issue ${i.code}: ${String(i.title).slice(0, 80)}`, detail: i.stretch_code ? `Work stretch ${i.stretch_code}` : 'Issue', due: dateText(i.due_date), link: { type: 'issue', code: i.code } });
    const gr = await q<{ number: string; category: string; due_date: unknown }>(
      `SELECT number, category, due_date FROM grievances WHERE assignee = $1 AND ulb_id = ${U()} AND status IN ('new', 'assigned') ORDER BY due_date LIMIT 20`, [u.id]).catch(() => []);
    for (const g of gr) tasks.push({ kind: 'grievance', tone: dateText(g.due_date) && dateText(g.due_date)! < st.today ? 'bad' : 'due', title: `Citizen grievance ${g.number}`, detail: g.category.replace(/_/g, ' '), due: dateText(g.due_date), link: { type: 'grievance', number: g.number } });
    const rank = { bad: 0, wait: 1, due: 2 } as const;
    tasks.push(...(await scheduleTasks(q, u)));
    tasks.sort((a, b) => rank[a.tone] - rank[b.tone] || String(a.due ?? '9').localeCompare(String(b.due ?? '9')));
    return { tasks };
  });
}

function addDays(s: string, n: number) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
