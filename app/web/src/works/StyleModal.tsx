/** Colour, line width and line type of map layers, for this person (saved with the account). */
import { DASHES, STYLE_DEFS, WIDTHS, type LayerStyle, type StyleKey } from '../mapStyle.ts';
import { Modal } from './Modal.tsx';

export function StyleModal({ keys, styles, onChange, onClose }: {
  keys: StyleKey[]; styles: Partial<Record<StyleKey, LayerStyle>>; onChange: (k: StyleKey, s: LayerStyle | null) => void; onClose: () => void;
}) {
  const defs = STYLE_DEFS.filter((d) => keys.includes(d.key));
  return (
    <Modal title="Layer style" onClose={onClose} size="small" footer={<><span className="grow" /><button className="btn primary" onClick={onClose}>Done</button></>}>
      {defs.map((d) => {
        const s = styles[d.key] ?? {};
        const set = (x: LayerStyle) => onChange(d.key, { ...s, ...x });
        return (
          <section key={d.key} className="style-sec">
            <div className="style-title">
              <b>{d.label}</b>
              <button className="btn ghost" onClick={() => onChange(d.key, null)}>Reset</button>
            </div>
            <div className="style-grid">
              {d.kind !== 'band' && (
                <label className="field">Colour
                  <span className="color-row">
                    <input type="color" value={s.color ?? d.color} onChange={(e) => set({ color: e.target.value })} />
                    <code>{s.color ?? d.color}</code>
                  </span>
                </label>
              )}
              <label className="field">{d.kind === 'point' ? 'Size' : 'Line width'}
                <select value={s.width ?? 1} onChange={(e) => set({ width: Number(e.target.value) })}>
                  {WIDTHS.map((w) => <option key={w.v} value={w.v}>{w.label}</option>)}
                </select>
              </label>
              {d.kind !== 'point' && (
                <label className="field">Line type
                  <select value={s.dash ?? d.dash} onChange={(e) => set({ dash: e.target.value as LayerStyle['dash'] })}>
                    {DASHES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
                  </select>
                </label>
              )}
              {d.kind === 'band' && (
                <label className="field">See-through
                  <select value={s.opacity ?? 0.75} onChange={(e) => set({ opacity: Number(e.target.value) })}>
                    {[1, 0.75, 0.5, 0.3].map((o) => <option key={o} value={o}>{o === 1 ? 'Solid' : `${Math.round((1 - o) * 100)}% see-through`}</option>)}
                  </select>
                </label>
              )}
            </div>
          </section>
        );
      })}
      <p className="muted small">Pipes: the line is still thicker for bigger diameters; “Line width” makes all of them thinner or thicker. Saved for your account.</p>
    </Modal>
  );
}
