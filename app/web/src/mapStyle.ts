import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl';
import { EXISTING_DRAINS, STAGES, UTILITY_LAYERS } from 'shared';

export interface Meta {
  bounds: number[];
  imagery_credit: string;
  imagery_available: boolean;
  imagery_preview_available?: boolean;
  admin_zones: { id: string; name: string; bbox: number[] }[];
  sewer_zones: { name: string; bbox: number[] }[];
  plan: { km: number; manholes: number; stretches: number; reaches: number };
}

/** The few on/off switches in the Layers box. */
export const LAYER_GROUPS = [
  { key: 'imagery', label: 'Satellite image', default: true, layers: ['world-imagery', 'imagery-preview', 'imagery'] },
  { key: 'work', label: 'Work stretches', default: true, layers: ['site-stretch-casing', 'site-stretch-labels', 'stretch-badges'] },
  { key: 'dpr', label: 'DPR pipes and manholes (plan)', default: true, layers: ['pipes-major', 'pipes', 'manholes', 'manhole-labels', 'stations', 'station-labels'] },
  { key: 'drawn', label: 'Drawn pipes and manholes', default: true, layers: ['site-pipes', 'site-manholes', 'site-mh-labels'] },
  { key: 'issues', label: 'Issues', default: true, layers: ['issue-pins'] },
  { key: 'wards', label: 'Ward boundaries', default: true, layers: ['wards-fill', 'wards-line', 'ward-labels', 'wards-sel-fill', 'wards-sel'] },
  { key: 'admin', label: 'GWMC zone boundaries', default: false, layers: ['admin-fill', 'admin-line', 'admin-labels', 'admin-sel-fill', 'admin-sel'] },
  { key: 'sewerzones', label: 'Sewerage zone boundaries', default: false, layers: ['sewer-fill', 'sewer-zones-line', 'sewer-labels', 'sewer-sel-fill', 'sewer-sel'] },
] as const;

/** One pipe colour; the line gets wider with the diameter. */
export const PIPE_COLOR = '#a855f7'; // purple (each person can change it in Layers)
export const SITE_PIPE_COLOR = '#ffffff';
export const PIPE_WIDTHS: [number, number][] = [[150, 1.2], [300, 2.4], [600, 4], [1000, 5.5], [1400, 7]];
const widthByDia = (scale: number): ExpressionSpecification =>
  ['interpolate', ['linear'], ['coalesce', ['get', 'dia_mm'], 200], ...PIPE_WIDTHS.flatMap(([d, w]) => [d, w * scale])] as never;
const byZoom = (lo: number, hi: number): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], 12, widthByDia(lo), 18, widthByDia(hi)] as never;
const utilColor = ['match', ['get', 'layer'], ...UTILITY_LAYERS.flatMap((u) => [u.key, u.color]), '#94a3b8'] as unknown as ExpressionSpecification;
export const stageColorExpr: ExpressionSpecification = ['match', ['get', 'stage'], ...STAGES.flatMap((s) => [s.key, s.color]), '#94a3b8'] as never;

export function buildStyle(meta: Meta, origin: string): StyleSpecification {
  const pm = (f: string) => `pmtiles://${origin}/data/${f}`;
  const gj = (f: string) => `${origin}/data/${f}`;
  const font = ['Noto Sans Regular'];
  const empty = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } as const;
  const none = ['==', ['get', 'id'], -1] as never;
  return {
    version: 8,
    glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      // outside the city: open Sentinel-2 satellite image (10 m, 2016, CC BY 4.0), so the map is never blank around the city
      world_imagery: {
        type: 'raster', tileSize: 256, maxzoom: 15,
        tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
        attribution: 'Surroundings: Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data)',
      },
      ...(meta.imagery_preview_available
        ? { imagery_preview: { type: 'raster', url: pm('imagery_preview.pmtiles'), tileSize: 256, attribution: meta.imagery_credit } as const }
        : {}),
      ...(meta.imagery_available
        ? { imagery: { type: 'raster', url: pm('imagery.pmtiles'), tileSize: 256, attribution: meta.imagery_credit } as const }
        : {}),
      network: { type: 'vector', url: pm('network.pmtiles') },
      badges: empty,
      issues: empty,
      site_mh: empty,
      site_pipes: empty,
      site_stretches: empty,
      utilities: empty,
      util_draft: empty,
      drains: empty,
      wards: { type: 'geojson', data: gj('wards.geojson') },
      admin: { type: 'geojson', data: gj('admin_zones.geojson') },
      sewerzones: { type: 'geojson', data: gj('sewer_zones.geojson') },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e5e7eb' } },
      // slightly muted, so the city's own sharper image stands out
      { id: 'world-imagery', type: 'raster', source: 'world_imagery', paint: { 'raster-saturation': -0.25, 'raster-brightness-max': 0.9 } },
      ...(meta.imagery_preview_available ? [{ id: 'imagery-preview', type: 'raster' as const, source: 'imagery_preview' }] : []),
      ...(meta.imagery_available ? [{ id: 'imagery', type: 'raster' as const, source: 'imagery' }] : []),
      // boundaries: invisible fills make them tappable; "-sel" outlines the selected one
      { id: 'sewer-fill', type: 'fill', source: 'sewerzones', layout: { visibility: 'none' }, paint: { 'fill-color': '#000', 'fill-opacity': 0 } },
      { id: 'admin-fill', type: 'fill', source: 'admin', layout: { visibility: 'none' }, paint: { 'fill-color': '#000', 'fill-opacity': 0 } },
      { id: 'wards-fill', type: 'fill', source: 'wards', paint: { 'fill-color': '#000', 'fill-opacity': 0 } },
      { id: 'admin-line', type: 'line', source: 'admin', layout: { visibility: 'none' }, paint: { 'line-color': '#fb923c', 'line-width': 3, 'line-opacity': 0.9 } },
      { id: 'sewer-zones-line', type: 'line', source: 'sewerzones', layout: { visibility: 'none' }, paint: { 'line-color': '#22d3ee', 'line-width': 2.5, 'line-dasharray': [3, 2] } },
      { id: 'wards-line', type: 'line', source: 'wards', paint: { 'line-color': '#fde047', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 2], 'line-opacity': 0.85 } },
      // the selected area: a light shade inside its outline (under the works and pipes)
      { id: 'sewer-sel-fill', type: 'fill', source: 'sewerzones', layout: { visibility: 'none' }, filter: ['==', ['get', 'name'], ''], paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.16 } },
      { id: 'admin-sel-fill', type: 'fill', source: 'admin', layout: { visibility: 'none' }, filter: ['==', ['get', 'zone_id'], ''], paint: { 'fill-color': '#fb923c', 'fill-opacity': 0.16 } },
      { id: 'wards-sel-fill', type: 'fill', source: 'wards', filter: ['==', ['get', 'ward'], -1], paint: { 'fill-color': '#fde047', 'fill-opacity': 0.18 } },
      { id: 'sewer-sel', type: 'line', source: 'sewerzones', layout: { visibility: 'none' }, filter: ['==', ['get', 'name'], ''], paint: { 'line-color': '#22d3ee', 'line-width': 6 } },
      { id: 'admin-sel', type: 'line', source: 'admin', layout: { visibility: 'none' }, filter: ['==', ['get', 'zone_id'], ''], paint: { 'line-color': '#fb923c', 'line-width': 7 } },
      { id: 'wards-sel', type: 'line', source: 'wards', filter: ['==', ['get', 'ward'], -1], paint: { 'line-color': '#fde047', 'line-width': 6 } },
      // work stretches: a wide band in the colour of their stage (or compliance), under the pipes
      {
        id: 'site-stretch-casing', type: 'line', source: 'site_stretches', minzoom: 10,
        paint: { 'line-color': stageColorExpr, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 9, 18, 22], 'line-opacity': 0.75 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      // selected while making a work stretch (yellow)
      {
        id: 'dpr-pipes-sel', type: 'line', source: 'network', 'source-layer': 'pipes', minzoom: 13, filter: ['in', ['get', 'pipe_id'], ['literal', []]],
        paint: { 'line-color': '#facc15', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 6, 18, 18], 'line-opacity': 0.95 }, layout: { 'line-cap': 'round' },
      },
      {
        id: 'site-pipes-sel', type: 'line', source: 'site_pipes', filter: none,
        paint: { 'line-color': '#facc15', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6, 18, 18], 'line-opacity': 0.95 }, layout: { 'line-cap': 'round' },
      },
      { id: 'pipes-major', type: 'line', source: 'network', 'source-layer': 'pipes_major', maxzoom: 13, paint: { 'line-color': PIPE_COLOR, 'line-width': widthByDia(0.7) } },
      { id: 'pipes', type: 'line', source: 'network', 'source-layer': 'pipes', minzoom: 13, paint: { 'line-color': PIPE_COLOR, 'line-width': byZoom(0.6, 1.6) } },
      { id: 'site-pipes', type: 'line', source: 'site_pipes', paint: { 'line-color': SITE_PIPE_COLOR, 'line-width': byZoom(0.8, 1.8) }, layout: { 'line-cap': 'round' } },
      {
        id: 'manholes', type: 'circle', source: 'network', 'source-layer': 'manholes', minzoom: 15,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2, 19, 6], 'circle-color': '#ffffff', 'circle-stroke-color': '#6b21a8', 'circle-stroke-width': 1.5 },
      },
      {
        id: 'site-manholes', type: 'circle', source: 'site_mh',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 6, 19, 9], 'circle-color': '#22d3ee', 'circle-stroke-color': '#083344', 'circle-stroke-width': 2 },
      },
      {
        id: 'mh-active', type: 'circle', source: 'site_mh', filter: none,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 8, 19, 16], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#facc15', 'circle-stroke-width': 4 },
      },
      {
        id: 'site-mh-labels', type: 'symbol', source: 'site_mh', minzoom: 16,
        layout: { 'text-field': ['get', 'code'], 'text-font': font, 'text-size': 14, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
        paint: { 'text-color': '#ecfeff', 'text-halo-color': '#083344', 'text-halo-width': 2 },
      },
      {
        id: 'site-stretch-labels', type: 'symbol', source: 'site_stretches', minzoom: 14,
        layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['get', 'code'], '  ', ['get', 'name']], 'text-font': font, 'text-size': 14, 'symbol-spacing': 400 },
        paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 2.5 },
      },
      {
        id: 'manhole-labels', type: 'symbol', source: 'network', 'source-layer': 'manholes', minzoom: 18,
        layout: { 'text-field': ['get', 'mh_code'], 'text-font': font, 'text-size': 13, 'text-offset': [0, 1], 'text-anchor': 'top' },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#4c1d95', 'text-halo-width': 1.5 },
      },
      {
        // letter badges: T taps · L leak · D drain · W stagnation · P potholes · C non-compliance
        id: 'stretch-badges', type: 'symbol', source: 'badges', minzoom: 13,
        layout: { 'text-field': ['get', 'b'], 'text-font': font, 'text-size': 15, 'text-offset': [0, -1.2], 'text-allow-overlap': true },
        paint: { 'text-color': '#fef08a', 'text-halo-color': '#7f1d1d', 'text-halo-width': 2.5 },
      },
      // ---- utilities (colour per layer; which layers show is set by a filter) ----
      {
        id: 'drains-line', type: 'line', source: 'drains', layout: { visibility: 'none' },
        paint: { 'line-color': EXISTING_DRAINS.color, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 3], 'line-dasharray': [2, 1.5] },
      },
      {
        id: 'util-lines', type: 'line', source: 'utilities', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'layer'], ['literal', []]]],
        paint: { 'line-color': utilColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 18, 5] }, layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        // far out: small dots in the layer's colour; closer in (zoom 14+): the layer's icon
        id: 'util-dots', type: 'circle', source: 'utilities', maxzoom: 14, filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'layer'], ['literal', []]]],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5], 'circle-color': utilColor, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.8 },
      },
      {
        id: 'util-points', type: 'symbol', source: 'utilities', minzoom: 14, filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'layer'], ['literal', []]]],
        layout: {
          'icon-image': ['concat', 'icon-', ['get', 'layer']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 17, 0.9, 20, 1.2],
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
      },
      {
        id: 'util-line-icons', type: 'symbol', source: 'utilities', minzoom: 14, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'layer'], ['literal', []]]],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 220, 'icon-image': ['concat', 'icon-', ['get', 'layer']], 'icon-size': 0.7, 'icon-rotation-alignment': 'viewport' },
      },
      { id: 'util-draft-line', type: 'line', source: 'util_draft', paint: { 'line-color': '#facc15', 'line-width': 4, 'line-dasharray': [1, 1] } },
      { id: 'util-draft-pts', type: 'circle', source: 'util_draft', paint: { 'circle-radius': 6, 'circle-color': '#facc15', 'circle-stroke-color': '#111827', 'circle-stroke-width': 2 } },
      {
        id: 'issue-pins', type: 'circle', source: 'issues', minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 8],
          'circle-color': ['match', ['get', 'severity'], 'high', '#dc2626', 'medium', '#f59e0b', '#94a3b8'],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
        },
      },
      {
        id: 'stations', type: 'circle', source: 'network', 'source-layer': 'stations',
        paint: { 'circle-radius': 7, 'circle-color': '#0ea5e9', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      },
      {
        id: 'station-labels', type: 'symbol', source: 'network', 'source-layer': 'stations', minzoom: 12,
        layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 14, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#0c4a6e', 'text-halo-width': 2 },
      },
      {
        id: 'ward-labels', type: 'symbol', source: 'wards', maxzoom: 15,
        layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 15 },
        paint: { 'text-color': '#fef08a', 'text-halo-color': '#000', 'text-halo-width': 1.5 },
      },
      {
        id: 'admin-labels', type: 'symbol', source: 'admin', maxzoom: 13, layout: { visibility: 'none', 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 15 },
        paint: { 'text-color': '#fed7aa', 'text-halo-color': '#431407', 'text-halo-width': 2 },
      },
      {
        id: 'sewer-labels', type: 'symbol', source: 'sewerzones', maxzoom: 14, layout: { visibility: 'none', 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 15 },
        paint: { 'text-color': '#a5f3fc', 'text-halo-color': '#083344', 'text-halo-width': 2 },
      },
    ],
  };
}

// ---------------- each person's layer styles (colour, width, line type) ----------------
export type Dash = 'solid' | 'dashed' | 'dotted';
export interface LayerStyle { color?: string; width?: number; dash?: Dash; opacity?: number }
export type StyleKey = 'dpr_pipes' | 'drawn_pipes' | 'work_band' | 'dpr_manholes' | 'drawn_manholes' | 'wards' | 'admin' | 'sewerzones';
export interface StyleDef { key: StyleKey; label: string; kind: 'pipe' | 'band' | 'point' | 'boundary'; layers: string[]; color: string; dash: Dash }

export const STYLE_DEFS: StyleDef[] = [
  { key: 'dpr_pipes', label: 'DPR pipes', kind: 'pipe', layers: ['pipes', 'pipes-major'], color: PIPE_COLOR, dash: 'solid' },
  { key: 'dpr_manholes', label: 'DPR manholes', kind: 'point', layers: ['manholes'], color: '#ffffff', dash: 'solid' },
  { key: 'drawn_pipes', label: 'Drawn pipes', kind: 'pipe', layers: ['site-pipes'], color: SITE_PIPE_COLOR, dash: 'solid' },
  { key: 'drawn_manholes', label: 'Drawn manholes', kind: 'point', layers: ['site-manholes'], color: '#22d3ee', dash: 'solid' },
  { key: 'work_band', label: 'Work stretch band (colour shows the stage)', kind: 'band', layers: ['site-stretch-casing'], color: '', dash: 'solid' },
  { key: 'wards', label: 'Ward boundaries', kind: 'boundary', layers: ['wards-line'], color: '#fde047', dash: 'solid' },
  { key: 'admin', label: 'GWMC zone boundaries', kind: 'boundary', layers: ['admin-line'], color: '#fb923c', dash: 'solid' },
  { key: 'sewerzones', label: 'Sewerage zone boundaries', kind: 'boundary', layers: ['sewer-zones-line'], color: '#22d3ee', dash: 'dashed' },
];
export const WIDTHS = [{ v: 0.5, label: 'Thin' }, { v: 1, label: 'Normal' }, { v: 1.5, label: 'Medium' }, { v: 2, label: 'Thick' }, { v: 3, label: 'Very thick' }];
export const DASHES: { v: Dash; label: string }[] = [{ v: 'solid', label: 'Solid ———' }, { v: 'dashed', label: 'Dashed – – –' }, { v: 'dotted', label: 'Dotted · · · ·' }];
const DASH_ARRAY: Record<Dash, number[] | undefined> = { solid: undefined, dashed: [3, 2], dotted: [0.5, 1.6] };

/** Apply one person's style for a layer to the map (falls back to the defaults). */
export function applyLayerStyle(m: unknown, def: StyleDef, s: LayerStyle = {}) {
  const map = m as { getLayer: (id: string) => unknown; setPaintProperty: (l: string, p: string, v: unknown) => void };
  const f = s.width ?? 1;
  const color = s.color ?? def.color;
  const dash = DASH_ARRAY[s.dash ?? def.dash];
  for (const id of def.layers) {
    if (!map.getLayer(id)) continue;
    if (def.kind === 'pipe') {
      map.setPaintProperty(id, 'line-color', color);
      map.setPaintProperty(id, 'line-width', id === 'pipes-major' ? widthByDia(0.7 * f) : id === 'site-pipes' ? byZoom(0.8 * f, 1.8 * f) : byZoom(0.6 * f, 1.6 * f));
      map.setPaintProperty(id, 'line-dasharray', dash);
    } else if (def.kind === 'band') {
      map.setPaintProperty(id, 'line-width', ['interpolate', ['linear'], ['zoom'], 10, 4 * f, 14, 9 * f, 18, 22 * f]);
      map.setPaintProperty(id, 'line-dasharray', dash);
      map.setPaintProperty(id, 'line-opacity', s.opacity ?? 0.75);
    } else if (def.kind === 'point') {
      map.setPaintProperty(id, 'circle-color', color);
      map.setPaintProperty(id, 'circle-radius', id === 'manholes' ? ['interpolate', ['linear'], ['zoom'], 15, 2 * f, 19, 6 * f] : ['interpolate', ['linear'], ['zoom'], 12, 3 * f, 16, 6 * f, 19, 9 * f]);
    } else {
      map.setPaintProperty(id, 'line-color', color);
      map.setPaintProperty(id, 'line-width', id === 'wards-line' ? ['interpolate', ['linear'], ['zoom'], 11, 0.8 * f, 16, 2 * f] : (id === 'admin-line' ? 3 : 2.5) * f);
      map.setPaintProperty(id, 'line-dasharray', dash ?? (def.dash === 'dashed' && !s.dash ? [3, 2] : undefined));
    }
  }
}
