/**
 * Daily log screens.
 *  DailyTab: on a work stretch's card, today's entry (phone-friendly) and the stretch's past entries.
 *  DailyPage: the Daily log tab: entries to verify, my entries, and reports (a day, a week, a month) with Excel and print.
 */
import { useEffect, useMemo, useState } from 'react';
import { DAILY_STATUS, EMPTY_QUANTITIES, HINDRANCES, LABOUR, MACHINES, pipeTotal, QUANTITY_FIELDS, type DailyQuantities } from 'shared';
import { api } from '../api.ts';
import { Icon } from '../ui.tsx';
import { KpiCard, Meter, nf, STATUS } from '../charts.tsx';
import { allowed } from '../perm.ts';
import { QuickPhotos } from './CardParts.tsx';
import { fmtDate, fmtTime, useGps, type Uploaded } from './util.tsx';

interface Entry {
  id: number; stretch_code: string; road_name?: string; ward?: number; log_date: string; quantities: DailyQuantities;
  labour: Record<string, number>; machines: Record<string, number>; hindrances: { reason: string; hours: number; note: string }[];
  remark: string; photos: string[]; status: 'submitted' | 'accepted' | 'returned'; late: boolean; submitted_by: string; submitted_by_name: string | null;
  submitted_at: string; decided_by_name: string | null; decided_at: string | null; decision_note: string; status_note: string;
}
type Totals = { excavation_m: number; pipe_m: number; bedding_m: number; manholes: number; ics: number; backfill_m: number; road_m: number };

const chip = (s: Entry['status']) => (s === 'accepted' ? 'ok' : s === 'returned' ? 'bad' : 'wait');
const stLabel = (s: Entry['status']) => DAILY_STATUS.find((x) => x.key === s)!.label;
const hLabel = (k: string) => HINDRANCES.find((h) => h.key === k)?.label ?? k;
const mLabel = (k: string) => MACHINES.find((m) => m.key === k)?.label ?? k;

/** One line saying what was done. */
function workLine(q: DailyQuantities) {
  const parts: string[] = [];
  const p = pipeTotal(q);
  if (p) parts.push(`${nf(p, 1)} m pipe${Object.keys(q.pipe).length > 1 ? ` (${Object.entries(q.pipe).filter(([, v]) => v).map(([d, v]) => `${d} mm ${nf(v, 1)}`).join(', ')})` : ''}`);
  const say: Record<string, [string, string]> = {
    excavation_m: ['m trench excavated', 'm trench excavated'], bedding_m: ['m bedding', 'm bedding'], manholes: ['manhole built', 'manholes built'],
    ics: ['house connection', 'house connections'], backfill_m: ['m back-filled', 'm back-filled'], road_m: ['m road restored', 'm road restored'],
  };
  for (const f of QUANTITY_FIELDS) { const v = Number(q[f.key as keyof DailyQuantities]) || 0; if (v) parts.push(`${nf(v, 1)} ${say[f.key][v === 1 ? 0 : 1]}`); }
  return parts.join(' · ') || 'No quantities';
}
const people = (l: Record<string, number>) => Object.values(l ?? {}).reduce((a, b) => a + (+b || 0), 0);

// ---------------- on the work stretch card ----------------
export function DailyTab({ code, meId, onChanged }: { code: string; meId: string; onChanged: () => void }) {
  const [d, setD] = useState<{ entries: Entry[]; totals: Totals; length_m: number; diameters: string[]; today: string; can: { submit: boolean; verify: boolean } } | null>(null);
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState<string | null>(null);
  useEffect(() => { api<typeof d>(`/api/stretches/${code}/daily`).then(setD); }, [code, tick]);
  if (!d) return <p className="muted">Loading…</p>;
  const reload = () => { setTick((t) => t + 1); onChanged(); };
  const todays = d.entries.find((e) => e.log_date === d.today);
  const pct = d.length_m ? Math.min(100, (d.totals.pipe_m / d.length_m) * 100) : 0;
  return (
    <div className="daily">
      <div className="daily-tot">
        <Meter label="Pipe laid (accepted daily logs)" value={d.totals.pipe_m} target={d.length_m} unit=" m" digits={1} />
        <div className="small muted">{nf(d.totals.manholes)} manholes · {nf(d.totals.ics)} house connections · {nf(d.totals.road_m, 1)} m road restored · {pct >= 98 ? 'pipe line complete' : `${nf(Math.max(0, d.length_m - d.totals.pipe_m), 1)} m to go`}</div>
      </div>
      {d.can.submit && !edit && (
        <div className="row-btns">
          <button className="btn primary" onClick={() => setEdit(d.today)}>{todays ? (todays.status === 'accepted' ? 'Today’s log is accepted' : 'Change today’s log') : '+ Today’s log'}</button>
          <button className="btn" onClick={() => setEdit('')}>A past day</button>
        </div>
      )}
      {edit !== null && <EntryForm code={code} date={edit} today={d.today} diameters={d.diameters} existing={d.entries} onDone={(ch) => { setEdit(null); if (ch) reload(); }} />}
      <h4>Entries</h4>
      {d.entries.length ? d.entries.map((e) => <EntryCard key={e.id} e={e} canVerify={d.can.verify && (e.submitted_by !== meId || allowed('compliance.verify_own'))} onChanged={reload} onEdit={d.can.submit && e.status !== 'accepted' ? () => setEdit(e.log_date) : undefined} />) : <p className="muted">No daily log yet.</p>}
    </div>
  );
}

function EntryForm({ code, date, today, diameters, existing, onDone }: { code: string; date: string; today: string; diameters: string[]; existing: Entry[]; onDone: (changed: boolean) => void }) {
  const [day, setDay] = useState(date || today);
  const was = existing.find((e) => e.log_date === day);
  const blank = () => ({ q: { ...EMPTY_QUANTITIES, pipe: {} as Record<string, number> }, labour: {} as Record<string, number>, machines: {} as Record<string, number>, hind: [] as Entry['hindrances'], remark: '', photos: [] as Uploaded[] });
  const [f, setF] = useState(blank);
  useEffect(() => {
    setF(was ? { q: { ...EMPTY_QUANTITIES, ...was.quantities }, labour: { ...was.labour }, machines: { ...was.machines }, hind: [...(was.hindrances ?? [])], remark: was.remark, photos: (was.photos ?? []).map((id) => ({ id, name: '', kind: 'photo' as const })) } : blank());
  }, [day, was?.id]);
  const { gps, state: gpsState } = useGps(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const locked = was?.status === 'accepted';
  const num = (v: string) => (v === '' ? 0 : Math.max(0, Number(v)));
  const setQ = (k: string, v: string) => setF({ ...f, q: { ...f.q, [k]: num(v) } });
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      await api(`/api/stretches/${code}/daily`, { log_date: day, quantities: f.q, labour: f.labour, machines: f.machines, hindrances: f.hind.filter((h) => h.hours > 0), remark: f.remark, photos: f.photos.map((p) => p.id), gps });
      onDone(true);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="daily-form">
      <div className="daily-form-head">
        <label className="field">Date<input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} /></label>
        {was && <span className={`pchip ${chip(was.status)}`}>{stLabel(was.status)}</span>}
        {was?.status === 'returned' && was.decision_note && <span className="warn small">Returned: {was.decision_note}</span>}
      </div>
      {locked ? <p className="muted">This day’s log is accepted and can no longer be changed.</p> : (<>
        <h4>Work done today</h4>
        <div className="daily-grid">
          {diameters.map((dia) => (
            <label key={dia} className="field">Pipe laid, {dia} mm (m)
              <input type="number" inputMode="decimal" min={0} value={f.q.pipe[dia] || ''} onChange={(e) => setF({ ...f, q: { ...f.q, pipe: { ...f.q.pipe, [dia]: num(e.target.value) } } })} /></label>
          ))}
          {QUANTITY_FIELDS.map((q) => (
            <label key={q.key} className="field">{q.label}{q.unit ? ` (${q.unit})` : ''}
              <input type="number" inputMode="decimal" min={0} value={(f.q[q.key as keyof DailyQuantities] as number) || ''} onChange={(e) => setQ(q.key, e.target.value)} /></label>
          ))}
        </div>
        <h4>On site</h4>
        <div className="daily-grid">
          {LABOUR.map((l) => <label key={l.key} className="field">{l.label} workers<input type="number" inputMode="numeric" min={0} value={f.labour[l.key] || ''} onChange={(e) => setF({ ...f, labour: { ...f.labour, [l.key]: num(e.target.value) } })} /></label>)}
          {MACHINES.map((m) => <label key={m.key} className="field">{m.label}<input type="number" inputMode="numeric" min={0} value={f.machines[m.key] || ''} onChange={(e) => setF({ ...f, machines: { ...f.machines, [m.key]: num(e.target.value) } })} /></label>)}
        </div>
        <h4>Time lost</h4>
        {f.hind.map((h, i) => (
          <div key={i} className="daily-hind">
            <select value={h.reason} onChange={(e) => setF({ ...f, hind: f.hind.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)) })}>{HINDRANCES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
            <input type="number" inputMode="decimal" min={0} max={24} placeholder="Hours" value={h.hours || ''} onChange={(e) => setF({ ...f, hind: f.hind.map((x, j) => (j === i ? { ...x, hours: Math.min(24, num(e.target.value)) } : x)) })} />
            <input placeholder="Note (optional)" value={h.note} onChange={(e) => setF({ ...f, hind: f.hind.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} />
            <button className="icon-btn" aria-label="Remove" onClick={() => setF({ ...f, hind: f.hind.filter((_, j) => j !== i) })}><Icon name="close" /></button>
          </div>
        ))}
        <button className="link" onClick={() => setF({ ...f, hind: [...f.hind, { reason: 'rain', hours: 0, note: '' }] })}>+ Add time lost</button>
        <label className="field">Remarks<textarea rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} placeholder="e.g. Rock found at 1.5 m near MH-12" /></label>
        <QuickPhotos photos={f.photos} setPhotos={(p) => setF({ ...f, photos: p })} gps={gps} gpsState={gpsState} />
        {msg && <p className="error">{msg}</p>}
        <p className="muted small">The AEE checks the entry. When accepted, the work stretch’s status moves to the running totals.</p>
      </>)}
      <div className="row-btns">
        <button className="btn" onClick={() => onDone(false)}>{locked ? 'Close' : 'Cancel'}</button>
        {!locked && <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : was ? 'Submit again' : 'Submit'}</button>}
      </div>
    </div>
  );
}

function EntryCard({ e, canVerify, onChanged, onEdit, showStretch }: { e: Entry; canVerify: boolean; onChanged: () => void; onEdit?: () => void; showStretch?: boolean }) {
  const [mode, setMode] = useState<'' | 'return' | 'override'>('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'accept' | 'return', override?: string) => {
    setBusy(true); setMsg('');
    try {
      await api(`/api/daily/${e.id}/decide`, { decision, note, ...(override ? { override_reason: override } : {}) });
      onChanged();
    } catch (x) {
      const m = (x as Error).message;
      setMsg(m);
      if (/override/i.test(m) && allowed('override')) setMode('override');
    } finally { setBusy(false); }
  };
  const hours = (e.hindrances ?? []).reduce((a, h) => a + (+h.hours || 0), 0);
  return (
    <div className={`daily-entry st-${e.status}`}>
      <div className="daily-entry-head">
        <b>{fmtDate(e.log_date)}</b>
        {showStretch && <span><b>{e.stretch_code}</b> {e.road_name}{e.ward ? ` · Ward ${e.ward}` : ''}</span>}
        <span className={`pchip ${chip(e.status)}`}>{stLabel(e.status)}</span>
        {e.late && <span className="pchip due">Late entry</span>}
      </div>
      <div>{workLine(e.quantities)}</div>
      <div className="small muted">
        {people(e.labour)} people{Object.entries(e.machines ?? {}).filter(([, v]) => v).length ? ` · ${Object.entries(e.machines).filter(([, v]) => v).map(([k, v]) => `${v} ${mLabel(k)}`).join(', ')}` : ''}
        {hours ? ` · ${nf(hours, 1)} h lost (${(e.hindrances ?? []).map((h) => hLabel(h.reason).toLowerCase()).join(', ')})` : ''}
      </div>
      {e.remark && <div className="small">“{e.remark}”</div>}
      {(e.photos ?? []).length > 0 && <div className="daily-photos">{e.photos.map((p) => <a key={p} href={`/api/files/${p}`} target="_blank" rel="noreferrer"><img src={`/api/files/${p}`} alt="Site photo" /></a>)}</div>}
      <div className="small muted">By {e.submitted_by_name ?? '—'}, {fmtTime(e.submitted_at)}{e.decided_at ? ` · ${e.status === 'accepted' ? 'accepted' : 'returned'} by ${e.decided_by_name ?? '—'}, ${fmtTime(e.decided_at)}` : ''}</div>
      {e.decision_note && <div className={e.status === 'returned' ? 'warn small' : 'small'}>Note: {e.decision_note}</div>}
      {e.status_note && <div className="small muted">{e.status_note}</div>}
      {msg && <p className="error small">{msg}</p>}
      <div className="row-btns">
        {onEdit && <button className="btn ghost" onClick={onEdit}>{e.status === 'returned' ? 'Correct and submit again' : 'Change'}</button>}
        {canVerify && e.status === 'submitted' && !mode && (<>
          <button className="btn primary" disabled={busy} onClick={() => decide('accept')}>Accept</button>
          <button className="btn" disabled={busy} onClick={() => setMode('return')}>Return…</button>
        </>)}
      </div>
      {mode === 'return' && (
        <div className="daily-decide">
          <input placeholder="What needs correcting?" value={note} onChange={(x) => setNote(x.target.value)} />
          <button className="btn" onClick={() => setMode('')}>Cancel</button>
          <button className="btn primary" disabled={busy || !note.trim()} onClick={() => decide('return')}>Return</button>
        </div>
      )}
      {mode === 'override' && (
        <div className="daily-decide">
          <input placeholder="Reason for overriding the compliance gate" value={note} onChange={(x) => setNote(x.target.value)} />
          <button className="btn" onClick={() => { setMode(''); setMsg(''); }}>Cancel</button>
          <button className="btn primary" disabled={busy || note.trim().length < 5} onClick={() => decide('accept', note)}>Accept with override</button>
        </div>
      )}
    </div>
  );
}

// ---------------- the Daily log tab ----------------
type View = 'verify' | 'mine' | 'report';

export function DailyPage({ initialView, onOpenStretch, mode = 'all' }: { initialView?: string; onOpenStretch: (code: string) => void; mode?: 'all' | 'entries' | 'reports' }) {
  const canVerify = allowed('daily.verify');
  const canSubmit = allowed('daily.submit');
  const views: [View, string, string][] = [
    ...(canVerify ? [['verify', 'To verify', 'check'] as [View, string, string]] : []),
    ...(canSubmit ? [['mine', 'My entries', 'pencil'] as [View, string, string]] : []),
    ...(mode === 'all' ? [['report', 'Reports', 'dashboard'] as [View, string, string]] : []),
  ];
  const [view, setView] = useState<View>((initialView as View) || views[0]?.[0] || 'report');
  if (mode === 'reports') return <div className="page dash daily-page"><Report /></div>;
  if (!views.length) return <div className="page"><p className="muted">Daily logs are entered on each work stretch (open it → Daily log). Reports are under Reports → Daily reports.</p></div>;
  return (
    <div className="page dash daily-page">
      <div className="dash-hero no-print">
        <div className="dash-hero-text">
          <span className="dash-kicker">Daily log</span>
          <h2>Work done each day, checked and reported</h2>
          <span className="dash-asof">Site staff enter the day’s work on the work stretch (card → Daily log). The AEE / DEE accepts it; accepted work updates the status and the reports.</span>
        </div>
      </div>
      <nav className="dash-tabs no-print">{views.map(([k, l, ic]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}><Icon name={ic} />{l}</button>)}</nav>
      {view === 'verify' && <Queue mine={false} onOpenStretch={onOpenStretch} />}
      {view === 'mine' && <Queue mine onOpenStretch={onOpenStretch} />}
      {view === 'report' && <Report />}
    </div>
  );
}

function Queue({ mine, onOpenStretch }: { mine: boolean; onOpenStretch: (c: string) => void }) {
  const [d, setD] = useState<{ entries: (Entry & { road_name: string; ward: number })[] } | null>(null);
  const [tick, setTick] = useState(0);
  const [show, setShow] = useState<'open' | 'all'>('open');
  useEffect(() => { api<typeof d>(`/api/daily/queue${mine ? '?view=mine' : ''}`).then(setD); }, [mine, tick]);
  if (!d) return <p className="muted">Loading…</p>;
  const list = mine && show === 'open' ? d.entries.filter((e) => e.status !== 'accepted') : d.entries;
  return (
    <section className="dsec">
      <div className="dsec-head">
        <div className="dsec-titles"><span className="dsec-ico"><Icon name={mine ? 'pencil' : 'check'} /></span><div>
          <h3>{mine ? 'My entries' : 'Waiting for your verification'}</h3>
          <div className="dsec-sub">{mine ? 'Returned entries need correcting: open the work stretch and submit again.' : 'Accept to count the work, or return it with what needs correcting. You cannot verify your own entries.'}</div>
        </div></div>
        {mine && <div className="seg"><button className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>Not yet accepted</button><button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All</button></div>}
      </div>
      {list.length ? list.map((e) => (
        <div key={e.id}>
          <EntryCard e={e} showStretch canVerify={!mine} onChanged={() => setTick((t) => t + 1)} />
          <button className="link small" onClick={() => onOpenStretch(e.stretch_code)}>Open work stretch {e.stretch_code}</button>
        </div>
      )) : <p className="muted">{mine ? 'Nothing here.' : 'Nothing waiting. All daily logs in your area are checked.'}</p>}
    </section>
  );
}

interface Rep {
  from: string; to: string; upto: string; totals: Totals; pending: Totals & { entries: number }; returned: number; entries: number; stretches_worked: number;
  labour: Record<string, number>; machines: Record<string, number>; hindrance_hours: Record<string, number>; hindrance_total: number;
  planned: { pipe_m: number; manholes: number; ics: number; road_m: number };
  context: { issues_opened: number; issues_resolved: number; grievances_received: number; grievances_resolved: number; compliance_records: number };
  rows: { code: string; name: string; ward: number; length_m: number; period: Totals; todate: Totals; pct: number; pending: number; hindrance_hours: number; labour: number; remarks: string[] }[];
  series: (Totals & { date: string })[]; photos: { id: string; code: string; date: string }[];
}

function Report() {
  const today = useMemo(() => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), []);
  const [kind, setKind] = useState<'day' | 'week' | 'month' | 'custom'>('day');
  const [date, setDate] = useState(today);
  const [custom, setCustom] = useState({ from: today, to: today });
  const [pkg, setPkg] = useState(0);
  const [pkgs, setPkgs] = useState<{ id: number; code: string; name: string; active: boolean }[]>([]);
  const [r, setR] = useState<Rep | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<{ packages: typeof pkgs }>('/api/project/plan').then((p) => setPkgs(p.packages.filter((x) => x.active))).catch(() => {}); }, []);
  const range = useMemo(() => {
    if (kind === 'custom') return custom;
    if (kind === 'day') return { from: date, to: date };
    const d = new Date(`${date}T00:00:00Z`);
    if (kind === 'week') { const dow = (d.getUTCDay() + 6) % 7; const s = new Date(d.getTime() - dow * 864e5); return { from: s.toISOString().slice(0, 10), to: new Date(s.getTime() + 6 * 864e5).toISOString().slice(0, 10) }; }
    const s = date.slice(0, 7) + '-01'; const e = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).toISOString().slice(0, 10);
    return { from: s, to: e };
  }, [kind, date, custom]);
  const qs = `from=${range.from}&to=${range.to}&package=${pkg}`;
  useEffect(() => { setR(null); setErr(''); api<Rep>(`/api/daily/report?${qs}`).then(setR).catch((e) => setErr((e as Error).message)); }, [qs]);
  const pkgName = pkg ? pkgs.find((p) => p.id === pkg) : null;
  const title = `${kind === 'day' ? 'Daily progress report' : kind === 'week' ? 'Weekly progress report' : kind === 'month' ? 'Monthly progress report' : 'Progress report'} · ${pkgName ? `${pkgName.code} ${pkgName.name}` : 'Whole project'}`;
  const period = range.from === range.to ? fmtDate(range.from) : `${fmtDate(range.from)} – ${fmtDate(range.to)}`;
  const maxDay = r ? Math.max(1, ...r.series.map((s) => s.pipe_m)) : 1;
  return (
    <>
      <section className="dsec no-print">
        <div className="daily-rep-bar">
          <div className="seg">{(['day', 'week', 'month', 'custom'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'day' ? 'Day' : k === 'week' ? 'Week' : k === 'month' ? 'Month' : 'Dates'}</button>)}</div>
          {kind === 'custom' ? (<>
            <label className="field">From<input type="date" value={custom.from} max={today} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
            <label className="field">To<input type="date" value={custom.to} max={today} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
          </>) : <label className="field">{kind === 'day' ? 'Date' : kind === 'week' ? 'Any day in the week' : 'Any day in the month'}<input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>}
          {pkgs.length > 0 && <label className="field">Package<select value={pkg} onChange={(e) => setPkg(Number(e.target.value))}><option value={0}>Whole project</option>{pkgs.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>}
          <span className="grow" />
          <a className="btn" href={`/api/daily/report?${qs}&format=xlsx`} download>Excel</a>
          <button className="btn primary" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </section>
      {err && <p className="error">{err}</p>}
      {!r ? !err && <p className="muted">Loading…</p> : (
        <div className="daily-report">
          <div className="print-head"><h2>{title}</h2><div>{period} · printed {fmtTime(new Date().toISOString())}</div></div>
          <h3 className="screen-only">{title} <span className="muted">· {period}</span></h3>
          <div className="kpi-row">
            <KpiCard label="Sewer pipe laid" value={nf(r.totals.pipe_m, 1)} unit=" m" note={r.planned.pipe_m ? `Planned ${nf(r.planned.pipe_m)} m${r.upto < r.to ? ` up to ${fmtDate(r.upto)}` : ''}` : 'No target for this period'}
              status={r.planned.pipe_m ? (r.totals.pipe_m >= r.planned.pipe_m * 0.95 ? 'good' : r.totals.pipe_m >= r.planned.pipe_m * 0.7 ? 'watch' : 'bad') : undefined}
              statusText={r.planned.pipe_m ? `${nf((r.totals.pipe_m / r.planned.pipe_m) * 100)}% of plan` : undefined} />
            <KpiCard label="Manholes built" value={nf(r.totals.manholes)} note={r.planned.manholes ? `Planned ${nf(r.planned.manholes)}` : undefined} />
            <KpiCard label="House connections" value={nf(r.totals.ics)} note={r.planned.ics ? `Planned ${nf(r.planned.ics)}` : undefined} />
            <KpiCard label="Road restored" value={nf(r.totals.road_m, 1)} unit=" m" />
            <KpiCard label="Labour" value={nf(people(r.labour))} unit=" person-days" note={`${r.stretches_worked} work stretches · ${r.entries} entries`} />
            <KpiCard label="Time lost" value={nf(r.hindrance_total, 1)} unit=" h" status={r.hindrance_total ? 'watch' : undefined} statusText={r.hindrance_total ? 'See reasons below' : undefined} />
          </div>
          {(r.pending.entries > 0 || r.returned > 0) && <p className="warn small">Not counted yet: {r.pending.entries} entr{r.pending.entries === 1 ? 'y' : 'ies'} waiting for verification ({nf(r.pending.pipe_m, 1)} m pipe){r.returned ? `, ${r.returned} returned for correction` : ''}.</p>}
          {r.series.length > 1 && (
            <section className="dsec">
              <h3>Pipe laid each day</h3>
              <div className="daily-bars">{r.series.map((s) => <div key={s.date} title={`${fmtDate(s.date)}: ${nf(s.pipe_m, 1)} m`}><span style={{ height: `${(s.pipe_m / maxDay) * 100}%` }} /><i>{s.date.slice(8)}</i></div>)}</div>
            </section>
          )}
          <section className="dsec">
            <h3>Work stretches</h3>
            {r.rows.length ? (
              <div className="table-wrap"><table className="grid">
                <thead><tr><th>Work stretch</th><th className="fig">Pipe (m)</th><th className="fig">Manholes</th><th className="fig">ICs</th><th className="fig">Road (m)</th><th className="fig">Laid to date</th><th className="fig">People</th><th className="fig">Lost (h)</th><th>Remarks</th></tr></thead>
                <tbody>{r.rows.map((x) => (
                  <tr key={x.code}><td><b>{x.code}</b> {x.name}<div className="muted small">Ward {x.ward}{x.pending ? ` · ${x.pending} waiting` : ''}</div></td>
                    <td className="fig">{nf(x.period.pipe_m, 1)}</td><td className="fig">{nf(x.period.manholes)}</td><td className="fig">{nf(x.period.ics)}</td><td className="fig">{nf(x.period.road_m, 1)}</td>
                    <td className="fig">{nf(x.todate.pipe_m, 1)} / {nf(x.length_m)} m ({nf(x.pct)}%)</td><td className="fig">{nf(x.labour)}</td><td className="fig">{nf(x.hindrance_hours, 1)}</td>
                    <td className="small">{x.remarks.join(' · ')}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <p className="muted">No accepted daily log in this period.</p>}
          </section>
          <div className="pj-two">
            <section className="dsec">
              <h3>Time lost, by reason</h3>
              {r.hindrance_total ? <ul className="pj-list">{HINDRANCES.filter((h) => r.hindrance_hours[h.key]).map((h) => <li key={h.key}><span className="pchip due">{nf(r.hindrance_hours[h.key], 1)} h</span><span>{h.label}</span><span /></li>)}</ul> : <p className="muted">None recorded.</p>}
              <h3>Machines (machine-days)</h3>
              {Object.values(r.machines).some((v) => v) ? <ul className="pj-list">{MACHINES.filter((m) => r.machines[m.key]).map((m) => <li key={m.key}><span className="pchip none">{nf(r.machines[m.key])}</span><span>{m.label}</span><span /></li>)}</ul> : <p className="muted">None recorded.</p>}
            </section>
            <section className="dsec">
              <h3>Also in this period</h3>
              <ul className="pj-list">
                <li><span className="pchip none">{r.context.compliance_records}</span><span>Compliance records made</span><span /></li>
                <li><span className="pchip none">{r.context.issues_opened} / {r.context.issues_resolved}</span><span>Issues opened / resolved</span><span /></li>
                <li><span className="pchip none">{r.context.grievances_received} / {r.context.grievances_resolved}</span><span>Citizen grievances received / resolved</span><span /></li>
              </ul>
              {r.planned.pipe_m > 0 && <Meter label="Pipe laid against the plan for this period" value={r.totals.pipe_m} target={r.planned.pipe_m} unit=" m" color={r.totals.pipe_m >= r.planned.pipe_m * 0.95 ? STATUS.good : STATUS.bad} />}
            </section>
          </div>
          {r.photos.length > 0 && (
            <section className="dsec">
              <h3>Site photos</h3>
              <div className="daily-photos big">{r.photos.map((p) => <figure key={p.id}><img src={`/api/files/${p.id}`} alt={`Site photo, ${p.code}`} /><figcaption>{p.code} · {fmtDate(p.date)}</figcaption></figure>)}</div>
            </section>
          )}
          <p className="muted small">Counts only daily log entries accepted by the AEE / DEE. Planned figures come from the monthly targets in Project → Plan.</p>
        </div>
      )}
    </>
  );
}
