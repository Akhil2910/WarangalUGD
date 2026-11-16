/** "Report issue" pop-up: anywhere on the map (a tapped place or the phone's GPS) or on a work stretch. */
import { useState } from 'react';
import { ISSUE_KINDS, type Severity } from 'shared';
import { api } from '../api.ts';
import { Modal } from './Modal.tsx';
import { uploadFile, useGps, type Uploaded } from './util.tsx';

const KINDS = ISSUE_KINDS.filter((k) => k.key !== 'compliance');
const PLACEHOLDER: Record<string, string> = {
  drain_clogged: 'e.g. gravel dumped in the side drain opposite the school',
  taps_broken: 'e.g. two house tap connections cut near door no. 4-12',
  water_leak: 'e.g. water line leaking at the trench crossing',
  not_motorable: 'e.g. trench open across the full road width',
  stagnation: 'e.g. rain water standing in the back-filled trench',
  potholes: 'e.g. potholes along the trench near the temple',
  uneven_backfill: 'e.g. back-fill heaped 20 cm above the road',
  drain_damaged: 'e.g. drain wall broken for 3 m',
  culvert_damaged: 'e.g. culvert slab cracked by the excavator',
  other: 'Describe the problem',
};

export function ReportIssueModal({ at, stretchCode, onDone }: {
  at?: { lon: number; lat: number } | null; stretchCode?: string; onDone: (code?: string) => void;
}) {
  const [kind, setKind] = useState<string>(KINDS[0].key);
  const [count, setCount] = useState(1);
  const [severity, setSeverity] = useState<Severity>(KINDS[0].severity);
  const [sevTouched, setSevTouched] = useState(false);
  const [remark, setRemark] = useState('');
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { gps, state } = useGps(true);
  const pick = (k: string) => {
    setKind(k);
    if (!sevTouched) setSeverity(ISSUE_KINDS.find((x) => x.key === k)!.severity);
  };
  const where = stretchCode ? `On work stretch ${stretchCode}` : at ? `At ${at.lat.toFixed(6)}, ${at.lon.toFixed(6)}` : 'At your GPS position';
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ code: string }>('/api/issues', {
        kind, count, severity, remark, photos: photos.map((p) => p.id), gps,
        ...(stretchCode ? { stretch_code: stretchCode } : {}), ...(at ? { lon: at.lon, lat: at.lat } : {}),
      });
      onDone(r.code);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const gpsLabel = state === 'good' ? `GPS ±${gps?.accuracy_m} m` : state === 'weak' ? `Weak GPS ±${gps?.accuracy_m} m` : state === 'none' ? 'No GPS' : 'Finding GPS…';
  return (
    <Modal title="Report issue" onClose={() => onDone()} size="small"
      footer={<>
        <span className={`gps-pill ${state}`}>{gpsLabel}</span>
        <span className="grow" />
        <button className="btn" onClick={() => onDone()}>Cancel</button>
        <button className="btn primary" disabled={busy || remark.trim().length < 3 || (!stretchCode && !at && !gps)} onClick={submit}>{busy ? 'Reporting…' : 'Report'}</button>
      </>}>
      <p className="muted where">{where}</p>
      <label className="field">What is the problem?
        <select value={kind} onChange={(e) => pick(e.target.value)}>{KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
      </label>
      <div className="two">
        <div className="field">How many?
          <div className="stepper">
            <button aria-label="Fewer" onClick={() => setCount((c) => Math.max(1, c - 1))}>−</button>
            <input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            <button aria-label="More" onClick={() => setCount((c) => c + 1)}>+</button>
          </div>
        </div>
        <div className="field">Severity
          <div className="pick3">
            {(['low', 'medium', 'high'] as const).map((s) => (
              <button key={s} className={severity === s ? 'on' : ''} onClick={() => { setSeverity(s); setSevTouched(true); }}>{s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
        </div>
      </div>
      <label className="field">Remark (required)
        <textarea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={PLACEHOLDER[kind]} />
      </label>
      <div className="field">Photo (optional)
        <div className="photo-tiles">
          {photos.map((p) => (
            <span key={p.id} className="photo-tile"><img src={`/api/files/${p.id}`} alt="" /><button aria-label="Remove photo" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}>×</button></span>
          ))}
          <label className="photo-tile add">
            + Photo
            <input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const up = await uploadFile(f, 'photo', gps);
                setPhotos((x) => [...x, up]);
              } catch (x) {
                setErr((x as Error).message);
              }
            }} />
          </label>
        </div>
      </div>
      {err && <p className="error">{err}</p>}
    </Modal>
  );
}
