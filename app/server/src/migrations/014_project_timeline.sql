-- Project definition and timeline: packages, Gantt activities and milestones, monthly targets, extensions of time.
-- Only adds; nothing existing is changed. package_id 0 = the whole project.

ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS definition jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS project_packages (
  id                  serial PRIMARY KEY,
  ulb_id              integer NOT NULL DEFAULT 1 REFERENCES ulbs(id),
  code                text NOT NULL,
  name                text NOT NULL,
  contractor          text NOT NULL DEFAULT '',
  agreement_no        text NOT NULL DEFAULT '',
  agreement_date      date,
  appointed_date      date,
  original_completion date,
  value_cr            numeric,
  wards               integer[] NOT NULL DEFAULT '{}',
  note                text NOT NULL DEFAULT '',
  sort                integer NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id),
  UNIQUE (ulb_id, code)
);

CREATE TABLE IF NOT EXISTS project_activities (
  id              serial PRIMARY KEY,
  ulb_id          integer NOT NULL DEFAULT 1 REFERENCES ulbs(id),
  package_id      integer NOT NULL DEFAULT 0,
  code            text NOT NULL,
  parent_code     text NOT NULL DEFAULT '',
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('phase', 'activity', 'milestone')),
  planned_start   date,
  planned_finish  date,
  baseline_start  date,
  baseline_finish date,
  actual_start    date,
  actual_finish   date,
  pct             numeric NOT NULL DEFAULT 0 CHECK (pct >= 0 AND pct <= 100),
  weight          numeric NOT NULL DEFAULT 1,
  note            text NOT NULL DEFAULT '',
  sort            integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES users(id),
  UNIQUE (ulb_id, package_id, code)
);

CREATE TABLE IF NOT EXISTS project_targets (
  ulb_id      integer NOT NULL DEFAULT 1 REFERENCES ulbs(id),
  package_id  integer NOT NULL DEFAULT 0,
  month       date NOT NULL,                 -- first day of the month
  measure     text NOT NULL CHECK (measure IN ('pipe_km', 'manholes', 'ics', 'road_km')),
  planned     numeric NOT NULL,              -- planned in that month (not cumulative)
  PRIMARY KEY (ulb_id, package_id, month, measure)
);

CREATE TABLE IF NOT EXISTS project_eots (
  id          serial PRIMARY KEY,
  ulb_id      integer NOT NULL DEFAULT 1 REFERENCES ulbs(id),
  package_id  integer NOT NULL DEFAULT 0,
  eot_no      text NOT NULL DEFAULT '',
  approved_on date,
  to_date     date NOT NULL,
  reason      text NOT NULL,
  files       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_eots_ulb ON project_eots (ulb_id, package_id);

-- every change to the plan or progress, for the history view
CREATE TABLE IF NOT EXISTS project_plan_events (
  id        bigserial PRIMARY KEY,
  ulb_id    integer NOT NULL DEFAULT 1 REFERENCES ulbs(id),
  at        timestamptz NOT NULL DEFAULT now(),
  by_user   uuid REFERENCES users(id),
  kind      text NOT NULL,
  ref       text NOT NULL DEFAULT '',
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS project_plan_events_ulb ON project_plan_events (ulb_id, at DESC);
