-- 008: citizen grievances (from the QR board of each work stretch) and utilities (underground / above ground). Additive only.

-- each work stretch gets a random public token for its QR code (the code itself is not guessable from it)
ALTER TABLE stretches ADD COLUMN IF NOT EXISTS qr_token text;
CREATE UNIQUE INDEX IF NOT EXISTS stretches_qr_token ON stretches (qr_token) WHERE qr_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS grievances (
  id                bigserial PRIMARY KEY,
  number            text NOT NULL UNIQUE,              -- G-000001, given to the citizen
  stretch_code      text REFERENCES stretches(code),
  lon               double precision,
  lat               double precision,
  ward              integer,
  admin_zone        text NOT NULL DEFAULT '',
  category          text NOT NULL,
  description       text NOT NULL,
  photos            jsonb NOT NULL DEFAULT '[]'::jsonb,
  name              text NOT NULL,
  mobile            text NOT NULL,
  house_no          text NOT NULL DEFAULT '',
  language          text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'te')),
  consent           boolean NOT NULL,
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'assigned', 'resolved', 'rejected')),
  assignee          uuid REFERENCES users(id),
  due_date          date NOT NULL,
  issue_code        text,                              -- when turned into an issue on the work stretch
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES users(id),
  resolution_note   text NOT NULL DEFAULT '',
  resolution_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_ip         text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS grievances_status ON grievances (status, due_date);
CREATE INDEX IF NOT EXISTS grievances_stretch ON grievances (stretch_code);

CREATE TABLE IF NOT EXISTS grievance_events (
  id            bigserial PRIMARY KEY,
  grievance_id  bigint NOT NULL REFERENCES grievances(id),
  at            timestamptz NOT NULL DEFAULT now(),
  by_user       uuid REFERENCES users(id),        -- null = the citizen or the system
  action        text NOT NULL,                     -- received | assigned | resolved | rejected | reopened | to_issue | note
  note          text NOT NULL DEFAULT '',
  public_note   boolean NOT NULL DEFAULT false,    -- shown to the citizen when they check the status
  photos        jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS grievance_events_g ON grievance_events (grievance_id, at);

-- photos sent by citizens (no account): marked so they can be told apart
ALTER TABLE files ADD COLUMN IF NOT EXISTS public_upload boolean NOT NULL DEFAULT false;

-- utilities: points (poles, transformers, trees...) and lines (water mains, cables, road condition...)
CREATE TABLE IF NOT EXISTS utility_features (
  id          bigserial PRIMARY KEY,
  layer       text NOT NULL,
  geom        jsonb NOT NULL,                     -- GeoJSON Point or LineString (EPSG:4326)
  props       jsonb NOT NULL DEFAULT '{}'::jsonb, -- owner, size, material, depth_m, condition, contact, note, ref
  ward        integer,
  admin_zone  text NOT NULL DEFAULT '',
  source      text NOT NULL DEFAULT 'marked' CHECK (source IN ('marked', 'imported')),
  import_id   text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS utility_features_layer ON utility_features (layer) WHERE deleted_at IS NULL;
