/** Works: every work stretch, with its stage, compliance and issues. Simple filters; tap a row to open it. */
import { useEffect, useState } from 'react';
import { COMPLIANCE_THEME, STAGES } from 'shared';
import { api } from '../api.ts';
import { fmtTime, km } from './util.tsx';

interface Row {
  code: string; ward: number; admin_zone: string; road_name: string; length_m: number; stage: string; approval: string; tags: string[];
  badges: string; open_issues: number; compliance: { theme?: string; score?: number | null; overdue?: number }; updated_at: string; updated_by_name: string | null;
}
interface Resp {
  total: number; rows: Row[]; by_stage: { stage: string; n: number; km: number }[];
  waiting: { approvals: number; verifications: number };
}
export interface Filters { zone: string; ward: string; stage: string; theme: string; approval: string; q: string; sort: string; dir: string; source: string }
export const EMPTY_FILTERS: Filters = { zone: '', ward: '', stage: '', theme: '', approval: '', q: '', sort: 'updated_at', dir: 'desc', source: 'site' };

export function WorksPage({ zones, onOpen, onGoTo, refreshKey, filters, setFilters, onNew }: {
  zones: { id: string }[]; onOpen: (code: string) => void; onGoTo: (code: string) => void; refreshKey: number;
  filters: Filters; setFilters: (f: Filters) => void; onNew?: () => void;
}) {
  const [data, setData] = useState<Resp | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const f = { ...filters, source: 'site' };
  const LIMIT = 50;
  useEffect(() => setPage(0), [f.zone, f.ward, f.stage, f.theme, f.approval, f.q]);
  useEffect(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    p.set('limit', String(LIMIT));
    p.set('offset', String(page * LIMIT));
    const t = setTimeout(() => api<Resp>(`/api/works?${p}`).then((d) => { setData(d); setError(''); }).catch((e) => setError((e as Error).message)), f.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [JSON.stringify(f), page, refreshKey]);
  const set = (k: keyof Filters, v: string) => setFilters({ ...f, [k]: v });
  const totalKm = data?.by_stage.reduce((a, s) => a + s.km, 0) ?? 0;
  const totalN = data?.by_stage.reduce((a, s) => a + s.n, 0) ?? 0;
  return (
    <div className="page">
      <div className="page-head">
        <h2>Works</h2>
        {onNew && <button className="btn primary" onClick={onNew}>+ New work stretch</button>}
      </div>
      {data && (
        <div className="cards">
          {STAGES.map((s) => {
            const x = data.by_stage.find((b) => b.stage === s.key);
            return (
              <button key={s.key} className={`stat ${f.stage === s.key ? 'on' : ''}`} onClick={() => set('stage', f.stage === s.key ? '' : s.key)}>
                <span className="stat-bar" style={{ background: s.color }} />
                <b>{x?.n ?? 0}</b><span>{s.label}</span><small>{km((x?.km ?? 0) * 1000)} km</small>
              </button>
            );
          })}
          <button className={`stat ${f.approval === 'pending' ? 'on' : ''}`} onClick={() => set('approval', f.approval === 'pending' ? '' : 'pending')}>
            <span className="stat-bar" style={{ background: '#a3e635' }} /><b>{data.waiting.approvals}</b><span>Waiting for approval</span>
          </button>
          <div className="stat"><span className="stat-bar" style={{ background: '#3b82f6' }} /><b>{data.waiting.verifications}</b><span>Compliances to verify</span></div>
        </div>
      )}
      <div className="filters">
        <input className="grow" placeholder="Search code or name" value={f.q} onChange={(e) => set('q', e.target.value)} aria-label="Search" />
        <select value={f.zone} onChange={(e) => set('zone', e.target.value)} aria-label="Zone"><option value="">All zones</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.id}</option>)}</select>
        <input type="number" placeholder="Ward" value={f.ward} onChange={(e) => set('ward', e.target.value)} aria-label="Ward" min={1} max={66} />
        <select value={f.theme} onChange={(e) => set('theme', e.target.value)} aria-label="Compliance">
          <option value="">Any compliance</option>{COMPLIANCE_THEME.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button className="btn ghost" onClick={() => setFilters({ ...EMPTY_FILTERS })}>Clear</button>
      </div>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <p className="muted">{data.total} of {totalN} work stretches{totalKm ? ` · ${km(totalKm * 1000)} km in all` : ''}.</p>
          {!totalN && <div className="empty">No work stretches yet.{onNew ? ' Press “+ New work stretch”, then tap pipes on the map.' : ''}</div>}
          <div className="list">
            {data.rows.map((r) => {
              const st = STAGES.find((s) => s.key === r.stage)!;
              const th = COMPLIANCE_THEME.find((s) => s.key === (r.compliance.theme ?? 'nothing_due'))!;
              return (
                <div key={r.code} className="list-row" onClick={() => onOpen(r.code)}>
                  <span className="stage-dot" style={{ background: st.color }} />
                  <div className="grow">
                    <div className="row-title"><b>{r.code}</b> {r.road_name}</div>
                    <div className="muted">Ward {r.ward} · {r.admin_zone} · {Math.round(r.length_m)} m · {st.label}{r.approval === 'rejected' ? ' (rejected)' : ''}</div>
                    <div className="row-tags">
                      <span className="tag" style={{ borderColor: th.color }}>Compliance: {r.compliance.score != null ? `${r.compliance.score}%` : th.label}</span>
                      {r.compliance.overdue ? <span className="tag bad">{r.compliance.overdue} overdue</span> : null}
                      {r.open_issues ? <span className="tag bad">{r.open_issues} issue{r.open_issues === 1 ? '' : 's'}</span> : null}
                      {r.badges && <span className="tag">{r.badges.split('').join(' ')}</span>}
                    </div>
                  </div>
                  <div className="row-side">
                    <button className="btn" onClick={(e) => { e.stopPropagation(); onGoTo(r.code); }}>Map</button>
                    <small className="muted">{r.updated_by_name ? fmtTime(r.updated_at) : ''}</small>
                  </div>
                </div>
              );
            })}
          </div>
          {data.total > LIMIT && (
            <div className="pager">
              <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Previous</button>
              <span className="muted">Page {page + 1} of {Math.ceil(data.total / LIMIT)}</span>
              <button className="btn" disabled={(page + 1) * LIMIT >= data.total} onClick={() => setPage(page + 1)}>Next ›</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
