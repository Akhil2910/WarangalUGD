/**
 * Citizen grievances.
 *  - Each work stretch has a QR code (random token). Scanning it opens the public form /g/<token> (no account).
 *  - Public API (/api/public/...): work stretch summary, photo upload, submit, check status (number + mobile).
 *    Limited per address to stop misuse. Citizens' details are seen only by signed-in staff; the mobile number
 *    is shown in full only to AEE and above.
 *  - Staff: list, detail, assign (DEE and above), resolve / close / reopen / turn into an issue (AEE and above of the area).
 * A new grievance goes to the AEE of the ward and is due in GRIEVANCE_DUE_DAYS days.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  addDays, GRIEVANCE_CATEGORIES, GRIEVANCE_DUE_DAYS, GRIEVANCE_STATUS, indiaDate, maskMobile, NO_CITIZEN_DATA, normaliseMobile, ROLE_RANK, stageLabel,
} from 'shared';
import { HttpError, type SessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { checkFiles, gpsSchema, storeFile } from './files.ts';
import { can, codeOf, inArea, iso, midpoint, parse, type Q } from './works.ts';
import { reportIssue } from './issues.ts';
import { has, ulbOf } from './perms.ts';

// ---------- limits for the public form (per address, in memory) ----------
const hits = new Map<string, number[]>();
function limit(req: FastifyRequest, kind: string, max: number, perMinutes: number) {
  const key = `${kind}:${req.ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < perMinutes * 60000);
  if (recent.length >= max) throw new HttpError(429, 'Too many requests from this device. Please try again later. / చాలా ప్రయత్నాలు జరిగాయి. కొంతసేపటి తర్వాత ప్రయత్నించండి.');
  recent.push(now);
  hits.set(key, recent);
}
export function resetPublicLimits() {
  hits.clear();
}

/** The random token behind a work stretch's QR code (made the first time it is needed). */
async function qrToken(q: Q, code: string) {
  const r = await q<{ qr_token: string | null }>(`SELECT qr_token FROM stretches WHERE code = $1 AND deleted_at IS NULL AND NOT hidden`, [code]);
  if (!r.length) throw new HttpError(404, 'Work stretch not found.');
  if (r[0].qr_token) return r[0].qr_token;
  const t = randomBytes(9).toString('base64url');
  await q('UPDATE stretches SET qr_token = $2 WHERE code = $1 AND qr_token IS NULL', [code, t]);
  return (await q<{ qr_token: string }>('SELECT qr_token FROM stretches WHERE code = $1', [code]))[0].qr_token;
}
const baseUrl = (req: FastifyRequest) => process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') || `${req.protocol}://${req.headers.host}`;

async function nextNumber(q: Q) {
  await q("SELECT pg_advisory_xact_lock(hashtext('grievances'))");
  const r = await q<{ n: number | null }>(`SELECT max((substring(number from '^G-(\\d+)$'))::int) AS n FROM grievances`);
  return `G-${String((r[0].n ?? 0) + 1).padStart(6, '0')}`;
}

/** The AEE responsible for a ward: an active AEE whose areas include it (first by name). */
async function aeeFor(q: Q, ward: number | null, zone: string) {
  const rows = await q<{ id: string; name: string; areas: { all?: boolean; wards?: (number | string)[]; admin_zones?: string[] } }>(
    `SELECT id, name, areas FROM users WHERE role = 'aee' AND active ORDER BY name`);
  const a = rows.find((u) => u.areas?.all || (ward !== null && (u.areas?.wards ?? []).map(Number).includes(ward)) || (u.areas?.admin_zones ?? []).includes(zone));
  return a?.id ?? null;
}

async function event(q: Q, id: number, by: string | null, action: string, note = '', pub = false, photos: string[] = []) {
  await q('INSERT INTO grievance_events (grievance_id, by_user, action, note, public_note, photos) VALUES ($1,$2,$3,$4,$5,$6)', [id, by, action, note, pub, JSON.stringify(photos)]);
}

const catKeys = GRIEVANCE_CATEGORIES.map((c) => c.key) as [string, ...string[]];

export function registerGrievances(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);

  // ---------------- QR code (staff) ----------------
  app.get<{ Params: { code: string } }>('/api/stretches/:code/qr', async (req) => {
    const code = codeOf(req.params);
    const url = `${baseUrl(req)}/g/${await qrToken(q, code)}`;
    const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    return { url, svg };
  });

  // ---------------- public (citizens, no account) ----------------
  const byToken = async (token: string) => {
    if (!/^[A-Za-z0-9_-]{8,24}$/.test(token)) throw new HttpError(404, 'This QR code is not valid. / ఈ QR కోడ్ చెల్లదు.');
    const r = await q<{ code: string; road_name: string; ward: number; admin_zone: string; stage: string; geom: { type: string; coordinates: unknown }; length_m: number; start_point: unknown; end_point: unknown }>(
      `SELECT code, road_name, ward, admin_zone, stage, geom, length_m, start_point, end_point FROM stretches WHERE qr_token = $1 AND deleted_at IS NULL AND NOT hidden`, [token]);
    if (!r.length) throw new HttpError(404, 'This QR code is not valid. / ఈ QR కోడ్ చెల్లదు.');
    return r[0];
  };
  app.get<{ Params: { token: string } }>('/api/public/w/:token', async (req) => {
    limit(req, 'view', 120, 10);
    const s = await byToken(req.params.token);
    return { code: s.code, name: s.road_name, ward: s.ward, zone: s.admin_zone, stage: stageLabel(s.stage), length_m: Math.round(s.length_m), categories: GRIEVANCE_CATEGORIES, due_days: (await ulbOf(q)).settings.grievance_due_days };
  });

  const photoBody = z.object({ name: z.string().max(200).default(''), mime: z.string().max(60), data: z.string().min(10), token: z.string().max(24) });
  app.post('/api/public/photos', { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    limit(req, 'photo', 15, 60);
    const b = parse(photoBody, req.body);
    await byToken(b.token);
    return { id: await storeFile(db, { kind: 'photo', name: b.name, mime: b.mime, data: b.data }, null, true) };
  });

  const gBody = z.object({
    token: z.string().max(24), category: z.enum(catKeys), description: z.string().trim().min(10, 'Please describe the problem (at least 10 letters). / సమస్యను వివరించండి.').max(2000),
    name: z.string().trim().min(2, 'Please enter your name. / మీ పేరు రాయండి.').max(100), mobile: z.string().max(20), house_no: z.string().trim().max(60).default(''),
    language: z.enum(['en', 'te']).default('en'), consent: z.literal(true, { error: 'Please tick the consent box. / అంగీకార పెట్టెలో టిక్ చేయండి.' }),
    photos: z.array(z.string().uuid()).max(3).default([]), gps: gpsSchema,
  });
  app.post('/api/public/grievances', async (req) => {
    limit(req, 'grievance', 5, 60);
    const b = parse(gBody, req.body);
    const mobile = normaliseMobile(b.mobile);
    if (!mobile) throw new HttpError(400, 'Please enter a 10-digit mobile number. / 10 అంకెల మొబైల్ నంబర్ రాయండి.');
    const s = await byToken(b.token);
    if (b.photos.length) {
      const ok = await q('SELECT id FROM files WHERE id = ANY($1::uuid[]) AND public_upload', [b.photos]);
      if (ok.length !== new Set(b.photos).size) throw new HttpError(400, 'A photo was not received. Please add it again.');
    }
    const [lon, lat] = b.gps ? [b.gps.lon, b.gps.lat] : midpoint(s.geom);
    const out = await db.tx(async (t) => {
      const number = await nextNumber(t);
      const due = addDays(indiaDate(), (await ulbOf(t)).settings.grievance_due_days);
      const aee = await aeeFor(t, s.ward, s.admin_zone);
      const r = await t<{ id: string }>(
        `INSERT INTO grievances (number, stretch_code, lon, lat, ward, admin_zone, category, description, photos, name, mobile, house_no, language, consent, status, assignee, due_date, client_ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,$16,$17) RETURNING id`,
        [number, s.code, lon, lat, s.ward, s.admin_zone, b.category, b.description, JSON.stringify(b.photos), b.name, mobile, b.house_no, b.language,
          aee ? 'assigned' : 'new', aee, due, req.ip]);
      const id = Number(r[0].id);
      await event(t, id, null, 'received', 'Received from the QR code at the work site', true);
      if (aee) await event(t, id, null, 'assigned', 'Sent to the AEE of the ward');
      return { number, due_date: due };
    });
    return { ok: true, ...out };
  });

  app.get<{ Params: { number: string }; Querystring: { mobile?: string } }>('/api/public/grievances/:number', async (req) => {
    limit(req, 'status', 30, 10);
    const mobile = normaliseMobile(req.query.mobile ?? '');
    const notFound = new HttpError(404, 'No complaint found with this number and mobile. / ఈ నంబర్ మరియు మొబైల్‌తో ఫిర్యాదు లేదు.');
    if (!/^G-\d{6}$/.test(req.params.number) || !mobile) throw notFound;
    const r = await q<Record<string, unknown>>(`SELECT id, number, category, status, created_at, due_date, resolved_at, stretch_code FROM grievances WHERE number = $1 AND mobile = $2`, [req.params.number, mobile]);
    if (!r.length) throw notFound;
    const ev = await q<{ at: unknown; action: string; note: string }>(`SELECT at, action, note FROM grievance_events WHERE grievance_id = $1 AND public_note ORDER BY at`, [r[0].id]);
    const st = GRIEVANCE_STATUS.find((x) => x.key === r[0].status)!;
    return {
      number: r[0].number, category: GRIEVANCE_CATEGORIES.find((c) => c.key === r[0].category), status: { key: st.key, en: st.en, te: st.te },
      received: iso(r[0].created_at), due_date: String(iso(r[0].due_date)).slice(0, 10), resolved: iso(r[0].resolved_at), work: r[0].stretch_code,
      updates: ev.map((e) => ({ at: iso(e.at), action: e.action, note: e.note })),
    };
  });

  // ---------------- staff ----------------
  const staffOnly = (u: SessionUser) => {
    if (!has(u, 'grievance.view')) throw new HttpError(403, "Grievances hold citizens' personal details; your role does not see them.");
    return u;
  };
  const seeMobile = (u: SessionUser) => has(u, 'grievance.mobile');
  const shape = (u: SessionUser, r: Record<string, unknown>) => ({
    ...r, id: Number(r.id), created_at: iso(r.created_at), updated_at: iso(r.updated_at), resolved_at: iso(r.resolved_at),
    due_date: r.due_date ? String(iso(r.due_date)).slice(0, 10) : null,
    mobile: seeMobile(u) ? r.mobile : maskMobile(String(r.mobile)),
    overdue: !['resolved', 'rejected'].includes(String(r.status)) && indiaDate() > String(iso(r.due_date)).slice(0, 10),
    category_label: GRIEVANCE_CATEGORIES.find((c) => c.key === r.category)?.en ?? r.category,
  });
  const COLS = `g.*, a.name AS assignee_name, rb.name AS resolved_by_name`;
  const FROM = `grievances g LEFT JOIN users a ON a.id = g.assignee LEFT JOIN users rb ON rb.id = g.resolved_by`;

  const listQ = z.object({
    status: z.enum(['open', 'new', 'assigned', 'resolved', 'rejected', 'all']).default('open'), zone: z.string().max(10).optional(), ward: z.coerce.number().int().optional(),
    category: z.string().max(40).optional(), overdue: z.enum(['1']).optional(), mine: z.enum(['1']).optional(), q: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(2000).default(300),
  });
  app.get('/api/grievances', async (req) => {
    const u = staffOnly(req.user!);
    const f = parse(listQ, req.query);
    const where: string[] = ['true'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
    if (f.status === 'open') where.push(`g.status IN ('new','assigned')`);
    else if (f.status !== 'all') add('g.status = ?', f.status);
    if (f.zone) add('g.admin_zone = ?', f.zone);
    if (f.ward) add('g.ward = ?', f.ward);
    if (f.category) add('g.category = ?', f.category);
    if (f.overdue) add(`g.status IN ('new','assigned') AND g.due_date < ?::date`, indiaDate());
    if (f.mine) add('g.assignee = ?', u.id);
    if (f.q) add('(g.number ILIKE ? OR g.description ILIKE ? OR g.stretch_code ILIKE ? OR g.name ILIKE ?)', `%${f.q}%`);
    const rows = await q<Record<string, unknown>>(`SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')} ORDER BY g.created_at DESC LIMIT ${f.limit}`, params);
    const counts = await q<{ status: string; n: string; overdue: string }>(
      `SELECT status, count(*) AS n, count(*) FILTER (WHERE status IN ('new','assigned') AND due_date < $1::date) AS overdue FROM grievances GROUP BY 1`, [indiaDate()]);
    return { rows: rows.map((r) => shape(u, r)), counts: counts.map((c) => ({ status: c.status, n: Number(c.n), overdue: Number(c.overdue) })) };
  });

  const load = async (t: Q, number: string, lock = false) => {
    if (!/^G-\d{6}$/.test(number)) throw new HttpError(404, 'Grievance not found.');
    const r = await t<Record<string, unknown> & { id: string; ward: number; admin_zone: string; status: string; stretch_code: string | null; lon: number; lat: number; description: string; category: string }>(
      `SELECT * FROM grievances WHERE number = $1 ${lock ? 'FOR UPDATE' : ''}`, [number]);
    if (!r.length) throw new HttpError(404, 'Grievance not found.');
    return { ...r[0], id: Number(r[0].id) };
  };
  const area = (g: { ward: number; admin_zone: string }) => ({ ward: g.ward, admin_zone: g.admin_zone });

  app.get<{ Params: { number: string } }>('/api/grievances/:number', async (req) => {
    const u = staffOnly(req.user!);
    const g = await load(q, req.params.number);
    const row = (await q<Record<string, unknown>>(`SELECT ${COLS} FROM ${FROM} WHERE g.id = $1`, [g.id]))[0];
    const ev = await q<Record<string, unknown>>(`SELECT e.*, u.name AS by_name FROM grievance_events e LEFT JOIN users u ON u.id = e.by_user WHERE e.grievance_id = $1 ORDER BY e.at`, [g.id]);
    const c = { resolve_issue: has(u, 'grievance.act') && inArea(u, area(g)), assign_issue: has(u, 'grievance.assign') && inArea(u, area(g)) };
    return {
      grievance: shape(u, row), events: ev.map((e) => ({ ...e, id: Number(e.id), at: iso(e.at) })),
      can: { act: c.resolve_issue, assign: c.assign_issue },
    };
  });

  const act = async (req: FastifyRequest<{ Params: { number: string } }>, fn: (t: Q, g: Awaited<ReturnType<typeof load>>, u: SessionUser) => Promise<void>, who: 'act' | 'assign') => {
    const u = staffOnly(req.user!);
    await db.tx(async (t) => {
      const g = await load(t, req.params.number, true);
      const c = { resolve_issue: has(u, 'grievance.act') && inArea(u, area(g)), assign_issue: has(u, 'grievance.assign') && inArea(u, area(g)) };
      if (who === 'act' && !c.resolve_issue) throw new HttpError(403, 'Only the AEE or DEE of the area, or the Commissioner, can act on grievances.');
      if (who === 'assign' && !c.assign_issue) throw new HttpError(403, 'Only the DEE of the area or the Commissioner can reassign grievances.');
      await fn(t, g, u);
      await t('UPDATE grievances SET updated_at = now() WHERE id = $1', [g.id]);
    });
    return { ok: true };
  };

  app.post<{ Params: { number: string } }>('/api/grievances/:number/assign', async (req) => {
    const b = parse(z.object({ assignee: z.string().uuid(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().max(2000).default('') }), req.body);
    return act(req, async (t, g, u) => {
      if (['resolved', 'rejected'].includes(g.status)) throw new HttpError(400, 'This grievance is closed. Re-open it first.');
      const a = await t<{ name: string }>(`SELECT name FROM users WHERE id = $1 AND active AND role <> 'viewer'`, [b.assignee]);
      if (!a.length) throw new HttpError(400, 'Choose an active officer.');
      await t(`UPDATE grievances SET assignee = $2, status = 'assigned', due_date = coalesce($3::date, due_date) WHERE id = $1`, [g.id, b.assignee, b.due_date ?? null]);
      await event(t, g.id, u.id, 'assigned', `To ${a[0].name}${b.note ? `: ${b.note}` : ''}`);
    }, 'assign');
  });

  const resolveBody = z.object({ note: z.string().trim().min(3, 'Write what was done.').max(2000), photos: z.array(z.string().uuid()).max(10).default([]), public_note: z.string().max(500).optional() });
  app.post<{ Params: { number: string } }>('/api/grievances/:number/resolve', async (req) => {
    const b = parse(resolveBody, req.body);
    await checkFiles(db, b.photos, 'photo');
    return act(req, async (t, g, u) => {
      if (['resolved', 'rejected'].includes(g.status)) throw new HttpError(400, 'This grievance is already closed.');
      await t(`UPDATE grievances SET status = 'resolved', resolved_at = now(), resolved_by = $2, resolution_note = $3, resolution_photos = $4 WHERE id = $1`,
        [g.id, u.id, b.note, JSON.stringify(b.photos)]);
      await event(t, g.id, u.id, 'resolved', b.public_note?.trim() || b.note, true, b.photos);
    }, 'act');
  });
  app.post<{ Params: { number: string } }>('/api/grievances/:number/reject', async (req) => {
    const b = parse(z.object({ note: z.string().trim().min(3, 'Give the reason.').max(2000) }), req.body);
    return act(req, async (t, g, u) => {
      if (['resolved', 'rejected'].includes(g.status)) throw new HttpError(400, 'This grievance is already closed.');
      await t(`UPDATE grievances SET status = 'rejected', resolved_at = now(), resolved_by = $2, resolution_note = $3 WHERE id = $1`, [g.id, u.id, b.note]);
      await event(t, g.id, u.id, 'rejected', b.note, true);
    }, 'act');
  });
  app.post<{ Params: { number: string } }>('/api/grievances/:number/reopen', async (req) => {
    const b = parse(z.object({ note: z.string().trim().min(3, 'Say why it is re-opened.').max(2000) }), req.body);
    return act(req, async (t, g, u) => {
      if (!['resolved', 'rejected'].includes(g.status)) throw new HttpError(400, 'This grievance is not closed.');
      await t(`UPDATE grievances SET status = CASE WHEN assignee IS NULL THEN 'new' ELSE 'assigned' END, resolved_at = NULL, resolved_by = NULL, resolution_note = '' WHERE id = $1`, [g.id]);
      await event(t, g.id, u.id, 'reopened', b.note, true);
    }, 'act');
  });
  // turn a grievance into an issue on its work stretch (the work stretch's issue list then tracks the repair)
  const ISSUE_OF: Record<string, string> = { drain_blocked: 'drain_clogged', water_cut: 'water_leak', road_damage: 'potholes', open_trench: 'other' };
  app.post<{ Params: { number: string } }>('/api/grievances/:number/to-issue', async (req) => {
    let code = '';
    await act(req, async (t, g, u) => {
      if (g.status !== 'assigned' && g.status !== 'new') throw new HttpError(400, 'Only an open grievance can be turned into an issue.');
      code = await reportIssue(t, u, {
        stretch_code: g.stretch_code ?? undefined, lon: g.lon, lat: g.lat, kind: ISSUE_OF[g.category] ?? 'other', count: 1, photos: [],
        remark: `Grievance ${req.params.number}: ${g.description}`,
      });
      await t('UPDATE grievances SET issue_code = $2 WHERE id = $1', [g.id, code]);
      await event(t, g.id, u.id, 'to_issue', `Issue ${code} raised on the work stretch`, true);
    }, 'act');
    return { ok: true, issue: code };
  });
}
