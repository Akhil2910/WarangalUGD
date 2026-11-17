/**
 * Work stretches and the site network.
 *  - A Work stretch is made from pipes: DPR pipes (manhole to manhole, from the DPR network) and/or pipelines
 *    drawn on the image. It is a row in `stretches` (source = 'site', code W<ward>-S<NNN>), so status, compliance,
 *    issues and history apply unchanged. A pipe belongs to at most one work stretch (stretch_pipes).
 *  - Drawn manholes may be placed anywhere, or on a DPR manhole (they then carry its code).
 *  - The pipes need not join up; the app reports how many separate pieces they form.
 * Only an AEE, DEE or the Commissioner of the area makes work stretches and draws.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EMPTY_STATUS, ROLE_RANK } from 'shared';
import { HttpError, type SessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { dprManhole, dprPipe } from './dpr.ts';
import { metres, nearCity, wardAt } from './geo.ts';
import { can, codeOf, inArea, midpoint, parse, refresh, type Q } from './works.ts';
import { has } from './perms.ts';

const canDraw = (u: SessionUser, at: { ward: number; admin_zone: string }) => has(u, 'stretch.create') && inArea(u, at);
const DRAW_ROLES = 'Only an AEE, DEE or the Commissioner of the area can draw or make work stretches.';
const LIVE = 'deleted_at IS NULL AND NOT hidden';

interface Mh { id: number; code: string; lon: number; lat: number; ward: number; admin_zone: string; depth_m: number | null; invert_m: number | null; note: string; dpr_mh: string | null }
interface Pipe { id: number; code: string; from_mh: number; to_mh: number; dia_mm: number; material: string; length_m: number; ward: number; admin_zone: string }

/** The next number after the highest one used in `table`.code (pattern captures the number). */
export async function nextNo(q: Q, table: 'site_manholes' | 'site_pipes' | 'stretches' | 'issues' | 'work_groups', pattern: string) {
  await q("SELECT pg_advisory_xact_lock(hashtext($1))", [table]); // two people saving at once get different numbers (held to the end of the transaction)
  const r = await q<{ n: number | null }>(`SELECT max((substring(code from $1))::int) AS n FROM ${table} WHERE code ~ $1`, [pattern]);
  return (r[0].n ?? 0) + 1;
}

async function event(q: Q, by: string, action: string, detail: Record<string, unknown>) {
  await q('INSERT INTO site_events (by_user, action, detail) VALUES ($1,$2,$3)', [by, action, JSON.stringify(detail)]);
}
async function loadMh(q: Q, id: number, lock = false): Promise<Mh> {
  const r = await q<Mh>(`SELECT * FROM site_manholes WHERE id = $1 AND ${LIVE} ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!r.length) throw new HttpError(404, 'Manhole not found.');
  return { ...r[0], id: Number(r[0].id) };
}
async function stretchOfPipe(q: Q, code: string) {
  const r = await q<{ stretch_code: string }>('SELECT stretch_code FROM stretch_pipes WHERE pipe_id = $1', [code]);
  return r[0]?.stretch_code ?? null;
}

/** How many separate pieces a set of pipes forms (pipes sharing a manhole are joined). */
function pieces(ends: [string, string][]) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const [a, b] of ends) parent.set(find(a), find(b));
  return new Set([...parent.keys()].map(find)).size;
}

/** Start and end of a work stretch: the two loose ends of a single run of pipes; otherwise the first pipe's start and the last pipe's end. */
function ends(pipes: [string, string][], pos: Map<string, [number, number]>) {
  const degree = new Map<string, number>();
  for (const [a, b] of pipes) for (const m of [a, b]) degree.set(m, (degree.get(m) ?? 0) + 1);
  const loose = [...degree.entries()].filter(([, d]) => d === 1).map(([m]) => m);
  let s = pipes[0][0], e = pipes[pipes.length - 1][1];
  if (loose.length === 2 && pieces(pipes) === 1) [s, e] = loose.includes(pipes[0][0]) ? [pipes[0][0], loose.find((m) => m !== pipes[0][0])!] : [loose[0], loose[1]];
  const pt = (m: string) => ({ code: m, lon: Math.round(pos.get(m)![0] * 1e6) / 1e6, lat: Math.round(pos.get(m)![1] * 1e6) / 1e6 });
  return { start_point: pt(s), end_point: pt(e) };
}

interface Part { code: string; dia: number; from: string; to: string; length: number; ward: number; zone: string; coords: number[][]; inv: [number | null, number | null]; depth: [number | null, number | null] }

/** Everything a stretch row needs, from DPR pipe ids and drawn pipeline ids. */
async function stretchFields(q: Q, siteIds: number[], dprIds: string[]) {
  const parts: Part[] = [];
  for (const id of new Set(dprIds)) {
    const p = dprPipe(id);
    if (!p) throw new HttpError(400, `DPR pipe ${id} not found.`);
    parts.push({ code: p.id, dia: p.dia_mm, from: p.from_mh, to: p.to_mh, length: p.length_m, ward: p.ward, zone: p.admin_zone, coords: p.coords,
      inv: [p.il_up, p.il_dn], depth: [p.depth_up, p.depth_dn] });
  }
  if (siteIds.length) {
    const rows = await q<Pipe & { a_code: string; a_lon: number; a_lat: number; a_depth: number | null; a_inv: number | null; b_code: string; b_lon: number; b_lat: number; b_depth: number | null; b_inv: number | null }>(
      `SELECT p.*, a.code AS a_code, a.lon AS a_lon, a.lat AS a_lat, a.depth_m AS a_depth, a.invert_m AS a_inv,
              b.code AS b_code, b.lon AS b_lon, b.lat AS b_lat, b.depth_m AS b_depth, b.invert_m AS b_inv
       FROM site_pipes p JOIN site_manholes a ON a.id = p.from_mh JOIN site_manholes b ON b.id = p.to_mh
       WHERE p.id = ANY($1::bigint[]) AND p.deleted_at IS NULL AND NOT p.hidden ORDER BY p.id`, [[...new Set(siteIds)]]);
    if (rows.length !== new Set(siteIds).size) throw new HttpError(400, 'Some of the selected drawn pipelines were not found (deleted?).');
    for (const p of rows)
      parts.push({ code: p.code, dia: p.dia_mm, from: p.a_code, to: p.b_code, length: p.length_m, ward: p.ward, zone: p.admin_zone,
        coords: [[p.a_lon, p.a_lat], [p.b_lon, p.b_lat]], inv: [p.a_inv, p.b_inv], depth: [p.a_depth, p.b_depth] });
  }
  if (!parts.length) throw new HttpError(400, 'Select at least one pipe.');
  // where each manhole is (for the start and end point)
  const pos = new Map<string, [number, number]>();
  for (const p of parts) {
    pos.set(p.from, p.coords[0] as [number, number]);
    pos.set(p.to, p.coords[p.coords.length - 1] as [number, number]);
  }
  const byWard = new Map<number, { m: number; zone: string }>();
  const dia: Record<string, number> = {};
  const mh = new Map<string, [string, number | null, boolean]>();
  const depths: number[] = [];
  for (const p of parts) {
    byWard.set(p.ward, { m: (byWard.get(p.ward)?.m ?? 0) + p.length, zone: p.zone });
    dia[p.dia] = Math.round(((dia[p.dia] ?? 0) + p.length) * 10) / 10;
    for (const [c, inv] of [[p.from, p.inv[0]], [p.to, p.inv[1]]] as [string, number | null][]) {
      const old = mh.get(c);
      const low = old?.[1] == null ? inv : inv == null ? old[1] : Math.min(old[1], inv); // design invert: the lowest pipe invert there
      mh.set(c, [c, low, (old?.[2] ?? false) || p.dia >= 250]);
    }
    for (const d of p.depth) if (typeof d === 'number') depths.push(d);
  }
  const [ward, w] = [...byWard.entries()].sort((a, b) => b[1].m - a[1].m)[0];
  return {
    ward, admin_zone: w.zone,
    length_m: Math.round(parts.reduce((a, p) => a + p.length, 0) * 100) / 100,
    planned_manholes: mh.size, dia_m: dia, max_dia_mm: Math.max(...parts.map((p) => p.dia)),
    max_depth_m: depths.length ? Math.max(...depths) : null,
    geom: { type: 'MultiLineString', coordinates: parts.map((p) => p.coords) },
    pipes: parts.map((p) => [p.code, p.dia, p.from, p.to, Math.round(p.length * 100) / 100]),
    manholes: [...mh.values()],
    codes: parts.map((p) => p.code),
    pieces: pieces(parts.map((p) => [p.from, p.to])),
    ...ends(parts.map((p) => [p.from, p.to]), pos),
    catchment: parts.map((p) => dprPipe(p.code)?.catchment).find(Boolean) ?? '',
  };
}

const mhBody = z.object({
  lon: z.number().min(-180).max(180).optional(), lat: z.number().min(-90).max(90).optional(),
  dpr_mh: z.string().max(60).optional(), code: z.string().trim().max(40).optional(),
  depth_m: z.number().min(0).max(30).nullable().optional(), invert_m: z.number().min(-100).max(2000).nullable().optional(), note: z.string().max(1000).default(''),
});
const DIAS = [100, 110, 150, 160, 200, 225, 250, 300, 315, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1400, 1600, 1800];
const pipeBody = z.object({
  from_mh: z.number().int().positive(), to_mh: z.number().int().positive(),
  dia_mm: z.number().int().refine((d) => DIAS.includes(d), 'Choose a diameter from the list.'),
  material: z.string().trim().max(60).default(''), note: z.string().max(1000).default(''),
});
const DPR_ID = z.string().regex(/^P\d{6}$/, 'Unknown DPR pipe.');

export function registerSite(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);

  // work stretches, drawn network, and which DPR pipes are already in a work stretch (for the map)
  app.get('/api/site/map', async () => {
    const mhs = await q<Mh & { pipes: string }>(
      `SELECT m.*, (SELECT count(*) FROM site_pipes p WHERE p.deleted_at IS NULL AND NOT p.hidden AND (p.from_mh = m.id OR p.to_mh = m.id)) AS pipes
       FROM site_manholes m WHERE m.deleted_at IS NULL AND NOT m.hidden`);
    const pipes = await q<Pipe & { a_lon: number; a_lat: number; b_lon: number; b_lat: number; stretch: string | null; a_code: string; b_code: string }>(
      `SELECT p.*, a.lon AS a_lon, a.lat AS a_lat, b.lon AS b_lon, b.lat AS b_lat, a.code AS a_code, b.code AS b_code, sp.stretch_code AS stretch
       FROM site_pipes p JOIN site_manholes a ON a.id = p.from_mh JOIN site_manholes b ON b.id = p.to_mh
       LEFT JOIN stretch_pipes sp ON sp.pipe_id = p.code WHERE p.deleted_at IS NULL AND NOT p.hidden`);
    const sts = await q<{ code: string; road_name: string; stage: string; theme: string | null; badges: string; geom: { type: string; coordinates: unknown }; length_m: number }>(
      `SELECT code, road_name, stage, compliance->>'theme' AS theme, badges, geom, length_m FROM stretches WHERE source = 'site' AND deleted_at IS NULL AND NOT hidden`);
    const taken = await q<{ pipe_id: string; stretch_code: string }>(
      `SELECT sp.pipe_id, sp.stretch_code FROM stretch_pipes sp JOIN stretches s ON s.code = sp.stretch_code WHERE NOT s.hidden AND sp.pipe_id LIKE 'P%'`);
    const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features });
    return {
      manholes: fc(mhs.map((m) => ({ type: 'Feature', id: Number(m.id), geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
        properties: { id: Number(m.id), code: m.code, depth_m: m.depth_m, invert_m: m.invert_m, ward: m.ward, pipes: Number(m.pipes), dpr: m.dpr_mh ?? '' } }))),
      pipes: fc(pipes.map((p) => ({ type: 'Feature', id: Number(p.id), geometry: { type: 'LineString', coordinates: [[p.a_lon, p.a_lat], [p.b_lon, p.b_lat]] },
        properties: { id: Number(p.id), code: p.code, dia_mm: p.dia_mm, material: p.material, length_m: Math.round(p.length_m * 10) / 10, from: p.a_code, to: p.b_code, stretch: p.stretch ?? '', ward: p.ward } }))),
      stretches: fc(sts.map((s) => ({ type: 'Feature', geometry: s.geom,
        properties: { code: s.code, name: s.road_name, stage: s.stage, theme: s.theme ?? 'nothing_due', badges: s.badges, length_m: Math.round(s.length_m) } }))),
      dpr_taken: Object.fromEntries(taken.map((t) => [t.pipe_id, t.stretch_code])),
    };
  });

  // ---- manholes (anywhere, or on a DPR manhole) ----
  app.post('/api/site/manholes', async (req) => {
    const u = req.user!;
    const b = parse(mhBody, req.body);
    let lon = b.lon, lat = b.lat, code = b.code;
    if (b.dpr_mh) {
      const pos = dprManhole(b.dpr_mh);
      if (!pos) throw new HttpError(400, `DPR manhole ${b.dpr_mh} not found.`);
      const have = await q<Mh>(`SELECT * FROM site_manholes WHERE dpr_mh = $1 AND ${LIVE}`, [b.dpr_mh]);
      if (have.length) return { ok: true, id: Number(have[0].id), code: have[0].code, ward: have[0].ward, outside_ward: false, existing: true };
      [lon, lat] = pos;
      code = b.dpr_mh;
    }
    if (lon === undefined || lat === undefined) throw new HttpError(400, 'Tap the map to place the manhole.');
    if (!nearCity(lon, lat)) throw new HttpError(400, 'That point is outside the city area.');
    const w = wardAt(lon, lat);
    if (!canDraw(u, w)) throw new HttpError(403, DRAW_ROLES);
    return db.tx(async (t) => {
      if (!code) code = `SMH-${String(await nextNo(t, 'site_manholes', '^SMH-(\\d+)$')).padStart(4, '0')}`;
      if ((await t('SELECT 1 FROM site_manholes WHERE lower(code) = lower($1) AND deleted_at IS NULL AND NOT hidden', [code])).length)
        throw new HttpError(400, `Manhole number ${code} is already used. Give another number.`);
      const r = await t<{ id: string }>(
        `INSERT INTO site_manholes (code, lon, lat, ward, admin_zone, outside_ward, depth_m, invert_m, note, created_by, updated_by, dpr_mh)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11) RETURNING id`,
        [code, lon, lat, w.ward, w.admin_zone, w.outside, b.depth_m ?? null, b.invert_m ?? null, b.note, u.id, b.dpr_mh ?? null]);
      const id = Number(r[0].id);
      await event(t, u.id, 'manhole_added', { id, code, ward: w.ward, dpr_mh: b.dpr_mh ?? null });
      return { ok: true, id, code, ward: w.ward, outside_ward: w.outside, existing: false };
    });
  });

  app.post<{ Params: { id: string } }>('/api/site/manholes/:id/edit', async (req) => {
    const u = req.user!;
    const b = parse(mhBody.omit({ dpr_mh: true }).partial(), req.body);
    return db.tx(async (t) => {
      const m = await loadMh(t, Number(req.params.id), true);
      if (!canDraw(u, m)) throw new HttpError(403, DRAW_ROLES);
      const moving = b.lon !== undefined && b.lat !== undefined && (b.lon !== m.lon || b.lat !== m.lat);
      if (m.dpr_mh && (moving || (b.code && b.code !== m.code))) throw new HttpError(400, 'This manhole is a DPR manhole: its number and position come from the DPR.');
      if (b.code && b.code.toLowerCase() !== m.code.toLowerCase()) {
        if ((await t('SELECT 1 FROM site_manholes WHERE lower(code) = lower($1) AND deleted_at IS NULL AND NOT hidden AND id <> $2', [b.code, m.id])).length)
          throw new HttpError(400, `Manhole number ${b.code} is already used.`);
      }
      const pipes = await t<Pipe>('SELECT * FROM site_pipes WHERE deleted_at IS NULL AND NOT hidden AND (from_mh = $1 OR to_mh = $1)', [m.id]);
      const inStretch = [];
      for (const p of pipes) { const s = await stretchOfPipe(t, p.code); if (s) inStretch.push(s); }
      if ((moving || (b.code && b.code !== m.code)) && inStretch.length)
        throw new HttpError(400, `This manhole is on work stretch ${[...new Set(inStretch)].join(', ')}. Take its pipelines out of the stretch first to move or renumber it.`);
      let w = { ward: m.ward, admin_zone: m.admin_zone, outside: false };
      if (moving) {
        if (!nearCity(b.lon!, b.lat!)) throw new HttpError(400, 'That point is outside the city area.');
        w = wardAt(b.lon!, b.lat!);
        if (!canDraw(u, w)) throw new HttpError(403, DRAW_ROLES);
      }
      await t(`UPDATE site_manholes SET code = $2, lon = $3, lat = $4, ward = $5, admin_zone = $6, depth_m = $7, invert_m = $8, note = $9, updated_by = $10, updated_at = now() WHERE id = $1`,
        [m.id, b.code || m.code, moving ? b.lon : m.lon, moving ? b.lat : m.lat, w.ward, w.admin_zone,
          b.depth_m === undefined ? m.depth_m : b.depth_m, b.invert_m === undefined ? m.invert_m : b.invert_m, b.note ?? m.note, u.id]);
      if (moving) {
        for (const p of pipes) {
          const [a, c] = [await loadMh(t, Number(p.from_mh)), await loadMh(t, Number(p.to_mh))];
          const mid = wardAt((a.lon + c.lon) / 2, (a.lat + c.lat) / 2);
          await t('UPDATE site_pipes SET length_m = $2, ward = $3, admin_zone = $4 WHERE id = $1', [p.id, metres(a.lon, a.lat, c.lon, c.lat), mid.ward, mid.admin_zone]);
        }
      }
      await event(t, u.id, moving ? 'manhole_moved' : 'manhole_edited', { id: m.id, code: b.code || m.code });
      return { ok: true };
    });
  });

  app.post<{ Params: { id: string } }>('/api/site/manholes/:id/delete', async (req) => {
    const u = req.user!;
    return db.tx(async (t) => {
      const m = await loadMh(t, Number(req.params.id), true);
      if (!canDraw(u, m)) throw new HttpError(403, DRAW_ROLES);
      if ((await t('SELECT 1 FROM site_pipes WHERE deleted_at IS NULL AND NOT hidden AND (from_mh = $1 OR to_mh = $1)', [m.id])).length)
        throw new HttpError(400, 'Delete the pipelines connected to this manhole first.');
      await t('UPDATE site_manholes SET deleted_at = now(), updated_by = $2 WHERE id = $1', [m.id, u.id]);
      await event(t, u.id, 'manhole_deleted', { id: m.id, code: m.code });
      return { ok: true };
    });
  });

  // ---- drawn pipelines ----
  app.post('/api/site/pipes', async (req) => {
    const u = req.user!;
    const b = parse(pipeBody, req.body);
    if (b.from_mh === b.to_mh) throw new HttpError(400, 'A pipeline must join two different manholes.');
    return db.tx(async (t) => {
      const [a, c] = [await loadMh(t, b.from_mh), await loadMh(t, b.to_mh)];
      const mid = wardAt((a.lon + c.lon) / 2, (a.lat + c.lat) / 2);
      if (!canDraw(u, a) || !canDraw(u, c)) throw new HttpError(403, DRAW_ROLES);
      if ((await t('SELECT 1 FROM site_pipes WHERE deleted_at IS NULL AND NOT hidden AND ((from_mh = $1 AND to_mh = $2) OR (from_mh = $2 AND to_mh = $1))', [a.id, c.id])).length)
        throw new HttpError(400, `There is already a drawn pipeline between ${a.code} and ${c.code}.`);
      const len = metres(a.lon, a.lat, c.lon, c.lat);
      if (len < 0.5) throw new HttpError(400, 'The two manholes are at the same place.');
      if (len > 1000) throw new HttpError(400, `That pipeline would be ${Math.round(len)} m long. Put manholes along the way (at most 1,000 m between two).`);
      const code = `SP-${String(await nextNo(t, 'site_pipes', '^SP-(\\d+)$')).padStart(6, '0')}`;
      const r = await t<{ id: string }>(
        `INSERT INTO site_pipes (code, from_mh, to_mh, dia_mm, material, length_m, ward, admin_zone, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [code, a.id, c.id, b.dia_mm, b.material, len, mid.ward, mid.admin_zone, b.note, u.id]);
      await event(t, u.id, 'pipe_added', { id: Number(r[0].id), code, from: a.code, to: c.code, dia_mm: b.dia_mm });
      return { ok: true, id: Number(r[0].id), code, length_m: Math.round(len * 10) / 10 };
    });
  });

  app.post<{ Params: { id: string } }>('/api/site/pipes/:id/delete', async (req) => {
    const u = req.user!;
    return db.tx(async (t) => {
      const r = await t<Pipe>('SELECT * FROM site_pipes WHERE id = $1 AND deleted_at IS NULL AND NOT hidden FOR UPDATE', [Number(req.params.id)]);
      if (!r.length) throw new HttpError(404, 'Pipeline not found.');
      const p = r[0];
      if (!canDraw(u, p)) throw new HttpError(403, DRAW_ROLES);
      const s = await stretchOfPipe(t, p.code);
      if (s) throw new HttpError(400, `This pipeline is part of work stretch ${s}. Take it out of the stretch first.`);
      await t('UPDATE site_pipes SET deleted_at = now() WHERE id = $1', [p.id]);
      await event(t, u.id, 'pipe_deleted', { id: Number(p.id), code: p.code });
      return { ok: true };
    });
  });

  // ---- work stretches from DPR pipes and/or drawn pipelines ----
  const ids = z.array(z.number().int().positive()).max(500).default([]);
  const dprIds = z.array(DPR_ID).max(500).default([]);

  app.post('/api/site/stretches/preview', async (req) => {
    const b = parse(z.object({ pipes: ids, dpr_pipes: dprIds, stretch: z.string().optional() }), req.body);
    if (!b.pipes.length && !b.dpr_pipes.length) return { pipes: 0, length_m: 0, manholes: 0, pieces: 0, taken: [], ward: null };
    const f = await stretchFields(q, b.pipes, b.dpr_pipes);
    const taken = await q<{ pipe_id: string; stretch_code: string }>(
      'SELECT pipe_id, stretch_code FROM stretch_pipes WHERE pipe_id = ANY($1::text[]) AND stretch_code <> $2', [f.codes, b.stretch ?? '']);
    return { pipes: f.codes.length, length_m: f.length_m, manholes: f.planned_manholes, pieces: f.pieces, dia_m: f.dia_m, ward: f.ward, admin_zone: f.admin_zone, taken,
      can_create: canDraw(req.user!, f), start_point: f.start_point, end_point: f.end_point };
  });

  const point = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), code: z.string().max(60).optional() });
  const stretchBody = z.object({ name: z.string().trim().min(3, 'Give the work stretch a name (at least 3 letters).').max(200), pipes: ids, dpr_pipes: dprIds,
    start_point: point.optional(), end_point: point.optional() });
  app.post('/api/site/stretches', async (req) => {
    const u = req.user!;
    const b = parse(stretchBody, req.body);
    const out = await db.tx(async (t) => {
      const f = await stretchFields(t, b.pipes, b.dpr_pipes);
      if (!canDraw(u, f)) throw new HttpError(403, DRAW_ROLES);
      const taken = await t<{ pipe_id: string; stretch_code: string }>('SELECT pipe_id, stretch_code FROM stretch_pipes WHERE pipe_id = ANY($1::text[])', [f.codes]);
      if (taken.length) throw new HttpError(400, `Already in a work stretch: ${taken.slice(0, 10).map((x) => `${x.pipe_id} (${x.stretch_code})`).join(', ')}.`);
      const n = await nextNo(t, 'stretches', '-S(\\d+)$');
      const code = `W${f.ward}-S${String(n).padStart(3, '0')}`;
      await t(
        `INSERT INTO stretches (code, ward, admin_zone, catchment, road_name, length_m, planned_manholes, dia_m, max_dia_mm, max_depth_m, geom, pipes, manholes, status, source, updated_by, start_point, end_point)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'site',$15,$16,$17)`,
        [code, f.ward, f.admin_zone, f.catchment, b.name, f.length_m, f.planned_manholes, JSON.stringify(f.dia_m), f.max_dia_mm, f.max_depth_m,
          JSON.stringify(f.geom), JSON.stringify(f.pipes), JSON.stringify(f.manholes), JSON.stringify(EMPTY_STATUS), u.id,
          JSON.stringify(b.start_point ? { code: b.start_point.code ?? '', ...b.start_point, typed: true } : f.start_point),
          JSON.stringify(b.end_point ? { code: b.end_point.code ?? '', ...b.end_point, typed: true } : f.end_point)]);
      await t('INSERT INTO stretch_pipes (pipe_id, stretch_code) SELECT unnest($1::text[]), $2', [f.codes, code]);
      await t(`INSERT INTO stretch_history (stretch_code, version, kind, by_user, changes, snapshot, note)
               VALUES ($1, 1, 'created', $2, $3, $4, $5)`,
        [code, u.id, JSON.stringify([{ field: 'created', label: 'Work stretch made', from: '', to: `${f.codes.length} pipe(s), ${Math.round(f.length_m)} m${f.pieces > 1 ? `, in ${f.pieces} separate pieces` : ''}` }]),
          JSON.stringify({ status: EMPTY_STATUS, approval: 'none', stage: 'not_started' }), b.name]);
      await event(t, u.id, 'stretch_created', { code, pipes: f.codes });
      await refresh(t, code, u.id);
      return { code, pieces: f.pieces };
    });
    return { ok: true, ...out };
  });

  app.post<{ Params: { code: string } }>('/api/site/stretches/:code/pipes', async (req) => {
    const u = req.user!;
    const code = codeOf(req.params);
    const b = parse(z.object({ add: ids, remove: ids, add_dpr: dprIds, remove_dpr: dprIds, name: z.string().trim().min(3).max(200).optional() }), req.body);
    const out = await db.tx(async (t) => {
      const st = (await t<{ code: string; source: string; ward: number; admin_zone: string; pipes: [string][]; version: number; road_name: string; status: unknown; approval: string; stage: string }>(
        'SELECT * FROM stretches WHERE code = $1 AND deleted_at IS NULL AND NOT hidden FOR UPDATE', [code]))[0];
      if (!st) throw new HttpError(404, 'Work stretch not found.');
      if (st.source !== 'site') throw new HttpError(400, 'Only work stretches can be changed here.');
      if (!canDraw(u, st)) throw new HttpError(403, DRAW_ROLES);
      const curCodes = st.pipes.map((p) => p[0]);
      const curDpr = curCodes.filter((c) => /^P\d{6}$/.test(c));
      const curSite = (await t<{ id: string; code: string }>('SELECT id, code FROM site_pipes WHERE code = ANY($1::text[])', [curCodes])).map((r) => ({ id: Number(r.id), code: r.code }));
      const site = [...new Set([...curSite.filter((x) => !b.remove.includes(x.id)).map((x) => x.id), ...b.add])];
      const dpr = [...new Set([...curDpr.filter((x) => !b.remove_dpr.includes(x)), ...b.add_dpr])];
      if (!site.length && !dpr.length) throw new HttpError(400, 'A work stretch needs at least one pipe.');
      const f = await stretchFields(t, site, dpr);
      const addCodes = f.codes.filter((c) => !curCodes.includes(c));
      const taken = await t<{ pipe_id: string; stretch_code: string }>('SELECT pipe_id, stretch_code FROM stretch_pipes WHERE pipe_id = ANY($1::text[])', [addCodes]);
      if (taken.length) throw new HttpError(400, `Already in a work stretch: ${taken.map((x) => `${x.pipe_id} (${x.stretch_code})`).join(', ')}.`);
      const version = st.version + 1;
      await t(`UPDATE stretches SET road_name = $2, length_m = $3, planned_manholes = $4, dia_m = $5, max_dia_mm = $6, max_depth_m = $7, geom = $8, pipes = $9, manholes = $10,
               version = $11, updated_at = now(), updated_by = $12, start_point = $13, end_point = $14 WHERE code = $1`,
        [code, b.name ?? st.road_name, f.length_m, f.planned_manholes, JSON.stringify(f.dia_m), f.max_dia_mm, f.max_depth_m, JSON.stringify(f.geom), JSON.stringify(f.pipes), JSON.stringify(f.manholes), version, u.id,
          JSON.stringify(f.start_point), JSON.stringify(f.end_point)]);
      await t('DELETE FROM stretch_pipes WHERE stretch_code = $1 AND NOT (pipe_id = ANY($2::text[]))', [code, f.codes]);
      if (addCodes.length) await t('INSERT INTO stretch_pipes (pipe_id, stretch_code) SELECT unnest($1::text[]), $2', [addCodes, code]);
      await t(`INSERT INTO stretch_history (stretch_code, version, kind, by_user, changes, snapshot, note) VALUES ($1, $2, 'network', $3, $4, $5, '')`,
        [code, version, u.id, JSON.stringify([{ field: 'pipes', label: 'Pipes', from: `${curCodes.length} pipe(s)`, to: `${f.codes.length} pipe(s), ${Math.round(f.length_m)} m${f.pieces > 1 ? `, ${f.pieces} pieces` : ''}` },
          ...(b.name && b.name !== st.road_name ? [{ field: 'name', label: 'Name', from: st.road_name, to: b.name }] : [])]),
          JSON.stringify({ status: st.status, approval: st.approval, stage: st.stage })]);
      await event(t, u.id, 'stretch_pipes', { code, pipes: f.codes });
      await refresh(t, code, u.id);
      return { pieces: f.pieces };
    });
    return { ok: true, ...out };
  });

  // ---- correct the start / end point by typing ----
  app.post<{ Params: { code: string } }>('/api/site/stretches/:code/ends', async (req) => {
    const u = req.user!;
    const code = codeOf(req.params);
    const b = parse(z.object({ start_point: point, end_point: point }), req.body);
    for (const p of [b.start_point, b.end_point]) if (!nearCity(p.lon, p.lat)) throw new HttpError(400, 'A point is outside the city area. Check latitude and longitude.');
    await db.tx(async (t) => {
      const st = (await t<{ ward: number; admin_zone: string; version: number; start_point: unknown; end_point: unknown; status: unknown; approval: string; stage: string }>(
        `SELECT * FROM stretches WHERE code = $1 AND source = 'site' AND deleted_at IS NULL AND NOT hidden FOR UPDATE`, [code]))[0];
      if (!st) throw new HttpError(404, 'Work stretch not found.');
      if (!canDraw(u, st)) throw new HttpError(403, DRAW_ROLES);
      const s = { ...b.start_point, code: b.start_point.code ?? '', typed: true };
      const e = { ...b.end_point, code: b.end_point.code ?? '', typed: true };
      const fmt = (p: unknown) => (p ? `${(p as { lat: number }).lat}, ${(p as { lon: number }).lon}` : '—');
      const version = st.version + 1;
      await t('UPDATE stretches SET start_point = $2, end_point = $3, version = $4, updated_at = now(), updated_by = $5 WHERE code = $1', [code, JSON.stringify(s), JSON.stringify(e), version, u.id]);
      await t(`INSERT INTO stretch_history (stretch_code, version, kind, by_user, changes, snapshot, note) VALUES ($1, $2, 'network', $3, $4, $5, '')`,
        [code, version, u.id, JSON.stringify([{ field: 'start', label: 'Start point', from: fmt(st.start_point), to: fmt(s) }, { field: 'end', label: 'End point', from: fmt(st.end_point), to: fmt(e) }]),
          JSON.stringify({ status: st.status, approval: st.approval, stage: st.stage })]);
    });
    return { ok: true };
  });

  // ---- rename a work stretch (kept in its history) ----
  app.post<{ Params: { code: string } }>('/api/site/stretches/:code/name', async (req) => {
    const u = req.user!;
    const code = codeOf(req.params);
    const b = parse(z.object({ name: z.string().trim().min(3, 'Give a name of at least 3 letters.').max(200) }), req.body);
    await db.tx(async (t) => {
      const st = (await t<{ ward: number; admin_zone: string; version: number; road_name: string; status: unknown; approval: string; stage: string }>(
        `SELECT * FROM stretches WHERE code = $1 AND source = 'site' AND deleted_at IS NULL AND NOT hidden FOR UPDATE`, [code]))[0];
      if (!st) throw new HttpError(404, 'Work stretch not found.');
      if (!canDraw(u, st)) throw new HttpError(403, DRAW_ROLES);
      if (st.road_name === b.name) return;
      const version = st.version + 1;
      await t('UPDATE stretches SET road_name = $2, version = $3, updated_at = now(), updated_by = $4 WHERE code = $1', [code, b.name, version, u.id]);
      await t(`INSERT INTO stretch_history (stretch_code, version, kind, by_user, changes, snapshot, note) VALUES ($1, $2, 'network', $3, $4, $5, '')`,
        [code, version, u.id, JSON.stringify([{ field: 'name', label: 'Name', from: st.road_name, to: b.name }]), JSON.stringify({ status: st.status, approval: st.approval, stage: st.stage })]);
    });
    return { ok: true };
  });

  // ---- search over the database (work stretches, drawn manholes) ----
  app.get<{ Querystring: { q?: string } }>('/api/search/db', async (req) => {
    const s = (req.query.q ?? '').trim();
    if (s.length < 2 || s.length > 80) return { results: [] };
    const like = `%${s}%`;
    const out: { kind: string; label: string; detail: string; lon: number; lat: number; code?: string }[] = [];
    for (const st of await q<{ code: string; road_name: string; ward: number; geom: { type: string; coordinates: unknown } }>(
      `SELECT code, road_name, ward, geom FROM stretches WHERE source = 'site' AND deleted_at IS NULL AND NOT hidden AND (code ILIKE $1 OR road_name ILIKE $1) LIMIT 10`, [like])) {
      const [lon, lat] = midpoint(st.geom);
      out.push({ kind: 'Work stretch', label: st.code, detail: `${st.road_name} · ward ${st.ward}`, lon, lat, code: st.code });
    }
    for (const m of await q<Mh>(`SELECT * FROM site_manholes WHERE ${LIVE} AND dpr_mh IS NULL AND code ILIKE $1 LIMIT 8`, [like]))
      out.push({ kind: 'Drawn manhole', label: m.code, detail: `ward ${m.ward}`, lon: m.lon, lat: m.lat });
    return { results: out };
  });
}
