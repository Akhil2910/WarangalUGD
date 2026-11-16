/**
 * Making (or changing) a work stretch on the map, in two simple steps:
 *   1. Choose pipes – tap DPR pipes (pink) or drawn pipes (white). Need a pipe that is not in the DPR?
 *      "Draw a new pipe": tap a manhole (DPR or drawn) or any point, then the next one.
 *   2. Name it and save.
 * The map clicks are handled in MapView; this panel shows the state and the buttons.
 */
import { km } from './util.tsx';

export const DIAMETERS = [110, 150, 160, 200, 225, 250, 300, 315, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1400, 1600, 1800];
export const MATERIALS = ['DWC HDPE', 'HDPE', 'PVC / uPVC', 'SWG (stoneware)', 'RCC NP2', 'RCC NP3', 'RCC NP4', 'DI (ductile iron)', 'CI', 'Other'];

export interface Picked { code: string; length_m: number; dia_mm: number }
export interface EndPt { code: string; lat: number; lon: number }
export interface Preview { pipes: number; length_m: number; manholes: number; pieces: number; taken: { pipe_id: string; stretch_code: string }[]; can_create: boolean; start_point?: EndPt; end_point?: EndPt }
export interface WorkState {
  mode: 'pick' | 'draw';
  dia: number;
  material: string;
  start: { id: number; code: string } | null;
  dpr: Map<string, Picked>;
  site: Map<number, Picked>;
  edit: { code: string } | null;
  name: string;
  preview: Preview | null;
  drawn: { kind: 'mh' | 'pipe'; id: number; code: string }[];
  msg: string;
  busy: boolean;
  ends: { slat: string; slon: string; elat: string; elon: string } | null; // typed corrections
}
export const newWork = (): WorkState => ({
  mode: 'pick', dia: 200, material: 'DWC HDPE', start: null, dpr: new Map(), site: new Map(), edit: null, name: '', preview: null, drawn: [], msg: '', busy: false, ends: null,
});

export function WorkPanel({ w, set, onUndo, onSave, onCancel, zoom }: {
  w: WorkState; set: (fn: (w: WorkState) => WorkState) => void; onUndo: () => void; onSave: () => void; onCancel: () => void; zoom: number;
}) {
  const count = w.dpr.size + w.site.size;
  const total = [...w.dpr.values(), ...w.site.values()].reduce((a, p) => a + p.length_m, 0);
  const ok = /^(Added|Laid|Removed|Saved)/.test(w.msg);
  return (
    <div className="work-panel">
      <div className="wp-head">
        <strong>{w.edit ? `Change pipes of ${w.edit.code}` : 'New work stretch'}</strong>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>

      <div className="wp-step">
        <div className="wp-step-title"><span className="num">1</span> Choose the pipes</div>
        <div className="seg">
          <button className={w.mode === 'pick' ? 'on' : ''} onClick={() => set((x) => ({ ...x, mode: 'pick', start: null, msg: '' }))}>Tap pipes</button>
          <button className={w.mode === 'draw' ? 'on' : ''} onClick={() => set((x) => ({ ...x, mode: 'draw', msg: '' }))}>Draw a new pipe</button>
        </div>
        {w.mode === 'pick' && (
          <p className="hint">Tap pipes on the map to add them (they turn <b className="yellow">yellow</b>). Tap again to remove.
            {zoom < 15 && <><br /><b>Zoom in closer</b> to see and tap individual pipes.</>}</p>
        )}
        {w.mode === 'draw' && (
          <>
            <div className="two">
              <label>Diameter (mm)
                <select value={w.dia} onChange={(e) => set((x) => ({ ...x, dia: Number(e.target.value) }))}>{DIAMETERS.map((v) => <option key={v} value={v}>{v}</option>)}</select>
              </label>
              <label>Material
                <select value={w.material} onChange={(e) => set((x) => ({ ...x, material: e.target.value }))}>{MATERIALS.map((v) => <option key={v}>{v}</option>)}</select>
              </label>
            </div>
            <p className="hint">
              {w.start ? <>From <b>{w.start.code}</b> — now tap the next manhole or point.</> : <>Tap the <b>first manhole</b> (a DPR manhole, a drawn one, or any point on the image).</>}
              {' '}Each new pipe is added to this work stretch.
            </p>
            <div className="row-btns">
              {w.start && <button className="btn" onClick={() => set((x) => ({ ...x, start: null }))}>Finish this line</button>}
              {w.drawn.length > 0 && <button className="btn" disabled={w.busy} onClick={onUndo}>Undo last ({w.drawn[w.drawn.length - 1].code})</button>}
            </div>
          </>
        )}
        <div className="wp-summary">
          {count ? <><b>{count}</b> pipe{count === 1 ? '' : 's'} · <b>{Math.round(total)} m</b>{total >= 1000 ? ` (${km(total)} km)` : ''}{w.preview ? <> · {w.preview.manholes} manholes</> : null}</> : 'No pipes chosen yet.'}
        </div>
        {w.preview && w.preview.pieces > 1 && <p className="note">These pipes are in <b>{w.preview.pieces} separate pieces</b> (not joined end to end). That is allowed.</p>}
        {w.preview?.start_point && !w.edit && (
          <div className="ends">
            {!w.ends ? (
              <>
                <div><span className="end-tag start">Start</span> {w.preview.start_point.lat.toFixed(6)}, {w.preview.start_point.lon.toFixed(6)} <span className="muted small">{w.preview.start_point.code}</span></div>
                <div><span className="end-tag end">End</span> {w.preview.end_point!.lat.toFixed(6)}, {w.preview.end_point!.lon.toFixed(6)} <span className="muted small">{w.preview.end_point!.code}</span></div>
                <button className="btn ghost" onClick={() => set((x) => ({ ...x, ends: { slat: String(x.preview!.start_point!.lat), slon: String(x.preview!.start_point!.lon), elat: String(x.preview!.end_point!.lat), elon: String(x.preview!.end_point!.lon) } }))}>Correct start / end</button>
              </>
            ) : (
              <div className="two">
                <label>Start latitude<input value={w.ends.slat} inputMode="decimal" onChange={(e) => set((x) => ({ ...x, ends: { ...x.ends!, slat: e.target.value } }))} /></label>
                <label>Start longitude<input value={w.ends.slon} inputMode="decimal" onChange={(e) => set((x) => ({ ...x, ends: { ...x.ends!, slon: e.target.value } }))} /></label>
                <label>End latitude<input value={w.ends.elat} inputMode="decimal" onChange={(e) => set((x) => ({ ...x, ends: { ...x.ends!, elat: e.target.value } }))} /></label>
                <label>End longitude<input value={w.ends.elon} inputMode="decimal" onChange={(e) => set((x) => ({ ...x, ends: { ...x.ends!, elon: e.target.value } }))} /></label>
                <button className="btn ghost" onClick={() => set((x) => ({ ...x, ends: null }))}>Use the manholes again</button>
              </div>
            )}
          </div>
        )}
        {w.preview?.taken.length ? <p className="error">Already in another work stretch: {w.preview.taken.map((t) => `${t.pipe_id} (${t.stretch_code})`).join(', ')}</p> : null}
      </div>

      <div className="wp-step">
        <div className="wp-step-title"><span className="num">2</span> {w.edit ? 'Save' : 'Name it and save'}</div>
        {!w.edit && (
          <input className="big-input" value={w.name} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} placeholder="Name, e.g. Kazipet Main Road, MH-12 to MH-30" />
        )}
        <button className="btn primary big" disabled={w.busy || !count || (!w.edit && w.name.trim().length < 3) || !!w.preview?.taken.length} onClick={onSave}>
          {w.busy ? 'Saving…' : w.edit ? 'Save pipes' : 'Save work stretch'}
        </button>
      </div>
      {w.msg && <p className={ok ? 'ok' : 'error'}>{w.msg}</p>}
    </div>
  );
}
