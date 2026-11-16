/**
 * Compliance rules (brief §7, list from UGD_Compliance_Stagewise.xlsx). Pure functions: the server uses them
 * to work out each stretch's checklist, gates and summary; the web app shows what the server returns.
 *
 * Each item falls due at a point in the work (its stage, read from the status recorded on the stretch) and
 * guards a later step: recording that step while the item is not complied warns or is refused (gate).
 */
import type { WorkStatus } from './status.ts';

export const COMPLIANCE_STAGES = [
  { key: 'before_cutting', no: 1, label: 'Before road cutting', dueWhen: 'Road cutting or pipe work is first recorded', guards: 'Opening the road (road cut / trench open)' },
  { key: 'trench_open', no: 2, label: 'While the trench is open', dueWhen: 'Road is cut or trench is open (ends when back-filled)', guards: 'Marking the trench back-filled' },
  { key: 'pipe_laying', no: 3, label: 'During pipe laying', dueWhen: 'Pipeline is partly laid or laid', guards: 'Marking the pipeline Laid' },
  { key: 'after_pipe_laying', no: 4, label: 'After pipe laying', dueWhen: 'Pipeline is marked Laid', guards: 'Marking the trench back-filled' },
  { key: 'before_backfill', no: 5, label: 'Before back-fill', dueWhen: 'Pipeline Laid, or trench back-filled', guards: 'Marking the trench back-filled' },
  { key: 'after_backfill', no: 6, label: 'After back-fill', dueWhen: 'Trench is back-filled', guards: 'Starting or finishing road restoration' },
  { key: 'before_restoration', no: 7, label: 'Before restoration', dueWhen: 'Trench back-filled, or restoration started', guards: 'Starting or finishing road restoration' },
  { key: 'after_restoration', no: 8, label: 'After restoration', dueWhen: 'Road restoration marked done', guards: 'Approving the restoration' },
  { key: 'at_completion', no: 9, label: 'At completion', dueWhen: 'Road restoration marked done', guards: 'Nothing is stopped; counts in the score' },
] as const;
export type ComplianceStage = (typeof COMPLIANCE_STAGES)[number]['key'];
export const complianceStage = (k: string) => COMPLIANCE_STAGES.find((s) => s.key === k)!;

export const COMPLIANCE_CATEGORIES = [
  'Safety', 'Quality and tests', 'Permits and approvals', 'Environment and public', 'Documentation', 'Utilities coordination',
] as const;
export const EVIDENCE_KINDS = [
  { key: 'photo', label: 'Photo' },
  { key: 'document', label: 'Document' },
  { key: 'value', label: 'Measured value' },
  { key: 'date', label: 'Date' },
  { key: 'reference', label: 'Reference no.' },
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]['key'];

export interface PassRule {
  op: '>=' | '<=' | 'design_within';
  value: number;
}

export interface ComplianceItem {
  id: number; // this version's row id
  key: string;
  version: number;
  sort: number;
  name: string;
  description: string;
  category: string;
  due_at: ComplianceStage;
  applies: { road_types?: string[]; min_depth_m?: number; min_dia_mm?: number; unit_min_dia_mm?: number; admin_zones?: string[] };
  per: 'stretch' | 'reach' | 'manhole';
  evidence: EvidenceKind[];
  value_label: string | null;
  unit: string | null;
  pass_rule: PassRule | null;
  recurring_days: number | null;
  mandatory: boolean;
  severity: 'low' | 'medium' | 'high';
  gate: 'none' | 'warn' | 'block';
  grace_days: number;
}

export interface ComplianceRecord {
  id: number;
  item_key: string;
  item_version: number;
  unit: string; // '' whole stretch, pipe id, manhole code, or '*' (smaller pipes / manholes together)
  result: 'complied' | 'not_complied' | 'not_applicable';
  recorded_at: string;
  recorded_by: string;
  verification: 'waiting' | 'accepted' | 'rejected';
}

export interface StretchForCompliance {
  max_depth_m: number | null;
  max_dia_mm: number;
  admin_zone: string;
  pipes: [string, number, string, string, number][]; // id, dia mm, from mh, to mh, length
  manholes: [string, number | null, boolean][]; // code, design invert, on a 250 mm+ pipe
}

export type UnitState = 'not_due' | 'due' | 'overdue' | 'complied' | 'verified' | 'not_complied' | 'not_applicable';
export const UNIT_STATE_LABEL: Record<UnitState, string> = {
  not_due: 'Not due yet', due: 'Due', overdue: 'Overdue', complied: 'Complied, to verify', verified: 'Verified',
  not_complied: 'Not complied', not_applicable: 'Not applicable',
};
export const UNIT_STATE_COLOR: Record<UnitState, string> = {
  not_due: '#94a3b8', due: '#f59e0b', overdue: '#dc2626', complied: '#3b82f6', verified: '#16a34a', not_complied: '#dc2626', not_applicable: '#64748b',
};

/** Compliance theme of a stretch (map colour). */
export const COMPLIANCE_THEME = [
  { key: 'nothing_due', label: 'Nothing due yet', color: '#94a3b8' },
  { key: 'all_complied', label: 'All due items complied', color: '#16a34a' },
  { key: 'pending', label: 'Some due items pending', color: '#f59e0b' },
  { key: 'non_compliance', label: 'Non-compliance or overdue mandatory item', color: '#dc2626' },
] as const;
export type ComplianceTheme = (typeof COMPLIANCE_THEME)[number]['key'];

/** Milestones: first time each stage was reached (ISO time). Kept on the stretch; never cleared. */
export type Milestones = Partial<Record<ComplianceStage, string>>;

/** Is the stage's trigger met by this status? */
export function stageReached(stage: ComplianceStage, s: WorkStatus): boolean {
  switch (stage) {
    case 'before_cutting': return s.cutting !== 'none' || s.pipeline !== 'not_started' || s.manholes_built > 0;
    case 'trench_open': return s.cutting === 'road_cut' || s.cutting === 'trench_open';
    case 'pipe_laying': return s.pipeline !== 'not_started';
    case 'after_pipe_laying': return s.pipeline === 'laid';
    case 'before_backfill': return s.pipeline === 'laid' || s.cutting === 'backfilled';
    case 'after_backfill': return s.cutting === 'backfilled';
    case 'before_restoration': return s.cutting === 'backfilled' || s.restoration === 'middle' || s.restoration === 'done';
    case 'after_restoration':
    case 'at_completion': return s.restoration === 'done';
  }
}

/** While this lasts, recurring items fall due again every N days. */
export function stageActive(stage: ComplianceStage, s: WorkStatus): boolean {
  return stageReached(stage, s);
}

/** Update milestones for a new status (returns a new object). */
export function updateMilestones(m: Milestones, s: WorkStatus, now: string): Milestones {
  const out = { ...m };
  for (const st of COMPLIANCE_STAGES) if (!out[st.key] && stageReached(st.key, s)) out[st.key] = now;
  return out;
}

/** Does this save do the step the stage guards? `approving` = the restoration is being approved. */
export function stepGuarded(stage: ComplianceStage, prev: WorkStatus, next: WorkStatus, approving = false): boolean {
  const opening = prev.cutting === 'none' && (next.cutting === 'road_cut' || next.cutting === 'trench_open');
  const backfilling = prev.cutting !== 'backfilled' && next.cutting === 'backfilled';
  const restoring = ['middle', 'done'].includes(next.restoration) && next.restoration !== prev.restoration;
  switch (stage) {
    case 'before_cutting': return opening;
    case 'trench_open':
    case 'after_pipe_laying':
    case 'before_backfill': return backfilling;
    case 'pipe_laying': return prev.pipeline !== 'laid' && next.pipeline === 'laid';
    case 'after_backfill':
    case 'before_restoration': return restoring;
    case 'after_restoration': return approving;
    case 'at_completion': return false;
  }
}

export function itemApplies(item: ComplianceItem, st: StretchForCompliance, s: WorkStatus): boolean {
  const a = item.applies ?? {};
  if (a.road_types?.length && !(s.road_type && a.road_types.includes(s.road_type))) return false;
  if (a.min_depth_m && !((st.max_depth_m ?? 0) >= a.min_depth_m)) return false;
  if (a.min_dia_mm && st.max_dia_mm < a.min_dia_mm) return false;
  if (a.admin_zones?.length && !a.admin_zones.includes(st.admin_zone)) return false;
  return true;
}

export interface Unit {
  id: string;
  label: string;
  design_invert?: number | null;
}

/** The units an item is recorded for: the stretch, each 250 mm+ reach/manhole, plus "smaller ones together". */
export function itemUnits(item: ComplianceItem, st: StretchForCompliance): Unit[] {
  if (item.per === 'stretch') return [{ id: '', label: 'Whole stretch' }];
  const min = item.applies?.unit_min_dia_mm ?? 0;
  if (item.per === 'reach') {
    const big = st.pipes.filter((p) => p[1] >= min);
    const units: Unit[] = big.map((p) => ({ id: p[0], label: `${p[0]} · ${p[2]} → ${p[3]} · ${p[1]} mm · ${p[4]} m` }));
    if (big.length < st.pipes.length) units.push({ id: '*', label: big.length ? `Smaller pipes together (${st.pipes.length - big.length})` : 'All reaches together' });
    return units;
  }
  const big = st.manholes.filter((m) => min === 0 || m[2]);
  const units: Unit[] = big.map((m) => ({ id: m[0], label: m[0], design_invert: m[1] }));
  if (big.length < st.manholes.length) units.push({ id: '*', label: big.length ? `Other manholes together (${st.manholes.length - big.length})` : 'All manholes together' });
  return units;
}

/** Check a measured value against the pass rule. null = no rule (recorded only). */
export function passes(rule: PassRule | null, value: number, designValue?: number | null): boolean | null {
  if (!rule) return null;
  if (rule.op === '>=') return value >= rule.value;
  if (rule.op === '<=') return value <= rule.value;
  if (designValue === null || designValue === undefined) return null; // no design level: recorded without a check
  return Math.abs(value - designValue) <= rule.value + 1e-9;
}

export function passRuleText(rule: PassRule | null, unit: string | null): string {
  if (!rule) return 'Recorded only (no pass mark set)';
  if (rule.op === 'design_within') return `Within ±${rule.value} ${unit ?? ''} of the design value`.trim();
  return `${rule.op === '>=' ? 'At least' : 'At most'} ${rule.value} ${unit ?? ''}`.trim();
}

const DAY = 86400000;

export interface UnitStatus {
  unit: Unit;
  state: UnitState;
  due_since: string | null;
  overdue_since: string | null;
  record_id: number | null;
}

export interface ItemStatus {
  item: ComplianceItem;
  applies: boolean;
  units: UnitStatus[];
  state: UnitState; // worst of its units
  progress: string; // "6 of 9 reaches" for per-reach / per-manhole items
}

const WORST: UnitState[] = ['not_complied', 'overdue', 'due', 'complied', 'verified', 'not_applicable', 'not_due'];

export function evaluateItem(
  item: ComplianceItem, st: StretchForCompliance, s: WorkStatus, milestones: Milestones, records: ComplianceRecord[], now: Date,
): ItemStatus {
  const applies = itemApplies(item, st, s);
  const reachedAt = milestones[item.due_at] ?? (stageReached(item.due_at, s) ? now.toISOString() : undefined);
  const units = itemUnits(item, st).map((unit): UnitStatus => {
    const recs = records
      .filter((r) => r.item_key === item.key && r.unit === unit.id && r.verification !== 'rejected')
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    const last = recs[0];
    if (!applies) return { unit, state: 'not_applicable', due_since: null, overdue_since: null, record_id: null };
    if (!reachedAt) {
      // recorded early (e.g. a permit before cutting) still counts
      if (last) return { unit, state: recordState(last), due_since: null, overdue_since: null, record_id: last.id };
      return { unit, state: 'not_due', due_since: null, overdue_since: null, record_id: null };
    }
    let dueSince = new Date(reachedAt);
    if (last && last.result !== 'not_complied' && item.recurring_days && stageActive(item.due_at, s)) {
      const again = new Date(new Date(last.recorded_at).getTime() + item.recurring_days * DAY);
      if (again > now) return { unit, state: recordState(last), due_since: null, overdue_since: null, record_id: last.id };
      dueSince = again > dueSince ? again : dueSince;
    } else if (last) {
      return { unit, state: recordState(last), due_since: null, overdue_since: null, record_id: last.id };
    }
    const grace = item.recurring_days ? Math.max(item.grace_days, item.recurring_days) : item.grace_days;
    const overdueAt = new Date(dueSince.getTime() + grace * DAY);
    const overdue = now >= overdueAt;
    return { unit, state: overdue ? 'overdue' : 'due', due_since: dueSince.toISOString(), overdue_since: overdue ? overdueAt.toISOString() : null, record_id: last?.id ?? null };
  });
  const state = WORST.find((w) => units.some((u) => u.state === w)) ?? 'not_due';
  const done = units.filter((u) => u.state === 'complied' || u.state === 'verified' || u.state === 'not_applicable').length;
  const progress = item.per === 'stretch' ? '' : `${done} of ${units.length} ${item.per === 'reach' ? 'reaches' : 'manholes'}`;
  return { item, applies, units, state, progress };
}

function recordState(r: ComplianceRecord): UnitState {
  if (r.result === 'not_complied') return 'not_complied';
  if (r.verification === 'accepted') return r.result === 'not_applicable' ? 'not_applicable' : 'verified';
  return 'complied'; // complied or not applicable, waiting for verification
}

export interface ComplianceSummary {
  theme: ComplianceTheme;
  due: number; // mandatory units due so far (any state except not due / does not apply)
  verified: number;
  to_verify: number;
  overdue: number;
  not_complied: number;
  pending: number;
  score: number | null; // verified ÷ due, mandatory only
  non_compliance_tags: string[];
}

export function summarise(items: ItemStatus[]): ComplianceSummary {
  let due = 0, verified = 0, toVerify = 0, overdue = 0, notComplied = 0, pending = 0;
  const tags: string[] = [];
  for (const it of items) {
    if (!it.applies) continue;
    for (const u of it.units) {
      if (u.state === 'complied') toVerify++;
      if (!it.item.mandatory) continue;
      if (u.state === 'not_due' || u.state === 'not_applicable') {
        if (u.state === 'not_applicable' && u.record_id) { due++; verified++; }
        continue;
      }
      due++;
      if (u.state === 'verified') verified++;
      else if (u.state === 'overdue') overdue++;
      else if (u.state === 'not_complied') notComplied++;
      else if (u.state === 'due') pending++;
    }
    if (it.state === 'not_complied') tags.push(`Not complied: ${it.item.name}`);
    else if (it.state === 'overdue' && it.item.mandatory) tags.push(`Overdue: ${it.item.name}`);
  }
  const theme: ComplianceTheme = notComplied + overdue > 0 ? 'non_compliance' : pending > 0 ? 'pending' : due > 0 ? 'all_complied' : 'nothing_due';
  return { theme, due, verified, to_verify: toVerify, overdue, not_complied: notComplied, pending, score: due ? Math.round((verified / due) * 100) : null, non_compliance_tags: tags };
}

export interface GateResult {
  item: ComplianceItem;
  gate: 'warn' | 'block';
  message: string;
}

/** Gates hit by a save: items whose guarded step this save does, not complied for every unit. */
export function gatesHit(
  items: ComplianceItem[], st: StretchForCompliance, prev: WorkStatus, next: WorkStatus, milestones: Milestones,
  records: ComplianceRecord[], now: Date, approving = false,
): GateResult[] {
  const out: GateResult[] = [];
  const ms = updateMilestones(milestones, next, now.toISOString());
  for (const item of items) {
    if (item.gate === 'none' || !stepGuarded(item.due_at, prev, next, approving)) continue;
    const ev = evaluateItem(item, st, next, ms, records, now);
    if (!ev.applies) continue;
    const open = ev.units.filter((u) => !['complied', 'verified', 'not_applicable'].includes(u.state));
    if (!open.length) continue;
    const what = item.per === 'stretch' ? '' : ` (${open.length} of ${ev.units.length} ${item.per === 'reach' ? 'reaches' : 'manholes'} pending)`;
    out.push({ item, gate: item.gate, message: `${item.name}: not complied${what}.` });
  }
  return out;
}
