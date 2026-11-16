/** Which ward / zone a point is in (ward outlines from DATA_DIR/wards.geojson); outside every ward: the nearest one, flagged. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';

interface Ward { ward: number; admin_zone: string; name: string; rings: number[][][] }
let wards: Ward[] | null = null;

function load(): Ward[] {
  if (wards) return wards;
  const f = path.join(DATA_DIR, 'wards.geojson');
  if (!existsSync(f)) return (wards = []);
  const gj = JSON.parse(readFileSync(f, 'utf8')) as { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };
  wards = gj.features.map((x) => ({
    ward: Number(x.properties.ward), admin_zone: String(x.properties.admin_zone ?? ''), name: String(x.properties.name ?? ''),
    rings: (x.geometry.type === 'Polygon' ? [x.geometry.coordinates] : (x.geometry.coordinates as unknown[])).flat() as number[][][],
  }));
  return wards;
}

function inRing(lon: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ward and zone of a point. Rings after the first of a polygon are holes. */
export function wardAt(lon: number, lat: number): { ward: number; admin_zone: string; outside: boolean } {
  const ws = load();
  if (!ws.length) return { ward: 0, admin_zone: '', outside: true };
  for (const w of ws) {
    let inside = false;
    for (const r of w.rings) if (inRing(lon, lat, r)) inside = !inside; // even-odd over all rings handles holes
    if (inside) return { ward: w.ward, admin_zone: w.admin_zone, outside: false };
  }
  let best = ws[0];
  let bestD = Infinity;
  for (const w of ws) for (const r of w.rings) for (const p of r) {
    const d = metres(lon, lat, p[0], p[1]);
    if (d < bestD) { bestD = d; best = w; }
  }
  return { ward: best.ward, admin_zone: best.admin_zone, outside: true };
}

export function metres(lon1: number, lat1: number, lon2: number, lat2: number) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Is the point within the area the city covers (with a 2 km margin)? */
export function nearCity(lon: number, lat: number) {
  const ws = load();
  if (!ws.length) return true;
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const w of ws) for (const r of w.rings) for (const p of r) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const m = 0.02;
  return lon >= minX - m && lon <= maxX + m && lat >= minY - m && lat <= maxY + m;
}

/** The GWMC zone a ward belongs to (from the ward outlines). */
export function zoneOfWard(ward: number): string {
  return load().find((w) => w.ward === ward)?.admin_zone ?? '';
}
