/**
 * Charts used across the app. Plain SVG/HTML, no library.
 * Rules: one measure per chart (never two axes), thin marks with rounded ends, light grid,
 * a hover tip on every mark, colour carries meaning only together with a label.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export const nf = (n: number, d = 0) => n.toLocaleString('en-IN', { maximumFractionDigits: d });
/** Status colours: reserved for good / watch / bad, always shown with a word or icon. */
export const STATUS = { good: '#15803d', watch: '#b45309', bad: '#dc2626', none: '#64748b' } as const;
export const ACCENT = '#2563eb';
const dShort = (iso: string) => new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Tiny trend line for a figure card (no axes). */
export function Sparkline({ values, color = ACCENT, label }: { values: number[]; color?: string; label: string }) {
  const id = useId();
  if (values.length < 2) return null;
  const W = 120, H = 32, max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 3 - (v / max) * (H - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}

/** A headline figure: label, big number, a short note, optional status, meter or sparkline. */
export function KpiCard({ label, value, unit, note, status, statusText, children, onClick }: {
  label: string; value: string; unit?: string; note?: ReactNode; status?: keyof typeof STATUS; statusText?: string; children?: ReactNode; onClick?: () => void;
}) {
  return (
    <div className={`kpi ${onClick ? 'click' : ''}`} onClick={onClick}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}{unit && <span className="kpi-unit">{unit}</span>}</div>
      {status && statusText && <div className="kpi-status" style={{ color: STATUS[status] }}><StatusIcon s={status} /> {statusText}</div>}
      {note && <div className="kpi-note">{note}</div>}
      {children}
    </div>
  );
}

export function StatusIcon({ s }: { s: keyof typeof STATUS }) {
  const p = s === 'good' ? 'M4 8.5l2.5 2.5L12 5.5' : s === 'bad' ? 'M5 5l6 6M11 5l-6 6' : s === 'watch' ? 'M8 4.5v4.5M8 11.5v.2' : 'M4.5 8h7';
  return <svg className="sicon" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="7.2" fill={STATUS[s]} /><path d={p} stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>;
}

/** Progress toward a target: label, value of target, a bar with a rounded end. */
export function Meter({ label, value, target, unit = '', color = ACCENT, digits = 0, note }: { label: string; value: number; target: number; unit?: string; color?: string; digits?: number; note?: string }) {
  const pct = target > 0 ? (value / target) * 100 : 0;
  return (
    <div className="meter" title={`${label}: ${nf(value, digits)}${unit} of ${nf(target, digits)}${unit} (${pct.toFixed(pct < 1 ? 2 : 1)}%)`}>
      <div className="meter-head"><span>{label}</span><b>{pct < 1 && pct > 0 ? pct.toFixed(2) : nf(pct, 1)}%</b></div>
      <div className="meter-track"><span style={{ width: `${Math.min(100, Math.max(pct > 0 ? 0.8 : 0, pct))}%`, background: color }} /></div>
      <div className="meter-foot">{nf(value, digits)}{unit} of {nf(target, digits)}{unit}{note ? ` · ${note}` : ''}</div>
    </div>
  );
}

/** One bar split into parts (e.g. km by stage), with a legend that names every part. */
export function StackBar({ parts, unit = '', digits = 0 }: { parts: { label: string; value: number; color: string; note?: string }[]; unit?: string; digits?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div className="stackbar">
      <div className="stack-track">
        {total === 0 ? <span className="stack-empty" /> : parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.label} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${nf(p.value, digits)}${unit}${p.note ? ` · ${p.note}` : ''} (${((p.value / total) * 100).toFixed(0)}%)`} />
        ))}
      </div>
      <div className="stack-legend">
        {parts.map((p) => (
          <div key={p.label} className={p.value ? '' : 'zero'}><i style={{ background: p.color }} /><span className="grow">{p.label}</span><b>{nf(p.value, digits)}{unit}</b>{p.note && <span className="muted">{p.note}</span>}</div>
        ))}
      </div>
    </div>
  );
}

/** Ranked horizontal bars, value at the end, hover tip, optional click. */
export function RankBars({ rows, unit = '', color = ACCENT, digits = 0, empty = 'Nothing yet.', onPick }: {
  rows: { key?: string; label: string; value: number; tip?: string; color?: string; sub?: string }[]; unit?: string; color?: string; digits?: number; empty?: string; onPick?: (key: string) => void;
}) {
  if (!rows.length) return <p className="muted empty-note">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <div className="rbars">
      {rows.map((r) => (
        <div key={r.key ?? r.label} className={`rbar ${onPick ? 'click' : ''}`} title={r.tip ?? `${r.label}: ${nf(r.value, digits)}${unit}`} onClick={onPick ? () => onPick(r.key ?? r.label) : undefined}>
          <span className="rbar-label">{r.label}{r.sub && <small>{r.sub}</small>}</span>
          <span className="rbar-track"><span style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100)}%`, background: r.color ?? color }} /></span>
          <span className="rbar-val">{nf(r.value, digits)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

/** Daily trend (one measure; up to two series of the same measure), with a crosshair and a tip on hover. */
export function TrendChart({ title, dates, series, unit = '', height = 150 }: {
  title: string; dates: string[]; series: { label: string; values: number[]; color: string }[]; unit?: string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  // draw at the real width, so text stays readable on narrow and wide screens
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height, L = 36, R = 8, T = 10, B = 22;
  const n = dates.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => L + (n < 2 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const totals = series.map((s) => s.values.reduce((a, b) => a + b, 0));
  const ticks = [0, max / 2, max];
  const onMove = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  };
  return (
    <div className="trend">
      <div className="trend-head">
        <span className="trend-title">{title}</span>
        <span className="trend-legend">{series.map((s, i) => <span key={s.label}><i style={{ background: s.color }} />{series.length > 1 ? `${s.label} ` : ''}<b>{nf(totals[i])}{unit}</b></span>)}<span className="muted">in {n} days</span></span>
      </div>
      <div className="trend-plot" ref={box} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, last ${n} days`}>
          <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={series[0]?.color} stopOpacity="0.18" /><stop offset="1" stopColor={series[0]?.color} stopOpacity="0" /></linearGradient></defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid-line" />
              <text x={L - 6} y={y(t) + 4} className="axis-text" textAnchor="end">{short(t)}</text>
            </g>
          ))}
          {[0, Math.floor((n - 1) / 2), n - 1].filter((i, k, a) => n && a.indexOf(i) === k).map((i) => (
            <text key={i} x={x(i)} y={H - 6} className="axis-text" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{dShort(dates[i])}</text>
          ))}
          {series.map((s, si) => {
            const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
            return (
              <g key={s.label}>
                {si === 0 && <path d={`${d}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={`url(#${id})`} />}
                <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" />
              {series.map((s) => <circle key={s.label} cx={x(hover)} cy={y(s.values[hover])} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />)}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <b>{dShort(dates[hover])}</b>
            {series.map((s) => <div key={s.label}><i style={{ background: s.color }} />{s.label}: <b>{nf(s.values[hover])}{unit}</b></div>)}
          </div>
        )}
      </div>
    </div>
  );
}
function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const short = (v: number) => (v >= 1000 ? `${nf(v / 1000, 1)}k` : nf(v, v < 10 && v % 1 ? 1 : 0));

/** A ring showing one share (e.g. a score), with the number in the middle. */
export function Ring({ pct, color, label, size = 76 }: { pct: number | null; color: string; label: string; size?: number }) {
  const r = 30, c = 2 * Math.PI * r, p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <svg className="ring" width={size} height={size} viewBox="0 0 76 76" role="img" aria-label={`${label}: ${pct === null ? 'no data' : `${pct}%`}`}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="#eef2f6" strokeWidth="8" />
      {p > 0 && <circle cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 38 38)" />}
      <text x="38" y="43" textAnchor="middle" className="ring-text">{pct === null ? '—' : `${Math.round(pct)}%`}</text>
    </svg>
  );
}

/** Background shade for a table cell (one hue, light to dark). */
export const heat = (v: number, max: number) => (max > 0 && v > 0 ? `rgba(37, 99, 235, ${(0.08 + 0.42 * (v / max)).toFixed(2)})` : undefined);
