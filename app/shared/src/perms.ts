/**
 * Permissions: what each role may do. The System Admin can change this grid per ULB (Admin → Roles and permissions).
 * The defaults below reproduce the rules the app had before the grid, so nothing changes until someone edits it.
 * Area limits (a user's wards / zones) still apply on top of these.
 */
import type { Role } from './index.ts';

export const ACTIONS = [
  // work
  { key: 'stretch.create', group: 'Work', label: 'Create and draw work stretches; change pipes, name, start / end' },
  { key: 'status.update', group: 'Work', label: 'Update work status' },
  { key: 'restoration.approve', group: 'Work', label: 'Approve or reject road restoration' },
  { key: 'override', group: 'Work', label: 'Override a blocking compliance (with a reason)' },
  // compliance
  { key: 'compliance.record', group: 'Compliance', label: 'Record work-stretch compliance' },
  { key: 'compliance.verify', group: 'Compliance', label: 'Verify work-stretch compliance' },
  { key: 'compliance.verify_own', group: 'Compliance', label: 'Verify one’s own records (normally another person must)' },
  { key: 'compliance.list', group: 'Compliance', label: 'Change the work-stretch compliance list' },
  { key: 'project.submit', group: 'Compliance', label: 'Submit project compliance proof' },
  { key: 'project.verify', group: 'Compliance', label: 'Verify project compliance' },
  { key: 'project.settings', group: 'Compliance', label: 'Change project dates and the project compliance list' },
  // issues and grievances
  { key: 'issue.report', group: 'Issues and grievances', label: 'Report issues' },
  { key: 'issue.resolve', group: 'Issues and grievances', label: 'Resolve and re-open issues' },
  { key: 'issue.assign', group: 'Issues and grievances', label: 'Assign issues' },
  { key: 'issue.delete', group: 'Issues and grievances', label: 'Delete issues permanently' },
  { key: 'grievance.view', group: 'Issues and grievances', label: 'See citizen grievances (personal data)' },
  { key: 'grievance.mobile', group: 'Issues and grievances', label: 'See citizens’ full mobile numbers' },
  { key: 'grievance.act', group: 'Issues and grievances', label: 'Resolve, close or re-open grievances' },
  { key: 'grievance.assign', group: 'Issues and grievances', label: 'Reassign grievances' },
  // utilities and files
  { key: 'utility.mark', group: 'Utilities and files', label: 'Mark and edit utilities on the map' },
  { key: 'utility.import', group: 'Utilities and files', label: 'Import utility files' },
  { key: 'files.upload', group: 'Utilities and files', label: 'Upload photos and documents' },
  // administration
  { key: 'admin.users', group: 'Administration', label: 'Manage users (add, disable, passwords, areas)' },
  { key: 'admin.roles', group: 'Administration', label: 'Manage roles and this permission grid' },
  { key: 'admin.settings', group: 'Administration', label: 'Change organisation settings and deadlines' },
  { key: 'admin.audit', group: 'Administration', label: 'See the audit log' },
] as const;
export type Action = (typeof ACTIONS)[number]['key'];
export const ACTION_KEYS = ACTIONS.map((a) => a.key) as Action[];

const FIELD: Role[] = ['contracting_assistant', 'field_inspector', 'aee', 'dee', 'commissioner', 'contractor', 'piu_officer'];
const OFFICERS: Role[] = ['aee', 'dee', 'commissioner', 'piu_officer'];
const SENIOR: Role[] = ['dee', 'commissioner', 'piu_officer'];

/** Who has each action by default (the rules before the grid existed). */
const DEFAULTS: Record<Action, Role[]> = {
  'stretch.create': OFFICERS,
  'status.update': FIELD,
  'restoration.approve': ['dee', 'commissioner', 'pmu_officer'],
  override: ['commissioner'],
  'compliance.record': FIELD,
  'compliance.verify': ['aee', 'dee', 'commissioner', 'pmu_officer'],
  'compliance.verify_own': ['commissioner'],
  'compliance.list': ['commissioner'],
  'project.submit': ['contractor', 'piu_officer', 'aee', 'dee', 'commissioner'],
  'project.verify': ['pmu_officer', 'commissioner'],
  'project.settings': ['commissioner'],
  'issue.report': FIELD,
  'issue.resolve': OFFICERS,
  'issue.assign': SENIOR,
  'issue.delete': ['commissioner'],
  'grievance.view': ['contracting_assistant', 'field_inspector', 'aee', 'dee', 'commissioner', 'viewer', 'contractor', 'piu_officer', 'pmu_officer', 'pgdmc_officer'],
  'grievance.mobile': OFFICERS,
  'grievance.act': OFFICERS,
  'grievance.assign': SENIOR,
  'utility.mark': ['field_inspector', 'aee', 'dee', 'commissioner', 'piu_officer'],
  'utility.import': OFFICERS,
  'files.upload': FIELD,
  'admin.users': ['system_admin', 'super_admin'],
  'admin.roles': ['system_admin', 'super_admin'],
  'admin.settings': ['system_admin', 'super_admin'],
  'admin.audit': ['system_admin', 'super_admin', 'commissioner'],
};

export function defaultGrants(base: Role): Action[] {
  return ACTION_KEYS.filter((a) => DEFAULTS[a].includes(base));
}
