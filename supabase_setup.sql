-- ============================================================
-- Brain Breaker — Supabase Database Setup
-- Run this ONCE in: https://supabase.com/dashboard/project/loebniiqdwyzwecbbvjl/sql
-- ============================================================

-- 1. Drop existing tables (safe to re-run)
DROP TABLE IF EXISTS team_state CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS game_settings CASCADE;

-- 2. Teams — credentials + metadata
CREATE TABLE teams (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_name     TEXT NOT NULL,
    username      TEXT UNIQUE NOT NULL,
    password      TEXT NOT NULL,
    color         TEXT NOT NULL DEFAULT '#3b82f6',
    avatar        TEXT NOT NULL DEFAULT '🚀',
    current_level INTEGER NOT NULL DEFAULT 1,
    session_token TEXT UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Team state — per team per level
CREATE TABLE team_state (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id                 UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    level                   INTEGER NOT NULL DEFAULT 1,
    ticket                  JSONB NOT NULL DEFAULT '[]',
    ticket_numbers          JSONB NOT NULL DEFAULT '[]',
    numbers_hit             JSONB NOT NULL DEFAULT '[]',
    numbers_collected       JSONB NOT NULL DEFAULT '[]',
    questions_solved        INTEGER NOT NULL DEFAULT 0,
    questions_skipped       INTEGER NOT NULL DEFAULT 0,
    current_question_cursor INTEGER NOT NULL DEFAULT 0,
    question_order          JSONB NOT NULL DEFAULT '[]',
    is_winner               BOOLEAN NOT NULL DEFAULT FALSE,
    won_at                  TIMESTAMPTZ,
    tab_switch_count        INTEGER NOT NULL DEFAULT 0,
    removed                 BOOLEAN NOT NULL DEFAULT FALSE,
    last_active             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, level)
);

-- 4. Game settings (game_ended flag, etc.)
CREATE TABLE game_settings (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
);
INSERT INTO game_settings (key, value) VALUES ('game_ended', 'false');

-- 5. Performance indexes
CREATE INDEX idx_teams_username   ON teams(username);
CREATE INDEX idx_teams_token      ON teams(session_token) WHERE session_token IS NOT NULL;
CREATE INDEX idx_state_team_id    ON team_state(team_id);
CREATE INDEX idx_state_team_level ON team_state(team_id, level);

-- 6. Disable Row Level Security (Python server handles all auth)
ALTER TABLE teams         DISABLE ROW LEVEL SECURITY;
ALTER TABLE team_state    DISABLE ROW LEVEL SECURITY;
ALTER TABLE game_settings DISABLE ROW LEVEL SECURITY;

-- 7. Grant full access to anon role (required for REST API with anon key)
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL PRIVILEGES ON TABLE teams         TO anon;
GRANT ALL PRIVILEGES ON TABLE team_state    TO anon;
GRANT ALL PRIVILEGES ON TABLE game_settings TO anon;

-- Done!
SELECT 'Brain Breaker DB setup complete!' AS status;
