/**
 * Work stretches (WS-NNNN): a named group of one or more roads, made on the map by an AEE or above.
 * Each road keeps its own status, compliance and history (Option 2); the work stretch shows the totals and
 * lets staff update all or some of its roads at once, and record a compliance once for all its roads
 * (each road still gets its own record, linked by a bulk id, and the batch can be verified in one go).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  COMPLIANCE_STAGES, CUTTING, MOTORABILITY, PIPELINE, RESTORATION, ROAD_TYPES, ROLE_RANK, UNIT_STATE_LABEL, deriveStage,
  type ComplianceTheme, type UnitState, type WorkStatus,
} from 'shared';
import { HttpError, type SessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { checkFiles, gpsSchema } from './files.ts';
import { nextNo } from './site.ts';
import {
  can, codeOf, currentItems, evaluate, iso, loadStretch, midpoint, parse, recordBody, recordCompliance, recordsFor, saveStatus, sweep, verifyRecord,
  type Q, type StretchRow,
} from './works.ts';
import { has } from './perms.ts';

const GCODE = /^WS-\d{4,6}$/;
const groupCode = (c: string) => {
  if (!GCODE.test(c)) throw new HttpError(404, 'Work stretch not found.');
  return c;
};
const roadList = z.array(z.string().regex(/^W\d{1,3}-S?\d{3,5}$/, 'Unknown road code.')).min(1, 'Select at least one road.').max(300, 'At most 300 roads in one work stretch.');

interface Member {
  code: string; ward: number; admin_zone: string; road_name: string; length_m: number; planned_manholes: number; status: WorkStatus;
  stage: string; approval: string; compliance: Record<string, number | string | null>; open_issues: number; badges: string; version: number;
  work_group: string | null; updated_at: unknown;
}

const THEME_RANK: Record<string, number> = { nothing_due: 0, all_complied: 1, pending: 2, non_compliance: 3 };

/** Totals over a set of roads. */
function rollup(ms: Member[]) {
  const by: Record<string, { n: number; m: number }> = {};
  let length = 0, laid = 0, mhPlanned = 0, mhBuilt = 0, ics = 0, issues = 0, due = 0, verified = 0, toVerify = 0, overdue = 0, notComplied = 0;
  let theme = 'nothing_due';
  for (const m of ms) {
    length += m.length_m;
    laid += m.status.pipeline === 'laid' ? m.length_m : m.status.pipeline === 'partly' ? Math.min(m.status.pipe_laid_m ?? 0, m.length_m) : 0;
    mhPlanned += m.planned_manholes;
    mhBuilt += m.status.manholes_built;
    ics += m.status.ics_built;
    issues += m.open_issues;
    by[m.stage] = { n: (by[m.stage]?.n ?? 0) + 1, m: (by[m.stage]?.m ?? 0) + m.length_m };
    const c = m.compliance ?? {};
    due += Number(c.due ?? 0); verified += Number(c.verified ?? 0); toVerify += Number(c.to_verify ?? 0);
    overdue += Number(c.overdue ?? 0); notComplied += Number(c.not_complied ?? 0);
    if ((THEME_RANK[String(c.theme ?? 'nothing_due')] ?? 0) > THEME_RANK[theme]) theme = String(c.theme);
  }
  const restored = ms.filter((m) => m.status.restoration === 'done').reduce((a, m) => a + m.length_m, 0);
  return {
    roads: ms.length, length_m: Math.round(length), pipe_laid_m: Math.round(laid), pipe_laid_pct: length ? Math.round((laid / length) * 100) : 0,
    manholes_planned: mhPlanned, manholes_built: mhBuilt, ics_built: ics, restored_m: Math.round(restored),
    restored_pct: length ? Math.round((restored / length) * 100) : 0, open_issues: issues,
    by_stage: Object.entries(by).map(([stage, v]) => ({ stage, n: v.n, m: Math.round(v.m) })),
    compliance: { theme: theme as ComplianceTheme, due, verified, to_verify: toVerify, overdue, not_complied: notComplied, score: due ? Math.round((verified / due) * 100) : null },
  };
}

const MEMBER_COLS = `code, ward, admin_zone, road_name, length_m, planned_manholes, status, stage, approval, compliance, open_issues, badges, version, work_group, updated_at`;

async function members(q: Q, codes: string[]): Promise<Member[]> {
  const rows = await q<Member>(`SELECT ${MEMBER_COLS} FROM stretches WHERE code = ANY($1::text[]) AND deleted_at IS NULL AND NOT hidden ORDER BY ward, code`, [codes]);
  const missing = codes.filter((c) => !rows.some((r) => r.code === c));
  if (missing.length) throw new HttpError(400, `Road(s) not found: ${missing.slice(0, 10).join(', ')}.`);
  return rows;
}
async function groupMembers(q: Q, code: string): Promise<Member[]> {
  return q<Member>(`SELECT ${MEMBER_COLS} FROM stretches WHERE work_group = $1 AND deleted_at IS NULL AND NOT hidden ORDER BY ward, code`, [code]);
}
async function loadGroup(q: Q, code: string, lock = false) {
  const rows = await q<Record<string, unknown> & { code: string; name: string }>(`SELECT * FROM work_groups WHERE code = $1 AND NOT hidden ${lock ? 'FOR UPDATE' : ''}`, [groupCode(code)]);
  if (!rows.length) throw new HttpError(404, 'Work stretch not found.');
  return rows[0];
}
async function event(q: Q, code: string, by: string, action: string, note = '', detail: Record<string, unknown> = {}) {
  await q('INSERT INTO work_group_events (group_code, by_user, action, note, detail) VALUES ($1,$2,$3,$4,$5)', [code, by, action, note, JSON.stringify(detail)]);
}

const canManage = (u: SessionUser, ms: { admin_zone: string; ward: number }[]) => has(u, 'stretch.create') && ms.every((m) => can(u, m).update);

/** Per compliance item: how each road stands (for the work stretch's Compliance tab). */
async function groupCompliance(q: Q, codes: string[]) {
  const items = await currentItems(q);
  const perRoad: { code: string; items: ReturnType<typeof evaluate>['items'] }[] = [];
  for (const c of codes) {
    const st = await loadStretch(q, c);
    perRoad.push({ code: c, items: evaluate(st, items, await recordsFor(q, c)).items });
  }
  const WORST: UnitState[] = ['not_complied', 'overdue', 'due', 'complied', 'verified', 'not_applicable', 'not_due'];
  return COMPLIANCE_STAGES.map((s) => ({
    ...s,
    items: items.filter((i) => i.due_at === s.key).map((item) => {
      const roads = perRoad.map((r) => {
        const it = r.items.find((x) => x.item.key === item.key)!;
        return { code: r.code, applies: it.applies, state: it.state, state_label: UNIT_STATE_LABEL[it.state], progress: it.progress };
      }).filter((r) => r.applies);
      const counts: Record<string, number> = {};
      for (const r of roads) counts[r.state] = (counts[r.state] ?? 0) + 1;
      const state = WORST.find((w) => counts[w]) ?? 'not_due';
      const done = roads.filter((r) => ['complied', 'verified', 'not_applicable'].includes(r.state)).length;
      return { item, roads, state, state_label: UNIT_STATE_LABEL[state], done, applies_to: roads.length, group_recordable: item.per === 'stretch' };
    }).filter((x) => x.applies_to > 0),
  }));
}

const BULK_FIELDS = z.object({
  pipeline: z.enum(PIPELINE.map((p) => p.key).filter((k) => k !== 'partly') as ['not_started', 'laid']).optional(),
  cutting: z.enum(CUTTING.map((c) => c.key) as [string, ...string[]]).optional(),
  road_type: z.enum(ROAD_TYPES.map((r) => r.key) as [string, ...string[]]).nullable().optional(),
  restoration: z.enum(RESTORATION).optional(),
  motorability: z.enum(MOTORABILITY.map((m) => m.key) as [string, ...string[]]).optional(),
  drain_clogged: z.boolean().optional(), stagnation: z.boolean().optional(), potholes: z.boolean().optional(), uneven_backfill: z.boolean().optional(),
});

/** [minLon, minLat, maxLon, maxLat] of a work stretch's roads (for "go to"). */
async function groupBbox(q: Q, code: string) {
  const rows = await q<{ geom: { type: string; coordinates: unknown } }>('SELECT geom FROM stretches WHERE work_group = $1', [code]);
  const pts = rows.flatMap((r) => ((r.geom.type === 'MultiLineString' ? (r.geom.coordinates as number[][][]).flat() : r.geom.coordinates) as number[][]));
  if (!pts.length) return null;
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

export function registerWorkGroups(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);

  // groups for the map: outline + label
  app.get('/api/work-groups/map', async () => {
    const rows = await q<{ code: string; name: string; roads: string[] }>(
      `SELECT g.code, g.name, array_agg(s.code ORDER BY s.code) AS roads FROM work_groups g JOIN stretches s ON s.work_group = g.code
       WHERE s.deleted_at IS NULL AND NOT s.hidden AND NOT g.hidden GROUP BY g.code, g.name`);
    const out = [];
    for (const g of rows) {
      const mid = g.roads[Math.floor(g.roads.length / 2)];
      const st = await q<{ geom: StretchRow['geom'] }>('SELECT geom FROM stretches WHERE code = $1', [mid]);
      const ms = await groupMembers(q, g.code);
      const r = rollup(ms);
      out.push({ code: g.code, name: g.name, roads: g.roads, label: midpoint(st[0].geom), pipe_laid_pct: r.pipe_laid_pct, theme: r.compliance.theme });
    }
    return { groups: out };
  });

  // list with totals
  const listQuery = z.object({ zone: z.string().max(10).optional(), ward: z.coerce.number().int().optional(), q: z.string().max(80).optional() });
  app.get('/api/work-groups', async (req) => {
    await sweep(db);
    const f = parse(listQuery, req.query);
    const gs = await q<Record<string, unknown> & { code: string }>(
      `SELECT g.*, u.name AS created_by_name FROM work_groups g LEFT JOIN users u ON u.id = g.created_by WHERE NOT g.hidden ORDER BY g.created_at DESC`);
    const out = [];
    for (const g of gs) {
      const ms = await groupMembers(q, g.code);
      if (!ms.length) continue;
      if (f.zone && !ms.some((m) => m.admin_zone === f.zone)) continue;
      if (f.ward && !ms.some((m) => m.ward === f.ward)) continue;
      if (f.q && !`${g.code} ${g.name} ${g.package} ${g.contractor} ${ms.map((m) => m.code + ' ' + m.road_name).join(' ')}`.toLowerCase().includes(f.q.toLowerCase())) continue;
      out.push({
        code: g.code, name: g.name, package: g.package, contractor: g.contractor, start_date: g.start_date ? iso(g.start_date)!.slice(0, 10) : null,
        created_by_name: g.created_by_name, created_at: iso(g.created_at), wards: [...new Set(ms.map((m) => m.ward))], zones: [...new Set(ms.map((m) => m.admin_zone))],
        ...rollup(ms),
      });
    }
    return { groups: out };
  });

  // preview while selecting roads on the map
  app.post('/api/work-groups/preview', async (req) => {
    const b = parse(z.object({ roads: roadList, group: z.string().optional() }), req.body);
    const ms = await members(q, b.roads);
    const taken = ms.filter((m) => m.work_group && m.work_group !== b.group).map((m) => ({ code: m.code, group: m.work_group }));
    return { ...rollup(ms), wards: [...new Set(ms.map((m) => m.ward))], zones: [...new Set(ms.map((m) => m.admin_zone))], taken, can_create: canManage(req.user!, ms) };
  });

  const groupBody = z.object({
    name: z.string().trim().min(3, 'Give the work stretch a name (at least 3 letters).').max(200),
    package: z.string().trim().max(100).default(''), contractor: z.string().trim().max(200).default(''),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), note: z.string().max(2000).default(''),
  });

  app.post('/api/work-groups', async (req) => {
    const u = req.user!;
    const b = parse(groupBody.extend({ roads: roadList }), req.body);
    const code = await db.tx(async (t) => {
      const ms = await members(t, [...new Set(b.roads)]);
      if (!canManage(u, ms)) throw new HttpError(403, 'Only an AEE, DEE or the Commissioner of the area can create work stretches.');
      const taken = ms.filter((m) => m.work_group);
      if (taken.length) throw new HttpError(400, `Already in another work stretch: ${taken.slice(0, 10).map((m) => `${m.code} (${m.work_group})`).join(', ')}. Remove them there first.`);
      const code = `WS-${String(await nextNo(t, 'work_groups', '^WS-(\\d+)$')).padStart(4, '0')}`;
      await t(`INSERT INTO work_groups (code, name, package, contractor, start_date, note, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [code, b.name, b.package, b.contractor, b.start_date ?? null, b.note, u.id]);
      await t('UPDATE stretches SET work_group = $2 WHERE code = ANY($1::text[])', [ms.map((m) => m.code), code]);
      await event(t, code, u.id, 'created', b.note, { name: b.name, roads: ms.map((m) => m.code) });
      return code;
    });
    return { ok: true, code };
  });

  app.post<{ Params: { code: string } }>('/api/work-groups/:code/edit', async (req) => {
    const u = req.user!;
    const b = parse(groupBody.partial().extend({ add: z.array(z.string()).max(300).default([]), remove: z.array(z.string()).max(300).default([]) }), req.body);
    await db.tx(async (t) => {
      const g = await loadGroup(t, req.params.code, true);
      const cur = await groupMembers(t, g.code);
      const adds = b.add.length ? await members(t, b.add) : [];
      if (!canManage(u, [...cur, ...adds])) throw new HttpError(403, 'Only an AEE, DEE or the Commissioner of the area can change work stretches.');
      const taken = adds.filter((m) => m.work_group && m.work_group !== g.code);
      if (taken.length) throw new HttpError(400, `Already in another work stretch: ${taken.slice(0, 10).map((m) => `${m.code} (${m.work_group})`).join(', ')}.`);
      const removing = cur.filter((m) => b.remove.includes(m.code));
      if (cur.length - removing.length + adds.filter((a) => !cur.some((c) => c.code === a.code)).length < 1) throw new HttpError(400, 'A work stretch needs at least one road.');
      const fields = (['name', 'package', 'contractor', 'start_date', 'note'] as const).filter((k) => b[k] !== undefined);
      if (fields.length) {
        await t(`UPDATE work_groups SET ${fields.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_by = $${fields.length + 2}, updated_at = now() WHERE code = $1`,
          [g.code, ...fields.map((k) => b[k] ?? null), u.id]);
        await event(t, g.code, u.id, 'edited', '', Object.fromEntries(fields.map((k) => [k, { from: g[k] ?? null, to: b[k] }])));
      }
      if (adds.length) {
        await t('UPDATE stretches SET work_group = $2 WHERE code = ANY($1::text[])', [adds.map((m) => m.code), g.code]);
        await event(t, g.code, u.id, 'roads_added', '', { roads: adds.map((m) => m.code) });
      }
      if (removing.length) {
        await t('UPDATE stretches SET work_group = NULL WHERE code = ANY($1::text[]) AND work_group = $2', [removing.map((m) => m.code), g.code]);
        await event(t, g.code, u.id, 'roads_removed', '', { roads: removing.map((m) => m.code) });
      }
    });
    return { ok: true };
  });

  // the work stretch card
  app.get<{ Params: { code: string } }>('/api/work-groups/:code', async (req) => {
    const u = req.user!;
    const g = await loadGroup(q, req.params.code);
    const ms = await groupMembers(q, g.code);
    const users = await q<{ id: string; name: string }>('SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [[g.created_by, g.updated_by].filter(Boolean)]);
    const name = (id: unknown) => users.find((x) => x.id === id)?.name ?? null;
    return {
      group: {
        code: g.code, name: g.name, package: g.package, contractor: g.contractor, note: g.note,
        start_date: g.start_date ? iso(g.start_date)!.slice(0, 10) : null, created_at: iso(g.created_at), created_by_name: name(g.created_by),
        updated_at: iso(g.updated_at), updated_by_name: name(g.updated_by),
      },
      totals: rollup(ms),
      bbox: await groupBbox(q, g.code),
      roads: ms.map((m) => ({ ...m, updated_at: iso(m.updated_at) })),
      compliance: await groupCompliance(q, ms.map((m) => m.code)),
      bulks: await q<Record<string, unknown>>(
        `SELECT r.bulk_id, r.item_key, i.name AS item_name, min(r.recorded_at) AS recorded_at, u.name AS recorded_by_name, r.recorded_by,
                count(*) AS records, count(*) FILTER (WHERE r.verification = 'waiting') AS waiting, min(r.result) AS result
         FROM compliance_records r JOIN compliance_items i ON i.id = r.item_id JOIN users u ON u.id = r.recorded_by
         WHERE r.bulk_id IS NOT NULL AND r.stretch_code = ANY($1::text[])
         GROUP BY r.bulk_id, r.item_key, i.name, u.name, r.recorded_by ORDER BY min(r.recorded_at) DESC LIMIT 50`, [ms.map((m) => m.code)],
      ).then((rows) => rows.map((r) => ({ ...r, recorded_at: iso(r.recorded_at), records: Number(r.records), waiting: Number(r.waiting),
        can_verify: Number(r.waiting) > 0 && ms.every((m) => can(u, m).verify) && (r.recorded_by !== u.id || has(u, 'compliance.verify_own')) }))),
      can: {
        edit: canManage(u, ms),
        update: ms.length > 0 && ms.every((m) => can(u, m).update),
        record_compliance: ms.length > 0 && ms.every((m) => can(u, m).record_compliance),
        verify: ms.length > 0 && ms.every((m) => can(u, m).verify),
      },
    };
  });

  app.get<{ Params: { code: string } }>('/api/work-groups/:code/history', async (req) => {
    const g = await loadGroup(q, req.params.code);
    const ev = await q<Record<string, unknown>>(
      `SELECT e.id, e.at, e.action, e.note, e.detail, u.name AS by_name FROM work_group_events e LEFT JOIN users u ON u.id = e.by_user
       WHERE e.group_code = $1 ORDER BY e.at DESC LIMIT 200`, [g.code]);
    const sh = await q<Record<string, unknown>>(
      `SELECT h.id, h.stretch_code, h.version, h.kind, h.at, h.changes, h.note, h.photos, h.distance_m, h.warnings, h.override, u.name AS by_name
       FROM stretch_history h LEFT JOIN users u ON u.id = h.by_user
       WHERE h.stretch_code IN (SELECT code FROM stretches WHERE work_group = $1) AND h.kind <> 'created'
       ORDER BY h.at DESC LIMIT 400`, [g.code]);
    const all = [
      ...ev.map((e) => ({ type: 'group', ...e, id: `g${e.id}`, at: iso(e.at) })),
      ...sh.map((h) => ({ type: 'road', ...h, id: `r${h.id}`, at: iso(h.at) })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return { history: all };
  });

  // update all or some roads at once (each road gets its own history row; all or nothing)
  const statusAll = z.object({
    roads: roadList, set: BULK_FIELDS, versions: z.record(z.string(), z.number().int()).default({}),
    note: z.string().max(2000).default(''), photos: z.array(z.string().uuid()).max(20).default([]), gps: gpsSchema, override_reason: z.string().max(1000).optional(),
  });
  app.post<{ Params: { code: string } }>('/api/work-groups/:code/status', async (req) => {
    const u = req.user!;
    const b = parse(statusAll, req.body);
    if (!Object.keys(b.set).length) throw new HttpError(400, 'Choose at least one item to change.');
    await checkFiles(db, b.photos, 'photo');
    const out = await db.tx(async (t) => {
      const g = await loadGroup(t, req.params.code, true);
      const cur = await groupMembers(t, g.code);
      const notIn = b.roads.filter((c) => !cur.some((m) => m.code === c));
      if (notIn.length) throw new HttpError(400, `Not in this work stretch: ${notIn.join(', ')}.`);
      const errors: string[] = [];
      const results: { code: string; warnings: string[]; skipped?: boolean }[] = [];
      for (const code of b.roads) {
        const m = cur.find((x) => x.code === code)!;
        try {
          const r = await saveStatus(t, u, code, { ...m.status, ...b.set } as WorkStatus,
            { version: b.versions[code], note: b.note ? `${g.code}: ${b.note}` : `Updated with work stretch ${g.code}`, photos: b.photos, gps: b.gps, override_reason: b.override_reason });
          results.push({ code, warnings: r.warnings });
        } catch (e) {
          const err = e as HttpError;
          if (err.code === 'NO_CHANGE') results.push({ code, warnings: [], skipped: true });
          else errors.push(`${code}: ${err.message}`);
        }
      }
      if (errors.length) throw new HttpError(400, `Nothing was saved. ${errors.join(' ')}`, 'BULK_REFUSED');
      if (!results.some((r) => !r.skipped)) throw new HttpError(400, 'Nothing has changed on the selected roads.');
      await event(t, g.code, u.id, 'status_all', b.note, { roads: results.filter((r) => !r.skipped).map((r) => r.code), set: b.set });
      return results;
    });
    return { ok: true, results: out };
  });

  // record a whole-stretch compliance item once for all (or some) roads
  const complianceAll = recordBody.omit({ unit: true }).extend({ roads: roadList });
  app.post<{ Params: { code: string } }>('/api/work-groups/:code/compliance', async (req) => {
    const u = req.user!;
    const b = parse(complianceAll, req.body);
    await checkFiles(db, b.photos, 'photo');
    await checkFiles(db, b.documents, 'document');
    const out = await db.tx(async (t) => {
      const g = await loadGroup(t, req.params.code, true);
      const cur = await groupMembers(t, g.code);
      const notIn = b.roads.filter((c) => !cur.some((m) => m.code === c));
      if (notIn.length) throw new HttpError(400, `Not in this work stretch: ${notIn.join(', ')}.`);
      const item = (await currentItems(t)).find((i) => i.key === b.item_key);
      if (!item) throw new HttpError(400, 'This compliance item is not in the current list.');
      if (item.per !== 'stretch') throw new HttpError(400, `"${item.name}" is recorded for each ${item.per === 'reach' ? 'pipe reach' : 'manhole'}: record it on each road.`);
      const bulk = randomUUID();
      const results = [];
      for (const code of b.roads) {
        try {
          results.push({ code, ...(await recordCompliance(t, u, code, { ...b, unit: '' }, bulk)) });
        } catch (e) {
          throw new HttpError((e as HttpError).status ?? 400, `${code}: ${(e as Error).message} Nothing was saved.`);
        }
      }
      await event(t, g.code, u.id, 'compliance_all', b.reason, { item: item.key, roads: b.roads, bulk });
      return { bulk, results };
    });
    return { ok: true, ...out };
  });

  // verify (or reject) every waiting record of one batch
  app.post<{ Params: { bulk: string } }>('/api/compliance/bulk/:bulk/verify', async (req) => {
    const u = req.user!;
    const bulk = req.params.bulk;
    if (!/^[0-9a-f-]{36}$/.test(bulk)) throw new HttpError(404, 'Batch not found.');
    const b = parse(z.object({ decision: z.enum(['accept', 'reject']), note: z.string().max(2000).default('') }), req.body);
    const n = await db.tx(async (t) => {
      const ids = await t<{ id: string }>(`SELECT id FROM compliance_records WHERE bulk_id = $1 AND verification = 'waiting' ORDER BY id`, [bulk]);
      if (!ids.length) throw new HttpError(400, 'No records of this batch are waiting for verification.');
      for (const r of ids) await verifyRecord(t, u, Number(r.id), b.decision, b.note);
      return ids.length;
    });
    return { ok: true, verified: n };
  });
}
