import urllib.request
import urllib.parse
import json
import time
import threading
import server

def test_api():
    # Start server in daemon thread
    server_address = ('127.0.0.1', 8145)
    server.PORT = 8145
    httpd = server.ThreadedHTTPServer(server_address, server.TambolaRequestHandler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    time.sleep(0.5)

    base = "http://127.0.0.1:8145"
    print("Testing server API on", base)

    # 1. Test index page
    with urllib.request.urlopen(f"{base}/") as res:
        assert res.status == 200
        html = res.read().decode("utf-8")
        assert "TAMBOLA" in html
        print("[PASS] Index page served correctly")

    # 2. Test Team Registration
    reg_data = json.dumps({"team_name": "TestTeam", "avatar": "🚀"}).encode("utf-8")
    req = urllib.request.Request(f"{base}/api/register", data=reg_data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as res:
        assert res.status == 200
        resp = json.loads(res.read().decode("utf-8"))
        assert resp["success"] is True
        print("[PASS] Team registration successful")

    # 3. Test Team State Fetch
    with urllib.request.urlopen(f"{base}/api/state?team=TestTeam") as res:
        assert res.status == 200
        state = json.loads(res.read().decode("utf-8"))
        assert state["team_name"] == "TestTeam"
        assert len(state["ticket"]) == 3
        assert state["current_puzzle"] is not None
        puzzle = state["current_puzzle"]
        print(f"[PASS] State retrieved. Current puzzle #{puzzle['puzzle_number']} ({puzzle['category']})")

    # 4. Test Answer Submission (get acceptable answer for the current puzzle)
    curr_q_id = puzzle["id"]
    all_questions = server.load_questions_from_csv()
    target_q = next(q for q in all_questions if q["id"] == curr_q_id)
    correct_ans = target_q["answers"][0]

    ans_data = json.dumps({"team_name": "TestTeam", "answer": correct_ans}).encode("utf-8")
    req = urllib.request.Request(f"{base}/api/submit-answer", data=ans_data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as res:
        assert res.status == 200
        ans_resp = json.loads(res.read().decode("utf-8"))
        assert ans_resp["correct"] is True
        assert "awarded_number" in ans_resp
        print(f"[PASS] Answer submitted correctly! Awarded number: {ans_resp['awarded_number']}, Ticket Hit: {ans_resp['hit']}")

    # 5. Test Admin View
    with urllib.request.urlopen(f"{base}/api/admin/teams?passcode={server.ADMIN_PASSWORD}") as res:
        assert res.status == 200
        admin_data = json.loads(res.read().decode("utf-8"))
        assert admin_data["total_teams"] >= 1
        print(f"[PASS] Admin view verified. Teams registered: {admin_data['total_teams']}")

    # Shutdown
    httpd.shutdown()
    httpd.server_close()
    print("ALL API TESTS COMPLETED SUCCESSFULLY!", flush=True)
    import sys
    sys.exit(0)

if __name__ == "__main__":
    test_api()
