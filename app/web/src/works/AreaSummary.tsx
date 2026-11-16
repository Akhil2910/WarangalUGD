/** Highlights and work progress of a ward, GWMC zone or sewerage zone, shown when it is tapped on the map. */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Meter, nf, STATUS, StatusIcon } from '../charts.tsx';

interface Fig {
  overall: {
    plan: { km: number; manholes: number };
    works: { count: number; km: number; pipe_laid_m: number; restored_m: number; manholes_built: number; waiting_approval: number; by_stage: { stage: string; label: string; color: string; n: number; m: number }[] };
    compliance: { score: number | null; overdue: number; to_verify: number; not_complied: number };
    issues: { open: number; high: number; overdue: number };
    grievances: { open: number; overdue: number; total: number };
  };
  trend: { laid_m: number; updates: number }[];
}

export function AreaSummary({ filter }: { filter: { ward?: number; zone?: string; sewer?: string } }) {
  const [d, setD] = useState<Fig | null>(null);
  const [err, setErr] = useState('');
  const qs = new URLSearchParams({ level: 'ward', ...(filter.ward ? { ward: String(filter.ward) } : {}), ...(filter.zone ? { zone: filter.zone } : {}), ...(filter.sewer ? { sewer: filter.sewer } : {}) }).toString();
  useEffect(() => {
    setD(null);
    api<Fig>(`/api/dashboard?${qs}`).then(setD).catch((e) => setErr((e as Error).message));
  }, [qs]);
  if (err) return <p className="error small">{err}</p>;
  if (!d) return <p className="muted small">Loading progress…</p>;
  const o = d.overall;
  const week = d.trend.slice(-7);
  const laidWeek = week.reduce((a, t) => a + t.laid_m, 0);
  const updWeek = week.reduce((a, t) => a + t.updates, 0);
  const cs = o.compliance.score;
  const cst: keyof typeof STATUS = cs === null ? 'none' : cs >= 90 ? 'good' : cs >= 60 ? 'watch' : 'bad';
  return (
    <div className="area-sum">
      <Meter label="Sewer pipe laid against the DPR plan" value={o.works.pipe_laid_m / 1000} target={o.plan.km} unit=" km" digits={2} />
      <div className="area-figs">
        <div><b>{nf(o.works.count)}</b><span>work stretches</span></div>
        <div><b>{nf(o.works.manholes_built)}</b><span>manholes built</span></div>
        <div><b>{nf(o.works.restored_m / 1000, 2)}<small> km</small></b><span>roads restored</span></div>
        <div><b>{nf(laidWeek)}<small> m</small></b><span>laid this week</span></div>
      </div>
      {o.works.count > 0 && (
        <div className="mini-stack" title="Work stretches by stage">
          {o.works.by_stage.filter((s) => s.n).map((s) => <span key={s.stage} style={{ flexGrow: s.m || s.n, background: s.color }} title={`${s.label}: ${s.n}`} />)}
        </div>
      )}
      <div className="area-status">
        <span><StatusIcon s={cst} /> Compliance {cs === null ? 'nothing due' : `${cs}%`}{o.compliance.overdue ? ` · ${o.compliance.overdue} overdue` : ''}</span>
        <span><StatusIcon s={o.issues.high ? 'bad' : o.issues.open ? 'watch' : 'good'} /> {o.issues.open} open issue{o.issues.open === 1 ? '' : 's'}{o.issues.high ? ` (${o.issues.high} high)` : ''}</span>
        <span><StatusIcon s={o.grievances.overdue ? 'bad' : o.grievances.open ? 'watch' : 'good'} /> {o.grievances.open} citizen grievance{o.grievances.open === 1 ? '' : 's'} open</span>
        {o.works.count === 0 && <span className="muted">No work stretches here yet. DPR plan: {nf(o.plan.km, 1)} km of sewer, {nf(o.plan.manholes)} manholes.</span>}
        {o.works.count > 0 && <span className="muted">{updWeek} status update{updWeek === 1 ? '' : 's'} in the last 7 days{o.works.waiting_approval ? ` · ${o.works.waiting_approval} restoration(s) awaiting approval` : ''}</span>}
      </div>
    </div>
  );
}
