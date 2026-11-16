import { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { COMPLIANCE_THEME, EXISTING_DRAINS, NO_CITIZEN_DATA, ROLE_LABEL, ROLE_RANK, STAGES, UTILITY_LAYERS, utilityLayer, type Role } from 'shared';
import { DashboardPage } from './works/DashboardPage.tsx';
import { GrievancesPage } from './works/GrievancesPage.tsx';
import { UtilitiesPage, UtilityForm } from './works/UtilitiesPage.tsx';
import { api, type User } from './api.ts';
import { applyLayerStyle, buildStyle, LAYER_GROUPS, PIPE_WIDTHS, STYLE_DEFS, stageColorExpr, type LayerStyle, type Meta, type StyleKey } from './mapStyle.ts';
import { ReportIssueModal } from './works/ReportIssue.tsx';
import { StyleModal } from './works/StyleModal.tsx';
import { StretchCard, type Card } from './works/StretchCard.tsx';
import { WorksPage, EMPTY_FILTERS, type Filters } from './works/WorksPage.tsx';
import { CompliancePage } from './works/CompliancePage.tsx';
import { IssuesPage, type IssueRow } from './works/IssuesPage.tsx';
import { WorkPanel, newWork, type Preview, type WorkState } from './works/WorkPanel.tsx';
import { FontButtons } from './ui.tsx';
import { AreaSummary } from './works/AreaSummary.tsx';
import { addUtilityIcons, utilIconUrl } from './utilIcons.ts';
// MapLibre 6 runs its tile parsing in a separate worker file; let Vite bundle it and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);
let protocolAdded = false;

interface SearchResult { kind: string; label: string; detail: string; lon: number; lat: number }
type BBox = [number, number, number, number];
interface Boundary { type: 'wards' | 'admin' | 'sewerzones'; key: string | number; name: string; info: string; bbox: BBox; ward?: number; zone?: string; sewer?: string }
type GeoFC = { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };
interface SitePipe { id: number; code: string; length_m: number; dia_mm: number; stretch: string }

const bboxOf = (coords: unknown): BBox => {
  const pts: number[][] = [];
  const walk = (c: unknown) => (Array.isArray(c) && typeof c[0] === 'number' ? pts.push(c as number[]) : (c as unknown[]).forEach(walk));
  walk(coords);
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
};
type Tab = 'dashboard' | 'map' | 'works' | 'issues' | 'grievances' | 'compliance' | 'utilities';
const TABS: [Tab, string][] = [['dashboard', 'Dashboard'], ['map', 'Map'], ['works', 'Works'], ['issues', 'Issues'], ['grievances', 'Grievances'], ['compliance', 'Compliance'], ['utilities', 'Utilities']];

/** Which style settings each layer switch has. */
const STYLE_OF: Record<string, StyleKey[]> = {
  dpr: ['dpr_pipes', 'dpr_manholes'], drawn: ['drawn_pipes', 'drawn_manholes'], work: ['work_band'], wards: ['wards'], admin: ['admin'], sewerzones: ['sewerzones'],
};
const COORDS = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export function MapView({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, g.default])));
  const [layersOpen, setLayersOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [tab, setTab] = useState<Tab>('map');
  const [utilOn, setUtilOn] = useState<Set<string>>(() => new Set(UTILITY_LAYERS.map((u) => u.key)));
  const [drainsOn, setDrainsOn] = useState(false);
  const [utilCounts, setUtilCounts] = useState<Record<string, number>>({});
  const drainsLoaded = useRef(false);
  const [marking, setMarking] = useState<{ layer: string; pts: [number, number][]; form: boolean } | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState<'stage' | 'compliance'>('stage');
  const [worksFilters, setWorksFilters] = useState<Filters>(EMPTY_FILTERS);
  const [work, setWork] = useState<WorkState | null>(null);
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  const [zoom, setZoom] = useState(12);
  const [styles, setStyles] = useState<Partial<Record<StyleKey, LayerStyle>>>({});
  const [styleKeys, setStyleKeys] = useState<StyleKey[] | null>(null);
  const [reporting, setReporting] = useState<'pick' | { at: { lon: number; lat: number } | null } | null>(null);
  const canReport = user.role !== 'viewer';
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  const boundaries = useRef<Record<string, GeoFC>>({});
  const sitePipes = useRef<Map<number, SitePipe>>(new Map());
  const dprTaken = useRef<Record<string, string>>({});
  const canMake = ['aee', 'dee', 'commissioner', 'piu_officer'].includes(user.role);
  const tabs = TABS.filter(([t]) => !(t === 'grievances' && NO_CITIZEN_DATA.includes(user.role as Role)));
  const changed = useCallback(() => setRefreshKey((k) => k + 1), []);
  const clickRef = useRef<(e: MapMouseEvent) => void>(() => {});

  useEffect(() => {
    api<Meta>('/data/meta.json').then(setMeta).catch((e) => setError((e as Error).message));
    api<{ prefs: { map_styles?: Partial<Record<StyleKey, LayerStyle>> } }>('/api/me/prefs').then((r) => setStyles(r.prefs.map_styles ?? {})).catch(() => {});
    for (const [k, f] of [['wards', 'wards'], ['admin', 'admin_zones'], ['sewerzones', 'sewer_zones']] as const)
      api<GeoFC>(`/data/${f}.geojson`).then((g) => (boundaries.current[k] = g)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!meta || !box.current) return;
    if (!protocolAdded) {
      maplibregl.addProtocol('pmtiles', new Protocol().tile);
      protocolAdded = true;
    }
    const map = new maplibregl.Map({
      container: box.current,
      style: buildStyle(meta, location.origin),
      bounds: meta.bounds as BBox,
      maxBounds: [meta.bounds[0] - 0.35, meta.bounds[1] - 0.2, meta.bounds[2] + 0.35, meta.bounds[3] + 0.2],
      hash: 'map',
      maxZoom: 21,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true, positionOptions: { enableHighAccuracy: true } }), 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    mapRef.current = map;
    map.on('click', (e) => clickRef.current(e));
    map.on('load', () => void addUtilityIcons(map));
    map.on('styleimagemissing', () => void addUtilityIcons(map));
    map.on('zoomend', () => setZoom(map.getZoom()));
    setZoom(map.getZoom());
    for (const l of ['issue-pins', 'site-manholes', 'site-pipes', 'site-stretch-casing', 'pipes', 'manholes', 'stations'])
      map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer')), map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''));
    const qs = new URLSearchParams(location.search);
    map.once('load', () => {
      if (qs.get('open')) goToStretch(qs.get('open')!, true);
    });
    return () => map.remove();
  }, [meta]);

  // layer switches
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const g of LAYER_GROUPS) for (const id of g.layers) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible[g.key] ? 'visible' : 'none');
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [visible, meta]);

  // this person's colours, widths and line types
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => STYLE_DEFS.forEach((d) => applyLayerStyle(map, d, styles[d.key]));
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [styles, meta]);
  const changeStyle = (k: StyleKey, s: LayerStyle | null) => {
    const next = { ...styles };
    if (s) next[k] = s;
    else delete next[k];
    setStyles(next);
    const all = Object.fromEntries(STYLE_DEFS.map((d) => [d.key, next[d.key] ?? {}]));
    api('/api/me/prefs', { map_styles: all }).catch((e) => setError((e as Error).message));
  };

  const loadSite = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const s = await api<{ manholes: GeoFC; pipes: GeoFC; stretches: GeoFC; dpr_taken: Record<string, string> }>('/api/site/map');
    if (!map.getSource('site_mh')) return;
    (map.getSource('site_mh') as maplibregl.GeoJSONSource).setData(s.manholes as never);
    (map.getSource('site_pipes') as maplibregl.GeoJSONSource).setData(s.pipes as never);
    (map.getSource('site_stretches') as maplibregl.GeoJSONSource).setData(s.stretches as never);
    sitePipes.current = new Map(s.pipes.features.map((f) => [Number(f.properties.id), {
      id: Number(f.properties.id), code: String(f.properties.code), length_m: Number(f.properties.length_m), dia_mm: Number(f.properties.dia_mm), stretch: String(f.properties.stretch ?? ''),
    }]));
    dprTaken.current = s.dpr_taken;
  }, []);

  // work stretches, badges, issues (refreshed after every change and every 2 minutes)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const apply = async () => {
      await loadSite();
      if (cancelled) return;
      map.setPaintProperty('site-stretch-casing', 'line-color', theme === 'stage' ? stageColorExpr
        : ['match', ['get', 'theme'], ...COMPLIANCE_THEME.flatMap((s) => [s.key, s.color]), '#94a3b8'] as never);
      const r = await api<{ states: [string, string, string, string, number?, number?][] }>('/api/stretches/states');
      if (cancelled) return;
      (map.getSource('badges') as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: r.states.filter((x) => x[3] && x[4] !== undefined).map((x) => ({ type: 'Feature', properties: { b: x[3] }, geometry: { type: 'Point', coordinates: [x[4]!, x[5]!] } })),
      });
      const ut = await api<GeoFC>('/api/utilities/map');
      if (cancelled || !map.getSource('utilities')) return;
      (map.getSource('utilities') as maplibregl.GeoJSONSource).setData(ut as never);
      const counts: Record<string, number> = {};
      for (const f of ut.features) counts[String(f.properties.layer)] = (counts[String(f.properties.layer)] ?? 0) + 1;
      setUtilCounts(counts);
      const iss = await api<{ rows: IssueRow[] }>('/api/issues?status=active&limit=5000');
      if (cancelled || !map.getSource('issues')) return;
      (map.getSource('issues') as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: iss.rows.filter((i) => i.lon != null).map((i) => ({
          type: 'Feature', properties: { code: i.code, title: i.title, severity: i.severity, stretch: i.stretch_code }, geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
        })),
      });
    };
    const run = () => apply().catch(() => {});
    if (map.isStyleLoaded()) run();
    else map.once('load', run);
    const timer = setInterval(run, 120000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [meta, refreshKey, theme]);

  useEffect(() => {
    if (tab === 'map') setTimeout(() => mapRef.current?.resize(), 0);
  }, [tab]);

  // utility layers: which show, the existing drains (loaded the first time they are switched on), the line being marked
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const keys = ['literal', [...utilOn]];
      for (const id of ['util-lines', 'util-line-icons']) map.setFilter(id, ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'layer'], keys]] as never);
      for (const id of ['util-points', 'util-dots']) map.setFilter(id, ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'layer'], keys]] as never);
      map.setLayoutProperty('drains-line', 'visibility', drainsOn ? 'visible' : 'none');
      if (drainsOn && !drainsLoaded.current) {
        drainsLoaded.current = true;
        (map.getSource('drains') as maplibregl.GeoJSONSource).setData(`${location.origin}/data/utility_drains.geojson`);
      }
      const pts = marking?.pts ?? [];
      (map.getSource('util_draft') as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: [...pts.map((c) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: c } })),
          ...(pts.length > 1 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: pts } }] : [])],
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [utilOn, drainsOn, marking, meta]);
  const saveUtility = async (props: Record<string, unknown>) => {
    const m = marking!;
    const def = utilityLayer(m.layer)!;
    const geom = def.geom === 'point' ? { type: 'Point', coordinates: m.pts[0] } : { type: 'LineString', coordinates: m.pts };
    await api('/api/utilities', { layer: m.layer, geom, props });
    setMarking(null);
    setNotice(`${def.label} saved.`);
    changed();
  };

  // yellow: pipes chosen for the work stretch; ring: the manhole a new pipe starts from
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('dpr-pipes-sel')) return;
    map.setFilter('dpr-pipes-sel', ['in', ['get', 'pipe_id'], ['literal', work ? [...work.dpr.keys()] : []]] as never);
    map.setFilter('site-pipes-sel', ['in', ['get', 'id'], ['literal', work ? [...work.site.keys()] : []]] as never);
    map.setFilter('mh-active', ['==', ['get', 'id'], work?.start?.id ?? -1] as never);
  }, [work]);

  // live summary of the chosen pipes (pieces, manholes, already taken)
  const pickKey = work ? [...work.dpr.keys(), ...work.site.keys()].join(',') : '';
  useEffect(() => {
    if (!work) return;
    if (!pickKey) return setWork((w) => (w ? { ...w, preview: null } : w));
    const t = setTimeout(() => {
      api<Preview>('/api/site/stretches/preview', { dpr_pipes: [...work.dpr.keys()], pipes: [...work.site.keys()], stretch: work.edit?.code })
        .then((p) => setWork((w) => (w ? { ...w, preview: p } : w))).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [pickKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('wards-sel')) return;
    map.setFilter('wards-sel', ['==', ['get', 'ward'], boundary?.type === 'wards' ? boundary.key : -1] as never);
    map.setFilter('admin-sel', ['==', ['get', 'zone_id'], boundary?.type === 'admin' ? boundary.key : ''] as never);
    map.setFilter('sewer-sel', ['==', ['get', 'name'], boundary?.type === 'sewerzones' ? boundary.key : ''] as never);
  }, [boundary]);

  const fit = (b: BBox, maxZoom = 18) => {
    setTab('map');
    setTimeout(() => mapRef.current?.fitBounds(b, { padding: 80, maxZoom }), 60);
  };
  const locate = (c: Card) => fit(bboxOf(c.stretch.geom.coordinates));
  const goToStretch = async (code: string, open = false) => {
    try {
      locate(await api<Card>(`/api/stretches/${code}`));
      if (open) setOpenCode(code);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const goToPoint = (lon: number, lat: number, z = 18) => {
    setTab('map');
    setTimeout(() => mapRef.current?.flyTo({ center: [lon, lat], zoom: z }), 60);
  };

  // ---------------- making a work stretch ----------------
  const ws = (fn: (w: WorkState) => WorkState) => setWork((w) => (w ? fn(w) : w));
  const wmsg = (msg: string) => ws((w) => ({ ...w, msg, busy: false }));
  const hitBox = (e: MapMouseEvent, px: number, layers: string[]) => {
    const map = mapRef.current!;
    const p = e.point;
    return map.queryRenderedFeatures([[p.x - px, p.y - px], [p.x + px, p.y + px]], { layers: layers.filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none') });
  };
  const workClick = async (e: MapMouseEvent, w: WorkState) => {
    if (w.mode === 'pick') {
      const f = hitBox(e, 8, ['site-pipes', 'pipes'])[0];
      if (!f) return wmsg(zoom < 15 ? 'Zoom in closer and tap a pipe.' : 'No pipe there. Tap on a pink (DPR) or white (drawn) pipe.');
      if (f.layer.id === 'site-pipes') {
        const p = sitePipes.current.get(Number(f.properties.id));
        if (!p) return;
        if (p.stretch && p.stretch !== w.edit?.code) return wmsg(`${p.code} is already in work stretch ${p.stretch}.`);
        ws((x) => {
          const site = new Map(x.site);
          if (site.has(p.id)) site.delete(p.id);
          else site.set(p.id, { code: p.code, length_m: p.length_m, dia_mm: p.dia_mm });
          return { ...x, site, msg: '' };
        });
      } else {
        const id = String(f.properties.pipe_id);
        const taken = dprTaken.current[id];
        if (taken && taken !== w.edit?.code) return wmsg(`DPR pipe ${id} is already in work stretch ${taken}.`);
        ws((x) => {
          const dpr = new Map(x.dpr);
          if (dpr.has(id)) dpr.delete(id);
          else dpr.set(id, { code: id, length_m: Number(f.properties.length_m), dia_mm: Number(f.properties.dia_mm) });
          return { ...x, dpr, msg: '' };
        });
      }
      return;
    }
    // draw a new pipe: snap to a drawn manhole, then a DPR manhole, else place a new manhole
    ws((x) => ({ ...x, busy: true, msg: '' }));
    try {
      const drawnMh = hitBox(e, 14, ['site-manholes'])[0];
      const dprMh = drawnMh ? null : hitBox(e, 14, ['manholes'])[0];
      let target: { id: number; code: string };
      const added: WorkState['drawn'] = [];
      if (drawnMh) target = { id: Number(drawnMh.properties.id), code: String(drawnMh.properties.code) };
      else {
        const r = await api<{ id: number; code: string; existing: boolean }>('/api/site/manholes',
          dprMh ? { dpr_mh: String(dprMh.properties.mh_code) } : { lon: e.lngLat.lng, lat: e.lngLat.lat });
        target = { id: r.id, code: r.code };
        if (!r.existing) added.push({ kind: 'mh', id: r.id, code: r.code });
      }
      if (!w.start) {
        await loadSite();
        return ws((x) => ({ ...x, busy: false, start: target, drawn: [...x.drawn, ...added], msg: added.length ? `Added manhole ${target.code}.` : '' }));
      }
      if (w.start.id === target.id) return ws((x) => ({ ...x, busy: false, msg: 'Tap a different manhole or point.' }));
      const p = await api<{ id: number; code: string; length_m: number }>('/api/site/pipes', { from_mh: w.start.id, to_mh: target.id, dia_mm: w.dia, material: w.material });
      added.push({ kind: 'pipe', id: p.id, code: p.code });
      await loadSite();
      ws((x) => {
        const site = new Map(x.site);
        site.set(p.id, { code: p.code, length_m: p.length_m, dia_mm: x.dia });
        return { ...x, busy: false, start: target, site, drawn: [...x.drawn, ...added], msg: `Laid ${p.code}: ${x.start!.code} → ${target.code}, ${p.length_m} m.` };
      });
    } catch (err) {
      await loadSite();
      wmsg((err as Error).message);
    }
  };
  const workUndo = async () => {
    const last = work?.drawn[work.drawn.length - 1];
    if (!last) return;
    try {
      await api(`/api/site/${last.kind === 'mh' ? 'manholes' : 'pipes'}/${last.id}/delete`, {});
      await loadSite();
      ws((x) => {
        const site = new Map(x.site);
        if (last.kind === 'pipe') site.delete(last.id);
        return { ...x, site, drawn: x.drawn.slice(0, -1), start: x.start?.id === last.id ? null : x.start, msg: `Removed ${last.code}.` };
      });
    } catch (err) {
      wmsg((err as Error).message);
    }
  };
  const workSave = async () => {
    const w = work;
    if (!w) return;
    ws((x) => ({ ...x, busy: true, msg: '' }));
    try {
      let code: string;
      if (w.edit) {
        const c = await api<Card>(`/api/stretches/${w.edit.code}`);
        const curCodes = c.stretch.pipes_detail.map((p) => p[0]);
        const curDpr = curCodes.filter((x) => /^P\d{6}$/.test(x));
        const curSite = [...sitePipes.current.values()].filter((p) => p.stretch === w.edit!.code).map((p) => p.id);
        await api(`/api/site/stretches/${w.edit.code}/pipes`, {
          add_dpr: [...w.dpr.keys()].filter((x) => !curDpr.includes(x)), remove_dpr: curDpr.filter((x) => !w.dpr.has(x)),
          add: [...w.site.keys()].filter((x) => !curSite.includes(x)), remove: curSite.filter((x) => !w.site.has(x)),
        });
        code = w.edit.code;
      } else {
        const ends = w.ends ? {
          start_point: { lat: Number(w.ends.slat), lon: Number(w.ends.slon), code: w.preview?.start_point?.code },
          end_point: { lat: Number(w.ends.elat), lon: Number(w.ends.elon), code: w.preview?.end_point?.code },
        } : {};
        code = (await api<{ code: string }>('/api/site/stretches', { name: w.name, dpr_pipes: [...w.dpr.keys()], pipes: [...w.site.keys()], ...ends })).code;
      }
      setWork(null);
      changed();
      setOpenCode(code);
    } catch (err) {
      wmsg((err as Error).message);
    }
  };
  const startWork = () => {
    setOpenCode(null);
    setBoundary(null);
    setLayersOpen(false);
    setTab('map');
    setWork(newWork());
  };
  const editPipes = async (c: Card) => {
    const pipes = (await api<Card>(`/api/stretches/${c.stretch.code}`)).stretch.pipes_detail;
    const dpr = new Map(pipes.filter((p) => /^P\d{6}$/.test(p[0])).map((p) => [p[0], { code: p[0], length_m: p[4], dia_mm: p[1] }] as [string, { code: string; length_m: number; dia_mm: number }]));
    const site = new Map([...sitePipes.current.values()].filter((p) => p.stretch === c.stretch.code).map((p) => [p.id, { code: p.code, length_m: p.length_m, dia_mm: p.dia_mm }] as [number, { code: string; length_m: number; dia_mm: number }]));
    setOpenCode(null);
    setWork({ ...newWork(), dpr, site, edit: { code: c.stretch.code } });
    locate(c);
  };

  // ---------------- clicks ----------------
  clickRef.current = (e: MapMouseEvent) => {
    const map = mapRef.current!;
    if (work) return void workClick(e, work);
    if (reporting === 'pick') return void setReporting({ at: { lon: e.lngLat.lng, lat: e.lngLat.lat } });
    if (marking && !marking.form) {
      const pt: [number, number] = [Math.round(e.lngLat.lng * 1e7) / 1e7, Math.round(e.lngLat.lat * 1e7) / 1e7];
      const def = utilityLayer(marking.layer)!;
      return void setMarking(def.geom === 'point' ? { ...marking, pts: [pt], form: true } : { ...marking, pts: [...marking.pts, pt] });
    }
    setLayersOpen(false);
    const ut = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['util-points', 'util-dots', 'util-line-icons', 'util-lines', 'drains-line'].filter((l) => map.getLayoutProperty(l, 'visibility') !== 'none') })[0];
    if (ut) {
      const p = ut.properties;
      const title = ut.layer.id === 'drains-line' ? EXISTING_DRAINS.label : utilityLayer(String(p.layer))?.label ?? 'Utility';
      const LABEL: Record<string, string> = { name: 'Name', owner: 'Owner', size: 'Size', material: 'Material', depth_m: 'Depth (m)', condition: 'Condition', position: 'Position', obstruction: 'In the way of sewer work', alert: 'Alert', alert_status: 'Alert status', surface: 'Surface', condition_text: 'Road condition', condition_score: 'Condition score', road_class: 'Road type', length_m: 'Length (m)', contact: 'Contact', note: 'Note', ward: 'Ward' };
      const nice = (v: unknown) => (v === true || v === 'true' ? 'Yes' : v === false || v === 'false' ? 'No' : String(v).replace(/_/g, ' '));
      const rows = Object.entries(LABEL).filter(([k]) => p[k] !== undefined && p[k] !== '' && p[k] !== null).map(([k, l]) => `<tr><th>${esc(l)}</th><td>${esc(nice(p[k]))}</td></tr>`).join('');
      return void new maplibregl.Popup({ maxWidth: '340px' }).setLngLat(e.lngLat).setHTML(`<div class="pop-title">${esc(title)}</div><table class="pop">${rows}</table>`).addTo(map);
    }
    const layers = ['issue-pins', 'site-manholes', 'site-pipes', 'site-stretch-casing', 'stations', 'manholes', 'pipes', 'pipes-major']
      .filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none');
    const feats = map.queryRenderedFeatures(e.point, { layers });
    const popup = (html: string) => new maplibregl.Popup({ maxWidth: '340px' }).setLngLat(e.lngLat).setHTML(html).addTo(map);
    const stretch = feats.find((f) => f.layer.id === 'site-stretch-casing') ?? feats.find((f) => f.layer.id === 'site-pipes' && f.properties.stretch);
    const top = feats[0];
    if (top?.layer.id === 'issue-pins') return void setOpenCode(String(top.properties.stretch));
    if (stretch) return void setOpenCode(String(stretch.properties.code ?? stretch.properties.stretch));
    if (!top) return selectBoundary(e);
    if (top.layer.id === 'site-manholes') {
      const p = top.properties;
      return void popup(`<div class="pop-title">Manhole ${esc(p.code)}</div><table class="pop"><tr><th>Depth</th><td>${p.depth_m ?? '—'} m</td></tr><tr><th>Invert</th><td>${p.invert_m ?? '—'} m</td></tr><tr><th>Ward</th><td>${p.ward}</td></tr></table>`);
    }
    if (top.layer.id === 'site-pipes') {
      const p = top.properties;
      return void popup(`<div class="pop-title">Drawn pipe ${esc(p.code)}</div><table class="pop"><tr><th>From → to</th><td>${esc(p.from)} → ${esc(p.to)}</td></tr><tr><th>Diameter</th><td>${p.dia_mm} mm</td></tr><tr><th>Length</th><td>${p.length_m} m</td></tr><tr><th>Work stretch</th><td>none yet</td></tr></table>`);
    }
    popup(popupHtml(top));
  };

  const selectBoundary = (e: MapMouseEvent) => {
    const map = mapRef.current!;
    for (const [type, layer] of [['wards', 'wards-fill'], ['admin', 'admin-fill'], ['sewerzones', 'sewer-fill']] as const) {
      if (map.getLayoutProperty(layer, 'visibility') === 'none') continue;
      const f = map.queryRenderedFeatures(e.point, { layers: [layer] })[0];
      if (!f) continue;
      const p = f.properties;
      const key = type === 'wards' ? Number(p.ward) : type === 'admin' ? String(p.zone_id) : String(p.name);
      const full = boundaries.current[type]?.features.find((x) => (type === 'wards' ? Number(x.properties.ward) : type === 'admin' ? x.properties.zone_id : x.properties.name) === key);
      const bbox = bboxOf((full ?? f).geometry.coordinates);
      if (type === 'wards')
        setBoundary({ type, key, name: `Ward ${p.ward}`, info: `GWMC zone ${p.admin_zone}`, bbox, ward: Number(p.ward) });
      else if (type === 'admin') setBoundary({ type, key, name: String(p.name), info: `Zone ${p.zone_id}`, bbox, zone: String(p.zone_id) });
      else setBoundary({ type, key, name: String(p.name), info: 'Sewerage zone', bbox, sewer: String(p.name).replace(/^Sewer(age)? zone\s*/i, '') });
      return;
    }
    setBoundary(null);
  };

  // ---------------- search ----------------
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) return setResults([]);
    const m = COORDS.exec(s);
    const t = setTimeout(async () => {
      const out: SearchResult[] = [];
      if (m) {
        let [a, b] = [Number(m[1]), Number(m[2])];
        if (a > b) [a, b] = [b, a];
        out.push({ kind: 'Place', label: `${a.toFixed(6)}, ${b.toFixed(6)}`, detail: 'latitude, longitude', lon: b, lat: a });
      }
      const [x, y] = await Promise.all([
        api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(s)}`).catch(() => ({ results: [] })),
        api<{ results: SearchResult[] }>(`/api/search/db?q=${encodeURIComponent(s)}`).catch(() => ({ results: [] })),
      ]);
      setResults([...out, ...y.results, ...x.results].slice(0, 20));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const pickResult = (r: SearchResult) => {
    setResults([]);
    setQ('');
    if (r.kind === 'Work stretch') return void goToStretch(r.label, true);
    if (r.kind === 'Ward') {
      const w = boundaries.current.wards?.features.find((f) => f.properties.name === r.label);
      if (w) return fit(bboxOf(w.geometry.coordinates), 16);
    }
    goToPoint(r.lon, r.lat, r.kind === 'Place' ? 19 : 18);
  };

  const toggle = (k: string, v: boolean) => setVisible((x) => ({ ...x, [k]: v }));

  return (
    <div className="app">
      <header className="bar">
        <div className="brand"><span className="logo">UGD</span><span className="brand-name">Warangal UGD Tracker</span></div>
        <nav className="main-tabs">
          {tabs.map(([t, label]) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{label}</button>
          ))}
        </nav>
        <div className="search">
          <input placeholder="Search work, manhole, ward, road…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          {results.length > 0 && (
            <ul className="results">
              {results.map((r, i) => (
                <li key={i}><button onClick={() => pickResult(r)}><span className="kind">{r.kind}</span> {r.label} <span className="muted">{r.detail}</span></button></li>
              ))}
            </ul>
          )}
        </div>
        <FontButtons />
        <div className="user">
          <span className="who">{user.name}<small>{ROLE_LABEL[user.role as Role] ?? user.role}</small></span>
          <button className="btn ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>
      {error && <div className="banner" onClick={() => setError('')}>{error} <u>close</u></div>}
      <div className="body">
        <div ref={box} className="map" style={{ display: tab === 'map' ? undefined : 'none' }} />
        {tab === 'map' && !work && !marking && (
          <>
            <button className="btn layers-btn" onClick={() => setLayersOpen((o) => !o)}>☰ Layers</button>
            {layersOpen && meta && (
              <div className="layers">
                <div className="layers-head"><strong>Layers</strong><button className="btn ghost" onClick={() => setLayersOpen(false)}>Close</button></div>
                {LAYER_GROUPS.map((g) => {
                  const keys = STYLE_OF[g.key] ?? [];
                  return (
                    <div key={g.key} className="layer-row">
                      <label className="switch-row">
                        <input type="checkbox" checked={!!visible[g.key]} onChange={(e) => toggle(g.key, e.target.checked)} />
                        <span>{g.label}</span>
                      </label>
                      {keys.length > 0 && (
                        <button className="btn ghost style-btn" title="Colour, width, line type" onClick={() => setStyleKeys(keys)}>
                          {keys[0] !== 'work_band' && <span className="sw-mini" style={{ background: styles[keys[0]]?.color ?? STYLE_DEFS.find((d) => d.key === keys[0])!.color }} />}
                          Style
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="layers-sec">Utilities · above ground <span className="sec-count">{UTILITY_LAYERS.filter((u) => u.group === 'above').reduce((a, u) => a + (utilCounts[u.key] ?? 0), 0).toLocaleString('en-IN')}</span></div>
                <div className="util-chips">
                  {UTILITY_LAYERS.filter((u) => u.group === 'above').map((u) => (
                    <button key={u.key} className={`util-chip ${utilOn.has(u.key) ? 'on' : ''}`} style={{ borderColor: u.color }} onClick={() => setUtilOn((s) => { const n = new Set(s); if (n.has(u.key)) n.delete(u.key); else n.add(u.key); return n; })}>
                      <img className="chip-icon" src={utilIconUrl(u.key, u.color, 40)} alt="" />{u.label}<span className="chip-count">{(utilCounts[u.key] ?? 0).toLocaleString('en-IN')}</span>
                    </button>
                  ))}
                </div>
                <div className="layers-sec">Utilities · underground <span className="sec-count">{UTILITY_LAYERS.filter((u) => u.group === 'under').reduce((a, u) => a + (utilCounts[u.key] ?? 0), 0).toLocaleString('en-IN')}</span></div>
                <div className="util-chips">
                  {UTILITY_LAYERS.filter((u) => u.group === 'under').map((u) => (
                    <button key={u.key} className={`util-chip ${utilOn.has(u.key) ? 'on' : ''}`} style={{ borderColor: u.color }} onClick={() => setUtilOn((s) => { const n = new Set(s); if (n.has(u.key)) n.delete(u.key); else n.add(u.key); return n; })}>
                      <img className="chip-icon" src={utilIconUrl(u.key, u.color, 40)} alt="" />{u.label}<span className="chip-count">{(utilCounts[u.key] ?? 0).toLocaleString('en-IN')}</span>
                    </button>
                  ))}
                  <button className={`util-chip ${drainsOn ? 'on' : ''}`} style={{ borderColor: EXISTING_DRAINS.color }} onClick={() => setDrainsOn((x) => !x)}>
                    <img className="chip-icon" src={utilIconUrl(EXISTING_DRAINS.key, EXISTING_DRAINS.color, 40)} alt="" />{EXISTING_DRAINS.label}<span className="chip-count">34,175</span>
                  </button>
                </div>
                <div className="layers-sec">Colour work stretches by</div>
                <div className="seg">
                  <button className={theme === 'stage' ? 'on' : ''} onClick={() => setTheme('stage')}>Work stage</button>
                  <button className={theme === 'compliance' ? 'on' : ''} onClick={() => setTheme('compliance')}>Compliance</button>
                </div>
                <div className="legend-list">
                  {(theme === 'stage' ? STAGES : COMPLIANCE_THEME).map((s) => <div key={s.key}><span className="sw" style={{ background: s.color }} />{s.label}</div>)}
                </div>
                <div className="layers-sec">Pipes: thicker line = bigger diameter</div>
                <div className="legend-list">
                  {PIPE_WIDTHS.map(([d, w]) => <div key={d}><span className="sw line" style={{ background: styles.dpr_pipes?.color ?? STYLE_DEFS[0].color, height: Math.max(2, w * 1.4 * (styles.dpr_pipes?.width ?? 1)) }} />{d} mm{d === 1400 ? '+' : ''}</div>)}
                  <div><span className="sw line" style={{ background: '#fff', height: 3, outline: '1px solid #64748b' }} />Drawn pipe (white)</div>
                </div>
                <div className="layers-sec">Go to a zone</div>
                <div className="chips">
                  {meta.admin_zones.map((z) => <button key={z.id} className="chip" onClick={() => { fit(z.bbox as BBox, 16); setLayersOpen(false); }}>{z.id}</button>)}
                </div>
              </div>
            )}
            <div className="fab-row">
              {canMake && !reporting && <button className="btn primary fab-btn" onClick={startWork}>+ New work stretch</button>}
              {canReport && !reporting && <button className="btn fab-btn warn-btn" onClick={() => { setBoundary(null); setReporting('pick'); }}>⚠ Report issue</button>}
            </div>
            {reporting === 'pick' && (
              <div className="pick-banner">
                <b>Tap the place of the issue on the map</b>
                <div className="row-btns">
                  <button className="btn" onClick={() => setReporting({ at: null })}>Use my location</button>
                  <button className="btn ghost" onClick={() => setReporting(null)}>Cancel</button>
                </div>
              </div>
            )}
            {boundary && (
              <div className="boundary-box">
                <div className="boundary-title"><b>{boundary.name}</b> <span className="muted">{boundary.info}</span></div>
                <AreaSummary filter={{ ward: boundary.ward, zone: boundary.zone, sewer: boundary.sewer }} />
                <div className="row-btns">
                  <button className="btn" onClick={() => fit(boundary.bbox, 16)}>Zoom to</button>
                  {(boundary.ward || boundary.zone) && (
                    <button className="btn" onClick={() => { setWorksFilters({ ...EMPTY_FILTERS, ward: boundary.ward ? String(boundary.ward) : '', zone: boundary.zone ?? '' }); setTab('works'); }}>
                      Works here
                    </button>
                  )}
                  <button className="btn ghost" onClick={() => setBoundary(null)}>Close</button>
                </div>
              </div>
            )}
          </>
        )}
        {tab === 'map' && marking && !marking.form && (
          <div className="pick-banner">
            <b>{utilityLayer(marking.layer)!.geom === 'point' ? `Tap the place of the ${utilityLayer(marking.layer)!.label.toLowerCase().replace(/s$/, '')}` : `Tap along the ${utilityLayer(marking.layer)!.label.toLowerCase()} (${marking.pts.length} point${marking.pts.length === 1 ? '' : 's'})`}</b>
            <div className="row-btns">
              {utilityLayer(marking.layer)!.geom === 'line' && <button className="btn primary" disabled={marking.pts.length < 2} onClick={() => setMarking({ ...marking, form: true })}>Finish line</button>}
              {marking.pts.length > 0 && utilityLayer(marking.layer)!.geom === 'line' && <button className="btn" onClick={() => setMarking({ ...marking, pts: marking.pts.slice(0, -1) })}>Undo point</button>}
              <button className="btn ghost" onClick={() => setMarking(null)}>Cancel</button>
            </div>
          </div>
        )}
        {marking?.form && <UtilityForm layer={marking.layer} onSave={saveUtility} onCancel={() => setMarking(null)} />}
        {tab === 'dashboard' && meta && <DashboardPage zones={meta.admin_zones} onOpenStretch={setOpenCode} />}
        {tab === 'grievances' && meta && <GrievancesPage zones={meta.admin_zones} onOpenStretch={setOpenCode} onGoTo={(lon, lat) => goToPoint(lon, lat, 19)} refreshKey={refreshKey} onChanged={changed} />}
        {tab === 'utilities' && (
          <UtilitiesPage canImport={canMake} canMark={ROLE_RANK[user.role as Role] >= 2 && user.role !== 'viewer'} refreshKey={refreshKey}
            onMark={(layer) => { setTab('map'); setUtilOn((s) => new Set([...s, layer])); setMarking({ layer, pts: [], form: false }); }} />
        )}
        {reporting && reporting !== 'pick' && (
          <ReportIssueModal at={reporting.at} onDone={(code) => { setReporting(null); if (code) { changed(); setError(''); setNotice(`Issue ${code} reported.`); } }} />
        )}
        {styleKeys && <StyleModal keys={styleKeys} styles={styles} onChange={changeStyle} onClose={() => setStyleKeys(null)} />}
        {notice && <div className="toast" onClick={() => setNotice('')}>{notice}</div>}
        {tab === 'map' && work && <WorkPanel w={work} set={ws} onUndo={workUndo} onSave={workSave} onCancel={() => { setWork(null); changed(); }} zoom={zoom} />}
        {tab === 'works' && meta && (
          <WorksPage zones={meta.admin_zones} onOpen={setOpenCode} onGoTo={(c) => goToStretch(c)} refreshKey={refreshKey} filters={worksFilters} setFilters={setWorksFilters}
            onNew={canMake ? startWork : undefined} />
        )}
        {tab === 'issues' && meta && (
          <IssuesPage zones={meta.admin_zones} onOpenStretch={setOpenCode} onGoTo={(lon, lat) => goToPoint(lon, lat, 19)} refreshKey={refreshKey} onChanged={changed} isCommissioner={user.role === 'commissioner'} />
        )}
        {tab === 'compliance' && meta && (
          <CompliancePage zones={meta.admin_zones} onOpen={setOpenCode} isCommissioner={user.role === 'commissioner'} refreshKey={refreshKey} onChanged={changed} />
        )}
        {openCode && (
          <StretchCard code={openCode} me={user} onClose={() => setOpenCode(null)} onChanged={changed} onLocate={(c) => { setOpenCode(null); locate(c); }} onEditSitePipes={canMake ? editPipes : undefined} />
        )}
      </div>
    </div>
  );
}

const esc = (v: unknown) => escapeHtml(String(v ?? ''));
const LABELS: Record<string, string> = {
  pipe_id: 'Pipe', mh_code: 'Manhole', line_no: 'DPR line', from_mh: 'From', to_mh: 'To', dia_mm: 'Diameter (mm)', material: 'Material', length_m: 'Length (m)',
  slope_1_in: 'Slope 1 in', il_up: 'Invert up (m)', il_dn: 'Invert down (m)', depth_up: 'Depth up (m)', depth_dn: 'Depth down (m)', gl: 'Ground level (m)',
  il: 'Invert level (m)', depth: 'Depth (m)', catchment: 'Catchment', ward: 'Ward', admin_zone: 'Zone', label: 'Name', kind: 'Type',
};
const LAYER_TITLE: Record<string, string> = { pipes: 'DPR pipe', 'pipes-major': 'DPR pipe', manholes: 'DPR manhole', stations: 'Plant / station' };

function popupHtml(f: MapGeoJSONFeature): string {
  const p = f.properties ?? {};
  const rows = Object.entries(p).filter(([k, v]) => LABELS[k] && v !== null && v !== '').map(([k, v]) => `<tr><th>${LABELS[k]}</th><td>${esc(v)}</td></tr>`).join('');
  return `<div class="pop-title">${LAYER_TITLE[f.layer.id] ?? ''}</div><table class="pop">${rows}</table>`;
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
