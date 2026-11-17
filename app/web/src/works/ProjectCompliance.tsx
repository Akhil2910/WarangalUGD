/** Project-level compliance: three phases, item list, detail panel (submit, verify, override), list editing. */
import { useEffect, useMemo, useState } from 'react';
import {
  FREQUENCIES, PHASES, PROJECT_CATEGORIES, PROJECT_EVIDENCE, PROJECT_STATUS, PROJECT_SUBMIT_ROLES, ROLE_LABEL, type Phase, type ProjectStatus,
} from 'shared';
import { api } from '../api.ts';
import { Modal } from './Modal.tsx';
import { fmtDate, fmtTime, uploadFile, type Uploaded } from './util.tsx';

interface Rec {
  id: number; status: string; reference: string; doc_date: string | null; valid_from: string | null; valid_to: string | null; note: string;
  files: { id: string; name: string; kind: string }[]; submitted_by_name: string | null; submitted_at: string | null;
  decided_by_name: string | null; decided_at: string | null; decision_note: string; override: string;
}
interface Per { key: string; label: string; due: string | null; status: ProjectStatus; status_label: string; record: Rec | null; can_submit: boolean; can_verify: boolean }
interface Item {
  key: string; phase: Phase; category: string; name: string; description: string; frequency: string; due_day: number; has_validity: boolean;
  evidence: string[]; gate: 'none' | 'warn' | 'block'; mandatory: boolean; active: boolean; status: ProjectStatus; status_label: string; periods: Per[]; can_override: boolean;
}
interface Sum { phase: Phase; label: string; open: boolean; items: number; asked: number; done: number; overdue: number; expiring: number; waiting: number; score: number | null }
interface State { settings: { name: string; work_start: string | null; completion: string | null }; items: Item[]; summary: Sum[]; today: string }

const TONE: Record<string, string> = { ok: 'ok', bad: 'bad', wait: 'wait', due: 'due', none: 'none' };
export const chipClass = (s: ProjectStatus) => `pchip ${TONE[PROJECT_STATUS[s].tone]}`;
const FILTERS: [string, string][] = [['all', 'All'], ['action', 'Needs action'], ['bad', 'Overdue or expiring'], ['waiting', 'Waiting for verification']];
const needsAction = (s: ProjectStatus) => ['due', 'overdue', 'rejected', 'expired', 'expiring', 'waiting'].includes(s);

export function ProjectCompliance({ role, isCommissioner, focus, onChanged, refreshKey }: {
  role: string; isCommissioner: boolean; focus?: { key: string; period?: string } | null; onChanged: () => void; refreshKey: number;
}) {
  const [st, setSt] = useState<State | null>(null);
  const [phase, setPhase] = useState<Phase>('pre');
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<false | 'list' | 'dates'>(false);
  useEffect(() => { api<State>('/api/project').then(setSt); }, [tick, refreshKey]);
  useEffect(() => {
    if (!focus || !st) return;
    const it = st.items.find((i) => i.key === focus.key);
    if (it) { setPhase(it.phase); setSel(it.key); setFilter('all'); }
  }, [focus, st?.today]);
  const reload = () => { setTick((t) => t + 1); onChanged(); };
  const items = useMemo(() => (st?.items ?? []).filter((i) => i.phase === phase).filter((i) =>
    filter === 'all' ? true : filter === 'action' ? needsAction(i.status) : filter === 'bad' ? ['overdue', 'expired', 'rejected', 'expiring'].includes(i.status) : i.status === 'waiting'), [st, phase, filter]);
  if (!st) return <p className="muted">Loading…</p>;
  const cur = st.items.find((i) => i.key === sel && i.phase === phase) ?? items[0] ?? null;
  const cats = PROJECT_CATEGORIES.filter((c) => items.some((i) => i.category === c));
  return (
    <div className="pc">
      <div className="pc-head">
        <div>
          <b>{st.settings.name}</b>
          <span className="muted small"> · work start {st.settings.work_start ? fmtDate(st.settings.work_start) : 'not set'} · completion {st.settings.completion ? fmtDate(st.settings.completion) : 'not yet'}</span>
        </div>
        {isCommissioner && <div className="row-btns"><button className="btn" onClick={() => setEditing('dates')}>Project dates</button><button className="btn" onClick={() => setEditing('list')}>Edit the list</button></div>}
      </div>
      <div className="pc-phases">
        {st.summary.map((s) => (
          <button key={s.phase} className={`pc-phase ${s.phase === phase ? 'on' : ''}`} onClick={() => { setPhase(s.phase); setSel(null); }}>
            <div className="pc-phase-top"><b>{s.label}</b><span className="fig">{s.asked ? `${s.done}/${s.asked}` : '—'}</span></div>
            <div className="meter-track"><span style={{ width: `${s.asked ? (s.done / s.asked) * 100 : 0}%`, background: 'var(--ok)' }} /></div>
            <div className="pc-phase-foot">
              {!s.open && !s.asked ? <span className="muted">Not started yet</span> : (
                <>
                  {s.overdue > 0 && <span className="bad-t">{s.overdue} overdue</span>}
                  {s.expiring > 0 && <span className="bad-t">{s.expiring} expiring</span>}
                  {s.waiting > 0 && <span className="wait-t">{s.waiting} to verify</span>}
                  {!s.overdue && !s.expiring && !s.waiting && <span className="ok-t">{s.score === null ? 'Nothing due yet' : 'On track'}</span>}
                </>
              )}
            </div>
          </button>
        ))}
      </div>
      <div className="pc-main">
        <section className="pc-list">
          <div className="pc-list-head">
            <b>{PHASES.find((p) => p.key === phase)!.label} items</b>
            <div className="pc-filters">{FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
          </div>
          {!items.length && <p className="muted empty-note" style={{ padding: '10px 14px' }}>Nothing here for this filter.</p>}
          {cats.map((c) => (
            <div key={c}>
              <div className="pc-cat">{c}</div>
              {items.filter((i) => i.category === c).map((i) => {
                const latest = i.periods[0];
                return (
                  <button key={i.key} className={`pc-row ${cur?.key === i.key ? 'on' : ''}`} onClick={() => setSel(i.key)}>
                    <span className="grow">
                      <span className="pc-name">{i.name}{i.gate === 'block' && <span className="pc-lock" title="Work cannot start on any road until this is verified"> 🔒</span>}</span>
                      <span className="muted small">{FREQUENCIES.find((f) => f.key === i.frequency)?.label}{latest?.label ? ` · ${latest.label}` : ''}{latest?.record?.valid_to ? ` · valid till ${fmtDate(latest.record.valid_to)}` : latest?.due ? ` · due ${fmtDate(latest.due)}` : ''}</span>
                    </span>
                    <span className={chipClass(i.status)}>{i.status_label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </section>
        <section className="pc-detail">{cur ? <Detail key={`${cur.key}|${focus?.period ?? ''}`} it={cur} role={role} focusPeriod={focus?.key === cur.key ? focus.period : undefined} onDone={reload} /> : <p className="muted">Choose an item.</p>}</section>
      </div>
      {editing === 'list' && <ItemsEditor onClose={(ch) => { setEditing(false); if (ch) reload(); }} />}
      {editing === 'dates' && <DatesEditor s={st.settings} onClose={(ch) => { setEditing(false); if (ch) reload(); }} />}
    </div>
  );
}

function Detail({ it, focusPeriod, onDone, role }: { it: Item; focusPeriod?: string; onDone: () => void; role: string }) {
  const [pk, setPk] = useState<string | null>(focusPeriod ?? (it.periods.find((p) => needsAction(p.status))?.key ?? it.periods[0]?.key ?? null));
  const [hist, setHist] = useState<{ kind: string; note: string; at: string; by_name: string | null; by_role: string | null; period: string }[]>([]);
  const [mode, setMode] = useState<'' | 'submit' | 'override'>('');
  const per = it.periods.find((p) => p.key === pk) ?? null;
  useEffect(() => { api<{ history: typeof hist }>(`/api/project/items/${it.key}/history`).then((r) => setHist(r.history)); }, [it.key, it.status, per?.status]);
  const r = per?.record ?? null;
  const ev = it.evidence.map((e) => PROJECT_EVIDENCE.find((x) => x.key === e)?.label ?? e).join(', ');
  const isEvent = it.frequency === 'event';
  return (
    <div className="pc-det">
      <div className="muted small">{PHASES.find((p) => p.key === it.phase)!.label} · {it.category}</div>
      <h3>{it.name}</h3>
      <span className={chipClass(per?.status ?? it.status)}>{per?.status_label ?? it.status_label}</span>
      {it.description && <p className="pc-desc">{it.description}</p>}
      <div className="pc-facts">
        <div><span>Proof</span><b>{ev}{it.has_validity ? ', valid-until date' : ''}</b></div>
        <div><span>How often</span><b>{FREQUENCIES.find((f) => f.key === it.frequency)?.label}{it.frequency === 'monthly' || it.frequency === 'quarterly' ? ` · by day ${it.due_day} of the next month` : ''}</b></div>
        <div><span>Who</span><b>Contractor / PIU submits · PMU verifies</b></div>
        {it.gate !== 'none' && <div><span>If missing</span><b className={it.gate === 'block' ? 'bad-t' : ''}>{it.gate === 'block' ? 'Work cannot start on any road' : 'Warning when work starts on a road'}</b></div>}
      </div>
      {!isEvent && it.periods.length > 1 && (
        <div className="pc-periods">
          {it.periods.map((p) => <button key={p.key} className={`pc-per ${p.key === pk ? 'on' : ''}`} onClick={() => { setPk(p.key); setMode(''); }}><span>{p.label}</span><i className={`dotk ${PROJECT_STATUS[p.status].tone}`} title={p.status_label} /></button>)}
        </div>
      )}
      {isEvent && <p className="muted small">{it.periods.length ? `${it.periods.length} reported` : 'None reported.'} Report each one within a day.</p>}
      {isEvent && it.periods.length > 0 && (
        <div className="pc-periods">{it.periods.map((p) => <button key={p.key} className={`pc-per ${p.key === pk ? 'on' : ''}`} onClick={() => setPk(p.key)}><span>{p.label}</span><i className={`dotk ${PROJECT_STATUS[p.status].tone}`} /></button>)}</div>
      )}
      {per && !isEvent && <div className="small muted">{per.label ? `${per.label} · ` : ''}{per.due ? `due ${fmtDate(per.due)}` : it.phase === 'post' ? 'due after completion' : 'due before work starts'}</div>}
      {r && (
        <div className="pc-rec">
          {r.override ? <div><b>Commissioner override:</b> {r.override}</div> : (
            <>
              {r.reference && <div><span>Reference</span> {r.reference}</div>}
              {r.doc_date && <div><span>Date</span> {fmtDate(r.doc_date)}</div>}
              {(r.valid_from || r.valid_to) && <div><span>Valid</span> {r.valid_from ? fmtDate(r.valid_from) : '…'} to {r.valid_to ? fmtDate(r.valid_to) : '…'}</div>}
              {r.files.length > 0 && <div><span>Files</span> {r.files.map((f) => <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">{f.name || f.kind}</a>)}</div>}
              {r.note && <div><span>Note</span> {r.note}</div>}
              <div className="muted small">Submitted by {r.submitted_by_name ?? '—'} · {fmtTime(r.submitted_at)}</div>
            </>
          )}
          {r.decided_at && !r.override && <div className={r.status === 'rejected' ? 'bad-t' : 'ok-t'}>{r.status === 'rejected' ? 'Rejected' : 'Verified'} by {r.decided_by_name} · {fmtTime(r.decided_at)}{r.decision_note ? ` — ${r.decision_note}` : ''}</div>}
        </div>
      )}
      {per?.can_verify && r && <Decide id={r.id} onDone={onDone} />}
      {mode === '' && (
        <div className="row-btns">
          {canSubmitRole(role) && (isEvent || per?.can_submit) && (
            <button className="btn primary" onClick={() => setMode('submit')}>{isEvent ? 'Report an event' : per?.status === 'expiring' || per?.status === 'expired' ? 'Renew' : 'Submit proof'}</button>
          )}
          {it.can_override && per && !['verified', 'expiring', 'waiting'].includes(per.status) && !isEvent && <button className="btn" onClick={() => setMode('override')}>Override</button>}
        </div>
      )}
      {mode === 'submit' && <SubmitForm it={it} period={isEvent ? '' : (pk ?? '')} onCancel={() => setMode('')} onDone={() => { setMode(''); onDone(); }} />}
      {mode === 'override' && <OverrideForm it={it} period={pk ?? ''} onCancel={() => setMode('')} onDone={() => { setMode(''); onDone(); }} />}
      {hist.length > 0 && (
        <div className="pc-hist">
          <div className="small"><b>History</b></div>
          {hist.slice(0, 12).map((h, i) => (
            <div key={i} className="pc-hrow"><i className={`dotk ${h.kind === 'verified' || h.kind === 'overridden' ? 'ok' : h.kind === 'rejected' ? 'bad' : 'wait'}`} />
              <span className="grow"><b>{{ submitted: 'Submitted', verified: 'Verified', rejected: 'Rejected', overridden: 'Overridden' }[h.kind] ?? h.kind}</b>{h.period && !isEvent ? ` · ${h.period}` : ''} · {h.by_name ?? '—'}{h.by_role ? ` (${ROLE_LABEL[h.by_role as keyof typeof ROLE_LABEL] ?? h.by_role})` : ''}{h.note ? ` — ${h.note}` : ''}</span>
              <span className="muted small">{fmtTime(h.at)}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
const canSubmitRole = (role: string) => (PROJECT_SUBMIT_ROLES as readonly string[]).includes(role);

function Decide({ id, onDone }: { id: number; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const go = async (decision: 'verify' | 'reject') => {
    setMsg('');
    try { await api(`/api/project/records/${id}/decide`, { decision, note }); onDone(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="pc-form">
      <label className="field">Remark (needed to reject)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was checked, or what to correct" /></label>
      {msg && <p className="error">{msg}</p>}
      <div className="row-btns"><button className="btn danger" onClick={() => go('reject')}>Reject</button><button className="btn primary" onClick={() => go('verify')}>Verify</button></div>
    </div>
  );
}

function SubmitForm({ it, period, onCancel, onDone }: { it: Item; period: string; onCancel: () => void; onDone: () => void }) {
  const [f, setF] = useState({ reference: '', doc_date: '', valid_from: '', valid_to: '', note: '' });
  const [files, setFiles] = useState<{ name: string; size: number; state: 'uploading' | 'ok' | 'failed'; reason?: string; up?: Uploaded }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const LIMIT_MB = 10;
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  const add = async (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) {
      const isImg = file.type.startsWith('image/');
      if (!isImg && file.type !== 'application/pdf') { setFiles((x) => [...x, { name: file.name, size: file.size, state: 'failed', reason: 'Only PDF files or photos can be attached.' }]); continue; }
      if (!isImg && file.size > LIMIT_MB * 1024 * 1024) { setFiles((x) => [...x, { name: file.name, size: file.size, state: 'failed', reason: `Too large (${mb(file.size)}); the limit is ${LIMIT_MB} MB. Save a smaller PDF (fewer pages or lower quality) and attach it again.` }]); continue; }
      setFiles((x) => [...x, { name: file.name, size: file.size, state: 'uploading' }]);
      try {
        const up = await uploadFile(file, isImg && it.evidence.includes('photo') && !it.evidence.includes('document') ? 'photo' : 'document', null);
        setFiles((x) => x.map((y) => (y.name === file.name && y.state === 'uploading' ? { ...y, state: 'ok', up } : y)));
      } catch (e) {
        setFiles((x) => x.map((y) => (y.name === file.name && y.state === 'uploading' ? { ...y, state: 'failed', reason: (e as Error).message } : y)));
      }
    }
  };
  const uploading = files.some((x) => x.state === 'uploading');
  const attached = files.filter((x) => x.state === 'ok' && x.up).map((x) => x.up!);
  const send = async () => {
    setBusy(true); setMsg('');
    try {
      await api(`/api/project/items/${it.key}/submit`, { period, reference: f.reference, doc_date: f.doc_date || null, valid_from: f.valid_from || null, valid_to: f.valid_to || null, note: f.note, files: attached });
      onDone();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const needFile = it.evidence.includes('document') || it.evidence.includes('photo');
  return (
    <div className="pc-form">
      {needFile && (
        <div className="field">
          <span>{it.evidence.includes('document') ? 'Document (PDF or photo of it)' : 'Photo'} <span className="muted small">· PDF up to {LIMIT_MB} MB; photos are made smaller on their own</span></span>
          <label className="file-pick">
            <input type="file" multiple accept="application/pdf,image/*" onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
            <span className="btn">Choose file…</span>
          </label>
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((x, i) => (
                <li key={i} className={x.state}>
                  <span className="grow"><b>{x.name}</b> <span className="muted small">{mb(x.size)}</span>{x.reason && <div className="error small">{x.reason}</div>}</span>
                  <span className="small">{x.state === 'uploading' ? 'Uploading…' : x.state === 'ok' ? 'Attached ✓' : 'Not attached'}</span>
                  {x.state !== 'uploading' && <button className="link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="two">
        {it.evidence.includes('reference') && <label className="field">Reference no.<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>}
        {it.evidence.includes('date') && <label className="field">Date<input type="date" value={f.doc_date} onChange={(e) => setF({ ...f, doc_date: e.target.value })} /></label>}
        {it.has_validity && <label className="field">Valid from<input type="date" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></label>}
        {it.has_validity && <label className="field">Valid until<input type="date" value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} /></label>}
      </div>
      <label className="field">Remark<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      {msg && <p className="error">{msg}</p>}
      <div className="row-btns"><button className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={busy || uploading} onClick={send}>{busy ? 'Please wait…' : uploading ? 'Waiting for the upload…' : 'Submit for verification'}</button></div>
    </div>
  );
}

function OverrideForm({ it, period, onCancel, onDone }: { it: Item; period: string; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <div className="pc-form">
      <label className="field">Reason for the override (kept in the history)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {msg && <p className="error">{msg}</p>}
      <div className="row-btns"><button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={async () => { setMsg(''); try { await api(`/api/project/items/${it.key}/override`, { period, reason }); onDone(); } catch (e) { setMsg((e as Error).message); } }}>Mark as complied</button></div>
    </div>
  );
}

function DatesEditor({ s, onClose }: { s: State['settings']; onClose: (changed: boolean) => void }) {
  const [f, setF] = useState({ name: s.name, work_start: s.work_start ?? '', completion: s.completion ?? '' });
  const [msg, setMsg] = useState('');
  return (
    <Modal title="Project dates" size="small" onClose={() => onClose(false)}
      footer={<><span className="grow" /><button className="btn" onClick={() => onClose(false)}>Cancel</button>
        <button className="btn primary" onClick={async () => { setMsg(''); try { await api('/api/project/settings', { name: f.name, work_start: f.work_start || null, completion: f.completion || null }); onClose(true); } catch (e) { setMsg((e as Error).message); } }}>Save</button></>}>
      <label className="field">Project name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field">Work start (pre-work items are due by this date; monthly items start from this month)<input type="date" value={f.work_start} onChange={(e) => setF({ ...f, work_start: e.target.value })} /></label>
      <label className="field">Completion (post-work items become due from this date)<input type="date" value={f.completion} onChange={(e) => setF({ ...f, completion: e.target.value })} /></label>
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}

type EditItem = Omit<Item, 'status' | 'status_label' | 'periods' | 'can_override'>;
function ItemsEditor({ onClose }: { onClose: (changed: boolean) => void }) {
  const [list, setList] = useState<EditItem[]>([]);
  const [edit, setEdit] = useState<Partial<EditItem> | null>(null);
  const [changed, setChanged] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api<{ items: EditItem[] }>('/api/project/items').then((r) => setList(r.items));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setMsg('');
    try { await api('/api/project/items', { ...edit, active: edit!.active ?? true }); setEdit(null); setChanged(true); load(); } catch (e) { setMsg((e as Error).message); }
  };
  const blank: Partial<EditItem> = { phase: 'pre', category: PROJECT_CATEGORIES[0], name: '', description: '', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true, active: true };
  return (
    <Modal title="Project compliance list" size="large" onClose={() => onClose(changed)}
      footer={<><button className="btn" onClick={() => setEdit(blank)}>+ Add an item</button><span className="grow" /><button className="btn primary" onClick={() => onClose(changed)}>Done</button></>}>
      {edit ? (
        <div className="pc-form">
          <div className="two">
            <label className="field">Phase<select value={edit.phase} onChange={(e) => setEdit({ ...edit, phase: e.target.value as Phase })}>{PHASES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
            <label className="field">Category<select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{PROJECT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          </div>
          <label className="field">Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field">What is needed<input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
          <div className="two">
            <label className="field">How often<select value={edit.frequency} onChange={(e) => setEdit({ ...edit, frequency: e.target.value })}>{FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
            <label className="field">{edit.frequency === 'once' ? (edit.phase === 'post' ? 'Days after completion' : 'Days before work start') : 'Due on day … of the next month'}<input type="number" min={0} max={365} value={edit.due_day} onChange={(e) => setEdit({ ...edit, due_day: Number(e.target.value) })} /></label>
            <label className="field">If missing when work starts<select value={edit.gate} onChange={(e) => setEdit({ ...edit, gate: e.target.value as EditItem['gate'] })}><option value="none">Nothing</option><option value="warn">Warn</option><option value="block">Stop the work</option></select></label>
            <label className="field">Proof needed
              <span className="chips">{PROJECT_EVIDENCE.map((ev) => <label key={ev.key} className="check-row"><input type="checkbox" checked={edit.evidence?.includes(ev.key)} onChange={(e) => setEdit({ ...edit, evidence: e.target.checked ? [...(edit.evidence ?? []), ev.key] : (edit.evidence ?? []).filter((x) => x !== ev.key) })} /> {ev.label}</label>)}</span>
            </label>
          </div>
          <label className="check-row"><input type="checkbox" checked={!!edit.has_validity} onChange={(e) => setEdit({ ...edit, has_validity: e.target.checked })} /> Has a valid-until date (warn 30 days before it expires)</label>
          <label className="check-row"><input type="checkbox" checked={!!edit.mandatory} onChange={(e) => setEdit({ ...edit, mandatory: e.target.checked })} /> Mandatory</label>
          {msg && <p className="error">{msg}</p>}
          <div className="row-btns"><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save item</button></div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Phase</th><th>Item</th><th>How often</th><th>If missing</th><th></th></tr></thead>
            <tbody>{list.map((i) => (
              <tr key={i.key} className={i.active ? '' : 'retired'}>
                <td className="small">{PHASES.find((p) => p.key === i.phase)?.label}</td>
                <td><b>{i.name}</b><div className="muted small">{i.category}</div></td>
                <td className="small">{FREQUENCIES.find((f) => f.key === i.frequency)?.label}</td>
                <td className="small">{i.gate === 'block' ? 'Stops work' : i.gate === 'warn' ? 'Warns' : '—'}</td>
                <td><div className="row-btns">
                  <button className="btn ghost" onClick={() => setEdit(i)}>Edit</button>
                  <button className="btn ghost" onClick={async () => { await api('/api/project/items', { ...i, active: !i.active }); setChanged(true); load(); }}>{i.active ? 'Retire' : 'Bring back'}</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
