-- Daily field record: one entry per work stretch per day, verified by the AEE / DEE.
-- Accepted entries add up into the stretch's status (through the normal status update and its history).
-- Only adds; nothing existing is changed.

CREATE TABLE IF NOT EXISTS daily_logs (
  id             bigserial PRIMARY KEY,
  ulb_id         integer NOT NULL DEFAULT 1 REFERENCES ulbs(id),
  stretch_code   text NOT NULL REFERENCES stretches(code),
  log_date       date NOT NULL,
  quantities     jsonb NOT NULL DEFAULT '{}'::jsonb,
  labour         jsonb NOT NULL DEFAULT '{}'::jsonb,
  machines       jsonb NOT NULL DEFAULT '{}'::jsonb,
  hindrances     jsonb NOT NULL DEFAULT '[]'::jsonb,
  remark         text NOT NULL DEFAULT '',
  photos         jsonb NOT NULL DEFAULT '[]'::jsonb,
  gps            jsonb,
  status         text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'returned')),
  late           boolean NOT NULL DEFAULT false,
  submitted_by   uuid REFERENCES users(id),
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid REFERENCES users(id),
  decided_at     timestamptz,
  decision_note  text NOT NULL DEFAULT '',
  status_note    text NOT NULL DEFAULT '',
  UNIQUE (stretch_code, log_date)
);
CREATE INDEX IF NOT EXISTS daily_logs_ulb_date ON daily_logs (ulb_id, log_date);
CREATE INDEX IF NOT EXISTS daily_logs_status ON daily_logs (ulb_id, status);

-- what happened to each entry (submitted, changed, accepted, returned)
CREATE TABLE IF NOT EXISTS daily_log_events (
  id        bigserial PRIMARY KEY,
  log_id    bigint NOT NULL REFERENCES daily_logs(id),
  at        timestamptz NOT NULL DEFAULT now(),
  by_user   uuid REFERENCES users(id),
  action    text NOT NULL,
  note      text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS daily_log_events_log ON daily_log_events (log_id);
