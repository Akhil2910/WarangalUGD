/** Compliance: all records (with verification), and the compliance list (Settings; the Commissioner edits). */
import { useEffect, useState } from 'react';
import {
  COMPLIANCE_CATEGORIES, COMPLIANCE_STAGES, EVIDENCE_KINDS, ROAD_TYPES, passRuleText, type ComplianceItem,
} from 'shared';
import { api } from '../api.ts';
import { fmtDate, fmtTime } from './util.tsx';
import { ProjectCompliance } from './ProjectCompliance.tsx';

interface RecRow {
  id: number; stretch_code: string; ward: number; admin_zone: string; item_key: string; item_name: string; category: string; mandatory: boolean;
  unit: string; result: string; value: number | null; design_value: number | null; value_date: string | null; reference: string; reason: string;
  photos: string[]; documents: string[]; distance_m: number | null; recorded_at: string; recorded_by_name: string; verification: string;
  verified_at: string | null; verified_by_name: string | null; verify_note: string; can_verify: boolean;
}

export function CompliancePage({ zones, onOpen, isCommissioner, refreshKey, onChanged, role, level, setLevel, focus }: {
  zones: { id: string }[]; onOpen: (code: string) => void; isCommissioner: boolean; refreshKey: number; onChanged: () => void;
  role: string; level: 'project' | 'stretches'; setLevel: (l: 'project' | 'stretches') => void; focus: { key: string; period?: string } | null;
}) {
  const [view, setView] = useState<'records' | 'list'>('records');
  return (
    <div className="page">
      <div className="page-head">
        <h2>Compliance</h2>
        <div className="seg level-seg">
          <button className={level === 'project' ? 'on' : ''} onClick={() => setLevel('project')}>Project</button>
          <button className={level === 'stretches' ? 'on' : ''} onClick={() => setLevel('stretches')}>Work stretches</button>
        </div>
      </div>
      {level === 'project' ? <ProjectCompliance role={role} isCommissioner={isCommissioner} focus={focus} onChanged={onChanged} refreshKey={refreshKey} /> : <>
      <nav className="tabs inline">
        <button className={view === 'records' ? 'on' : ''} onClick={() => setView('records')}>Records and verification</button>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>Compliance list (stage-wise)</button>
      </nav>
      {view === 'records' ? <Records zones={zones} onOpen={onOpen} refreshKey={refreshKey} onChanged={onChanged} /> : <ItemList isCommissioner={isCommissioner} onChanged={onChanged} />}
      </>}
    </div>
  );
}

function Records({ zones, onOpen, refreshKey, onChanged }: { zones: { id: string }[]; onOpen: (code: string) => void; refreshKey: number; onChanged: () => void }) {
  const [f, setF] = useState({ verification: 'waiting', result: '', zone: '', ward: '', item: '' });
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [data, setData] = useState<{ total: number; rows: RecRow[] } | null>(null);
  const [tick, setTick] = useState(0);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api<{ items: ComplianceItem[] }>('/api/compliance/items').then((r) => setItems(r.items));
  }, []);
  useEffect(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    api<{ total: number; rows: RecRow[] }>(`/api/compliance/records?${p}`).then(setData);
  }, [f, tick, refreshKey]);
  const verify = async (id: number, decision: 'accept' | 'reject') => {
    setMsg('');
    try {
      await api(`/api/compliance/records/${id}/verify`, { decision, note: notes[id] ?? '' });
      setTick((t) => t + 1);
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <>
      <div className="filters">
        <select value={f.verification} onChange={(e) => set('verification', e.target.value)} aria-label="Verification">
          <option value="">All records</option><option value="waiting">Waiting for verification</option><option value="accepted">Verified</option><option value="rejected">Rejected</option>
        </select>
        <select value={f.result} onChange={(e) => set('result', e.target.value)} aria-label="Result">
          <option value="">Any result</option><option value="complied">Complied</option><option value="not_complied">Not complied</option><option value="not_applicable">Not applicable</option>
        </select>
        <select value={f.zone} onChange={(e) => set('zone', e.target.value)} aria-label="Zone"><option value="">All zones</option>{zones.map((z) => <option key={z.id}>{z.id}</option>)}</select>
        <input type="number" placeholder="Ward" value={f.ward} onChange={(e) => set('ward', e.target.value)} aria-label="Ward" />
        <select value={f.item} onChange={(e) => set('item', e.target.value)} aria-label="Item"><option value="">All items</option>{items.map((i) => <option key={i.key} value={i.key}>{i.name}</option>)}</select>
      </div>
      {msg && <p className="error">{msg}</p>}
      {data && <p className="muted small">{data.total} record(s).</p>}
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>Recorded</th><th>Work stretch</th><th>Item</th><th>Result and evidence</th><th>Verification</th></tr></thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{fmtTime(r.recorded_at)}<div className="muted">{r.recorded_by_name}</div></td>
                <td><button className="link" onClick={() => onOpen(r.stretch_code)}>{r.stretch_code}</button><div className="muted small">Ward {r.ward} · {r.admin_zone}</div></td>
                <td>{r.item_name}<div className="muted small">{r.category}{r.unit ? ` · ${r.unit === '*' ? 'others together' : r.unit}` : ''}{r.mandatory ? '' : ' · optional'}</div></td>
                <td className="small">
                  <b className={r.result === 'not_complied' ? 'error' : ''}>{{ complied: 'Complied', not_complied: 'Not complied', not_applicable: 'Not applicable' }[r.result]}</b>
                  {r.value !== null && ` · ${r.value}${r.design_value !== null ? ` (design ${r.design_value})` : ''}`}
                  {r.value_date && ` · ${fmtDate(r.value_date)}`}{r.reference && ` · Ref ${r.reference}`}{r.reason && ` · ${r.reason}`}
                  {r.distance_m !== null && <div className="muted">{r.distance_m} m from the road</div>}
                  <div className="thumbs">
                    {r.photos.map((p) => <a key={p} href={`/api/files/${p}`} target="_blank" rel="noreferrer"><img src={`/api/files/${p}`} alt="" /></a>)}
                    {r.documents.map((d) => <a key={d} href={`/api/files/${d}`} target="_blank" rel="noreferrer">📄</a>)}
                  </div>
                </td>
                <td className="small">
                  {r.verification === 'waiting' ? (r.can_verify ? (
                    <div className="verify-cell">
                      <input placeholder="Note (to reject)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                      <button className="primary" onClick={() => verify(r.id, 'accept')}>Verify</button>
                      <button className="danger" onClick={() => verify(r.id, 'reject')}>Reject</button>
                    </div>
                  ) : <span className="muted">Waiting</span>) : (
                    <>{r.verification === 'accepted' ? 'Verified' : 'Rejected'} · {r.verified_by_name}<div className="muted">{fmtTime(r.verified_at)}{r.verify_note && ` · “${r.verify_note}”`}</div></>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type Item = ComplianceItem & { retired_at: string | null };
function ItemList({ isCommissioner, onChanged }: { isCommissioner: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api<{ items: Item[] }>('/api/compliance/items').then((r) => setItems(r.items));
  }, [tick]);
  const retire = async (key: string, retire: boolean) => {
    await api(`/api/compliance/items/${key}/retire`, { retire });
    setTick((t) => t + 1);
    onChanged();
  };
  return (
    <>
      <p className="muted small">
        {items.filter((i) => !i.retired_at).length} items in use. Each item falls due at a point in the work (from the status recorded on the stretch) and
        guards a later step: recording that step while the item is not complied warns, or is refused if the item “blocks”.
        {isCommissioner ? ' Editing an item makes a new version; records already made keep the version they were made against.' : ' Only the Commissioner changes this list.'}
      </p>
      {isCommissioner && <button className="primary" onClick={() => setEdit({ evidence: ['photo'], per: 'stretch', mandatory: true, severity: 'medium', gate: 'warn', grace_days: 2, applies: {}, category: 'Safety', due_at: 'before_cutting', sort: items.length + 1 })}>+ New item</button>}
      {edit && <ItemForm item={edit} onDone={(saved) => { setEdit(null); if (saved) { setTick((t) => t + 1); onChanged(); } }} />}
      {COMPLIANCE_STAGES.map((s) => (
        <section key={s.key} className="cstage">
          <h4>{s.no}. {s.label} <span className="muted small">· due when: {s.dueWhen.toLowerCase()} · guards: {s.guards.toLowerCase()}</span></h4>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Item</th><th>Category</th><th>Applies to · per</th><th>Evidence · rule</th><th>Repeats</th><th>Mandatory · severity</th><th>Gate</th><th>Grace</th><th>Ver.</th>{isCommissioner && <th />}</tr></thead>
              <tbody>
                {items.filter((i) => i.due_at === s.key).map((i) => (
                  <tr key={i.key} className={i.retired_at ? 'retired' : ''}>
                    <td><b>{i.name}</b><div className="muted small">{i.description}</div>{i.retired_at && <div className="small error">Retired {fmtDate(i.retired_at)}</div>}</td>
                    <td className="small">{i.category}</td>
                    <td className="small">
                      {i.applies.road_types?.length ? i.applies.road_types.map((r) => ROAD_TYPES.find((x) => x.key === r)?.label).join(', ') : 'All road types'}
                      {i.applies.min_depth_m ? ` · depth ≥ ${i.applies.min_depth_m} m` : ''}
                      {' · '}{i.per === 'stretch' ? 'whole stretch' : `each ${i.per}${i.applies.unit_min_dia_mm ? ` (${i.applies.unit_min_dia_mm} mm+; others together)` : ''}`}
                    </td>
                    <td className="small">{i.evidence.map((e) => EVIDENCE_KINDS.find((x) => x.key === e)?.label).join(', ')}{i.evidence.includes('value') && <div className="muted">{passRuleText(i.pass_rule, i.unit)}</div>}</td>
                    <td className="small">{i.recurring_days ? `every ${i.recurring_days} d` : '—'}</td>
                    <td className="small">{i.mandatory ? 'Yes' : 'No'} · {i.severity}</td>
                    <td className="small"><span className={i.gate === 'block' ? 'error' : ''}>{i.gate === 'block' ? 'Block' : i.gate === 'warn' ? 'Warn' : 'None'}</span></td>
                    <td className="small">{i.grace_days} d</td>
                    <td className="small">{i.version}</td>
                    {isCommissioner && (
                      <td className="small">
                        <button className="link" onClick={() => setEdit(i)}>Edit</button>{' '}
                        <button className="link" onClick={() => retire(i.key, !i.retired_at)}>{i.retired_at ? 'Restore' : 'Retire'}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

function ItemForm({ item, onDone }: { item: Partial<Item>; onDone: (saved: boolean) => void }) {
  const [x, setX] = useState<Partial<Item>>(item);
  const [msg, setMsg] = useState('');
  const set = <K extends keyof Item>(k: K, v: Item[K]) => setX({ ...x, [k]: v });
  const isNew = !item.key;
  const save = async () => {
    setMsg('');
    try {
      const { id: _i, version: _v, retired_at: _r, ...body } = x as Item & { is_current?: boolean; created_at?: string };
      delete (body as Record<string, unknown>).is_current;
      delete (body as Record<string, unknown>).created_at;
      const defaults = { description: '', value_label: null, unit: null, pass_rule: null, recurring_days: null };
      await api('/api/compliance/items', Object.assign(defaults, body));
      onDone(true);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const ev = x.evidence ?? [];
  return (
    <div className="item-form">
      <h4>{isNew ? 'New compliance item' : `Edit “${item.name}” (saves version ${(item.version ?? 0) + 1})`}</h4>
      <div className="form-grid">
        <label>Item code<input value={x.key ?? ''} disabled={!isNew} onChange={(e) => set('key', e.target.value)} placeholder="e.g. tree_cutting_permit" /></label>
        <label>Order<input type="number" value={x.sort ?? 0} onChange={(e) => set('sort', Number(e.target.value))} /></label>
        <label className="wide">Name<input value={x.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="wide">Description<textarea rows={2} value={x.description ?? ''} onChange={(e) => set('description', e.target.value)} /></label>
        <label>Category<select value={x.category} onChange={(e) => set('category', e.target.value)}>{COMPLIANCE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Stage (when due)<select value={x.due_at} onChange={(e) => set('due_at', e.target.value as Item['due_at'])}>{COMPLIANCE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.no}. {s.label}</option>)}</select></label>
        <label>Recorded per<select value={x.per} onChange={(e) => set('per', e.target.value as Item['per'])}><option value="stretch">Whole stretch</option><option value="reach">Each pipe reach</option><option value="manhole">Each manhole</option></select></label>
        <label>Road types (none = all)
          <select multiple value={x.applies?.road_types ?? []} onChange={(e) => set('applies', { ...x.applies, road_types: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
            {ROAD_TYPES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label>Only where trench depth ≥ (m)<input type="number" step="0.1" value={x.applies?.min_depth_m ?? ''} onChange={(e) => set('applies', { ...x.applies, min_depth_m: e.target.value ? Number(e.target.value) : undefined })} /></label>
        <label>Reaches / manholes one by one from (mm)<input type="number" value={x.applies?.unit_min_dia_mm ?? ''} onChange={(e) => set('applies', { ...x.applies, unit_min_dia_mm: e.target.value ? Number(e.target.value) : undefined })} /></label>
        <fieldset className="wide"><legend>Evidence needed</legend>
          {EVIDENCE_KINDS.map((k) => (
            <label key={k.key} className="check"><input type="checkbox" checked={ev.includes(k.key)} onChange={(e) => set('evidence', e.target.checked ? [...ev, k.key] : ev.filter((y) => y !== k.key))} />{k.label}</label>
          ))}
        </fieldset>
        {ev.includes('value') && (
          <>
            <label>Value name<input value={x.value_label ?? ''} onChange={(e) => set('value_label', e.target.value)} /></label>
            <label>Unit<input value={x.unit ?? ''} onChange={(e) => set('unit', e.target.value)} /></label>
            <label>Pass rule
              <select value={x.pass_rule?.op ?? ''} onChange={(e) => set('pass_rule', e.target.value ? { op: e.target.value as '>=', value: x.pass_rule?.value ?? 0 } : null)}>
                <option value="">Recorded only</option><option value=">=">At least</option><option value="<=">At most</option><option value="design_within">Within ± of design</option>
              </select>
            </label>
            {x.pass_rule && <label>Pass value<input type="number" step="any" value={x.pass_rule.value} onChange={(e) => set('pass_rule', { ...x.pass_rule!, value: Number(e.target.value) })} /></label>}
          </>
        )}
        <label>Repeats every (days, empty = once)<input type="number" value={x.recurring_days ?? ''} onChange={(e) => set('recurring_days', e.target.value ? Number(e.target.value) : null)} /></label>
        <label>Grace days before overdue<input type="number" value={x.grace_days ?? 2} onChange={(e) => set('grace_days', Number(e.target.value))} /></label>
        <label className="check"><input type="checkbox" checked={!!x.mandatory} onChange={(e) => set('mandatory', e.target.checked)} />Mandatory</label>
        <label>Severity if not met<select value={x.severity} onChange={(e) => set('severity', e.target.value as Item['severity'])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label>Gate<select value={x.gate} onChange={(e) => set('gate', e.target.value as Item['gate'])}><option value="none">None</option><option value="warn">Warn (saved with a warning)</option><option value="block">Block (refused until complied)</option></select></label>
      </div>
      {msg && <p className="error">{msg}</p>}
      <div className="row-btns"><button className="primary" onClick={save}>Save</button><button onClick={() => onDone(false)}>Cancel</button></div>
    </div>
  );
}
