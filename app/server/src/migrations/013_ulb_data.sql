-- 013: every record belongs to a ULB. Existing records belong to GWMC (ULB 1); nothing else changes.
-- Child tables (history, events, links, compliance records) follow their parent record.
ALTER TABLE stretches         ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE issues            ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE grievances        ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE files             ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE site_manholes     ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE site_pipes        ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE work_groups       ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE utility_features  ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE compliance_items  ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE project_items     ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE project_records   ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE project_events    ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);
ALTER TABLE audit_log         ADD COLUMN IF NOT EXISTS ulb_id integer NOT NULL DEFAULT 1 REFERENCES ulbs(id);

-- one project settings row per ULB (the row id is the ULB id)
ALTER TABLE project_settings  DROP CONSTRAINT IF EXISTS project_settings_id_check;
ALTER TABLE project_settings  ADD COLUMN IF NOT EXISTS ulb_id integer REFERENCES ulbs(id);
UPDATE project_settings SET ulb_id = id WHERE ulb_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_settings_ulb ON project_settings (ulb_id);

CREATE INDEX IF NOT EXISTS stretches_ulb ON stretches (ulb_id);
CREATE INDEX IF NOT EXISTS issues_ulb ON issues (ulb_id);
CREATE INDEX IF NOT EXISTS grievances_ulb ON grievances (ulb_id);
CREATE INDEX IF NOT EXISTS site_manholes_ulb ON site_manholes (ulb_id);
CREATE INDEX IF NOT EXISTS site_pipes_ulb ON site_pipes (ulb_id);
CREATE INDEX IF NOT EXISTS utility_features_ulb ON utility_features (ulb_id);
CREATE INDEX IF NOT EXISTS compliance_items_ulb ON compliance_items (ulb_id);
CREATE INDEX IF NOT EXISTS project_items_ulb ON project_items (ulb_id);
CREATE INDEX IF NOT EXISTS audit_log_ulb ON audit_log (ulb_id);

-- manhole numbers typed at site only need to be unique inside one ULB
DROP INDEX IF EXISTS site_manholes_code;
CREATE UNIQUE INDEX IF NOT EXISTS site_manholes_ulb_code ON site_manholes (ulb_id, lower(code)) WHERE deleted_at IS NULL;
