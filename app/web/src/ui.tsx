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
