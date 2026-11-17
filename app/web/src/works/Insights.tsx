/** A row of charts at the top of the Works, Issues and Grievances pages (whole city, from the dashboard figures). */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { ACCENT, Meter, RankBars, StackBar, StackRows, STATUS, TrendChart } from '../charts.tsx';
import { Icon } from '../ui.tsx';

interface D {
  overall: {
    plan: { km: number };
    works: { count: number; pipe_laid_m: number; restored_m: number; by_stage: { stage: string; label: string; color: string; n: number; m: number }[] };
    issues: { by_kind: { label: string; open: number; total: number }[]; by_severity: { key: string; label: string; open: number; total: number }[] };
    grievances: { by_category: { label: string; open: number; total: number }[]; by_status: { label: string; color: string; n: number }[] };
  };
  trend: { date: string; laid_m: number; issues_opened: number; issues_resolved: number; grievances: number; grievances_resolved: number }[];
}

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return <section className="ins-card"><div className="ins-title"><Icon name={icon} /> {title}</div>{children}</section>;
}

export function Insights({ kind, refreshKey }: { kind: 'works' | 'issues' | 'grievances'; refreshKey: number }) {
  const [d, setD] = useState<D | null>(null);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(`wgl.ins.${kind}`) !== 'off'; } catch { return true; } });
  useEffect(() => { api<D>('/api/dashboard?level=zone').then(setD).catch(() => {}); }, [refreshKey]);
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(`wgl.ins.${kind}`, v ? 'on' : 'off'); } catch { /* ignore */ } };
  if (!d) return null;
  const o = d.overall;
  const dates = d.trend.map((t) => t.date);
  return (
    <div className="insights">
      <button className="ins-toggle" onClick={toggle}>{open ? 'Hide charts' : 'Show charts'}</button>
      {open && (
        <div className="ins-grid">
          {kind === 'works' && <>
            <Card title="Pipe length by stage" icon="works">
              <StackBar parts={o.works.by_stage.map((s) => ({ label: s.label, value: Math.round(s.m), color: s.color, note: `${s.n}` }))} unit=" m" />
            </Card>
            <Card title="Against the DPR plan" icon="compliance">
              <Meter label="Sewer pipe laid" value={o.works.pipe_laid_m / 1000} target={o.plan.km} unit=" km" digits={2} />
              <Meter label="Roads restored (of pipe laid)" value={o.works.restored_m / 1000} target={o.works.pipe_laid_m / 1000} unit=" km" digits={2} color={STATUS.good} />
            </Card>
            <Card title="Last 30 days" icon="dashboard">
              <TrendChart title="Pipe laid per day" dates={dates} series={[{ label: 'Laid', values: d.trend.map((t) => t.laid_m), color: ACCENT }]} unit=" m" height={120} />
            </Card>
          </>}
          {kind === 'issues' && <>
            <Card title="By severity" icon="issues">
              <StackRows parts={[{ key: 'open', label: 'Open', color: STATUS.bad }, { key: 'closed', label: 'Resolved', color: '#86efac' }]}
                rows={o.issues.by_severity.map((x) => ({ key: x.key, label: x.label, values: { open: x.open, closed: x.total - x.open } }))} />
            </Card>
            <Card title="Open issues by kind" icon="works">
              <RankBars rows={o.issues.by_kind.filter((k) => k.open).sort((a, b) => b.open - a.open).slice(0, 6).map((k) => ({ label: k.label, value: k.open }))} color="#b45309" empty="No open issues." />
            </Card>
            <Card title="Last 30 days" icon="dashboard">
              <TrendChart title="Issues" dates={dates} series={[{ label: 'Raised', values: d.trend.map((t) => t.issues_opened), color: '#b45309' }, { label: 'Resolved', values: d.trend.map((t) => t.issues_resolved), color: STATUS.good }]} height={120} />
            </Card>
          </>}
          {kind === 'grievances' && <>
            <Card title="Where they stand" icon="compliance">
              <StackBar parts={o.grievances.by_status.map((x) => ({ label: x.label, value: x.n, color: x.color }))} />
            </Card>
            <Card title="By problem" icon="grievances">
              <RankBars rows={o.grievances.by_category.sort((a, b) => b.total - a.total).slice(0, 6).map((c) => ({ label: c.label, value: c.total, tip: `${c.label}: ${c.total} received, ${c.open} open` }))} color="#7c3aed" empty="No grievances yet." />
            </Card>
            <Card title="Last 30 days" icon="dashboard">
              <TrendChart title="Grievances" dates={dates} series={[{ label: 'Received', values: d.trend.map((t) => t.grievances), color: '#7c3aed' }, { label: 'Resolved', values: d.trend.map((t) => t.grievances_resolved), color: STATUS.good }]} height={120} />
            </Card>
          </>}
        </div>
      )}
    </div>
  );
}
