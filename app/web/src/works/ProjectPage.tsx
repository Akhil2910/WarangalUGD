/**
 * Project tab: the project's definition and timeline.
 *  Overview (time vs work, slippage, packages, next and late milestones) · Timeline (Gantt) · Progress (S-curve, planned vs actual)
 *  · Extensions of time · Plan (definition, packages, Excel work programme, history).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Icon } from '../ui.tsx';
import { KpiCard, Meter, nf, STATUS } from '../charts.tsx';
import { Modal } from './Modal.tsx';
import { fmtDate, fmtTime, uploadFile, type Uploaded } from './util.tsx';

type View = 'overview' | 'timeline' | 'progress' | 'eots' | 'plan';
type Measure = 'pipe_km' | 'manholes' | 'ics' | 'road_km';
interface Pkg { id: number; code: string; name: string; contractor: string; agreement_no: string; agreement_date: string | null; appointed_date: string | null; original_completion: string | null; value_cr: number | null; wards: number[]; note: string; active: boolean }
interface Act { id: number; package_id: number; code: string; parent_code: string; name: string; kind: 'phase' | 'activity' | 'milestone'; planned_start: string | null; planned_finish: string | null; baseline_start: string | null; baseline_finish: string | null; actual_start: string | null; actual_finish: string | null; pct: number; weight: number; note: string }
interface Eot { id: number; package_id: number; eot_no: string; approved_on: string | null; to_date: string; reason: string; files: Uploaded[]; created_at: string; by_name: string | null }
interface Summary {
  package_id: number; start: string | null; original_completion: string | null; revised_completion: string | null; extension_days: number; eots: number;
  time_pct: number | null; work_pct: number | null; pipe_planned_now: number; pipe_actual_now: number; pipe_planned_total: number; slip_days: number;
  late: { id: number; package_id: number; code: string; name: string; kind: string; planned_finish: string; days: number }[]; next: { id: number; package_id: number; code: string; name: string; planned_finish: string }[];
}
interface Plan {
  today: string; settings: Record<string, unknown> & { name: string; work_start: string | null; completion: string | null; scope?: Record<string, number | null> };
  packages: Pkg[]; activities: Act[]; eots: Eot[]; months: string[];
  planned: Record<number, Record<Measure, number[]>>; actual: Record<number, Record<Measure, (number | null)[]>>;
  summary: Summary[]; measures: { key: Measure; label: string; unit: string }[]; can: { plan: boolean; progress: boolean };
}

const VIEWS: [View, string, string][] = [['overview', 'Overview', 'dashboard'], ['timeline', 'Timeline', 'works'], ['progress', 'Progress', 'network'], ['eots', 'Extensions of time', 'pencil'], ['plan', 'Plan', 'compliance']];
const mLabel = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const cr = (v: number | null | undefined) => (v == null ? '—' : `₹${nf(v, 2)} Cr`);

export function ProjectPage({ focusId }: { focusId?: number | null }) {
  const [d, setD] = useState<Plan | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState<View>(focusId ? 'timeline' : 'overview');
  const [scope, setScope] = useState(0);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => { api<Plan>('/api/project/plan').then(setD).catch((e) => setErr((e as Error).message)); }, [tick]);
  if (err) return <div className="page"><p className="error">{err}</p></div>;
  if (!d) return <div className="page"><p className="muted">Loading…</p></div>;
  const live = d.packages.filter((p) => p.active);
  const s = d.summary.find((x) => x.package_id === scope) ?? d.summary[0];
  const scopeName = scope ? live.find((p) => p.id === scope)?.name ?? '' : 'Whole project';
  return (
    <div className="page dash project">
      <div className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-kicker">Project{d.settings.scheme ? ` · ${String(d.settings.scheme)}` : ''}</span>
          <h2>{d.settings.name}</h2>
          <span className="dash-asof">
            {s.start ? `Started ${fmtDate(s.start)}` : 'Start date not set'} · {s.revised_completion ? `completion ${fmtDate(s.revised_completion)}` : 'completion not set'}
            {s.extension_days ? ` (extended by ${s.extension_days} days)` : ''}
          </span>
        </div>
        {live.length > 0 && (
          <label className="pj-scope">Show
            <select value={scope} onChange={(e) => setScope(Number(e.target.value))}>
              <option value={0}>Whole project</option>
              {live.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <nav className="dash-tabs">{VIEWS.map(([k, l, ic]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}><Icon name={ic} />{l}</button>)}</nav>
      {view === 'overview' && <Overview d={d} s={s} scope={scope} setScope={setScope} go={setView} />}
      {view === 'timeline' && <Gantt d={d} scope={scope} scopeName={scopeName} focusId={focusId ?? null} onChanged={reload} />}
      {view === 'progress' && <Progress d={d} scope={scope} scopeName={scopeName} />}
      {view === 'eots' && <Eots d={d} onChanged={reload} />}
      {view === 'plan' && <PlanView d={d} onChanged={reload} />}
    </div>
  );
}

// ---------------- overview ----------------
function Overview({ d, s, scope, setScope, go }: { d: Plan; s: Summary; scope: number; setScope: (n: number) => void; go: (v: View) => void }) {
  const live = d.packages.filter((p) => p.active);
  const empty = !d.activities.length && !d.summary[0].pipe_planned_total;
  const pc = (id: number) => (scope || !id ? '' : `${live.find((p) => p.id === id)?.code ?? ''} `);
  const slipStatus = s.slip_days > 60 ? 'bad' : s.slip_days > 15 ? 'watch' : 'good';
  const ahead = s.time_pct != null && s.work_pct != null ? s.work_pct - s.time_pct : null;
  return (
    <>
      {empty && (
        <section className="dsec pj-empty">
          <b>The project plan is not set up yet.</b>
          <span className="muted">{d.can.plan ? 'Open Plan: fill in the project details and packages, then download the Excel work programme, fill it in and upload it.' : 'The PMU or Commissioner sets up the plan (Project → Plan).'}</span>
          {d.can.plan && <button className="btn primary" onClick={() => go('plan')}>Set up the plan</button>}
        </section>
      )}
      <div className="kpi-row">
        <KpiCard label="Time used" value={s.time_pct == null ? '—' : nf(s.time_pct, 1)} unit={s.time_pct == null ? '' : '%'}
          note={s.start && s.revised_completion ? `${nf(Math.max(0, days(d.today, s.revised_completion)))} days left of ${nf(days(s.start, s.revised_completion))}` : 'Set the start and completion dates'} />
        <KpiCard label="Work done" value={s.work_pct == null ? '—' : nf(s.work_pct, 1)} unit={s.work_pct == null ? '' : '%'}
          status={ahead == null ? undefined : ahead >= -5 ? 'good' : ahead >= -15 ? 'watch' : 'bad'}
          statusText={ahead == null ? undefined : ahead >= 0 ? 'Ahead of time used' : `${nf(-ahead, 1)} points behind time used`}
          note="Weighted % of the activities on the timeline" />
        <KpiCard label="Sewer pipe laid" value={nf(s.pipe_actual_now, 2)} unit=" km"
          note={s.pipe_planned_total ? `Planned by now ${nf(s.pipe_planned_now, 2)} km of ${nf(s.pipe_planned_total, 2)} km` : 'No monthly targets yet'} onClick={() => go('progress')} />
        <KpiCard label="Behind plan" value={s.pipe_planned_total ? nf(s.slip_days) : '—'} unit={s.pipe_planned_total ? ' days' : ''}
          status={s.pipe_planned_total ? slipStatus : undefined} statusText={s.pipe_planned_total ? (s.slip_days ? 'Pipe laying is behind the plan' : 'On plan') : undefined}
          note="How long ago the plan expected today's progress" />
        <KpiCard label="Extensions of time" value={nf(s.eots)} note={s.extension_days ? `${nf(s.extension_days)} days added · now ${fmtDate(s.revised_completion)}` : 'None'} onClick={() => go('eots')} />
      </div>
      <div className="pj-two">
        <section className="dsec">
          <div className="dsec-head"><div className="dsec-titles"><span className="dsec-ico"><Icon name="issues" /></span><div><h3>Late</h3><div className="dsec-sub">Activities and milestones past their planned finish</div></div></div></div>
          {s.late.length ? <ul className="pj-list">{s.late.slice(0, 8).map((l) => <li key={l.id}><span className="pchip bad">{l.days} d late</span><span><b>{pc(l.package_id)}{l.code}</b> {l.name}</span><span className="muted small">{fmtDate(l.planned_finish)}</span></li>)}</ul>
            : <p className="muted">Nothing is late.</p>}
          {s.late.length > 8 && <button className="link" onClick={() => go('timeline')}>All {s.late.length} on the timeline</button>}
        </section>
        <section className="dsec">
          <div className="dsec-head"><div className="dsec-titles"><span className="dsec-ico"><Icon name="pin" /></span><div><h3>Next milestones</h3><div className="dsec-sub">Coming up (late ones are under Late)</div></div></div></div>
          {s.next.length ? <ul className="pj-list">{s.next.map((n) => <li key={n.id}><span className={`pchip ${days(d.today, n.planned_finish) <= 30 ? 'due' : 'none'}`}>in {days(d.today, n.planned_finish)} d</span><span><b>{pc(n.package_id)}{n.code}</b> {n.name}</span><span className="muted small">{fmtDate(n.planned_finish)}</span></li>)}</ul>
            : <p className="muted">No upcoming milestones.</p>}
        </section>
      </div>
      {live.length > 0 && (
        <section className="dsec">
          <div className="dsec-head"><div className="dsec-titles"><span className="dsec-ico"><Icon name="works" /></span><div><h3>Packages</h3><div className="dsec-sub">Tap a package to see only its figures</div></div></div></div>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Package</th><th>Contractor</th><th className="fig">Value</th><th>Completion</th><th>Time used</th><th>Work done</th><th className="fig">Pipe laid / planned now</th><th className="fig">Late</th></tr></thead>
              <tbody>{live.map((p) => {
                const x = d.summary.find((y) => y.package_id === p.id)!;
                return (
                  <tr key={p.id} className={scope === p.id ? 'sel' : ''} onClick={() => setScope(scope === p.id ? 0 : p.id)}>
                    <td><b>{p.code}</b> · {p.name}<div className="muted small">Wards {p.wards.join(', ') || '—'}</div></td>
                    <td>{p.contractor || '—'}<div className="muted small">{p.agreement_no}</div></td>
                    <td className="fig">{cr(p.value_cr)}</td>
                    <td>{fmtDate(x.revised_completion)}{x.extension_days ? <div className="small" style={{ color: STATUS.watch }}>+{x.extension_days} days</div> : null}</td>
                    <td><Bar pct={x.time_pct} color="#64748b" /></td>
                    <td><Bar pct={x.work_pct} color="#2563eb" /></td>
                    <td className="fig">{nf(x.pipe_actual_now, 2)} / {nf(x.pipe_planned_now, 2)} km</td>
                    <td className="fig">{x.late.length ? <span className="pchip bad">{x.late.length}</span> : '0'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </section>
      )}
      <Definition d={d} />
    </>
  );
}
function Bar({ pct, color }: { pct: number | null; color: string }) {
  if (pct == null) return <span className="muted">—</span>;
  return <div className="pj-bar" title={`${nf(pct, 1)}%`}><span style={{ width: `${Math.min(100, pct)}%`, background: color }} /><b>{nf(pct, 0)}%</b></div>;
}
function Definition({ d, bare = false }: { d: Plan; bare?: boolean }) {
  const st = d.settings as Record<string, unknown>;
  const sc = (st.scope ?? {}) as Record<string, number | null>;
  const rows: [string, string][] = ([
    ['Scheme / funding', String(st.scheme ?? '')], ['Administrative sanction', [st.as_no, st.as_date ? fmtDate(String(st.as_date)) : ''].filter(Boolean).join(' · ')],
    ['Technical sanction', [st.ts_no, st.ts_date ? fmtDate(String(st.ts_date)) : ''].filter(Boolean).join(' · ')], ['Sanctioned cost', st.sanctioned_cost_cr != null ? cr(Number(st.sanctioned_cost_cr)) : ''],
    ['Work start', d.settings.work_start ? fmtDate(d.settings.work_start) : ''], ['Completion (original)', d.settings.completion ? fmtDate(d.settings.completion) : ''],
    ['Defect liability', st.dlp_months ? `${st.dlp_months} months` : ''],
    ['Scope', [sc.pipe_km ? `${nf(sc.pipe_km, 1)} km sewer` : '', sc.manholes ? `${nf(sc.manholes)} manholes` : '', sc.ics ? `${nf(sc.ics)} house connections` : '', sc.road_km ? `${nf(sc.road_km, 1)} km road restoration` : '', sc.pumping_stations ? `${sc.pumping_stations} pumping stations` : '', sc.stp_mld ? `STP ${sc.stp_mld} MLD` : ''].filter(Boolean).join(' · ')],
  ] as [string, string][]).filter(([, v]) => v);
  if (!rows.length && !st.description) return bare ? <p className="muted">Not filled in yet.</p> : null;
  if (bare) return <>{st.description ? <p>{String(st.description)}</p> : null}<dl className="pj-def">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl></>;
  return (
    <section className="dsec">
      <div className="dsec-head"><div className="dsec-titles"><span className="dsec-ico"><Icon name="info" /></span><div><h3>About the project</h3></div></div></div>
      {st.description ? <p>{String(st.description)}</p> : null}
      <dl className="pj-def">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
    </section>
  );
}

// ---------------- timeline (Gantt) ----------------
function Gantt({ d, scope, scopeName, focusId, onChanged }: { d: Plan; scope: number; scopeName: string; focusId: number | null; onChanged: () => void }) {
  const [zoom, setZoom] = useState(44);
  const [edit, setEdit] = useState<Act | 'new' | null>(null);
  const [prog, setProg] = useState<Act | null>(null);
  const [onlyLate, setOnlyLate] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pkgCode = (id: number) => (id ? d.packages.find((p) => p.id === id)?.code ?? '?' : '');
  // rows in tree order: each package (or whole project), then phases with their children
  const rows = useMemo(() => {
    const acts = d.activities.filter((a) => !scope || a.package_id === scope);
    const out: { a: Act; depth: number; group?: string }[] = [];
    const pids = [...new Set(acts.map((a) => a.package_id))].sort((x, y) => x - y);
    for (const pid of pids) {
      const inPkg = acts.filter((a) => a.package_id === pid);
      const codes = new Set(inPkg.map((a) => a.code));
      let first = true; // the package heading goes above its first line only
      const walk = (parent: string, depth: number) => {
        for (const a of inPkg.filter((x) => (parent ? x.parent_code === parent : !x.parent_code || !codes.has(x.parent_code)))) {
          out.push({ a, depth, group: first && !scope ? (pid ? `${pkgCode(pid)} · ${d.packages.find((p) => p.id === pid)?.name ?? ''}` : 'Whole project') : undefined });
          first = false;
          if (depth < 6) walk(a.code, depth + 1);
        }
      };
      walk('', 0);
    }
    return out;
  }, [d, scope]);
  // a phase without its own dates spans its children
  const span = (a: Act): [string | null, string | null] => {
    if (a.kind !== 'phase' || (a.planned_start && a.planned_finish)) return [a.planned_start, a.planned_finish];
    const kids = d.activities.filter((x) => x.package_id === a.package_id && x.parent_code === a.code);
    const ss = kids.map((k) => k.planned_start).filter(Boolean) as string[], ff = kids.map((k) => k.planned_finish).filter(Boolean) as string[];
    return [ss.length ? ss.reduce((p, c) => (c < p ? c : p)) : null, ff.length ? ff.reduce((p, c) => (c > p ? c : p)) : null];
  };
  const isLate = (a: Act) => a.kind !== 'phase' && !a.actual_finish && !!a.planned_finish && a.planned_finish < d.today;
  const shown = onlyLate ? rows.filter((r) => isLate(r.a)) : rows;
  const months = d.months;
  const W = months.length * zoom;
  const x = (date: string) => {
    const i = months.indexOf(date.slice(0, 7));
    if (i < 0) return date < `${months[0]}-01` ? 0 : W;
    const dim = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
    return i * zoom + ((Number(date.slice(8, 10)) - 1) / dim) * zoom;
  };
  const todayX = x(d.today);
  useEffect(() => { // start scrolled to a little before today
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, todayX - el.clientWidth * 0.35);
  }, [zoom, scope]);
  useEffect(() => { const a = focusId ? d.activities.find((x) => x.id === focusId) : null; if (a) setProg(a); }, [focusId]);
  const pkgDates = (pid: number) => d.summary.find((s) => s.package_id === pid);
  if (!rows.length) return <section className="dsec"><p className="muted">No activities on the timeline{scope ? ` of ${scopeName}` : ''} yet.{d.can.plan ? ' Add them one by one here, or upload the Excel work programme in Plan.' : ''}</p>{d.can.plan && <div><button className="btn primary" onClick={() => setEdit('new')}>+ Add a line</button></div>}{edit && <ActivityForm d={d} a={null} scope={scope} onClose={(ch) => { setEdit(null); if (ch) onChanged(); }} />}</section>;
  const sc = pkgDates(scope);
  return (
    <section className="dsec">
      <div className="dsec-head">
        <div className="dsec-titles"><span className="dsec-ico"><Icon name="works" /></span><div><h3>Timeline · {scopeName}</h3>
          <div className="dsec-sub">Bar = plan · thin grey line = original plan (baseline) · dark part = done · ◆ milestone · red = late. Tap a line to record progress.</div></div></div>
        <div className="row-btns">
          <label className="check-row"><input type="checkbox" checked={onlyLate} onChange={(e) => setOnlyLate(e.target.checked)} /> Only late</label>
          <div className="seg">{[[24, 'Years'], [44, 'Months'], [90, 'Weeks']].map(([z, l]) => <button key={l} className={zoom === z ? 'on' : ''} onClick={() => setZoom(Number(z))}>{l}</button>)}</div>
          {d.can.plan && <button className="btn primary" onClick={() => setEdit('new')}>+ Add a line</button>}
        </div>
      </div>
      <div className="gantt">
        <div className="g-names">
          <div className="g-head">Activity</div>
          {shown.map(({ a, depth, group }) => (
            <Fragment key={a.id}>
              {group && <div className="g-group">{group}</div>}
              <button className={`g-name k-${a.kind} ${isLate(a) ? 'late' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setProg(a)} title={`${a.code} ${a.name}`}>
                <span className="g-code">{a.code}</span>{a.name}
              </button>
            </Fragment>
          ))}
        </div>
        <div className="g-scroll" ref={scroller}>
          <div style={{ width: W, position: 'relative' }}>
            <div className="g-head g-months">{months.map((m, i) => <span key={m} style={{ left: i * zoom, width: zoom }} className={m.endsWith('-01') ? 'yr' : ''}>{zoom >= 40 || m.endsWith('-01') || i === 0 ? mLabel(m) : ''}</span>)}</div>
            <div className="g-body">
              {months.map((m, i) => <i key={m} className={`g-col ${m.endsWith('-01') ? 'yr' : ''}`} style={{ left: i * zoom }} />)}
              {sc?.revised_completion && <i className="g-end" style={{ left: x(sc.revised_completion) }} title={`Completion ${fmtDate(sc.revised_completion)}`} />}
              {sc?.original_completion && sc.original_completion !== sc.revised_completion && <i className="g-end orig" style={{ left: x(sc.original_completion) }} title={`Original completion ${fmtDate(sc.original_completion)}`} />}
              <i className="g-today" style={{ left: todayX }}><b>Today</b></i>
              {shown.map(({ a, group }) => {
                const [ps, pf] = span(a);
                const late = isLate(a);
                return (
                  <Fragment key={a.id}>
                    {group && <div className="g-row g-grouprow" />}
                    <div className="g-row" onClick={() => setProg(a)}>
                      {a.baseline_finish && a.kind !== 'milestone' && a.baseline_start && (a.baseline_start !== ps || a.baseline_finish !== pf) && (
                        <i className="g-base" style={{ left: x(a.baseline_start), width: Math.max(2, x(a.baseline_finish) - x(a.baseline_start)) }} />
                      )}
                      {a.kind === 'milestone' && pf ? (
                        <i className={`g-ms ${a.actual_finish ? 'done' : late ? 'late' : ''}`} style={{ left: x(a.actual_finish ?? pf) }}
                          title={`${a.name}: planned ${fmtDate(pf)}${a.actual_finish ? `, reached ${fmtDate(a.actual_finish)}` : ''}`} />
                      ) : ps && pf ? (
                        <i className={`g-bar k-${a.kind} ${late ? 'late' : ''} ${a.actual_finish ? 'done' : ''}`} style={{ left: x(ps), width: Math.max(3, x(pf) - x(ps) + zoom / 30) }}
                          title={`${a.name}: ${fmtDate(ps)} – ${fmtDate(pf)} · ${nf(a.actual_finish ? 100 : a.pct)}% done${a.baseline_finish && a.baseline_finish !== pf ? ` · original finish ${fmtDate(a.baseline_finish)}` : ''}`}>
                          {a.kind !== 'phase' && <span style={{ width: `${a.actual_finish ? 100 : a.pct}%` }} />}
                        </i>
                      ) : null}
                      {a.actual_start && a.kind === 'activity' && <i className="g-act" style={{ left: x(a.actual_start), width: Math.max(2, x(a.actual_finish ?? d.today) - x(a.actual_start)) }} title={`Actual: ${fmtDate(a.actual_start)} – ${a.actual_finish ? fmtDate(a.actual_finish) : 'ongoing'}`} />}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {prog && <ProgressForm d={d} a={prog} onEdit={d.can.plan ? () => { setEdit(prog); setProg(null); } : undefined} onClose={(ch) => { setProg(null); if (ch) onChanged(); }} />}
      {edit && <ActivityForm d={d} a={edit === 'new' ? null : edit} scope={scope} onClose={(ch) => { setEdit(null); if (ch) onChanged(); }} />}
    </section>
  );
}

function ProgressForm({ d, a, onEdit, onClose }: { d: Plan; a: Act; onEdit?: () => void; onClose: (changed: boolean) => void }) {
  const [f, setF] = useState({ actual_start: a.actual_start ?? '', actual_finish: a.actual_finish ?? '', pct: String(a.actual_finish ? 100 : a.pct), note: a.note ?? '' });
  const [msg, setMsg] = useState('');
  const ms = a.kind === 'milestone';
  const save = async () => {
    setMsg('');
    try {
      await api(`/api/project/activities/${a.id}/progress`, { actual_start: ms ? null : f.actual_start || null, actual_finish: f.actual_finish || null, pct: ms ? undefined : Number(f.pct) || 0, note: f.note });
      onClose(true);
    } catch (e) { setMsg((e as Error).message); }
  };
  const pkg = a.package_id ? d.packages.find((p) => p.id === a.package_id) : null;
  return (
    <Modal title={`${a.code} · ${a.name}`} size="small" onClose={() => onClose(false)}
      footer={<>{onEdit && <button className="btn ghost" onClick={onEdit}>Change the plan</button>}<span className="grow" /><button className="btn" onClick={() => onClose(false)}>{d.can.progress ? 'Cancel' : 'Close'}</button>{d.can.progress && a.kind !== 'phase' && <button className="btn primary" onClick={save}>Save progress</button>}</>}>
      <p className="muted small">{a.kind === 'phase' ? 'Phase' : ms ? 'Milestone' : 'Activity'}{pkg ? ` · ${pkg.code} ${pkg.name}` : ' · whole project'}</p>
      <dl className="pj-def">
        <dt>Planned</dt><dd>{ms ? fmtDate(a.planned_finish) : `${fmtDate(a.planned_start)} – ${fmtDate(a.planned_finish)}`}</dd>
        {a.baseline_finish && a.baseline_finish !== a.planned_finish && <><dt>Original plan</dt><dd>{ms ? fmtDate(a.baseline_finish) : `${fmtDate(a.baseline_start)} – ${fmtDate(a.baseline_finish)}`}</dd></>}
      </dl>
      {a.kind === 'phase' ? <p className="muted">A phase shows the span of its activities; record progress on the activities.</p> : d.can.progress ? (
        <div className="two">
          {!ms && <label className="field">Actually started<input type="date" max={d.today} value={f.actual_start} onChange={(e) => setF({ ...f, actual_start: e.target.value })} /></label>}
          <label className="field">{ms ? 'Reached on' : 'Actually finished'}<input type="date" max={d.today} value={f.actual_finish} onChange={(e) => setF({ ...f, actual_finish: e.target.value, pct: e.target.value ? '100' : f.pct })} /></label>
          {!ms && <label className="field">% done<input type="number" min={0} max={100} value={f.pct} disabled={!!f.actual_finish} onChange={(e) => setF({ ...f, pct: e.target.value })} /></label>}
          <label className="field" style={{ gridColumn: '1 / -1' }}>Note<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Approved by CE, letter no." /></label>
        </div>
      ) : (
        <dl className="pj-def"><dt>Actual</dt><dd>{a.actual_finish ? `Finished ${fmtDate(a.actual_finish)}` : a.actual_start ? `Started ${fmtDate(a.actual_start)}, ${nf(a.pct)}% done` : 'Not started'}</dd>{a.note && <><dt>Note</dt><dd>{a.note}</dd></>}</dl>
      )}
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}

function ActivityForm({ d, a, scope, onClose }: { d: Plan; a: Act | null; scope: number; onClose: (changed: boolean) => void }) {
  const [f, setF] = useState({ package_id: a?.package_id ?? scope, code: a?.code ?? '', parent_code: a?.parent_code ?? '', name: a?.name ?? '', kind: a?.kind ?? 'activity', planned_start: a?.planned_start ?? '', planned_finish: a?.planned_finish ?? '', weight: String(a?.weight ?? 1) });
  const [msg, setMsg] = useState('');
  const phases = d.activities.filter((x) => x.package_id === f.package_id && x.kind === 'phase' && x.code !== f.code);
  const save = async () => {
    setMsg('');
    try {
      await api('/api/project/activities', { ...(a ? { id: a.id } : {}), package_id: Number(f.package_id), code: f.code, parent_code: f.parent_code, name: f.name, kind: f.kind,
        planned_start: f.planned_start || null, planned_finish: f.planned_finish || null, weight: Number(f.weight) || 0 });
      onClose(true);
    } catch (e) { setMsg((e as Error).message); }
  };
  const remove = async () => {
    if (!a || !confirm(`Remove "${a.name}" from the timeline? It is kept in the history.`)) return;
    try { await api(`/api/project/activities/${a.id}/remove`, {}); onClose(true); } catch (e) { setMsg((e as Error).message); }
  };
  const ms = f.kind === 'milestone';
  return (
    <Modal title={a ? `Change ${a.code}` : 'Add a line to the timeline'} onClose={() => onClose(false)}
      footer={<>{a && <button className="btn ghost" onClick={remove}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="two">
        <label className="field">Package<select value={f.package_id} onChange={(e) => setF({ ...f, package_id: Number(e.target.value), parent_code: '' })}>
          <option value={0}>Whole project</option>{d.packages.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
        <label className="field">Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Act['kind'] })}><option value="phase">Phase</option><option value="activity">Activity</option><option value="milestone">Milestone</option></select></label>
        <label className="field">Code (e.g. 2.3)<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
        <label className="field">Under phase<select value={f.parent_code} onChange={(e) => setF({ ...f, parent_code: e.target.value })}><option value="">— none —</option>{phases.map((p) => <option key={p.id} value={p.code}>{p.code} {p.name}</option>)}</select></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        {!ms && <label className="field">Planned start<input type="date" value={f.planned_start} onChange={(e) => setF({ ...f, planned_start: e.target.value })} /></label>}
        <label className="field">{ms ? 'Planned date' : 'Planned finish'}<input type="date" value={f.planned_finish} onChange={(e) => setF({ ...f, planned_finish: e.target.value })} /></label>
        {f.kind === 'activity' && <label className="field">Weight (share of the work)<input type="number" min={0} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></label>}
      </div>
      {a && <p className="muted small">The original plan (baseline) stays as it was; the timeline shows both.</p>}
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}

// ---------------- progress (S-curve) ----------------
function Progress({ d, scope, scopeName }: { d: Plan; scope: number; scopeName: string }) {
  const [m, setM] = useState<Measure>('pipe_km');
  const def = d.measures.find((x) => x.key === m)!;
  const planned = d.planned[scope]?.[m] ?? [];
  const actual = d.actual[scope]?.[m] ?? [];
  const i = d.months.indexOf(d.today.slice(0, 7));
  const digits = def.unit === 'km' ? 2 : 0;
  const hasPlan = planned.some((v) => v > 0);
  return (
    <section className="dsec">
      <div className="dsec-head">
        <div className="dsec-titles"><span className="dsec-ico"><Icon name="network" /></span><div><h3>{def.label}: planned and actual · {scopeName}</h3>
          <div className="dsec-sub">Running totals by month. Actual comes from the work-stretch updates{scope ? " in the package's wards" : ''}.</div></div></div>
        <div className="seg">{d.measures.map((x) => <button key={x.key} className={m === x.key ? 'on' : ''} onClick={() => setM(x.key)}>{x.label}</button>)}</div>
      </div>
      <div className="kpi-row">
        <Meter label="Done of the whole plan" value={actual[i] ?? 0} target={planned[planned.length - 1] ?? 0} unit={def.unit ? ` ${def.unit}` : ''} digits={digits} />
        <Meter label="Done of what was planned by now" value={actual[i] ?? 0} target={planned[i] ?? 0} unit={def.unit ? ` ${def.unit}` : ''} digits={digits} color={(actual[i] ?? 0) >= (planned[i] ?? 0) * 0.95 ? STATUS.good : STATUS.bad} />
      </div>
      {!hasPlan && <p className="muted">No monthly targets for this yet. They come from the Excel work programme (Plan → Upload).</p>}
      <SCurve months={d.months} planned={planned} actual={actual} today={d.today} unit={def.unit} digits={digits} />
      <details className="pj-table">
        <summary>Month by month</summary>
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>Month</th><th className="fig">Planned in month</th><th className="fig">Planned total</th><th className="fig">Actual total</th><th className="fig">Difference</th></tr></thead>
          <tbody>{d.months.map((mo, k) => {
            const pm = planned[k] - (k ? planned[k - 1] : 0);
            const a = actual[k];
            return <tr key={mo}><td>{mLabel(mo)}</td><td className="fig">{nf(pm, digits)}</td><td className="fig">{nf(planned[k], digits)}</td><td className="fig">{a == null ? '—' : nf(a, digits)}</td>
              <td className="fig" style={{ color: a == null ? undefined : a >= planned[k] ? STATUS.good : STATUS.bad }}>{a == null ? '' : `${a >= planned[k] ? '+' : ''}${nf(a - planned[k], digits)}`}</td></tr>;
          })}</tbody>
        </table></div>
      </details>
    </section>
  );
}

function SCurve({ months, planned, actual, today, unit, digits }: { months: string[]; planned: number[]; actual: (number | null)[]; today: string; unit: string; digits: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(700);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 260, L = 46, R = 12, T = 12, B = 26, n = months.length;
  const max = Math.max(1, ...planned, ...(actual.filter((v) => v != null) as number[])) * 1.08;
  const x = (k: number) => L + (n < 2 ? 0 : (k / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const path = (vals: (number | null)[]) => vals.map((v, k) => (v == null ? '' : `${k && vals[k - 1] != null ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`)).join('');
  const ti = months.indexOf(today.slice(0, 7));
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L) / 64))));
  const u = unit ? ` ${unit}` : '';
  return (
    <div className="trend">
      <div className="trend-head"><span className="trend-legend"><span><i style={{ background: '#94a3b8' }} />Planned</span><span><i style={{ background: '#2563eb' }} />Actual</span></span></div>
      <div className="trend-plot" ref={box} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = box.current!.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))))); }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Planned and actual progress by month">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(max * t)} y2={y(max * t)} className="grid-line" /><text x={L - 6} y={y(max * t) + 4} className="axis-text" textAnchor="end">{nf(max * t, max < 10 ? 1 : 0)}</text></g>)}
          {months.map((m, k) => (k % step === 0 ? <text key={m} x={x(k)} y={H - 7} className="axis-text" textAnchor="middle">{mLabel(m)}</text> : null))}
          {ti >= 0 && <><line x1={x(ti)} x2={x(ti)} y1={T} y2={H - B} stroke="#dc2626" strokeDasharray="4 3" /><text x={x(ti) + 4} y={T + 10} className="axis-text" fill="#dc2626">Today</text></>}
          <path d={path(planned)} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" />
          <path d={path(actual)} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {hover !== null && <g><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" /><circle cx={x(hover)} cy={y(planned[hover] ?? 0)} r="4" fill="#94a3b8" stroke="#fff" strokeWidth="2" />{actual[hover] != null && <circle cx={x(hover)} cy={y(actual[hover]!)} r="4" fill="#2563eb" stroke="#fff" strokeWidth="2" />}</g>}
        </svg>
        {hover !== null && (
          <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <b>{mLabel(months[hover])}</b>
            <div><i style={{ background: '#94a3b8' }} />Planned: <b>{nf(planned[hover] ?? 0, digits)}{u}</b></div>
            <div><i style={{ background: '#2563eb' }} />Actual: <b>{actual[hover] == null ? '—' : `${nf(actual[hover]!, digits)}${u}`}</b></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- extensions of time ----------------
function Eots({ d, onChanged }: { d: Plan; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const scopes = [0, ...d.packages.filter((p) => p.active).map((p) => p.id)];
  const name = (id: number) => (id ? `${d.packages.find((p) => p.id === id)?.code} · ${d.packages.find((p) => p.id === id)?.name}` : 'Whole project');
  return (
    <section className="dsec">
      <div className="dsec-head">
        <div className="dsec-titles"><span className="dsec-ico"><Icon name="pencil" /></span><div><h3>Extensions of time</h3><div className="dsec-sub">The original completion date is kept; each extension moves the completion date and is listed here.</div></div></div>
        {d.can.plan && <button className="btn primary" onClick={() => setAdding(true)}>+ Record an extension</button>}
      </div>
      {scopes.map((sc) => {
        const s = d.summary.find((x) => x.package_id === sc)!;
        const list = d.eots.filter((e) => e.package_id === sc);
        if (sc && !list.length && !s.original_completion) return null;
        let prev = s.original_completion;
        return (
          <div key={sc} className="pj-eot">
            <div className="pj-eot-head"><b>{name(sc)}</b><span className="muted small">Original completion {fmtDate(s.original_completion)} · now {fmtDate(s.revised_completion)}{s.extension_days ? ` · ${s.extension_days} days added` : ''}</span></div>
            {list.length ? (
              <div className="table-wrap"><table className="grid">
                <thead><tr><th>Extension</th><th>Approved</th><th>New completion</th><th className="fig">Days added</th><th>Reason</th><th>Letter</th></tr></thead>
                <tbody>{list.map((e) => {
                  const add = prev ? days(prev, e.to_date) : null;
                  prev = e.to_date;
                  return <tr key={e.id}><td><b>{e.eot_no || '—'}</b><div className="muted small">by {e.by_name ?? '—'}</div></td><td>{fmtDate(e.approved_on)}</td><td>{fmtDate(e.to_date)}</td><td className="fig">{add == null ? '—' : add}</td><td>{e.reason}</td>
                    <td>{(e.files ?? []).map((f) => <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">{f.name}</a>)}</td></tr>;
                })}</tbody>
              </table></div>
            ) : <p className="muted small">No extension.</p>}
          </div>
        );
      })}
      {adding && <EotForm d={d} onClose={(ch) => { setAdding(false); if (ch) onChanged(); }} />}
    </section>
  );
}

function EotForm({ d, onClose }: { d: Plan; onClose: (changed: boolean) => void }) {
  const [f, setF] = useState({ package_id: 0, eot_no: '', approved_on: '', to_date: '', reason: '' });
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const s = d.summary.find((x) => x.package_id === f.package_id);
  const save = async () => {
    setMsg('');
    try { await api('/api/project/eots', { ...f, approved_on: f.approved_on || null, files }); onClose(true); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Modal title="Record an extension of time" onClose={() => onClose(false)}
      footer={<><span className="grow" /><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" disabled={!!busy} onClick={save}>Save</button></>}>
      <div className="two">
        <label className="field">For<select value={f.package_id} onChange={(e) => setF({ ...f, package_id: Number(e.target.value) })}><option value={0}>Whole project</option>{d.packages.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
        <label className="field">Extension number<input value={f.eot_no} onChange={(e) => setF({ ...f, eot_no: e.target.value })} placeholder="e.g. EOT-2" /></label>
        <label className="field">Approved on<input type="date" value={f.approved_on} onChange={(e) => setF({ ...f, approved_on: e.target.value })} /></label>
        <label className="field">New completion date<input type="date" value={f.to_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}>Reason<textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Monsoon; railway crossing permission pending" /></label>
      </div>
      <p className="muted small">Completion now: {fmtDate(s?.revised_completion)}{f.to_date && s?.revised_completion ? ` → ${fmtDate(f.to_date)} (${days(s.revised_completion, f.to_date)} days)` : ''}</p>
      <label className="btn">{busy || 'Attach the approval letter'}<input type="file" hidden accept=".pdf,image/*" onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { setMsg('The letter is larger than 10 MB.'); return; }
        setBusy('Uploading…');
        try { const u = await uploadFile(file, 'document', null); setFiles((x) => [...x, u]); } catch (er) { setMsg((er as Error).message); } finally { setBusy(''); }
      }} /></label>
      {files.map((x) => <div key={x.id} className="small">📎 {x.name}</div>)}
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}

// ---------------- plan: definition, packages, work programme, history ----------------
interface ImportResult { ok: boolean; errors: string[]; warnings: string[]; changes: { packages: { added: string[]; changed: string[] }; activities: { added: number; changed: number; removed: number }; targets: { months: number; packages: string[] } } }

function PlanView({ d, onChanged }: { d: Plan; onChanged: () => void }) {
  const [defOpen, setDefOpen] = useState(false);
  const [pkg, setPkg] = useState<Pkg | 'new' | null>(null);
  const [imp, setImp] = useState<{ file: File; r: ImportResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [hist, setHist] = useState<{ id: number; at: string; kind: string; ref: string; by_name: string | null }[]>([]);
  useEffect(() => { api<{ events: typeof hist }>('/api/project/plan/history').then((r) => setHist(r.events)).catch(() => {}); }, [d]);
  const send = async (file: File, apply: boolean, rebaseline = false) => {
    const res = await fetch(`/api/project/plan/import?apply=${apply ? 1 : 0}&rebaseline=${rebaseline ? 1 : 0}`, { method: 'POST', credentials: 'same-origin', body: file, headers: { 'content-type': 'application/octet-stream', 'x-wgl-request': '1' } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? `Upload failed (${res.status}).`);
    return j as ImportResult;
  };
  const KIND: Record<string, string> = { definition_saved: 'Project details saved', package_added: 'Package added', package_changed: 'Package changed', plan_imported: 'Work programme uploaded', activity_added: 'Line added', activity_changed: 'Line changed', activity_removed: 'Line removed', progress: 'Progress recorded', eot_added: 'Extension of time recorded' };
  return (
    <>
      <section className="dsec">
        <div className="dsec-head">
          <div className="dsec-titles"><span className="dsec-ico"><Icon name="compliance" /></span><div><h3>Work programme (Excel)</h3><div className="dsec-sub">Packages, timeline and monthly targets in one Excel file. Download it (with what is saved now), fill it in, upload it. You see the changes before they are saved.</div></div></div>
          <div className="row-btns">
            <a className="btn" href="/api/project/plan/workbook.xlsx">Download Excel</a>
            {d.can.plan && <label className={`btn primary ${busy ? 'disabled' : ''}`}>{busy ? 'Reading…' : 'Upload Excel'}<input type="file" hidden accept=".xlsx" disabled={busy} onChange={async (e) => {
              const file = e.target.files?.[0]; e.target.value = '';
              if (!file) return;
              setBusy(true); setMsg('');
              try { setImp({ file, r: await send(file, false) }); } catch (er) { setMsg((er as Error).message); } finally { setBusy(false); }
            }} /></label>}
          </div>
        </div>
        {msg && <p className="error">{msg}</p>}
      </section>
      <section className="dsec">
        <div className="dsec-head">
          <div className="dsec-titles"><span className="dsec-ico"><Icon name="info" /></span><div><h3>Project details</h3><div className="dsec-sub">Sanctions, cost, dates and scope</div></div></div>
          {d.can.plan && <button className="btn" onClick={() => setDefOpen(true)}>Change</button>}
        </div>
        <Definition d={d} bare />
      </section>
      <section className="dsec">
        <div className="dsec-head">
          <div className="dsec-titles"><span className="dsec-ico"><Icon name="works" /></span><div><h3>Packages</h3><div className="dsec-sub">Each contract package with its contractor, value, dates and wards. Leave empty for a single contract.</div></div></div>
          {d.can.plan && <button className="btn primary" onClick={() => setPkg('new')}>+ Add a package</button>}
        </div>
        {d.packages.length ? (
          <div className="table-wrap"><table className="grid">
            <thead><tr><th>Package</th><th>Contractor</th><th>Agreement</th><th className="fig">Value</th><th>Appointed</th><th>Completion</th><th>Wards</th></tr></thead>
            <tbody>{d.packages.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'retired'} onClick={() => d.can.plan && setPkg(p)}>
                <td><b>{p.code}</b> · {p.name}</td><td>{p.contractor || '—'}</td><td>{p.agreement_no || '—'}{p.agreement_date ? <div className="muted small">{fmtDate(p.agreement_date)}</div> : null}</td>
                <td className="fig">{cr(p.value_cr)}</td><td>{fmtDate(p.appointed_date)}</td><td>{fmtDate(p.original_completion)}</td><td className="small">{p.wards.join(', ') || '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">No packages: the whole project is one contract.</p>}
      </section>
      <section className="dsec">
        <div className="dsec-head"><div className="dsec-titles"><span className="dsec-ico"><Icon name="works" /></span><div><h3>Changes to the plan</h3><div className="dsec-sub">Who changed what, newest first</div></div></div></div>
        {hist.length ? <ul className="pj-list">{hist.slice(0, 30).map((h) => <li key={h.id}><span className="muted small">{fmtTime(h.at)}</span><span>{KIND[h.kind] ?? h.kind}{h.ref ? ` · ${h.ref}` : ''}</span><span className="muted small">{h.by_name ?? '—'}</span></li>)}</ul> : <p className="muted">No changes yet.</p>}
      </section>
      {defOpen && <DefinitionForm d={d} onClose={(ch) => { setDefOpen(false); if (ch) onChanged(); }} />}
      {pkg && <PackageForm p={pkg === 'new' ? null : pkg} onClose={(ch) => { setPkg(null); if (ch) onChanged(); }} />}
      {imp && <ImportPreview r={imp.r} onApply={async (rebase) => { await send(imp.file, true, rebase); setImp(null); onChanged(); }} onClose={() => setImp(null)} />}
    </>
  );
}

function ImportPreview({ r, onApply, onClose }: { r: ImportResult; onApply: (rebaseline: boolean) => Promise<void>; onClose: () => void }) {
  const [rebase, setRebase] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const c = r.changes;
  return (
    <Modal title={r.ok ? 'Work programme: what will change' : 'Work programme: please fix these first'} onClose={onClose}
      footer={<><span className="grow" /><button className="btn" onClick={onClose}>{r.ok ? 'Cancel' : 'Close'}</button>{r.ok && <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await onApply(rebase); } catch (e) { setMsg((e as Error).message); setBusy(false); } }}>{busy ? 'Saving…' : 'Save these changes'}</button>}</>}>
      {r.ok ? (
        <ul className="pj-changes">
          <li><b>Packages:</b> {c.packages.added.length} new{c.packages.added.length ? ` (${c.packages.added.join(', ')})` : ''}, {c.packages.changed.length} changed{c.packages.changed.length ? ` (${c.packages.changed.join(', ')})` : ''}</li>
          <li><b>Timeline:</b> {c.activities.added} new lines, {c.activities.changed} changed, {c.activities.removed} removed (no longer in the file)</li>
          <li><b>Monthly targets:</b> {c.targets.months} months{c.targets.packages.length ? ` for ${c.targets.packages.join(', ')}` : ''} (replace the targets saved for these)</li>
        </ul>
      ) : <><p>Nothing was saved. Correct these rows in Excel and upload again:</p><ul className="err-list">{r.errors.slice(0, 40).map((e) => <li key={e}>{e}</li>)}</ul>{r.errors.length > 40 && <p className="small">… and {r.errors.length - 40} more</p>}</>}
      {r.warnings.length > 0 && <><p className="small">To check:</p><ul className="warn-list">{r.warnings.slice(0, 20).map((w) => <li key={w}>{w}</li>)}</ul></>}
      {r.ok && <label className="check-row"><input type="checkbox" checked={rebase} onChange={(e) => setRebase(e.target.checked)} /> Make these dates the new original plan (baseline). Normally leave this off, so slippage stays visible.</label>}
      {r.ok && <p className="muted small">Actual dates and % done already recorded are kept.</p>}
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}

function DefinitionForm({ d, onClose }: { d: Plan; onClose: (changed: boolean) => void }) {
  const st = d.settings as Record<string, unknown>;
  const sc = (st.scope ?? {}) as Record<string, number | null>;
  const s = (k: string) => (st[k] == null ? '' : String(st[k]));
  const [f, setF] = useState({ name: d.settings.name, work_start: d.settings.work_start ?? '', completion: d.settings.completion ?? '', scheme: s('scheme'), description: s('description'), as_no: s('as_no'), as_date: s('as_date'), ts_no: s('ts_no'), ts_date: s('ts_date'),
    sanctioned_cost_cr: s('sanctioned_cost_cr'), dlp_months: s('dlp_months'), pipe_km: String(sc.pipe_km ?? ''), manholes: String(sc.manholes ?? ''), ics: String(sc.ics ?? ''), road_km: String(sc.road_km ?? ''), pumping_stations: String(sc.pumping_stations ?? ''), stp_mld: String(sc.stp_mld ?? '') });
  const [msg, setMsg] = useState('');
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  const save = async () => {
    setMsg('');
    try {
      await api('/api/project/definition', {
        name: f.name, work_start: f.work_start || null, completion: f.completion || null, scheme: f.scheme, description: f.description, as_no: f.as_no, as_date: f.as_date || null, ts_no: f.ts_no, ts_date: f.ts_date || null,
        sanctioned_cost_cr: n(f.sanctioned_cost_cr), dlp_months: n(f.dlp_months),
        scope: { pipe_km: n(f.pipe_km), manholes: n(f.manholes), ics: n(f.ics), road_km: n(f.road_km), pumping_stations: n(f.pumping_stations), stp_mld: n(f.stp_mld) },
      });
      onClose(true);
    } catch (e) { setMsg((e as Error).message); }
  };
  const inp = (k: keyof typeof f, label: string, type = 'text') => <label className="field">{label}<input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <Modal title="Project details" size="large" onClose={() => onClose(false)}
      footer={<><span className="grow" /><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="two">
        {inp('name', 'Project name')}{inp('scheme', 'Scheme / funding (e.g. AMRUT 2.0)')}
        {inp('work_start', 'Work start', 'date')}{inp('completion', 'Completion (original agreement)', 'date')}
        {inp('as_no', 'Administrative sanction no.')}{inp('as_date', 'Administrative sanction date', 'date')}
        {inp('ts_no', 'Technical sanction no.')}{inp('ts_date', 'Technical sanction date', 'date')}
        {inp('sanctioned_cost_cr', 'Sanctioned cost (₹ crore)', 'number')}{inp('dlp_months', 'Defect liability (months)', 'number')}
        <label className="field" style={{ gridColumn: '1 / -1' }}>Description<textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      </div>
      <h4>Scope</h4>
      <div className="two">
        {inp('pipe_km', 'Sewer network (km)', 'number')}{inp('manholes', 'Manholes', 'number')}{inp('ics', 'House connections', 'number')}{inp('road_km', 'Road restoration (km)', 'number')}{inp('pumping_stations', 'Pumping stations', 'number')}{inp('stp_mld', 'STP capacity (MLD)', 'number')}
      </div>
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}

function PackageForm({ p, onClose }: { p: Pkg | null; onClose: (changed: boolean) => void }) {
  const [f, setF] = useState({ code: p?.code ?? '', name: p?.name ?? '', contractor: p?.contractor ?? '', agreement_no: p?.agreement_no ?? '', agreement_date: p?.agreement_date ?? '', appointed_date: p?.appointed_date ?? '', original_completion: p?.original_completion ?? '', value_cr: p?.value_cr == null ? '' : String(p.value_cr), wards: (p?.wards ?? []).join(', '), active: p?.active ?? true });
  const [msg, setMsg] = useState('');
  const save = async () => {
    setMsg('');
    try {
      await api('/api/project/packages', { ...(p ? { id: p.id } : {}), code: f.code, name: f.name, contractor: f.contractor, agreement_no: f.agreement_no, agreement_date: f.agreement_date || null, appointed_date: f.appointed_date || null,
        original_completion: f.original_completion || null, value_cr: f.value_cr.trim() ? Number(f.value_cr) : null, wards: f.wards.split(/[,\s]+/).map(Number).filter((x) => Number.isInteger(x) && x > 0), active: f.active });
      onClose(true);
    } catch (e) { setMsg((e as Error).message); }
  };
  const inp = (k: keyof typeof f, label: string, type = 'text') => <label className="field">{label}<input type={type} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <Modal title={p ? `Package ${p.code}` : 'Add a package'} onClose={() => onClose(false)}
      footer={<><span className="grow" /><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="two">
        {inp('code', 'Code (e.g. PKG-1)')}{inp('name', 'Name')}{inp('contractor', 'Contractor')}{inp('agreement_no', 'Agreement no.')}
        {inp('agreement_date', 'Agreement date', 'date')}{inp('appointed_date', 'Appointed date (work start)', 'date')}{inp('original_completion', 'Completion (as per agreement)', 'date')}{inp('value_cr', 'Contract value (₹ crore)', 'number')}
        <label className="field" style={{ gridColumn: '1 / -1' }}>Wards (progress in these wards counts for this package)<input value={f.wards} onChange={(e) => setF({ ...f, wards: e.target.value })} placeholder="e.g. 1, 2, 3, 15" /></label>
      </div>
      {p && <label className="check-row"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In use</label>}
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}
