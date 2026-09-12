-- Keep machine proposals separate from human labels and dataset exports.
CREATE TABLE IF NOT EXISTS pose_tracking_runs (
  id uuid PRIMARY KEY,
  bout_id uuid NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pose_tracking_runs_bout_index ON pose_tracking_runs (bout_id, created_at DESC);
ALTER TABLE pose_keyframes ADD COLUMN IF NOT EXISTS provenance jsonb;
-- Preserve every previous human correction, including before an upsert.
CREATE TABLE IF NOT EXISTS pose_label_history (
  id bigserial PRIMARY KEY,
  pose_id uuid NOT NULL,
  bout_id uuid NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION retain_pose_label_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO pose_label_history(pose_id,bout_id,payload) VALUES(OLD.id,OLD.bout_id,to_jsonb(OLD));
  END IF;
  INSERT INTO pose_label_history(pose_id,bout_id,payload) VALUES(NEW.id,NEW.bout_id,to_jsonb(NEW));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pose_label_history_trigger ON pose_keyframes;
CREATE TRIGGER pose_label_history_trigger AFTER INSERT OR UPDATE ON pose_keyframes
FOR EACH ROW EXECUTE FUNCTION retain_pose_label_history();
