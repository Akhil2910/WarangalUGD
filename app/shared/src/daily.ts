/**
 * Daily field record: what was done on a work stretch in one day, the people and machines on site, and time lost.
 * Shared by the server (checks, roll-up into the stretch's status, reports) and the screens.
 */

/** Quantities done in the day. Pipe is by diameter (mm → metres). */
export interface DailyQuantities {
  excavation_m: number;
  pipe: Record<string, number>;
  bedding_m: number;
  manholes: number;
  ics: number;
  backfill_m: number;
  road_m: number;
}
export const EMPTY_QUANTITIES: DailyQuantities = { excavation_m: 0, pipe: {}, bedding_m: 0, manholes: 0, ics: 0, backfill_m: 0, road_m: 0 };

export const QUANTITY_FIELDS = [
  { key: 'excavation_m', label: 'Trench excavated', unit: 'm' },
  { key: 'bedding_m', label: 'Bedding laid', unit: 'm' },
  { key: 'manholes', label: 'Manholes built', unit: '' },
  { key: 'ics', label: 'House connections (ICs)', unit: '' },
  { key: 'backfill_m', label: 'Back-filled', unit: 'm' },
  { key: 'road_m', label: 'Road restored', unit: 'm' },
] as const;

export const LABOUR = [
  { key: 'skilled', label: 'Skilled' },
  { key: 'unskilled', label: 'Unskilled' },
] as const;

export const MACHINES = [
  { key: 'excavator', label: 'JCB / excavator' },
  { key: 'tipper', label: 'Tractor / tipper' },
  { key: 'pump', label: 'Dewatering pump' },
  { key: 'breaker', label: 'Rock breaker' },
  { key: 'compactor', label: 'Roller / compactor' },
  { key: 'mixer', label: 'Concrete mixer' },
  { key: 'other', label: 'Other machine' },
] as const;

export const HINDRANCES = [
  { key: 'rain', label: 'Rain / weather' },
  { key: 'traffic', label: 'Traffic / police' },
  { key: 'utility', label: 'Utility in the way' },
  { key: 'material', label: 'Material not available' },
  { key: 'labour', label: 'Labour shortage' },
  { key: 'permission', label: 'Permission pending' },
  { key: 'public', label: 'Public objection' },
  { key: 'other', label: 'Other' },
] as const;
export type HindranceKey = (typeof HINDRANCES)[number]['key'];

export const DAILY_STATUS = [
  { key: 'submitted', label: 'Waiting for verification' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'returned', label: 'Returned for correction' },
] as const;

/** How many days back an entry may be made (later entries are marked late). */
export const DAILY_BACKDATE_DAYS = 30;
export const DAILY_LATE_AFTER_DAYS = 2;

export const pipeTotal = (q: Pick<DailyQuantities, 'pipe'>) => Object.values(q.pipe ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
