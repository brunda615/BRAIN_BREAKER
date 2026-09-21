# 🧠 Brain Breaker — Project Progress Tracker & Developer Guide

> **Purpose:** If the AI session ends mid-work or switches to another model, read this file first.
> It contains the complete system architecture, database schema, API contracts, verified test results,
> configuration flags, and the exact roadmap for Level 3.
>
> **Last updated:** 2026-09-22 02:42 IST  
> **Status:** Level 1 & Level 2 Complete & Verified | Ready for Level 3 Specification  
> **Stack:** Python stdlib HTTP server (`server.py`) + Supabase REST + HTML5 Canvas + Vanilla JS + Tailwind CSS

---

## 📌 Supabase Credentials & Configuration

| Field | Value |
|---|---|
| Dashboard URL | `https://supabase.com/dashboard/project/loebniiqdwyzwecbbvjl/` |
| REST API URL | `https://loebniiqdwyzwecbbvjl.supabase.co` |
| Anon Key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvZWJuaWlxZHd5endlY2JidmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTM0MTAsImV4cCI6MjEwNTU4OTQxMH0.0iS7_5W7l6CXVOyd8XZsOI8RWFPtUPQC9nOCceSwKNw` |
| DB Connection String | `postgresql://postgres:xBb2MkNKASn34ukp@db.loebniiqdwyzwecbbvjl.supabase.co:5432/postgres` |
| Admin Passcode | `BMS123` (override with `ADMIN_PASSWORD` env var) |
| Server Port | `8000` (override with `PORT` env var) |
| Ticket Hit Rate | Configurable live from Admin Portal (persisted in Supabase `game_settings`) |
| Env File | `.env` in root directory (template in `.env.example`) |

---

## 🗄️ Database Schema (`supabase_setup.sql` — ACTIVE & VERIFIED)

### 1. `teams` table
```sql
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  avatar TEXT NOT NULL DEFAULT '🚀',
  current_level INT NOT NULL DEFAULT 1,
  session_token TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active TIMESTAMPTZ DEFAULT now()
);
```

### 2. `team_state` table
Stores state per team per level (`CONSTRAINT uq_team_level UNIQUE (team_id, level)`):
- **Level 1**: `ticket`, `ticket_numbers`, `numbers_hit`, `numbers_collected`, `questions_solved`, `questions_skipped`.
- **Level 2**: `questions_solved` stores maze attempts/round, `numbers_collected` stores `[{"elapsed_ms": ..., "round": ..., "completed": bool}]`, `is_winner`, `won_at`.
- **Level 3**: Pre-initialized row created when advancing to Level 3.

---

## ✅ Completed & Verified Work

### Phase 1 — Discovery & Architecture
- [x] Full codebase audit (`server.py`, `questions.csv`, `index.html`, `admin.html`).
- [x] Authentic Indian 90-ball Tambola generator (3×9 grid, 5 per row, 15 total, proper column tens-ranges: 1–9, 10–19, ..., 80–90).
- [x] Python stdlib PostgREST integration via `urllib.request` (zero external dependencies).
- [x] SSE event streaming pipeline (`/api/events`) for instant real-time admin sync.

### Phase 2 — Supabase & Credential Auth
- [x] `supabase_setup.sql` created and executed in Supabase.
- [x] `POST /api/login`: credential-based login issuing 64-char session token saved in `localStorage`.
- [x] Cross-device persistence: players can switch laptops/browsers and log in with username/password without losing state.
- [x] `POST /api/admin/login`: separate admin authentication (`BMS123`).
- [x] `POST /api/admin/create-team`: admin registers teams with name, username, password, avatar emoji, theme color.

### Phase 3 — Gameplay & Level 1 (Tambola Puzzle)
- [x] Dynamic question loading from `questions.csv` with automatic file modification hot-reload.
- [x] Case/space-insensitive answer validation with multi-alias support (`answer1;answer2`).
- [x] Unique number award 1–90 on correct answer + green ticket stamping.
- [x] Skip button with skip tracking.
- [x] Full House win condition: 15 hits triggers winner fanfare modal, auto-promotes team to Level 2.

### Phase 4 — Admin Controls & Dynamic Anti-Cheat
- [x] **Anti-Cheat Toggle**:
  - OFF by default: players can switch tabs, minimize windows, and right-click freely.
  - Admin toggle in `admin.html` calling `POST /api/admin/set-anticheat`.
  - Live SSE broadcast (`anticheat_changed`).
  - When enabled, tab-switches and fullscreen exits trigger lockout overlay and increment violation counters.
- [x] **Manual Level Management**:
  - Admin can promote/demote teams between Level 1, 2, and 3 via standings table buttons (`Advance L2`, `Advance L3`, `Demote L1`, `Demote L2`).
  - `POST /api/admin/set-team-level` updates Supabase, pre-creates state, and fires `team_level_changed` SSE.

### Phase 5 — Level 2 (Stage 02 — Fog Maze Run & Color Riddle)
- [x] **Pure Vanilla JS Engine** ([`public/maze.js`](file:///home/akshatbaranwal/codes/Websites/brain_breaker_gradient/BRAIN_BREAKER/public/maze.js)):
  - Zero React/Vite dependencies; ported directly from `/stage2`.
  - Randomised DFS perfect carve (`27×17` grid, 100% solvable, no loops).
  - 4 keys dropped in distant dead ends (`RED`, `BLUE`, `GREEN`, `YELLOW`).
  - **Persistent Team Key Color**: Each team has a fixed designated key color (e.g., BLUE). When reaching START after a wrong key, the maze layout and key locations re-randomize, but the team's assigned authentic key color remains persistent!
  - BFS guaranteed return-path calculation from wrong-key location back to START.
  - Smooth continuous player interpolation (`8.6 cells/sec`, `t: 0..1`), WASD + Arrow Keys input buffering.
  - Dual-canvas Fog of War lighting mask (radial gradient light halo around player, faint memory pass for visited cells).
  - Glowing wall strokes, pulsating start pad, animated bobbing keys with color glows, red directional barriers in `RETURN_TO_START` mode.
  - Dev mode cheat (`Ctrl + Shift + D`) to toggle full maze reveal.
- [x] **Player Interface & Color Riddle Challenge** ([`public/index.html`](file:///home/akshatbaranwal/codes/Websites/brain_breaker_gradient/BRAIN_BREAKER/public/index.html)):
  - **Color Riddle Challenge**: At the beginning of Stage 02, teams receive a custom riddle describing their assigned key color.
  - **Dual Mode Entry**:
    - *Solved Riddle*: Team solves the riddle, locks their color, and the HUD directs them directly to that key (e.g. `🎯 Objective: Find the BLUE key`).
    - *Skip Riddle (Brute Force)*: Team can skip the riddle and enter immediately. They must test keys blindly by brute-force!
  - **In-Game Riddle Clue Drawer**: Teams who skipped can click the `📜 Riddle Clue` button in the top HUD at any time to view or solve the riddle (pure riddle text with zero spoiler clues).
  - **Immersive Fullscreen Experience**:
    - Automatic fullscreen activation upon clicking "Enter the Maze".
    - Click anywhere on the maze canvas to instantly expand to edge-to-edge full screen!
    - Dedicated `⛶ Fullscreen` toggle button in top HUD + `Escape` key support to exit.
    - Full-bleed CSS + browser fullscreen removes all margins and header distractions, scaling up the maze grid by >2.3×!
  - Top HUD: Round counter (`01`, `02`...), live persistent timer (`MM:SS` starts counting up immediately upon landing on Round 2 screen), Fullscreen toggle, and Riddle Clue drawer.
  - **Curated Typography**: Enigmatic `Cinzel` for cipher titles, modern `Space Grotesk` for riddle clues, `Outfit` for display headings, and `JetBrains Mono` for terminals/code.
  - Dynamic `ObjectiveBar` with pulse indicators (Objective / Wrong Key / Complete).
  - `SuccessOverlay` on authentic key verification displaying final stage time.
  - Auto-advance to Level 3 screen (`viewLevel3`: "STAGE 02 MASTERED! LEVEL 3 — FINAL ARENA").
- [x] **Backend & Supabase Sync** ([`server.py`](file:///home/akshatbaranwal/codes/Websites/brain_breaker_gradient/BRAIN_BREAKER/server.py)):
  - `MAZE_COLOR_RIDDLES`: 4 distinct, immersive riddles for RED, BLUE, GREEN, and YELLOW.
  - `get_team_assigned_key_color(team)`: Deterministic hashing guarantees the team receives the same color across sessions and reloads.
  - `POST /api/level2/solve-riddle`: Optional server endpoint validating riddle answers.
  - `POST /api/level2/sync`: Periodic 8s state sync saving elapsed time & round in `team_state`.
  - `POST /api/level2/complete`: Records victory in `team_state`, sets `is_winner = true`, advances `current_level = 3`, broadcasts `team_progress` and `team_level_changed` via SSE.
- [x] **Admin Standings Integration** ([`public/admin.html`](file:///home/akshatbaranwal/codes/Websites/brain_breaker_gradient/BRAIN_BREAKER/public/admin.html)):
  - Displays Level 1, 2, and 3 badges (`⚡ L1`, `🌀 L2`, `🏆 L3`).
  - Shows Level 2 elapsed time, round attempts, and `MAZE ✓` badge.
  - **Cross-Level State Aggregation**: When teams advance to Level 2 or 3, their Level 1 ticket, numbers hit (e.g. 15/15), and solved count remain permanently aggregated and accessible in Admin standings and the Inspect modal.
  - Admin action buttons: `Advance L2`, `Advance L3`, `Demote L1`, `Demote L2`.

### Phase 6 — Verification & Testing
- [x] 10/10 Core system tests passed.
- [x] Level 2 Maze Run integration tests passed 100%:
  - Admin set Level 2 — PASS
  - Sync Level 2 progress (`/api/level2/sync`) — PASS
  - State retrieval verification (`/api/state`) — PASS
  - Complete Level 2 (`/api/level2/complete`) — PASS
  - Auto-promote to Level 3 — PASS
  - Admin standings verification (`/api/admin/teams`) — PASS
  - Reset & cleanup — PASS
- [x] Engine lifecycle & algorithmic verification passed in Node.js test runner.
- [x] Script syntax verification passed for both `index.html` and `admin.html`.

---

## 🌐 API Reference Cheat Sheet

| Method | Route | Body / Params | Description |
|---|---|---|---|
| `POST` | `/api/login` | `{"username", "password"}` | Authenticates team, returns `{token, ...state}` |
| `GET` | `/api/state?token=...` | `token` query param or Bearer header | Returns team profile, ticket, level, puzzle, maze state |
| `POST` | `/api/submit-answer` | `{"token", "answer"}` | Level 1: Submits answer, awards number 1–90 |
| `POST` | `/api/skip-puzzle` | `{"token"}` | Level 1: Skips question, advances cursor |
| `POST` | `/api/tab-violation` | `{"token"}` | Records violation (only active when anti-cheat ON) |
| `POST` | `/api/level2/sync` | `{"token", "elapsed_ms", "round"}` | Level 2: Periodic checkpoint sync |
| `POST` | `/api/level2/complete` | `{"token", "elapsed_ms", "round"}` | Level 2: Victory submission, unlocks Level 3 |
| `GET` | `/api/events` | SSE connection | Real-time push stream to clients |
| `POST` | `/api/admin/login` | `{"password"}` | Verifies admin password (`BMS123`) |
| `GET` | `/api/admin/teams?passcode=...` | `passcode=BMS123` | Full list of teams, scores, tickets, maze stats, levels |
| `POST` | `/api/admin/create-team` | `{"passcode", "team_name", "username", "password", "avatar", "color"}` | Registers team in Supabase |
| `POST` | `/api/admin/set-anticheat` | `{"passcode", "enabled": bool}` | Toggles global anti-cheat enforcement |
| `POST` | `/api/admin/set-team-level` | `{"passcode", "team_name", "level": 1\|2\|3}` | Promotes or demotes team level |
| `POST` | `/api/admin/broadcast` | `{"passcode", "message"}` | Pushes global announcement |
| `POST` | `/api/admin/end-game` | `{"passcode", "ended": bool}` | Locks or unlocks the game arena |
| `POST` | `/api/admin/remove-team` | `{"passcode", "team_name", "removed": bool}` | Disqualifies/re-enables a team |
| `POST` | `/api/admin/reset` | `{"passcode", "team_name" (optional)}` | Clears progress for one or all teams |

### Phase 7 — Level 3 (Stage 03 — Git Secret & Morse Code Cipher)
- [x] **Gameplay Flow & Mechanics**:
  - **Challenge Briefing**: Teams are directed to inspect an apparently empty GitHub repository.
  - **Git Forensics**: Teams use `git log` / commit history to find a deleted file containing a confidential link.
  - **Audio Transmission**: Link opens a Morse code audio broadcast file.
  - **Built-in Morse Code Decoder** ([`public/index.html`](file:///home/akshatbaranwal/codes/Websites/brain_breaker_gradient/BRAIN_BREAKER/public/index.html)):
    - Dual input methods: keyboard typing or interactive on-screen buttons (`• DOT`, `— DASH`, `SPACE [Letter]`, `/ [Word]`, `CLEAR`).
    - Web Audio API tone synthesizer (650Hz audio previews for dots and dashes).
    - Real-time instant English translation preview with copy-to-clipboard button.
    - Full International Morse Alphabet & Digits lookup cheat sheet collapsible drawer.
  - **Victory Condition**: Team shouts out the decoded secret phrase aloud to event organizers to claim first place.
- [x] **Admin Portal Real-Time Notification & Tracking** ([`public/admin.html`](file:///home/akshatbaranwal/codes/Websites/brain_breaker_gradient/BRAIN_BREAKER/public/admin.html)):
  - **SSE Alert Toast**: Instant high-visibility popup (`showRound3Toast`) appears on the admin screen the millisecond any team beats Round 2 / enters Round 3.
  - **Key Metrics Card**: Added "In Round 3" (`adminRound3Count`) counter displaying total finalists.
  - **Standings Table**: Finalists highlighted with glowing `ROUND 3 (FINAL) 🔥` badge.
  - **Admin Control**: Staff can advance or demote teams (`Advance L3`, `Demote L2`) directly from the table.
- [x] **Backend & Database**:
  - Auto-promotion on Level 2 complete (`current_level = 3`).
  - Pre-initialization of Level 3 state in Supabase `team_state`.
  - SSE broadcasts `team_progress` and `team_level_changed` with `level: 3`.

---

## 🎮 Level Roadmap

| Level | Name | Mechanic | Status |
|---|---|---|---|
| **Level 1** | Tambola Puzzle | Aptitude/coding puzzles → award 1–90 → stamp 3×9 ticket → Full House | ✅ 100% Complete & Tested |
| **Level 2** | Fog Maze Run | Perfect DFS maze → radial fog of war → find authentic key → return on wrong key | ✅ 100% Complete & Tested |
| **Level 3** | The Final Challenge | Clean GitHub Repo card (`AkshatOP/gradient_l3`) with 1-click clone copy; zero spoilers, participants investigate on their own | ✅ 100% Complete & Tested |

---

## 🏁 How to Run the Entire Application

1. Start server:
   ```bash
   python server.py
   ```
2. Open Player Portal: `http://localhost:8000`
3. Open Admin Portal: `http://localhost:8000/admin` (Passcode: `BMS123`)
4. Create teams in the Admin Portal or use pre-existing credentials.
5. All progress across Levels 1, 2, and 3 is persisted in Supabase in real time!
