-- Articola initial schema.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text,
  avatar_url    text,
  -- Onboarding answers and preferences (goals, context, starting point, time budget, themes, feedback tone...).
  preferences   jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarded     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

-- One row per (provider, account). A user can have several (Google + Facebook) once the accounts are
-- explicitly linked from a logged-in session; they are never merged by email.
CREATE TABLE identities (
  provider         text NOT NULL CHECK (provider IN ('google', 'facebook', 'dev')),
  provider_user_id text NOT NULL,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email            text,
  email_verified   boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX identities_user_idx ON identities (user_id);

-- Login sessions. Only a SHA-256 of the cookie token is stored.
CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expires_idx ON auth_sessions (expires_at);

-- A personalised training path, written by the model from the onboarding answers.
-- status: generating -> ready (in use) | failed; archived when replaced by a newer path.
CREATE TABLE paths (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('generating', 'ready', 'failed', 'archived')),
  weeks       int  NOT NULL CHECK (weeks BETWEEN 2 AND 16),
  start_date  date,                       -- set when the user accepts the path
  plan        jsonb,                      -- weeks, routine, structures... (see server/schemas.js)
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paths_user_idx ON paths (user_id, created_at DESC);
-- At most one live (generating or ready) path per user.
CREATE UNIQUE INDEX paths_one_live_idx ON paths (user_id) WHERE status IN ('generating', 'ready');

-- The exercises of one day (tongue twisters, reading passage, improvisation words, structure drill...),
-- generated once and kept so they stay the same across reloads and devices.
CREATE TABLE daily_content (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  path_id    uuid NOT NULL REFERENCES paths (id) ON DELETE CASCADE,
  day_key    date NOT NULL,
  week       int  NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path_id, day_key)
);

-- What the user ticked off on a day: routine steps and the week's real-life challenge.
CREATE TABLE day_progress (
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  path_id        uuid NOT NULL REFERENCES paths (id) ON DELETE CASCADE,
  day_key        date NOT NULL,
  week           int  NOT NULL,
  steps_done     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ids of the routine steps completed
  routine_done   boolean NOT NULL DEFAULT false,
  challenge_done boolean NOT NULL DEFAULT false,
  note           text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path_id, day_key)
);

-- Voice recordings with their transcript, measured metrics, self-assessment and AI evaluation.
-- kind: baseline (the three "point zero" clips), weekly (the Friday recording), practice (any time),
--       final (the three clips redone at the end, compared with the baseline).
CREATE TABLE recordings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  path_id      uuid REFERENCES paths (id) ON DELETE SET NULL,
  week         int,
  kind         text NOT NULL CHECK (kind IN ('baseline', 'weekly', 'practice', 'final')),
  prompt_key   text,                      -- e.g. explain / improv / pitch for baseline+final clips
  prompt       text NOT NULL,
  duration_sec real NOT NULL CHECK (duration_sec > 0 AND duration_sec <= 900),
  audio        bytea,
  audio_mime   text,
  audio_bytes  int NOT NULL DEFAULT 0,
  transcript   text,
  metrics      jsonb NOT NULL DEFAULT '{}'::jsonb,
  self_scores  jsonb,
  evaluation   jsonb,
  eval_status  text NOT NULL DEFAULT 'none' CHECK (eval_status IN ('none', 'pending', 'done', 'failed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recordings_user_idx ON recordings (user_id, created_at DESC);

-- AI-written reading of the user's progress, cached until a new recording arrives.
CREATE TABLE insights (
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  path_id      uuid NOT NULL REFERENCES paths (id) ON DELETE CASCADE,
  recordings_n int  NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path_id)
);
