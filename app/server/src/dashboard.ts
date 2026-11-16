/**
 * Dashboard figures: work progress, compliance, issues and grievances, overall and by area (GWMC zone, ward,
 * sewerage zone, work stretch), with a 30-day trend and field activity. One shared calculation for every view.
 * Progress is shown against the DPR plan, kept apart from the work stretches' own totals.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GRIEVANCE_CATEGORIES, indiaDate, ISSUE_KINDS, STAGES, type WorkStatus } from 'shared';
import type { Db } from './db.ts';
import { dprPipe, planTotals } from './dpr.ts';
import { iso, parse, type Q } from './works.ts';
import { zoneOfWard } from './geo.ts';

interface W {
  code: string; ward: number; admin_zone: string; road_name: string; length_m: number; planned_manholes: number; status: WorkStatus; stage: string; approval: string;
  compliance: { due?: number; verified?: number; to_verify?: number; overdue?: number; not_complied?: number; theme?: string }; open_issues: number;
  updated_at: unknown; created_at: unknown; pipes: [string][]; sewer: string;
}
const laid = (s: WorkStatus, len: number) => (s.pipeline === 'laid' ? len : s.pipeline === 'partly' ? Math.min(s.pipe_laid_m ?? 0, len) : 0);
const day = (d: unknown) => indiaDate(new Date(d as string));
const r1 = (x: number) => Math.round(x * 10) / 10;

export function registerDashboard(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);
  const query = z.object({
    level: z.enum(['zone', 'ward', 'sewer']).default('zone'), zone: z.string().max(10).optional(), ward: z.coerce.number().int().optional(), sewer: z.string().max(10).optional(),
  });

  app.get('/api/dashboard', async (req) => {
    const f = parse(query, req.query);
    const plan = planTotals();
    const today = indiaDate();
    const inArea = (x: { ward: number | null; admin_zone: string; sewer?: string }) =>
      (!f.zone || x.admin_zone === f.zone) && (!f.ward || x.ward === f.ward) && (!f.sewer || x.sewer === f.sewer);

    // ---- work stretches ----
    const works = (await q<W>(`SELECT code, ward, admin_zone, road_name, length_m, planned_manholes, status, stage, approval, compliance, open_issues, updated_at, created_at, pipes
      FROM stretches WHERE source = 'site' AND deleted_at IS NULL AND NOT hidden`))
      .map((w) => ({ ...w, sewer: w.pipes.map((p) => dprPipe(p[0])?.sewer_zone).find(Boolean) ?? '' }))
      .filter(inArea);
    const wardOf = new Map(works.map((w) => [w.code, w]));

    // ---- issues and grievances ----
    const issues = (await q<{ code: string; kind: string; severity: string; status: string; ward: number | null; admin_zone: string; stretch_code: string | null; created_at: unknown; resolved_at: unknown; due_date: unknown }>(
      `SELECT i.code, i.kind, i.severity, i.status, i.ward, i.admin_zone, i.stretch_code, i.created_at, i.resolved_at, i.due_date FROM issues i
       LEFT JOIN stretches s ON s.code = i.stretch_code WHERE NOT coalesce(s.hidden, false)`))
      .map((i) => ({ ...i, sewer: i.stretch_code ? wardOf.get(i.stretch_code)?.sewer ?? '' : '' })).filter(inArea);
    const griev = (await q<{ number: string; category: string; status: string; ward: number | null; admin_zone: string; stretch_code: string | null; created_at: unknown; resolved_at: unknown; due_date: unknown }>(
      `SELECT number, category, status, ward, admin_zone, stretch_code, created_at, resolved_at, due_date FROM grievances`))
      .map((g) => ({ ...g, sewer: g.stretch_code ? wardOf.get(g.stretch_code)?.sewer ?? '' : '' })).filter(inArea);
    const isOpenI = (i: { status: string }) => i.status !== 'resolved';
    const isOpenG = (g: { status: string }) => g.status === 'new' || g.status === 'assigned';
    const overdue = (x: { due_date: unknown }) => !!x.due_date && String(iso(x.due_date)).slice(0, 10) < today;

    // ---- plan for the chosen area ----
    const areaPlan = f.ward ? plan.ward.get(String(f.ward)) : f.zone ? plan.zone.get(f.zone) : f.sewer ? plan.sewer.get(f.sewer) : plan.all;

    // ---- one set of figures for any group of work stretches, issues and grievances ----
    const figures = (ws: W[], is: typeof issues, gs: typeof griev) => {
      const length = ws.reduce((a, w) => a + w.length_m, 0);
      const laidM = ws.reduce((a, w) => a + laid(w.status, w.length_m), 0);
      const restored = ws.filter((w) => w.status.restoration === 'done').reduce((a, w) => a + w.length_m, 0);
      const approved = ws.filter((w) => w.approval === 'approved').reduce((a, w) => a + w.length_m, 0);
      const c = ws.reduce((a, w) => ({
        due: a.due + (w.compliance.due ?? 0), verified: a.verified + (w.compliance.verified ?? 0), to_verify: a.to_verify + (w.compliance.to_verify ?? 0),
        overdue: a.overdue + (w.compliance.overdue ?? 0), not_complied: a.not_complied + (w.compliance.not_complied ?? 0),
      }), { due: 0, verified: 0, to_verify: 0, overdue: 0, not_complied: 0 });
      const resolvedI = is.filter((i) => i.resolved_at);
      const resolvedG = gs.filter((g) => g.resolved_at);
      const days = (a: unknown, b: unknown) => (new Date(b as string).getTime() - new Date(a as string).getTime()) / 86400000;
      return {
        works: {
          count: ws.length, km: r1(length / 100) / 10, pipe_laid_m: Math.round(laidM), restored_m: Math.round(restored), approved_m: Math.round(approved),
          manholes_planned: ws.reduce((a, w) => a + w.planned_manholes, 0), manholes_built: ws.reduce((a, w) => a + w.status.manholes_built, 0),
          laid_pct_of_works: length ? Math.round((laidM / length) * 100) : 0,
          by_stage: STAGES.map((s) => ({ stage: s.key, label: s.label, color: s.color, n: ws.filter((w) => w.stage === s.key).length, m: Math.round(ws.filter((w) => w.stage === s.key).reduce((a, w) => a + w.length_m, 0)) })),
          waiting_approval: ws.filter((w) => w.approval === 'pending').length,
        },
        compliance: { ...c, score: c.due ? Math.round((c.verified / c.due) * 100) : null },
        issues: {
          open: is.filter(isOpenI).length, high: is.filter((i) => isOpenI(i) && i.severity === 'high').length, overdue: is.filter((i) => isOpenI(i) && overdue(i)).length,
          resolved: resolvedI.length, avg_days_to_resolve: resolvedI.length ? r1(resolvedI.reduce((a, i) => a + days(i.created_at, i.resolved_at), 0) / resolvedI.length) : null,
          by_kind: ISSUE_KINDS.map((k) => ({ kind: k.key, label: k.label, open: is.filter((i) => i.kind === k.key && isOpenI(i)).length, total: is.filter((i) => i.kind === k.key).length })).filter((k) => k.total),
        },
        grievances: {
          total: gs.length, open: gs.filter(isOpenG).length, overdue: gs.filter((g) => isOpenG(g) && overdue(g)).length, resolved: gs.filter((g) => g.status === 'resolved').length,
          on_time_pct: resolvedG.length ? Math.round((resolvedG.filter((g) => String(iso(g.resolved_at)).slice(0, 10) <= String(iso(g.due_date)).slice(0, 10)).length / resolvedG.length) * 100) : null,
          by_category: GRIEVANCE_CATEGORIES.map((c) => ({ category: c.key, label: c.en, open: gs.filter((g) => g.category === c.key && isOpenG(g)).length, total: gs.filter((g) => g.category === c.key).length })).filter((c) => c.total),
        },
      };
    };

    const overall = { plan: areaPlan ?? { km: 0, manholes: 0, pipes: 0 }, ...figures(works, issues, griev) };
    const planFor = (key: string) => (f.level === 'ward' ? plan.ward : f.level === 'zone' ? plan.zone : plan.sewer).get(key) ?? { km: 0, manholes: 0, pipes: 0 };
    const keyOf = (x: { ward: number | null; admin_zone: string; sewer?: string }) => (f.level === 'ward' ? String(x.ward ?? '') : f.level === 'zone' ? x.admin_zone : x.sewer ?? '');
    const keys = new Set<string>([...(f.level === 'ward' ? plan.ward : f.level === 'zone' ? plan.zone : plan.sewer).keys()].filter((k) => {
      if (f.level === 'ward' && f.zone) return zoneOfWard(Number(k)) === f.zone;
      return true;
    }));
    for (const x of [...works, ...issues, ...griev]) if (keyOf(x)) keys.add(keyOf(x));
    const areas = [...keys].filter(Boolean).map((k) => {
      const ws = works.filter((w) => keyOf(w) === k);
      const fig = figures(ws, issues.filter((i) => keyOf(i) === k), griev.filter((g) => keyOf(g) === k));
      const p = planFor(k);
      return { key: k, plan: p, laid_pct_of_plan: p.km ? r1((fig.works.pipe_laid_m / 1000 / p.km) * 100) : 0, ...fig };
    }).sort((a, b) => (f.level === 'ward' ? Number(a.key) - Number(b.key) : a.key.localeCompare(b.key)));

    // ---- 30-day trend ----
    const since = new Date(Date.now() - 30 * 86400000);
    const hist = await q<{ stretch_code: string; at: unknown; kind: string; snapshot: { status: WorkStatus }; by_user: string | null }>(
      `SELECT h.stretch_code, h.at, h.kind, h.snapshot, h.by_user FROM stretch_history h JOIN stretches s ON s.code = h.stretch_code
       WHERE s.source = 'site' AND NOT s.hidden ORDER BY h.stretch_code, h.at, h.id`);
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) days.push(indiaDate(new Date(Date.now() - i * 86400000)));
    const trend = new Map(days.map((d) => [d, { date: d, updates: 0, laid_m: 0, issues_opened: 0, issues_resolved: 0, grievances: 0, grievances_resolved: 0 }]));
    let prev: { code: string; laid: number } | null = null;
    for (const h of hist) {
      const w = wardOf.get(h.stretch_code);
      if (!w) continue;
      const l = h.snapshot?.status ? laid(h.snapshot.status, w.length_m) : 0;
      const before: number = prev && prev.code === h.stretch_code ? prev.laid : 0;
      prev = { code: h.stretch_code, laid: l };
      const t = trend.get(day(h.at));
      if (!t || new Date(h.at as string) < since) continue;
      if (h.kind === 'status') t.updates++;
      if (l > before) t.laid_m += Math.round(l - before);
    }
    for (const i of issues) {
      trend.get(day(i.created_at)) && trend.get(day(i.created_at))!.issues_opened++;
      if (i.resolved_at && trend.get(day(i.resolved_at))) trend.get(day(i.resolved_at))!.issues_resolved++;
    }
    for (const g of griev) {
      trend.get(day(g.created_at)) && trend.get(day(g.created_at))!.grievances++;
      if (g.resolved_at && g.status === 'resolved' && trend.get(day(g.resolved_at))) trend.get(day(g.resolved_at))!.grievances_resolved++;
    }

    // ---- field activity (last 7 days) ----
    const act = await q<{ name: string; role: string; updates: string; records: string; issues: string; last_at: unknown }>(
      `SELECT u.name, u.role,
              (SELECT count(*) FROM stretch_history h JOIN stretches s ON s.code = h.stretch_code WHERE h.by_user = u.id AND h.kind = 'status' AND NOT s.hidden AND h.at > now() - interval '7 days') AS updates,
              (SELECT count(*) FROM compliance_records r JOIN stretches s ON s.code = r.stretch_code WHERE r.recorded_by = u.id AND NOT s.hidden AND r.recorded_at > now() - interval '7 days') AS records,
              (SELECT count(*) FROM issues i WHERE i.created_by = u.id AND i.created_at > now() - interval '7 days') AS issues,
              (SELECT max(h.at) FROM stretch_history h JOIN stretches s ON s.code = h.stretch_code WHERE h.by_user = u.id AND NOT s.hidden) AS last_at
       FROM users u WHERE u.active AND u.role <> 'viewer' ORDER BY u.name`);

    // ---- compliance by item ----
    const items = await q<{ key: string; name: string; stage: string; complied: string; verified: string; not_complied: string; waiting: string }>(
      `SELECT i.key, i.name, i.due_at AS stage,
              count(r.*) FILTER (WHERE r.result = 'complied') AS complied, count(r.*) FILTER (WHERE r.verification = 'accepted' AND r.result <> 'not_complied') AS verified,
              count(r.*) FILTER (WHERE r.result = 'not_complied') AS not_complied, count(r.*) FILTER (WHERE r.verification = 'waiting') AS waiting
       FROM compliance_items i LEFT JOIN compliance_records r ON r.item_key = i.key AND r.stretch_code IN (SELECT code FROM stretches WHERE source = 'site' AND NOT hidden ${f.ward ? `AND ward = ${Number(f.ward)}` : ''})
       WHERE i.is_current AND i.retired_at IS NULL GROUP BY i.key, i.name, i.due_at, i.sort ORDER BY i.sort`);

    const idle = works.filter((w) => !['not_started', 'restored_approved'].includes(w.stage) && new Date(w.updated_at as string) < new Date(Date.now() - 7 * 86400000))
      .map((w) => ({ code: w.code, name: w.road_name, ward: w.ward, stage: w.stage, last_update: iso(w.updated_at) }));

    return {
      generated_at: new Date().toISOString(), filter: f, overall, areas, trend: [...trend.values()],
      activity: act.map((a) => ({ name: a.name, role: a.role, updates: Number(a.updates), records: Number(a.records), issues: Number(a.issues), last_at: iso(a.last_at) })),
      compliance_items: items.map((i) => ({ ...i, complied: Number(i.complied), verified: Number(i.verified), not_complied: Number(i.not_complied), waiting: Number(i.waiting) })),
      stretches: works.map((w) => ({ code: w.code, name: w.road_name, ward: w.ward, zone: w.admin_zone, length_m: Math.round(w.length_m), stage: w.stage,
        laid_m: Math.round(laid(w.status, w.length_m)), score: w.compliance.due ? Math.round(((w.compliance.verified ?? 0) / w.compliance.due) * 100) : null,
        overdue: w.compliance.overdue ?? 0, open_issues: w.open_issues, grievances_open: griev.filter((g) => g.stretch_code === w.code && isOpenG(g)).length })),
      idle,
    };
  });
}
