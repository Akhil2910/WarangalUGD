-- 006 (16 Nov 2026, at the user's request): the DPR road stretches are no longer used. Work stretches are now made
-- from DPR pipes and/or pipes drawn on the image. Nothing is deleted: rows are only marked hidden.
-- The trial work recorded while testing (work stretch groups, the drawn trial network) is hidden too.

ALTER TABLE stretches ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE work_groups ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE site_manholes ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
ALTER TABLE site_pipes ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
-- a drawn pipeline may start or end on a DPR manhole: the site manhole then carries that DPR manhole's code
ALTER TABLE site_manholes ADD COLUMN IF NOT EXISTS dpr_mh text;

-- the pipe links of hidden stretches are kept here, so the DPR pipes are free for new work stretches
CREATE TABLE IF NOT EXISTS stretch_pipes_hidden (
  pipe_id      text NOT NULL,
  stretch_code text NOT NULL,
  hidden_at    timestamptz NOT NULL DEFAULT now()
);

UPDATE stretches SET hidden = true WHERE source = 'dpr' OR source = 'site';
UPDATE work_groups SET hidden = true;
UPDATE site_manholes SET hidden = true;
UPDATE site_pipes SET hidden = true;
INSERT INTO stretch_pipes_hidden (pipe_id, stretch_code)
  SELECT sp.pipe_id, sp.stretch_code FROM stretch_pipes sp JOIN stretches s ON s.code = sp.stretch_code WHERE s.hidden;
DELETE FROM stretch_pipes WHERE stretch_code IN (SELECT code FROM stretches WHERE hidden);
CREATE INDEX IF NOT EXISTS stretches_hidden ON stretches (hidden);
