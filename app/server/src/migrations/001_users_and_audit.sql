-- 001: user accounts, starting-account register, sign-in attempts, audit log.

CREATE TABLE IF NOT EXISTS users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                text NOT NULL,
  name                 text NOT NULL,
  designation          text NOT NULL DEFAULT '',
  phone                text NOT NULL DEFAULT '',
  role                 text NOT NULL CHECK (role IN ('contracting_assistant','field_inspector','aee','dee','commissioner','viewer')),
  supervisor           boolean NOT NULL DEFAULT false,
  active               boolean NOT NULL DEFAULT true,
  -- areas of responsibility: {"admin_zones": [...], "wards": [...], "packages": [...]}; empty = none
  areas                jsonb NOT NULL DEFAULT '{}'::jsonb,
  password_hash        text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  session_version      integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));

-- Starting accounts from a release file are created by key, once.
CREATE TABLE IF NOT EXISTS seeded_accounts (
  seed_key   text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
  id      bigserial PRIMARY KEY,
  email   text NOT NULL,
  ip      text NOT NULL,
  ok      boolean NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sign_in_attempts_lookup ON sign_in_attempts (lower(email), ip, at);

CREATE TABLE IF NOT EXISTS audit_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  actor   uuid REFERENCES users(id),
  action  text NOT NULL,
  detail  jsonb NOT NULL DEFAULT '{}'::jsonb
);
