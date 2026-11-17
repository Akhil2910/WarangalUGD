/** Grievances from citizens (via the QR boards): list, filters, detail with actions. */
import { useEffect, useState } from 'react';
import { GRIEVANCE_CATEGORIES, GRIEVANCE_STATUS } from 'shared';
import { Insights } from './Insights.tsx';
import { api } from '../api.ts';
import { Modal } from './Modal.tsx';
import { PhotoPicker } from './StretchCard.tsx';
import { fmtDate, fmtTime, useGps, type Uploaded } from './util.tsx';

interface G {
  number: string; stretch_code: string | null; ward: number; admin_zone: string; category: string; category_label: string; description: string; photos: string[];
  name: string; mobile: string; house_no: string; language: string; status: string; assignee_name: string | null; due_date: string; overdue: boolean;
  created_at: string; resolved_at: string | null; resolved_by_name: string | null; resolution_note: string; issue_code: string | null; lon: number; lat: number;
}
const stOf = (k: string) => GRIEVANCE_STATUS.find((s) => s.key === k)!;

export function GrievancesPage({ zones, onOpenStretch, onGoTo, refreshKey, onChanged }: {
  zones: { id: string }[]; onOpenStretch: (c: string) => void; onGoTo: (lon: number, lat: number) => void; refreshKey: number; onChanged: () => void;
}) {
  const [f, setF] = useState({ status: 'open', zone: '', ward: '', category: '', overdue: '', mine: '', q: '' });
  const [data, setData] = useState<{ rows: G[]; counts: { status: string; n: number; overdue: number }[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    const t = setTimeout(() => api<typeof data>(`/api/grievances?${p}`).then(setData), f.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [f, tick, refreshKey]);
  const n = (s: string) => data?.counts.filter((c) => c.status === s).reduce((a, c) => a + c.n, 0) ?? 0;
  const over = data?.counts.reduce((a, c) => a + c.overdue, 0) ?? 0;
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return (
    <div className="page">
      <div className="page-head"><h2>Grievances</h2><span className="muted">From citizens, through the QR board at each work stretch</span></div>
      <Insights kind="grievances" refreshKey={refreshKey} />
      <div className="cards">
        {[['open', 'Open', n('new') + n('assigned'), '#f59e0b'], ['overdue', 'Overdue', over, '#dc2626'], ['resolved', 'Resolved', n('resolved'), '#16a34a'], ['rejected', 'Closed (not for this work)', n('rejected'), '#6b7280']].map(([k, label, v, c]) => (
          <button key={k as string} className={`stat ${(k === 'overdue' ? f.overdue === '1' : f.status === k && !f.overdue) ? 'on' : ''}`}
            onClick={() => (k === 'overdue' ? setF({ ...f, status: 'open', overdue: f.overdue ? '' : '1' }) : setF({ ...f, status: k as string, overdue: '' }))}>
            <span className="stat-bar" style={{ background: c as string }} /><b>{v as number}</b><span>{label as string}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <input className="grow" placeholder="Number, text, work or name" value={f.q} onChange={(e) => set('q', e.target.value)} />
        <select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="open">Open</option><option value="all">All</option>{GRIEVANCE_STATUS.map((s) => <option key={s.key} value={s.key}>{s.en}</option>)}</select>
        <select value={f.category} onChange={(e) => set('category', e.target.value)}><option value="">All problems</option>{GRIEVANCE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.en}</option>)}</select>
        <select value={f.zone} onChange={(e) => set('zone', e.target.value)}><option value="">All zones</option>{zones.map((z) => <option key={z.id}>{z.id}</option>)}</select>
        <input type="number" placeholder="Ward" value={f.ward} onChange={(e) => set('ward', e.target.value)} />
        <label className="check-inline"><input type="checkbox" checked={!!f.mine} onChange={(e) => set('mine', e.target.checked ? '1' : '')} /> Sent to me</label>
      </div>
      {data && !data.rows.length && <div className="empty">No grievances here. Citizens send them by scanning the QR board at a work site (open a work stretch → “QR board”).</div>}
      <div className="list">
        {data?.rows.map((g) => (
          <div key={g.number} className="list-row" onClick={() => setOpen(g.number)}>
            <span className="stage-dot" style={{ background: stOf(g.status).color }} />
            <div className="grow">
              <div className="row-title"><b>{g.number}</b> {g.category_label}</div>
              <div>{g.description.slice(0, 140)}</div>
              <div className="muted small">{g.name} · {g.stretch_code ?? '—'} · ward {g.ward} · {fmtTime(g.created_at)}{g.assignee_name ? ` · ${g.assignee_name}` : ''}</div>
            </div>
            <div className="row-side">
              <span className={`tag ${g.overdue ? 'bad' : ''}`}>{stOf(g.status).en}{g.overdue ? ' · overdue' : ''}</span>
              <small className="muted">due {fmtDate(g.due_date)}</small>
              <button className="btn" onClick={(e) => { e.stopPropagation(); onGoTo(g.lon, g.lat); }}>Map</button>
            </div>
          </div>
        ))}
      </div>
      {open && <GrievanceDetail number={open} onClose={() => setOpen(null)} onChanged={() => { setTick((t) => t + 1); onChanged(); }} onOpenStretch={onOpenStretch} />}
    </div>
  );
}

function GrievanceDetail({ number, onClose, onChanged, onOpenStretch }: { number: string; onClose: () => void; onChanged: () => void; onOpenStretch: (c: string) => void }) {
  const [d, setD] = useState<{ grievance: G; events: { id: number; at: string; action: string; note: string; public_note: boolean; by_name: string | null }[]; can: { act: boolean; assign: boolean } } | null>(null);
  const [note, setNote] = useState('');
  const [pub, setPub] = useState('');
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState('');
  const { gps } = useGps(true);
  const load = () => api<typeof d>(`/api/grievances/${number}`).then(setD);
  useEffect(() => {
    load();
    api<{ users: { id: string; name: string }[] }>('/api/users/assignable').then((r) => setUsers(r.users)).catch(() => {});
  }, [number]);
  const run = async (path: string, body: unknown) => {
    setMsg('');
    try {
      const r = await api<{ issue?: string }>(`/api/grievances/${number}/${path}`, body);
      if (r.issue) setMsg(`Issue ${r.issue} raised on the work stretch.`);
      setNote('');
      setPub('');
      await load();
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  if (!d) return <Modal title={number} onClose={onClose}><p className="muted">Loading…</p></Modal>;
  const g = d.grievance;
  const closed = g.status === 'resolved' || g.status === 'rejected';
  return (
    <Modal title={`${g.number} · ${g.category_label}`} onClose={onClose} size="medium">
      <div className="pills"><span className="pill" style={{ background: stOf(g.status).color, color: '#fff' }}>{stOf(g.status).en}</span>{g.overdue && <span className="pill" style={{ background: '#fee2e2' }}>Overdue</span>}</div>
      <p>{g.description}</p>
      {g.photos.length > 0 && <div className="thumbs">{g.photos.map((p) => <a key={p} href={`/api/files/${p}`} target="_blank" rel="noreferrer"><img src={`/api/files/${p}`} alt="" /></a>)}</div>}
      <table className="pop kv">
        <tbody>
          <tr><th>Citizen</th><td>{g.name} · {g.mobile}{g.house_no ? ` · door ${g.house_no}` : ''} · {g.language === 'te' ? 'Telugu' : 'English'}</td></tr>
          <tr><th>Work stretch</th><td>{g.stretch_code ? <button className="btn ghost" onClick={() => { onClose(); onOpenStretch(g.stretch_code!); }}>{g.stretch_code}</button> : '—'} · ward {g.ward} · {g.admin_zone}</td></tr>
          <tr><th>Received</th><td>{fmtTime(g.created_at)} · due {fmtDate(g.due_date)}</td></tr>
          <tr><th>With</th><td>{g.assignee_name ?? 'not assigned'}</td></tr>
          {g.issue_code && <tr><th>Issue</th><td>{g.issue_code}</td></tr>}
          {closed && <tr><th>Answer</th><td>{g.resolution_note} {g.resolved_by_name ? `(${g.resolved_by_name}, ${fmtTime(g.resolved_at)})` : ''}</td></tr>}
        </tbody>
      </table>
      {d.can.assign && !closed && (
        <label className="field">Send to
          <select defaultValue="" onChange={(e) => e.target.value && run('assign', { assignee: e.target.value })}>
            <option value="">Choose an officer…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      )}
      {d.can.act && (
        <div className="record-form">
          {!closed ? (
            <>
              <label className="field">What was done (required)<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <label className="field">Message to the citizen (optional, shown when they check the status)<input value={pub} onChange={(e) => setPub(e.target.value)} placeholder="e.g. Barricading done. Thank you for telling us." /></label>
              <PhotoPicker label="Photo of the fix (optional)" kind="photo" files={photos} setFiles={setPhotos} gps={gps} />
              <div className="row-btns">
                <button className="btn primary" disabled={note.trim().length < 3} onClick={() => run('resolve', { note, public_note: pub || undefined, photos: photos.map((p) => p.id) })}>Resolve</button>
                {!g.issue_code && <button className="btn" onClick={() => run('to-issue', {})}>Raise an issue on the work stretch</button>}
                <button className="btn danger" disabled={note.trim().length < 3} onClick={() => run('reject', { note })}>Close: not for this work</button>
              </div>
            </>
          ) : (
            <div className="row-btns">
              <input className="grow" placeholder="Why re-open?" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn" disabled={note.trim().length < 3} onClick={() => run('reopen', { note })}>Re-open</button>
            </div>
          )}
        </div>
      )}
      {msg && <p className={msg.startsWith('Issue') ? 'ok' : 'error'}>{msg}</p>}
      <h4>History</h4>
      <ol className="history">
        {d.events.map((e) => <li key={e.id} className="small"><b>{e.action}</b> · {fmtTime(e.at)} · {e.by_name ?? 'citizen / system'}{e.public_note ? ' · shown to citizen' : ''}{e.note && <div>{e.note}</div>}</li>)}
      </ol>
    </Modal>
  );
}
