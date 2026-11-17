/**
 * Project-level compliance: items for the whole project (not one road), in three phases —
 * Pre-work, During work, Post-work. Work-stretch compliance stages are grouped under the same phases.
 * Pure functions: the server works out due dates and statuses; the web app shows them.
 */
import type { ComplianceStage } from './compliance.ts';
import type { Role } from './index.ts';

export const PHASES = [
  { key: 'pre', label: 'Pre-work', hint: 'Before work starts on the ground' },
  { key: 'during', label: 'During work', hint: 'While the work is going on' },
  { key: 'post', label: 'Post-work', hint: 'After the work is completed' },
] as const;
export type Phase = (typeof PHASES)[number]['key'];
export const phaseLabel = (k: string) => PHASES.find((p) => p.key === k)?.label ?? k;

/** Work-stretch compliance stages under the three phases. */
export const STAGE_PHASE: Record<ComplianceStage, Phase> = {
  before_cutting: 'pre',
  trench_open: 'during', pipe_laying: 'during', after_pipe_laying: 'during', before_backfill: 'during', after_backfill: 'during', before_restoration: 'during',
  after_restoration: 'post', at_completion: 'post',
};

export const PROJECT_CATEGORIES = ['Contract and legal', 'Insurance and guarantees', 'Permissions', 'Safety', 'Quality', 'Environment', 'Social and labour', 'Reports', 'Handover'] as const;

export const FREQUENCIES = [
  { key: 'once', label: 'Once' },
  { key: 'monthly', label: 'Every month' },
  { key: 'quarterly', label: 'Every quarter' },
  { key: 'event', label: 'When it happens' },
] as const;
export type Frequency = (typeof FREQUENCIES)[number]['key'];

export const PROJECT_EVIDENCE = [
  { key: 'document', label: 'Document' },
  { key: 'photo', label: 'Photo' },
  { key: 'reference', label: 'Reference no.' },
  { key: 'date', label: 'Date' },
] as const;

export const PROJECT_STATUS = {
  verified: { label: 'Verified', tone: 'ok' },
  expiring: { label: 'Expiring', tone: 'bad' },
  waiting: { label: 'Waiting for verification', tone: 'wait' },
  due: { label: 'Due', tone: 'due' },
  rejected: { label: 'Rejected — submit again', tone: 'bad' },
  overdue: { label: 'Overdue', tone: 'bad' },
  expired: { label: 'Expired', tone: 'bad' },
  not_due: { label: 'Not yet due', tone: 'none' },
  event: { label: 'Record when it happens', tone: 'none' },
} as const;
export type ProjectStatus = keyof typeof PROJECT_STATUS;

/** Who submits proof, who verifies it. The Commissioner can do both and can override with a reason. */
export const PROJECT_SUBMIT_ROLES: readonly Role[] = ['contractor', 'piu_officer', 'aee', 'dee', 'commissioner'];
export const PROJECT_VERIFY_ROLES: readonly Role[] = ['pmu_officer', 'commissioner'];
export const EXPIRY_WARNING_DAYS = 30;

export interface ProjectItem {
  key: string;
  sort: number;
  phase: Phase;
  category: string;
  name: string;
  description: string;
  frequency: Frequency;
  /** once/pre: days before work start (0 = by the start); monthly/quarterly: day of the following month; once/post: days after completion */
  due_day: number;
  has_validity: boolean;
  evidence: string[];
  gate: 'none' | 'warn' | 'block';
  mandatory: boolean;
  active: boolean;
}

/** Starting list (the Commissioner can edit, add or retire items in the app). */
export const DEFAULT_PROJECT_ITEMS: Omit<ProjectItem, 'sort' | 'active'>[] = [
  // ---- pre-work ----
  { key: 'contract_agreement', phase: 'pre', category: 'Contract and legal', name: 'Contract agreement signed', description: 'Signed agreement between GWMC and the contractor, with the work order.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document', 'reference', 'date'], gate: 'warn', mandatory: true },
  { key: 'performance_guarantee', phase: 'pre', category: 'Insurance and guarantees', name: 'Performance bank guarantee', description: 'Bank guarantee for the contract value as per the agreement; keep valid until the defects period ends.', frequency: 'once', due_day: 0, has_validity: true, evidence: ['document', 'reference'], gate: 'warn', mandatory: true },
  { key: 'car_insurance', phase: 'pre', category: 'Insurance and guarantees', name: "Contractor's all-risk insurance", description: 'Insurance for the works and third-party damage; keep valid for the whole contract.', frequency: 'once', due_day: 0, has_validity: true, evidence: ['document', 'reference'], gate: 'block', mandatory: true },
  { key: 'wc_insurance', phase: 'pre', category: 'Insurance and guarantees', name: "Workmen's compensation insurance", description: 'Insurance covering all workers on site; keep valid for the whole contract.', frequency: 'once', due_day: 0, has_validity: true, evidence: ['document', 'reference'], gate: 'block', mandatory: true },
  { key: 'labour_licence', phase: 'pre', category: 'Social and labour', name: 'Labour licence and construction-worker (BOCW) registration', description: 'Licence under the Contract Labour Act and BOCW registration of the establishment.', frequency: 'once', due_day: 0, has_validity: true, evidence: ['document', 'reference'], gate: 'warn', mandatory: true },
  { key: 'safety_plan', phase: 'pre', category: 'Safety', name: 'Approved safety (HSE) plan', description: 'Site health and safety plan approved by GWMC; safety officer named.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document'], gate: 'block', mandatory: true },
  { key: 'quality_plan', phase: 'pre', category: 'Quality', name: 'Approved quality assurance plan', description: 'Quality plan with tests, frequencies and the testing laboratory.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document'], gate: 'warn', mandatory: true },
  { key: 'traffic_plan', phase: 'pre', category: 'Safety', name: 'Approved traffic management plan', description: 'Diversions, signage and barricading plan agreed with the traffic police.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document'], gate: 'warn', mandatory: true },
  { key: 'esmp', phase: 'pre', category: 'Environment', name: 'Environmental and social management plan', description: 'Approved ESMP (dust, noise, debris, trees, community) as required by the funding agency.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document'], gate: 'warn', mandatory: true },
  { key: 'road_permissions', phase: 'pre', category: 'Permissions', name: 'Road-cutting permissions (R&B, NH, railway)', description: 'Permissions from road owners for roads not under GWMC; railway crossing approval where needed.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document', 'reference'], gate: 'warn', mandatory: true },
  { key: 'tree_permission', phase: 'pre', category: 'Permissions', name: 'Tree-cutting / transplanting permission', description: 'Forest department permission where trees are affected.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document', 'reference'], gate: 'none', mandatory: false },
  { key: 'utility_agreements', phase: 'pre', category: 'Permissions', name: 'Utility shifting agreements', description: 'Agreements with the electricity, water, telecom and gas owners for shifting their lines.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document'], gate: 'none', mandatory: false },
  { key: 'labour_camp', phase: 'pre', category: 'Social and labour', name: 'Labour camp facilities', description: 'Drinking water, toilets, shelter, first aid and crèche at the labour camp.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['photo'], gate: 'none', mandatory: true },
  { key: 'grievance_committee', phase: 'pre', category: 'Social and labour', name: 'Grievance redress committee formed', description: 'Committee to handle citizen grievances, with members and contact numbers displayed.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true },
  { key: 'key_staff', phase: 'pre', category: 'Contract and legal', name: 'Key staff mobilised', description: 'Project manager, site engineers, safety officer and quality engineer on site as per the contract.', frequency: 'once', due_day: 0, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true },
  // ---- during work ----
  { key: 'monthly_progress', phase: 'during', category: 'Reports', name: 'Monthly progress report', description: 'Physical and financial progress, with photographs, for the month.', frequency: 'monthly', due_day: 10, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true },
  { key: 'monthly_safety_audit', phase: 'during', category: 'Safety', name: 'Monthly safety audit', description: 'Site safety inspection with findings and corrective actions.', frequency: 'monthly', due_day: 5, has_validity: false, evidence: ['document', 'photo'], gate: 'none', mandatory: true },
  { key: 'third_party_quality', phase: 'during', category: 'Quality', name: 'Third-party quality inspection', description: 'Inspection report by the third-party quality agency.', frequency: 'monthly', due_day: 15, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true },
  { key: 'labour_payments', phase: 'during', category: 'Social and labour', name: 'Wages, PF and ESI paid', description: 'Proof that wages were paid and PF / ESI deposited for the month.', frequency: 'monthly', due_day: 15, has_validity: false, evidence: ['document', 'reference'], gate: 'none', mandatory: true },
  { key: 'grm_meeting', phase: 'during', category: 'Social and labour', name: 'Grievance committee meeting', description: 'Minutes of the monthly grievance redress meeting.', frequency: 'monthly', due_day: 10, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true },
  { key: 'env_monitoring', phase: 'during', category: 'Environment', name: 'Environmental monitoring (dust, noise, water)', description: 'Monitoring results against the ESMP limits.', frequency: 'quarterly', due_day: 15, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true },
  { key: 'fi_compliance_report', phase: 'during', category: 'Reports', name: 'Compliance report to the financial institution', description: 'Quarterly environmental and social compliance report for the funding agency.', frequency: 'quarterly', due_day: 30, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true },
  { key: 'accident_report', phase: 'during', category: 'Safety', name: 'Accident / incident report', description: 'Report any accident or dangerous incident within 24 hours, with the action taken.', frequency: 'event', due_day: 1, has_validity: false, evidence: ['document', 'photo'], gate: 'none', mandatory: true },
  // ---- post-work ----
  { key: 'completion_certificate', phase: 'post', category: 'Handover', name: 'Completion certificate', description: 'Certificate that the work is complete as per the contract.', frequency: 'once', due_day: 30, has_validity: false, evidence: ['document', 'reference'], gate: 'none', mandatory: true },
  { key: 'as_built', phase: 'post', category: 'Handover', name: 'As-built drawings', description: 'As-built drawings of sewers, manholes and house connections (soft and hard copy).', frequency: 'once', due_day: 60, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true },
  { key: 'om_manual', phase: 'post', category: 'Handover', name: 'O&M manual and handover to GWMC', description: 'Operation and maintenance manual; formal handover of the network.', frequency: 'once', due_day: 60, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true },
  { key: 'site_clearance', phase: 'post', category: 'Environment', name: 'Sites cleared and restored', description: 'All work sites, camps and dumps cleared and restored.', frequency: 'once', due_day: 30, has_validity: false, evidence: ['photo', 'document'], gate: 'none', mandatory: true },
  { key: 'final_es_report', phase: 'post', category: 'Reports', name: 'Final environmental and social report', description: 'Completion report on ESMP compliance for the funding agency.', frequency: 'once', due_day: 90, has_validity: false, evidence: ['document'], gate: 'none', mandatory: true },
  { key: 'dlp_inspections', phase: 'post', category: 'Quality', name: 'Defects-liability period inspections', description: 'Inspections during the defects period and defects rectified.', frequency: 'quarterly', due_day: 15, has_validity: false, evidence: ['document', 'photo'], gate: 'none', mandatory: true },
  { key: 'stp_cto', phase: 'post', category: 'Permissions', name: 'Consent to operate for the STP', description: 'Consent to operate from the Pollution Control Board for the sewage treatment plant.', frequency: 'once', due_day: 90, has_validity: true, evidence: ['document', 'reference'], gate: 'none', mandatory: true },
];

// ---------------- periods and due dates ----------------
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const monthStart = (y: number, m0: number) => ymd(new Date(Date.UTC(y, m0, 1)));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface Period { key: string; label: string; due: string | null }

/**
 * The periods an item is asked for, with due dates.
 * once: one period ''. monthly / quarterly: from the phase's start month up to the current one.
 * During-work items run from the work start to the completion; post-work repeating items from the completion.
 */
export function periodsFor(item: Pick<ProjectItem, 'phase' | 'frequency' | 'due_day'>, s: { work_start: string | null; completion: string | null }, today: string): Period[] {
  if (item.frequency === 'event') return [];
  if (item.frequency === 'once') {
    if (item.phase === 'pre') return [{ key: '', label: '', due: s.work_start ? addDays(s.work_start, -item.due_day) : null }];
    if (item.phase === 'post') return [{ key: '', label: '', due: s.completion ? addDays(s.completion, item.due_day) : null }];
    return [{ key: '', label: '', due: s.work_start ? addDays(s.work_start, item.due_day) : null }];
  }
  const from = item.phase === 'post' ? s.completion : s.work_start;
  if (!from || from > today) return [];
  const until = item.phase === 'during' && s.completion && s.completion < today ? s.completion : today;
  const out: Period[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)) - 1;
  if (item.frequency === 'quarterly') m = Math.floor(m / 3) * 3;
  const step = item.frequency === 'monthly' ? 1 : 3;
  while (monthStart(y, m) <= until && out.length < 120) {
    const nextStart = monthStart(y + Math.floor((m + step) / 12), (m + step) % 12);
    const key = item.frequency === 'monthly' ? `${y}-${String(m + 1).padStart(2, '0')}` : `${y}-Q${Math.floor(m / 3) + 1}`;
    const label = item.frequency === 'monthly' ? `${MONTHS[m]} ${y}` : `Q${Math.floor(m / 3) + 1} ${y} (${MONTHS[m]}–${MONTHS[m + 2]})`;
    out.push({ key, label, due: addDays(nextStart, Math.max(0, item.due_day - 1)) });
    m += step;
    if (m >= 12) { y += 1; m -= 12; }
  }
  return out;
}

export interface ProjectRecordLite { status: 'submitted' | 'verified' | 'rejected'; valid_to: string | null }

/** Status of one item for one period, from its latest record. */
export function projectStatus(item: Pick<ProjectItem, 'phase' | 'frequency' | 'has_validity'>, due: string | null, rec: ProjectRecordLite | null, today: string, phaseOpen: boolean): ProjectStatus {
  if (item.frequency === 'event') return rec?.status === 'submitted' ? 'waiting' : 'event';
  if (rec?.status === 'verified') {
    if (item.has_validity && rec.valid_to) {
      if (rec.valid_to < today) return 'expired';
      if (rec.valid_to <= addDays(today, EXPIRY_WARNING_DAYS)) return 'expiring';
    }
    return 'verified';
  }
  if (rec?.status === 'submitted') return 'waiting';
  if (rec?.status === 'rejected') return due && due < today ? 'overdue' : 'rejected';
  if (!phaseOpen) return 'not_due';
  if (due && due < today) return 'overdue';
  return 'due';
}

/** Counts towards "done" in the scores. */
export const isDone = (s: ProjectStatus) => s === 'verified' || s === 'expiring';
/** Counts as asked for (in the score's denominator). */
export const isAsked = (s: ProjectStatus) => s !== 'not_due' && s !== 'event';
