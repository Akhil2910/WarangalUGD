/**
 * Icons for the utility layers: a round badge in the layer's colour with a simple white (or dark) symbol.
 * The same SVG is used on the map (as an image) and in the Layers chips and the Utilities page.
 */
import { EXISTING_DRAINS, UTILITY_LAYERS } from 'shared';

// symbols drawn on a 24 x 24 grid, centred on (12, 12)
const GLYPH: Record<string, string> = {
  // pole with a cross-arm and two insulators
  electric_poles: '<path d="M12 5v14M7.5 8h9M8 8v2M16 8v2M10 19h4"/>',
  // box with a lightning bolt
  transformers: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><path d="M12.8 8.2 10.2 12.3h3.4l-2.4 3.5" />',
  // cabinet with two doors
  junction_boxes: '<rect x="7" y="6" width="10" height="12" rx="1"/><path d="M12 6v12M10 11v2M14 11v2"/>',
  // lamp post with its lamp
  streetlights: '<path d="M9 19V7.5a2.5 2.5 0 0 1 5 0"/><path d="M12.5 9.5h3l-1.5 2.5z" fill="currentColor"/><path d="M7.5 19h3"/>',
  // tree: crown and trunk
  trees: '<circle cx="12" cy="10" r="4.5"/><path d="M12 14.5V19M10 19h4"/>',
  // hand pump: body, handle, spout, drop
  hand_pumps: '<path d="M10 8v11h4V8z"/><path d="M14 9.5l3.5-2.5M10 12H7.5v1.5"/><path d="M7.5 15.5c0 .8.6 1.4 1 1.4s1-.6 1-1.4c0-.6-1-1.8-1-1.8s-1 1.2-1 1.8z" fill="currentColor"/>',
  // warning triangle
  encroachments: '<path d="M12 5.5 18.5 17h-13z"/><path d="M12 10v3.2M12 15.2v.1"/>',
  // gear
  other_equipment: '<circle cx="12" cy="12" r="2.6"/><path d="M12 5.5v2M12 16.5v2M5.5 12h2M16.5 12h2M7.4 7.4l1.4 1.4M15.2 15.2l1.4 1.4M7.4 16.6l1.4-1.4M15.2 8.8l1.4-1.4"/>',
  // wires between two poles
  overhead_lines: '<path d="M6.5 6v12M17.5 6v12M6.5 8c3.7 3 7.3 3 11 0M6.5 11c3.7 3 7.3 3 11 0"/>',
  // road with a centre line
  road_condition: '<path d="M8.5 5 6 19M15.5 5 18 19M12 6v2.5M12 11v2.5M12 16v2"/>',
  // route: dots joined by a path
  survey_routes: '<circle cx="7" cy="16.5" r="1.6" fill="currentColor"/><circle cx="17" cy="7.5" r="1.6" fill="currentColor"/><path d="M7 16.5c0-4 10-3 10-9" stroke-dasharray="1.6 1.6"/>',
  // water drop
  water_mains: '<path d="M12 5.5c2.6 3.3 4.2 5.7 4.2 7.7a4.2 4.2 0 0 1-8.4 0c0-2 1.6-4.4 4.2-7.7z"/>',
  // lightning bolt
  power_cables: '<path d="M13.5 5 8 13h4l-1.5 6L16 11h-4z" fill="currentColor" stroke="none"/>',
  // signal arcs
  telecom_cables: '<circle cx="12" cy="16.5" r="1.4" fill="currentColor"/><path d="M9 13.5a4.2 4.2 0 0 1 6 0M6.8 11.2a7.4 7.4 0 0 1 10.4 0"/>',
  // flame
  gas_lines: '<path d="M12 5.5c3 3 4.5 5.4 4.5 8a4.5 4.5 0 0 1-9 0c0-1.7.8-3 2-4 0 1.5.8 2.3 1.6 2.3C12 10 10.8 8 12 5.5z"/>',
  // waves
  storm_drains: '<path d="M5.5 9.5c1.6-1.3 3-1.3 4.4 0s2.8 1.3 4.2 0 2.8-1.3 4.4 0M5.5 13.5c1.6-1.3 3-1.3 4.4 0s2.8 1.3 4.2 0 2.8-1.3 4.4 0M5.5 17.5c1.6-1.3 3-1.3 4.4 0s2.8 1.3 4.2 0 2.8-1.3 4.4 0"/>',
  existing_drains: '<path d="M5 9h14M5 15h14M8 9v6M16 9v6"/>',
};

/** Dark symbol on light badges, white symbol on dark ones. */
function ink(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? '#111827' : '#ffffff';
}

export function utilIconSvg(key: string, color: string, size = 24) {
  const c = ink(color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">`
    + `<circle cx="12" cy="12" r="11" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`
    + `<g fill="none" stroke="${c}" color="${c}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${GLYPH[key] ?? '<circle cx="12" cy="12" r="3"/>'}</g></svg>`;
}

export const utilIconUrl = (key: string, color: string, size = 24) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(utilIconSvg(key, color, size))}`;

export const ALL_UTILITY_ICONS = [...UTILITY_LAYERS.map((u) => ({ key: u.key, color: u.color })), { key: EXISTING_DRAINS.key, color: EXISTING_DRAINS.color }];

/** Add every utility icon to the map (as icon-<key>), drawn at 2x for sharpness. */
export async function addUtilityIcons(map: { hasImage: (id: string) => boolean; addImage: (id: string, img: HTMLImageElement, o?: { pixelRatio: number }) => void }) {
  await Promise.all(ALL_UTILITY_ICONS.map(({ key, color }) => new Promise<void>((resolve) => {
    if (map.hasImage(`icon-${key}`)) return resolve();
    const img = new Image(48, 48);
    img.onload = () => {
      if (!map.hasImage(`icon-${key}`)) map.addImage(`icon-${key}`, img, { pixelRatio: 2 });
      resolve();
    };
    img.onerror = () => resolve();
    img.src = utilIconUrl(key, color, 48);
  })));
}
