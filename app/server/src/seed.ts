/**
 * Starting data, loaded once and never re-loaded over recorded work:
 *  - road stretches from DATA_DIR/stretches_seed.json (made by pipeline/publish_stretch_seed.py); only
 *    stretches the database does not have are added, all "Not started".
 *  - the compliance list from seed/compliance_items.json (from UGD_Compliance_Stagewise.xlsx), only when
 *    the database has no compliance items yet. After that the Commissioner manages the list in the app.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EMPTY_STATUS } from 'shared';
import { APP_ROOT, DATA_DIR } from './config.ts';
import type { Db } from './db.ts';

interface SeedStretch {
  code: string; ward: number; admin_zone: string; sewer_zone: string; catchment: string; road_name: string;
  length_m: number; planned_manholes: number; dia_m: Record<string, number>; max_dia_mm: number; max_depth_m: number | null;
  outside_ward: boolean; geom: unknown; pipes: [string, number, string, string, number][]; manholes: unknown[];
}

export async function loadStretches(db: Db, log: (m: string) => void, file = path.join(DATA_DIR, 'stretches_seed.json')) {
  if (!existsSync(file)) {
    log('stretch seed file not found; no stretches loaded');
    return;
  }
  const seed = JSON.parse(readFileSync(file, 'utf8')) as { version: number; stretches: SeedStretch[] };
  const name = `stretches_seed:v${seed.version}`;
  if ((await db.query('SELECT 1 FROM seed_loads WHERE name = $1', [name])).length) return;
  const status = JSON.stringify(EMPTY_STATUS);
  let added = 0;
  const BATCH = 1000;
  for (let i = 0; i < seed.stretches.length; i += BATCH) {
    const rows = seed.stretches.slice(i, i + BATCH);
    await db.tx(async (q) => {
      const ins = await q<{ code: string }>(
        `INSERT INTO stretches (code, ward, admin_zone, sewer_zone, catchment, road_name, length_m, planned_manholes, dia_m,
                                max_dia_mm, max_depth_m, outside_ward, geom, pipes, manholes, status)
         SELECT x.code, x.ward, x.admin_zone, x.sewer_zone, x.catchment, x.road_name, x.length_m, x.planned_manholes, x.dia_m,
                x.max_dia_mm, x.max_depth_m, x.outside_ward, x.geom, x.pipes, x.manholes, $2::jsonb
         FROM jsonb_to_recordset($1::jsonb) AS x(code text, ward integer, admin_zone text, sewer_zone text, catchment text,
              road_name text, length_m double precision, planned_manholes integer, dia_m jsonb, max_dia_mm integer,
              max_depth_m double precision, outside_ward boolean, geom jsonb, pipes jsonb, manholes jsonb)
         ON CONFLICT (code) DO NOTHING
         RETURNING code`,
        [JSON.stringify(rows), status],
      );
      if (!ins.length) return;
      const codes = new Set(ins.map((r) => r.code));
      const pipes = rows.filter((r) => codes.has(r.code)).flatMap((r) => r.pipes.map((p) => ({ pipe_id: p[0], code: r.code })));
      // A pipe belongs to only one live stretch: a pipe already in another stretch is left where it is.
      await q(
        `INSERT INTO stretch_pipes (pipe_id, stretch_code)
         SELECT x.pipe_id, x.code FROM jsonb_to_recordset($1::jsonb) AS x(pipe_id text, code text)
         ON CONFLICT (pipe_id) DO NOTHING`,
        [JSON.stringify(pipes)],
      );
      await q(
        `INSERT INTO stretch_history (stretch_code, version, kind, snapshot, note)
         SELECT c, 1, 'created', jsonb_build_object('status', $2::jsonb, 'approval', 'none', 'stage', 'not_started'),
                'Pre-generated from the DPR network'
         FROM unnest($1::text[]) AS c`,
        [[...codes], status],
      );
      added += ins.length;
    });
  }
  await db.query('INSERT INTO seed_loads (name, detail) VALUES ($1, $2)', [name, JSON.stringify({ added, total: seed.stretches.length })]);
  log(`road stretches loaded: ${added} new of ${seed.stretches.length}`);
}

export async function loadComplianceItems(db: Db, log: (m: string) => void, file = path.join(APP_ROOT, 'server', 'seed', 'compliance_items.json')) {
  if ((await db.query('SELECT 1 FROM compliance_items LIMIT 1')).length) return;
  const seed = JSON.parse(readFileSync(file, 'utf8')) as { items: Record<string, unknown>[] };
  for (const it of seed.items) {
    await db.query(
      `INSERT INTO compliance_items (key, version, sort, name, description, category, due_at, applies, per, evidence, value_label,
                                     unit, pass_rule, recurring_days, mandatory, severity, gate, grace_days)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (key, version) DO NOTHING`,
      [it.key, it.sort, it.name, it.description, it.category, it.due_at, JSON.stringify(it.applies), it.per, JSON.stringify(it.evidence),
        it.value_label, it.unit, it.pass_rule ? JSON.stringify(it.pass_rule) : null, it.recurring_days, it.mandatory, it.severity, it.gate, it.grace_days],
    );
  }
  await db.query('INSERT INTO seed_loads (name, detail) VALUES ($1, $2) ON CONFLICT DO NOTHING', ['compliance_items:v1', JSON.stringify({ items: seed.items.length })]);
  log(`compliance list loaded: ${seed.items.length} items`);
}
