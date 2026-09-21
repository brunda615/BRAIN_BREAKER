#!/usr/bin/env python3
"""Brain Breaker — Multi-level puzzle game server with Supabase backend."""

import csv
import json
import os
import re
import random
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import http.server
import socketserver
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
# ENVIRONMENT & CONFIGURATION (.env)
# ─────────────────────────────────────────────────────────────────────────────
def load_env_file():
    """Load key-value pairs from .env into os.environ (pure Python stdlib)."""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, _, v = line.partition("=")
                    k, v = k.strip(), v.strip()
                    if len(v) >= 2 and ((v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'"))):
                        v = v[1:-1]
                    if k and k not in os.environ:
                        os.environ[k] = v
    except Exception as e:
        print(f"[WARN] Error reading .env file: {e}", flush=True)

load_env_file()

PORT          = int(os.environ.get("PORT", 8000))
BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR    = os.path.join(BASE_DIR, "public")
QUESTIONS_CSV = os.path.join(BASE_DIR, "questions.csv")

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "BMS123")
SUPABASE_URL   = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY   = os.environ.get("SUPABASE_ANON_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[WARN] SUPABASE_URL or SUPABASE_ANON_KEY is not set in .env!", flush=True)

# In-memory flags (reset on server restart)
GAME_ENDED        = False
ANTICHEAT_ENABLED = False  # Admin can toggle tab-switch/fullscreen enforcement

# Ticket cut probability (0.0 to 1.0): chance that a correct answer awards an unhit ticket number.
TICKET_HIT_CHANCE = float(os.environ.get("TICKET_HIT_CHANCE", "0.70"))

# ─────────────────────────────────────────────────────────────────────────────
# SUPABASE REST HELPERS
# ─────────────────────────────────────────────────────────────────────────────
_SB_HDR = {
    "apikey":        SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type":  "application/json",
}

def _sb(method, table, *, filters=None, body=None, select=None, prefer=None):
    """Low-level Supabase PostgREST call. Returns (data, http_status)."""
    qs = []
    if select and method in ("GET", "HEAD"):
        qs.append("select=" + urllib.parse.quote(select, safe="*(),"))
    for col, val in (filters or {}).items():
        qs.append(col + "=" + urllib.parse.quote(str(val), safe=".,()-[]"))

    url = f"{SUPABASE_URL}/rest/v1/{table}" + ("?" + "&".join(qs) if qs else "")
    hdrs = dict(_SB_HDR)
    if prefer:
        hdrs["Prefer"] = prefer

    raw = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=raw, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            data = r.read()
            return (json.loads(data) if data else []), r.status
    except urllib.error.HTTPError as e:
        data = e.read()
        print(f"[SB] {method} {table} -> {e.code}: {data[:300]}")
        try:    return json.loads(data), e.code
        except: return {}, e.code
    except Exception as exc:
        print(f"[SB] {method} {table} exception: {exc}")
        return {}, 500


def sb_get(table, filters=None, select="*"):
    rows, _ = _sb("GET", table, filters=filters, select=select)
    return rows if isinstance(rows, list) else []

def sb_one(table, filters=None, select="*"):
    rows = sb_get(table, filters=filters, select=select)
    return rows[0] if rows else None

def sb_post(table, body):
    result, status = _sb("POST", table, body=body, prefer="return=representation")
    if status not in (200, 201): return None
    if isinstance(result, list): return result[0] if result else None
    return result if isinstance(result, dict) and "id" in result else None

def sb_patch(table, filters, body):
    _sb("PATCH", table, filters=filters, body=body, prefer="return=representation")

def sb_del(table, filters):
    _sb("DELETE", table, filters=filters)

def load_game_settings():
    global GAME_ENDED, ANTICHEAT_ENABLED, TICKET_HIT_CHANCE
    try:
        rows = sb_get("game_settings", select="*") or []
        for r in rows:
            k = r.get("key")
            v = r.get("value")
            if k == "game_ended":
                GAME_ENDED = bool(v)
            elif k == "anticheat_enabled":
                ANTICHEAT_ENABLED = bool(v)
            elif k == "ticket_hit_chance":
                try:
                    TICKET_HIT_CHANCE = float(v)
                except (ValueError, TypeError):
                    pass
        print(f"[SETTINGS] Loaded game settings from Supabase (game_ended={GAME_ENDED}, anticheat={ANTICHEAT_ENABLED}, ticket_hit_chance={TICKET_HIT_CHANCE})", flush=True)
    except Exception as e:
        print(f"[SETTINGS] Could not load game_settings from Supabase: {e}", flush=True)

def save_game_setting(key, value):
    try:
        row = sb_get("game_settings", {"key": f"eq.{key}"})
        if row:
            sb_patch("game_settings", {"key": f"eq.{key}"}, {"value": value})
        else:
            sb_post("game_settings", {"key": key, "value": value})
    except Exception as e:
        print(f"[SETTINGS] Could not save game_setting {key}: {e}", flush=True)


# ─────────────────────────────────────────────────────────────────────────────
# QUESTIONS — CSV with hot-reload on file modification
# ─────────────────────────────────────────────────────────────────────────────
_q_cache, _q_mtime, _q_lock = [], 0, threading.RLock()

def load_questions_from_csv():
    global _q_cache, _q_mtime
    with _q_lock:
        if not os.path.exists(QUESTIONS_CSV):
            print(f"[CSV] Warning: {QUESTIONS_CSV} not found!")
            return _q_cache
        mtime = os.path.getmtime(QUESTIONS_CSV)
        if mtime == _q_mtime and _q_cache:
            return _q_cache
        loaded = []
        try:
            with open(QUESTIONS_CSV, "r", encoding="utf-8-sig") as f:
                for idx, row in enumerate(csv.DictReader(f)):
                    q_no  = row.get("ques no.", str(idx + 1)).strip()
                    q_txt = row.get("question", "").strip()
                    topic = row.get("topic name", "General").strip()
                    a_str = row.get("answer", "").strip()
                    answers = [a.strip() for a in a_str.replace("|", ";").split(";") if a.strip()] or [a_str]
                    if q_txt:
                        loaded.append({
                            "id":       int(q_no) if q_no.isdigit() else idx + 1,
                            "category": topic.upper(),
                            "question": q_txt,
                            "answers":  answers,
                        })
            _q_cache, _q_mtime = loaded, mtime
            print(f"[CSV] Loaded {len(loaded)} questions (mtime: {mtime})")
        except Exception as e:
            print(f"[CSV] Error loading: {e}")
        return _q_cache

load_questions_from_csv()


# ─────────────────────────────────────────────────────────────────────────────
# AUTHENTIC INDIAN TAMBOLA (90-BALL) TICKET GENERATOR
# ─────────────────────────────────────────────────────────────────────────────
def generate_tambola_ticket():
    col_ranges = [(1,9),(10,19),(20,29),(30,39),(40,49),(50,59),(60,69),(70,79),(80,90)]
    while True:
        col_counts = [1] * 9
        rem = 6  # 15 - 9
        idxs = list(range(9)); random.shuffle(idxs)
        for c in idxs:
            if rem == 0: break
            add = min(random.choice([1, 2]), rem)
            if col_counts[c] + add <= 3:
                col_counts[c] += add; rem -= add
        if sum(col_counts) != 15: continue

        col_numbers = []
        for c in range(9):
            lo, hi = col_ranges[c]
            col_numbers.append(sorted(random.sample(range(lo, hi + 1), col_counts[c])))

        grid = [[None] * 9 for _ in range(3)]
        row_counts = [0, 0, 0]

        for c in range(9):
            if col_counts[c] == 3:
                grid[0][c] = col_numbers[c][0]
                grid[1][c] = col_numbers[c][1]
                grid[2][c] = col_numbers[c][2]
                row_counts[0] += 1; row_counts[1] += 1; row_counts[2] += 1

        col2 = [c for c in range(9) if col_counts[c] == 2]
        col1 = [c for c in range(9) if col_counts[c] == 1]

        def place(lst, two):
            if not lst: return True
            c, rest = lst[0], lst[1:]
            if two:
                pairs = [(0,1),(0,2),(1,2)]; random.shuffle(pairs)
                for r1, r2 in pairs:
                    if row_counts[r1] < 5 and row_counts[r2] < 5:
                        grid[r1][c] = col_numbers[c][0]; grid[r2][c] = col_numbers[c][1]
                        row_counts[r1] += 1; row_counts[r2] += 1
                        if place(rest, True): return True
                        grid[r1][c] = None; grid[r2][c] = None
                        row_counts[r1] -= 1; row_counts[r2] -= 1
                return False
            else:
                rows = [0, 1, 2]; random.shuffle(rows)
                for r in rows:
                    if row_counts[r] < 5:
                        grid[r][c] = col_numbers[c][0]; row_counts[r] += 1
                        if place(rest, False): return True
                        grid[r][c] = None; row_counts[r] -= 1
                return False

        if place(col2, True) and place(col1, False):
            if all(c == 5 for c in row_counts):
                for c in range(9):
                    vals = sorted([grid[r][c] for r in range(3) if grid[r][c] is not None])
                    i = 0
                    for r in range(3):
                        if grid[r][c] is not None:
                            grid[r][c] = vals[i]; i += 1
                nums = [n for row in grid for n in row if n is not None]
                if len(nums) == 15 and len(set(nums)) == 15:
                    return grid


# ─────────────────────────────────────────────────────────────────────────────
# ANSWER CHECKING
# ─────────────────────────────────────────────────────────────────────────────
def _norm(s):
    if s is None: return ""
    return re.sub(r'\s+', ' ', str(s).strip().lower())

def check_answer(user_ans, acceptable):
    u = _norm(user_ans)
    if not u: return False
    for a in acceptable:
        n = _norm(a)
        if u == n: return True
        try:
            if float(u) == float(n): return True
        except ValueError:
            pass
    return False


# ─────────────────────────────────────────────────────────────────────────────
# DATABASE HELPER FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────
def get_team_by_token(token):
    if not token: return None
    return sb_one("teams", {"session_token": f"eq.{token}"})

def get_or_create_state(team_id, level=1):
    """Fetch existing team state, or create a fresh one for the given level."""
    state = sb_one("team_state", {
        "team_id": f"eq.{team_id}",
        "level":   f"eq.{level}",
    })
    if state:
        return state

    questions = load_questions_from_csv()
    ticket    = generate_tambola_ticket()
    t_nums    = [n for row in ticket for n in row if n is not None]
    q_order   = list(range(len(questions)))
    random.shuffle(q_order)

    data = {
        "team_id": team_id, "level": level,
        "ticket": ticket, "ticket_numbers": t_nums,
        "numbers_hit": [], "numbers_collected": [],
        "questions_solved": 0, "questions_skipped": 0,
        "current_question_cursor": 0, "question_order": q_order,
        "is_winner": False, "won_at": None,
        "tab_switch_count": 0, "removed": False,
        "last_active": datetime.now().isoformat(),
    }
    result = sb_post("team_state", data)
    return result or data

def update_state(team_id, level, updates):
    updates["last_active"] = datetime.now().isoformat()
    sb_patch("team_state", {
        "team_id": f"eq.{team_id}",
        "level":   f"eq.{level}",
    }, updates)

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 02: COLOR RIDDLES & PERSISTENT KEY ASSIGNMENT
# ─────────────────────────────────────────────────────────────────────────────
MAZE_KEY_COLORS = ["RED", "BLUE", "GREEN", "YELLOW"]

MAZE_COLOR_RIDDLES = {
    "RED": {
        "color": "RED",
        "title": "The Crimson Cipher",
        "riddle": "I am the spark of a wild flame, the ruby in a king's crown, and the urgent signal where traffic halts. What color key unlocks your path?",
        "accepted": ["red", "red key", "the red key", "crimson", "ruby"],
    },
    "BLUE": {
        "color": "BLUE",
        "title": "The Azure Cipher",
        "riddle": "I am the expanse of the cloudless sky, the depths of the ocean trench, and royalty's proudest sapphire. What color key unlocks your path?",
        "accepted": ["blue", "blue key", "the blue key", "azure", "sapphire", "cyan"],
    },
    "GREEN": {
        "color": "GREEN",
        "title": "The Emerald Cipher",
        "riddle": "I am the breath of ancient pine forests, the coat of moss upon stones, and the rarest emerald gem. What color key unlocks your path?",
        "accepted": ["green", "green key", "the green key", "emerald", "jade"],
    },
    "YELLOW": {
        "color": "YELLOW",
        "title": "The Amber Cipher",
        "riddle": "I am the morning sunrise breaking dark skies, the warmth of midday noon, and the bright crown of a sunflower. What color key unlocks your path?",
        "accepted": ["yellow", "yellow key", "the yellow key", "amber", "gold", "golden"],
    },
}

def get_team_assigned_key_color(team):
    """Consistently assign one of the 4 key colors based on team identity."""
    tid = str(team.get("id") or team.get("username") or team.get("team_name") or "team")
    idx = sum(ord(c) for c in tid) % len(MAZE_KEY_COLORS)
    return MAZE_KEY_COLORS[idx]

def build_state_response(team, state):
    lvl = team.get("current_level", 1)
    team_id = team["id"]

    # If in Level 2 or 3, fetch Level 1 state so ticket and questions solved remain accessible
    if lvl > 1:
        l1_state = sb_one("team_state", {"team_id": f"eq.{team_id}", "level": "eq.1"}) or {}
    else:
        l1_state = state

    # If in Level 3, fetch Level 2 state for final maze timing and attempt count
    if lvl == 3:
        l2_state = sb_one("team_state", {"team_id": f"eq.{team_id}", "level": "eq.2"}) or {}
    elif lvl == 2:
        l2_state = state
    else:
        l2_state = {}

    questions = load_questions_from_csv()
    cursor    = l1_state.get("current_question_cursor", 0)
    q_order   = l1_state.get("question_order") or []

    # Extend order if new questions were added to CSV
    if len(q_order) < len(questions):
        extra = [i for i in range(len(questions)) if i not in q_order]
        random.shuffle(extra)
        q_order = list(q_order) + extra

    q_data = None
    if cursor < len(q_order):
        qi = q_order[cursor]
        if qi < len(questions):
            rq = questions[qi]
            q_data = {
                "id": rq["id"], "category": rq["category"],
                "question": rq["question"], "puzzle_number": cursor + 1,
            }

    hit  = l1_state.get("numbers_hit") or []
    coll = l1_state.get("numbers_collected") or []

    l2_coll = l2_state.get("numbers_collected") or []
    l2_meta = l2_coll[0] if (isinstance(l2_coll, list) and l2_coll and isinstance(l2_coll[0], dict) and "elapsed_ms" in l2_coll[0]) else (l2_coll if isinstance(l2_coll, dict) else {})
    elapsed_ms = l2_meta.get("elapsed_ms", 0) if isinstance(l2_meta, dict) else 0
    maze_round = l2_state.get("questions_solved", 0)
    maze_won   = l2_state.get("is_winner", False)

    assigned_color = get_team_assigned_key_color(team)
    riddle_info = MAZE_COLOR_RIDDLES[assigned_color]

    return {
        "team_name":               team["team_name"],
        "color":                   team.get("color", "#3b82f6"),
        "avatar":                  team.get("avatar", "🚀"),
        "current_level":           lvl,
        "ticket":                  l1_state.get("ticket", []),
        "numbers_hit":             hit,
        "numbers_collected":       coll,
        "questions_solved":        l1_state.get("questions_solved", 0),
        "questions_skipped":       l1_state.get("questions_skipped", 0),
        "ticket_numbers_hit_count": len(hit),
        "total_ticket_numbers":    15,
        "is_winner":               l1_state.get("is_winner", False),
        "won_at":                  l1_state.get("won_at"),
        "current_puzzle":          q_data,
        "maze_elapsed_ms":         elapsed_ms,
        "maze_round":              maze_round,
        "maze_won":                maze_won,
        "maze_assigned_color":     assigned_color,
        "maze_riddle": {
            "title":    riddle_info["title"],
            "riddle":   riddle_info["riddle"],
            "accepted": riddle_info["accepted"],
            "color":    riddle_info["color"],
        },
        "game_ended":              GAME_ENDED,
        "anticheat_enabled":       ANTICHEAT_ENABLED,
        "removed":                 state.get("removed", False),
        "tab_switch_count":        state.get("tab_switch_count", 0),
        "server_time":             datetime.now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# SERVER-SENT EVENTS (real-time admin updates)
# ─────────────────────────────────────────────────────────────────────────────
_sse_clients, _sse_lock = [], threading.RLock()

def broadcast(event_type, payload):
    msg = ("data: " + json.dumps({
        "type": event_type, "data": payload, "timestamp": time.time()
    }) + "\n\n").encode("utf-8")
    with _sse_lock:
        dead = []
        for client in _sse_clients:
            try:
                client.wfile.write(msg)
                client.wfile.flush()
            except Exception:
                dead.append(client)
        for c in dead:
            if c in _sse_clients:
                _sse_clients.remove(c)


# ─────────────────────────────────────────────────────────────────────────────
# HTTP REQUEST HANDLER
# ─────────────────────────────────────────────────────────────────────────────
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Suppress per-request logs for cleaner console output
        pass

    def send_data(self, content, ct="text/html; charset=utf-8", status=200):
        try:
            self.send_response(status)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(content)
            self.wfile.flush()
        except Exception:
            pass

    def json(self, data, status=200):
        self.send_data(json.dumps(data).encode(), "application/json; charset=utf-8", status)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _read_body(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n) if n > 0 else b"{}"
        try:    return json.loads(raw.decode("utf-8"))
        except: return {}

    def _get_token(self, body=None, query=None):
        """Extract bearer token from body, query params, or Authorization header."""
        if body and body.get("token"):
            return body["token"].strip()
        if query and query.get("token", [""])[0]:
            return query["token"][0].strip()
        auth = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
        return auth or ""

    def _serve_file(self, fpath):
        if not os.path.exists(fpath):
            self.json({"error": "Not found"}, 404); return
        with open(fpath, "rb") as f:
            content = f.read()
        ext_map = {".js": "application/javascript", ".css": "text/css",
                   ".json": "application/json", ".png": "image/png",
                   ".ico": "image/x-icon", ".svg": "image/svg+xml"}
        ext = os.path.splitext(fpath)[1]
        self.send_data(content, ext_map.get(ext, "text/html; charset=utf-8"))

    # ─── GET ──────────────────────────────────────────────────────────────────
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path   = parsed.path
        q      = urllib.parse.parse_qs(parsed.query)

        # ── SSE endpoint ──────────────────────────────────────────────────────
        if path == "/api/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            with _sse_lock:
                _sse_clients.append(self)
            self.wfile.write(
                f"data: {json.dumps({'type': 'connected'})}\n\n".encode()
            )
            self.wfile.flush()
            try:
                while True:
                    time.sleep(15)
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except Exception:
                with _sse_lock:
                    if self in _sse_clients:
                        _sse_clients.remove(self)
            return

        # ── Team state ────────────────────────────────────────────────────────
        if path == "/api/state":
            token = self._get_token(query=q)
            team  = get_team_by_token(token)
            if not team:
                self.json({"error": "Invalid or expired session. Please log in again."}, 401)
                return
            level = team.get("current_level", 1)
            state = get_or_create_state(team["id"], level)
            self.json(build_state_response(team, state))
            return

        # ── Admin: all teams ──────────────────────────────────────────────────
        if path == "/api/admin/teams":
            pc = (q.get("passcode", [""])[0] or
                  self.headers.get("Authorization", "").replace("Bearer ", "")).strip()
            if pc != ADMIN_PASSWORD:
                self.json({"error": "Unauthorized"}, 401); return

            teams_list  = sb_get("teams",      select="*")
            states_list = sb_get("team_state", select="*")
            state_map   = {(s["team_id"], s.get("level", 1)): s for s in states_list}

            result = []
            for t in teams_list:
                lvl        = t.get("current_level", 1)
                l1_state   = state_map.get((t["id"], 1), {})
                l2_state   = state_map.get((t["id"], 2), {})
                l3_state   = state_map.get((t["id"], 3), {})
                curr_state = state_map.get((t["id"], lvl), {})

                l2_coll  = l2_state.get("numbers_collected") or []
                l2_meta  = l2_coll[0] if (isinstance(l2_coll, list) and l2_coll and isinstance(l2_coll[0], dict)) else (l2_coll if isinstance(l2_coll, dict) else {})
                l2_elapsed = l2_meta.get("elapsed_ms", 0) if isinstance(l2_meta, dict) else 0
                l2_round   = l2_state.get("questions_solved", 0)
                l2_won     = l2_state.get("is_winner", False)

                hit   = l1_state.get("numbers_hit") or []
                coll  = l1_state.get("numbers_collected") or []

                total_tab_switches = (
                    l1_state.get("tab_switch_count", 0) +
                    l2_state.get("tab_switch_count", 0) +
                    l3_state.get("tab_switch_count", 0)
                )

                result.append({
                    "team_name":               t["team_name"],
                    "username":                t["username"],
                    "avatar":                  t.get("avatar", "🚀"),
                    "color":                   t.get("color", "#3b82f6"),
                    "current_level":           lvl,
                    "questions_solved":        l1_state.get("questions_solved", 0),
                    "questions_skipped":       l1_state.get("questions_skipped", 0),
                    "numbers_hit_count":       len(hit),
                    "numbers_hit":             hit,
                    "ticket":                  l1_state.get("ticket"),
                    "numbers_collected_count": len(coll),
                    "numbers_collected":       coll,
                    "is_winner":               l1_state.get("is_winner", False),
                    "won_at":                  l1_state.get("won_at"),
                    "maze_elapsed_ms":         l2_elapsed,
                    "maze_round":              l2_round,
                    "maze_won":                l2_won,
                    "tab_switch_count":        total_tab_switches,
                    "removed":                 curr_state.get("removed", False),
                    "created_at":              t.get("created_at"),
                    "last_active":             curr_state.get("last_active") or t.get("last_active"),
                })
            result.sort(key=lambda x: (-x["current_level"], -x["numbers_hit_count"], -x["questions_solved"]))
            self.json({
                "teams": result,
                "total_teams": len(result),
                "game_ended": GAME_ENDED,
                "anticheat_enabled": ANTICHEAT_ENABLED,
                "ticket_hit_chance": TICKET_HIT_CHANCE,
            })
            return

        # ── Static file routing ───────────────────────────────────────────────
        if path in ("/admin", "/admin/", "/admin.html"):
            self._serve_file(os.path.join(PUBLIC_DIR, "admin.html")); return
        if path in ("/", "/index.html"):
            self._serve_file(os.path.join(PUBLIC_DIR, "index.html")); return

        rel = path.lstrip("/\\")
        fp  = os.path.join(PUBLIC_DIR, rel)
        if rel and os.path.isfile(fp):
            self._serve_file(fp); return

        self.json({"error": "Not found"}, 404)

    # ─── POST ─────────────────────────────────────────────────────────────────
    def do_POST(self):
        global GAME_ENDED, ANTICHEAT_ENABLED, TICKET_HIT_CHANCE
        parsed = urllib.parse.urlparse(self.path)
        path   = parsed.path
        body   = self._read_body()

        # ── Team login ────────────────────────────────────────────────────────
        if path == "/api/login":
            username = body.get("username", "").strip()
            password = body.get("password", "").strip()
            if not username or not password:
                self.json({"error": "Username and password are required."}, 400); return
            team = sb_one("teams", {"username": f"eq.{username}"})
            if not team or team.get("password") != password:
                self.json({"error": "Invalid username or password."}, 401); return
            # Issue a fresh session token
            token = secrets.token_hex(32)
            sb_patch("teams", {"id": f"eq.{team['id']}"}, {
                "session_token": token,
                "last_active":   datetime.now().isoformat(),
            })
            team["session_token"] = token
            level = team.get("current_level", 1)
            state = get_or_create_state(team["id"], level)
            resp  = build_state_response(team, state)
            resp.update({"token": token, "success": True})
            broadcast("team_joined", {"team_name": team["team_name"], "avatar": team.get("avatar", "🚀")})
            self.json(resp)
            return

        # ── Admin login ───────────────────────────────────────────────────────
        if path == "/api/admin/login":
            pw = body.get("password", "").strip()
            if pw == ADMIN_PASSWORD:
                self.json({"success": True, "token": ADMIN_PASSWORD})
            else:
                self.json({"success": False, "error": "Invalid admin password."}, 401)
            return

        # ── Admin: create team ────────────────────────────────────────────────
        if path == "/api/admin/create-team":
            pc = body.get("passcode", "").strip()
            if pc != ADMIN_PASSWORD:
                self.json({"error": "Unauthorized"}, 401); return

            team_name = body.get("team_name", "").strip()
            username  = body.get("username",  "").strip()
            password  = body.get("password",  "").strip()
            avatar    = body.get("avatar",    "🚀")
            color     = body.get("color",     "#3b82f6")

            if not team_name or not username or not password:
                self.json({"error": "team_name, username, and password are required."}, 400); return

            if sb_one("teams", {"username": f"eq.{username}"}):
                self.json({"error": f"Username '{username}' is already taken."}, 409); return

            new_team = sb_post("teams", {
                "team_name": team_name, "username": username,
                "password":  password,  "avatar":   avatar,
                "color":     color,     "current_level": 1,
            })
            if not new_team or "id" not in new_team:
                self.json({"error": "Failed to create team. Ensure the Supabase schema is set up (run supabase_setup.sql)."}, 500); return

            # Pre-generate the team's Level 1 state (ticket + question order)
            get_or_create_state(new_team["id"], 1)
            broadcast("team_joined", {"team_name": team_name, "avatar": avatar})
            self.json({
                "success":   True,
                "team_name": team_name,
                "username":  username,
                "message":   f"Team '{team_name}' created successfully.",
            })
            return

        # ── Token-authenticated endpoints ─────────────────────────────────────
        token = self._get_token(body=body)

        # ── Submit answer ─────────────────────────────────────────────────────
        if path == "/api/submit-answer":
            if GAME_ENDED:
                self.json({"error": "Game has ended.", "game_ended": True}, 403); return
            team = get_team_by_token(token)
            if not team:
                self.json({"error": "Invalid session. Please log in again."}, 401); return
            level = team.get("current_level", 1)
            state = get_or_create_state(team["id"], level)
            if state.get("removed"):
                self.json({"error": "You have been removed from the game.", "removed": True}, 403); return

            answer    = body.get("answer", "").strip()
            questions = load_questions_from_csv()
            cursor    = state.get("current_question_cursor", 0)
            q_order   = state.get("question_order") or []

            if cursor >= len(q_order) or q_order[cursor] >= len(questions):
                self.json({"error": "All questions completed!", "correct": False}, 400); return

            raw_q = questions[q_order[cursor]]
            if not check_answer(answer, raw_q["answers"]):
                self.json({
                    "success": False, "correct": False,
                    "message": "Incorrect answer. Try again, or click Skip Puzzle!",
                })
                return

            # Award a unique random number 1–90 (with biased chance to hit ticket numbers)
            already = {item["number"] for item in (state.get("numbers_collected") or [])}
            avail   = [n for n in range(1, 91) if n not in already]

            t_nums       = state.get("ticket_numbers") or []
            numbers_hit  = list(state.get("numbers_hit") or [])
            numbers_coll = list(state.get("numbers_collected") or [])

            # Unhit ticket numbers that haven't been awarded yet
            unhit_ticket     = [n for n in t_nums if n not in numbers_hit and n in avail]
            non_ticket_avail = [n for n in avail if n not in t_nums]

            # Weighted choice: TICKET_HIT_CHANCE (default 70%) to pick an unhit ticket number
            if unhit_ticket and (random.random() < TICKET_HIT_CHANCE or not non_ticket_avail):
                awarded = random.choice(unhit_ticket)
            elif non_ticket_avail:
                awarded = random.choice(non_ticket_avail)
            elif avail:
                awarded = random.choice(avail)
            else:
                awarded = None

            is_hit = False
            if awarded is not None:
                is_hit = awarded in t_nums
                if is_hit and awarded not in numbers_hit:
                    numbers_hit.append(awarded)
                numbers_coll.append({
                    "number": awarded, "hit": is_hit,
                    "at": datetime.now().isoformat(), "question_id": raw_q["id"],
                })
                print(f"[Tambola] Team '{team['team_name']}' solved Q#{raw_q['id']} → Awarded #{awarded} "
                      f"({'✓ TICKET CUT!' if is_hit else 'miss'}) [Progress: {len(numbers_hit)}/15 hits]", flush=True)

            new_solved = state.get("questions_solved", 0) + 1
            new_cursor = cursor + 1
            is_winner  = len(numbers_hit) >= 15
            prev_won   = state.get("is_winner", False)
            won_at     = (datetime.now().isoformat()
                          if is_winner and not prev_won
                          else state.get("won_at"))

            update_state(team["id"], level, {
                "numbers_hit":              numbers_hit,
                "numbers_collected":        numbers_coll,
                "questions_solved":         new_solved,
                "current_question_cursor":  new_cursor,
                "is_winner":                is_winner,
                "won_at":                   won_at,
            })

            # Advance to next level when Level 1 Full House is achieved
            level_completed = False
            if is_winner and level == 1 and not prev_won:
                sb_patch("teams", {"id": f"eq.{team['id']}"}, {"current_level": 2})
                level_completed = True

            broadcast("team_progress", {
                "team_name":      team["team_name"],
                "questions_solved": new_solved,
                "numbers_hit_count": len(numbers_hit),
                "awarded_number": awarded, "hit": is_hit,
                "is_winner":      is_winner,
                "level_completed": level_completed,
                "current_level":  level,
            })

            next_q = None
            if new_cursor < len(q_order) and q_order[new_cursor] < len(questions):
                nq = questions[q_order[new_cursor]]
                next_q = {
                    "id": nq["id"], "category": nq["category"],
                    "question": nq["question"], "puzzle_number": new_cursor + 1,
                }

            self.json({
                "success": True, "correct": True,
                "awarded_number": awarded, "hit": is_hit,
                "numbers_hit": numbers_hit, "numbers_hit_count": len(numbers_hit),
                "questions_solved": new_solved,
                "is_winner": is_winner, "won_at": won_at,
                "level_completed": level_completed,
                "next_puzzle": next_q,
            })
            return

        # ── Skip puzzle ───────────────────────────────────────────────────────
        if path == "/api/skip-puzzle":
            if GAME_ENDED:
                self.json({"error": "Game has ended.", "game_ended": True}, 403); return
            team = get_team_by_token(token)
            if not team:
                self.json({"error": "Invalid session."}, 401); return
            level = team.get("current_level", 1)
            state = get_or_create_state(team["id"], level)
            if state.get("removed"):
                self.json({"error": "You have been removed.", "removed": True}, 403); return

            questions   = load_questions_from_csv()
            new_cursor  = state.get("current_question_cursor", 0) + 1
            new_skipped = state.get("questions_skipped", 0) + 1
            update_state(team["id"], level, {
                "current_question_cursor": new_cursor,
                "questions_skipped":       new_skipped,
            })
            q_order = state.get("question_order") or []
            next_q  = None
            if new_cursor < len(q_order) and q_order[new_cursor] < len(questions):
                nq = questions[q_order[new_cursor]]
                next_q = {
                    "id": nq["id"], "category": nq["category"],
                    "question": nq["question"], "puzzle_number": new_cursor + 1,
                }
            broadcast("team_progress", {
                "team_name": team["team_name"],
                "questions_skipped": new_skipped, "skipped": True,
            })
            self.json({"success": True, "skipped": True, "next_puzzle": next_q})
            return

        # ── Tab violation ─────────────────────────────────────────────────────
        if path == "/api/tab-violation":
            team = get_team_by_token(token)
            if not team:
                self.json({"tab_switch_count": 0}); return
            level     = team.get("current_level", 1)
            state     = get_or_create_state(team["id"], level)
            new_count = state.get("tab_switch_count", 0) + 1
            update_state(team["id"], level, {"tab_switch_count": new_count})
            broadcast("team_violation", {
                "team_name": team["team_name"], "tab_switch_count": new_count,
            })
            self.json({"success": True, "tab_switch_count": new_count})
            return

        # ── Level 2: sync maze state ──────────────────────────────────────────
        if path == "/api/level2/sync":
            team = get_team_by_token(token)
            if not team:
                self.json({"error": "Invalid session. Please log in again."}, 401); return
            level = team.get("current_level", 1)
            if level != 2:
                self.json({"error": "Team is not on Level 2.", "current_level": level}, 400); return
            try:
                elapsed_ms = int(body.get("elapsed_ms", 0))
                maze_round = int(body.get("round", 0))
            except (ValueError, TypeError):
                elapsed_ms, maze_round = 0, 0
            update_state(team["id"], 2, {
                "questions_solved": maze_round,
                "numbers_collected": [{"elapsed_ms": elapsed_ms, "round": maze_round}],
            })
            self.json({"success": True, "elapsed_ms": elapsed_ms, "round": maze_round})
            return

        # ── Level 2: solve riddle ─────────────────────────────────────────────
        if path == "/api/level2/solve-riddle":
            team = get_team_by_token(token)
            if not team:
                self.json({"error": "Invalid session. Please log in again."}, 401); return
            assigned = get_team_assigned_key_color(team)
            riddle = MAZE_COLOR_RIDDLES[assigned]
            user_ans = str(body.get("answer", "")).strip().lower()
            is_correct = user_ans in [a.lower() for a in riddle["accepted"]] or user_ans == assigned.lower()
            if is_correct:
                self.json({
                    "success": True,
                    "correct": True,
                    "color": assigned,
                    "message": f"Solved! Your authentic key color is {assigned}.",
                })
            else:
                self.json({
                    "success": True,
                    "correct": False,
                    "message": "Not quite! Think about the clues in the riddle, or skip to brute-force.",
                })
            return

        # ── Level 2: complete ─────────────────────────────────────────────────
        if path == "/api/level2/complete":
            if GAME_ENDED:
                self.json({"error": "Game has ended.", "game_ended": True}, 403); return
            team = get_team_by_token(token)
            if not team:
                self.json({"error": "Invalid session. Please log in again."}, 401); return
            level = team.get("current_level", 1)
            if level < 2:
                self.json({"error": "Team has not unlocked Level 2.", "current_level": level}, 400); return
            try:
                elapsed_ms = int(body.get("elapsed_ms", 0))
                maze_round = int(body.get("round", 0))
            except (ValueError, TypeError):
                elapsed_ms, maze_round = 0, 0
            now_iso = datetime.now().isoformat()
            update_state(team["id"], 2, {
                "is_winner": True,
                "won_at": now_iso,
                "questions_solved": maze_round,
                "numbers_collected": [{"elapsed_ms": elapsed_ms, "round": maze_round, "completed": True}],
            })
            sb_patch("teams", {"id": f"eq.{team['id']}"}, {"current_level": 3})
            get_or_create_state(team["id"], 3)
            broadcast("team_progress", {
                "team_name": team["team_name"],
                "level": 3,
                "level2_completed": True,
                "elapsed_ms": elapsed_ms,
                "round": maze_round,
            })
            broadcast("team_level_changed", {"team_name": team["team_name"], "level": 3})
            self.json({
                "success": True,
                "message": "Stage 02 complete! Unlocked Stage 03.",
                "current_level": 3,
                "elapsed_ms": elapsed_ms,
                "round": maze_round,
                "won_at": now_iso,
            })
            return

        # ── Admin: reset ──────────────────────────────────────────────────────
        if path == "/api/admin/reset":
            pc = body.get("passcode", "").strip()
            if pc != ADMIN_PASSWORD:
                self.json({"error": "Unauthorized"}, 401); return
            target = body.get("team_name", "").strip()
            if target:
                t = sb_one("teams", {"team_name": f"eq.{target}"})
                if t:
                    sb_del("team_state", {"team_id": f"eq.{t['id']}"})
                    sb_patch("teams", {"id": f"eq.{t['id']}"}, {"current_level": 1})
            else:
                all_teams = sb_get("teams", select="id")
                for t in all_teams:
                    sb_del("team_state",  {"team_id": f"eq.{t['id']}"})
                    sb_patch("teams", {"id": f"eq.{t['id']}"}, {"current_level": 1})
            broadcast("game_reset", {"target_team": target or "all"})
            self.json({"success": True, "message": "Reset completed successfully."})
            return

        # ── Admin: broadcast ──────────────────────────────────────────────────
        if path == "/api/admin/broadcast":
            pc = body.get("passcode", "").strip()
            if pc != ADMIN_PASSWORD:
                self.json({"error": "Unauthorized"}, 401); return
            msg = body.get("message", "").strip()
            if msg:
                broadcast("admin_broadcast", {
                    "message": msg, "time": datetime.now().strftime("%H:%M:%S"),
                })
            self.json({"success": True})
            return

        # ── Admin: toggle anti-cheat ──────────────────────────────────────────
        if path == "/api/admin/set-anticheat":
            pc = body.get("passcode", "").strip()
            if pc != ADMIN_PASSWORD:
                self.json({"error": "Unauthorized"}, 401); return
            ANTICHEAT_ENABLED = bool(body.get("enabled", False))
            save_game_setting("anticheat_enabled", ANTICHEAT_ENABLED)
            broadcast("anticheat_changed", {"enabled": ANTICHEAT_ENABLED})
            self.json({"success": True, "anticheat_enabled": ANTICHEAT_ENABLED})
            return

        # ── Admin: end / resume game ──────────────────────────────────────────
        if path == "/api/admin/end-game":
            pc = body.get("passcode", "").strip()
            if pc != ADMIN_PASSWORD:
                self.json({"error": "Unauthorized"}, 401); return
            GAME_ENDED = bool(body.get("ended", True))
            save_game_setting("game_ended", GAME_ENDED)
            ev = "game_ended" if GAME_ENDED else "game_resumed"
            broadcast(ev, {"ended": GAME_ENDED})
            self.json({"success": True, "ended": GAME_ENDED})
            return

        # ── Admin: set ticket hit probability ──────────────────────────────────
        if path == "/api/admin/set-ticket-hit-chance":
            pc = body.get("passcode", "").strip()
            if pc != ADMIN_PASSWORD:
                self.json({"error": "Unauthorized"}, 401); return
            try:
                raw_val = body.get("chance")
                if raw_val is None:
                    raw_val = float(body.get("percent", 70)) / 100.0
                chance = max(0.01, min(1.0, float(raw_val)))
            except (ValueError, TypeError):
                self.json({"error": "Invalid probability value (must be 0.01 to 1.0 or 1 to 100)"}, 400); return
            TICKET_HIT_CHANCE = round(chance, 2)
            save_game_setting("ticket_hit_chance", TICKET_HIT_CHANCE)
            broadcast("ticket_hit_chance_changed", {"ticket_hit_chance": TICKET_HIT_CHANCE})
            print(f"[SETTINGS] Admin updated ticket hit chance to {int(TICKET_HIT_CHANCE * 100)}%", flush=True)
            self.json({"success": True, "ticket_hit_chance": TICKET_HIT_CHANCE})
            return

        # ── Admin: remove / reinstate team ────────────────────────────────────
        if path == "/api/admin/remove-team":
            pc = body.get("passcode", "").strip()
            if pc != ADMIN_PASSWORD:
                self.json({"error": "Unauthorized"}, 401); return
            target_name = body.get("team_name", "").strip()
            removed_val = bool(body.get("removed", True))
            t = sb_one("teams", {"team_name": f"eq.{target_name}"})
            if not t:
                self.json({"error": "Team not found."}, 404); return
            level = t.get("current_level", 1)
            # Ensure state exists then patch removed flag
            get_or_create_state(t["id"], level)
            sb_patch("team_state", {
                "team_id": f"eq.{t['id']}",
                "level":   f"eq.{level}",
            }, {"removed": removed_val})
            broadcast("team_removed", {"team_name": target_name, "removed": removed_val})
            self.json({"success": True})
            return

        # ── Admin: set team level (advance / demote) ───────────────────────────
        if path == "/api/admin/set-team-level":
            pc = body.get("passcode", "").strip()
            if pc != ADMIN_PASSWORD:
                self.json({"error": "Unauthorized"}, 401); return
            target_name = body.get("team_name", "").strip()
            try:
                new_level = int(body.get("level", 1))
            except (ValueError, TypeError):
                new_level = 1
            t = sb_one("teams", {"team_name": f"eq.{target_name}"})
            if not t:
                self.json({"error": "Team not found."}, 404); return
            sb_patch("teams", {"id": f"eq.{t['id']}"}, {"current_level": new_level})
            get_or_create_state(t["id"], new_level)
            broadcast("team_level_changed", {"team_name": target_name, "level": new_level})
            self.json({"success": True, "team_name": target_name, "current_level": new_level})
            return

        self.json({"error": "Not found"}, 404)


# ─────────────────────────────────────────────────────────────────────────────
# SERVER STARTUP
# ─────────────────────────────────────────────────────────────────────────────
class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

def run():
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    load_game_settings()
    httpd = ThreadedServer(("", PORT), Handler)
    print("=" * 66, flush=True)
    print(f"  Brain Breaker   →  http://localhost:{PORT}", flush=True)
    print(f"  Admin Panel     →  http://localhost:{PORT}/admin", flush=True)
    print(f"  Admin Password  →  {ADMIN_PASSWORD}", flush=True)
    print(f"  Ticket Hit Rate →  {int(TICKET_HIT_CHANCE * 100)}% (env: TICKET_HIT_CHANCE={TICKET_HIT_CHANCE})", flush=True)
    print(f"  Supabase URL    →  {SUPABASE_URL}", flush=True)
    print("=" * 66, flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...", flush=True)
        httpd.server_close()

if __name__ == "__main__":
    run()
