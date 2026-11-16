/**
 * Work status of a road stretch (brief §6.2-6.8): 18 field items in 6 buckets, road types with their
 * restoration wording, the derived stage (map colour), validation, approval and the change list for history.
 */

/** Derived stage of a road stretch (map colour). */
export const STAGES = [
  { key: 'not_started', label: 'Not started', color: '#94a3b8' },
  { key: 'in_progress', label: 'Work in progress', color: '#3b82f6' },
  { key: 'backfilled', label: 'Back-filled, restoration pending', color: '#f97316' },
  { key: 'restoration_underway', label: 'Restoration under way', color: '#eab308' },
  { key: 'restored_awaiting', label: 'Restoration done, awaiting approval', color: '#a3e635' },
  { key: 'restored_approved', label: 'Restored and approved', color: '#16a34a' },
] as const;
export type StageKey = (typeof STAGES)[number]['key'];
export const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label ?? k;

/** Road types; each has the same 3 restoration steps, worded for the type ("" = no middle step). */
export const ROAD_TYPES = [
  { key: 'cc', label: 'CC (cement concrete)', steps: ['CC restoration pending', 'CC laid, curing not done', 'CC laid, curing done'] },
  { key: 'bt', label: 'BT (bituminous)', steps: ['BT restoration pending', 'Base course laid, BT not done', 'BT surface laid'] },
  { key: 'gravel', label: 'Gravel / WBM', steps: ['Gravel restoration pending', 'Gravel laid, not compacted', 'Gravel laid and compacted'] },
  { key: 'earthen', label: 'Earthen', steps: ['Levelling pending', '', 'Levelled and compacted'] },
  { key: 'paver', label: 'Paver / tile', steps: ['Paver restoration pending', 'Pavers relaid, joints not filled', 'Pavers relaid and finished'] },
  { key: 'brick', label: 'Brick paving', steps: ['Brick paving restoration pending', 'Bricks relaid, joints not filled', 'Bricks relaid and finished'] },
] as const;
export type RoadType = (typeof ROAD_TYPES)[number]['key'];
export const roadType = (k: string | null | undefined) => ROAD_TYPES.find((r) => r.key === k);

export const PIPELINE = [
  { key: 'not_started', label: 'Not started' },
  { key: 'partly', label: 'Partly laid' },
  { key: 'laid', label: 'Laid' },
] as const;
export const CUTTING = [
  { key: 'none', label: 'Road not cut' },
  { key: 'road_cut', label: 'Road cut' },
  { key: 'trench_open', label: 'Trench open' },
  { key: 'backfilled', label: 'Back-filled' },
] as const;
/** Restoration step: not_due (before back-fill) → pending → middle → done. */
export const RESTORATION = ['not_due', 'pending', 'middle', 'done'] as const;
export const MOTORABILITY = [
  { key: 'motorable', label: 'Motorable', color: '#16a34a' },
  { key: 'difficulty', label: 'Motorable with difficulty', color: '#f59e0b' },
  { key: 'not_motorable', label: 'Not motorable', color: '#dc2626' },
] as const;
export const APPROVAL = [
  { key: 'none', label: 'Not asked' },
  { key: 'pending', label: 'Awaiting approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
] as const;

export type Pipeline = (typeof PIPELINE)[number]['key'];
export type Cutting = (typeof CUTTING)[number]['key'];
export type Restoration = (typeof RESTORATION)[number];
export type Motorability = (typeof MOTORABILITY)[number]['key'];
export type Approval = (typeof APPROVAL)[number]['key'];

export interface WorkStatus {
  // A Sewer work (items 1-5)
  pipeline: Pipeline;
  pipe_laid_m: number | null;
  manholes_built: number;
  ics_built: number;
  // B Road cutting (6-8)
  cutting: Cutting;
  cut_length_m: number | null;
  // C Road restoration (9-11; approval, item 12, is kept on the stretch)
  road_type: RoadType | null;
  restoration: Restoration;
  // D Motorability (13)
  motorability: Motorability;
  // E Utilities (14-16)
  taps_broken: number;
  taps_restored: number;
  leaks: number;
  leaks_fixed: number;
  drain_clogged: boolean;
  // F Hazards (17-18)
  stagnation: boolean;
  potholes: boolean;
  uneven_backfill: boolean;
}

export const EMPTY_STATUS: WorkStatus = {
  pipeline: 'not_started', pipe_laid_m: null, manholes_built: 0, ics_built: 0,
  cutting: 'none', cut_length_m: null, road_type: null, restoration: 'not_due', motorability: 'motorable',
  taps_broken: 0, taps_restored: 0, leaks: 0, leaks_fixed: 0, drain_clogged: false,
  stagnation: false, potholes: false, uneven_backfill: false,
};

export const STATUS_LABELS: Record<keyof WorkStatus, string> = {
  pipeline: 'Pipeline', pipe_laid_m: 'Pipe laid (m)', manholes_built: 'Manholes built', ics_built: 'Inspection chambers built',
  cutting: 'Road cutting', cut_length_m: 'Cut length (m)', road_type: 'Road type', restoration: 'Restoration',
  motorability: 'Motorability', taps_broken: 'Tap connections broken', taps_restored: 'Tap connections restored',
  leaks: 'Water pipe leakages', leaks_fixed: 'Leakages fixed', drain_clogged: 'Drain clogged with gravel',
  stagnation: 'Water stagnation', potholes: 'Potholes in trench', uneven_backfill: 'Uneven back-fill',
};

/** Restoration wording for the road type. */
export function restorationLabel(s: Pick<WorkStatus, 'road_type' | 'restoration'>): string {
  if (s.restoration === 'not_due') return 'Restoration not due yet';
  const rt = roadType(s.road_type);
  const i = RESTORATION.indexOf(s.restoration) - 1;
  if (!rt) return ['Restoration pending (road type not chosen)', 'Restoration under way', 'Restoration done'][i];
  return rt.steps[i] || rt.steps[2];
}

/** Value of one status item, in words (for history and tags). */
export function statusValueLabel(k: keyof WorkStatus, v: unknown, s?: WorkStatus): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (k === 'pipeline') return PIPELINE.find((x) => x.key === v)?.label ?? String(v);
  if (k === 'cutting') return CUTTING.find((x) => x.key === v)?.label ?? String(v);
  if (k === 'road_type') return roadType(v as string)?.label ?? String(v);
  if (k === 'motorability') return MOTORABILITY.find((x) => x.key === v)?.label ?? String(v);
  if (k === 'restoration') return restorationLabel({ road_type: s?.road_type ?? null, restoration: v as Restoration });
  return String(v);
}

/** Back-filling makes restoration due: "not due" becomes "pending" automatically. */
export function normaliseStatus(s: WorkStatus): WorkStatus {
  const out = { ...s };
  if (out.cutting === 'backfilled' && out.restoration === 'not_due') out.restoration = 'pending';
  if (out.pipeline !== 'partly') out.pipe_laid_m = null;
  if (out.cutting === 'none') out.cut_length_m = null;
  if (out.road_type === 'earthen' && out.restoration === 'middle') out.restoration = 'done'; // no middle step
  return out;
}

export function deriveStage(s: WorkStatus, approval: Approval): StageKey {
  if (s.restoration === 'done') return approval === 'approved' ? 'restored_approved' : 'restored_awaiting';
  if (s.restoration === 'middle') return 'restoration_underway';
  if (s.cutting === 'backfilled' || s.restoration === 'pending') return 'backfilled';
  if (s.cutting !== 'none' || s.pipeline !== 'not_started' || s.manholes_built > 0 || s.ics_built > 0) return 'in_progress';
  return 'not_started';
}

/** "Pipe ✓ · MH 8/12 · IC 3" */
export function sewerCombination(s: WorkStatus, plannedManholes: number): string {
  const pipe = s.pipeline === 'laid' ? 'Pipe ✓' : s.pipeline === 'partly' ? `Pipe ${s.pipe_laid_m ?? '?'} m` : 'Pipe –';
  return `${pipe} · MH ${s.manholes_built}/${plannedManholes} · IC ${s.ics_built}`;
}

export interface StretchFacts {
  length_m: number;
  planned_manholes: number;
}

export interface Check {
  errors: string[];
  warnings: string[];
}

/** Validation (brief §6.7). `photos` = number of photos attached to this update. */
export function validateStatus(prev: WorkStatus, next: WorkStatus, st: StretchFacts, photos: number, approval: Approval): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts: (keyof WorkStatus)[] = ['manholes_built', 'ics_built', 'taps_broken', 'taps_restored', 'leaks', 'leaks_fixed'];
  for (const k of counts) {
    const v = next[k] as number;
    if (!Number.isInteger(v) || v < 0) errors.push(`${STATUS_LABELS[k]} must be a whole number, 0 or more.`);
  }
  const maxLen = Math.round(1.5 * st.length_m + 10);
  if (next.pipeline === 'partly') {
    if (next.pipe_laid_m === null || !(next.pipe_laid_m > 0)) errors.push('Enter the metres of pipe laid (partly laid).');
    else if (next.pipe_laid_m > maxLen) errors.push(`Pipe laid cannot be more than ${maxLen} m on this ${Math.round(st.length_m)} m stretch.`);
  }
  if (next.taps_restored > next.taps_broken) errors.push('Tap connections restored cannot be more than broken.');
  if (next.leaks_fixed > next.leaks) errors.push('Leakages fixed cannot be more than leakages.');
  if ((next.restoration === 'middle' || next.restoration === 'done') && !next.road_type) errors.push('Choose the road type before recording a restoration step.');
  const restoredNow = (next.restoration === 'middle' || next.restoration === 'done') && next.restoration !== prev.restoration;
  const typeChangedAfter = prev.road_type !== next.road_type && (prev.restoration === 'middle' || prev.restoration === 'done');
  if ((restoredNow || typeChangedAfter) && photos < 1) errors.push('A photo is required when a road is marked restored or its road type changes after restoration.');
  if (next.cut_length_m !== null && next.cut_length_m > maxLen) warnings.push(`Road cut length ${next.cut_length_m} m is more than 1.5 × the stretch length + 10 m (${maxLen} m).`);
  if (next.manholes_built > st.planned_manholes) warnings.push(`More manholes built (${next.manholes_built}) than planned (${st.planned_manholes}).`);
  if (next.manholes_built > 0 && next.pipeline === 'not_started') warnings.push('Manholes built but pipeline not started.');
  if (next.cutting === 'backfilled' && next.pipeline === 'not_started') warnings.push('Back-filled but pipeline not started.');
  if ((next.restoration === 'middle' || next.restoration === 'done') && next.pipeline === 'not_started' && next.cutting !== 'backfilled')
    warnings.push('Road marked restored with no pipe laying or back-filling recorded.');
  if (approval === 'approved' && typeChangedAfter) warnings.push('Road type changed after approval: the restoration goes back for approval.');
  return { errors, warnings };
}

/** Approval after a status change (brief §6.8). */
export function nextApproval(prev: WorkStatus, next: WorkStatus, approval: Approval, photos: number): Approval {
  if (next.restoration !== 'done') return 'none';
  if (prev.restoration !== 'done') return 'pending'; // final step just recorded
  if (approval === 'approved' && prev.road_type !== next.road_type) return 'pending';
  if (approval === 'rejected' && photos > 0) return 'pending'; // corrected work with a new photo goes back
  return approval;
}

export function statusChanges(prev: WorkStatus, next: WorkStatus) {
  return (Object.keys(STATUS_LABELS) as (keyof WorkStatus)[])
    .filter((k) => prev[k] !== next[k])
    .map((k) => ({ field: k, label: STATUS_LABELS[k], from: statusValueLabel(k, prev[k], prev), to: statusValueLabel(k, next[k], next) }));
}

/** Tags in priority order (brief §6.6), without the compliance ones (the server adds those). */
export function statusTags(s: WorkStatus, plannedManholes: number): string[] {
  const t: string[] = [];
  if (s.motorability === 'not_motorable') t.push('Not motorable');
  if (s.drain_clogged) t.push('Drain clogged');
  if (s.taps_broken - s.taps_restored > 0) t.push(`${s.taps_broken - s.taps_restored} taps broken`);
  if (s.leaks - s.leaks_fixed > 0) t.push(`${s.leaks - s.leaks_fixed} water leaks`);
  if (s.stagnation) t.push('Water stagnation');
  if (s.potholes) t.push('Potholes');
  if (s.uneven_backfill) t.push('Uneven back-fill');
  if (s.motorability === 'difficulty') t.push('Motorable with difficulty');
  if (s.cutting !== 'none') t.push(CUTTING.find((c) => c.key === s.cutting)!.label);
  if (s.pipeline !== 'not_started' || s.manholes_built || s.ics_built) t.push(sewerCombination(s, plannedManholes));
  if (s.restoration !== 'not_due') t.push(restorationLabel(s));
  return t;
}

/** Map letter badges: T taps · L leak · D drain · W stagnation · P potholes (C non-compliance is added by the server). */
export function statusBadges(s: WorkStatus): string {
  return [
    s.taps_broken > s.taps_restored ? 'T' : '',
    s.leaks > s.leaks_fixed ? 'L' : '',
    s.drain_clogged ? 'D' : '',
    s.stagnation ? 'W' : '',
    s.potholes ? 'P' : '',
  ].join('');
}
