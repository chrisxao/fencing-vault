CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fencers (
  id uuid PRIMARY KEY,
  full_name text NOT NULL,
  country_code varchar(3) NOT NULL DEFAULT '',
  dominant_hand text NOT NULL DEFAULT 'unknown' CHECK (dominant_hand IN ('left', 'right', 'unknown')),
  fie_id text NOT NULL DEFAULT '',
  usa_fencing_id text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fencers_fie_id_unique ON fencers (fie_id) WHERE fie_id <> '';
CREATE INDEX IF NOT EXISTS fencers_name_index ON fencers (lower(full_name));

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  country_code varchar(3) NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'national' CHECK (kind IN ('national', 'club', 'school', 'other')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_memberships (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  fencer_id uuid NOT NULL REFERENCES fencers(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  started_on date,
  ended_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, fencer_id, started_on)
);

CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  starts_on date,
  ends_on date,
  location text NOT NULL DEFAULT '',
  source_provider text NOT NULL DEFAULT 'manual',
  source_url text,
  external_key text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('upcoming', 'live', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tournaments_external_key_unique ON tournaments (external_key) WHERE external_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS bouts (
  id uuid PRIMARY KEY,
  tournament_id uuid REFERENCES tournaments(id) ON DELETE SET NULL,
  title text NOT NULL,
  weapon text NOT NULL DEFAULT 'sabre' CHECK (weapon = 'sabre'),
  round text NOT NULL DEFAULT '',
  tournament_date date,
  left_fencer_id uuid REFERENCES fencers(id) ON DELETE SET NULL,
  right_fencer_id uuid REFERENCES fencers(id) ON DELETE SET NULL,
  source_provider text NOT NULL DEFAULT 'upload' CHECK (source_provider IN ('upload', 'fencingtv', 'youtube', 'screen-recording', 'other')),
  source_url text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ready', 'labeling', 'reviewed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (left_fencer_id IS NULL OR right_fencer_id IS NULL OR left_fencer_id <> right_fencer_id)
);
CREATE INDEX IF NOT EXISTS bouts_left_fencer_index ON bouts (left_fencer_id);
CREATE INDEX IF NOT EXISTS bouts_right_fencer_index ON bouts (right_fencer_id);
CREATE INDEX IF NOT EXISTS bouts_date_index ON bouts (tournament_date DESC);

CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY,
  bout_id uuid NOT NULL UNIQUE REFERENCES bouts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('uploaded', 'external', 'screen-recording')),
  object_key text,
  external_url text,
  filename text NOT NULL DEFAULT '',
  mime_type text NOT NULL DEFAULT 'video/mp4',
  size_bytes bigint,
  checksum text,
  duration_ms integer,
  fps double precision,
  width integer,
  height integer,
  frame_count integer,
  exact_pts_key text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (object_key IS NOT NULL OR external_url IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS media_object_key_unique ON media_assets (object_key) WHERE object_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS action_definitions (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('preparation', 'footwork', 'blade', 'attack', 'defense', 'priority', 'hit', 'referee', 'violation')),
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS phrases (
  id uuid PRIMARY KEY,
  bout_id uuid NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer NOT NULL CHECK (end_ms > start_ms),
  start_frame integer,
  end_frame integer,
  start_reason text NOT NULL,
  end_reason text NOT NULL,
  halt_reason text NOT NULL DEFAULT '',
  award text NOT NULL DEFAULT 'unknown' CHECK (award IN ('left', 'right', 'none', 'unknown')),
  call_status text NOT NULL DEFAULT 'not-called',
  call_explanation text NOT NULL DEFAULT '',
  rule_refs text[] NOT NULL DEFAULT '{}',
  review_state text NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft', 'reviewed', 'adjudicated')),
  left_score_before integer NOT NULL DEFAULT 0,
  right_score_before integer NOT NULL DEFAULT 0,
  left_score_after integer NOT NULL DEFAULT 0,
  right_score_after integer NOT NULL DEFAULT 0,
  ruleset_id text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bout_id, ordinal)
);
CREATE INDEX IF NOT EXISTS phrases_bout_time_index ON phrases (bout_id, start_ms);

CREATE TABLE IF NOT EXISTS phrase_events (
  id uuid PRIMARY KEY,
  phrase_id uuid NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
  timestamp_ms integer NOT NULL CHECK (timestamp_ms >= 0),
  frame_number integer,
  kind text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('left', 'right', 'both', 'referee', 'apparatus')),
  action_id uuid REFERENCES action_definitions(id) ON DELETE SET NULL,
  action_label text NOT NULL,
  priority_before text NOT NULL DEFAULT 'unclear',
  priority_after text NOT NULL DEFAULT 'unclear',
  evidence text NOT NULL DEFAULT '',
  rule_refs text[] NOT NULL DEFAULT '{}',
  confidence double precision,
  source text NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'model', 'imported')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phrase_events_timeline_index ON phrase_events (phrase_id, timestamp_ms);

CREATE TABLE IF NOT EXISTS pose_keyframes (
  id uuid PRIMARY KEY,
  bout_id uuid NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  timestamp_ms integer NOT NULL CHECK (timestamp_ms >= 0),
  frame_number integer,
  side text NOT NULL CHECK (side IN ('left', 'right')),
  track_id text NOT NULL,
  keypoints jsonb NOT NULL,
  weapon jsonb NOT NULL,
  bbox jsonb,
  front_foot_meters double precision,
  rear_foot_meters double precision,
  opponent_distance_meters double precision,
  occluded boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'model', 'corrected-model')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bout_id, frame_number, side, track_id)
);
CREATE INDEX IF NOT EXISTS pose_keyframes_bout_time_index ON pose_keyframes (bout_id, timestamp_ms);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  external_key text NOT NULL,
  source_url text NOT NULL,
  capture_mode text NOT NULL,
  state text NOT NULL DEFAULT 'discovered' CHECK (state IN ('discovered', 'capturing', 'uploading', 'ready', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}',
  checkpoint jsonb NOT NULL DEFAULT '{}',
  error text NOT NULL DEFAULT '',
  bout_id uuid REFERENCES bouts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_key)
);

CREATE TABLE IF NOT EXISTS rule_sources (
  id text PRIMARY KEY,
  authority text NOT NULL,
  title text NOT NULL,
  edition text NOT NULL,
  published_at date NOT NULL,
  url text NOT NULL,
  checksum text,
  checked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS rule_passages (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES rule_sources(id) ON DELETE CASCADE,
  refs text[] NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  evidence jsonb NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(summary, ''))
  ) STORED
);
CREATE INDEX IF NOT EXISTS rule_passages_search_index ON rule_passages USING gin (search_vector);

CREATE TABLE IF NOT EXISTS annotation_revisions (
  id uuid PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('phrase', 'event', 'pose')),
  entity_id uuid NOT NULL,
  revision integer NOT NULL,
  payload jsonb NOT NULL,
  actor text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, revision)
);

CREATE TABLE IF NOT EXISTS dataset_exports (
  id uuid PRIMARY KEY,
  version text NOT NULL UNIQUE,
  ruleset_id text NOT NULL,
  manifest jsonb NOT NULL,
  object_key text,
  checksum text,
  phrase_count integer NOT NULL,
  event_count integer NOT NULL,
  pose_keyframe_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_runs (
  id uuid PRIMARY KEY,
  task text NOT NULL,
  model_name text NOT NULL,
  model_version text NOT NULL,
  dataset_export_id uuid REFERENCES dataset_exports(id) ON DELETE RESTRICT,
  config jsonb NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('queued', 'running', 'evaluating', 'completed', 'failed')),
  artifact_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_entity_index ON audit_events (entity_type, entity_id, created_at DESC);
