-- 004: work stretches: a named group of one or more roads (pre-generated stretches), made by an AEE or above.
-- Each road keeps its own status; the group shows totals. A road belongs to at most one work stretch. Additive only.

CREATE SEQUENCE IF NOT EXISTS work_group_seq;

CREATE TABLE IF NOT EXISTS work_groups (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,          -- WS-NNNN
  name        text NOT NULL,
  package     text NOT NULL DEFAULT '',
  contractor  text NOT NULL DEFAULT '',
  start_date  date,
  note        text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stretches ADD COLUMN IF NOT EXISTS work_group text;
CREATE INDEX IF NOT EXISTS stretches_work_group ON stretches (work_group);

CREATE TABLE IF NOT EXISTS work_group_events (
  id          bigserial PRIMARY KEY,
  group_code  text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  by_user     uuid REFERENCES users(id),
  action      text NOT NULL,                 -- created | edited | roads_added | roads_removed | status_all | compliance_all | verify_all
  note        text NOT NULL DEFAULT '',
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS work_group_events_code ON work_group_events (group_code, at DESC);
