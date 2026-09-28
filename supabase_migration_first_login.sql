-- Brain Breaker: add the game-clock start time to an existing database.
-- Safe to run on a live database: it keeps all teams and progress.
-- Run once in the Supabase SQL editor.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMPTZ;

SELECT 'first_login_at column ready' AS status;
