# 🧠 Brain Breaker

A multi-level competitive puzzle game for teams, themed around **Indian Tambola (Housie)**.  
Teams solve aptitude, coding, math, reasoning, and riddle puzzles to earn random numbers (1–90).  
Every correct answer awards a number — if it matches a cell on their 3×9 Tambola ticket, it gets stamped green.  
**First team to fill all 15 ticket cells wins Full House and unlocks the next level!**

---

## 🗂️ Project Structure

```
BRAIN_BREAKER/
├── server.py            # Python HTTP server (no frameworks) + Supabase REST integration
├── questions.csv        # 60 questions: Coding, Aptitude, Math, Reasoning, Riddles
├── supabase_setup.sql   # Run once in Supabase SQL editor to create the schema
├── requirements.txt     # No external deps — pure stdlib + Supabase REST
└── public/
    ├── index.html       # Player frontend (Team login, Tambola game, Level routing)
    └── admin.html       # Admin control center (Create teams, live standings, controls)
```

---

## 🏗️ Architecture

```
Browser (Teams)          Browser (Admin)
     │                        │
     └──── HTTP ────┬─── HTTP ─┘
                    │
              server.py  (Python, port 8000)
                    │
              Supabase REST API
                    │
         ┌──────────┴──────────┐
      teams table         team_state table
   (credentials,         (ticket, progress,
    current_level)        per team per level)
```

### Key Design Decisions
- **No external Python libs** — uses only stdlib (`urllib`, `csv`, `http.server`, etc.)
- **Supabase as DB** — persistent state survives server restarts; teams can switch computers
- **Token-based auth** — admin creates teams with username/password; server issues session tokens on login
- **SSE** — real-time admin dashboard updates (team_progress, violations, broadcasts)
- **Level-aware state** — each team has independent state per level (ticket, questions, progress)

---

## 🗄️ Database Schema (Supabase)

### `teams` table
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | auto-generated |
| `team_name` | TEXT | display name |
| `username` | TEXT UNIQUE | login identifier |
| `password` | TEXT | stored as-is (game context) |
| `color` | TEXT | hex color |
| `avatar` | TEXT | emoji |
| `current_level` | INT | 1, 2, or 3 |
| `session_token` | TEXT UNIQUE | 64-char hex, refreshed on each login |
| `created_at` | TIMESTAMPTZ | |
| `last_active` | TIMESTAMPTZ | |

### `team_state` table
| Column | Type | Notes |
|---|---|---|
| `team_id` | UUID FK → teams | |
| `level` | INT | 1, 2, or 3 |
| `ticket` | JSONB | 3×9 array with nulls |
| `ticket_numbers` | JSONB | list of 15 numbers |
| `numbers_hit` | JSONB | matched ticket numbers |
| `numbers_collected` | JSONB | all awarded numbers |
| `questions_solved` | INT | |
| `questions_skipped` | INT | |
| `current_question_cursor` | INT | index into shuffled question order |
| `question_order` | JSONB | shuffled question indices |
| `is_winner` | BOOL | Full House achieved |
| `won_at` | TIMESTAMPTZ | |
| `tab_switch_count` | INT | anti-cheat violation count |
| `removed` | BOOL | admin removed this team |

---

## 🚀 Setup

### 1. Supabase DB (one-time)

1. Open: https://supabase.com/dashboard/project/loebniiqdwyzwecbbvjl/sql
2. Paste the contents of `supabase_setup.sql` and run it
3. Verify the 3 tables (`teams`, `team_state`, `game_settings`) appear in the Table Editor

### 2. Run the server

```bash
cd BRAIN_BREAKER
python server.py
```

Server starts at **http://localhost:8000**

Optional env vars:
```bash
PORT=8080 ADMIN_PASSWORD=MySecret TICKET_HIT_CHANCE=0.70 python server.py
```
- `TICKET_HIT_CHANCE`: Probability (0.0 to 1.0) that a correct answer cuts an unhit number on the team's ticket. Defaults to `0.70` (70% cut probability). Set to `0.85` or `1.0` for even faster cuts!

### 3. Create teams (Admin)

1. Open http://localhost:8000/admin
2. Enter passcode: `BMS123`
3. Click **➕ Create Team** → fill in team name, username, password, avatar, color
4. Hand out credentials to each team

### 4. Teams join

1. Teams open http://localhost:8000
2. Enter their username + password → game starts immediately
3. Progress is saved to Supabase — switching computers is fine, just log in again

---

## 🎮 Game Rules

| Rule | Detail |
|---|---|
| **Ticket** | Authentic 3×9 Indian Tambola ticket — 15 unique numbers, 5 per row |
| **Earn numbers** | Solve a puzzle correctly → get a random number 1–90 (no repeats) |
| **Stamp** | If the number is on your ticket → it gets stamped green |
| **Skip** | Can skip any question (no penalty except losing the chance to earn a number) |
| **Win** | First to stamp all 15 ticket cells = **Full House** → Level 2 unlocked |
| **Anti-cheat** | Configurable tab-switch / fullscreen monitoring (OFF by default, toggled via Admin portal) |

---

## 🌐 API Reference

### Team endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/login` | — | Login with username+password, returns session token |
| `GET` | `/api/state?token=TOKEN` | token | Get team state + current question + level |
| `POST` | `/api/submit-answer` | token in body | Submit answer, get awarded number |
| `POST` | `/api/skip-puzzle` | token in body | Skip current question |
| `POST` | `/api/tab-violation` | token in body | Report tab-switch (only active when anti-cheat is ON) |

### Admin endpoints
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/admin/login` | — | Admin login (passcode `BMS123`) |
| `GET` | `/api/admin/teams?passcode=XXX` | passcode | All teams with live ticket state & scores |
| `POST` | `/api/admin/create-team` | passcode | Create a new team credentials |
| `POST` | `/api/admin/set-team-level` | passcode | Promote or demote team level (`level: 1, 2, 3`) |
| `POST` | `/api/admin/set-anticheat` | passcode | Toggle anti-cheat monitoring (`enabled: true/false`) |
| `POST` | `/api/admin/reset` | passcode | Reset one or all teams |
| `POST` | `/api/admin/broadcast` | passcode | Send popup announcement to all players |
| `POST` | `/api/admin/end-game` | passcode | End or resume the game |
| `POST` | `/api/admin/set-ticket-hit-chance` | passcode | Set ticket hit probability (`chance: 0.01..1.0`) |
| `POST` | `/api/admin/remove-team` | passcode | Remove or reinstate a team |

---

## 📊 Levels
 
| Level | Game | Description | Status |
|---|---|---|---|
| **Level 1** | **Tambola Puzzle** | Solve coding, math, aptitude puzzles → earn numbers 1–90 → stamp 3×9 ticket → Full House | ✅ Complete |
| **Level 2** | **Fog Maze Run** | 27×17 DFS maze with dynamic Fog of War light halo → find authentic key among 4 colored keys → wrong key requires returning to START | ✅ Complete |
| **Level 3** | **The Final Challenge** | Clean GitHub repository display (`AkshatOP/gradient_l3`) with 1-click clone command; zero spoilers, participants investigate on their own | ✅ Complete |

---

## 🔧 Customizing Questions

Edit `questions.csv` — the server hot-reloads it automatically (no restart needed):

```
ques no.,question,topic name,answer
1,"Your question here",Coding,answer
2,"Another question",Math,"42"
```

- **topic name** sets the category badge color: `Coding` (blue), `Aptitude` (amber), `Math` (emerald), `Reasoning` (cyan), anything else → purple
- Multiple acceptable answers: separate with `;` e.g. `answer1;answer2`

---

## 🛡️ Admin Credentials

| Field | Value |
|---|---|
| URL | http://localhost:8000/admin |
| Passcode | `BMS123` (override with `ADMIN_PASSWORD` env var) |

---

## 🚀 Deploying to Render

The entire app is cloud-native with **zero local file dependencies**: all game data, team credentials, tickets, and maze progress persist in Supabase.

1. Create a new **Web Service** on Render connected to this GitHub repo.
2. Configure service settings:
   - **Environment:** `Python 3`
   - **Build Command:** *(leave empty or `pip install -r requirements.txt`)*
   - **Start Command:** `python server.py`
3. Add Environment Variables in Render Dashboard:
   - `SUPABASE_URL` = `https://loebniiqdwyzwecbbvjl.supabase.co`
   - `SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - `ADMIN_PASSWORD` = `BMS123`
   - `TICKET_HIT_CHANCE` = `1.0` (or `0.70`)
4. Click **Deploy Web Service** — Render will automatically supply `$PORT` and launch!
