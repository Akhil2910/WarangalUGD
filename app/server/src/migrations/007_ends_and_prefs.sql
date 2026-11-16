-- 007: start and end point of each work stretch ({code, lat, lon}; filled from the first and last manhole, editable),
-- and each person's own preferences (map layer colours, widths and line types). Additive only.
ALTER TABLE stretches ADD COLUMN IF NOT EXISTS start_point jsonb;
ALTER TABLE stretches ADD COLUMN IF NOT EXISTS end_point jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
