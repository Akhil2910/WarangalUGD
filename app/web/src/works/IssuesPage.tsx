/** Issues: table (sort by any column, remembered) and board; filters; CSV for Excel; detail with actions. */
import { useEffect, useState } from 'react';
import { ISSUE_KINDS, ISSUE_STATUS, SEVERITY_COLOR, type Severity } from 'shared';
import { Insights } from './Insights.tsx';
import { api } from '../api.ts';
import { PhotoPicker } from './StretchCard.tsx';
import { fmtDate, fmtTime, useGps, type Uploaded } from './util.tsx';

export interface IssueRow {
  id: number; code: string; kind: string; kind_label: string; source: string; stretch_code: string | null; ward: number; admin_zone: string;
  count: number; severity: Severity; status: string; title: string; remark: string; photos: string[]; assignee: string | null;
  assignee_name: string | null; due_date: string | null; overdue: boolean; created_at: string; created_by_name: string | null;
  resolved_at: string | null; resolved_by_name: string | null; resolution_note: string; resolution_photos: string[]; lon: number; lat: number;
}

const SORT_KEY = 'wgl.issues.sort';
const FILTER0 = { kind: '', zone: '', ward: '', severity: '', status: 'active', overdue: '', assignee: '', q: '' };

function loadSort(): { sort: string; dir: string } {
  try {
    return JSON.parse(localStorage.getItem(SORT_KEY) ?? '') as { sort: string; dir: string };
  } catch {
    return { sort: 'created_at', dir: 'desc' };
  }
}

export function IssuesPage({ zones, onOpenStretch, onGoTo, refreshKey, onChanged, isCommissioner }: {
  zones: { id: string }[]; onOpenStretch: (code: string) => void; onGoTo: (lon: number, lat: number) => void; refreshKey: number; onChanged: () => void; isCommissioner: boolean;
}) {
  const [f, setF] = useState(FILTER0);
  const [sort, setSort] = useState(loadSort);
  const [view, setView] = useState<'table' | 'board'>('table');
  const [data, setData] = useState<{ total: number; rows: IssueRow[]; counts: { status: string; severity: string; n: number; overdue: number }[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const qs = () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    p.set('sort', sort.sort);
    p.set('dir', sort.dir);
    return p;
  };
  useEffect(() => {
    const p = qs();
    p.set('limit', '500');
    const t = setTimeout(() => api<typeof data>(`/api/issues?${p}`).then(setData).catch((e) => setMsg((e as Error).message)), f.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [f, sort, tick, refreshKey]);
  const setSortBy = (k: string) => {
    const s = { sort: k, dir: sort.sort === k && sort.dir === 'desc' ? 'asc' : 'desc' };
    setSort(s);
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(s));
    } catch { /* private window */ }
  };
  const arrow = (k: string) => (sort.sort === k ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
  const set = (k: keyof typeof FILTER0, v: string) => setF({ ...f, [k]: v });
  const csv = () => {
    const p = qs();
    p.set('format', 'csv');
    p.set('limit', '5000');
    location.href = `/api/issues?${p}`;
  };
  const changed = () => {
    setTick((t) => t + 1);
    onChanged();
  };
  const bulkDelete = async () => {
    const reason = prompt(`Permanently delete ${picked.size} issue(s)? This cannot be undone. Give the reason:`);
    if (!reason) return;
    try {
      await api('/api/issues/delete', { codes: [...picked], reason });
      setPicked(new Set());
      changed();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const c = (status: string, sev?: string) => (data?.counts ?? []).filter((x) => x.status === status && (!sev || x.severity === sev)).reduce((a, x) => a + x.n, 0);
  const overdue = (data?.counts ?? []).reduce((a, x) => a + x.overdue, 0);
  const cols: [string, string][] = [['code', 'Issue'], ['kind', 'Kind'], ['stretch_code', 'Work stretch'], ['ward', 'Ward'], ['admin_zone', 'Zone'], ['count', 'Count'],
    ['severity', 'Severity'], ['status', 'Status'], ['assignee_name', 'Assigned to'], ['due_date', 'Due'], ['created_at', 'Raised']];
  return (
    <div className="page">
      <h2>Issues</h2>
      <Insights kind="issues" refreshKey={refreshKey} />
      <div className="stat-row">
        <button className={`stat ${f.status === 'active' && !f.severity ? 'on' : ''}`} style={{ borderColor: '#dc2626' }} onClick={() => setF({ ...f, status: 'active', severity: '', overdue: '' })}>
          <b>{c('open') + c('assigned')}</b><span>Open (incl. assigned)</span></button>
        <button className={`stat ${f.severity === 'high' ? 'on' : ''}`} style={{ borderColor: SEVERITY_COLOR.high }} onClick={() => setF({ ...f, status: 'active', severity: f.severity === 'high' ? '' : 'high' })}>
          <b>{c('open', 'high') + c('assigned', 'high')}</b><span>High severity, open</span></button>
        <button className={`stat ${f.overdue ? 'on' : ''}`} style={{ borderColor: '#7f1d1d' }} onClick={() => set('overdue', f.overdue ? '' : '1')}>
          <b>{overdue}</b><span>Overdue</span></button>
        <button className={`stat ${f.status === 'assigned' ? 'on' : ''}`} style={{ borderColor: '#f59e0b' }} onClick={() => set('status', f.status === 'assigned' ? 'active' : 'assigned')}>
          <b>{c('assigned')}</b><span>Assigned</span></button>
        <button className={`stat ${f.status === 'resolved' ? 'on' : ''}`} style={{ borderColor: '#16a34a' }} onClick={() => set('status', f.status === 'resolved' ? 'active' : 'resolved')}>
          <b>{c('resolved')}</b><span>Resolved</span></button>
      </div>
      <div className="filters">
        <select value={f.kind} onChange={(e) => set('kind', e.target.value)} aria-label="Kind"><option value="">All kinds</option>{ISSUE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        <select value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value, ward: '' })} aria-label="Zone"><option value="">All zones</option>{zones.map((z) => <option key={z.id}>{z.id}</option>)}</select>
        <input type="number" placeholder="Ward" value={f.ward} onChange={(e) => set('ward', e.target.value)} aria-label="Ward" />
        <select value={f.severity} onChange={(e) => set('severity', e.target.value)} aria-label="Severity"><option value="">Any severity</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <select value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="active">Open + assigned</option><option value="">All</option>{ISSUE_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <label className="check-inline"><input type="checkbox" checked={f.assignee === 'me'} onChange={(e) => set('assignee', e.target.checked ? 'me' : '')} /> Assigned to me</label>
        <input placeholder="Issue, stretch or text" value={f.q} onChange={(e) => set('q', e.target.value)} aria-label="Search" />
        <button onClick={() => setF(FILTER0)}>Clear</button>
        <button onClick={csv} title="Downloads exactly this filtered list, in this order (opens in Excel)">⬇ Excel (CSV)</button>
        <div className="seg small-seg">
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button>
          <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
        </div>
      </div>
      {msg && <p className="error">{msg}</p>}
      {isCommissioner && picked.size > 0 && (
        <div className="row-btns"><span className="small">{picked.size} selected</span><button className="danger" onClick={bulkDelete}>Delete permanently…</button><button onClick={() => setPicked(new Set())}>Clear selection</button></div>
      )}
      {data && <p className="muted small">{data.total} issue(s){data.total > 500 ? ' (first 500 shown; the Excel file has up to 5,000)' : ''}.</p>}
      {data && view === 'table' && (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr>{isCommissioner && <th />}{cols.map(([k, l]) => <th key={k} onClick={() => setSortBy(k)}>{l}{arrow(k)}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.code} onClick={() => setOpen(r.code)}>
                  {isCommissioner && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={picked.has(r.code)} onChange={(e) => { const s = new Set(picked); if (e.target.checked) s.add(r.code); else s.delete(r.code); setPicked(s); }} />
                    </td>
                  )}
                  <td><button className="goto" title="Show on map" onClick={(e) => { e.stopPropagation(); onGoTo(r.lon, r.lat); }}>📍</button> <b>{r.code}</b></td>
                  <td>{r.title}{r.remark && <div className="muted small">{r.remark.slice(0, 80)}</div>}</td>
                  <td>{r.stretch_code}</td>
                  <td>{r.ward}</td>
                  <td>{r.admin_zone}</td>
                  <td>{r.count}</td>
                  <td><span className="dot" style={{ background: SEVERITY_COLOR[r.severity] }} /> {r.severity}</td>
                  <td>{ISSUE_STATUS.find((s) => s.key === r.status)?.label}</td>
                  <td className="small">{r.assignee_name ?? <span className="muted">—</span>}</td>
                  <td className={`small ${r.overdue ? 'error' : ''}`}>{fmtDate(r.due_date)}{r.overdue ? ' · overdue' : ''}</td>
                  <td className="small">{fmtTime(r.created_at)}<div className="muted">{r.created_by_name ?? 'raised automatically'}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && view === 'board' && (
        <div className="board">
          {ISSUE_STATUS.map((s) => (
            <div key={s.key} className="board-col">
              <h4 style={{ borderColor: s.color }}>{s.label} ({data.rows.filter((r) => r.status === s.key).length})</h4>
              {data.rows.filter((r) => r.status === s.key).map((r) => (
                <button key={r.code} className="board-card" onClick={() => setOpen(r.code)} style={{ borderLeftColor: SEVERITY_COLOR[r.severity] }}>
                  <b>{r.code}</b> · {r.title}{r.count > 1 ? ` (${r.count})` : ''}
                  <div className="muted small">{r.stretch_code} · ward {r.ward} · {r.assignee_name ?? 'unassigned'}{r.due_date ? ` · due ${fmtDate(r.due_date)}` : ''}</div>
                  {r.overdue && <div className="error small">Overdue</div>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {open && <IssueDetail code={open} onClose={() => setOpen(null)} onChanged={changed} onOpenStretch={onOpenStretch} />}
    </div>
  );
}

interface Detail {
  issue: IssueRow;
  events: { id: number; at: string; action: string; note: string; photos: string[]; detail: Record<string, unknown>; by_name: string | null }[];
  can: { resolve_issue: boolean; assign_issue: boolean; delete_issue: boolean };
}
const ACTION: Record<string, string> = { opened: 'Raised', count: 'Count changed', assigned: 'Assigned', resolved: 'Resolved', reopened: 'Re-opened', auto_resolved: 'Closed automatically' };

export function IssueDetail({ code, onClose, onChanged, onOpenStretch }: { code: string; onClose: () => void; onChanged: () => void; onOpenStretch?: (c: string) => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [msg, setMsg] = useState('');
  const { gps } = useGps(true);
  const load = () => api<Detail>(`/api/issues/${code}`).then((x) => { setD(x); setAssignee(x.issue.assignee ?? ''); setDue(x.issue.due_date ?? ''); });
  useEffect(() => {
    load();
    api<{ users: { id: string; name: string; role: string }[] }>('/api/users/assignable').then((r) => setUsers(r.users)).catch(() => {});
  }, [code]);
  const act = async (path: string, body: unknown) => {
    setMsg('');
    try {
      await api(`/api/issues/${code}/${path}`, body);
      setNote('');
      setPhotos([]);
      await load();
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const del = async () => {
    const reason = prompt(`Permanently delete ${code}? This cannot be undone. Give the reason:`);
    if (!reason) return;
    try {
      await api('/api/issues/delete', { codes: [code], reason });
      onChanged();
      onClose();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  if (!d) return <div className="modal"><div className="modal-box"><p className="muted">Loading…</p></div></div>;
  const i = d.issue;
  const resolved = i.status === 'resolved';
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head"><strong>{i.code} · {i.title}</strong><button className="icon" aria-label="Close" onClick={onClose}>✕</button></header>
        <div className="pad scroll">
          <div className="pills">
            <span className="pill" style={{ background: SEVERITY_COLOR[i.severity] }}>{i.severity}</span>
            <span className="pill" style={{ background: ISSUE_STATUS.find((s) => s.key === i.status)?.color }}>{ISSUE_STATUS.find((s) => s.key === i.status)?.label}</span>
            {i.overdue && <span className="pill" style={{ background: '#7f1d1d', color: '#fff' }}>Overdue</span>}
          </div>
          <p className="small">
            {i.count > 1 && <>Count: <b>{i.count}</b> · </>}
            {i.stretch_code ? <>Work stretch{' '}{onOpenStretch ? <button className="link" onClick={() => { onOpenStretch(i.stretch_code!); onClose(); }}>{i.stretch_code}</button> : i.stretch_code}</> : 'At a spot on the map'}
            {' '}· Ward {i.ward}{i.admin_zone ? ` · Zone ${i.admin_zone}` : ''} · {i.source === 'manual' ? `reported by ${i.created_by_name}` : i.source === 'status' ? 'raised from the stretch status' : 'raised from compliance'}
            {' '}· due {fmtDate(i.due_date)}{i.assignee_name && ` · assigned to ${i.assignee_name}`}
          </p>
          {i.remark && <p>“{i.remark}”</p>}
          {i.photos.length > 0 && <div className="thumbs">{i.photos.map((p) => <a key={p} href={`/api/files/${p}`} target="_blank" rel="noreferrer"><img src={`/api/files/${p}`} alt="" /></a>)}</div>}
          {resolved && <p className="ok small">Resolved {fmtTime(i.resolved_at)}{i.resolved_by_name && ` by ${i.resolved_by_name}`}: {i.resolution_note}</p>}
          {i.source === 'compliance' && !resolved && <p className="muted small">This closes by itself when the compliance item is complied and verified on the stretch.</p>}
          {i.source === 'status' && !resolved && <p className="muted small">This closes by itself when the damage is recorded as fixed on the stretch. Resolving it here also clears it on the stretch.</p>}

          {d.can.assign_issue && !resolved && (
            <div className="record-form">
              <strong className="small">Assign</strong>
              <div className="two">
                <label>To<select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Nobody</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                <label>Due date<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
              </div>
              <button className="primary" onClick={() => act('assign', { assignee: assignee || null, due_date: due || null, note })}>Save assignment</button>
            </div>
          )}
          {d.can.resolve_issue && i.source !== 'compliance' && (
            <div className="record-form">
              <label>{resolved ? 'Why re-open (required)' : 'How it was resolved (required)'}<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              {!resolved && <PhotoPicker label="Photo of the fix (optional)" kind="photo" files={photos} setFiles={setPhotos} gps={gps} />}
              <div className="row-btns">
                {!resolved ? <button className="primary" onClick={() => act('resolve', { note, photos: photos.map((p) => p.id) })}>Resolve</button>
                  : <button className="primary" onClick={() => act('reopen', { note })}>Re-open</button>}
              </div>
            </div>
          )}
          {d.can.delete_issue && <button className="danger" onClick={del}>Delete permanently…</button>}
          {msg && <p className="error">{msg}</p>}
          <h4>History</h4>
          <ol className="history">
            {d.events.map((e) => (
              <li key={e.id} className="small">
                <b>{ACTION[e.action] ?? e.action}</b> · {fmtTime(e.at)} · {e.by_name ?? 'system'}
                {e.action === 'count' && ` · ${e.detail.from} → ${e.detail.to}`}
                {e.action === 'assigned' && ` · to ${e.detail.to}${e.detail.due_date ? `, due ${fmtDate(e.detail.due_date as string)}` : ''}`}
                {e.note && <div>“{e.note}”</div>}
                {e.photos.length > 0 && <div className="thumbs">{e.photos.map((p) => <a key={p} href={`/api/files/${p}`} target="_blank" rel="noreferrer"><img src={`/api/files/${p}`} alt="" /></a>)}</div>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
