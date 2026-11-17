/**
 * Parts of the redesigned work-stretch pop-up: stage track, rename, More menu, Overview (next step, figures,
 * details), quick Update for field staff, photo gallery.
 */
import { useEffect, useMemo, useState } from 'react';
import { CUTTING, ROAD_TYPES, normaliseStatus, validateStatus, type WorkStatus } from 'shared';
import { api, ApiError } from '../api.ts';
import { Icon } from '../ui.tsx';
import { Modal } from './Modal.tsx';
import type { Card } from './StretchCard.tsx';
import { fmtDate, fmtTime, GpsBadge, uploadFile, useGps, type Uploaded } from './util.tsx';

export const TRACK = ['Not started', 'Road cut', 'Pipe laid', 'Back-filled', 'Restored', 'Approved'] as const;

/** Where the work stands on the six-step track. */
export function trackIndex(s: Card['stretch']) {
  const st = s.status;
  if (s.approval === 'approved') return 5;
  if (st.restoration === 'done') return 4;
  if (st.cutting === 'backfilled') return 3;
  if (st.pipeline === 'laid') return 2;
  if (st.cutting !== 'none' || st.pipeline === 'partly') return 1;
  return 0;
}

export function StageTrack({ s }: { s: Card['stretch'] }) {
  const at = trackIndex(s);
  return (
    <ol className="wtrack" aria-label="Where the work stands">
      {TRACK.map((t, i) => <li key={t} className={i < at || (i === at && at === 5) ? 'done' : i === at ? 'cur' : ''}><span>{i < at || (i === at && at === 5) ? '✓' : i + 1}</span>{t}</li>)}
    </ol>
  );
}

export function laidOf(s: Card['stretch']) {
  return s.status.pipe_laid_m ?? (s.status.pipeline === 'laid' ? Math.round(s.length_m) : 0);
}

/** Name shown once, with a pencil for those who may change it. */
export function NameEdit({ card, canEdit, onSaved }: { card: Card; canEdit: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(card.stretch.road_name);
  const [msg, setMsg] = useState('');
  if (!edit) return (
    <span className="wname">{card.stretch.road_name || <i className="muted">No name</i>}
      {canEdit && <button className="icon-btn sm" title="Rename" aria-label="Rename" onClick={() => { setV(card.stretch.road_name); setEdit(true); }}><Icon name="pencil" /></button>}
    </span>
  );
  const save = async () => {
    setMsg('');
    try { await api(`/api/site/stretches/${card.stretch.code}/name`, { name: v }); setEdit(false); onSaved(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <span className="wname-edit">
      <input value={v} autoFocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEdit(false); }} aria-label="Work stretch name" />
      <button className="btn primary" onClick={save}>Save</button><button className="btn ghost" onClick={() => setEdit(false)}>Cancel</button>
      {msg && <span className="error small">{msg}</span>}
    </span>
  );
}

export function MoreMenu({ items }: { items: { label: string; icon: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="more">
      <button className="icon-btn" aria-label="More actions" title="More actions" onClick={() => setOpen(!open)}><Icon name="dots" /></button>
      {open && (
        <span className="more-menu" onMouseLeave={() => setOpen(false)}>
          {items.map((i) => <button key={i.label} onClick={() => { setOpen(false); i.onClick(); }}><Icon name={i.icon} /> {i.label}</button>)}
        </span>
      )}
    </span>
  );
}

type Tab = 'overview' | 'update' | 'compliance' | 'issues' | 'history';

/** What this person should do next on this road. */
export function nextStep(card: Card, me: { id: string; role: string }) {
  const s = card.stretch;
  if ((card.project_blocks?.length ?? 0) > 0 && card.can.update)
    return { tone: 'bad', title: 'Work cannot start yet', detail: card.project_blocks!.map((m) => m.replace(/^Project: /, '')).join(' '), action: '', go: null as Tab | null, focus: '' };
  const waiting = card.compliance.records.filter((r) => r.verification === 'waiting' && (r.recorded_by !== me.id || me.role === 'commissioner'));
  if (card.can.verify && waiting.length)
    return { tone: 'wait', title: `Verify ${waiting.length} compliance record${waiting.length === 1 ? '' : 's'}`, detail: 'Recorded by field staff, waiting for you', action: 'Verify', go: 'compliance' as Tab, focus: waiting[0].item_key };
  if (s.approval === 'pending' && card.can.approve)
    return { tone: 'wait', title: 'Approve or reject the road restoration', detail: 'The restoration is done and waiting for your decision', action: 'Decide', go: 'overview' as Tab, focus: 'approval' };
  const items = card.compliance.stages.flatMap((st) => st.items.filter((i) => i.applies));
  const bad = items.find((i) => i.state === 'overdue' || i.state === 'not_complied') ?? items.find((i) => i.state === 'due');
  if (bad && card.can.record_compliance)
    return { tone: bad.state === 'due' ? 'due' : 'bad', title: `Record: ${bad.item.name}`, detail: bad.state_label + (bad.item.gate === 'block' ? ' · stops the next step until done' : ''), action: 'Record now', go: 'compliance' as Tab, focus: bad.item.key };
  if (card.can.update && trackIndex(s) < 4) return { tone: 'ok', title: "Update today's progress", detail: 'Pipe laid, manholes, road state, with a photo', action: 'Update', go: 'update' as Tab, focus: '' };
  if (bad) return { tone: 'due', title: `${items.filter((i) => ['overdue', 'due', 'not_complied'].includes(i.state)).length} compliance item(s) pending`, detail: 'For the field staff of this area', action: 'View', go: 'compliance' as Tab, focus: '' };
  return { tone: 'ok', title: 'Nothing pending', detail: trackIndex(s) === 5 ? 'Work complete and approved' : 'Everything due so far is done', action: '', go: null as Tab | null, focus: '' };
}

export function Figures({ card }: { card: Card }) {
  const s = card.stretch;
  const laid = laidOf(s);
  const len = Math.round(s.length_m);
  const openIssues = card.issues.filter((i) => i.status !== 'resolved').length;
  const sum = card.compliance.summary;
  return (
    <div className="wfigs">
      <div><span>Pipe laid</span><b>{laid} <small>/ {len} m</small></b><i><em style={{ width: `${len ? Math.min(100, (laid / len) * 100) : 0}%` }} /></i></div>
      <div><span>Manholes built</span><b>{s.status.manholes_built} <small>/ {s.planned_manholes}</small></b><i><em style={{ width: `${s.planned_manholes ? Math.min(100, (s.status.manholes_built / s.planned_manholes) * 100) : 0}%` }} /></i></div>
      <div><span>Compliance</span><b>{sum.score === null ? '—' : `${sum.score}%`}</b><small className={sum.overdue + sum.not_complied ? 'bad-t' : 'muted'}>{sum.overdue + sum.not_complied ? `${sum.overdue + sum.not_complied} overdue / not complied` : `${sum.verified} of ${sum.due} verified`}</small></div>
      <div><span>Open issues</span><b>{openIssues}</b><small className="muted">{card.issues.length} in all</small></div>
    </div>
  );
}

/** Quick update for the field: what changed today, a photo, save. */
export function QuickUpdate({ card, onSaved, onFull }: { card: Card; onSaved: (c: Card) => void; onFull: () => void }) {
  const s = card.stretch;
  const laid0 = laidOf(s);
  const len = Math.round(s.length_m);
  const [addM, setAddM] = useState(0);
  const [addMh, setAddMh] = useState(0);
  const [cutting, setCutting] = useState(s.status.cutting);
  const [restoration, setRestoration] = useState(s.status.restoration);
  const [roadType, setRoadType] = useState(s.status.road_type);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const { gps, state: gpsState } = useGps(true);
  useEffect(() => { setAddM(0); setAddMh(0); setCutting(s.status.cutting); setRestoration(s.status.restoration); setRoadType(s.status.road_type); setPhotos([]); setNote(''); }, [s.version]);
  const next = useMemo(() => {
    const laid = Math.max(0, laid0 + addM);
    const raw: WorkStatus = {
      ...s.status,
      pipe_laid_m: laid,
      pipeline: laid <= 0 ? s.status.pipeline : len && laid >= len ? 'laid' : 'partly',
      manholes_built: Math.max(0, s.status.manholes_built + addMh),
      cutting,
      road_type: roadType,
      restoration: cutting === 'backfilled' ? restoration : 'not_due',
    };
    return normaliseStatus(raw);
  }, [addM, addMh, cutting, restoration, roadType, s]);
  const check = useMemo(() => validateStatus(s.status, next, s, photos.length, s.approval), [next, photos.length, s]);
  const changed = JSON.stringify(next) !== JSON.stringify(normaliseStatus(s.status));
  const rt = ROAD_TYPES.find((r) => r.key === roadType);
  const save = async () => {
    setBusy(true); setMsg({});
    try {
      const r = await api<{ warnings: string[]; card: Card }>(`/api/stretches/${s.code}/status`, { status: next, note, photos: photos.map((p) => p.id), gps, version: s.version });
      setMsg({ ok: r.warnings.length ? `Saved, with warnings: ${r.warnings.join(' ')}` : 'Saved.' });
      onSaved(r.card);
    } catch (e) {
      const err = e as ApiError;
      setMsg({ error: err.message + (err.code === 'GATE_BLOCK' ? ' (Open "Edit full status" for the Commissioner override.)' : '') });
    } finally { setBusy(false); }
  };
  const step = (v: number, set: React.Dispatch<React.SetStateAction<number>>, by: number, unit: string, label: string, total: string) => (
    <div className="qrow">
      <span className="qlabel">{label}<small>{total}</small></span>
      <span className="qstep">
        <button onClick={() => set((x) => x - by)} aria-label={`Less ${label}`}>−</button>
        <input type="number" inputMode="numeric" value={v === 0 ? '' : v} placeholder="0" onChange={(e) => set(Number(e.target.value) || 0)} aria-label={label} />
        <span className="qunit">{unit}</span>
        <button onClick={() => set((x) => x + by)} aria-label={`More ${label}`}>+</button>
      </span>
    </div>
  );
  return (
    <div className="quick">
      <div className="qhead"><b>What changed today?</b><button className="link" onClick={onFull}>Edit full status ›</button></div>
      {step(addM, setAddM, 5, 'm', 'Pipe laid today', `so far ${laid0} of ${len} m${addM ? ` → ${Math.max(0, laid0 + addM)} m` : ''}`)}
      {step(addMh, setAddMh, 1, '', 'Manholes finished today', `so far ${s.status.manholes_built} of ${s.planned_manholes}`)}
      <div className="qblock">
        <span className="qlabel">The road now</span>
        <div className="qchips">{CUTTING.map((c) => <button key={c.key} className={cutting === c.key ? 'on' : ''} onClick={() => setCutting(c.key)}>{c.label}</button>)}</div>
      </div>
      {cutting === 'backfilled' && (
        <div className="qblock">
          <span className="qlabel">Road restoration</span>
          {!roadType && <select value="" onChange={(e) => setRoadType((e.target.value || null) as WorkStatus['road_type'])}><option value="">Choose the road type…</option>{ROAD_TYPES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>}
          {roadType && <div className="qchips">
            {[['pending', rt?.steps[0]], ...(roadType === 'earthen' ? [] : [['middle', rt?.steps[1]]]), ['done', rt?.steps[2]]].map(([k, l]) => <button key={k} className={restoration === k ? 'on' : ''} onClick={() => setRestoration(k as WorkStatus['restoration'])}>{l}</button>)}
            <button className="link" onClick={() => setRoadType(null)}>change road type</button>
          </div>}
        </div>
      )}
      <QuickPhotos photos={photos} setPhotos={setPhotos} gps={gps} gpsState={gpsState} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Remark (optional)" aria-label="Remark" />
      {changed && check.errors.length > 0 && <p className="error small">{check.errors.join(' ')}</p>}
      {changed && check.warnings.length > 0 && <p className="warn small">{check.warnings.join(' ')}</p>}
      {msg.error && <p className="error">{msg.error}</p>}
      {msg.ok && <p className="ok">{msg.ok}</p>}
      <button className="btn primary big" disabled={busy || !changed || check.errors.length > 0} onClick={save}>{busy ? 'Saving…' : changed ? 'Save update' : 'Nothing changed yet'}</button>
    </div>
  );
}

function QuickPhotos({ photos, setPhotos, gps, gpsState }: { photos: Uploaded[]; setPhotos: (p: Uploaded[]) => void; gps: { lat: number; lon: number; accuracy_m: number } | null; gpsState: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="qphotos">
      {photos.map((p) => <span key={p.id} className="qphoto"><img src={`/api/files/${p.id}`} alt="" /><button aria-label="Remove" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}>×</button></span>)}
      <label className="qphoto add">
        <Icon name="camera" /><span>{busy ? 'Adding…' : 'Add photo'}</span>
        <input type="file" accept="image/*" capture="environment" multiple hidden onChange={async (e) => {
          const list = Array.from(e.target.files ?? []); e.target.value = '';
          setBusy(true); setErr('');
          try { const out = [...photos]; for (const f of list) out.push(await uploadFile(f, 'photo', gps)); setPhotos(out); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
        }} />
      </label>
      <GpsBadge state={gpsState} gps={gps} />
      {err && <span className="error small">{err}</span>}
    </div>
  );
}

/** Every photo taken on this road: status updates and compliance records, newest first. */
export function PhotosModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const [hist, setHist] = useState<{ at: string; kind: string; photos: string[]; by_name: string | null }[] | null>(null);
  useEffect(() => { api<{ history: typeof hist }>(`/api/stretches/${card.stretch.code}/history`).then((r) => setHist(r.history)); }, [card.stretch.code]);
  const names = Object.fromEntries(card.compliance.stages.flatMap((s) => s.items.map((i) => [i.item.key, i.item.name])));
  const all = [
    ...(hist ?? []).flatMap((h) => h.photos.map((p) => ({ id: p, at: h.at, what: h.kind === 'status' ? 'Status update' : h.kind === 'compliance' ? 'Compliance' : 'Update', by: h.by_name }))),
    ...card.compliance.records.flatMap((r) => r.photos.map((p) => ({ id: p, at: r.recorded_at, what: names[r.item_key] ?? 'Compliance', by: r.recorded_by_name }))),
  ].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i).sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Modal title={`Photos · ${card.stretch.code}`} size="large" onClose={onClose}>
      {!hist ? <p className="muted">Loading…</p> : !all.length ? <p className="muted">No photos yet.</p> : (
        <div className="gallery">{all.map((p) => (
          <a key={p.id} href={`/api/files/${p.id}`} target="_blank" rel="noreferrer" className="gphoto">
            <img src={`/api/files/${p.id}`} alt="" loading="lazy" />
            <span><b>{p.what}</b><small>{fmtTime(p.at)}{p.by ? ` · ${p.by}` : ''}</small></span>
          </a>
        ))}</div>
      )}
    </Modal>
  );
}

export function DetailsPanel({ card, ends }: { card: Card; ends: React.ReactNode }) {
  const s = card.stretch;
  return (
    <div className="wdetails">
      <div className="wd-grid">
        <div><span>Ward</span><b>{s.ward}</b></div>
        <div><span>GWMC zone</span><b>{s.admin_zone}</b></div>
        {s.catchment && <div><span>Catchment</span><b>{s.catchment}</b></div>}
        <div><span>Length</span><b>{Math.round(s.length_m)} m</b></div>
        <div><span>Pipe pieces</span><b>{s.pipes_count}</b></div>
        <div><span>Manholes planned</span><b>{s.planned_manholes}</b></div>
        <div><span>Biggest pipe</span><b>{s.max_dia_mm} mm</b></div>
        {s.max_depth_m ? <div><span>Deepest</span><b>{s.max_depth_m} m</b></div> : null}
        <div><span>Last update</span><b>{s.updated_by_name ? `${fmtDate(s.updated_at)} · ${s.updated_by_name}` : 'none yet'}</b></div>
      </div>
      {ends}
      {card.tags.length > 0 && <div className="tags">{card.tags.map((t) => <span key={t} className={`tag ${/^(Overdue|Not complied)/.test(t) ? 'bad' : ''}`}>{t}</span>)}</div>}
    </div>
  );
}
