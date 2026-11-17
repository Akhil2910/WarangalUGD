-- 011: project-level compliance (Pre-work, During work, Post-work), for the whole project.

CREATE TABLE IF NOT EXISTS project_settings (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name        text NOT NULL DEFAULT 'Warangal UGD Project',
  work_start  date,
  completion  date,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id)
);
INSERT INTO project_settings (id, work_start)
  SELECT 1, COALESCE((SELECT min(created_at)::date FROM stretches WHERE source = 'site' AND NOT hidden AND deleted_at IS NULL), CURRENT_DATE)
  WHERE NOT EXISTS (SELECT 1 FROM project_settings);

CREATE TABLE IF NOT EXISTS project_items (
  key          text PRIMARY KEY,
  sort         integer NOT NULL DEFAULT 0,
  phase        text NOT NULL CHECK (phase IN ('pre', 'during', 'post')),
  category     text NOT NULL,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  frequency    text NOT NULL CHECK (frequency IN ('once', 'monthly', 'quarterly', 'event')),
  due_day      integer NOT NULL DEFAULT 0,
  has_validity boolean NOT NULL DEFAULT false,
  evidence     jsonb NOT NULL DEFAULT '["document"]'::jsonb,
  gate         text NOT NULL DEFAULT 'none' CHECK (gate IN ('none', 'warn', 'block')),
  mandatory    boolean NOT NULL DEFAULT true,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_records (
  id            bigserial PRIMARY KEY,
  item_key      text NOT NULL REFERENCES project_items(key),
  period        text NOT NULL DEFAULT '',
  status        text NOT NULL CHECK (status IN ('submitted', 'verified', 'rejected')),
  reference     text NOT NULL DEFAULT '',
  doc_date      date,
  valid_from    date,
  valid_to      date,
  note          text NOT NULL DEFAULT '',
  files         jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_by  uuid REFERENCES users(id),
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  decision_note text NOT NULL DEFAULT '',
  override      text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS project_records_item ON project_records (item_key, period, id DESC);

CREATE TABLE IF NOT EXISTS project_events (
  id         bigserial PRIMARY KEY,
  record_id  bigint REFERENCES project_records(id),
  item_key   text NOT NULL,
  period     text NOT NULL DEFAULT '',
  kind       text NOT NULL,
  note       text NOT NULL DEFAULT '',
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  by_user    uuid REFERENCES users(id),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_events_item ON project_events (item_key, period, at DESC);
