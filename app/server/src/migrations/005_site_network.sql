-- 005: the site network: manholes and pipelines drawn on the satellite image by AEE/DEE, independent of the DPR.
-- Work/Road stretches made from site pipelines are ordinary rows in `stretches` (source = 'site'), so status,
-- compliance, issues, history and work stretches all apply to them unchanged. Additive only.

ALTER TABLE stretches ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'dpr';
CREATE INDEX IF NOT EXISTS stretches_source ON stretches (source);

CREATE SEQUENCE IF NOT EXISTS site_mh_seq;
CREATE SEQUENCE IF NOT EXISTS site_pipe_seq;
CREATE SEQUENCE IF NOT EXISTS site_stretch_seq;

CREATE TABLE IF NOT EXISTS site_manholes (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL,                 -- the number staff give it (unique among live manholes)
  lon         double precision NOT NULL,
  lat         double precision NOT NULL,
  ward        integer NOT NULL,
  admin_zone  text NOT NULL,
  outside_ward boolean NOT NULL DEFAULT false, -- placed outside every ward: given the nearest ward and flagged
  depth_m     double precision,
  invert_m    double precision,
  note        text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS site_manholes_code ON site_manholes (lower(code)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS site_pipes (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,          -- SP-000001
  from_mh     bigint NOT NULL REFERENCES site_manholes(id),
  to_mh       bigint NOT NULL REFERENCES site_manholes(id),
  dia_mm      integer NOT NULL,
  material    text NOT NULL DEFAULT '',
  length_m    double precision NOT NULL,
  ward        integer NOT NULL,
  admin_zone  text NOT NULL,
  note        text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS site_pipes_ends ON site_pipes (from_mh, to_mh);

CREATE TABLE IF NOT EXISTS site_events (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  by_user   uuid REFERENCES users(id),
  action    text NOT NULL,   -- manhole_added | manhole_edited | manhole_moved | manhole_deleted | pipe_added | pipe_deleted | stretch_created | stretch_pipes
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb
);
