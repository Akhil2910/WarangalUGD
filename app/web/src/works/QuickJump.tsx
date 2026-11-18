/**
 * Quick jump (Ctrl+K / ⌘K): type a page name, a work stretch, issue or grievance number, a manhole, ward or road, and go there.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Icon } from '../ui.tsx';

export interface JumpPage { key: string; label: string; hub: string; icon: string }
interface Found { kind: string; label: string; detail: string; lon: number; lat: number }
type Item = { type: 'page'; page: JumpPage } | { type: 'found'; r: Found } | { type: 'issue'; code: string } | { type: 'grievance'; number: string };

export function QuickJump({ pages, onPage, onFound, onIssue, onGrievance, onClose }: {
  pages: JumpPage[]; onPage: (key: string) => void; onFound: (r: Found) => void; onIssue: (code: string) => void; onGrievance: (n: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) return setFound([]);
    const t = setTimeout(async () => {
      const [x, y] = await Promise.all([
        api<{ results: Found[] }>(`/api/search?q=${encodeURIComponent(s)}`).catch(() => ({ results: [] })),
        api<{ results: Found[] }>(`/api/search/db?q=${encodeURIComponent(s)}`).catch(() => ({ results: [] })),
      ]);
      setFound([...y.results, ...x.results].slice(0, 12));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);
  const items = useMemo<Item[]>(() => {
    const s = q.trim().toLowerCase();
    const out: Item[] = [];
    const up = q.trim().toUpperCase();
    if (/^([A-Z][A-Z0-9]{1,9}-)?I-\d{1,7}$/.test(up)) out.push({ type: 'issue', code: up.replace(/I-(\d+)$/, (_, n) => `I-${n.padStart(4, '0')}`) });
    if (/^([A-Z][A-Z0-9]{1,9}-)?G-\d{1,6}$/.test(up)) out.push({ type: 'grievance', number: up.replace(/G-(\d+)$/, (_, n) => `G-${n.padStart(6, '0')}`) });
    for (const p of pages) if (!s || p.label.toLowerCase().includes(s) || p.hub.toLowerCase().includes(s)) out.push({ type: 'page', page: p });
    for (const r of found) out.push({ type: 'found', r });
    return out.slice(0, 18);
  }, [q, pages, found]);
  useEffect(() => setSel(0), [q]);
  const go = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    if (it.type === 'page') onPage(it.page.key);
    else if (it.type === 'issue') onIssue(it.code);
    else if (it.type === 'grievance') onGrievance(it.number);
    else onFound(it.r);
  };
  return (
    <div className="modal jump-back" onClick={onClose}>
      <div className="jump" role="dialog" aria-label="Quick jump" onClick={(e) => e.stopPropagation()}>
        <div className="jump-input">
          <Icon name="search" />
          <input ref={box} value={q} placeholder="Go to a page, work stretch, issue (I-12), grievance (G-5), manhole, ward or road…" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(items.length - 1, x + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]); }
              else if (e.key === 'Escape') onClose();
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul className="jump-list">
          {items.map((it, i) => (
            <li key={i}>
              <button className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => go(it)}>
                {it.type === 'page' && <><Icon name={it.page.icon} /><span className="grow">{it.page.label}</span><span className="muted small">{it.page.hub}</span></>}
                {it.type === 'issue' && <><Icon name="issues" /><span className="grow">Open issue {it.code}</span><span className="muted small">Checks</span></>}
                {it.type === 'grievance' && <><Icon name="grievances" /><span className="grow">Find grievance {it.number}</span><span className="muted small">Checks</span></>}
                {it.type === 'found' && <><Icon name={it.r.kind === 'Work stretch' ? 'works' : it.r.kind === 'Ward' ? 'boundary' : 'pin'} /><span className="grow">{it.r.label} <span className="muted small">{it.r.detail}</span></span><span className="muted small">{it.r.kind}</span></>}
              </button>
            </li>
          ))}
          {!items.length && <li className="muted small jump-empty">Nothing found.</li>}
        </ul>
        <div className="jump-foot muted small">↑ ↓ to choose · Enter to open · Ctrl+K any time</div>
      </div>
    </div>
  );
}
