/** Text size for the whole app (A− / A+), remembered on this device. */
import { useEffect, useState } from 'react';

const KEY = 'wgl.fontsize';
const MIN = 14;
const MAX = 24;
const DEFAULT = 17;

function read(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= MIN && v <= MAX ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function useFontSize() {
  const [size, setSize] = useState(read);
  useEffect(() => {
    document.documentElement.style.fontSize = `${size}px`;
    try {
      localStorage.setItem(KEY, String(size));
    } catch { /* private window */ }
  }, [size]);
  return [size, (d: number) => setSize((s) => Math.min(MAX, Math.max(MIN, s + d)))] as const;
}

export function FontButtons() {
  const [size, change] = useFontSize();
  return (
    <span className="font-btns" title={`Text size ${size}`}>
      <button aria-label="Smaller text" onClick={() => change(-1)}>A−</button>
      <button aria-label="Larger text" onClick={() => change(1)}>A+</button>
    </span>
  );
}

/** Simple line icons (24 x 24, drawn with the current text colour). */
const ICONS: Record<string, string> = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  project: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M7 13h6M10 16h7',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  works: 'M4 6h16M4 12h16M4 18h10M18 16l2 2-2 2',
  issues: 'M12 3 2 20h20L12 3zM12 10v4M12 17v.1',
  grievances: 'M4 5h16v11H9l-5 4V5zM8 9h8M8 12h5',
  compliance: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3zM9 12l2 2 4-4',
  utilities: 'M13 3 6 13h5l-1 8 7-10h-5l1-8z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  layers: 'M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  close: 'M6 6l12 12M18 6 6 18',
  satellite: 'M4 15l5 5M7 12l5 5M13 6l5 5-3 3-5-5 3-3zM15 4l5 5M3 21h4',
  network: 'M5 6a2 2 0 1 0 0 .1M19 6a2 2 0 1 0 0 .1M12 18a2 2 0 1 0 0 .1M7 6h10M6 8l5 8M18 8l-5 8',
  boundary: 'M4 7l5-3 6 3 5-3v13l-5 3-6-3-5 3V7z',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.2-1.6-.4-.9.2-1.9 1.2-1.9H17a4 4 0 0 0 4-4c0-5-4-10.5-9-10.5zM7.5 11a1 1 0 1 0 0 .1M10 7a1 1 0 1 0 0 .1M15 7.5a1 1 0 1 0 0 .1',
  legend: 'M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10',
  chevron: 'M9 6l6 6-6 6',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  dots: 'M5 12h.1M12 12h.1M19 12h.1',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  photo: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.1',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.1',
  check: 'M5 12l5 5 9-10',
  admin: 'M12 3l1.6 2.6 3-.6.6 3 2.6 1.6-1.6 2.6.6 3-3 .6L12 21l-1.6-2.6-3 .6-.6-3L4.2 14l1.6-2.6-.6-3 3-.6L12 3zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.7',
};
export function Icon({ name, size }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}
