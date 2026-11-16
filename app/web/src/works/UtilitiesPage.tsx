/** Utilities: layers above ground and underground, counts, mark on the map, import a department's GeoJSON file. */
import { useEffect, useState } from 'react';
import { EXISTING_DRAINS, UTILITY_CONDITIONS, UTILITY_LAYERS } from 'shared';
import { api } from '../api.ts';
import { Modal } from './Modal.tsx';
import { utilIconUrl } from '../utilIcons.ts';

interface L { key: string; label: string; group: string; geom: string; color: string; count: number; imported: number }

export function UtilitiesPage({ canImport, canMark, onMark, refreshKey }: { canImport: boolean; canMark: boolean; onMark: (layer: string) => void; refreshKey: number }) {
  const [layers, setLayers] = useState<L[]>([]);
  const [importing, setImporting] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api<{ layers: L[] }>('/api/utilities/summary').then((r) => setLayers(r.layers));
  }, [tick, refreshKey]);
  const group = (g: string, title: string) => (
    <section className="dsec">
      <div className="dsec-head"><h3>{title}</h3></div>
      <div className="util-list">
        {layers.filter((l) => l.group === g).map((l) => (
          <div key={l.key} className="util-row">
            <img className="row-icon" src={utilIconUrl(l.key, l.color, 56)} alt="" />
            <span className="grow"><b>{l.label}</b> <span className="muted small">{l.geom === 'point' ? 'points' : 'lines'}</span></span>
            <span className="util-count">{l.count.toLocaleString('en-IN')}</span>
            {canMark && <button className="btn" onClick={() => onMark(l.key)}>Mark on map</button>}
          </div>
        ))}
      </div>
    </section>
  );
  return (
    <div className="page">
      <div className="page-head">
        <h2>Utilities</h2>
        {canImport && <button className="btn primary" onClick={() => setImporting(true)}>⬆ Import a file</button>}
      </div>
      <p className="muted">Utilities show on the map (Layers → Utilities). Mark them on the satellite image, or import the files the departments give (GeoJSON).
        Tap any utility on the map to see its details.</p>
      {group('above', 'Above ground')}
      {group('under', 'Underground')}
      <section className="dsec">
        <div className="dsec-head"><h3>From the GWMC base map</h3></div>
        <div className="util-row"><img className="row-icon" src={utilIconUrl(EXISTING_DRAINS.key, EXISTING_DRAINS.color, 56)} alt="" /><span className="grow"><b>{EXISTING_DRAINS.label}</b> <span className="muted small">34,175 lines, read only</span></span></div>
      </section>
      {importing && <ImportModal onClose={(done) => { setImporting(false); if (done) setTick((t) => t + 1); }} />}
    </div>
  );
}

function ImportModal({ onClose }: { onClose: (done: boolean) => void }) {
  const [layer, setLayer] = useState<string>(UTILITY_LAYERS[0].key);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!file) return;
    setBusy(true);
    setMsg('');
    try {
      const gj = JSON.parse(await file.text());
      if (gj.type !== 'FeatureCollection') throw new Error('The file must be a GeoJSON FeatureCollection (in latitude / longitude).');
      const r = await api<{ added: number; skipped: number }>('/api/utilities/import', { layer, geojson: gj, source_name: file.name });
      setMsg(`Added ${r.added.toLocaleString('en-IN')}; skipped ${r.skipped.toLocaleString('en-IN')} (wrong shape or outside the city).`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const def = UTILITY_LAYERS.find((l) => l.key === layer)!;
  return (
    <Modal title="Import utilities" onClose={() => onClose(!!msg)} size="small"
      footer={<><span className="grow" /><button className="btn" onClick={() => onClose(!!msg)}>Close</button><button className="btn primary" disabled={!file || busy} onClick={go}>{busy ? 'Importing…' : 'Import'}</button></>}>
      <label className="field">Into layer<select value={layer} onChange={(e) => setLayer(e.target.value)}>{UTILITY_LAYERS.map((l) => <option key={l.key} value={l.key}>{l.label} ({l.geom === 'point' ? 'points' : 'lines'})</option>)}</select></label>
      <label className="field">GeoJSON file (latitude / longitude)<input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <p className="muted small">Only {def.geom === 'point' ? 'points' : 'lines'} are taken for this layer. The file's own fields are kept with each item. Shapefiles or KML: convert to GeoJSON first (I can do this for you).</p>
      {msg && <p className={msg.startsWith('Added') ? 'ok' : 'error'}>{msg}</p>}
    </Modal>
  );
}

/** Details of a utility being marked on the map. */
export function UtilityForm({ layer, onSave, onCancel }: { layer: string; onSave: (props: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const def = UTILITY_LAYERS.find((l) => l.key === layer)!;
  const [p, setP] = useState({ name: '', owner: '', size: '', material: '', depth_m: '', condition: 'Unknown', contact: '', note: '', obstruction: false });
  const [msg, setMsg] = useState('');
  const save = async () => {
    setMsg('');
    try {
      const out: Record<string, unknown> = { condition: p.condition, obstruction: p.obstruction };
      for (const k of ['name', 'owner', 'size', 'material', 'contact', 'note'] as const) if (p[k].trim()) out[k] = p[k].trim();
      if (p.depth_m) out.depth_m = Number(p.depth_m);
      await onSave(out);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Modal title={`New: ${def.label}`} onClose={onCancel} size="small"
      footer={<><span className="grow" /><button className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="two">
        <label className="field">Name / number<input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
        <label className="field">Owner / department<input value={p.owner} onChange={(e) => setP({ ...p, owner: e.target.value })} placeholder="e.g. TSNPDCL, Mission Bhagiratha" /></label>
        <label className="field">Size<input value={p.size} onChange={(e) => setP({ ...p, size: e.target.value })} placeholder="e.g. 150 mm, 11 kV" /></label>
        <label className="field">Material<input value={p.material} onChange={(e) => setP({ ...p, material: e.target.value })} /></label>
        {def.group === 'under' && <label className="field">Depth (m)<input type="number" step="0.1" value={p.depth_m} onChange={(e) => setP({ ...p, depth_m: e.target.value })} /></label>}
        <label className="field">Condition<select value={p.condition} onChange={(e) => setP({ ...p, condition: e.target.value })}>{UTILITY_CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Contact<input value={p.contact} onChange={(e) => setP({ ...p, contact: e.target.value })} /></label>
      </div>
      <label className="field">Note<input value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} /></label>
      <label className="check-row"><input type="checkbox" checked={p.obstruction} onChange={(e) => setP({ ...p, obstruction: e.target.checked })} /> In the way of the sewer work (obstruction)</label>
      {msg && <p className="error">{msg}</p>}
    </Modal>
  );
}
