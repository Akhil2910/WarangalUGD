/** Admin panel: users, roles and the permission grid, organisation and deadlines, audit log. */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, type User } from '../api.ts';
import { Icon } from '../ui.tsx';
import { Modal } from './Modal.tsx';
import { fmtTime } from './util.tsx';

type Section = 'users' | 'roles' | 'settings' | 'audit';
interface Overview { ulb: { id: number; name: string; name_local: string; code: string; settings: Settings }; users: number; active_users: number; roles_in_use: number; can: Record<string, boolean> }
interface Settings { short_name: string; app_title: string; grievance_due_days: number; issue_due_days: { high: number; medium: number; low: number } }
interface URow { id: string; email: string; name: string; designation: string; phone: string; role: string; role_key: string; role_label: string; areas: { all?: boolean; admin_zones?: string[]; wards?: number[] }; active: boolean; last_sign_in: string | null }
interface RoleRow { key: string; label: string; base_role: string; builtin: boolean; active: boolean; duty: string; grants: string[]; changed: boolean; users: number }
interface ActionDef { key: string; group: string; label: string }

export function AdminPage({ me }: { me: User }) {
  const [o, setO] = useState<Overview | null>(null);
  const [sec, setSec] = useState<Section>('users');
  const [tick, setTick] = useState(0);
  useEffect(() => { api<Overview>('/api/admin/overview').then((x) => { setO(x); if (!x.can['admin.users']) setSec(x.can['admin.roles'] ? 'roles' : x.can['admin.settings'] ? 'settings' : 'audit'); }); }, [tick]);
  if (!o) return <div className="page"><p className="muted">Loading…</p></div>;
  const tabs: [Section, string, string, string][] = ([
    ['users', 'Users', 'users', 'admin.users'], ['roles', 'Roles and permissions', 'compliance', 'admin.roles'],
    ['settings', 'Organisation and deadlines', 'admin', 'admin.settings'], ['audit', 'Audit log', 'works', 'admin.audit'],
  ] as [Section, string, string, string][]).filter((t) => o.can[t[3]]);
  return (
    <div className="page dash admin">
      <div className="dash-hero">
        <div className="dash-hero-text">
          <span className="dash-kicker">Admin panel · {o.ulb.code}</span>
          <h2>{o.ulb.name}</h2>
          <span className="dash-asof">{o.active_users} active users · {o.roles_in_use} roles in use · signed in as {me.role_label}</span>
        </div>
      </div>
      <nav className="dash-tabs">{tabs.map(([k, l, ic]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}><Icon name={ic} />{l}</button>)}</nav>
      {sec === 'users' && <Users me={me} onChanged={() => setTick((t) => t + 1)} />}
      {sec === 'roles' && <Roles />}
      {sec === 'settings' && <SettingsForm o={o} onSaved={() => setTick((t) => t + 1)} />}
      {sec === 'audit' && <Audit />}
    </div>
  );
}

// ---------------- users ----------------
const areaText = (a: URow['areas'], role = '') => (role === 'commissioner' ? 'Whole city' : ['system_admin', 'super_admin'].includes(role) ? '—' : a?.all ? 'Whole city' : [a?.admin_zones?.length ? `Zones ${a.admin_zones.join(', ')}` : '', a?.wards?.length ? `Wards ${a.wards.join(', ')}` : ''].filter(Boolean).join(' · ') || 'No area');

function Users({ me, onChanged }: { me: User; onChanged: () => void }) {
  const [d, setD] = useState<{ users: URow[]; roles: { key: string; label: string }[] } | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [edit, setEdit] = useState<URow | 'new' | null>(null);
  const [pw, setPw] = useState<URow | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api<typeof d>('/api/admin/users').then(setD); }, [tick]);
  const rows = useMemo(() => (d?.users ?? []).filter((u) => (showOff || u.active) && (!role || u.role_key === role)
    && (!q || `${u.name} ${u.email} ${u.designation}`.toLowerCase().includes(q.toLowerCase()))), [d, q, role, showOff]);
  if (!d) return <p className="muted">Loading…</p>;
  const toggle = async (u: URow) => { await api(`/api/admin/users/${u.id}`, { active: !u.active }); setTick((t) => t + 1); onChanged(); };
  return (
    <section className="dsec">
      <div className="dsec-head">
        <div className="dsec-titles"><span className="dsec-ico"><Icon name="users" /></span><div><h3>Users</h3><div className="dsec-sub">{d.users.filter((u) => u.active).length} active · {d.users.filter((u) => !u.active).length} switched off</div></div></div>
        <button className="btn primary" onClick={() => setEdit('new')}>+ Add user</button>
      </div>
      <div className="filters">
        <input className="grow" placeholder="Search name, e-mail or designation" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{d.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
        <label className="check-row"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> Show switched-off users</label>
      </div>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>Name</th><th>Role</th><th>Area</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'retired'}>
              <td><b>{u.name}</b><div className="muted small">{u.email}{u.designation ? ` · ${u.designation}` : ''}</div></td>
              <td>{u.role_label}</td>
              <td className="small">{areaText(u.areas, u.role)}</td>
              <td className="small">{u.last_sign_in ? fmtTime(u.last_sign_in) : <span className="muted">never</span>}</td>
              <td><span className={`pchip ${u.active ? 'ok' : 'none'}`}>{u.active ? 'Active' : 'Switched off'}</span></td>
              <td><div className="row-btns">
                <button className="btn ghost" onClick={() => setEdit(u)}>Edit</button>
                <button className="btn ghost" onClick={() => setPw(u)}>Set password</button>
                {u.id !== me.id && <button className="btn ghost" onClick={() => toggle(u)}>{u.active ? 'Switch off' : 'Switch on'}</button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {edit && <UserForm u={edit === 'new' ? null : edit} roles={d.roles} onClose={(ch) => { setEdit(null); if (ch) { setTick((t) => t + 1); onChanged(); } }} />}
      {pw && <PasswordForm u={pw} onClose={() => setPw(null)} />}
    </section>
  );
}

function UserForm({ u, roles, onClose }: { u: URow | null; roles: { key: string; label: string }[]; onClose: (changed: boolean) => void }) {
  const [f, setF] = useState({
    name: u?.name ?? '', email: u?.email ?? '', designation: u?.designation ?? '', phone: u?.phone ?? '', role_key: u?.role_key ?? roles[0]?.key ?? '',
    scope: u?.areas?.all !== false && !u?.areas?.admin_zones?.length && !u?.areas?.wards?.length ? 'all' : 'some',
    zones: (u?.areas?.admin_zones ?? []).join(', '), wards: (u?.areas?.wards ?? []).join(', '), password: '',
  });
  const [msg, setMsg] = useState('');
  const save = async () => {
    setMsg('');
    const areas = f.scope === 'all' ? { all: true } : {
      admin_zones: f.zones.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean),
      wards: f.wards.split(/[,\s]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0),
    };
    try {
      if (u) await api(`/api/admin/users/${u.id}`, { name: f.name, email: f.email, designation: f.designation, phone: f.phone, role_key: f.role_key, areas });
      else await api('/api/admin/users', { name: f.name, email: f.email, designation: f.designation, phone: f.phone, role_key: f.role_key, areas, password: f.password });
      onClose(true);
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Modal title={u ? `Edit ${u.name}` : 'Add a user'} onClose={() => onClose(false)}
      footer={<><span className="grow" /><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" onClick={save}>{u ? 'Save' : 'Add user'}</button></>}>
      <div className="two">
        <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">E-mail (user ID)<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field">Designation<input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} placeholder="e.g. AEE, Zone 2" /></label>
        <label className="field">Mobile<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field">Role<select value={f.role_key} onChange={(e) => setF({ ...f, role_key: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
        {!u && <label className="field">Password (at least 8 characters)<input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></label>}
      </div>
      <div className="field">Area of work
        <div className="seg"><button className={f.scope === 'all' ? 'on' : ''} onClick={() => setF({ ...f, scope: 'all' })}>Whole city</button><button className={f.scope === 'some' ? 'on' : ''} onClick={() => setF({ ...f, scope: 'some' })}>Some zones / wards</button></div>
      </div>
      {f.scope === 'some' && (
        <div className="two">
          <label className="field">GWMC zones (e.g. Z01, Z03)<input value={f.zones} onChange={(e) => setF({ ...f, zones: e.target.value })} /></label>
          <label className="field">Wards (e.g. 12, 13, 31)<input value={f.wards} onChange={(e) => setF({ ...f, wards: e.target.value })} /></label>
        </div>
      )}
      {u && <p className="muted small">Changing the role or area signs the person out, so the change takes effect at once.</p>}
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}

function PasswordForm({ u, onClose }: { u: URow; onClose: () => void }) {
  const [p, setP] = useState('');
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  return (
    <Modal title={`Set password · ${u.name}`} size="small" onClose={onClose}
      footer={<><span className="grow" /><button className="btn" onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>{!done && <button className="btn primary" onClick={async () => { setMsg(''); try { await api(`/api/admin/users/${u.id}/password`, { password: p }); setDone(true); } catch (e) { setMsg((e as Error).message); } }}>Set password</button>}</>}>
      {done ? <p className="ok">Password set. {u.name} has been signed out everywhere and signs in with the new password.</p> : (
        <><label className="field">New password (at least 8 characters)<input type="text" value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" /></label>
          <p className="muted small">Give the password to the person directly; it is not shown again.</p></>
      )}
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}

// ---------------- roles and the permission grid ----------------
const LOCKED = new Set(['system_admin|admin.users', 'system_admin|admin.roles', 'system_admin|admin.settings']);

function Roles() {
  const [d, setD] = useState<{ roles: RoleRow[]; actions: ActionDef[] } | null>(null);
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [roleEdit, setRoleEdit] = useState<RoleRow | 'new' | null>(null);
  const [showOff, setShowOff] = useState(false);
  useEffect(() => { api<NonNullable<typeof d>>('/api/admin/roles').then((x) => { setD(x); setDraft(Object.fromEntries(x.roles.map((r) => [r.key, new Set(r.grants)]))); }); }, [tick]);
  if (!d) return <p className="muted">Loading…</p>;
  const roles = d.roles.filter((r) => showOff || r.active);
  const dirty = d.roles.filter((r) => { const a = draft[r.key]; return a && (a.size !== r.grants.length || r.grants.some((g) => !a.has(g))); });
  const flip = (role: string, action: string) => {
    if (LOCKED.has(`${role}|${action}`)) return;
    setDraft((x) => { const n = new Set(x[role]); if (n.has(action)) n.delete(action); else n.add(action); return { ...x, [role]: n }; });
  };
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      for (const r of dirty) await api(`/api/admin/roles/${r.key}/permissions`, { grants: [...draft[r.key]] });
      setMsg(`Saved ${dirty.length} role${dirty.length === 1 ? '' : 's'}. People with these roles get the change straight away.`);
      setTick((t) => t + 1);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const reset = async (r: RoleRow) => { await api(`/api/admin/roles/${r.key}/reset`, {}); setTick((t) => t + 1); setMsg(`${r.label}: back to the standard permissions.`); };
  const groups = [...new Set(d.actions.map((a) => a.group))];
  return (
    <section className="dsec">
      <div className="dsec-head">
        <div className="dsec-titles"><span className="dsec-ico"><Icon name="compliance" /></span><div><h3>Roles and permissions</h3><div className="dsec-sub">Tick what each role may do. Area limits (wards / zones) still apply on top.</div></div></div>
        <div className="row-btns">
          <label className="check-row small"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> Show switched-off roles</label>
          <button className="btn" onClick={() => setRoleEdit('new')}>+ New role</button>
          <button className="btn primary" disabled={!dirty.length || busy} onClick={save}>{busy ? 'Saving…' : dirty.length ? `Save changes (${dirty.length})` : 'No changes'}</button>
        </div>
      </div>
      {msg && <p className={msg.startsWith('Saved') || msg.includes('standard') ? 'ok' : 'error'}>{msg}</p>}
      <div className="perm-wrap">
        <table className="perm-grid">
          <thead>
            <tr>
              <th className="perm-act">What</th>
              {roles.map((r) => (
                <th key={r.key} className={`perm-role ${dirty.some((x) => x.key === r.key) ? 'dirty' : ''} ${r.active ? '' : 'off'}`}>
                  <button className="perm-role-btn" title={`${r.duty}${r.users ? ` · ${r.users} user(s)` : ''}`} onClick={() => setRoleEdit(r)}>{r.label}</button>
                  <small>{r.users} user{r.users === 1 ? '' : 's'}{r.changed ? ' · changed' : ''}</small>
                  {r.changed && <button className="link tiny" onClick={() => reset(r)}>reset</button>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr className="perm-group"><td colSpan={roles.length + 1}>{g}</td></tr>
                {d.actions.filter((a) => a.group === g).map((a) => (
                  <tr key={a.key}>
                    <td className="perm-act">{a.label}</td>
                    {roles.map((r) => {
                      const on = draft[r.key]?.has(a.key);
                      const lock = LOCKED.has(`${r.key}|${a.key}`);
                      return (
                        <td key={r.key} className={`perm-cell ${on ? 'on' : ''} ${lock ? 'lock' : ''}`} onClick={() => flip(r.key, a.key)} title={lock ? 'Always on, so the system can always be managed' : `${r.label}: ${a.label}`}>
                          <span className="perm-box">{on ? '✓' : ''}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {roleEdit && <RoleForm r={roleEdit === 'new' ? null : roleEdit} roles={d.roles} onClose={(ch) => { setRoleEdit(null); if (ch) setTick((t) => t + 1); }} />}
    </section>
  );
}

function RoleForm({ r, roles, onClose }: { r: RoleRow | null; roles: RoleRow[]; onClose: (changed: boolean) => void }) {
  const [label, setLabel] = useState(r?.label ?? '');
  const [base, setBase] = useState(r?.base_role ?? 'field_inspector');
  const [active, setActive] = useState(r?.active ?? true);
  const [msg, setMsg] = useState('');
  const save = async () => {
    setMsg('');
    try { await api('/api/admin/roles', { key: r?.key, label, base_role: r ? undefined : base, active }); onClose(true); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Modal title={r ? `Role · ${r.label}` : 'New role'} size="small" onClose={() => onClose(false)}
      footer={<><span className="grow" /><button className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <label className="field">Name shown to people<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Site Engineer" /></label>
      {!r && (
        <label className="field">Starts with the permissions of<select value={base} onChange={(e) => setBase(e.target.value)}>
          {roles.filter((x) => x.builtin && x.key !== 'super_admin').map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select></label>
      )}
      {r && <p className="muted small">{r.duty}{r.builtin ? ' · built-in role: its name can be changed' : ''}</p>}
      {r && r.key !== 'system_admin' && <label className="check-row"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> In use (switched-off roles cannot be given to users)</label>}
      {!r && <p className="muted small">After saving, adjust its ticks in the grid.</p>}
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}

// ---------------- organisation and deadlines ----------------
function SettingsForm({ o, onSaved }: { o: Overview; onSaved: () => void }) {
  const s = o.ulb.settings;
  const [f, setF] = useState({ name: o.ulb.name, name_local: o.ulb.name_local, short_name: s.short_name, app_title: s.app_title, grievance_due_days: s.grievance_due_days, ...s.issue_due_days });
  const [msg, setMsg] = useState('');
  const num = (k: 'grievance_due_days' | 'high' | 'medium' | 'low', label: string) => (
    <label className="field">{label}<span className="days-in"><input type="number" min={1} max={180} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} /> days</span></label>
  );
  const save = async () => {
    setMsg('');
    try {
      await api('/api/admin/settings', { name: f.name, name_local: f.name_local, short_name: f.short_name, app_title: f.app_title, grievance_due_days: f.grievance_due_days, issue_due_days: { high: f.high, medium: f.medium, low: f.low } });
      setMsg('Saved. New issues and grievances use these deadlines; existing ones keep theirs.');
      onSaved();
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="dcols">
      <section className="dsec">
        <div className="dsec-head"><div className="dsec-titles"><span className="dsec-ico"><Icon name="admin" /></span><div><h3>Organisation</h3><div className="dsec-sub">Shown in the app and to citizens</div></div></div></div>
        <label className="field">Name of the ULB<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Name in Telugu<input value={f.name_local} onChange={(e) => setF({ ...f, name_local: e.target.value })} lang="te" /></label>
        <div className="two">
          <label className="field">Short name<input value={f.short_name} onChange={(e) => setF({ ...f, short_name: e.target.value })} /></label>
          <label className="field">App title<input value={f.app_title} onChange={(e) => setF({ ...f, app_title: e.target.value })} /></label>
        </div>
      </section>
      <section className="dsec">
        <div className="dsec-head"><div className="dsec-titles"><span className="dsec-ico"><Icon name="issues" /></span><div><h3>Deadlines</h3><div className="dsec-sub">Time allowed before something counts as overdue</div></div></div></div>
        {num('grievance_due_days', 'Citizen grievance — answer within')}
        <div className="two">
          {num('high', 'Issue, high severity')}
          {num('medium', 'Issue, medium severity')}
          {num('low', 'Issue, low severity')}
        </div>
        {msg && <p className={msg.startsWith('Saved') ? 'ok' : 'error'}>{msg}</p>}
        <div className="row-btns"><button className="btn primary" onClick={save}>Save settings</button></div>
      </section>
    </div>
  );
}

// ---------------- audit log ----------------
const WHAT: Record<string, string> = {
  sign_in: 'Signed in', sign_in_failed: 'Failed sign-in', admin_user_added: 'Added a user', admin_user_changed: 'Changed a user', admin_password_set: 'Set a password',
  admin_role_saved: 'Saved a role', admin_permissions_saved: 'Changed permissions', admin_permissions_reset: 'Reset permissions', admin_settings_saved: 'Changed settings',
  passwords_set: 'Set passwords (command)', project_override: 'Project override', project_settings: 'Project dates', project_item_added: 'Added a project item', project_item_changed: 'Changed a project item',
  utilities_imported: 'Imported utilities',
};
function Audit() {
  const [rows, setRows] = useState<{ id: number; action: string; detail: unknown; at: string; name: string | null; email: string | null }[]>([]);
  const [who, setWho] = useState('');
  const [what, setWhat] = useState('');
  const [more, setMore] = useState(true);
  const load = async (before?: number) => {
    const p = new URLSearchParams();
    if (before) p.set('before', String(before));
    if (who) p.set('who', who);
    if (what) p.set('what', what);
    const r = await api<{ rows: typeof rows }>(`/api/admin/audit?${p}`);
    setRows((x) => (before ? [...x, ...r.rows] : r.rows));
    setMore(r.rows.length === 100);
  };
  useEffect(() => { void load(); }, [who, what]);
  return (
    <section className="dsec">
      <div className="dsec-head"><div className="dsec-titles"><span className="dsec-ico"><Icon name="works" /></span><div><h3>Audit log</h3><div className="dsec-sub">Who did what, newest first</div></div></div></div>
      <div className="filters">
        <input placeholder="Who (name or e-mail)" value={who} onChange={(e) => setWho(e.target.value)} />
        <select value={what} onChange={(e) => setWhat(e.target.value)}><option value="">Everything</option><option value="admin_">Admin changes</option><option value="sign_in">Sign-ins</option><option value="project_">Project compliance</option></select>
      </div>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="small">{fmtTime(r.at)}</td>
              <td>{r.name ?? <span className="muted">System</span>}<div className="muted small">{r.email}</div></td>
              <td>{WHAT[r.action] ?? r.action.replace(/_/g, ' ')}</td>
              <td className="small audit-detail">{JSON.stringify(r.detail).slice(0, 160)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {more && rows.length > 0 && <button className="btn" onClick={() => load(rows[rows.length - 1].id)}>Load older</button>}
    </section>
  );
}
