/**
 * Stretch card: Status (18 items, update form), Compliance (checklist by stage, record, verify), History.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  APPROVAL, COMPLIANCE_THEME, CUTTING, EVIDENCE_KINDS, MOTORABILITY, PIPELINE, ROAD_TYPES, STAGES, UNIT_STATE_COLOR,
  normaliseStatus, passRuleText, restorationLabel, validateStatus, STATUS_LABELS,
  type ComplianceItem, type UnitState, type WorkStatus, type Approval,
} from 'shared';
import { api, ApiError } from '../api.ts';
import { fmtDate, fmtTime, GpsBadge, uploadFile, useGps, type Uploaded } from './util.tsx';
import { IssueDetail, type IssueRow } from './IssuesPage.tsx';
import { ReportIssueModal } from './ReportIssue.tsx';
import { QrBoard } from './QrBoard.tsx';
import { ISSUE_STATUS, ROLE_LABEL, SEVERITY_COLOR } from 'shared';

interface Unit { unit: { id: string; label: string; design_invert?: number | null }; state: UnitState; state_label: string; due_since: string | null; overdue_since: string | null }
interface ItemView { item: ComplianceItem; applies: boolean; state: UnitState; state_label: string; progress: string; units: Unit[] }
interface Rec {
  id: number; item_key: string; item_version: number; unit: string; result: string; value: number | null; design_value: number | null;
  value_date: string | null; reference: string; reason: string; photos: string[]; documents: string[]; distance_m: number | null;
  recorded_at: string; recorded_by: string; recorded_by_name: string; verification: string; verified_by_name: string | null; verified_at: string | null; verify_note: string;
}
export interface Card {
  stretch: {
    code: string; ward: number; admin_zone: string; sewer_zone: string; catchment: string; package: string; road_name: string; length_m: number;
    planned_manholes: number; dia_m: Record<string, number>; max_dia_mm: number; max_depth_m: number | null; status: WorkStatus; approval: Approval;
    stage: string; version: number; work_group: string | null; source: string; updated_at: string | null; pipes_detail: [string, number, string, string, number][];
    start_point: EndPoint | null; end_point: EndPoint | null; updated_by_name: string | null; pipes_count: number; geom: { type: string; coordinates: number[][][] };
  };
  tags: string[];
  badges: string;
  compliance: {
    summary: { theme: string; due: number; verified: number; to_verify: number; overdue: number; not_complied: number; pending: number; score: number | null };
    stages: { key: string; no: number; label: string; dueWhen: string; guards: string; reached_at: string | null; items: ItemView[] }[];
    records: Rec[];
  };
  issues: IssueRow[];
  can: { update: boolean; record_compliance: boolean; verify: boolean; approve: boolean; override: boolean; report_issue: boolean; resolve_issue: boolean; assign_issue: boolean; delete_issue: boolean };
}

export interface EndPoint { code: string; lat: number; lon: number; typed?: boolean }

const stageOf = (k: string) => STAGES.find((s) => s.key === k) ?? STAGES[0];
const themeOf = (k: string) => COMPLIANCE_THEME.find((s) => s.key === k) ?? COMPLIANCE_THEME[0];

/** The work stretch, as a large pop-up over the map. */
export function StretchCard({ code, me, onClose, onChanged, onLocate, onEditSitePipes }: {
  code: string; me: { id: string; role: string }; onClose: () => void; onChanged: () => void; onLocate: (c: Card) => void;
  onEditSitePipes?: (c: Card) => void;
}) {
  const wrap = (inner: React.ReactNode) => <div className="modal" role="dialog" aria-modal="true"><aside className="drawer card-modal">{inner}</aside></div>;
  const [card, setCard] = useState<Card | null>(null);
  const [tab, setTab] = useState<'status' | 'compliance' | 'issues' | 'history'>('status');
  const [qr, setQr] = useState(false);
  const [error, setError] = useState('');
  const load = () => api<Card>(`/api/stretches/${code}`).then(setCard).catch((e) => setError((e as Error).message));
  useEffect(() => {
    setCard(null);
    setError('');
    load();
  }, [code]);
  const updated = (c: Card) => {
    setCard(c);
    onChanged();
  };
  if (error) return wrap(<><Head code={code} onClose={onClose} /><p className="error pad">{error}</p></>);
  if (!card) return wrap(<><Head code={code} onClose={onClose} /><p className="muted pad">Loading…</p></>);
  const s = card.stretch;
  const st = stageOf(s.stage);
  const th = themeOf(card.compliance.summary.theme);
  const canDraw = ['aee', 'dee', 'commissioner'].includes(me.role) && card.can.update;
  return wrap(
    <>
      <Head code={code} onClose={onClose} name={s.road_name} />
      <div className="pad card-top">
        <div className="pills">
          <span className="pill" style={{ background: st.color }}>{st.label}</span>
          <span className="pill" style={{ background: th.color }}>Compliance: {th.label}{card.compliance.summary.score !== null ? ` · ${card.compliance.summary.score}%` : ''}</span>
          {card.badges && <span className="pill badge">{card.badges.split('').join(' ')}</span>}
        </div>
        <div className="muted small">
          Ward {s.ward} · {s.admin_zone}{s.catchment ? ` · ${s.catchment}` : ''} · {Math.round(s.length_m)} m · {s.pipes_count} reaches · {s.planned_manholes} manholes planned · up to {s.max_dia_mm} mm
          {s.max_depth_m ? `, ${s.max_depth_m} m deep` : ''}{s.road_name ? ` · ${s.road_name}` : ''}
        </div>
        <Ends card={card} canEdit={canDraw} onSaved={() => { load(); onChanged(); }} />
        <div className="row-btns">
          <button onClick={() => onLocate(card)}>📍 Show on map</button>
          <button onClick={() => setQr(true)}>▦ QR board for citizens</button>
          {s.source === 'site' && onEditSitePipes && card.can.update && <button onClick={() => onEditSitePipes(card)}>Change pipes on the map</button>}
        </div>
        {card.tags.length > 0 && <div className="tags">{card.tags.map((t) => <span key={t} className={`tag ${/^(Overdue|Not complied)/.test(t) ? 'bad' : ''}`}>{t}</span>)}</div>}
        <div className="muted small">Last update: {s.updated_by_name ? `${fmtTime(s.updated_at)} by ${s.updated_by_name}` : 'none yet'} · version {s.version}</div>
      </div>
      <nav className="tabs">
        {(['status', 'compliance', 'issues', 'history'] as const).map((t) => {
          const openIssues = card.issues.filter((i) => i.status !== 'resolved').length;
          const label = t === 'status' ? 'Status'
            : t === 'compliance' ? `Compliance${card.compliance.summary.overdue + card.compliance.summary.not_complied ? ` (${card.compliance.summary.overdue + card.compliance.summary.not_complied}!)` : ''}`
            : t === 'issues' ? `Issues${openIssues ? ` (${openIssues})` : ''}` : 'History';
          return <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{label}</button>;
        })}
      </nav>
      <div className="pad scroll" key={tab}>
        {tab === 'status' && <StatusTab card={card} onSaved={updated} />}
        {tab === 'compliance' && <ComplianceTab card={card} me={me} onSaved={updated} />}
        {tab === 'issues' && <IssuesTab card={card} reload={() => { load(); onChanged(); }} />}
        {tab === 'history' && <HistoryTab code={code} version={s.version} />}
      </div>
      {qr && <QrBoard card={card} onClose={() => setQr(false)} />}
    </>,
  );
}

/** Start and end point (latitude, longitude): from the first and last manhole; can be corrected by typing. */
function Ends({ card, canEdit, onSaved }: { card: Card; canEdit: boolean; onSaved: () => void }) {
  const s = card.stretch;
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ slat: '', slon: '', elat: '', elon: '' });
  const [msg, setMsg] = useState('');
  if (!s.start_point && !s.end_point) return null;
  const fmt = (p: EndPoint | null) => (p ? `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}` : '—');
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});
  const open = () => {
    setV({ slat: String(s.start_point?.lat ?? ''), slon: String(s.start_point?.lon ?? ''), elat: String(s.end_point?.lat ?? ''), elon: String(s.end_point?.lon ?? '') });
    setEdit(true);
  };
  const save = async () => {
    setMsg('');
    try {
      await api(`/api/site/stretches/${s.code}/ends`, {
        start_point: { lat: Number(v.slat), lon: Number(v.slon), code: s.start_point?.code }, end_point: { lat: Number(v.elat), lon: Number(v.elon), code: s.end_point?.code },
      });
      setEdit(false);
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="ends">
      {!edit ? (
        <>
          <div><span className="end-tag start">Start</span> {fmt(s.start_point)} <span className="muted small">{s.start_point?.code}{s.start_point?.typed ? ' (typed)' : ''}</span>
            <button className="btn ghost" onClick={() => copy(fmt(s.start_point))}>Copy</button></div>
          <div><span className="end-tag end">End</span> {fmt(s.end_point)} <span className="muted small">{s.end_point?.code}{s.end_point?.typed ? ' (typed)' : ''}</span>
            <button className="btn ghost" onClick={() => copy(fmt(s.end_point))}>Copy</button></div>
          {canEdit && <button className="btn ghost" onClick={open}>Correct start / end</button>}
        </>
      ) : (
        <div className="ends-edit">
          <div className="two">
            <label>Start latitude<input value={v.slat} onChange={(e) => setV({ ...v, slat: e.target.value })} inputMode="decimal" /></label>
            <label>Start longitude<input value={v.slon} onChange={(e) => setV({ ...v, slon: e.target.value })} inputMode="decimal" /></label>
            <label>End latitude<input value={v.elat} onChange={(e) => setV({ ...v, elat: e.target.value })} inputMode="decimal" /></label>
            <label>End longitude<input value={v.elon} onChange={(e) => setV({ ...v, elon: e.target.value })} inputMode="decimal" /></label>
          </div>
          {msg && <p className="error">{msg}</p>}
          <div className="row-btns"><button className="btn primary" onClick={save}>Save</button><button className="btn" onClick={() => setEdit(false)}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}

function Head({ code, onClose, name }: { code: string; onClose: () => void; name?: string }) {
  return (
    <header className="modal-head">
      <strong>Work stretch {code}{name ? <span className="muted head-name"> · {name}</span> : null}</strong>
      <button className="x" aria-label="Close" onClick={onClose}>×</button>
    </header>
  );
}

// ---------------- Status ----------------
function StatusTab({ card, onSaved }: { card: Card; onSaved: (c: Card) => void }) {
  const s = card.stretch;
  const [form, setForm] = useState<WorkStatus>(s.status);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; warnings?: string[]; gate?: boolean }>({});
  const [override, setOverride] = useState('');
  const { gps, state: gpsState } = useGps(editing);
  useEffect(() => {
    setForm(s.status);
    setPhotos([]);
    setNote('');
  }, [s.version]);
  const next = useMemo(() => normaliseStatus(form), [form]);
  const check = useMemo(() => validateStatus(s.status, next, s, photos.length, s.approval), [next, photos.length, s]);
  const set = <K extends keyof WorkStatus>(k: K, v: WorkStatus[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: keyof WorkStatus, nullable = false) => (
    <input type="number" inputMode="numeric" min={0} value={(form[k] as number | null) ?? ''} disabled={!editing}
      onChange={(e) => set(k, (e.target.value === '' ? (nullable ? null : 0) : Number(e.target.value)) as never)} />
  );
  const sel = <K extends keyof WorkStatus>(k: K, opts: readonly { key: string; label: string }[]) => (
    <select value={(form[k] as string) ?? ''} disabled={!editing} onChange={(e) => set(k, (e.target.value || null) as WorkStatus[K])}>
      {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
  const yes = (k: keyof WorkStatus) => (
    <label className="check"><input type="checkbox" checked={!!form[k]} disabled={!editing} onChange={(e) => set(k, e.target.checked as never)} />{STATUS_LABELS[k]}</label>
  );
  const rt = ROAD_TYPES.find((r) => r.key === form.road_type);
  const restOpts = [
    { key: 'not_due', label: 'Not due yet (before back-fill)' },
    { key: 'pending', label: rt ? rt.steps[0] : 'Restoration pending' },
    ...(form.road_type === 'earthen' ? [] : [{ key: 'middle', label: rt ? rt.steps[1] : 'Restoration under way (choose road type)' }]),
    { key: 'done', label: rt ? rt.steps[2] : 'Restoration done (choose road type)' },
  ];
  const save = async () => {
    setBusy(true);
    setMsg({});
    try {
      const r = await api<{ warnings: string[]; card: Card }>(`/api/stretches/${s.code}/status`, {
        status: next, note, photos: photos.map((p) => p.id), gps, version: s.version, override_reason: override || undefined,
      });
      setEditing(false);
      setOverride('');
      setMsg({ warnings: r.warnings.length ? ['Saved, with warnings:', ...r.warnings] : ['Saved.'] });
      onSaved(r.card);
    } catch (e) {
      const err = e as ApiError;
      setMsg({ error: err.message, gate: err.code === 'GATE_BLOCK' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="status-form">
      {card.stretch.approval !== 'none' && <ApprovalBox card={card} onSaved={onSaved} />}
      {!editing && card.can.update && <button className="primary" onClick={() => { setEditing(true); setMsg({}); }}>Update status</button>}
      {!card.can.update && <p className="muted small">You can view this stretch. Updating is for field staff and officers of its area.</p>}
      <fieldset><legend>A · Sewer work</legend>
        <label>Pipeline {sel('pipeline', PIPELINE)}</label>
        {form.pipeline === 'partly' && <label>Metres laid {num('pipe_laid_m', true)}</label>}
        <label>Manholes built (of {s.planned_manholes}) {num('manholes_built')}</label>
        <label>Inspection chambers built {num('ics_built')}</label>
      </fieldset>
      <fieldset><legend>B · Road cutting</legend>
        <label>Road cutting {sel('cutting', CUTTING)}</label>
        {form.cutting !== 'none' && <label>Cut length (m, optional) {num('cut_length_m', true)}</label>}
      </fieldset>
      <fieldset><legend>C · Road restoration</legend>
        <label>Road type
          <select value={form.road_type ?? ''} disabled={!editing} onChange={(e) => set('road_type', (e.target.value || null) as WorkStatus['road_type'])}>
            <option value="">Not chosen</option>
            {ROAD_TYPES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label>Restoration
          <select value={next.restoration} disabled={!editing} onChange={(e) => set('restoration', e.target.value as WorkStatus['restoration'])}>
            {restOpts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <div className="muted small">Approval: {APPROVAL.find((a) => a.key === s.approval)?.label}</div>
      </fieldset>
      <fieldset><legend>D · Motorability</legend>
        <label>Road is {sel('motorability', MOTORABILITY)}</label>
      </fieldset>
      <fieldset><legend>E · Utilities</legend>
        <div className="two">
          <label>Taps broken {num('taps_broken')}</label>
          <label>Taps restored {num('taps_restored')}</label>
          <label>Water leakages {num('leaks')}</label>
          <label>Leakages fixed {num('leaks_fixed')}</label>
        </div>
        {yes('drain_clogged')}
      </fieldset>
      <fieldset><legend>F · Hazards</legend>
        {yes('stagnation')}{yes('potholes')}{yes('uneven_backfill')}
      </fieldset>
      {editing && (
        <div className="save-box">
          <GpsBadge state={gpsState} gps={gps} />
          <PhotoPicker label="Photos" kind="photo" files={photos} setFiles={setPhotos} gps={gps} />
          <label>Note <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></label>
          {check.errors.map((x) => <p key={x} className="error small">✕ {x}</p>)}
          {check.warnings.map((x) => <p key={x} className="warn small">⚠ {x}</p>)}
          {msg.gate && card.can.override && (
            <label>Override reason (Commissioner)<input value={override} onChange={(e) => setOverride(e.target.value)} /></label>
          )}
          <div className="row-btns">
            <button className="primary" disabled={busy || check.errors.length > 0} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            <button onClick={() => { setEditing(false); setForm(s.status); setPhotos([]); setMsg({}); }}>Cancel</button>
          </div>
        </div>
      )}
      {msg.error && <p className="error">{msg.error}</p>}
      {msg.warnings?.map((w) => <p key={w} className={w === 'Saved.' ? 'ok' : 'warn small'}>{w}</p>)}
      {!editing && <p className="muted small">Restoration: {restorationLabel(s.status)}</p>}
    </div>
  );
}

function ApprovalBox({ card, onSaved }: { card: Card; onSaved: (c: Card) => void }) {
  const s = card.stretch;
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const decide = async (decision: 'approve' | 'reject') => {
    setMsg('');
    try {
      const r = await api<{ card: Card; warnings: string[] }>(`/api/stretches/${s.code}/approval`, { decision, note });
      setMsg(r.warnings.length ? `Done, with warnings: ${r.warnings.join(' ')}` : 'Done.');
      onSaved(r.card);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className={`approval approval-${s.approval}`}>
      <strong>Restoration: {APPROVAL.find((a) => a.key === s.approval)?.label}</strong>
      {s.approval === 'pending' && card.can.approve && (
        <>
          <label>Note (needed to reject)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row-btns">
            <button className="primary" onClick={() => decide('approve')}>Approve</button>
            <button className="danger" onClick={() => decide('reject')}>Reject</button>
          </div>
        </>
      )}
      {s.approval === 'pending' && !card.can.approve && <span className="muted small"> · waiting for the DEE</span>}
      {s.approval === 'rejected' && <span className="muted small"> · record the corrected work with a new photo to send it back</span>}
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}

export function PhotoPicker({ label, kind, files, setFiles, gps }: {
  label: string; kind: 'photo' | 'document'; files: Uploaded[]; setFiles: (f: Uploaded[]) => void; gps: { lat: number; lon: number; accuracy_m: number } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="picker">
      <label className="file-btn">
        {busy ? 'Uploading…' : `+ ${label}`}
        <input type="file" hidden multiple accept={kind === 'photo' ? 'image/*' : 'application/pdf,image/*'} {...(kind === 'photo' ? { capture: 'environment' } : {})}
          onChange={async (e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            setBusy(true);
            setErr('');
            try {
              const out = [...files];
              for (const f of list) out.push(await uploadFile(f, kind, gps));
              setFiles(out);
            } catch (x) {
              setErr((x as Error).message);
            } finally {
              setBusy(false);
            }
          }} />
      </label>
      {files.map((f) => (
        <span key={f.id} className="file-chip">
          {kind === 'photo' ? <img src={`/api/files/${f.id}`} alt="" /> : '📄'} {f.name.slice(0, 18)}
          <button className="link" onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>✕</button>
        </span>
      ))}
      {err && <span className="error small">{err}</span>}
    </div>
  );
}

// ---------------- Compliance ----------------
function ComplianceTab({ card, me, onSaved }: { card: Card; me: { id: string; role: string }; onSaved: (c: Card) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const sum = card.compliance.summary;
  const recs = card.compliance.records;
  return (
    <div className="compliance">
      <div className="sum-grid">
        <div><b>{sum.score === null ? '—' : `${sum.score}%`}</b><span>score (verified ÷ due)</span></div>
        <div><b>{sum.due}</b><span>mandatory due</span></div>
        <div><b>{sum.to_verify}</b><span>to verify</span></div>
        <div className={sum.overdue ? 'bad' : ''}><b>{sum.overdue}</b><span>overdue</span></div>
        <div className={sum.not_complied ? 'bad' : ''}><b>{sum.not_complied}</b><span>not complied</span></div>
      </div>
      {card.compliance.stages.map((stg) => {
        const items = stg.items.filter((i) => i.applies);
        if (!items.length) return null;
        return (
          <section key={stg.key} className="cstage">
            <h4>{stg.no}. {stg.label} <span className="muted small">{stg.reached_at ? `due since ${fmtDate(stg.reached_at)}` : `due when: ${stg.dueWhen.toLowerCase()}`}</span></h4>
            {items.map((iv) => {
              const k = iv.item.key;
              const itemRecs = recs.filter((r) => r.item_key === k);
              return (
                <div key={k} className="citem">
                  <button className="citem-head" onClick={() => setOpen(open === k ? null : k)}>
                    <span className="dot" style={{ background: UNIT_STATE_COLOR[iv.state] }} />
                    <span className="grow">{iv.item.name}{!iv.item.mandatory && <span className="muted small"> (optional)</span>}</span>
                    <span className="small" style={{ color: UNIT_STATE_COLOR[iv.state] }}>{iv.state_label}{iv.progress ? ` · ${iv.progress}` : ''}</span>
                  </button>
                  {open === k && (
                    <div className="citem-body small">
                      <p className="muted">{iv.item.description}</p>
                      <p>
                        Evidence: {iv.item.evidence.map((e) => EVIDENCE_KINDS.find((x) => x.key === e)?.label).join(', ')}
                        {iv.item.evidence.includes('value') && ` · ${iv.item.value_label ?? 'Value'} (${iv.item.unit ?? ''}): ${passRuleText(iv.item.pass_rule, iv.item.unit)}`}
                        {iv.item.recurring_days && ` · repeats every ${iv.item.recurring_days} day(s) while the trench is open`}
                        {' · '}gate: {iv.item.gate === 'block' ? 'blocks' : iv.item.gate === 'warn' ? 'warns' : 'none'} at “{stg.guards.toLowerCase()}” · overdue after {iv.item.grace_days} day(s) · version {iv.item.version}
                      </p>
                      {iv.units.length > 1 && (
                        <ul className="units">{iv.units.map((u) => <li key={u.unit.id}><span className="dot" style={{ background: UNIT_STATE_COLOR[u.state] }} />{u.unit.label} — {u.state_label}</li>)}</ul>
                      )}
                      {card.can.record_compliance && recording !== k && <button className="primary" onClick={() => setRecording(k)}>Record compliance</button>}
                      {recording === k && <RecordForm card={card} iv={iv} onDone={(c) => { setRecording(null); if (c) onSaved(c); }} />}
                      {itemRecs.map((r) => <RecordRow key={r.id} r={r} card={card} me={me} onSaved={onSaved} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {card.compliance.stages.every((s) => s.items.every((i) => !i.applies)) && <p className="muted">No compliance items apply.</p>}
    </div>
  );
}

function RecordForm({ card, iv, onDone }: { card: Card; iv: ItemView; onDone: (c?: Card) => void }) {
  const it = iv.item;
  const firstOpen = iv.units.find((u) => !['complied', 'verified', 'not_applicable'].includes(u.state)) ?? iv.units[0];
  const [unit, setUnit] = useState(firstOpen.unit.id);
  const [result, setResult] = useState<'complied' | 'not_complied' | 'not_applicable'>('complied');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [docs, setDocs] = useState<Uploaded[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const { gps, state } = useGps(true);
  const u = iv.units.find((x) => x.unit.id === unit);
  const ev = (k: string) => it.evidence.includes(k as never);
  const submit = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api<{ card: Card; result: string; messages: string[] }>(`/api/stretches/${card.stretch.code}/compliance`, {
        item_key: it.key, unit, result, value: value === '' ? null : Number(value), value_date: ev('date') || date ? date : null,
        reference, reason, photos: photos.map((p) => p.id), documents: docs.map((d) => d.id), gps,
      });
      if (r.messages.length) alert(r.messages.join('\n'));
      onDone(r.card);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="record-form">
      <GpsBadge state={state} gps={gps} />
      {iv.units.length > 1 && (
        <label>For
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>{iv.units.map((x) => <option key={x.unit.id} value={x.unit.id}>{x.unit.label} ({x.state_label})</option>)}</select>
        </label>
      )}
      <div className="seg">
        {(['complied', 'not_complied', 'not_applicable'] as const).map((r) => (
          <button key={r} className={result === r ? 'on' : ''} onClick={() => setResult(r)}>{{ complied: 'Complied', not_complied: 'Not complied', not_applicable: 'Not applicable' }[r]}</button>
        ))}
      </div>
      {(ev('value') || it.pass_rule) && result !== 'not_applicable' && (
        <label>{it.value_label ?? 'Measured value'} ({it.unit ?? ''}){u?.unit.design_invert != null && <span className="muted"> · design {u.unit.design_invert} m</span>}
          <input type="number" step="any" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          <span className="muted">{passRuleText(it.pass_rule, it.unit)}</span>
        </label>
      )}
      {ev('date') && <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
      {ev('reference') && <label>Reference no. <input value={reference} onChange={(e) => setReference(e.target.value)} /></label>}
      {(ev('photo') || result !== 'complied') && <PhotoPicker label="Photo" kind="photo" files={photos} setFiles={setPhotos} gps={gps} />}
      {ev('document') && <PhotoPicker label="Document (PDF or image)" kind="document" files={docs} setFiles={setDocs} gps={gps} />}
      {result !== 'complied' && <label>{result === 'not_applicable' ? 'Why it does not apply' : 'What was not complied'} <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
      {msg && <p className="error">{msg}</p>}
      <div className="row-btns">
        <button className="primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save record'}</button>
        <button onClick={() => onDone()}>Cancel</button>
      </div>
    </div>
  );
}

function RecordRow({ r, card, me, onSaved }: { r: Rec; card: Card; me: { id: string; role: string }; onSaved: (c: Card) => void }) {
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const canVerify = card.can.verify && r.verification === 'waiting' && (r.recorded_by !== me.id || me.role === 'commissioner');
  const verify = async (decision: 'accept' | 'reject') => {
    try {
      const x = await api<{ card: Card }>(`/api/compliance/records/${r.id}/verify`, { decision, note });
      onSaved(x.card);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const word = { complied: 'Complied', not_complied: 'Not complied', not_applicable: 'Not applicable' }[r.result];
  const ver = r.verification === 'waiting' ? 'waiting for verification' : r.verification === 'accepted' ? `verified by ${r.verified_by_name}` : `rejected by ${r.verified_by_name}`;
  return (
    <div className={`rec rec-${r.verification}`}>
      <div><b>{word}</b>{r.unit && r.unit !== '' ? ` · ${r.unit === '*' ? 'others together' : r.unit}` : ''} · {fmtTime(r.recorded_at)} · {r.recorded_by_name} · <i>{ver}</i></div>
      <div className="muted">
        {r.value !== null && `Value ${r.value}${r.design_value !== null ? ` (design ${r.design_value})` : ''} · `}
        {r.value_date && `Date ${fmtDate(r.value_date)} · `}{r.reference && `Ref ${r.reference} · `}{r.reason && `${r.reason} · `}
        {r.distance_m !== null && `${r.distance_m} m from the road · `}v{r.item_version}{r.verify_note && ` · “${r.verify_note}”`}
      </div>
      <div className="thumbs">
        {r.photos.map((p) => <a key={p} href={`/api/files/${p}`} target="_blank" rel="noreferrer"><img src={`/api/files/${p}`} alt="evidence" /></a>)}
        {r.documents.map((d) => <a key={d} href={`/api/files/${d}`} target="_blank" rel="noreferrer">📄 document</a>)}
      </div>
      {canVerify && (
        <div className="row-btns">
          <input placeholder="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary" onClick={() => verify('accept')}>Verify</button>
          <button className="danger" onClick={() => verify('reject')}>Reject</button>
        </div>
      )}
      {msg && <p className="error">{msg}</p>}
    </div>
  );
}

// ---------------- History (timeline) ----------------
interface Hist {
  id: number; version: number; kind: string; at: string; by_name: string | null; by_role: string | null; changes: { label: string; from: string; to: string }[];
  note: string; photos: string[]; gps: { accuracy_m?: number } | null; distance_m: number | null; warnings: string[]; override: string;
}
const KINDS: Record<string, { label: string; color: string; mark: string; group: string }> = {
  created: { label: 'Work stretch made', color: '#6366f1', mark: '★', group: 'network' },
  network: { label: 'Pipes / points changed', color: '#8b5cf6', mark: '✎', group: 'network' },
  status: { label: 'Status updated', color: '#3b82f6', mark: '●', group: 'status' },
  compliance: { label: 'Compliance recorded', color: '#0d9488', mark: '✓', group: 'compliance' },
  verification: { label: 'Compliance verified', color: '#16a34a', mark: '✔', group: 'compliance' },
  approval: { label: 'Restoration decision', color: '#65a30d', mark: '◆', group: 'approval' },
  issue: { label: 'Issue action', color: '#f59e0b', mark: '!', group: 'issue' },
  rollback: { label: 'Rolled back', color: '#6b7280', mark: '↺', group: 'network' },
};
const FILTERS: [string, string][] = [['all', 'All'], ['status', 'Status'], ['compliance', 'Compliance'], ['approval', 'Approvals'], ['issue', 'Issues'], ['network', 'Pipes & points']];
const dayKey = (d: string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dayLabel = (k: string) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const yest = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const nice = new Date(`${k}T12:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return k === today ? `Today · ${nice}` : k === yest ? `Yesterday · ${nice}` : nice;
};
const clock = (d: string) => new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
function gap(a: string, b: string) {
  const m = Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
  if (m < 60) return null;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  const d = Math.round(m / 1440);
  return `${d} day${d === 1 ? '' : 's'}`;
}

function HistoryTab({ code, version }: { code: string; version: number }) {
  const [rows, setRows] = useState<Hist[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [newest, setNewest] = useState(true);
  useEffect(() => {
    api<{ history: Hist[] }>(`/api/stretches/${code}/history`).then((r) => setRows(r.history));
  }, [code, version]);
  if (!rows) return <p className="muted">Loading…</p>;
  const kind = (k: string) => KINDS[k] ?? { label: k, color: '#6b7280', mark: '•', group: 'other' };
  const shown = rows.filter((h) => filter === 'all' || kind(h.kind).group === filter);
  const ordered = newest ? shown : [...shown].reverse();
  const days: { key: string; items: Hist[] }[] = [];
  for (const h of ordered) {
    const k = dayKey(h.at);
    if (!days.length || days[days.length - 1].key !== k) days.push({ key: k, items: [] });
    days[days.length - 1].items.push(h);
  }
  return (
    <div className="timeline">
      <div className="tl-bar">
        <div className="tl-filters">
          {FILTERS.map(([k, l]) => {
            const n = k === 'all' ? rows.length : rows.filter((h) => kind(h.kind).group === k).length;
            return <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)} disabled={!n && k !== 'all'}>{l} <span>{n}</span></button>;
          })}
        </div>
        <button className="btn ghost" onClick={() => setNewest(!newest)}>{newest ? 'Newest first ↓' : 'Oldest first ↑'}</button>
      </div>
      {!ordered.length && <p className="muted">Nothing of this kind yet.</p>}
      {days.map((d) => (
        <section key={d.key} className="tl-day">
          <div className="tl-date">{dayLabel(d.key)} <span className="muted">· {d.items.length} event{d.items.length === 1 ? '' : 's'}</span></div>
          <ol className="tl-list">
            {d.items.map((h, i) => {
              const k = kind(h.kind);
              const next = d.items[i + 1];
              const g = next ? gap(h.at, next.at) : null;
              return (
                <li key={h.id} className="tl-item">
                  <div className="tl-time">{clock(h.at)}</div>
                  <div className="tl-rail"><span className="tl-dot" style={{ background: k.color }}>{k.mark}</span></div>
                  <div className="tl-card">
                    <div className="tl-head">
                      <b>{k.label}</b>
                      <span className="tl-ver">v{h.version}</span>
                    </div>
                    <div className="tl-who">{h.by_name ?? 'System'}{h.by_role ? ` · ${ROLE_LABEL[h.by_role as keyof typeof ROLE_LABEL] ?? h.by_role}` : ''}
                      {h.distance_m !== null && <span className="tl-gps"> · 📍 {h.distance_m} m from the road{h.gps?.accuracy_m ? ` (GPS ±${h.gps.accuracy_m} m)` : ''}</span>}
                    </div>
                    {h.changes.length > 0 && (
                      <div className="tl-changes">
                        {h.changes.map((c, ci) => (
                          <div key={ci} className="tl-change">
                            <span className="tl-field">{c.label}</span>
                            <span className="tl-vals">{c.from && <s className="tl-from">{c.from}</s>}{c.from && <span className="tl-arrow">→</span>}<b className="tl-to">{c.to}</b></span>
                          </div>
                        ))}
                      </div>
                    )}
                    {h.note && <div className="tl-note">“{h.note}”</div>}
                    {h.override && <div className="tl-warn">Commissioner override: {h.override}</div>}
                    {h.warnings.map((w) => <div key={w} className="tl-warn">⚠ {w}</div>)}
                    {h.photos.length > 0 && <div className="thumbs">{h.photos.map((p) => <a key={p} href={`/api/files/${p}`} target="_blank" rel="noreferrer"><img src={`/api/files/${p}`} alt="" /></a>)}</div>}
                  </div>
                  {g && <div className="tl-gap">{g} {newest ? 'earlier' : 'later'}</div>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

// ---------------- Issues ----------------
function IssuesTab({ card, reload }: { card: Card; reload: () => void }) {
  const [reporting, setReporting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  return (
    <div className="issues-tab">
      {card.can.report_issue && !reporting && <button className="primary" onClick={() => { setReporting(true); setMsg(''); }}>Report issue</button>}
      {reporting && <ReportIssueModal stretchCode={card.stretch.code} onDone={(c) => { setReporting(false); if (c) { setMsg(`Issue ${c} reported.`); reload(); } }} />}
      {msg && <p className="ok small">{msg}</p>}
      {!card.issues.length && <p className="muted">No issues on this stretch.</p>}
      {card.issues.map((i) => (
        <button key={i.code} className="board-card" style={{ borderLeftColor: SEVERITY_COLOR[i.severity], opacity: i.status === 'resolved' ? 0.6 : 1 }} onClick={() => setOpen(i.code)}>
          <b>{i.code}</b> · {i.title}{i.count > 1 ? ` (${i.count})` : ''} · {ISSUE_STATUS.find((x) => x.key === i.status)?.label}
          <div className="muted small">{fmtTime(i.created_at)} · {i.created_by_name ?? 'raised automatically'}{i.assignee_name ? ` · assigned to ${i.assignee_name}` : ''}{i.due_date && i.status !== 'resolved' ? ` · due ${fmtDate(i.due_date)}` : ''}</div>
          {i.overdue && <div className="error small">Overdue</div>}
        </button>
      ))}
      {open && <IssueDetail code={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
