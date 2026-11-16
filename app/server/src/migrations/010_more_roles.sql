-- 010: five more roles: contractor, PIU officer, PMU officer, PGDMC officer, financial institution.
-- Widens the list of allowed roles; no account changes.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'contracting_assistant','field_inspector','aee','dee','commissioner','viewer',
  'contractor','piu_officer','pmu_officer','pgdmc_officer','finance'));
