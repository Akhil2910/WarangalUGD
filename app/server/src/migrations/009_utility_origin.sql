-- Utilities: keep where the data came from (survey references, video frames) out of what people see.
-- Nothing is lost: those fields move to a separate column that is never sent to the screen.
ALTER TABLE utility_features ADD COLUMN IF NOT EXISTS origin jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE utility_features
SET origin = origin || jsonb_strip_nulls(jsonb_build_object(
      'ref', props->'ref', 'survey_status', props->'survey_status', 'detected_by', props->'detected_by',
      'confidence', props->'confidence', 'video', props->'video', 'frame_image', props->'frame_image',
      'osm_road', props->'osm_road', 'survey_ward', props->'survey_ward', 'side', props->'side',
      'offset_m', props->'offset_m', 'alerts', props->'alerts')),
    props = props - 'ref' - 'survey_status' - 'detected_by' - 'confidence' - 'video' - 'frame_image'
                  - 'osm_road' - 'survey_ward' - 'side' - 'offset_m' - 'alerts'
WHERE props ?| array['ref', 'survey_status', 'detected_by', 'confidence', 'video', 'frame_image', 'osm_road', 'survey_ward', 'side', 'offset_m', 'alerts'];
