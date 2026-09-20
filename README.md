# 🎟️ Tambola Puzzle Arena

An interactive, authentic multiplayer Tambola (Housie) web application where teams earn numbers toward their randomly generated 15-number ticket by solving college-level aptitude, math, coding logic, and reasoning puzzles.

---

## 🚀 How to Run

### Quick Option:
Double-click [`run.bat`](run.bat) in this folder. It launches the Python server and automatically opens the player website in your default browser!

### Terminal Option:
```powershell
python -u server.py
```

- **Player / Team Arena**: [http://localhost:8000](http://localhost:8000)
- **Admin Control Center**: [http://localhost:8000/admin](http://localhost:8000/admin) *(Passcode: `BMS123`)*

### Custom Admin Passcode / Cloud Deployment:
The default passcode `BMS123` is only used when no `ADMIN_PASSWORD` environment variable is set. If you deploy this to a host like Render or Railway, set an `ADMIN_PASSWORD` environment variable in that platform's dashboard to use your own private passcode instead — this keeps it out of the source code, which matters if your repo is public. The server also reads `PORT` from the environment automatically (falls back to `8000` locally), so cloud hosts that assign their own port work with no code changes.

---

## 📊 Editing Questions in Excel (`questions.csv`)

The questions dataset is stored in **[`questions.csv`](questions.csv)**.
You can open and edit this file directly in **Microsoft Excel**:

| Column Name | Description |
| :--- | :--- |
| `ques no.` | Sequential question number |
| `question` | Full question text (supports text, equations, code snippets) |
| `topic name` | Topic category badge shown to players (`Aptitude`, `Coding`, `Reasoning`, `Math`, `Riddle`) |
| `answer` | The acceptable answer. (Separate multiple acceptable answers with a semicolon `;` e.g. `12; 12s; 12 seconds`) |

Whenever you save changes in `questions.csv`, the game automatically detects the update and serves the new questions to players without restarting the server!

---

## 🎮 Game Rules & Features

1. **Clean Team Entry**: Teams simply enter their Team Name and choose an avatar to start.
2. **Authentic 3×9 Tambola Ticket**:
   - 15 unique numbers strictly following standard Indian Tambola rules (5 numbers per row, column ranges 1–9, 10–19, ..., 80–90, sorted vertically).
   - Animated emerald-green ink dabber mark with sound effects whenever an awarded number hits the ticket.
3. **Random Numbers 1–90 Without Repeats**:
   - Every correctly answered puzzle awards a randomly chosen number between 1 and 90 that has not been previously awarded to that team.
   - If the number matches the team's ticket, it stamps the cell green.
   - If not, it is stored in the team's collection tray.
4. **Skip Puzzle Option**:
   - If players don't know the answer, they can click **Skip Puzzle ⏭** to move directly to the next question.
5. **Full House Victory**:
   - The first team to hit all 15 ticket numbers wins the Full House with confetti celebration.
6. **Dedicated Admin Portal (`/admin`)**:
   - Completely separate website with password authentication (**`BMS123`**).
   - Live tracking of all teams, questions answered, questions skipped, and numbers hit ($0–15$).
   - Inspect tool to view any team's live ticket and drawn numbers.
   - Announcement broadcast tool to send banners to all active players.
   - Game reset controls.
