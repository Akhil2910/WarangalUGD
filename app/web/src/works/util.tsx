import { useEffect, useState } from 'react';
import { TIME_ZONE } from 'shared';
import { api } from '../api.ts';

export interface Gps {
  lat: number;
  lon: number;
  accuracy_m: number;
}

/** Current phone position (asked once when a form opens). */
export function useGps(active: boolean) {
  const [gps, setGps] = useState<Gps | null>(null);
  const [state, setState] = useState<'waiting' | 'good' | 'weak' | 'none'>('waiting');
  useEffect(() => {
    if (!active) return;
    if (!navigator.geolocation) return setState('none');
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const g = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) };
        setGps(g);
        setState(g.accuracy_m <= 30 ? 'good' : 'weak');
      },
      () => setState('none'),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  return { gps, state };
}

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Photos are made smaller on the phone (long side 1,600 px, JPEG) before upload. */
async function compressPhoto(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not read the photo.'))), 'image/jpeg', 0.82));
}

export interface Uploaded {
  id: string;
  name: string;
  kind: 'photo' | 'document';
}

export async function uploadFile(file: File, kind: 'photo' | 'document', gps: Gps | null): Promise<Uploaded> {
  let blob: Blob = file;
  let mime = file.type;
  if (kind === 'photo' || (kind === 'document' && file.type.startsWith('image/'))) {
    blob = await compressPhoto(file);
    mime = 'image/jpeg';
  }
  const data = toBase64(await blob.arrayBuffer());
  const r = await api<{ id: string }>('/api/files', { kind, name: file.name, mime, data, gps, taken_at: new Date(file.lastModified || Date.now()).toISOString() });
  return { id: r.id, name: file.name, kind };
}

const dtf = new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
export const fmtTime = (s: string | null | undefined) => (s ? dtf.format(new Date(s)) : '—');
export const fmtDate = (s: string | null | undefined) => (s ? df.format(new Date(s)) : '—');
export const km = (m: number) => (m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function GpsBadge({ state, gps }: { state: string; gps: Gps | null }) {
  const label = state === 'good' ? `GPS good (±${gps?.accuracy_m} m)` : state === 'weak' ? `GPS weak (±${gps?.accuracy_m} m)` : state === 'none' ? 'No GPS' : 'Finding GPS…';
  return <span className={`gps gps-${state}`}>{label}</span>;
}
