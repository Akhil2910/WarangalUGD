/**
 * Citizen grievances (from the QR board at each work stretch) and utility layers.
 * Telugu wording to be checked by a GWMC Telugu speaker before going live.
 */

export const GRIEVANCE_CATEGORIES = [
  { key: 'open_trench', en: 'Open trench / safety risk', te: 'తెరిచి ఉన్న గుంత / ప్రమాదం' },
  { key: 'road_damage', en: 'Road damaged', te: 'రోడ్డు దెబ్బతిన్నది' },
  { key: 'water_cut', en: 'Water supply cut', te: 'నీటి సరఫరా ఆగిపోయింది' },
  { key: 'drain_blocked', en: 'Drain blocked', te: 'డ్రైనేజీ మూసుకుపోయింది' },
  { key: 'sewage_overflow', en: 'Sewage overflow', te: 'మురుగు నీరు పొంగుతోంది' },
  { key: 'dust_noise', en: 'Dust / noise', te: 'దుమ్ము / శబ్దం' },
  { key: 'debris', en: 'Debris left on the road', te: 'రోడ్డుపై వ్యర్థాలు వదిలేశారు' },
  { key: 'traffic', en: 'Traffic blocked', te: 'ట్రాఫిక్ అడ్డంకి' },
  { key: 'work_quality', en: 'Poor quality of work', te: 'పని నాణ్యత సరిగా లేదు' },
  { key: 'other', en: 'Other', te: 'ఇతర' },
] as const;
export type GrievanceCategory = (typeof GRIEVANCE_CATEGORIES)[number]['key'];

export const GRIEVANCE_STATUS = [
  { key: 'new', en: 'Received', te: 'స్వీకరించబడింది', color: '#f59e0b' },
  { key: 'assigned', en: 'Being attended', te: 'పరిష్కార దశలో ఉంది', color: '#3b82f6' },
  { key: 'resolved', en: 'Resolved', te: 'పరిష్కరించబడింది', color: '#16a34a' },
  { key: 'rejected', en: 'Closed (not for this work)', te: 'మూసివేయబడింది (ఈ పనికి సంబంధించినది కాదు)', color: '#6b7280' },
] as const;

/** Days to answer a grievance (proposed default; the Commissioner can change it later). */
export const GRIEVANCE_DUE_DAYS = 3;

/** Indian mobile number: 10 digits starting 6-9 (an optional +91 / 0 in front is removed). */
export function normaliseMobile(s: string): string | null {
  const d = s.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
export const maskMobile = (m: string) => (m.length === 10 ? `${m.slice(0, 2)}xxxxxx${m.slice(8)}` : 'xxxxxxxxxx');

// ---------------- utilities ----------------
export const UTILITY_LAYERS = [
  // above ground (points)
  { key: 'electric_poles', label: 'Electrical poles', group: 'above', geom: 'point', color: '#a855f7' },
  { key: 'transformers', label: 'Transformers', group: 'above', geom: 'point', color: '#ec4899' },
  { key: 'junction_boxes', label: 'Junction boxes', group: 'above', geom: 'point', color: '#f97316' },
  { key: 'streetlights', label: 'Streetlights', group: 'above', geom: 'point', color: '#facc15' },
  { key: 'trees', label: 'Trees', group: 'above', geom: 'point', color: '#16a34a' },
  { key: 'hand_pumps', label: 'Hand pumps', group: 'above', geom: 'point', color: '#06b6d4' },
  { key: 'encroachments', label: 'Encroachments', group: 'above', geom: 'point', color: '#475569' },
  { key: 'other_equipment', label: 'Other equipment', group: 'above', geom: 'point', color: '#14b8a6' },
  // above ground (lines)
  { key: 'overhead_lines', label: 'Overhead lines', group: 'above', geom: 'line', color: '#c084fc' },
  { key: 'road_condition', label: 'Road condition', group: 'above', geom: 'line', color: '#3b82f6' },
  { key: 'survey_routes', label: 'Survey routes', group: 'above', geom: 'line', color: '#38bdf8' },
  // underground (lines)
  { key: 'water_mains', label: 'Water supply mains', group: 'under', geom: 'line', color: '#0ea5e9' },
  { key: 'power_cables', label: 'Power cables', group: 'under', geom: 'line', color: '#ef4444' },
  { key: 'telecom_cables', label: 'Telecom / optical fibre', group: 'under', geom: 'line', color: '#84cc16' },
  { key: 'gas_lines', label: 'Gas lines', group: 'under', geom: 'line', color: '#eab308' },
  { key: 'storm_drains', label: 'Storm-water drains', group: 'under', geom: 'line', color: '#2dd4bf' },
] as const;
export type UtilityLayer = (typeof UTILITY_LAYERS)[number]['key'];
export const utilityLayer = (k: string) => UTILITY_LAYERS.find((u) => u.key === k);
/** Existing drains from the GWMC base map (KML), shown read-only. */
export const EXISTING_DRAINS = { key: 'existing_drains', label: 'Existing RCC drains (GWMC map)', group: 'above', geom: 'line', color: '#94a3b8' } as const;
export const UTILITY_CONDITIONS = ['Good', 'Fair', 'Poor', 'Damaged', 'Unknown'] as const;
