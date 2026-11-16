-- 002: road stretches with their work status and history; uploaded files; the compliance list
-- (versioned items) and compliance records. Additive only.

CREATE TABLE IF NOT EXISTS stretches (
  code             text PRIMARY KEY,                 -- W<ward>-NNN
  ward             integer NOT NULL,
  admin_zone       text NOT NULL,
  sewer_zone       text NOT NULL DEFAULT '',
  catchment        text NOT NULL DEFAULT '',
  package          text NOT NULL DEFAULT '',
  road_name        text NOT NULL DEFAULT '',
  length_m         double precision NOT NULL,
  planned_manholes integer NOT NULL,
  dia_m            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- metres per diameter (mm)
  max_dia_mm       integer NOT NULL DEFAULT 0,
  max_depth_m      double precision,
  outside_ward     boolean NOT NULL DEFAULT false,
  geom             jsonb NOT NULL,                     -- GeoJSON (EPSG:4326)
  pipes            jsonb NOT NULL,                     -- [[pipe_id, dia_mm, from_mh, to_mh, length_m], ...]
  manholes         jsonb NOT NULL,                     -- [[mh_code, design_invert, on_250mm_plus], ...]
  status           jsonb NOT NULL,                     -- the 18 field items (shared/status.ts WorkStatus)
  approval         text NOT NULL DEFAULT 'none' CHECK (approval IN ('none','pending','approved','rejected')),
  stage            text NOT NULL DEFAULT 'not_started',
  milestones       jsonb NOT NULL DEFAULT '{}'::jsonb, -- first time each compliance stage was reached
  compliance       jsonb NOT NULL DEFAULT '{}'::jsonb, -- summary, refreshed on every change
  tags             jsonb NOT NULL DEFAULT '[]'::jsonb,
  badges           text NOT NULL DEFAULT '',
  version          integer NOT NULL DEFAULT 1,
  record_state     text NOT NULL DEFAULT 'active' CHECK (record_state IN ('proposed','active','rejected')),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS stretches_ward ON stretches (ward);
CREATE INDEX IF NOT EXISTS stretches_zone ON stretches (admin_zone);
CREATE INDEX IF NOT EXISTS stretches_stage ON stretches (stage);

-- A pipe belongs to only one live stretch.
CREATE TABLE IF NOT EXISTS stretch_pipes (
  pipe_id      text PRIMARY KEY,
  stretch_code text NOT NULL REFERENCES stretches(code)
);
CREATE INDEX IF NOT EXISTS stretch_pipes_code ON stretch_pipes (stretch_code);

-- Every change to a stretch is a new row: who, when, from -> to, a full status snapshot, evidence, warnings.
CREATE TABLE IF NOT EXISTS stretch_history (
  id           bigserial PRIMARY KEY,
  stretch_code text NOT NULL REFERENCES stretches(code),
  version      integer NOT NULL,
  kind         text NOT NULL,               -- created | status | approval | rollback
  at           timestamptz NOT NULL DEFAULT now(),
  by_user      uuid REFERENCES users(id),
  changes      jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot     jsonb NOT NULL,              -- status + approval + stage after the change
  note         text NOT NULL DEFAULT '',
  photos       jsonb NOT NULL DEFAULT '[]'::jsonb,
  gps          jsonb,                        -- {lat, lon, accuracy_m}
  distance_m   double precision,             -- from the stretch line
  warnings     jsonb NOT NULL DEFAULT '[]'::jsonb,
  override     text NOT NULL DEFAULT ''      -- Commissioner's reason for overriding a blocking gate
);
CREATE INDEX IF NOT EXISTS stretch_history_code ON stretch_history (stretch_code, at DESC);
CREATE INDEX IF NOT EXISTS stretch_history_at ON stretch_history (at DESC);

-- Photos and documents. Bytes are kept on disk under app-state/files; never served without sign-in.
CREATE TABLE IF NOT EXISTS files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('photo','document')),
  mime        text NOT NULL,
  name        text NOT NULL DEFAULT '',
  size        integer NOT NULL,
  sha256      text NOT NULL,
  gps         jsonb,
  taken_at    timestamptz,
  uploaded_by uuid REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- The compliance list. Editing an item adds a new version row; retiring hides it for future work.
CREATE TABLE IF NOT EXISTS compliance_items (
  id             serial PRIMARY KEY,
  key            text NOT NULL,
  version        integer NOT NULL,
  sort           integer NOT NULL DEFAULT 0,
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  category       text NOT NULL,
  due_at         text NOT NULL,
  applies        jsonb NOT NULL DEFAULT '{}'::jsonb,
  per            text NOT NULL CHECK (per IN ('stretch','reach','manhole')),
  evidence       jsonb NOT NULL DEFAULT '[]'::jsonb,
  value_label    text,
  unit           text,
  pass_rule      jsonb,
  recurring_days integer,
  mandatory      boolean NOT NULL DEFAULT true,
  severity       text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  gate           text NOT NULL DEFAULT 'warn' CHECK (gate IN ('none','warn','block')),
  grace_days     integer NOT NULL DEFAULT 2,
  is_current     boolean NOT NULL DEFAULT true,  -- the latest version of this key
  retired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id),
  UNIQUE (key, version)
);

CREATE TABLE IF NOT EXISTS compliance_records (
  id            bigserial PRIMARY KEY,
  stretch_code  text NOT NULL REFERENCES stretches(code),
  item_id       integer NOT NULL REFERENCES compliance_items(id),   -- the version recorded against
  item_key      text NOT NULL,
  item_version  integer NOT NULL,
  unit          text NOT NULL DEFAULT '',  -- '' whole stretch | pipe id | manhole code | '*' smaller ones together
  result        text NOT NULL CHECK (result IN ('complied','not_complied','not_applicable')),
  value         double precision,
  design_value  double precision,
  value_date    date,
  reference     text NOT NULL DEFAULT '',
  reason        text NOT NULL DEFAULT '',
  photos        jsonb NOT NULL DEFAULT '[]'::jsonb,
  documents     jsonb NOT NULL DEFAULT '[]'::jsonb,
  gps           jsonb,
  distance_m    double precision,
  recorded_by   uuid NOT NULL REFERENCES users(id),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  verification  text NOT NULL DEFAULT 'waiting' CHECK (verification IN ('waiting','accepted','rejected')),
  verified_by   uuid REFERENCES users(id),
  verified_at   timestamptz,
  verify_note   text NOT NULL DEFAULT '',
  bulk_id       uuid
);
CREATE INDEX IF NOT EXISTS compliance_records_stretch ON compliance_records (stretch_code, item_key, unit);
CREATE INDEX IF NOT EXISTS compliance_records_waiting ON compliance_records (verification, recorded_at);

-- Which seed files have been loaded (stretches, compliance list), so a restart never loads them twice.
CREATE TABLE IF NOT EXISTS seed_loads (
  name      text PRIMARY KEY,
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb,
  loaded_at timestamptz NOT NULL DEFAULT now()
);
