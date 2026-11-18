/**
 * Rules shared by the server and the web app. Both import this module, so they can never disagree.
 * Phase 1 (map) holds roles, diameter classes and stage colours; later phases add the status model,
 * validation, issue derivation, compliance rules and progress figures here.
 */

export const ROLES = ['contracting_assistant', 'field_inspector', 'aee', 'dee', 'commissioner', 'viewer',
  'contractor', 'piu_officer', 'pmu_officer', 'pgdmc_officer', 'finance', 'system_admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  contracting_assistant: 'Contracting Assistant',
  field_inspector: 'Field Inspector',
  aee: 'AEE',
  dee: 'DEE',
  commissioner: 'Commissioner',
  viewer: 'Viewer',
  contractor: 'Contractor',
  piu_officer: 'PIU Officer (Implementation)',
  pmu_officer: 'PMU Officer (Review & Approval)',
  pgdmc_officer: 'PGDMC Officer (Monitoring)',
  finance: 'Financial Institution (Compliance)',
  system_admin: 'System Admin',
  super_admin: 'State Admin (all ULBs)',
};

/** What each role does, in plain words (shown on the sign-in help and the account page). */
export const ROLE_DUTY: Record<Role, string> = {
  contracting_assistant: 'Updates work status and records compliances in the area.',
  field_inspector: 'Updates work, records compliances, marks utilities.',
  aee: 'Draws work stretches, verifies compliances, resolves issues and grievances.',
  dee: 'As AEE, plus approves restorations and assigns issues.',
  commissioner: 'Everything: approval, monitoring, overrides.',
  viewer: 'Sees everything; changes nothing.',
  contractor: 'Updates work status, records compliances with photos, reports issues on own works.',
  piu_officer: 'Implementation: draws work stretches, updates work, records compliances, resolves issues and grievances, utilities.',
  pmu_officer: 'Reviews, verifies compliances and approves or rejects restorations. Does not update work.',
  pgdmc_officer: 'Reviews and monitors everything; changes nothing.',
  finance: 'Tracks progress and compliance (dashboard, works, compliance). No citizen personal data.',
  system_admin: 'Sets up and runs the system for this ULB: users, roles and permissions, settings.',
  super_admin: 'Sets up ULBs and their System Admins across the state.',
};
/** Roles that verify compliances and approve restorations without doing the work themselves. */
export const REVIEW_ROLES: readonly Role[] = ['pmu_officer'];
/** Roles that may not see citizens' grievances (personal data). */
export const NO_CITIZEN_DATA: readonly Role[] = ['finance'];

/** Rank in the hierarchy (viewer is outside it). */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  contracting_assistant: 1,
  field_inspector: 2,
  aee: 3,
  dee: 4,
  commissioner: 5,
  // outside the work hierarchy: they review or watch, they do not do the work
  pmu_officer: 0,
  pgdmc_officer: 0,
  finance: 0,
  contractor: 1,
  piu_officer: 4,
  system_admin: 0,
  super_admin: 0,
};

export const PASSWORD_MIN_LENGTH = 8;

/** Diameter classes, from the DPR design (150 mm to 1,400 mm). */
export const DIA_CLASSES = [
  { key: 'lateral', label: 'Lateral (150-200 mm)', min: 0, max: 200, color: '#f43f5e', width: 1.5 },
  { key: 'submain', label: 'Sub-main (250-450 mm)', min: 201, max: 450, color: '#f59e0b', width: 2.5 },
  { key: 'trunk', label: 'Trunk main (500 mm+)', min: 451, max: 99999, color: '#a855f7', width: 4 },
] as const;

export function diaClass(diaMm: number) {
  return DIA_CLASSES.find((c) => diaMm >= c.min && diaMm <= c.max)!;
}

export const TIME_ZONE = 'Asia/Kolkata';

/** Header every state-changing API call must carry (CSRF guard). */
export const CSRF_HEADER = 'x-wgl-request';

export * from './status.ts';
export * from './compliance.ts';
export * from './issues.ts';
export * from './grievances.ts';
export * from './project.ts';
export * from './perms.ts';
export * from './daily.ts';
