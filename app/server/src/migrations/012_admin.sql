-- 012: administration — ULBs, System / State admin roles, custom roles, the permission grid, settings.
-- Additive: Warangal becomes ULB 1 and every existing user belongs to it; nothing else changes.

CREATE TABLE IF NOT EXISTS ulbs (
  id          integer PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  name_local  text NOT NULL DEFAULT '',
  state       text NOT NULL DEFAULT '',
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ulbs (id, code, name, name_local, state, settings)
  SELECT 1, 'GWMC', 'Greater Warangal Municipal Corporation', 'గ్రేటర్ వరంగల్ మున్సిపల్ కార్పొరేషన్', 'Telangana',
         '{"short_name": "GWMC", "app_title": "Warangal UGD Tracker", "grievance_due_days": 3, "issue_due_days": {"high": 2, "medium": 7, "low": 14}}'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM ulbs WHERE id = 1);

ALTER TABLE users ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_key text;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'contracting_assistant','field_inspector','aee','dee','commissioner','viewer',
  'contractor','piu_officer','pmu_officer','pgdmc_officer','finance','system_admin','super_admin'));

-- roles shown in this ULB: the built-in ones (label can be changed) and new ones based on a built-in role
CREATE TABLE IF NOT EXISTS roles (
  ulb_id     integer NOT NULL REFERENCES ulbs(id),
  key        text NOT NULL,
  label      text NOT NULL,
  base_role  text NOT NULL,
  builtin    boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  sort       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ulb_id, key)
);

-- a tick in the grid; a role with no rows here uses the defaults of its base role
CREATE TABLE IF NOT EXISTS role_permissions (
  ulb_id    integer NOT NULL REFERENCES ulbs(id),
  role_key  text NOT NULL,
  action    text NOT NULL,
  allowed   boolean NOT NULL,
  PRIMARY KEY (ulb_id, role_key, action)
);
