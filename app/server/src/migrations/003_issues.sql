-- 003: issues (raised from status, from compliance, or reported by hand) and their history. Additive only.

CREATE SEQUENCE IF NOT EXISTS issue_code_seq;

CREATE TABLE IF NOT EXISTS issues (
  id                 bigserial PRIMARY KEY,
  code               text NOT NULL UNIQUE,              -- I-NNNN
  kind               text NOT NULL,
  source             text NOT NULL CHECK (source IN ('status','compliance','manual')),
  item_key           text NOT NULL DEFAULT '',          -- compliance item, for compliance issues
  stretch_code       text REFERENCES stretches(code),
  lon                double precision,
  lat                double precision,
  ward               integer,
  admin_zone         text NOT NULL DEFAULT '',
  package            text NOT NULL DEFAULT '',
  count              integer NOT NULL DEFAULT 1,
  severity           text NOT NULL CHECK (severity IN ('low','medium','high')),
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','resolved')),
  title              text NOT NULL,
  remark             text NOT NULL DEFAULT '',
  photos             jsonb NOT NULL DEFAULT '[]'::jsonb,
  assignee           uuid REFERENCES users(id),
  due_date           date,
  created_by         uuid REFERENCES users(id),        -- null = raised by the system
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  resolved_by        uuid REFERENCES users(id),
  resolution_note    text NOT NULL DEFAULT '',
  resolution_photos  jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS issues_stretch ON issues (stretch_code, status);
CREATE INDEX IF NOT EXISTS issues_status ON issues (status, severity);
CREATE INDEX IF NOT EXISTS issues_zone ON issues (admin_zone, ward);

CREATE TABLE IF NOT EXISTS issue_events (
  id        bigserial PRIMARY KEY,
  issue_id  bigint NOT NULL REFERENCES issues(id),
  at        timestamptz NOT NULL DEFAULT now(),
  by_user   uuid REFERENCES users(id),
  action    text NOT NULL,     -- opened | count | assigned | resolved | reopened | auto_resolved
  note      text NOT NULL DEFAULT '',
  photos    jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS issue_events_issue ON issue_events (issue_id, at);

ALTER TABLE stretches ADD COLUMN IF NOT EXISTS open_issues integer NOT NULL DEFAULT 0;
