/** The DPR network (pipes and manholes) from DATA_DIR/dpr_network_seed.json, read once when first needed. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';

export interface DprPipe {
  id: string; from_mh: string; to_mh: string; dia_mm: number; length_m: number; ward: number; admin_zone: string;
  il_up: number | null; il_dn: number | null; depth_up: number | null; depth_dn: number | null; coords: number[][]; material: string; catchment: string; sewer_zone: string;
}
type Row = [string, string, number, number, number, string, number | null, number | null, number | null, number | null, number[][], string, string, string?];
let data: { pipes: Record<string, Row>; manholes: Record<string, [number, number]> } | null = null;

function load() {
  if (data) return data;
  const f = path.join(DATA_DIR, 'dpr_network_seed.json');
  data = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { pipes: {}, manholes: {} };
  return data!;
}

export function dprPipe(id: string): DprPipe | null {
  const r = load().pipes[id];
  if (!r) return null;
  return { id, from_mh: r[0], to_mh: r[1], dia_mm: r[2], length_m: r[3], ward: r[4], admin_zone: r[5], il_up: r[6], il_dn: r[7], depth_up: r[8], depth_dn: r[9], coords: r[10], material: r[11], catchment: r[12], sewer_zone: r[13] ?? '' };
}

export function dprManhole(code: string): [number, number] | null {
  return load().manholes[code] ?? null;
}

export interface PlanTotal { km: number; manholes: number; pipes: number }
let plan: { all: PlanTotal; ward: Map<string, PlanTotal>; zone: Map<string, PlanTotal>; sewer: Map<string, PlanTotal> } | null = null;

/** DPR plan: km of pipe and manholes, overall and by ward, GWMC zone and sewerage zone. */
export function planTotals() {
  if (plan) return plan;
  const d = load();
  const mk = () => new Map<string, { m: number; mh: Set<string>; n: number }>();
  const by = { ward: mk(), zone: mk(), sewer: mk(), all: mk() };
  for (const r of Object.values(d.pipes)) {
    for (const [k, key] of [['ward', String(r[4])], ['zone', r[5]], ['sewer', r[13] ?? ''], ['all', 'all']] as const) {
      const m = by[k];
      const x = m.get(key) ?? { m: 0, mh: new Set<string>(), n: 0 };
      x.m += r[3];
      x.n += 1;
      x.mh.add(r[0]);
      x.mh.add(r[1]);
      m.set(key, x);
    }
  }
  const fin = (m: Map<string, { m: number; mh: Set<string>; n: number }>) =>
    new Map([...m.entries()].map(([k, v]) => [k, { km: Math.round(v.m / 10) / 100, manholes: v.mh.size, pipes: v.n }]));
  plan = { all: fin(by.all).get('all') ?? { km: 0, manholes: 0, pipes: 0 }, ward: fin(by.ward), zone: fin(by.zone), sewer: fin(by.sewer) };
  return plan;
}
