/**
 * Dashboards: work progress, compliance, issues and grievances — overall and by area (GWMC zone, ward,
 * sewerage zone), with a 30-day trend and field activity. Every table can be downloaded for Excel.
 * Charts: one measure per chart (no second axis), labelled bars, a hover tip on every bar.
 */
import { useEffect, useMemo, useState } from 'react';
import { COMPLIANCE_STAGES, STAGES } from 'shared';
import { api } from '../api.ts';
import { fmtTime } from './util.tsx';

interface Fig {
  works: { count: number; km: number; pipe_laid_m: number; restored_m: number; approved_m: number; manholes_planned: number; manholes_built: number; laid_pct_of_works: number;
    by_stage: { stage: string; label: string; color: string; n: number; m: number }[]; waiting_approval: number };
  compliance: { due: number; verified: number; to_verify: number; overdue: number; not_complied: number; score: number | null };
  issues: { open: number; high: number; overdue: number; resolved: number; avg_days_to_resolve: number | null; by_kind: { kind: string; label: string; open: number; total: number }[] };
  grievances: { total: number; open: number; overdue: number; resolved: number; on_time_pct: number | null; by_category: { category: string; label: string; open: number; total: number }[] };
}
interface Area extends Fig { key: string; plan: { km: number; manholes: number }; laid_pct_of_plan: number }
interface Dash {
  generated_at: string; overall: Fig & { plan: { km: number; manholes: number } }; areas: Area[];
  trend: { date: string; updates: number; laid_m: number; issues_opened: number; issues_resolved: number; grievances: number; grievances_resolved: number }[];
  activity: { name: string; role: string; updates: number; records: number; issues: number; last_at: string | null }[];
  compliance_items: { key: string; name: string; stage: string; complied: number; verified: number; not_complied: number; waiting: number }[];
  stretches: { code: string; name: string; ward: number; zone: string; length_m: number; stage: string; laid_m: number; score: number | null; overdue: number; open_issues: number; grievances_open: number }[];
  idle: { code: string; name: string; ward: number; stage: string; last_update: string }[];
}
type View = 'overall' | 'areas' | 'progress' | 'compliance' | 'issues' | 'grievances' | 'activity';
const VIEWS: [View, string][] = [['overall', 'Overall'], ['areas', 'By area'], ['progress', 'Work progress'], ['compliance', 'Compliance'], ['issues', 'Issues'], ['grievances', 'Grievances'], ['activity', 'Field activity']];
const LEVEL_LABEL = { zone: 'GWMC zone', ward: 'Ward', sewer: 'Sewerage zone' } as const;
const nf = (n: number) => n.toLocaleString('en-IN');
const km = (m: number) => (m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function download(name: string, head: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => (v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const blob = new Blob(['﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

export function DashboardPage({ zones, onOpenStretch }: { zones: { id: string }[]; onOpenStretch: (c: string) => void }) {
  const [view, setView] = useState<View>('overall');
  const [level, setLevel] = useState<'zone' | 'ward' | 'sewer'>('zone');
  const [f, setF] = useState({ zone: '', ward: '', sewer: '' });
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const p = new URLSearchParams({ level });
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    api<Dash>(`/api/dashboard?${p}`).then((x) => { setD(x); setErr(''); }).catch((e) => setErr((e as Error).message));
  }, [level, f]);
  const scope = f.ward ? `Ward ${f.ward}` : f.zone ? `Zone ${f.zone}` : f.sewer ? `Sewerage zone ${f.sewer}` : 'Whole city';
  return (
    <div className="page dash">
      <div className="page-head">
        <h2>Dashboard <span className="muted scope">· {scope}</span></h2>
        {d && <span className="muted small">Figures as of {fmtTime(d.generated_at)}</span>}
      </div>
      <div className="filters">
        <select value={f.zone} onChange={(e) => setF({ zone: e.target.value, ward: '', sewer: '' })} aria-label="GWMC zone"><option value="">All GWMC zones</option>{zones.map((z) => <option key={z.id}>{z.id}</option>)}</select>
        <input type="number" placeholder="Ward" value={f.ward} min={1} max={66} onChange={(e) => setF({ ...f, ward: e.target.value, sewer: '' })} aria-label="Ward" />
        <select value={f.sewer} onChange={(e) => setF({ zone: '', ward: '', sewer: e.target.value })} aria-label="Sewerage zone">
          <option value="">All sewerage zones</option>{['1', '2', '3,4', '5', '6', '7'].map((s) => <option key={s} value={s}>Sewerage zone {s}</option>)}
        </select>
        {(f.zone || f.ward || f.sewer) && <button className="btn ghost" onClick={() => setF({ zone: '', ward: '', sewer: '' })}>Whole city</button>}
      </div>
      <nav className="tabs inline dash-tabs">{VIEWS.map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</nav>
      {err && <p className="error">{err}</p>}
      {!d ? <p className="muted">Loading…</p> : (
        <>
          {view === 'overall' && <Overall d={d} />}
          {view === 'areas' && <Areas d={d} level={level} setLevel={setLevel} onDrill={(k) => {
            if (level === 'zone') { setF({ zone: k, ward: '', sewer: '' }); setLevel('ward'); } else if (level === 'ward') setF({ ...f, ward: k }); else setF({ zone: '', ward: '', sewer: k });
          }} />}
          {view === 'progress' && <Progress d={d} onOpenStretch={onOpenStretch} />}
          {view === 'compliance' && <Compliance d={d} onOpenStretch={onOpenStretch} />}
          {view === 'issues' && <IssuesView d={d} />}
          {view === 'grievances' && <GrievancesView d={d} />}
          {view === 'activity' && <Activity d={d} />}
        </>
      )}
    </div>
  );
}

// ---------------- building blocks ----------------
function Tile({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'bad' | 'good' }) {
  return <div className={`tile ${tone ?? ''}`}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;
}
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="dsec"><div className="dsec-head"><h3>{title}</h3>{action}</div>{children}</section>;
}
/** Horizontal bars: one measure, labelled, value at the end, hover tip. */
function Bars({ rows, unit = '', color = 'var(--accent)' }: { rows: { label: string; value: number; tip?: string; color?: string }[]; unit?: string; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted">Nothing yet.</p>;
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.label} className="hbar" title={r.tip ?? `${r.label}: ${nf(r.value)}${unit}`}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} /></span>
          <span className="hbar-val">{nf(r.value)}{unit}</span>
        </div>
      ))}
    </div>
  );
}
/** 30-day column chart of one measure, with a hover tip on each day. */
function Columns({ data, field, label, color = 'var(--accent)' }: { data: Dash['trend']; field: keyof Dash['trend'][number]; label: string; color?: string }) {
  const vals = data.map((x) => Number(x[field]));
  const max = Math.max(1, ...vals);
  const total = vals.reduce((a, b) => a + b, 0);
  return (
    <div className="cols-box">
      <div className="cols-title">{label} <span className="muted">· {nf(total)} in 30 days</span></div>
      <div className="cols">
        {data.map((x, i) => (
          <span key={x.date} className="col" title={`${x.date}: ${nf(vals[i])}`}>
            <span className="col-fill" style={{ height: `${(vals[i] / max) * 100}%`, background: color }} />
          </span>
        ))}
      </div>
      <div className="cols-axis"><span>{data[0]?.date.slice(5)}</span><span>max {nf(max)}</span><span>{data[data.length - 1]?.date.slice(5)}</span></div>
    </div>
  );
}
function StageStrip({ by }: { by: Fig['works']['by_stage'] }) {
  const total = by.reduce((a, s) => a + s.m, 0);
  return (
    <div>
      <div className="stage-strip big">{by.filter((s) => s.m).map((s) => <span key={s.stage} title={`${s.label}: ${s.n} work stretches, ${km(s.m)} km`} style={{ width: `${(s.m / (total || 1)) * 100}%`, background: s.color }} />)}</div>
      <div className="legend-row">{by.map((s) => <span key={s.stage}><i style={{ background: s.color }} />{s.label} · {s.n}</span>)}</div>
    </div>
  );
}
function PlanBar({ laid, plan }: { laid: number; plan: number }) {
  const pct = plan ? (laid / 1000 / plan) * 100 : 0;
  return (
    <div className="plan-bar" title={`${km(laid)} km laid of ${nf(plan)} km planned in the DPR`}>
      <div className="plan-track"><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="small"><b>{pct.toFixed(2)}%</b> of the DPR plan laid · {km(laid)} of {nf(plan)} km</div>
    </div>
  );
}

// ---------------- views ----------------
function Overall({ d }: { d: Dash }) {
  const o = d.overall;
  return (
    <div className="dgrid">
      <Section title="Work progress">
        <PlanBar laid={o.works.pipe_laid_m} plan={o.plan.km} />
        <div className="tiles">
          <Tile label="Work stretches" value={nf(o.works.count)} sub={`${o.works.km} km of pipe`} />
          <Tile label="Pipe laid" value={`${km(o.works.pipe_laid_m)} km`} sub={`${o.works.laid_pct_of_works}% of the work stretches`} />
          <Tile label="Manholes built" value={nf(o.works.manholes_built)} sub={`of ${nf(o.works.manholes_planned)} in work stretches · DPR ${nf(o.plan.manholes)}`} />
          <Tile label="Roads restored" value={`${km(o.works.restored_m)} km`} sub={`${km(o.works.approved_m)} km approved · ${o.works.waiting_approval} waiting`} />
        </div>
        <StageStrip by={o.works.by_stage} />
      </Section>
      <Section title="Compliance">
        <div className="tiles">
          <Tile label="Score (verified ÷ due)" value={o.compliance.score === null ? '—' : `${o.compliance.score}%`} />
          <Tile label="Waiting for verification" value={nf(o.compliance.to_verify)} />
          <Tile label="Overdue" value={nf(o.compliance.overdue)} tone={o.compliance.overdue ? 'bad' : undefined} />
          <Tile label="Not complied" value={nf(o.compliance.not_complied)} tone={o.compliance.not_complied ? 'bad' : undefined} />
        </div>
      </Section>
      <Section title="Issues">
        <div className="tiles">
          <Tile label="Open" value={nf(o.issues.open)} />
          <Tile label="High severity open" value={nf(o.issues.high)} tone={o.issues.high ? 'bad' : undefined} />
          <Tile label="Overdue" value={nf(o.issues.overdue)} tone={o.issues.overdue ? 'bad' : undefined} />
          <Tile label="Days to resolve (average)" value={o.issues.avg_days_to_resolve ?? '—'} sub={`${nf(o.issues.resolved)} resolved`} />
        </div>
      </Section>
      <Section title="Grievances">
        <div className="tiles">
          <Tile label="Received" value={nf(o.grievances.total)} />
          <Tile label="Open" value={nf(o.grievances.open)} />
          <Tile label="Overdue" value={nf(o.grievances.overdue)} tone={o.grievances.overdue ? 'bad' : undefined} />
          <Tile label="Answered on time" value={o.grievances.on_time_pct === null ? '—' : `${o.grievances.on_time_pct}%`} />
        </div>
      </Section>
      <Section title="Last 30 days">
        <div className="cols-grid">
          <Columns data={d.trend} field="laid_m" label="Metres of pipe laid" />
          <Columns data={d.trend} field="updates" label="Status updates" />
          <Columns data={d.trend} field="issues_opened" label="Issues raised" />
          <Columns data={d.trend} field="grievances" label="Grievances received" />
        </div>
      </Section>
    </div>
  );
}

function Areas({ d, level, setLevel, onDrill }: { d: Dash; level: 'zone' | 'ward' | 'sewer'; setLevel: (l: 'zone' | 'ward' | 'sewer') => void; onDrill: (k: string) => void }) {
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: 'key', dir: 1 });
  const cols: [string, string, (a: Area) => number | string][] = [
    ['key', LEVEL_LABEL[level], (a) => (level === 'ward' ? Number(a.key) : a.key)],
    ['plan', 'DPR plan (km)', (a) => a.plan.km],
    ['works', 'Work stretches', (a) => a.works.count],
    ['laid', 'Pipe laid (m)', (a) => a.works.pipe_laid_m],
    ['pct', '% of plan', (a) => a.laid_pct_of_plan],
    ['restored', 'Restored (m)', (a) => a.works.restored_m],
    ['score', 'Compliance score', (a) => a.compliance.score ?? -1],
    ['cover', 'Compliance overdue', (a) => a.compliance.overdue],
    ['iopen', 'Issues open', (a) => a.issues.open],
    ['iover', 'Issues overdue', (a) => a.issues.overdue],
    ['gopen', 'Grievances open', (a) => a.grievances.open],
  ];
  const getter = cols.find((c) => c[0] === sort.k)![2];
  const rows = useMemo(() => [...d.areas].sort((a, b) => (getter(a) > getter(b) ? 1 : getter(a) < getter(b) ? -1 : 0) * sort.dir), [d, sort]);
  const maxPct = Math.max(0.01, ...d.areas.map((a) => a.laid_pct_of_plan));
  return (
    <>
      <div className="filters">
        <div className="seg">{(['zone', 'ward', 'sewer'] as const).map((l) => <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>By {l === "zone" ? "GWMC zone" : LEVEL_LABEL[l].toLowerCase()}</button>)}</div>
        <button className="btn" onClick={() => download(`dashboard-by-${level}`, cols.map((c) => c[1]), rows.map((a) => cols.map((c) => { const v = c[2](a); return v === -1 ? null : v; })))}>⬇ Excel (CSV)</button>
      </div>
      <p className="muted small">Tap a row to look inside it{level === 'zone' ? ' (its wards)' : ''}. Tap a column heading to sort.</p>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr>{cols.map(([k, l]) => <th key={k} onClick={() => setSort({ k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : -1 })}>{l}{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.key} onClick={() => onDrill(a.key)}>
                <td><b>{level === 'ward' ? `Ward ${a.key}` : level === 'sewer' ? `SZ ${a.key}` : a.key}</b></td>
                <td>{nf(a.plan.km)}</td>
                <td>{a.works.count}</td>
                <td>{nf(a.works.pipe_laid_m)}</td>
                <td title={`${a.laid_pct_of_plan}% of the DPR plan laid`}><span className="mini-bar"><span style={{ width: `${(a.laid_pct_of_plan / maxPct) * 100}%` }} /></span> {a.laid_pct_of_plan}%</td>
                <td>{nf(a.works.restored_m)}</td>
                <td>{a.compliance.score === null ? '—' : `${a.compliance.score}%`}</td>
                <td className={a.compliance.overdue ? 'error' : ''}>{a.compliance.overdue}</td>
                <td>{a.issues.open}</td>
                <td className={a.issues.overdue ? 'error' : ''}>{a.issues.overdue}</td>
                <td>{a.grievances.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Progress({ d, onOpenStretch }: { d: Dash; onOpenStretch: (c: string) => void }) {
  const o = d.overall;
  return (
    <div className="dgrid">
      <Section title="Work stretches by stage (km)">
        <Bars rows={o.works.by_stage.map((s) => ({ label: s.label, value: Math.round(s.m), color: s.color, tip: `${s.label}: ${s.n} work stretches, ${km(s.m)} km` }))} unit=" m" />
      </Section>
      <Section title="Pipe laid per day"><Columns data={d.trend} field="laid_m" label="Metres laid" /></Section>
      <Section title={`No update for 7 days (${d.idle.length})`}>
        {!d.idle.length ? <p className="muted">None — every started work stretch was updated this week.</p> : (
          <div className="list">{d.idle.map((s) => <div key={s.code} className="list-row" onClick={() => onOpenStretch(s.code)}><div className="grow"><b>{s.code}</b> {s.name}<div className="muted small">Ward {s.ward} · last update {fmtTime(s.last_update)}</div></div></div>)}</div>
        )}
      </Section>
      <Section title="Each work stretch" action={<button className="btn" onClick={() => download('work-stretches', ['Code', 'Name', 'Ward', 'Zone', 'Length (m)', 'Stage', 'Pipe laid (m)', 'Compliance score', 'Compliance overdue', 'Open issues', 'Open grievances'],
        d.stretches.map((s) => [s.code, s.name, s.ward, s.zone, s.length_m, STAGES.find((x) => x.key === s.stage)?.label ?? s.stage, s.laid_m, s.score, s.overdue, s.open_issues, s.grievances_open]))}>⬇ Excel (CSV)</button>}>
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Work stretch</th><th>Ward</th><th>Length</th><th>Stage</th><th>Laid</th><th>Compliance</th><th>Issues</th><th>Grievances</th></tr></thead>
            <tbody>
              {d.stretches.map((s) => {
                const st = STAGES.find((x) => x.key === s.stage)!;
                return (
                  <tr key={s.code} onClick={() => onOpenStretch(s.code)}>
                    <td><b>{s.code}</b> <span className="muted">{s.name}</span></td><td>{s.ward}</td><td>{s.length_m} m</td>
                    <td><span className="dot" style={{ background: st.color }} /> {st.label}</td>
                    <td title={`${s.laid_m} of ${s.length_m} m`}><span className="mini-bar"><span style={{ width: `${(s.laid_m / (s.length_m || 1)) * 100}%` }} /></span> {s.laid_m} m</td>
                    <td>{s.score === null ? '—' : `${s.score}%`}{s.overdue ? <span className="error"> · {s.overdue} overdue</span> : null}</td>
                    <td>{s.open_issues}</td><td>{s.grievances_open}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Compliance({ d, onOpenStretch }: { d: Dash; onOpenStretch: (c: string) => void }) {
  const c = d.overall.compliance;
  return (
    <div className="dgrid">
      <div className="tiles">
        <Tile label="Score (verified ÷ due)" value={c.score === null ? '—' : `${c.score}%`} />
        <Tile label="Mandatory items due" value={nf(c.due)} />
        <Tile label="Waiting for verification" value={nf(c.to_verify)} />
        <Tile label="Overdue" value={nf(c.overdue)} tone={c.overdue ? 'bad' : undefined} />
        <Tile label="Not complied" value={nf(c.not_complied)} tone={c.not_complied ? 'bad' : undefined} />
      </div>
      <Section title="Records by compliance item" action={<button className="btn" onClick={() => download('compliance-items', ['Stage', 'Item', 'Complied', 'Verified', 'Not complied', 'Waiting'],
        d.compliance_items.map((i) => [COMPLIANCE_STAGES.find((s) => s.key === i.stage)?.label ?? i.stage, i.name, i.complied, i.verified, i.not_complied, i.waiting]))}>⬇ Excel (CSV)</button>}>
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Stage</th><th>Item</th><th>Complied</th><th>Verified</th><th>Not complied</th><th>Waiting</th></tr></thead>
            <tbody>{d.compliance_items.map((i) => (
              <tr key={i.key}><td className="small">{COMPLIANCE_STAGES.find((s) => s.key === i.stage)?.no}. {COMPLIANCE_STAGES.find((s) => s.key === i.stage)?.label}</td><td>{i.name}</td>
                <td>{i.complied}</td><td>{i.verified}</td><td className={i.not_complied ? 'error' : ''}>{i.not_complied}</td><td>{i.waiting}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Section>
      <Section title="Work stretches with overdue compliances">
        <Bars rows={d.stretches.filter((s) => s.overdue).sort((a, b) => b.overdue - a.overdue).slice(0, 15).map((s) => ({ label: `${s.code} ${s.name}`.slice(0, 40), value: s.overdue }))} />
        <div className="row-btns">{d.stretches.filter((s) => s.overdue).slice(0, 15).map((s) => <button key={s.code} className="btn ghost" onClick={() => onOpenStretch(s.code)}>Open {s.code}</button>)}</div>
      </Section>
    </div>
  );
}

function IssuesView({ d }: { d: Dash }) {
  const i = d.overall.issues;
  return (
    <div className="dgrid">
      <div className="tiles">
        <Tile label="Open" value={nf(i.open)} /><Tile label="High severity open" value={nf(i.high)} tone={i.high ? 'bad' : undefined} />
        <Tile label="Overdue" value={nf(i.overdue)} tone={i.overdue ? 'bad' : undefined} /><Tile label="Days to resolve (average)" value={i.avg_days_to_resolve ?? '—'} sub={`${nf(i.resolved)} resolved`} />
      </div>
      <Section title="Open issues by kind"><Bars rows={i.by_kind.filter((k) => k.open).map((k) => ({ label: k.label, value: k.open, tip: `${k.label}: ${k.open} open of ${k.total}` }))} /></Section>
      <Section title="Last 30 days">
        <div className="cols-grid"><Columns data={d.trend} field="issues_opened" label="Issues raised" /><Columns data={d.trend} field="issues_resolved" label="Issues resolved" color="#16a34a" /></div>
      </Section>
      <Section title="Open issues by area"><Bars rows={d.areas.filter((a) => a.issues.open).map((a) => ({ label: a.key, value: a.issues.open, tip: `${a.key}: ${a.issues.open} open, ${a.issues.overdue} overdue` }))} /></Section>
    </div>
  );
}

function GrievancesView({ d }: { d: Dash }) {
  const g = d.overall.grievances;
  return (
    <div className="dgrid">
      <div className="tiles">
        <Tile label="Received" value={nf(g.total)} /><Tile label="Open" value={nf(g.open)} /><Tile label="Overdue" value={nf(g.overdue)} tone={g.overdue ? 'bad' : undefined} />
        <Tile label="Answered on time" value={g.on_time_pct === null ? '—' : `${g.on_time_pct}%`} sub={`${nf(g.resolved)} resolved`} />
      </div>
      <Section title="Grievances by problem"><Bars rows={g.by_category.map((c) => ({ label: c.label, value: c.total, tip: `${c.label}: ${c.total} received, ${c.open} open` }))} /></Section>
      <Section title="Last 30 days">
        <div className="cols-grid"><Columns data={d.trend} field="grievances" label="Received" /><Columns data={d.trend} field="grievances_resolved" label="Resolved" color="#16a34a" /></div>
      </Section>
      <Section title="Open grievances by area"><Bars rows={d.areas.filter((a) => a.grievances.open).map((a) => ({ label: a.key, value: a.grievances.open }))} /></Section>
    </div>
  );
}

function Activity({ d }: { d: Dash }) {
  return (
    <Section title="Field activity · last 7 days" action={<button className="btn" onClick={() => download('field-activity', ['Name', 'Role', 'Status updates', 'Compliance records', 'Issues reported', 'Last update'],
      d.activity.map((a) => [a.name, a.role, a.updates, a.records, a.issues, a.last_at ? fmtTime(a.last_at) : '']))}>⬇ Excel (CSV)</button>}>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>Name</th><th>Role</th><th>Status updates</th><th>Compliance records</th><th>Issues reported</th><th>Last update</th></tr></thead>
          <tbody>{d.activity.map((a) => <tr key={a.name}><td><b>{a.name}</b></td><td className="small">{a.role}</td><td>{a.updates}</td><td>{a.records}</td><td>{a.issues}</td><td className="small">{a.last_at ? fmtTime(a.last_at) : <span className="muted">never</span>}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="cols-grid"><Columns data={d.trend} field="updates" label="Status updates per day" /></div>
    </Section>
  );
}
