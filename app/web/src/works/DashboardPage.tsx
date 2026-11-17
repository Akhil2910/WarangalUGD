/**
 * Dashboards: work progress, compliance, issues and grievances — overall and by area (GWMC zone, ward,
 * sewerage zone), with a 30-day trend and field activity. Every table can be downloaded for Excel.
 * Charts: one measure per chart (no second axis), labelled bars, a hover tip on every bar.
 */
import { useEffect, useMemo, useState } from 'react';
import { COMPLIANCE_STAGES, STAGES } from 'shared';
import { api } from '../api.ts';
import { fmtTime } from './util.tsx';
import { ACCENT, heat, KpiCard, Meter, RankBars, Ring, Sparkline, StackBar, STATUS, StatusIcon, TrendChart } from '../charts.tsx';

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
  project: {
    settings: { name: string; work_start: string | null; completion: string | null };
    summary: { phase: string; label: string; open: boolean; asked: number; done: number; overdue: number; expiring: number; waiting: number; score: number | null }[];
    attention: { key: string; phase: string; name: string; period_label: string; status: string; status_label: string; due: string | null; valid_to: string | null }[];
  };
}
type View = 'overall' | 'areas' | 'progress' | 'compliance' | 'issues' | 'grievances' | 'activity';
const VIEWS: [View, string][] = [['overall', 'Overall'], ['areas', 'By area'], ['progress', 'Work progress'], ['compliance', 'Compliance'], ['issues', 'Issues'], ['grievances', 'Grievances'], ['activity', 'Field activity']];
const LEVEL_LABEL = { zone: 'GWMC zone', ward: 'Ward', sewer: 'Sewerage zone' } as const;
const nf = (n: number, dg = 0) => n.toLocaleString('en-IN', { maximumFractionDigits: dg });
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
          {view === 'overall' && <Overall d={d} onOpenStretch={onOpenStretch} go={setView} />}
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
function Section({ title, children, action, sub }: { title: string; children: React.ReactNode; action?: React.ReactNode; sub?: string }) {
  return <section className="dsec"><div className="dsec-head"><div><h3>{title}</h3>{sub && <div className="dsec-sub">{sub}</div>}</div>{action}</div>{children}</section>;
}
const pctStatus = (v: number | null, good = 90, watch = 60): keyof typeof STATUS => (v === null ? 'none' : v >= good ? 'good' : v >= watch ? 'watch' : 'bad');
const series = (d: Dash, f: keyof Dash['trend'][number]) => d.trend.map((x) => Number(x[f]));
const dates = (d: Dash) => d.trend.map((x) => x.date);

/** The headline row used on several views. */
function Headline({ d, go }: { d: Dash; go: (v: View) => void }) {
  const o = d.overall;
  const laidPct = o.plan.km ? (o.works.pipe_laid_m / 1000 / o.plan.km) * 100 : 0;
  const cs = o.compliance.score;
  return (
    <div className="kpis">
      <KpiCard label="Pipe laid" value={km(o.works.pipe_laid_m)} unit=" km" note={<>{laidPct < 1 ? laidPct.toFixed(2) : laidPct.toFixed(1)}% of the DPR plan ({nf(o.plan.km)} km)</>} onClick={() => go('progress')}>
        <Sparkline values={series(d, 'laid_m')} label="Metres laid per day, last 30 days" />
      </KpiCard>
      <KpiCard label="Work stretches" value={nf(o.works.count)} note={`${km(o.works.km * 1000)} km of pipe · ${o.works.waiting_approval} awaiting approval`} onClick={() => go('progress')}>
        <div className="mini-stack">{o.works.by_stage.filter((x) => x.n).map((x) => <span key={x.stage} style={{ flexGrow: x.n, background: x.color }} title={`${x.label}: ${x.n}`} />)}</div>
      </KpiCard>
      <KpiCard label="Compliance score" value={cs === null ? '—' : `${cs}`} unit={cs === null ? '' : '%'} status={pctStatus(cs)}
        statusText={cs === null ? 'Nothing due yet' : o.compliance.overdue ? `${o.compliance.overdue} overdue` : o.compliance.to_verify ? `${o.compliance.to_verify} waiting for verification` : 'On track'} note="verified ÷ due" onClick={() => go('compliance')} />
      <KpiCard label="Open issues" value={nf(o.issues.open)} status={o.issues.high ? 'bad' : o.issues.open ? 'watch' : 'good'}
        statusText={o.issues.high ? `${o.issues.high} high severity` : o.issues.open ? 'None high severity' : 'None open'} note={`${o.issues.overdue} overdue · ${nf(o.issues.resolved)} resolved`} onClick={() => go('issues')}>
        <Sparkline values={series(d, 'issues_opened')} color="#b45309" label="Issues raised per day" />
      </KpiCard>
      <KpiCard label="Citizen grievances open" value={nf(o.grievances.open)} status={o.grievances.overdue ? 'bad' : o.grievances.open ? 'watch' : 'good'}
        statusText={o.grievances.overdue ? `${o.grievances.overdue} past 3 days` : o.grievances.open ? 'All within 3 days' : 'None open'}
        note={`${nf(o.grievances.total)} received · ${o.grievances.on_time_pct === null ? '—' : `${o.grievances.on_time_pct}%`} answered on time`} onClick={() => go('grievances')}>
        <Sparkline values={series(d, 'grievances')} color="#7c3aed" label="Grievances received per day" />
      </KpiCard>
    </div>
  );
}

/** What needs someone's attention now. */
function Attention({ d, onOpenStretch, go }: { d: Dash; onOpenStretch: (c: string) => void; go: (v: View) => void }) {
  const o = d.overall;
  const items: { s: keyof typeof STATUS; text: string; act: () => void }[] = [];
  for (const a of d.project.attention.slice(0, 6)) items.push({
    s: a.status === 'waiting' ? 'watch' : 'bad',
    text: `Project: ${a.name}${a.period_label ? `, ${a.period_label}` : ''} — ${a.status_label.toLowerCase()}${a.status === 'expiring' && a.valid_to ? ` (valid till ${a.valid_to})` : ''}`,
    act: () => go('compliance'),
  });
  if (o.compliance.overdue) items.push({ s: 'bad', text: `${o.compliance.overdue} work-stretch compliance item(s) overdue`, act: () => go('compliance') });
  if (o.compliance.not_complied) items.push({ s: 'bad', text: `${o.compliance.not_complied} compliance item(s) marked not complied`, act: () => go('compliance') });
  if (o.issues.high) items.push({ s: 'bad', text: `${o.issues.high} high-severity issue(s) open`, act: () => go('issues') });
  if (o.grievances.overdue) items.push({ s: 'bad', text: `${o.grievances.overdue} citizen grievance(s) past the 3-day limit`, act: () => go('grievances') });
  if (o.compliance.to_verify) items.push({ s: 'watch', text: `${o.compliance.to_verify} compliance record(s) waiting for verification`, act: () => go('compliance') });
  if (o.works.waiting_approval) items.push({ s: 'watch', text: `${o.works.waiting_approval} restoration(s) waiting for approval`, act: () => go('progress') });
  for (const s of d.idle.slice(0, 4)) items.push({ s: 'watch', text: `${s.code} ${s.name}: no update since ${fmtTime(s.last_update)}`, act: () => onOpenStretch(s.code) });
  return (
    <Section title="Needs attention" sub={items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : undefined}>
      {!items.length ? <div className="all-good"><StatusIcon s="good" /> Nothing overdue. Everything is on track.</div> : (
        <div className="attn">{items.map((i, k) => <button key={k} className="attn-row" onClick={i.act}><StatusIcon s={i.s} /><span className="grow">{i.text}</span><span className="muted">›</span></button>)}</div>
      )}
    </Section>
  );
}

// ---------------- views ----------------
function Overall({ d, onOpenStretch, go }: { d: Dash; onOpenStretch: (c: string) => void; go: (v: View) => void }) {
  const o = d.overall;
  const top = [...d.areas].sort((a, b) => b.laid_pct_of_plan - a.laid_pct_of_plan);
  return (
    <div className="dgrid">
      <Headline d={d} go={go} />
      <div className="dcols">
        <Section title="Against the DPR plan" sub="Actual work compared with the full sewerage plan">
          <Meter label="Sewer pipe laid" value={o.works.pipe_laid_m / 1000} target={o.plan.km} unit=" km" digits={2} />
          <Meter label="Manholes built" value={o.works.manholes_built} target={o.plan.manholes} />
          <Meter label="Roads restored (of pipe laid)" value={o.works.restored_m / 1000} target={Math.max(o.works.pipe_laid_m / 1000, 0)} unit=" km" digits={2} color={STATUS.good}
            note={`${km(o.works.approved_m)} km approved`} />
        </Section>
        <Section title="Work stretches by stage" sub="Length of pipe in each stage">
          <StackBar parts={o.works.by_stage.map((x) => ({ label: x.label, value: Math.round(x.m), color: x.color, note: `${x.n}` }))} unit=" m" />
        </Section>
      </div>
      <div className="dcols">
        <Attention d={d} onOpenStretch={onOpenStretch} go={go} />
        <Section title="Progress by GWMC zone" sub="Share of each zone's DPR plan laid · tap a zone in “By area” to look inside">
          <RankBars rows={top.map((a) => ({ key: a.key, label: a.key, value: a.laid_pct_of_plan, tip: `${a.key}: ${a.laid_pct_of_plan}% of ${nf(a.plan.km)} km planned · ${a.works.count} work stretches` }))} unit="%" digits={2} />
        </Section>
      </div>
      <Section title="Last 30 days">
        <div className="trend-grid">
          <TrendChart title="Pipe laid per day" dates={dates(d)} series={[{ label: 'Laid', values: series(d, 'laid_m'), color: ACCENT }]} unit=" m" />
          <TrendChart title="Status updates per day" dates={dates(d)} series={[{ label: 'Updates', values: series(d, 'updates'), color: '#0f766e' }]} />
          <TrendChart title="Issues" dates={dates(d)} series={[{ label: 'Raised', values: series(d, 'issues_opened'), color: '#b45309' }, { label: 'Resolved', values: series(d, 'issues_resolved'), color: STATUS.good }]} />
          <TrendChart title="Citizen grievances" dates={dates(d)} series={[{ label: 'Received', values: series(d, 'grievances'), color: '#7c3aed' }, { label: 'Resolved', values: series(d, 'grievances_resolved'), color: STATUS.good }]} />
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
                <td className="fig" style={{ background: heat(a.laid_pct_of_plan, maxPct) }} title={`${a.laid_pct_of_plan}% of the DPR plan laid`}>{a.laid_pct_of_plan}%</td>
                <td>{nf(a.works.restored_m)}</td>
                <td className="fig">{a.compliance.score === null ? '—' : <span className="score" style={{ color: STATUS[pctStatus(a.compliance.score)] }}>{a.compliance.score}%</span>}</td>
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
      <div className="dcols">
        <Section title="Work stretches by stage" sub="Length of pipe in each stage · number of work stretches">
          <StackBar parts={o.works.by_stage.map((x) => ({ label: x.label, value: Math.round(x.m), color: x.color, note: `${x.n}` }))} unit=" m" />
        </Section>
        <Section title="Against the DPR plan">
          <Meter label="Sewer pipe laid" value={o.works.pipe_laid_m / 1000} target={o.plan.km} unit=" km" digits={2} />
          <Meter label="Pipe laid within the work stretches" value={o.works.pipe_laid_m / 1000} target={o.works.km} unit=" km" digits={2} />
          <Meter label="Manholes built" value={o.works.manholes_built} target={o.works.manholes_planned} note={`DPR total ${nf(o.plan.manholes)}`} />
        </Section>
      </div>
      <Section title="Pipe laid per day"><TrendChart title="Metres laid" dates={dates(d)} series={[{ label: 'Laid', values: series(d, 'laid_m'), color: ACCENT }]} unit=" m" height={170} /></Section>
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
                    <td title={`${s.laid_m} of ${s.length_m} m`}><span className="mini-bar"><span style={{ width: `${(s.laid_m / (s.length_m || 1)) * 100}%` }} /></span> <span className="fig">{s.laid_m} m</span></td>
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
  const st = pctStatus(c.score);
  const byStage = COMPLIANCE_STAGES.map((s) => {
    const items = d.compliance_items.filter((i) => i.stage === s.key);
    return { s, verified: items.reduce((a, i) => a + i.verified, 0), waiting: items.reduce((a, i) => a + i.waiting, 0), not: items.reduce((a, i) => a + i.not_complied, 0) };
  }).filter((x) => x.verified + x.waiting + x.not > 0);
  const pj = d.project;
  return (
    <div className="dgrid">
      <Section title="Project compliance" sub={`${pj.settings.name} · whole project · verified ÷ asked so far`}>
        <div className="phase-grid">
          {pj.summary.map((x) => (
            <div key={x.phase} className="phase-box">
              <div className="phase-top"><b>{x.label}</b><Ring pct={x.score} color={STATUS[pctStatus(x.score)]} label={`${x.label} score`} size={64} /></div>
              <div className="small fig">{x.asked ? `${x.done} of ${x.asked} verified` : x.open ? 'Nothing asked yet' : 'Not started yet'}</div>
              <div className="phase-flags">
                {x.overdue > 0 && <span><StatusIcon s="bad" /> {x.overdue} overdue / rejected</span>}
                {x.expiring > 0 && <span><StatusIcon s="bad" /> {x.expiring} expiring</span>}
                {x.waiting > 0 && <span><StatusIcon s="watch" /> {x.waiting} to verify</span>}
              </div>
            </div>
          ))}
        </div>
        {pj.attention.length > 0 && (
          <div className="attn">{pj.attention.map((a) => (
            <div key={`${a.key}|${a.period_label}`} className="attn-row static"><StatusIcon s={a.status === 'waiting' ? 'watch' : 'bad'} />
              <span className="grow">{a.name}{a.period_label ? `, ${a.period_label}` : ''} <span className="muted">· {a.status_label}{a.valid_to && a.status === 'expiring' ? ` · valid till ${a.valid_to}` : a.due ? ` · due ${a.due}` : ''}</span></span></div>
          ))}</div>
        )}
      </Section>
      <div className="dcols">
        <Section title="Work-stretch compliance score" sub="Mandatory items verified ÷ items due">
          <div className="score-row">
            <Ring pct={c.score} color={STATUS[st]} label="Compliance score" size={110} />
            <div className="score-facts">
              <div><StatusIcon s={st} /> <b>{c.score === null ? 'Nothing due yet' : st === 'good' ? 'Good' : st === 'watch' ? 'Needs watching' : 'Behind'}</b></div>
              <div><span className="fig">{nf(c.due)}</span> items due</div>
              <div><span className="fig">{nf(c.verified)}</span> verified · <span className="fig">{nf(c.to_verify)}</span> waiting for verification</div>
              <div className={c.overdue ? 'error' : ''}><span className="fig">{nf(c.overdue)}</span> overdue</div>
              <div className={c.not_complied ? 'error' : ''}><span className="fig">{nf(c.not_complied)}</span> not complied</div>
            </div>
          </div>
        </Section>
        <Section title="Records by work stage" sub="Verified, waiting and not complied">
          {!byStage.length ? <p className="muted empty-note">No compliance records yet.</p> : byStage.map((x) => (
            <div key={x.s.key} className="stage-comp">
              <div className="small"><b>{x.s.no}. {x.s.label}</b></div>
              <StackBar parts={[{ label: 'Verified', value: x.verified, color: STATUS.good }, { label: 'Waiting', value: x.waiting, color: '#93c5fd' }, { label: 'Not complied', value: x.not, color: STATUS.bad }]} />
            </div>
          ))}
        </Section>
      </div>
      <Section title="Work stretches with overdue compliances">
        <RankBars rows={d.stretches.filter((s) => s.overdue).sort((a, b) => b.overdue - a.overdue).slice(0, 15).map((s) => ({ key: s.code, label: s.code, sub: s.name, value: s.overdue, color: STATUS.bad }))}
          empty="None. No compliance is overdue." onPick={onOpenStretch} />
      </Section>
      <Section title="Records by compliance item" action={<button className="btn" onClick={() => download('compliance-items', ['Stage', 'Item', 'Complied', 'Verified', 'Not complied', 'Waiting'],
        d.compliance_items.map((i) => [COMPLIANCE_STAGES.find((s) => s.key === i.stage)?.label ?? i.stage, i.name, i.complied, i.verified, i.not_complied, i.waiting]))}>⬇ Excel (CSV)</button>}>
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Stage</th><th>Item</th><th className="fig">Complied</th><th className="fig">Verified</th><th className="fig">Not complied</th><th className="fig">Waiting</th></tr></thead>
            <tbody>{d.compliance_items.map((i) => (
              <tr key={i.key}><td className="small">{COMPLIANCE_STAGES.find((s) => s.key === i.stage)?.no}. {COMPLIANCE_STAGES.find((s) => s.key === i.stage)?.label}</td><td>{i.name}</td>
                <td className="fig">{i.complied}</td><td className="fig">{i.verified}</td><td className={`fig ${i.not_complied ? 'error' : ''}`}>{i.not_complied}</td><td className="fig">{i.waiting}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function IssuesView({ d }: { d: Dash }) {
  const i = d.overall.issues;
  return (
    <div className="dgrid">
      <div className="kpis">
        <KpiCard label="Open issues" value={nf(i.open)} status={i.open ? 'watch' : 'good'} statusText={i.open ? 'Being attended' : 'None open'} />
        <KpiCard label="High severity open" value={nf(i.high)} status={i.high ? 'bad' : 'good'} statusText={i.high ? 'Act first' : 'None'} />
        <KpiCard label="Overdue" value={nf(i.overdue)} status={i.overdue ? 'bad' : 'good'} statusText={i.overdue ? 'Past the due date' : 'None'} />
        <KpiCard label="Days to resolve (average)" value={i.avg_days_to_resolve === null ? '—' : String(i.avg_days_to_resolve)} note={`${nf(i.resolved)} resolved`} />
      </div>
      <div className="dcols">
        <Section title="Open issues by kind"><RankBars rows={i.by_kind.filter((k) => k.open).sort((a, b) => b.open - a.open).map((k) => ({ label: k.label, value: k.open, tip: `${k.label}: ${k.open} open of ${k.total}` }))} color="#b45309" empty="No open issues." /></Section>
        <Section title="Open issues by area"><RankBars rows={d.areas.filter((a) => a.issues.open).sort((a, b) => b.issues.open - a.issues.open).map((a) => ({ label: a.key, value: a.issues.open, tip: `${a.key}: ${a.issues.open} open, ${a.issues.overdue} overdue` }))} color="#b45309" empty="No open issues." /></Section>
      </div>
      <Section title="Last 30 days">
        <TrendChart title="Issues" dates={dates(d)} series={[{ label: 'Raised', values: series(d, 'issues_opened'), color: '#b45309' }, { label: 'Resolved', values: series(d, 'issues_resolved'), color: STATUS.good }]} height={170} />
      </Section>
    </div>
  );
}

function GrievancesView({ d }: { d: Dash }) {
  const g = d.overall.grievances;
  return (
    <div className="dgrid">
      <div className="kpis">
        <KpiCard label="Received" value={nf(g.total)} note={`${nf(g.resolved)} resolved`} />
        <KpiCard label="Open" value={nf(g.open)} status={g.open ? 'watch' : 'good'} statusText={g.open ? 'Being attended' : 'None open'} />
        <KpiCard label="Past the 3-day limit" value={nf(g.overdue)} status={g.overdue ? 'bad' : 'good'} statusText={g.overdue ? 'Overdue' : 'None'} />
        <KpiCard label="Answered on time" value={g.on_time_pct === null ? '—' : String(g.on_time_pct)} unit={g.on_time_pct === null ? '' : '%'} status={pctStatus(g.on_time_pct)} statusText={g.on_time_pct === null ? 'None answered yet' : 'within 3 days'} />
      </div>
      <div className="dcols">
        <Section title="Grievances by problem"><RankBars rows={g.by_category.filter((c) => c.total).sort((a, b) => b.total - a.total).map((c) => ({ label: c.label, value: c.total, tip: `${c.label}: ${c.total} received, ${c.open} open` }))} color="#7c3aed" empty="No grievances yet." /></Section>
        <Section title="Open grievances by area"><RankBars rows={d.areas.filter((a) => a.grievances.open).sort((a, b) => b.grievances.open - a.grievances.open).map((a) => ({ label: a.key, value: a.grievances.open }))} color="#7c3aed" empty="No open grievances." /></Section>
      </div>
      <Section title="Last 30 days">
        <TrendChart title="Citizen grievances" dates={dates(d)} series={[{ label: 'Received', values: series(d, 'grievances'), color: '#7c3aed' }, { label: 'Resolved', values: series(d, 'grievances_resolved'), color: STATUS.good }]} height={170} />
      </Section>
    </div>
  );
}

function Activity({ d }: { d: Dash }) {
  const maxU = Math.max(0, ...d.activity.map((a) => a.updates + a.records + a.issues));
  return (
    <div className="dgrid">
      <Section title="Field activity · last 7 days" action={<button className="btn" onClick={() => download('field-activity', ['Name', 'Role', 'Status updates', 'Compliance records', 'Issues reported', 'Last update'],
        d.activity.map((a) => [a.name, a.role, a.updates, a.records, a.issues, a.last_at ? fmtTime(a.last_at) : '']))}>⬇ Excel (CSV)</button>}>
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Name</th><th>Role</th><th className="fig">Status updates</th><th className="fig">Compliance records</th><th className="fig">Issues reported</th><th>Total</th><th>Last update</th></tr></thead>
            <tbody>{d.activity.map((a) => {
              const t = a.updates + a.records + a.issues;
              return <tr key={a.name}><td><b>{a.name}</b></td><td className="small">{a.role}</td><td className="fig">{a.updates}</td><td className="fig">{a.records}</td><td className="fig">{a.issues}</td>
                <td><span className="mini-bar"><span style={{ width: `${maxU ? (t / maxU) * 100 : 0}%` }} /></span> <span className="fig">{t}</span></td>
                <td className="small">{a.last_at ? fmtTime(a.last_at) : <span className="muted">never</span>}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </Section>
      <Section title="Last 30 days"><TrendChart title="Status updates per day" dates={dates(d)} series={[{ label: 'Updates', values: series(d, 'updates'), color: '#0f766e' }]} height={170} /></Section>
    </div>
  );
}
