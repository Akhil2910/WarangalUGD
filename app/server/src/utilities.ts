/**
 * Utilities: above ground (poles, transformers, trees, encroachments, road condition...) and underground
 * (water mains, cables, gas, storm drains). Marked on the map by staff, or imported from a GeoJSON file
 * a department provides. The GWMC base map's existing drains are shown from /data/utility_drains.geojson.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_RANK, UTILITY_CONDITIONS, UTILITY_LAYERS, utilityLayer } from 'shared';
import { HttpError, type SessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { nearCity, wardAt } from './geo.ts';
import { can, inArea, iso, parse, type Q } from './works.ts';
import { has } from './perms.ts';
import { cur, curPrefix } from './ulbctx.ts';
/** The current ULB as a plain number (safe to put straight into SQL). */
const U = () => Number(cur());

const layerKeys = UTILITY_LAYERS.map((l) => l.key) as [string, ...string[]];
const pos = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const geomSchema = z.union([
  z.object({ type: z.literal('Point'), coordinates: pos }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(pos).min(2).max(5000) }),
]);
const propsSchema = z.object({
  name: z.string().max(200).optional(), owner: z.string().max(120).optional(), size: z.string().max(60).optional(), material: z.string().max(60).optional(),
  depth_m: z.number().min(0).max(50).nullable().optional(), condition: z.enum(UTILITY_CONDITIONS).optional(), contact: z.string().max(120).optional(),
  note: z.string().max(1000).optional(), ref: z.string().max(80).optional(), obstruction: z.boolean().optional(),
}).strict();

/** Fields that say where the data came from (survey references, video frames): stored apart, never shown. */
const HIDDEN = ['ref', 'source', 'survey_status', 'detected_by', 'confidence', 'video', 'frame_image', 'image', 'photo_url', 'osm_road', 'survey_ward', 'side', 'offset_m', 'alerts'];
const split = (p: Record<string, unknown>) => {
  const keep: Record<string, unknown> = {}; const origin: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) (HIDDEN.includes(k) ? origin : keep)[k] = v;
  return { keep, origin };
};
const shown = (p: Record<string, unknown>) => split(p).keep;

const canMark = (u: SessionUser, at: { ward: number; admin_zone: string }) => has(u, 'utility.mark') && inArea(u, at);
const firstPoint = (g: z.infer<typeof geomSchema>) => (g.type === 'Point' ? g.coordinates : g.coordinates[0]);

export function registerUtilities(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);

  app.get('/api/utilities/map', async () => {
    const rows = await q<{ id: string; layer: string; geom: unknown; props: Record<string, unknown>; ward: number; source: string; created_at: unknown }>(
      `SELECT id, layer, geom, props, ward, source, created_at FROM utility_features WHERE deleted_at IS NULL AND ulb_id = ${U()}`);
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => ({ type: 'Feature', id: Number(r.id), geometry: r.geom,
        properties: { id: Number(r.id), layer: r.layer, ward: r.ward, created_at: iso(r.created_at), ...shown(r.props) } })),
    };
  });

  app.get('/api/utilities/summary', async () => {
    const rows = await q<{ layer: string; n: string; imported: string }>(
      `SELECT layer, count(*) AS n, count(*) FILTER (WHERE source = 'imported') AS imported FROM utility_features WHERE deleted_at IS NULL AND ulb_id = ${U()} GROUP BY layer`);
    return { layers: UTILITY_LAYERS.map((l) => ({ ...l, count: Number(rows.find((r) => r.layer === l.key)?.n ?? 0), imported: Number(rows.find((r) => r.layer === l.key)?.imported ?? 0) })) };
  });

  app.post('/api/utilities', async (req) => {
    const u = req.user!;
    const b = parse(z.object({ layer: z.enum(layerKeys), geom: geomSchema, props: propsSchema.default({}) }), req.body);
    const def = utilityLayer(b.layer)!;
    if ((def.geom === 'point') !== (b.geom.type === 'Point')) throw new HttpError(400, def.geom === 'point' ? `${def.label}: tap one place on the map.` : `${def.label}: draw a line (two or more points).`);
    const [lon, lat] = firstPoint(b.geom);
    if (!nearCity(lon, lat)) throw new HttpError(400, 'That place is outside the city area.');
    const w = wardAt(lon, lat);
    if (!canMark(u, w)) throw new HttpError(403, 'Only field inspectors and officers of the area can mark utilities.');
    const r = await q<{ id: string }>(`INSERT INTO utility_features (layer, geom, props, ward, admin_zone, created_by, ulb_id) VALUES ($1,$2,$3,$4,$5,$6,${U()}) RETURNING id`,
      [b.layer, JSON.stringify(b.geom), JSON.stringify(b.props), w.ward, w.admin_zone, u.id]);
    return { ok: true, id: Number(r[0].id) };
  });

  app.post<{ Params: { id: string } }>('/api/utilities/:id/edit', async (req) => {
    const u = req.user!;
    const b = parse(z.object({ props: propsSchema }), req.body);
    const r = await q<{ ward: number; admin_zone: string }>(`SELECT ward, admin_zone FROM utility_features WHERE id = $1 AND deleted_at IS NULL AND ulb_id = ${U()}`, [Number(req.params.id)]);
    if (!r.length) throw new HttpError(404, 'Not found.');
    if (!canMark(u, r[0])) throw new HttpError(403, 'Only field inspectors and officers of the area can change utilities.');
    await q('UPDATE utility_features SET props = $2 WHERE id = $1', [Number(req.params.id), JSON.stringify(b.props)]);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/utilities/:id/delete', async (req) => {
    const u = req.user!;
    const r = await q<{ ward: number; admin_zone: string }>(`SELECT ward, admin_zone FROM utility_features WHERE id = $1 AND deleted_at IS NULL AND ulb_id = ${U()}`, [Number(req.params.id)]);
    if (!r.length) throw new HttpError(404, 'Not found.');
    if (!canMark(u, r[0])) throw new HttpError(403, 'Only field inspectors and officers of the area can remove utilities.');
    await q('UPDATE utility_features SET deleted_at = now() WHERE id = $1', [Number(req.params.id)]);
    return { ok: true };
  });

  // a department's file (GeoJSON): every feature of the right shape goes into one layer; the rest are counted and skipped
  app.post('/api/utilities/import', { bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    const u = req.user!;
    if (!has(u, 'utility.import')) throw new HttpError(403, 'Your role cannot import utility files.');
    const b = parse(z.object({ layer: z.enum(layerKeys), geojson: z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()).max(50000) }), source_name: z.string().max(200).default('') }), req.body);
    const def = utilityLayer(b.layer)!;
    const importId = randomUUID();
    let added = 0;
    let skipped = 0;
    await db.tx(async (t) => {
      for (const f of b.geojson.features as { geometry?: { type: string; coordinates: unknown }; properties?: Record<string, unknown> }[]) {
        const parts = f.geometry?.type === 'MultiLineString' && def.geom === 'line' ? (f.geometry.coordinates as unknown[]).map((c) => ({ type: 'LineString', coordinates: c })) : [f.geometry];
        for (const g of parts) {
          const ok = geomSchema.safeParse(g);
          if (!ok.success || (def.geom === 'point') !== (ok.data.type === 'Point')) { skipped++; continue; }
          const [lon, lat] = firstPoint(ok.data);
          if (!nearCity(lon, lat)) { skipped++; continue; }
          const w = wardAt(lon, lat);
          const p = Object.fromEntries(Object.entries(f.properties ?? {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 30)
            .map(([k, v]) => [k.slice(0, 40), typeof v === 'string' ? v.slice(0, 200) : v]));
          const { keep, origin } = split(p as Record<string, unknown>);
          await t(`INSERT INTO utility_features (layer, geom, props, origin, ward, admin_zone, source, import_id, created_by, ulb_id) VALUES ($1,$2,$3,$4,$5,$6,'imported',$7,$8,${U()})`,
            [b.layer, JSON.stringify(ok.data), JSON.stringify(keep), JSON.stringify({ ...origin, file: b.source_name || undefined }), w.ward, w.admin_zone, importId, u.id]);
          added++;
        }
      }
      await t(`INSERT INTO audit_log (actor, action, detail, ulb_id) VALUES ($1, $2, $3, ${U()})`, [u.id, 'utilities_imported', JSON.stringify({ layer: b.layer, added, skipped, importId, source: b.source_name })]);
    });
    return { ok: true, added, skipped, import_id: importId };
  });
}
