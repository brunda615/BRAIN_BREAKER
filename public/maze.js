/**
 * BRAIN BREAKER — Stage 02: Fog Maze Game Engine & Renderer
 *
 * Pure Vanilla JavaScript + HTML5 Canvas
 *
 * Original logic unchanged. ONLY ADDITION:
 * - Wrong key reverses the controls until START is reached (CONFIG.disorient, optional)
 * - Weak / flickering lamp — visibility varies dynamically
 *   (CONFIG.flicker, state.lamp, updateLamp(), and the fog gradient in renderScene)
 *
 * FEATURES
 * - 31x31 maze, DFS base + controlled loops, dead ends
 * - Four keys RED / BLUE / GREEN / YELLOW, exactly ONE correct (persists all game)
 * - Keys far from START and strongly separated
 * - Wrong key -> forced return to START, same maze, new key positions, same colour
 * - Fog of war, no page refresh
 * - Ctrl + Shift + D = developer debug mode
 * - onSuccess callback for Stage 3 integration
 */

(function (window) {
  'use strict';

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  const CONFIG = {
    cols: 31,
    rows: 31,

    // MOVEMENT
    playerSpeed: 8.6,
    inputBufferMs: 220,

    // FOG
    sightRadius: 3.2,
    sightFalloff: 2.5,
    memoryAlpha: 0.13,

    // FLICKERING LAMP (NEW)
    flicker: {
      enabled: true,
      minGapMs: 900,      // time between flicker events
      maxGapMs: 2500,
      dipMinMs: 260,       // length of one flicker
      dipMaxMs: 780,
      minIntensity: 0.01,   // lamp never goes fully dark
      radiusFloor: 0.15    // smallest sight radius multiplier
    },

    // KEYS
    keyCount: 4,
    minKeyDistanceFromStart: 22,
    minKeySeparation: 10,

    // MAZE COMPLEXITY
    extraConnections: 70,

    // WRONG KEY
    wrongFeedbackMs: 650,

    // DISORIENTED CONTROLS (NEW, optional)
    // After a wrong key the controls are reversed (W = down, S = up, D = left, A = right)
    // until the player is back at START (or for durationMs if untilStart is false).
    // Set enabled:false to turn off.
    disorient: {
      enabled: true,
      untilStart: true,   // true = reversed until the player is back at START
      durationMs: 3000    // only used when untilStart is false
    },

    // DEBUG (Ctrl + Shift + D reveals the maze and the correct key; organizer-only, local development)
    debugShortcut: window.location.hostname === 'localhost'
  };

  const KEY_COLORS = ['RED', 'BLUE', 'GREEN', 'YELLOW'];

  const KEY_HEX = {
    RED: '#ff4d6d',
    BLUE: '#4fa8ff',
    GREEN: '#3df5a5',
    YELLOW: '#ffd166'
  };

  const PALETTE = {
    void: '#04060d',
    floor: '#0a1022',
    floorLit: '#111c38',
    wall: '#2f5a94',
    wallGlow: '#4fd8ff',
    player: '#7ef0ff',
    start: '#4fd8ff',
    wrong: '#ff4d6d',
    success: '#3df5a5'
  };

  const WALL = { N: 1, E: 2, S: 4, W: 8 };

  const VECTORS = {
    up: { dc: 0, dr: -1 },
    down: { dc: 0, dr: 1 },
    left: { dc: -1, dr: 0 },
    right: { dc: 1, dr: 0 }
  };

  // ==========================================================================
  // BASIC HELPERS
  // ==========================================================================

  function index(maze, col, row) {
    return row * maze.cols + col;
  }

  function inBounds(maze, col, row) {
    return col >= 0 && row >= 0 && col < maze.cols && row < maze.rows;
  }

  function sameCell(a, b) {
    return !!(a && b && a.col === b.col && a.row === b.row);
  }

  function shuffle(items) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = out[i];
      out[i] = out[j];
      out[j] = temp;
    }
    return out;
  }

  function normalizeColor(color) {
    if (!color) return null;
    const normalized = String(color).trim().toUpperCase();
    return KEY_COLORS.includes(normalized) ? normalized : null;
  }

  // ==========================================================================
  // MOVEMENT / WALL CHECK
  // ==========================================================================

  function canMove(maze, col, row, dc, dr) {
    const nextCol = col + dc;
    const nextRow = row + dr;

    if (!inBounds(maze, nextCol, nextRow)) return false;

    const mask = maze.walls[index(maze, col, row)];

    if (dr === -1) return (mask & WALL.N) === 0;
    if (dr === 1) return (mask & WALL.S) === 0;
    if (dc === -1) return (mask & WALL.W) === 0;
    if (dc === 1) return (mask & WALL.E) === 0;

    return false;
  }

  // ==========================================================================
  // MAZE HELPERS
  // ==========================================================================

  function countWalls(mask) {
    let count = 0;
    if (mask & WALL.N) count += 1;
    if (mask & WALL.E) count += 1;
    if (mask & WALL.S) count += 1;
    if (mask & WALL.W) count += 1;
    return count;
  }

  function findDeadEnds(maze) {
    const deadEnds = [];
    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        const mask = maze.walls[index(maze, col, row)];
        if (countWalls(mask) === 3) deadEnds.push({ col, row });
      }
    }
    return deadEnds;
  }

  function openBetween(maze, a, b) {
    const dc = b.col - a.col;
    const dr = b.row - a.row;
    const aIndex = index(maze, a.col, a.row);
    const bIndex = index(maze, b.col, b.row);

    if (dc === 1) { maze.walls[aIndex] &= ~WALL.E; maze.walls[bIndex] &= ~WALL.W; return true; }
    if (dc === -1) { maze.walls[aIndex] &= ~WALL.W; maze.walls[bIndex] &= ~WALL.E; return true; }
    if (dr === 1) { maze.walls[aIndex] &= ~WALL.S; maze.walls[bIndex] &= ~WALL.N; return true; }
    if (dr === -1) { maze.walls[aIndex] &= ~WALL.N; maze.walls[bIndex] &= ~WALL.S; return true; }

    return false;
  }

  // ==========================================================================
  // ADD LOOPS / ALTERNATE PATHS
  // ==========================================================================

  function addLoops(maze, connectionCount) {
    const possibleConnections = [];

    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        const currentIndex = index(maze, col, row);

        // RIGHT
        if (col < maze.cols - 1) {
          const rightIndex = index(maze, col + 1, row);
          const currentHasWall = Boolean(maze.walls[currentIndex] & WALL.E);
          const rightHasWall = Boolean(maze.walls[rightIndex] & WALL.W);

          if (currentHasWall && rightHasWall) {
            possibleConnections.push({ a: { col, row }, b: { col: col + 1, row } });
          }
        }

        // DOWN
        if (row < maze.rows - 1) {
          const bottomIndex = index(maze, col, row + 1);
          const currentHasWall = Boolean(maze.walls[currentIndex] & WALL.S);
          const bottomHasWall = Boolean(maze.walls[bottomIndex] & WALL.N);

          if (currentHasWall && bottomHasWall) {
            possibleConnections.push({ a: { col, row }, b: { col, row: row + 1 } });
          }
        }
      }
    }

    const shuffled = shuffle(possibleConnections);
    const amount = Math.min(connectionCount, shuffled.length);

    for (let i = 0; i < amount; i += 1) {
      openBetween(maze, shuffled[i].a, shuffled[i].b);
    }

    maze.deadEnds = findDeadEnds(maze);
    return maze;
  }

  // ==========================================================================
  // GENERATE MAZE
  // ==========================================================================

  function generateMaze(cols = CONFIG.cols, rows = CONFIG.rows) {
    const walls = new Uint8Array(cols * rows).fill(WALL.N | WALL.E | WALL.S | WALL.W);
    const visited = new Uint8Array(cols * rows);

    // Start at bottom-left.
    const start = { col: 0, row: rows - 1 };

    const maze = { cols, rows, walls, start, deadEnds: [] };

    const stack = [{ col: start.col, row: start.row }];

    visited[index(maze, start.col, start.row)] = 1;

    const steps = [
      { dc: 0, dr: -1, here: WALL.N, there: WALL.S },
      { dc: 1, dr: 0, here: WALL.E, there: WALL.W },
      { dc: 0, dr: 1, here: WALL.S, there: WALL.N },
      { dc: -1, dr: 0, here: WALL.W, there: WALL.E }
    ];

    // DFS
    while (stack.length > 0) {
      const current = stack[stack.length - 1];

      const options = shuffle(steps).filter(({ dc, dr }) => {
        const nextCol = current.col + dc;
        const nextRow = current.row + dr;

        if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) return false;

        return !visited[nextRow * cols + nextCol];
      });

      if (options.length === 0) {
        stack.pop();
        continue;
      }

      const move = options[0];

      const next = { col: current.col + move.dc, row: current.row + move.dr };

      const currentIndex = index(maze, current.col, current.row);
      const nextIndex = index(maze, next.col, next.row);

      walls[currentIndex] &= ~move.here;
      walls[nextIndex] &= ~move.there;

      visited[nextIndex] = 1;

      stack.push(next);
    }

    // ADD LOOPS
    addLoops(maze, CONFIG.extraConnections);

    maze.deadEnds = findDeadEnds(maze);

    return maze;
  }

  // ==========================================================================
  // DISTANCE FIELD
  // ==========================================================================

  /**
   * Returns a 1D Int32Array. Access using dist[index(maze, col, row)]
   */
  function distanceField(maze, from) {
    const total = maze.cols * maze.rows;
    const dist = new Int32Array(total);
    dist.fill(-1);

    const queue = [{ col: from.col, row: from.row }];

    dist[index(maze, from.col, from.row)] = 0;

    const steps = [
      { dc: 0, dr: -1 },
      { dc: 1, dr: 0 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 }
    ];

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const currentIndex = index(maze, current.col, current.row);
      const base = dist[currentIndex];

      for (const { dc, dr } of steps) {
        if (!canMove(maze, current.col, current.row, dc, dr)) continue;

        const next = { col: current.col + dc, row: current.row + dr };
        const nextIndex = index(maze, next.col, next.row);

        if (dist[nextIndex] !== -1) continue;

        dist[nextIndex] = base + 1;
        queue.push(next);
      }
    }

    return dist;
  }

  // ==========================================================================
  // PATH FINDING
  // ==========================================================================

  function findPath(maze, from, to) {
    const total = maze.cols * maze.rows;
    const visited = new Uint8Array(total);
    const previous = new Int32Array(total);
    previous.fill(-1);

    const queue = [{ col: from.col, row: from.row }];

    const fromIndex = index(maze, from.col, from.row);
    const toIndex = index(maze, to.col, to.row);

    visited[fromIndex] = 1;

    const steps = [
      { dc: 0, dr: -1 },
      { dc: 1, dr: 0 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 }
    ];

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const currentIndex = index(maze, current.col, current.row);

      if (currentIndex === toIndex) break;

      for (const { dc, dr } of steps) {
        if (!canMove(maze, current.col, current.row, dc, dr)) continue;

        const next = { col: current.col + dc, row: current.row + dr };
        const nextIndex = index(maze, next.col, next.row);

        if (visited[nextIndex]) continue;

        visited[nextIndex] = 1;
        previous[nextIndex] = currentIndex;
        queue.push(next);
      }
    }

    if (!visited[toIndex]) return [];

    const path = [];
    let currentIndex = toIndex;

    while (currentIndex !== -1) {
      const row = Math.floor(currentIndex / maze.cols);
      const col = currentIndex % maze.cols;

      path.push({ col, row });

      if (currentIndex === fromIndex) break;

      currentIndex = previous[currentIndex];
    }

    path.reverse();

    return path;
  }

  // ==========================================================================
  // KEY PLACEMENT
  // ==========================================================================

  function euclideanDistance(a, b) {
    const dx = a.col - b.col;
    const dy = a.row - b.row;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function isFarEnoughFromSelected(candidate, selected) {
    return selected.every(
      existing => euclideanDistance(candidate, existing) >= CONFIG.minKeySeparation
    );
  }

  /**
   * Select four positions.
   * Priority: far from START, far from each other, different from previous, prefer dead ends
   */
  function chooseKeyCells(maze, previousCells = []) {
    const dist = distanceField(maze, maze.start);

    const previousSet = new Set(previousCells.map(cell => `${cell.col},${cell.row}`));

    const candidates = [];

    // Prefer dead ends
    for (const cell of maze.deadEnds) {
      const d = dist[index(maze, cell.col, cell.row)];

      if (d < CONFIG.minKeyDistanceFromStart) continue;
      if (sameCell(cell, maze.start)) continue;

      const previous = previousSet.has(`${cell.col},${cell.row}`);

      candidates.push({ col: cell.col, row: cell.row, distance: d, previous });
    }

    // Add other far-away cells
    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        if (sameCell({ col, row }, maze.start)) continue;

        const d = dist[index(maze, col, row)];

        if (d < CONFIG.minKeyDistanceFromStart) continue;

        const already = candidates.some(cell => cell.col === col && cell.row === row);

        if (already) continue;

        candidates.push({
          col,
          row,
          distance: d,
          previous: previousSet.has(`${col},${row}`)
        });
      }
    }

    // Score candidates
    candidates.sort((a, b) => {
      if (a.previous !== b.previous) return a.previous ? 1 : -1;
      return b.distance - a.distance;
    });

    // Randomize candidates with similar distance
    const randomized = shuffle(candidates);

    randomized.sort((a, b) => {
      if (a.previous !== b.previous) return a.previous ? 1 : -1;
      return b.distance - a.distance;
    });

    // Strong separation pass
    const selected = [];

    for (const candidate of randomized) {
      if (selected.length >= CONFIG.keyCount) break;

      if (
        isFarEnoughFromSelected(
          candidate,
          selected
        )
      ) {
        selected.push({
          col: candidate.col,
          row: candidate.row
        });
      }
    }

    // Fallback separation
    if (selected.length < CONFIG.keyCount) {
      for (const candidate of randomized) {
        if (selected.length >= CONFIG.keyCount) break;

        const exists = selected.some(cell => sameCell(cell, candidate));

        if (exists) continue;

        selected.push({
          col: candidate.col,
          row: candidate.row
        });
      }
    }

    if (selected.length < CONFIG.keyCount) {
      throw new Error('Unable to place all four keys.');
    }

    return selected.slice(0, CONFIG.keyCount);
  }

  // ==========================================================================
  // PLACE FOUR COLORED KEYS
  // ==========================================================================

  function placeKeys(maze, correctColor = null, previousCells = [], round = 0) {
    const normalizedCorrect = normalizeColor(correctColor);

    const finalCorrectColor =
      normalizedCorrect || KEY_COLORS[Math.floor(Math.random() * KEY_COLORS.length)];

    const cells =
      chooseKeyCells(
        maze,
        previousCells
      );

    // Three guaranteed wrong colors.
    const wrongColors = shuffle(KEY_COLORS.filter(color => color !== finalCorrectColor));

    // Random physical position for correct key.
    const correctIndex =
      Math.floor(
        Math.random() *
        CONFIG.keyCount
      );

    const colors = [];
    let wrongIndex = 0;

    for (let i = 0; i < CONFIG.keyCount; i += 1) {
      if (i === correctIndex) {
        colors.push(finalCorrectColor);
      } else {
        colors.push(wrongColors[wrongIndex]);
        wrongIndex += 1;
      }
    }

    const keys = cells.map((cell, i) => ({
      id: `key-${round}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      color: colors[i],
      cell: { col: cell.col, row: cell.row },
      collected: false,
      wrong: false
    }));

    return {
      keys,
      // THIS NEVER CHANGES AFTER INITIAL CREATION.
      correctKey: finalCorrectColor
    };
  }

  // ==========================================================================
  // LAMP FLICKER (NEW)
  // ==========================================================================

  function newLamp() {
    const f = CONFIG.flicker;
    return {
      intensity: 1,       // 0..1, smoothed
      radiusScale: 1,     // multiplies sight radius
      alpha: 1,           // multiplies light strength
      eventMs: f.minGapMs + Math.random() * (f.maxGapMs - f.minGapMs) * 0.6,
      dipMs: 0,
      dipTotal: 1,
      dipDepth: 0
    };
  }

  // ==========================================================================
  // GAME ENGINE
  // ==========================================================================

  class GameEngine {
    constructor(initialElapsedMs = 0, initialRound = 0, assignedColor = null) {
      this.assignedColor = normalizeColor(assignedColor);

      this.onSuccess = null;
      this.onWrongKey = null;
      this.onStateChange = null;

      this.state = null;

      this.buildState(initialElapsedMs, initialRound);

      this.setupDebugShortcut();
    }

    // CREATE INITIAL STATE
    buildState(initialElapsedMs = 0, initialRound = 0) {
      const maze = generateMaze();

      const correctColor =
        this.assignedColor || KEY_COLORS[Math.floor(Math.random() * KEY_COLORS.length)];

      const keyData = placeKeys(maze, correctColor, [], initialRound);

      this.state = {
        maze,

        player: {
          col: maze.start.col,
          row: maze.start.row,
          from: { ...maze.start },
          to: { ...maze.start },
          t: 0,
          facing: 'right',
          moving: false
        },

        keys: keyData.keys,

        // PERSISTENT CORRECT COLOR
        correctKey: keyData.correctKey,

        status: 'READY',
        elapsedMs: initialElapsedMs,
        round: initialRound,
        wrongKey: null,
        wrongKeyCount: 0,
        returnPath: [],
        returnPathIndex: 0,
        wrongFeedbackRemainingMs: 0,
        held: [],
        seen: new Uint8Array(maze.cols * maze.rows),
        debug: false,

        // NEW: flickering lamp
        lamp: newLamp(),

        // NEW: remaining time (ms) of reversed controls
        controlsReversedMs: 0
      };

      this.revealAroundPlayer();

      this.notify();
    }

    // START
    start() {
      if (this.state.status !== 'READY') return;

      this.state.status = 'PLAYING';
      this.state.wrongKey = null;

      this.releaseAll();
      this.revealAroundPlayer();
      this.notify();
    }

    // ASSIGNED COLOR
    setAssignedColor(color) {
      const normalized = normalizeColor(color);

      if (!normalized) return false;

      this.assignedColor = normalized;

      // Only allow external assignment before gameplay.
      if (this.state.status !== 'READY') return false;

      // Recreate key colors while keeping same maze.
      const keyData = placeKeys(this.state.maze, normalized, [], this.state.round);

      this.state.keys = keyData.keys;
      this.state.correctKey = normalized;

      this.notify();

      return true;
    }

    // RESET AFTER WRONG KEY
    resetAfterWrongKey() {
      const maze = this.state.maze;
      const oldCorrectColor = this.state.correctKey;

      const previousCells = this.state.keys.map(key => ({
        col: key.cell.col,
        row: key.cell.row
      }));

      // SAME MAZE
      const keyData = placeKeys(maze, oldCorrectColor, previousCells, this.state.round + 1);

      // NEW KEY POSITIONS
      this.state.keys = keyData.keys;

      // SAME CORRECT COLOR
      this.state.correctKey = oldCorrectColor;

      // START PLAYER AGAIN
      this.state.player = {
        col: maze.start.col,
        row: maze.start.row,
        from: { ...maze.start },
        to: { ...maze.start },
        t: 0,
        facing: 'right',
        moving: false
      };

      // RESET FOG
      this.state.seen = new Uint8Array(maze.cols * maze.rows);

      // RESET RETURN DATA
      this.state.returnPath = [];
      this.state.returnPathIndex = 0;
      this.state.wrongKey = null;
      this.state.wrongFeedbackRemainingMs = 0;

      this.state.round += 1;

      // NEW: fresh lamp
      this.state.lamp = newLamp();

      // NEW: controls always normal in a fresh round
      this.state.controlsReversedMs = 0;

      this.releaseAll();

      this.state.status = 'PLAYING';

      this.revealAroundPlayer();

      this.notify();
    }

    // DEBUG MODE
    setupDebugShortcut() {
      if (!CONFIG.debugShortcut) return;

      // Prevent multiple listeners if several engines are created.
      if (GameEngine.debugListenerInstalled) return;

      GameEngine.debugListenerInstalled = true;

      window.addEventListener('keydown', event => {
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
          event.preventDefault();

          const engines = window.__BRAIN_BREAKER_ENGINES;

          if (Array.isArray(engines)) {
            engines.forEach(engine => {
              engine.toggleDebug();
            });
          }
        }
      });

      if (!Array.isArray(window.__BRAIN_BREAKER_ENGINES)) {
        window.__BRAIN_BREAKER_ENGINES = [];
      }

      window.__BRAIN_BREAKER_ENGINES.push(this);
    }

    toggleDebug() {
      this.state.debug = !this.state.debug;

      console.log('========================================');
      console.log('BRAIN BREAKER DEBUG MODE:', this.state.debug);
      console.log('CORRECT KEY:', this.state.correctKey);
      console.log('KEYS:', this.state.keys.map(key => ({
        color: key.color,
        col: key.cell.col,
        row: key.cell.row,
        correct: key.color === this.state.correctKey
      })));
      console.log('========================================');

      this.notify();
    }

    // INPUT
    press(dir) {
      if (!VECTORS[dir]) return;

      if (!this.held.includes(dir)) this.held.push(dir);
    }

    release(dir) {
      this.held = this.held.filter(item => item !== dir);
    }

    releaseAll() {
      this.held = [];
    }

    // ------------------------------------------------------------------------
    // DISORIENTED CONTROLS (NEW)
    // Raw key presses stay in this.held; they are mapped when used, so the
    // swap starts and ends instantly even if a key is already held.
    // ------------------------------------------------------------------------

    controlsReversed() {
      return this.state.controlsReversedMs > 0;
    }

    mapDir(dir) {
      if (!this.controlsReversed()) return dir;

      if (dir === 'up') return 'down';
      if (dir === 'down') return 'up';
      if (dir === 'left') return 'right';
      if (dir === 'right') return 'left';

      return dir;
    }

    // ------------------------------------------------------------------------
    // LAMP FLICKER (NEW)
    // ------------------------------------------------------------------------

    updateLamp(dtMs) {
      const L = this.state.lamp;
      const f = CONFIG.flicker;

      if (!f.enabled) {
        L.intensity = 1;
        L.radiusScale = 1;
        L.alpha = 1;
        return;
      }

      const t = this.state.elapsedMs / 1000;

      // Constant faint wobble, like a weak bulb.
      let level = 0.92 + 0.05 * Math.sin(t * 3.1) + 0.03 * Math.sin(t * 8.3 + 1.3);

      // Random flicker events (short stuttering dips).
      L.eventMs -= dtMs;

      if (L.eventMs <= 0) {
        L.eventMs = f.minGapMs + Math.random() * (f.maxGapMs - f.minGapMs);
        L.dipTotal = f.dipMinMs + Math.random() * (f.dipMaxMs - f.dipMinMs);
        L.dipMs = L.dipTotal;
        L.dipDepth = 0.45 + Math.random() * 0.45;
      }

      if (L.dipMs > 0) {
        L.dipMs = Math.max(0, L.dipMs - dtMs);

        const p = 1 - L.dipMs / L.dipTotal;
        const shape = Math.sin(p * Math.PI);
        const strobe = 0.55 + 0.45 * Math.sin(t * 38);

        level *= 1 - L.dipDepth * shape * strobe;
      }

      level = Math.max(f.minIntensity, Math.min(1, level));

      // Smooth toward target so it never pops.
      L.intensity += (level - L.intensity) * Math.min(1, dtMs / 45);

      L.radiusScale = f.radiusFloor + (1 - f.radiusFloor) * L.intensity;
      L.alpha = 0.4 + 0.6 * L.intensity;
    }

    // UPDATE
    update(dtMs) {
      if (!this.state) return;

      // SUCCESS / READY / RESETTING
      if (
        this.state.status === 'READY' ||
        this.state.status === 'SUCCESS' ||
        this.state.status === 'RESETTING'
      ) {
        return;
      }

      // Timer continues while playing and while returning to start.
      this.state.elapsedMs += dtMs;

      // NEW: lamp flicker
      this.updateLamp(dtMs);

      // NEW: disoriented controls countdown
      if (this.state.controlsReversedMs > 0 && isFinite(this.state.controlsReversedMs)) {
        this.state.controlsReversedMs = Math.max(0, this.state.controlsReversedMs - dtMs);

        if (this.state.controlsReversedMs === 0) this.notify();
      }

      // WRONG-KEY FEEDBACK
      if (this.state.status === 'WRONG_KEY') {
        this.state.wrongFeedbackRemainingMs -= dtMs;

        if (this.state.wrongFeedbackRemainingMs <= 0) {
          this.state.wrongFeedbackRemainingMs = 0;
          this.state.status = 'RETURN_TO_START';
          this.notify();
        }

        return;
      }

      // PLAYING / RETURN
      if (this.state.status !== 'PLAYING' && this.state.status !== 'RETURN_TO_START') {
        return;
      }

      const dt = dtMs / 1000;

      let budget = CONFIG.playerSpeed * dt;

      while (budget > 0) {
        const player = this.state.player;

        if (!player.moving) {
          const started = this.chooseNextCell();

          if (!started) break;
        }

        const dx = player.to.col - player.from.col;
        const dy = player.to.row - player.from.row;

        const distance = Math.abs(dx) + Math.abs(dy);

        if (distance === 0) {
          player.moving = false;
          player.t = 0;
          break;
        }

        const remaining = distance * (1 - player.t);

        if (remaining <= budget) {
          player.t = 1;

          player.col = player.to.col;
          player.row = player.to.row;

          player.from = { ...player.to };

          player.t = 0;
          player.moving = false;

          budget -= remaining;

          this.revealAroundPlayer();

          this.handleCellArrival();
        } else {
          player.t += budget / distance;

          player.col = player.from.col + (player.to.col - player.from.col) * player.t;
          player.row = player.from.row + (player.to.row - player.from.row) * player.t;

          budget = 0;

          this.revealAroundPlayer();
        }
      }
    }

    // CHOOSE NEXT CELL
    chooseNextCell() {
      if (this.state.status === 'RETURN_TO_START') return this.chooseReturnCell();

      if (this.state.status !== 'PLAYING') return false;

      return this.chooseNormalCell();
    }

    chooseNormalCell() {
      const { player, maze } = this.state;

      const col = Math.round(player.col);
      const row = Math.round(player.row);

      for (let i = this.held.length - 1; i >= 0; i -= 1) {
        const dir = this.mapDir(this.held[i]); // NEW: mapped through disorient
        const vector = VECTORS[dir];

        if (!vector) continue;

        player.facing = dir;

        if (!canMove(maze, col, row, vector.dc, vector.dr)) continue;

        player.from = { col, row };
        player.to = { col: col + vector.dc, row: row + vector.dr };
        player.t = 0;
        player.moving = true;

        return true;
      }

      return false;
    }

    // RETURN PATH
    chooseReturnCell() {
      const { player, returnPath } = this.state;

      let returnPathIndex = this.state.returnPathIndex;

      if (returnPath.length === 0) return false;

      // Find current position in return path in case the player entered a transition.
      const currentIndex = returnPath.findIndex(cell =>
        sameCell(cell, { col: Math.round(player.col), row: Math.round(player.row) })
      );

      if (currentIndex >= 0) {
        returnPathIndex = currentIndex;
        this.state.returnPathIndex = currentIndex;
      }

      if (returnPathIndex >= returnPath.length - 1) return false;

      const current = returnPath[returnPathIndex];
      const next = returnPath[returnPathIndex + 1];

      const dc = next.col - current.col;
      const dr = next.row - current.row;

      let requiredDirection = 'up';

      if (dc === 1) requiredDirection = 'right';
      else if (dc === -1) requiredDirection = 'left';
      else if (dr === 1) requiredDirection = 'down';

      // Only the correct return direction works.
      // NEW: show which way the (mapped) key points, even if the path doesn't allow it.
      if (this.held.length > 0) {
        player.facing = this.mapDir(this.held[this.held.length - 1]);
      }

      // NEW: held keys are mapped, so while disoriented the player must press the opposite key.
      if (!this.held.some(d => this.mapDir(d) === requiredDirection)) return false;

      player.facing = requiredDirection;

      player.from = { ...current };
      player.to = { ...next };
      player.t = 0;
      player.moving = true;

      return true;
    }

    // CELL ARRIVAL
    handleCellArrival() {
      const { status, player, maze } = this.state;

      const currentCell = { col: Math.round(player.col), row: Math.round(player.row) };

      // RETURN TO START
      if (status === 'RETURN_TO_START') {
        const nextIndex = this.state.returnPathIndex + 1;
        const expected = this.state.returnPath[nextIndex];

        if (expected && sameCell(currentCell, expected)) {
          this.state.returnPathIndex = nextIndex;
        }

        if (sameCell(currentCell, maze.start)) {
          // NEW: back at START -> controls return to normal
          this.state.controlsReversedMs = 0;

          this.state.status = 'RESETTING';

          this.releaseAll();

          this.notify();

          // Same maze. New key positions. Same correct color.
          window.setTimeout(() => {
            this.resetAfterWrongKey();
          }, 350);
        }

        return;
      }

      // NORMAL PLAYING
      if (status !== 'PLAYING') return;

      const key = this.state.keys.find(
        candidate => !candidate.collected && sameCell(candidate.cell, currentCell)
      );

      if (!key) return;

      // CORRECT KEY
      if (key.color === this.state.correctKey) {
        key.collected = true;

        this.state.controlsReversedMs = 0; // NEW

        this.state.status = 'SUCCESS';

        this.releaseAll();

        this.notify();

        if (typeof this.onSuccess === 'function') {
          this.onSuccess(this.state.elapsedMs, this.state.round, {
            correctKey: this.state.correctKey,
            elapsedMs: this.state.elapsedMs,
            round: this.state.round
          });
        }

        return;
      }

      // WRONG KEY
      key.wrong = true;

      this.state.wrongKey = key.color;
      this.state.wrongKeyCount += 1;
      this.state.status = 'WRONG_KEY';
      this.state.wrongFeedbackRemainingMs = CONFIG.wrongFeedbackMs;

      // NEW: wrong key swaps the controls for a few seconds
      this.state.controlsReversedMs = !CONFIG.disorient.enabled
        ? 0
        : CONFIG.disorient.untilStart
          ? Infinity
          : CONFIG.disorient.durationMs;

      // Calculate shortest route back to START.
      this.state.returnPath = findPath(maze, currentCell, maze.start);
      this.state.returnPathIndex = 0;

      this.releaseAll();

      this.notify();

      if (typeof this.onWrongKey === 'function') this.onWrongKey(key.color);
    }

    // FOG OF WAR
    revealAroundPlayer() {
      const { maze, seen, player, lamp } = this.state;

      // NEW: a dim lamp reveals less (radius follows the flicker).
      const scale = lamp ? lamp.radiusScale : 1;

      const radius = (CONFIG.sightRadius + CONFIG.sightFalloff * 0.5) * scale;

      const minCol = Math.max(0, Math.floor(player.col - radius));
      const maxCol = Math.min(maze.cols - 1, Math.ceil(player.col + radius));
      const minRow = Math.max(0, Math.floor(player.row - radius));
      const maxRow = Math.min(maze.rows - 1, Math.ceil(player.row + radius));

      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const dx = col - player.col;
          const dy = row - player.row;

          if (dx * dx + dy * dy <= radius * radius) {
            seen[index(maze, col, row)] = 1;
          }
        }
      }
    }

    // SNAPSHOT
    notify() {
      if (typeof this.onStateChange === 'function') {
        this.onStateChange(this.getSnapshot());
      }
    }

    getSnapshot() {
      return {
        status: this.state.status,
        elapsedMs: this.state.elapsedMs,
        debug: this.state.debug,
        round: this.state.round,
        wrongKey: this.state.wrongKey,
        wrongKeyCount: this.state.wrongKeyCount,

        // NEW
        controlsReversed: this.state.controlsReversedMs > 0,
        controlsReversedMs: isFinite(this.state.controlsReversedMs) ? this.state.controlsReversedMs : null,

        // Only expose correct key when DEBUG is ON.
        correctKey: this.state.debug ? this.state.correctKey : null
      };
    }
  }

  GameEngine.debugListenerInstalled = false;

  // ==========================================================================
  // RENDERER
  // ==========================================================================

  function computeViewport(maze, width, height) {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);

    const pad = Math.min(safeWidth, safeHeight) * 0.012;

    const size = Math.max(
      1,
      Math.min((safeWidth - pad * 2) / maze.cols, (safeHeight - pad * 2) / maze.rows)
    );

    return {
      size,
      originX: (safeWidth - size * maze.cols) / 2,
      originY: (safeHeight - size * maze.rows) / 2
    };
  }

  // FLOORS
  function drawFloors(ctx, state, vp, lit, all) {
    const { maze, seen } = state;

    // Continuous dark floor
    ctx.fillStyle = lit ? '#25282a' : '#111416';

    ctx.fillRect(vp.originX, vp.originY, maze.cols * vp.size, maze.rows * vp.size);

    // Very subtle stone-like texture. No cell borders / no boxes
    ctx.save();

    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        const cellIndex = index(maze, col, row);

        if (!all && !seen[cellIndex]) continue;

        const x = vp.originX + col * vp.size;
        const y = vp.originY + row * vp.size;

        const variation = (col * 17 + row * 31) % 7;

        ctx.fillStyle = lit
          ? `rgba(255,255,255,${0.008 + variation * 0.002})`
          : `rgba(255,255,255,${0.003 + variation * 0.001})`;

        ctx.fillRect(x, y, vp.size, vp.size);
      }
    }

    ctx.restore();

    // Soft stone/grime texture
    ctx.save();

    const textureCount = Math.floor(maze.cols * maze.rows * 0.12);

    for (let i = 0; i < textureCount; i += 1) {
      const col = (i * 37) % maze.cols;
      const row = (i * 61) % maze.rows;

      const cellIndex = index(maze, col, row);

      if (!all && !seen[cellIndex]) continue;

      const x = vp.originX + col * vp.size + ((i * 13) % vp.size);
      const y = vp.originY + row * vp.size + ((i * 19) % vp.size);

      ctx.fillStyle = lit ? 'rgba(150,155,158,0.035)' : 'rgba(100,105,108,0.018)';

      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, vp.size * 0.025), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // WALLS
  function drawWalls(ctx, state, vp, lit, all) {
    const { maze, seen } = state;
    const { size, originX, originY } = vp;

    const wallThickness = Math.max(5, size * 0.28);

    const visible = (col, row) => all || seen[index(maze, col, row)];

    // Base wall
    ctx.save();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Dark wall body
    ctx.strokeStyle = lit ? '#343b32' : '#161a17';
    ctx.lineWidth = wallThickness;

    if (lit) {
      ctx.shadowColor = 'rgba(110, 150, 90, 0.35)';
      ctx.shadowBlur = size * 0.35;
    }

    ctx.beginPath();

    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        if (!visible(col, row)) continue;

        const mask = maze.walls[index(maze, col, row)];
        const x = originX + col * size;
        const y = originY + row * size;

        // NORTH
        if (mask & WALL.N) { ctx.moveTo(x, y); ctx.lineTo(x + size, y); }

        // WEST
        if (mask & WALL.W) { ctx.moveTo(x, y); ctx.lineTo(x, y + size); }

        // SOUTH
        if (row === maze.rows - 1 && mask & WALL.S) {
          ctx.moveTo(x, y + size);
          ctx.lineTo(x + size, y + size);
        }

        // EAST
        if (col === maze.cols - 1 && mask & WALL.E) {
          ctx.moveTo(x + size, y);
          ctx.lineTo(x + size, y + size);
        }
      }
    }

    ctx.stroke();

    ctx.shadowBlur = 0;

    // ROCK / EARTH HIGHLIGHTS
    ctx.lineWidth = Math.max(1.2, size * 0.06);

    ctx.strokeStyle = lit ? 'rgba(105, 120, 95, 0.75)' : 'rgba(55, 65, 52, 0.65)';

    ctx.beginPath();

    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        if (!visible(col, row)) continue;

        const mask = maze.walls[index(maze, col, row)];
        const x = originX + col * size;
        const y = originY + row * size;

        // NORTH
        if (mask & WALL.N) {
          ctx.moveTo(x + size * 0.18, y - size * 0.03);
          ctx.lineTo(x + size * 0.42, y - size * 0.08);
          ctx.moveTo(x + size * 0.63, y + size * 0.02);
          ctx.lineTo(x + size * 0.82, y - size * 0.05);
        }

        // WEST
        if (mask & WALL.W) {
          ctx.moveTo(x - size * 0.03, y + size * 0.2);
          ctx.lineTo(x - size * 0.08, y + size * 0.43);
          ctx.moveTo(x + size * 0.02, y + size * 0.64);
          ctx.lineTo(x - size * 0.05, y + size * 0.82);
        }

        // SOUTH
        if (row === maze.rows - 1 && mask & WALL.S) {
          ctx.moveTo(x + size * 0.18, y + size * 1.03);
          ctx.lineTo(x + size * 0.42, y + size * 1.08);
        }

        // EAST
        if (col === maze.cols - 1 && mask & WALL.E) {
          ctx.moveTo(x + size * 1.03, y + size * 0.2);
          ctx.lineTo(x + size * 1.08, y + size * 0.44);
        }
      }
    }

    ctx.stroke();

    // GRASS / MOSS BLADES
    ctx.lineWidth = Math.max(0.8, size * 0.035);

    ctx.strokeStyle = lit ? 'rgba(91, 125, 70, 0.8)' : 'rgba(45, 65, 42, 0.7)';

    ctx.beginPath();

    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        if (!visible(col, row)) continue;

        const mask = maze.walls[index(maze, col, row)];
        const x = originX + col * size;
        const y = originY + row * size;

        // Grass on top edge
        if (mask & WALL.N) {
          const gx = x + size * 0.28;

          ctx.moveTo(gx, y - wallThickness * 0.35);
          ctx.lineTo(gx - size * 0.05, y - wallThickness * 0.75);
          ctx.moveTo(gx + size * 0.07, y - wallThickness * 0.35);
          ctx.lineTo(gx + size * 0.11, y - wallThickness * 0.8);
        }

        // Grass on left edge
        if (mask & WALL.W) {
          const gy = y + size * 0.3;

          ctx.moveTo(x - wallThickness * 0.35, gy);
          ctx.lineTo(x - wallThickness * 0.75, gy - size * 0.05);
          ctx.moveTo(x - wallThickness * 0.35, gy + size * 0.08);
          ctx.lineTo(x - wallThickness * 0.78, gy + size * 0.12);
        }
      }
    }

    ctx.stroke();

    ctx.restore();
  }

  // START
  function drawStartPad(ctx, state, vp, time, lit) {
    const { start } = state.maze;

    const cx = vp.originX + (start.col + 0.5) * vp.size;
    const cy = vp.originY + (start.row + 0.5) * vp.size;

    const pulse = 0.5 + 0.5 * Math.sin(time / 700);

    ctx.save();

    ctx.globalAlpha = lit ? 0.55 + pulse * 0.35 : 0.5;

    ctx.strokeStyle = PALETTE.start;

    ctx.lineWidth = Math.max(1, vp.size * 0.06);

    ctx.setLineDash([vp.size * 0.16, vp.size * 0.12]);

    ctx.beginPath();
    ctx.arc(cx, cy, vp.size * (0.3 + pulse * 0.04), 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  // KEY
  function drawKey(ctx, x, y, size, hex, time) {
    const bob = Math.sin(time / 520 + x) * size * 0.035;

    const scale = size * 0.16;

    ctx.save();

    ctx.translate(x, y + bob);

    // MAGICAL GLOW
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.65);

    glow.addColorStop(0, hex + '55');
    glow.addColorStop(0.45, hex + '22');
    glow.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = glow;

    ctx.beginPath();
    ctx.arc(0, 0, size * 0.65, 0, Math.PI * 2);
    ctx.fill();

    // KEY SHADOW
    ctx.shadowColor = hex;
    ctx.shadowBlur = size * 0.35;

    // KEY METAL BODY
    const metal = ctx.createLinearGradient(-scale, -scale * 2, scale, scale * 2);

    metal.addColorStop(0, '#d8d5c8');
    metal.addColorStop(0.35, '#77766f');
    metal.addColorStop(0.6, '#393b38');
    metal.addColorStop(1, '#171918');

    ctx.strokeStyle = metal;
    ctx.lineWidth = Math.max(2, size * 0.065);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // KEY BOW
    ctx.beginPath();
    ctx.arc(0, -scale * 0.65, scale, 0, Math.PI * 2);
    ctx.stroke();

    // Inner hole
    ctx.strokeStyle = hex;
    ctx.lineWidth = Math.max(1, size * 0.035);

    ctx.beginPath();
    ctx.arc(0, -scale * 0.65, scale * 0.35, 0, Math.PI * 2);
    ctx.stroke();

    // SHAFT
    ctx.strokeStyle = metal;
    ctx.lineWidth = Math.max(2, size * 0.065);

    ctx.beginPath();
    ctx.moveTo(0, scale * 0.25);
    ctx.lineTo(0, scale * 2.15);
    ctx.stroke();

    // KEY TEETH
    ctx.beginPath();
    ctx.moveTo(0, scale * 1.25);
    ctx.lineTo(scale * 0.65, scale * 1.25);
    ctx.lineTo(scale * 0.65, scale * 1.55);
    ctx.moveTo(0, scale * 1.75);
    ctx.lineTo(scale * 0.5, scale * 1.75);
    ctx.lineTo(scale * 0.5, scale * 2.05);
    ctx.stroke();

    // MAGIC CORE
    ctx.shadowColor = hex;
    ctx.shadowBlur = size * 0.3;

    ctx.fillStyle = hex;

    ctx.beginPath();
    ctx.arc(0, -scale * 0.65, scale * 0.25, 0, Math.PI * 2);
    ctx.fill();

    // SMALL SPARK
    const sparkle = 0.5 + 0.5 * Math.sin(time / 260);

    ctx.globalAlpha = 0.35 + sparkle * 0.5;

    ctx.fillStyle = '#ffffff';

    ctx.beginPath();
    ctx.arc(-scale * 0.45, -scale * 1.05, Math.max(0.8, size * 0.025), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawKeys(ctx, state, vp, time, all) {
    for (const token of state.keys) {
      if (token.collected) continue;

      const visible = state.seen[index(state.maze, token.cell.col, token.cell.row)];

      if (!all && !visible) continue;

      drawKey(
        ctx,
        vp.originX + (token.cell.col + 0.5) * vp.size,
        vp.originY + (token.cell.row + 0.5) * vp.size,
        vp.size,
        KEY_HEX[token.color],
        time
      );
    }
  }

  // PLAYER
  function drawPlayer(ctx, state, vp, time) {
    const { player } = state;

    const cx = vp.originX + (player.col + 0.5) * vp.size;
    const cy = vp.originY + (player.row + 0.5) * vp.size;

    const s = vp.size;

    const pulse = 0.5 + 0.5 * Math.sin(time / 420);

    // PLAYER SHADOW
    ctx.save();

    ctx.fillStyle = 'rgba(0,0,0,0.55)';

    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.2, s * 0.2, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // HEADLAMP GLOW
    const lampGlow = ctx.createRadialGradient(cx, cy - s * 0.18, 0, cx, cy - s * 0.18, s * 1.7);

    lampGlow.addColorStop(0, 'rgba(126,240,255,0.22)');
    lampGlow.addColorStop(0.35, 'rgba(126,220,240,0.09)');
    lampGlow.addColorStop(1, 'rgba(126,240,255,0)');

    ctx.fillStyle = lampGlow;

    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.18, s * 1.7, 0, Math.PI * 2);
    ctx.fill();

    // PLAYER BODY
    ctx.save();

    ctx.translate(cx, cy);

    // Subtle breathing movement
    const breathe = Math.sin(time / 650) * s * 0.012;

    ctx.translate(0, breathe);

    // Backpack
    ctx.fillStyle = '#202a2c';
    ctx.strokeStyle = '#56686a';
    ctx.lineWidth = Math.max(1, s * 0.035);

    ctx.beginPath();
    ctx.roundRect(-s * 0.18, -s * 0.02, s * 0.12, s * 0.3, s * 0.035);
    ctx.fill();
    ctx.stroke();

    // Body / jacket
    const bodyGradient = ctx.createLinearGradient(0, -s * 0.02, 0, s * 0.3);

    bodyGradient.addColorStop(0, '#526367');
    bodyGradient.addColorStop(0.5, '#293538');
    bodyGradient.addColorStop(1, '#101719');

    ctx.fillStyle = bodyGradient;
    ctx.strokeStyle = '#718386';
    ctx.lineWidth = Math.max(1, s * 0.035);

    ctx.beginPath();
    ctx.roundRect(-s * 0.13, -s * 0.01, s * 0.26, s * 0.32, s * 0.07);
    ctx.fill();
    ctx.stroke();

    // Arms
    ctx.strokeStyle = '#344447';
    ctx.lineWidth = Math.max(2, s * 0.07);
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(-s * 0.1, s * 0.05);
    ctx.lineTo(-s * 0.2, s * 0.2);
    ctx.moveTo(s * 0.1, s * 0.05);
    ctx.lineTo(s * 0.2, s * 0.2);
    ctx.stroke();

    // Legs
    ctx.strokeStyle = '#161d1f';
    ctx.lineWidth = Math.max(2, s * 0.075);

    ctx.beginPath();
    ctx.moveTo(-s * 0.07, s * 0.25);
    ctx.lineTo(-s * 0.09, s * 0.38);
    ctx.moveTo(s * 0.07, s * 0.25);
    ctx.lineTo(s * 0.09, s * 0.38);
    ctx.stroke();

    // Boots
    ctx.strokeStyle = '#0b1011';
    ctx.lineWidth = Math.max(2, s * 0.065);

    ctx.beginPath();
    ctx.moveTo(-s * 0.09, s * 0.38);
    ctx.lineTo(-s * 0.15, s * 0.39);
    ctx.moveTo(s * 0.09, s * 0.38);
    ctx.lineTo(s * 0.15, s * 0.39);
    ctx.stroke();

    // HEAD
    ctx.fillStyle = '#9ba7a7';
    ctx.strokeStyle = '#4c5b5d';
    ctx.lineWidth = Math.max(1, s * 0.035);

    ctx.beginPath();
    ctx.arc(0, -s * 0.17, s * 0.105, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Helmet
    ctx.fillStyle = '#283638';

    ctx.beginPath();
    ctx.arc(0, -s * 0.2, s * 0.115, Math.PI, Math.PI * 2);
    ctx.fill();

    // Helmet rim
    ctx.strokeStyle = '#6c8588';
    ctx.lineWidth = Math.max(1, s * 0.025);

    ctx.beginPath();
    ctx.moveTo(-s * 0.13, -s * 0.19);
    ctx.lineTo(s * 0.13, -s * 0.19);
    ctx.stroke();

    // HEADLAMP
    ctx.shadowColor = '#7ef0ff';
    ctx.shadowBlur = s * (0.25 + pulse * 0.12);

    ctx.fillStyle = '#dfffff';

    ctx.beginPath();
    ctx.arc(0, -s * 0.22, s * 0.035, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // RETURN BARRIERS
  function drawReturnBarriers(ctx, state, vp, time = performance.now()) {
    if (state.status !== 'RETURN_TO_START' && state.status !== 'RESETTING') return;

    if (state.returnPath.length === 0) return;

    const current = state.returnPath[state.returnPathIndex];
    const next = state.returnPath[state.returnPathIndex + 1];

    if (!current) return;

    const { maze } = state;

    const x = vp.originX + current.col * vp.size;
    const y = vp.originY + current.row * vp.size;

    const size = vp.size;

    // Direction player is allowed to travel.
    const allowed = next
      ? { dc: next.col - current.col, dr: next.row - current.row }
      : null;

    const barriers = [
      { dc: 0, dr: -1, wall: WALL.N, x1: x, y1: y, x2: x + size, y2: y },
      { dc: 1, dr: 0, wall: WALL.E, x1: x + size, y1: y, x2: x + size, y2: y + size },
      { dc: 0, dr: 1, wall: WALL.S, x1: x, y1: y + size, x2: x + size, y2: y + size },
      { dc: -1, dr: 0, wall: WALL.W, x1: x, y1: y, x2: x, y2: y + size }
    ];

    const mask = maze.walls[index(maze, current.col, current.row)];

    const pulse = 0.5 + 0.5 * Math.sin(time / 170);

    ctx.save();

    // DRAW EACH CLOSED PASSAGE
    for (const barrier of barriers) {
      // Keep the actual return path open.
      if (allowed && barrier.dc === allowed.dc && barrier.dr === allowed.dr) continue;

      // Only draw over an actual opening in the maze.
      if (mask & barrier.wall) continue;

      const x1 = barrier.x1;
      const y1 = barrier.y1;
      const x2 = barrier.x2;
      const y2 = barrier.y2;

      // OUTER RED ATMOSPHERIC GLOW
      ctx.strokeStyle = `rgba(255,55,80,${0.18 + pulse * 0.12})`;
      ctx.shadowColor = 'rgba(255,40,65,0.9)';
      ctx.shadowBlur = size * 0.65;
      ctx.lineWidth = Math.max(5, size * 0.3);
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // DARK ENERGY CORE
      ctx.shadowBlur = size * 0.25;
      ctx.strokeStyle = '#3a0d16';
      ctx.lineWidth = Math.max(3, size * 0.15);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // BRIGHT ENERGY LINE
      ctx.shadowColor = '#ff334f';
      ctx.shadowBlur = size * 0.25;
      ctx.strokeStyle = `rgba(255,80,105,${0.65 + pulse * 0.25})`;
      ctx.lineWidth = Math.max(1.2, size * 0.045);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // ENERGY SPARKS
      const sparkCount = Math.max(2, Math.floor(size / 8));

      const dx = x2 - x1;
      const dy = y2 - y1;

      const length = Math.sqrt(dx * dx + dy * dy);

      const nx = -dy / length;
      const ny = dx / length;

      ctx.strokeStyle = `rgba(255,130,145,${0.35 + pulse * 0.4})`;
      ctx.lineWidth = Math.max(0.8, size * 0.025);
      ctx.shadowBlur = size * 0.15;

      for (let i = 0; i < sparkCount; i += 1) {
        // Deterministic position so sparks don't flicker randomly.
        const t = (i + 1) / (sparkCount + 1);

        const offset = Math.sin(time / 120 + i * 4.7) * size * 0.06;

        const sx = x1 + dx * t + nx * offset;
        const sy = y1 + dy * t + ny * offset;

        const sparkSize = size * (0.04 + pulse * 0.025);

        ctx.beginPath();
        ctx.moveTo(sx - nx * sparkSize, sy - ny * sparkSize);
        ctx.lineTo(sx + nx * sparkSize, sy + ny * sparkSize);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // WRONG FEEDBACK
  function drawWrongKeyFeedback(ctx, state, width, height) {
    if (
      state.status !== 'WRONG_KEY' &&
      state.status !== 'RETURN_TO_START' &&
      state.status !== 'RESETTING'
    ) {
      return;
    }

    let alpha = 0.08;

    if (state.status === 'WRONG_KEY') alpha = 0.2;

    if (state.status === 'RESETTING') alpha = 0.12;

    ctx.save();

    ctx.fillStyle = `rgba(255,75,109,${alpha})`;

    ctx.fillRect(0, 0, width, height);

    ctx.restore();
  }

  // SUCCESS FEEDBACK
  function drawSuccessFeedback(ctx, state, width, height) {
    if (state.status !== 'SUCCESS') return;

    ctx.save();

    ctx.fillStyle = 'rgba(61,245,165,0.08)';

    ctx.fillRect(0, 0, width, height);

    ctx.restore();
  }

  // DISORIENTED CONTROLS BANNER (NEW)
  function drawDisorientBanner(ctx, state, width) {
    const remaining = state.controlsReversedMs;

    if (!remaining || remaining <= 0) return;

    const untilStart = !isFinite(remaining);
    const total = CONFIG.disorient.durationMs;

    let progress;
    let fade;

    if (untilStart) {
      // Bar shows how much of the way back to START is left.
      const len = Math.max(1, state.returnPath.length - 1);
      progress = Math.max(0, Math.min(1, 1 - state.returnPathIndex / len));
      fade = 1;
    } else {
      progress = Math.max(0, Math.min(1, remaining / total));
      // Fade in quickly, fade out during the last 400ms.
      fade = Math.min(1, (total - remaining) / 150 + 0.2, remaining / 400);
    }

    const w = Math.min(320, width - 24);
    const h = untilStart ? 144 : 124;
    const x = width / 2 - w / 2;
    const y = 14;

    ctx.save();

    ctx.globalAlpha = Math.max(0, fade);

    ctx.fillStyle = 'rgba(8,4,12,0.9)';
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    ctx.textAlign = 'center';

    ctx.font = '800 20px Arial, sans-serif';
    ctx.fillStyle = '#ff4d6d';
    ctx.fillText('\u274C WRONG KEY', width / 2, y + 30);

    ctx.font = '700 14px Arial, sans-serif';
    ctx.fillStyle = '#ffd166';
    ctx.fillText('CONTROLS DISORIENTED', width / 2, y + 52);

    ctx.font = '700 13px Arial, sans-serif';
    ctx.fillStyle = '#d7e4ff';
    ctx.fillText('W \u2192 DOWN     S \u2192 UP', width / 2, y + 72);
    ctx.fillText('D \u2192 LEFT     A \u2192 RIGHT', width / 2, y + 92);

    // Time-left bar
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + 16, y + 104, w - 32, 6);

    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(x + 16, y + 104, (w - 32) * progress, 6);

    if (untilStart) {
      ctx.font = '700 11px Arial, sans-serif';
      ctx.fillStyle = '#9fb6c4';
      ctx.fillText('UNTIL YOU REACH START', width / 2, y + 128);
    }

    ctx.restore();
  }

  // DEBUG OVERLAY
  function drawDebugOverlay(ctx, state, width) {
    if (!state.debug) return;

    const correct = state.correctKey || 'UNKNOWN';

    const correctKeyObject = state.keys.find(key => key.color === correct);

    ctx.save();

    // Top debug panel
    const panelWidth = Math.min(430, width - 24);

    const panelHeight = 92;

    ctx.fillStyle = 'rgba(0,0,0,0.88)';

    ctx.fillRect(12, 12, panelWidth, panelHeight);

    ctx.strokeStyle = KEY_HEX[correct] || '#ffffff';

    ctx.lineWidth = 2;

    ctx.strokeRect(12, 12, panelWidth, panelHeight);

    ctx.font = '700 15px Arial, sans-serif';

    ctx.fillStyle = '#ffffff';

    ctx.fillText('DEVELOPER DEBUG MODE', 26, 35);

    ctx.font = '700 18px Arial, sans-serif';

    ctx.fillStyle = KEY_HEX[correct] || '#ffffff';

    ctx.fillText(`CORRECT KEY: ${correct}`, 26, 59);

    ctx.font = '12px Arial, sans-serif';

    ctx.fillStyle = '#d7e4ff';

    if (correctKeyObject) {
      ctx.fillText(
        `POSITION: (${correctKeyObject.cell.col}, ${correctKeyObject.cell.row})`,
        26,
        80
      );
    } else {
      ctx.fillText('POSITION: UNKNOWN', 26, 80);
    }

    ctx.restore();
  }

  // MAIN RENDERER
  function renderScene(ctx, lightCtx, state, width, height, time) {
    if (!state || !state.maze) return;

    const vp = computeViewport(state.maze, width, height);

    const { player, debug } = state;

    // CLEAR
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = PALETTE.void;

    ctx.fillRect(0, 0, width, height);

    // REMEMBERED GEOMETRY
    ctx.save();

    ctx.globalAlpha = debug ? 0.42 : CONFIG.memoryAlpha;

    drawFloors(ctx, state, vp, false, debug);

    drawWalls(ctx, state, vp, false, debug);

    if (debug) drawKeys(ctx, state, vp, time, true);

    ctx.restore();

    // LIT WORLD
    lightCtx.clearRect(0, 0, width, height);

    drawFloors(lightCtx, state, vp, true, true);

    drawWalls(lightCtx, state, vp, true, true);

    drawStartPad(lightCtx, state, vp, time, true);

    drawKeys(lightCtx, state, vp, time, true);

    // FOG
    const cx = vp.originX + (player.col + 0.5) * vp.size;
    const cy = vp.originY + (player.row + 0.5) * vp.size;

    // NEW: flickering lamp — radius and strength follow state.lamp
    const lamp = state.lamp || { radiusScale: 1, alpha: 1 };

    const inner = CONFIG.sightRadius * vp.size * lamp.radiusScale;

    const outer = (CONFIG.sightRadius + CONFIG.sightFalloff) * vp.size * lamp.radiusScale;

    const a = lamp.alpha;

    const mask = lightCtx.createRadialGradient(cx, cy, inner * 0.2, cx, cy, outer);

    mask.addColorStop(0, `rgba(255,255,255,${a})`);
    mask.addColorStop(0.55, `rgba(255,255,255,${0.92 * a})`);
    mask.addColorStop(0.8, `rgba(255,255,255,${0.35 * a})`);
    mask.addColorStop(1, 'rgba(255,255,255,0)');

    lightCtx.globalCompositeOperation = 'destination-in';

    lightCtx.fillStyle = mask;

    lightCtx.fillRect(0, 0, width, height);

    lightCtx.globalCompositeOperation = 'source-over';

    // COMPOSITE
    ctx.drawImage(lightCtx.canvas, 0, 0, width, height);

    // START
    if (!debug) drawStartPad(ctx, state, vp, time, false);

    // RETURN BARRIERS
    drawReturnBarriers(ctx, state, vp);

    // PLAYER
    drawPlayer(ctx, state, vp, time);

    // FEEDBACK
    drawWrongKeyFeedback(ctx, state, width, height);

    drawSuccessFeedback(ctx, state, width, height);

    // VIGNETTE
    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.25,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.75
    );

    vignette.addColorStop(0, 'rgba(4,6,13,0)');
    vignette.addColorStop(1, 'rgba(4,6,13,0.85)');

    ctx.fillStyle = vignette;

    ctx.fillRect(0, 0, width, height);

    // NEW: disoriented controls banner
    drawDisorientBanner(ctx, state, width);

    // DEBUG OVERLAY — DRAW LAST
    drawDebugOverlay(ctx, state, width);
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  window.BrainBreakerMaze = {
    CONFIG,
    KEY_COLORS,
    KEY_HEX,
    PALETTE,
    GameEngine,
    renderScene
  };

})(window);