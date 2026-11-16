/**
 * Issues (brief §6.9). Three sources:
 *  - status:     raised from a stretch's status, one per kind with a count; the count follows the status and
 *                the issue closes when it reaches 0. Resolving clears the damage on the stretch; re-opening
 *                brings it back (so the next save does not close it again).
 *  - compliance: a non-compliance, or a mandatory item overdue; closes when the item is complied and verified.
 *  - manual:     reported at a stretch with a remark (photo optional).
 */
import type { WorkStatus } from './status.ts';

export const ISSUE_KINDS = [
  { key: 'drain_clogged', label: 'Drain clogged with gravel', severity: 'high', source: 'status' },
  { key: 'taps_broken', label: 'Tap connections broken', severity: 'high', source: 'status' },
  { key: 'water_leak', label: 'Water pipe leakage', severity: 'high', source: 'status' },
  { key: 'not_motorable', label: 'Road not motorable', severity: 'medium', source: 'status' },
  { key: 'stagnation', label: 'Water stagnation', severity: 'medium', source: 'status' },
  { key: 'potholes', label: 'Potholes in trench', severity: 'medium', source: 'status' },
  { key: 'uneven_backfill', label: 'Uneven back-fill', severity: 'low', source: 'status' },
  { key: 'drain_damaged', label: 'Drain damaged', severity: 'medium', source: 'manual' },
  { key: 'culvert_damaged', label: 'Culvert broken / damaged', severity: 'high', source: 'manual' },
  { key: 'compliance', label: 'Compliance not met', severity: 'medium', source: 'compliance' },
  { key: 'other', label: 'Other', severity: 'medium', source: 'manual' },
] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number]['key'];
export type Severity = 'low' | 'medium' | 'high';
export const issueKind = (k: string) => ISSUE_KINDS.find((x) => x.key === k);
export const MANUAL_KINDS = ISSUE_KINDS.filter((k) => k.source === 'manual');
export const STATUS_KINDS = ISSUE_KINDS.filter((k) => k.source === 'status');

export const ISSUE_STATUS = [
  { key: 'open', label: 'Open', color: '#dc2626' },
  { key: 'assigned', label: 'Assigned', color: '#f59e0b' },
  { key: 'resolved', label: 'Resolved', color: '#16a34a' },
] as const;
export type IssueStatus = (typeof ISSUE_STATUS)[number]['key'];
export const SEVERITY_COLOR: Record<Severity, string> = { high: '#dc2626', medium: '#f59e0b', low: '#94a3b8' };

/** Days to fix, by severity, counted from the day the issue is raised (proposed default). */
export const DUE_DAYS: Record<Severity, number> = { high: 2, medium: 7, low: 14 };

/** Count of each status-raised kind on a stretch. */
export function statusIssueCounts(s: WorkStatus): Record<string, number> {
  return {
    drain_clogged: s.drain_clogged ? 1 : 0,
    taps_broken: Math.max(0, s.taps_broken - s.taps_restored),
    water_leak: Math.max(0, s.leaks - s.leaks_fixed),
    not_motorable: s.motorability === 'not_motorable' ? 1 : 0,
    stagnation: s.stagnation ? 1 : 0,
    potholes: s.potholes ? 1 : 0,
    uneven_backfill: s.uneven_backfill ? 1 : 0,
  };
}

/** The status with this kind of damage cleared (resolving the issue). */
export function clearStatusFor(kind: string, s: WorkStatus): WorkStatus {
  const o = { ...s };
  if (kind === 'drain_clogged') o.drain_clogged = false;
  if (kind === 'taps_broken') o.taps_restored = o.taps_broken;
  if (kind === 'water_leak') o.leaks_fixed = o.leaks;
  if (kind === 'not_motorable') o.motorability = 'difficulty';
  if (kind === 'stagnation') o.stagnation = false;
  if (kind === 'potholes') o.potholes = false;
  if (kind === 'uneven_backfill') o.uneven_backfill = false;
  return o;
}

/** The status with this kind of damage brought back (re-opening the issue with its last count). */
export function restoreStatusFor(kind: string, s: WorkStatus, count: number): WorkStatus {
  const o = { ...s };
  const n = Math.max(1, count);
  if (kind === 'drain_clogged') o.drain_clogged = true;
  if (kind === 'taps_broken') {
    o.taps_broken = Math.max(o.taps_broken, n);
    o.taps_restored = o.taps_broken - n;
  }
  if (kind === 'water_leak') {
    o.leaks = Math.max(o.leaks, n);
    o.leaks_fixed = o.leaks - n;
  }
  if (kind === 'not_motorable') o.motorability = 'not_motorable';
  if (kind === 'stagnation') o.stagnation = true;
  if (kind === 'potholes') o.potholes = true;
  if (kind === 'uneven_backfill') o.uneven_backfill = true;
  return o;
}

/** India date (YYYY-MM-DD) of a moment. */
export function indiaDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Overdue from the day after its due date, India time. */
export function issueOverdue(dueDate: string | null, status: string, now: Date = new Date()): boolean {
  return !!dueDate && status !== 'resolved' && indiaDate(now) > dueDate;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
