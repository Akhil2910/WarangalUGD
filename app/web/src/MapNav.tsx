/**
 * Map navigation: a large control bar (zoom with the current level, whole city, previous view, my location,
 * full screen, north-up), a Go-to menu (GWMC zone, ward, sewerage zone), Zoom to area (drag a box),
 * an overview map, the coordinates under the mouse, a right-click / long-press menu and keyboard shortcuts.
 * Rotation is off: north always stays up.
 */
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';

type BBox = [number, number, number, number];
type FC = { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };
export type AreaType = 'wards' | 'admin' | 'sewerzones';

const LEVELS: [number, string][] = [[12.5, 'City'], [14, 'Zone'], [15.5, 'Ward'], [17.5, 'Street'], [99, 'Site']];
const levelOf = (z: number) => LEVELS.find(([max]) => z < max)![1];

export function MapNav({ map, cityBounds, zones, boundaries, onShowArea, onReportAt, canReport, active }: {
  map: MlMap | null; cityBounds: BBox; zones: { id: string; name?: string }[];
  boundaries: { wards?: FC; admin?: FC; sewerzones?: FC };
  onShowArea: (type: AreaType, key: string | number) => void;
  onReportAt: (lon: number, lat: number) => void; canReport: boolean; active: boolean;
}) {
  const [zoom, setZoom] = useState(map?.getZoom() ?? 11);
  const [bearing, setBearing] = useState(0);
  const [jump, setJump] = useState(false);
  const [areaMode, setAreaMode] = useState(false);
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [coord, setCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; lon: number; lat: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [overview, setOverview] = useState(() => { try { return localStorage.getItem('wgl.overview') !== 'off'; } catch { return true; } });
  const [full, setFull] = useState(false);
  const [locating, setLocating] = useState(false);
  const history = useRef<{ c: [number, number]; z: number }[]>([]);
  const backing = useRef(false);
  const geo = useRef<maplibregl.GeolocateControl | null>(null);

  // follow the map: zoom level, bearing, view history, coordinates, context menu, long press
  useEffect(() => {
    if (!map) return;
    const onZoom = () => setZoom(map.getZoom());
    const onRotate = () => setBearing(map.getBearing());
    const onMoveEnd = () => {
      const v = { c: [map.getCenter().lng, map.getCenter().lat] as [number, number], z: map.getZoom() };
      if (backing.current) { backing.current = false; return; }
      const last = history.current[history.current.length - 1];
      if (last && Math.abs(last.z - v.z) < 0.3 && Math.hypot(last.c[0] - v.c[0], last.c[1] - v.c[1]) < 0.0004 * 2 ** (17 - v.z)) return;
      history.current.push(v);
      if (history.current.length > 40) history.current.shift();
    };
    let raf = 0;
    const onMouse = (e: maplibregl.MapMouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setCoord({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    };
    const onOut = () => setCoord(null);
    const onCtx = (e: maplibregl.MapMouseEvent) => { e.preventDefault(); setMenu({ x: e.point.x, y: e.point.y, lon: e.lngLat.lng, lat: e.lngLat.lat }); };
    let press: ReturnType<typeof setTimeout> | null = null;
    const onTouchStart = (e: maplibregl.MapTouchEvent) => {
      if (press) clearTimeout(press);
      if (e.points.length !== 1) return;
      const p = e.point, ll = e.lngLat;
      press = setTimeout(() => setMenu({ x: p.x, y: p.y, lon: ll.lng, lat: ll.lat }), 650);
    };
    const cancelPress = () => { if (press) clearTimeout(press); press = null; };
    const onAnyClick = () => setMenu(null);
    onMoveEnd();
    map.on('zoom', onZoom); map.on('rotate', onRotate); map.on('moveend', onMoveEnd);
    map.on('mousemove', onMouse); map.on('mouseout', onOut); map.on('contextmenu', onCtx);
    map.on('touchstart', onTouchStart); map.on('touchmove', cancelPress); map.on('touchend', cancelPress); map.on('movestart', onAnyClick); map.on('click', onAnyClick);
    // the geolocation dot (the control's own button is hidden; ours triggers it)
    const g = new maplibregl.GeolocateControl({ trackUserLocation: true, showAccuracyCircle: true, positionOptions: { enableHighAccuracy: true } });
    map.addControl(g, 'bottom-right');
    g.on('geolocate', () => setLocating(false));
    g.on('error', () => setLocating(false));
    g.on('trackuserlocationend', () => setLocating(false));
    geo.current = g;
    return () => {
      map.off('zoom', onZoom); map.off('rotate', onRotate); map.off('moveend', onMoveEnd);
      map.off('mousemove', onMouse); map.off('mouseout', onOut); map.off('contextmenu', onCtx);
      map.off('touchstart', onTouchStart); map.off('touchmove', cancelPress); map.off('touchend', cancelPress); map.off('movestart', onAnyClick); map.off('click', onAnyClick);
      try { map.removeControl(g); } catch { /* map already gone */ }
    };
  }, [map]);

  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);

  const city = () => map?.fitBounds(cityBounds, { padding: 40, duration: 900 });
  const back = () => {
    if (!map || history.current.length < 2) return;
    history.current.pop();
    const v = history.current[history.current.length - 1];
    backing.current = true;
    map.flyTo({ center: v.c, zoom: v.z, duration: 800 });
  };
  const locate = () => { setLocating(true); geo.current?.trigger(); };
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

  // keyboard shortcuts (only on the map tab, not while typing or in a pop-up)
  useEffect(() => {
    if (!map || !active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal')) return;
      const k = e.key;
      if (k === 'Escape') { setAreaMode(false); setRect(null); setMenu(null); setJump(false); return; }
      if (k === '+' || k === '=') map.zoomIn();
      else if (k === '-' || k === '_') map.zoomOut();
      else if (k === 'ArrowUp') map.panBy([0, -140]);
      else if (k === 'ArrowDown') map.panBy([0, 140]);
      else if (k === 'ArrowLeft') map.panBy([-140, 0]);
      else if (k === 'ArrowRight') map.panBy([140, 0]);
      else if (k === 'h' || k === 'H') city();
      else if (k === 'b' || k === 'B') back();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map, active]);

  // zoom to area: drag a box
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const local = (e: React.PointerEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const rectRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const putRect = (r: typeof rectRef.current) => { rectRef.current = r; setRect(r); };
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.area-hint')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = local(e); startRef.current = p; putRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: React.PointerEvent) => { if (!startRef.current) return; e.preventDefault(); const p = local(e); putRect({ x0: startRef.current.x, y0: startRef.current.y, x1: p.x, y1: p.y }); };
  const onUp = (e: React.PointerEvent) => {
    if (startRef.current) { const p = local(e); rectRef.current = { x0: startRef.current.x, y0: startRef.current.y, x1: p.x, y1: p.y }; }
    const r = rectRef.current; startRef.current = null; putRect(null);
    if (!map || !r || Math.abs(r.x1 - r.x0) < 12 || Math.abs(r.y1 - r.y0) < 12) return;
    const a = map.unproject([Math.min(r.x0, r.x1), Math.max(r.y0, r.y1)]), b = map.unproject([Math.max(r.x0, r.x1), Math.min(r.y0, r.y1)]);
    map.fitBounds([a.lng, a.lat, b.lng, b.lat], { padding: 10, duration: 700, maxZoom: 21 });
    setAreaMode(false);
  };

  const copy = async (lat: number, lon: number) => {
    const t = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    try { await navigator.clipboard.writeText(t); } catch { window.prompt('Copy the location', t); }
    setCopied(true); setTimeout(() => setCopied(false), 1500); setMenu(null);
  };
  const wardList = (boundaries.wards?.features ?? []).map((f) => Number(f.properties.ward)).filter(Boolean).sort((a, b) => a - b);
  const sewerList = (boundaries.sewerzones?.features ?? []).map((f) => String(f.properties.name)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!active) return null;
  return (
    <>
      <div className="nav-bar" role="toolbar" aria-label="Map navigation">
        <button className="nav-btn" onClick={() => map?.zoomIn()} title="Zoom in (+)" aria-label="Zoom in"><Ico d="M12 5v14M5 12h14" /></button>
        <div className="nav-level" title={`Zoom ${zoom.toFixed(1)}`}>{levelOf(zoom)}</div>
        <button className="nav-btn" onClick={() => map?.zoomOut()} title="Zoom out (−)" aria-label="Zoom out"><Ico d="M5 12h14" /></button>
        <span className="nav-gap" />
        <button className="nav-btn" onClick={city} title="Whole city (H)" aria-label="Whole city"><Ico d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" /></button>
        <button className="nav-btn" onClick={back} title="Previous view (B)" aria-label="Previous view"><Ico d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></button>
        <button className={`nav-btn ${jump ? 'on' : ''}`} onClick={() => setJump(!jump)} title="Go to a zone, ward or sewerage zone" aria-label="Go to"><Ico d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" /></button>
        <button className={`nav-btn ${areaMode ? 'on' : ''}`} onClick={() => { setAreaMode(!areaMode); setJump(false); }} title="Zoom to area: drag a box on the map" aria-label="Zoom to area"><Ico d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M10 10h4v4h-4z" /></button>
        <button className={`nav-btn ${locating ? 'on' : ''}`} onClick={locate} title="My location" aria-label="My location"><Ico d="M12 2v3M12 19v3M2 12h3M19 12h3M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" /></button>
        <button className="nav-btn" onClick={fullscreen} title={full ? 'Leave full screen' : 'Full screen'} aria-label="Full screen">
          {full ? <Ico d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <Ico d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
        </button>
        <button className={`nav-btn ${overview ? 'on' : ''}`} onClick={() => { const v = !overview; setOverview(v); try { localStorage.setItem('wgl.overview', v ? 'on' : 'off'); } catch { /* ignore */ } }} title={overview ? 'Hide the overview map' : 'Show the overview map'} aria-label="Overview map"><Ico d="M3 5h18v14H3z M13 11h6v6h-6z" /></button>
        {Math.abs(bearing) > 0.5 && <button className="nav-btn" onClick={() => map?.resetNorth()} title="North up" aria-label="North up"><span style={{ transform: `rotate(${-bearing}deg)`, display: 'inline-flex' }}><Ico d="M12 3l4 9h-8z M12 21l-4-9h8z" /></span></button>}
      </div>

      {jump && (
        <div className="jump-pop">
          <div className="jump-head"><b>Go to</b><button className="x" aria-label="Close" onClick={() => setJump(false)}>×</button></div>
          <label className="field">GWMC zone<select value="" onChange={(e) => { if (e.target.value) { onShowArea('admin', e.target.value); setJump(false); } }}>
            <option value="">Choose a zone…</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.id}{z.name ? ` · ${z.name}` : ''}</option>)}</select></label>
          <label className="field">Ward<select value="" onChange={(e) => { if (e.target.value) { onShowArea('wards', Number(e.target.value)); setJump(false); } }}>
            <option value="">Choose a ward…</option>{wardList.map((w) => <option key={w} value={w}>Ward {w}</option>)}</select></label>
          <label className="field">Sewerage zone<select value="" onChange={(e) => { if (e.target.value) { onShowArea('sewerzones', e.target.value); setJump(false); } }}>
            <option value="">Choose a sewerage zone…</option>{sewerList.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <p className="muted small">A work stretch, manhole or road: type it in the search box at the top.</p>
        </div>
      )}

      {areaMode && (
        <div className="area-catch" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          <div className="area-hint">Drag a box over the area to zoom into it · <button className="link" onClick={() => setAreaMode(false)} onPointerDown={(e) => e.stopPropagation()}>Cancel</button></div>
          {rect && <div className="area-rect" style={{ left: Math.min(rect.x0, rect.x1), top: Math.min(rect.y0, rect.y1), width: Math.abs(rect.x1 - rect.x0), height: Math.abs(rect.y1 - rect.y0) }} />}
        </div>
      )}

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
          <div className="ctx-coord">{menu.lat.toFixed(6)}, {menu.lon.toFixed(6)}</div>
          <button onClick={() => copy(menu.lat, menu.lon)}>Copy location</button>
          {canReport && <button onClick={() => { onReportAt(menu.lon, menu.lat); setMenu(null); }}>Report issue here</button>}
          <button onClick={() => { map?.flyTo({ center: [menu.lon, menu.lat], zoom: Math.min(21, (map?.getZoom() ?? 15) + 2) }); setMenu(null); }}>Zoom in here</button>
          <button onClick={() => setMenu(null)}>Close</button>
        </div>
      )}
      {copied && <div className="nav-toast">Location copied</div>}

      <div className="coord-read" aria-live="off">{coord ? `${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}` : ''}</div>
      {overview && <Overview map={map} cityBounds={cityBounds} wards={boundaries.wards} />}
    </>
  );
}

function Ico({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden><path d={d} /></svg>;
}

/** Small map of the whole city with a box showing the main map's view; tap to jump there. */
function Overview({ map, cityBounds, wards }: { map: MlMap | null; cityBounds: BBox; wards?: FC }) {
  const el = useRef<HTMLDivElement>(null);
  const ov = useRef<MlMap | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current, interactive: false, attributionControl: false, bounds: cityBounds, fitBoundsOptions: { padding: 6 },
      style: {
        version: 8,
        sources: {
          s2: { type: 'raster', tileSize: 256, maxzoom: 14, tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'] },
          wards: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
          view: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#e5e7eb' } },
          { id: 's2', type: 'raster', source: 's2', paint: { 'raster-saturation': -0.3 } },
          { id: 'wards', type: 'line', source: 'wards', paint: { 'line-color': '#fde047', 'line-width': 0.6, 'line-opacity': 0.8 } },
          { id: 'view-fill', type: 'fill', source: 'view', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.18 } },
          { id: 'view-line', type: 'line', source: 'view', paint: { 'line-color': '#ffffff', 'line-width': 2 } },
        ],
      },
    });
    ov.current = m;
    return () => { m.remove(); ov.current = null; };
  }, []);
  useEffect(() => {
    const m = ov.current;
    if (!m || !wards) return;
    const set = () => (m.getSource('wards') as maplibregl.GeoJSONSource | undefined)?.setData(wards as never);
    if (m.isStyleLoaded()) set(); else m.once('load', set);
  }, [wards]);
  useEffect(() => {
    const m = ov.current;
    if (!map || !m) return;
    const upd = () => {
      const b = map.getBounds();
      const poly = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()], [b.getWest(), b.getSouth()]]] } };
      const s = m.getSource('view') as maplibregl.GeoJSONSource | undefined;
      if (s) s.setData({ type: 'FeatureCollection', features: [poly] } as never);
    };
    if (m.isStyleLoaded()) upd(); else m.once('load', upd);
    map.on('move', upd);
    return () => { map.off('move', upd); };
  }, [map]);
  return (
    <div className="overview" title="Tap to go there"
      onClick={(e) => { const m = ov.current; if (!m || !map) return; const r = e.currentTarget.getBoundingClientRect(); const ll = m.unproject([e.clientX - r.left, e.clientY - r.top]); map.flyTo({ center: ll, duration: 700 }); }}>
      <div ref={el} className="overview-map" />
    </div>
  );
}
