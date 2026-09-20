import http.server
import socketserver
import json
import os
import sys
import random
import time
import csv
import urllib.parse
from datetime import datetime
import threading

PORT = int(os.environ.get("PORT", 8000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DATA_FILE = os.path.join(BASE_DIR, "game_state.json")
QUESTIONS_CSV = os.path.join(BASE_DIR, "questions.csv")

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "BMS123")

# Questions storage and auto-reload on modification
CACHED_QUESTIONS = []
QUESTIONS_MTIME = 0
questions_lock = threading.RLock()

def load_questions_from_csv():
    global CACHED_QUESTIONS, QUESTIONS_MTIME
    with questions_lock:
        if not os.path.exists(QUESTIONS_CSV):
            print(f"Warning: {QUESTIONS_CSV} not found!")
            return CACHED_QUESTIONS

        current_mtime = os.path.getmtime(QUESTIONS_CSV)
        if current_mtime != QUESTIONS_MTIME or not CACHED_QUESTIONS:
            loaded = []
            try:
                with open(QUESTIONS_CSV, "r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for idx, row in enumerate(reader):
                        q_no = row.get("ques no.", str(idx + 1)).strip()
                        q_text = row.get("question", "").strip()
                        topic = row.get("topic name", "General").strip()
                        ans_str = row.get("answer", "").strip()
                        
                        # Support multiple acceptable answers if separated by semicolon or pipe
                        answers = [a.strip() for a in ans_str.replace("|", ";").split(";") if a.strip()]
                        if not answers and ans_str:
                            answers = [ans_str]

                        if q_text:
                            loaded.append({
                                "id": int(q_no) if q_no.isdigit() else (idx + 1),
                                "category": topic.upper(),
                                "question": q_text,
                                "answers": answers
                            })
                CACHED_QUESTIONS = loaded
                QUESTIONS_MTIME = current_mtime
                print(f"[CSV Loader] Loaded {len(CACHED_QUESTIONS)} questions from questions.csv (mtime: {QUESTIONS_MTIME})")
            except Exception as e:
                print(f"Error loading questions.csv: {e}")
        return CACHED_QUESTIONS

# Initial load
load_questions_from_csv()

# Global in-memory game state with persistence
GAME_STATE = {
    "teams": {},
    "admin_passcode": ADMIN_PASSWORD
}
state_lock = threading.RLock()

# SSE Subscribers
sse_clients = []
sse_lock = threading.RLock()

def broadcast_event(event_type, payload):
    data = json.dumps({"type": event_type, "data": payload, "timestamp": time.time()})
    msg = f"data: {data}\n\n".encode("utf-8")
    with sse_lock:
        dead = []
        for client in sse_clients:
            try:
                client.wfile.write(msg)
                client.wfile.flush()
            except Exception:
                dead.append(client)
        for client in dead:
            if client in sse_clients:
                sse_clients.remove(client)

def load_state():
    global GAME_STATE
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                GAME_STATE.update(saved)
                GAME_STATE["admin_passcode"] = ADMIN_PASSWORD
        except Exception as e:
            print("Error loading state:", e)

def save_state():
    with state_lock:
        try:
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(GAME_STATE, f, indent=2)
        except Exception as e:
            print("Error saving state:", e)

# Authentic Indian Tambola (90-ball) ticket generator
def generate_tambola_ticket():
    col_ranges = [
        (1, 9), (10, 19), (20, 29), (30, 39), (40, 49),
        (50, 59), (60, 69), (70, 79), (80, 90)
    ]
    
    while True:
        col_counts = [1] * 9
        remaining_needed = 15 - 9
        col_indices = list(range(9))
        random.shuffle(col_indices)
        for c in col_indices:
            if remaining_needed == 0:
                break
            add = random.choice([1, 2])
            if add > remaining_needed:
                add = remaining_needed
            if col_counts[c] + add <= 3:
                col_counts[c] += add
                remaining_needed -= add
                
        if sum(col_counts) != 15:
            continue

        col_numbers = []
        for c in range(9):
            low, high = col_ranges[c]
            nums = sorted(random.sample(range(low, high + 1), col_counts[c]))
            col_numbers.append(nums)

        grid = [[None for _ in range(9)] for _ in range(3)]
        row_counts = [0, 0, 0]
        
        for c in range(9):
            if col_counts[c] == 3:
                grid[0][c] = col_numbers[c][0]
                grid[1][c] = col_numbers[c][1]
                grid[2][c] = col_numbers[c][2]
                row_counts[0] += 1
                row_counts[1] += 1
                row_counts[2] += 1

        col_2 = [c for c in range(9) if col_counts[c] == 2]
        col_1 = [c for c in range(9) if col_counts[c] == 1]
        
        def solve_placement(c_idx_list, is_two_col):
            if not c_idx_list:
                return True
            col = c_idx_list[0]
            rest = c_idx_list[1:]
            
            if is_two_col:
                row_pairs = [(0, 1), (0, 2), (1, 2)]
                random.shuffle(row_pairs)
                for r1, r2 in row_pairs:
                    if row_counts[r1] < 5 and row_counts[r2] < 5:
                        grid[r1][col] = col_numbers[col][0]
                        grid[r2][col] = col_numbers[col][1]
                        row_counts[r1] += 1
                        row_counts[r2] += 1
                        if solve_placement(rest, True):
                            return True
                        grid[r1][col] = None
                        grid[r2][col] = None
                        row_counts[r1] -= 1
                        row_counts[r2] -= 1
                return False
            else:
                rows = [0, 1, 2]
                random.shuffle(rows)
                for r in rows:
                    if row_counts[r] < 5:
                        grid[r][col] = col_numbers[col][0]
                        row_counts[r] += 1
                        if solve_placement(rest, False):
                            return True
                        grid[r][col] = None
                        row_counts[r] -= 1
                return False

        if solve_placement(col_2, True) and solve_placement(col_1, False):
            if all(c == 5 for c in row_counts):
                for c in range(9):
                    non_empty = [grid[r][c] for r in range(3) if grid[r][c] is not None]
                    non_empty.sort()
                    idx = 0
                    for r in range(3):
                        if grid[r][c] is not None:
                            grid[r][c] = non_empty[idx]
                            idx += 1
                all_nums = [n for row in grid for n in row if n is not None]
                if len(all_nums) == 15 and len(set(all_nums)) == 15:
                    return grid

def normalize_string(s):
    if s is None:
        return ""
    import re
    s = str(s).strip().lower()
    s = re.sub(r'\s+', ' ', s)
    return s

def check_answer(user_ans, acceptable_answers):
    u = normalize_string(user_ans)
    if not u:
        return False
    for a in acceptable_answers:
        norm_a = normalize_string(a)
        if u == norm_a:
            return True
        try:
            if float(u) == float(norm_a):
                return True
        except ValueError:
            pass
    return False

def init_team(team_name, color=None, avatar=None):
    team_name = team_name.strip()
    questions = load_questions_from_csv()
    with state_lock:
        if team_name in GAME_STATE["teams"]:
            team = GAME_STATE["teams"][team_name]
            team["last_active"] = datetime.now().isoformat()
            if color: team["color"] = color
            if avatar: team["avatar"] = avatar
            return team

        ticket = generate_tambola_ticket()
        ticket_nums = [n for row in ticket for n in row if n is not None]
        
        q_order = list(range(len(questions)))
        random.shuffle(q_order)

        team = {
            "team_name": team_name,
            "color": color or "#3b82f6",
            "avatar": avatar or "🚀",
            "ticket": ticket,
            "ticket_numbers": ticket_nums,
            "numbers_hit": [],
            "numbers_collected": [],
            "questions_solved": 0,
            "questions_skipped": 0,
            "current_question_cursor": 0,
            "question_order": q_order,
            "is_winner": False,
            "won_at": None,
            "created_at": datetime.now().isoformat(),
            "last_active": datetime.now().isoformat()
        }
        GAME_STATE["teams"][team_name] = team
        save_state()
        return team

class TambolaRequestHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_data(self, content, content_type="text/html; charset=utf-8", status_code=200):
        try:
            self.send_response(status_code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(content)
            self.wfile.flush()
        except Exception:
            pass

    def send_json_response(self, data, status_code=200):
        body = json.dumps(data).encode("utf-8")
        self.send_data(body, content_type="application/json; charset=utf-8", status_code=status_code)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # SSE Endpoint for Real-Time synchronization
        if path == "/api/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            
            with sse_lock:
                sse_clients.append(self)
                
            init_msg = f"data: {json.dumps({'type': 'connected', 'teams_count': len(GAME_STATE['teams'])})}\n\n"
            self.wfile.write(init_msg.encode("utf-8"))
            self.wfile.flush()

            try:
                while True:
                    time.sleep(15)
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except Exception:
                with sse_lock:
                    if self in sse_clients:
                        sse_clients.remove(self)
            return

        # API: Get team state & current question
        if path == "/api/state":
            team_name = query.get("team", [""])[0].strip()
            if not team_name:
                self.send_json_response({"error": "Team name required"}, 400)
                return
            
            questions = load_questions_from_csv()
            with state_lock:
                team = GAME_STATE["teams"].get(team_name)
            
            if not team:
                self.send_json_response({"error": "Team not found"}, 404)
                return
            
            cursor = team["current_question_cursor"]
            q_order = team["question_order"]
            
            # Ensure q_order covers any newly added questions
            if len(q_order) < len(questions):
                extra = [i for i in range(len(questions)) if i not in q_order]
                random.shuffle(extra)
                q_order.extend(extra)
                team["question_order"] = q_order

            q_data = None
            if cursor < len(q_order):
                q_idx = q_order[cursor]
                if q_idx < len(questions):
                    raw_q = questions[q_idx]
                    q_data = {
                        "id": raw_q["id"],
                        "category": raw_q["category"],
                        "question": raw_q["question"],
                        "puzzle_number": cursor + 1
                    }

            client_state = {
                "team_name": team["team_name"],
                "color": team.get("color", "#3b82f6"),
                "avatar": team.get("avatar", "🚀"),
                "ticket": team["ticket"],
                "numbers_hit": team["numbers_hit"],
                "numbers_collected": team["numbers_collected"],
                "questions_solved": team["questions_solved"],
                "questions_skipped": team.get("questions_skipped", 0),
                "ticket_numbers_hit_count": len(team["numbers_hit"]),
                "total_ticket_numbers": 15,
                "is_winner": team["is_winner"],
                "won_at": team["won_at"],
                "current_puzzle": q_data,
                "server_time": datetime.now().isoformat()
            }
            self.send_json_response(client_state)
            return

        # API: Admin teams summary (password protected)
        if path == "/api/admin/teams":
            auth_pass = query.get("passcode", [""])[0].strip()
            if not auth_pass:
                # Check auth header
                auth_pass = self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            if auth_pass != ADMIN_PASSWORD:
                self.send_json_response({"error": "Unauthorized: Invalid password"}, 401)
                return

            with state_lock:
                teams_list = []
                for t in GAME_STATE["teams"].values():
                    teams_list.append({
                        "team_name": t["team_name"],
                        "avatar": t.get("avatar", "🚀"),
                        "color": t.get("color", "#3b82f6"),
                        "questions_solved": t["questions_solved"],
                        "questions_skipped": t.get("questions_skipped", 0),
                        "numbers_hit_count": len(t["numbers_hit"]),
                        "numbers_hit": t["numbers_hit"],
                        "ticket": t["ticket"],
                        "numbers_collected_count": len(t["numbers_collected"]),
                        "numbers_collected": t["numbers_collected"],
                        "is_winner": t["is_winner"],
                        "won_at": t["won_at"],
                        "created_at": t.get("created_at"),
                        "last_active": t.get("last_active")
                    })
            teams_list.sort(key=lambda x: (-x["numbers_hit_count"], x["questions_solved"]))
            self.send_json_response({"teams": teams_list, "total_teams": len(teams_list)})
            return

        # Separate Admin Website routing
        if path in ["/admin", "/admin/", "/admin.html"]:
            admin_file = os.path.join(PUBLIC_DIR, "admin.html")
            if os.path.exists(admin_file):
                with open(admin_file, "rb") as f:
                    content = f.read()
                self.send_data(content, "text/html; charset=utf-8", 200)
                return

        # Player Website routing: Serve index.html for root and player routes
        if path in ["/", "/index.html"]:
            index_file = os.path.join(PUBLIC_DIR, "index.html")
            if os.path.exists(index_file):
                with open(index_file, "rb") as f:
                    content = f.read()
                self.send_data(content, "text/html; charset=utf-8", 200)
                return

        # Serve static assets from public/
        safe_rel = path.lstrip("/\\")
        file_path = os.path.join(PUBLIC_DIR, safe_rel)
        if safe_rel and os.path.isfile(file_path):
            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                c_type = "application/octet-stream"
                if file_path.endswith(".js"): c_type = "application/javascript"
                elif file_path.endswith(".css"): c_type = "text/css"
                elif file_path.endswith(".json"): c_type = "application/json"
                elif file_path.endswith(".png"): c_type = "image/png"
                elif file_path.endswith(".ico"): c_type = "image/x-icon"
                self.send_data(content, c_type, 200)
                return
            except Exception:
                pass

        self.send_json_response({"error": "Resource not found"}, 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_len = int(self.headers.get('Content-Length', 0))
        post_body = self.rfile.read(content_len) if content_len > 0 else b"{}"
        try:
            payload = json.loads(post_body.decode('utf-8'))
        except Exception:
            payload = {}

        # API: Admin Login
        if path == "/api/admin/login":
            password = payload.get("password", "").strip()
            if password == ADMIN_PASSWORD:
                self.send_json_response({"success": True, "token": ADMIN_PASSWORD})
            else:
                self.send_json_response({"success": False, "error": "Invalid Admin Password"}, 401)
            return

        # API: Register / Join Team
        if path == "/api/register":
            team_name = payload.get("team_name", "").strip()
            color = payload.get("color", "#3b82f6")
            avatar = payload.get("avatar", "🚀")
            if not team_name:
                self.send_json_response({"error": "Team name cannot be empty"}, 400)
                return

            team = init_team(team_name, color, avatar)
            broadcast_event("team_joined", {
                "team_name": team["team_name"],
                "avatar": team["avatar"],
                "color": team["color"]
            })
            self.send_json_response({
                "success": True,
                "team_name": team["team_name"],
                "message": "Welcome to Tambola Puzzle Arena!"
            })
            return

        # API: Skip Puzzle
        if path == "/api/skip-puzzle":
            team_name = payload.get("team_name", "").strip()
            if not team_name:
                self.send_json_response({"error": "Team name required"}, 400)
                return

            questions = load_questions_from_csv()
            with state_lock:
                team = GAME_STATE["teams"].get(team_name)
                if not team:
                    self.send_json_response({"error": "Team not found"}, 404)
                    return

                # Advance cursor
                team["current_question_cursor"] += 1
                team["questions_skipped"] = team.get("questions_skipped", 0) + 1
                team["last_active"] = datetime.now().isoformat()
                save_state()

                # Next question data
                cursor = team["current_question_cursor"]
                q_order = team["question_order"]
                next_q = None
                if cursor < len(q_order) and q_order[cursor] < len(questions):
                    raw_q = questions[q_order[cursor]]
                    next_q = {
                        "id": raw_q["id"],
                        "category": raw_q["category"],
                        "question": raw_q["question"],
                        "puzzle_number": cursor + 1
                    }

            broadcast_event("team_progress", {
                "team_name": team["team_name"],
                "questions_solved": team["questions_solved"],
                "questions_skipped": team["questions_skipped"],
                "numbers_hit_count": len(team["numbers_hit"]),
                "skipped": True
            })

            self.send_json_response({
                "success": True,
                "skipped": True,
                "next_puzzle": next_q
            })
            return

        # API: Submit answer
        if path == "/api/submit-answer":
            team_name = payload.get("team_name", "").strip()
            answer = payload.get("answer", "").strip()

            if not team_name:
                self.send_json_response({"error": "Team name required"}, 400)
                return

            questions = load_questions_from_csv()
            with state_lock:
                team = GAME_STATE["teams"].get(team_name)
                if not team:
                    self.send_json_response({"error": "Team not found"}, 404)
                    return

                cursor = team["current_question_cursor"]
                q_order = team["question_order"]
                if cursor >= len(q_order) or q_order[cursor] >= len(questions):
                    self.send_json_response({"error": "All questions have been completed!"}, 400)
                    return

                q_idx = q_order[cursor]
                raw_q = questions[q_idx]

                is_correct = check_answer(answer, raw_q["answers"])
                if not is_correct:
                    self.send_json_response({
                        "success": False,
                        "correct": False,
                        "message": "Incorrect answer. Try again, or click Skip Puzzle!"
                    })
                    return

                # Award a unique random number from 1 to 90 without repeating previously awarded numbers
                already_collected = {item["number"] for item in team["numbers_collected"]}
                available_numbers = [n for n in range(1, 91) if n not in already_collected]

                if not available_numbers:
                    # All 90 numbers collected
                    awarded_number = None
                else:
                    awarded_number = random.choice(available_numbers)

                is_ticket_hit = False
                if awarded_number is not None:
                    is_ticket_hit = awarded_number in team["ticket_numbers"]
                    if is_ticket_hit and awarded_number not in team["numbers_hit"]:
                        team["numbers_hit"].append(awarded_number)

                    team["numbers_collected"].append({
                        "number": awarded_number,
                        "hit": is_ticket_hit,
                        "at": datetime.now().isoformat(),
                        "question_id": raw_q["id"]
                    })

                team["questions_solved"] += 1
                team["current_question_cursor"] += 1
                team["last_active"] = datetime.now().isoformat()

                # Check Full House win condition (all 15 numbers hit)
                if len(team["numbers_hit"]) >= 15 and not team["is_winner"]:
                    team["is_winner"] = True
                    team["won_at"] = datetime.now().isoformat()

                save_state()

                # Broadcast live update
                broadcast_event("team_progress", {
                    "team_name": team["team_name"],
                    "questions_solved": team["questions_solved"],
                    "questions_skipped": team.get("questions_skipped", 0),
                    "numbers_hit_count": len(team["numbers_hit"]),
                    "awarded_number": awarded_number,
                    "hit": is_ticket_hit,
                    "is_winner": team["is_winner"]
                })

                # Prepare next question
                next_cursor = team["current_question_cursor"]
                next_q_data = None
                if next_cursor < len(q_order) and q_order[next_cursor] < len(questions):
                    next_raw = questions[q_order[next_cursor]]
                    next_q_data = {
                        "id": next_raw["id"],
                        "category": next_raw["category"],
                        "question": next_raw["question"],
                        "puzzle_number": next_cursor + 1
                    }

                self.send_json_response({
                    "success": True,
                    "correct": True,
                    "awarded_number": awarded_number,
                    "hit": is_ticket_hit,
                    "numbers_hit": team["numbers_hit"],
                    "numbers_hit_count": len(team["numbers_hit"]),
                    "questions_solved": team["questions_solved"],
                    "is_winner": team["is_winner"],
                    "won_at": team["won_at"],
                    "next_puzzle": next_q_data
                })
            return

        # API: Admin Reset (protected with BMS123)
        if path == "/api/admin/reset":
            passcode = payload.get("passcode", "")
            target_team = payload.get("team_name", "")
            if passcode != ADMIN_PASSWORD:
                self.send_json_response({"error": "Unauthorized: Invalid passcode"}, 401)
                return

            with state_lock:
                if target_team:
                    if target_team in GAME_STATE["teams"]:
                        del GAME_STATE["teams"][target_team]
                else:
                    GAME_STATE["teams"] = {}
                save_state()

            broadcast_event("game_reset", {"target_team": target_team or "all"})
            self.send_json_response({"success": True, "message": "Reset completed successfully"})
            return

        # API: Admin Broadcast (protected with BMS123)
        if path == "/api/admin/broadcast":
            passcode = payload.get("passcode", "")
            message = payload.get("message", "").strip()
            if passcode != ADMIN_PASSWORD:
                self.send_json_response({"error": "Unauthorized: Invalid passcode"}, 401)
                return
            if message:
                broadcast_event("admin_broadcast", {"message": message, "time": datetime.now().strftime("%H:%M:%S")})
            self.send_json_response({"success": True})
            return

        self.send_json_response({"error": "Not Found"}, 404)

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

def run():
    load_state()
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    server_address = ('', PORT)
    httpd = ThreadedHTTPServer(server_address, TambolaRequestHandler)
    print(f"================================================================", flush=True)
    print(f"  Tambola Puzzle Game Server running at: http://localhost:{PORT}", flush=True)
    print(f"  Admin Dashboard available at:         http://localhost:{PORT}/admin", flush=True)
    print(f"  Admin Password:                       {ADMIN_PASSWORD}", flush=True)
    print(f"  Questions CSV Database:               {QUESTIONS_CSV}", flush=True)
    print(f"================================================================", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer shutting down gracefully...", flush=True)
        httpd.server_close()

if __name__ == "__main__":
    run()
