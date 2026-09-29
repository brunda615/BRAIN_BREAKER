/**
 * BRAIN BREAKER — Stage 02: Fog Maze Game Engine & Renderer
 *
 * Pure Vanilla JavaScript + HTML5 Canvas
 *
 * GAME LOGIC: unchanged.
 * - Movement: exactly ONE cell per movement step
 * - Wrong key: reversed controls until back at START, same maze, new key positions
 *
 * THE LOOK: enchanted night-forest hedge maze (renderer section only).
 * - Only the flickering lamp radius is visible (no explored-area memory)
 * - Hedge walls, forest floor, glowing mushrooms, fireflies, drifting leaves
 * - Static art is cached once (no per-frame wall/floor redraw) for smoothness
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
    memoryAlpha: 0,        // 0 = only the lamp radius is ever visible (no explored-area memory)

    // FLICKERING LAMP
    flicker: {
      enabled: true,
      minGapMs: 900,      // time between flicker events
      maxGapMs: 2500,
      dipMinMs: 260,       // length of one flicker
      dipMaxMs: 780,
      minIntensity: 0.01,   // lamp never goes fully dark
      radiusFloor: 0.12    // smallest sight radius multiplier
    },

    // KEYS
    keyCount: 4,
    minKeyDistanceFromStart: 22,
    minKeySeparation: 10,

    // MAZE COMPLEXITY
    extraConnections: 70,

    // WRONG KEY
    wrongFeedbackMs: 650,

    // DISORIENTED CONTROLS (optional)
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
    void: '#061108',

    wallBase: '#123b18',
    wallDark: '#0a2810',
    wallLight: '#2d6731',

    start: '#d6c85a',

    fog: '#102916',

    text: '#e8f5e9',
    muted: '#a8c5aa',

    keyGlow: '#ffffff'
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
  // LAMP FLICKER
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

  // NOTE: the optional wrong-key colour-clue system (COLOR_CLUES /
  // getColourClue / buildWrongKeyClue) was commented out in the original and
  // is not part of this file. state.clue / state.clueLevel are therefore
  // undefined, exactly as before.

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
        wrongFeedbackRemainingMs: 0,
        held: [],
        seen: new Uint8Array(maze.cols * maze.rows),
        debug: false,

        // flickering lamp
        lamp: newLamp(),

        // remaining time (ms) of reversed controls
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

      this.state.wrongKey = null;
      this.state.wrongFeedbackRemainingMs = 0;

      this.state.round += 1;

      // fresh lamp
      this.state.lamp = newLamp();

      // controls always normal in a fresh round
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
    // DISORIENTED CONTROLS
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
    // LAMP FLICKER
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

      // lamp flicker
      this.updateLamp(dtMs);

      // disoriented controls countdown
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

      // ONE CELL PER UPDATE: never carry leftover budget into another cell.
      const player = this.state.player;

      if (!player.moving) {
        if (!this.chooseNextCell()) return;
      }

      const dx = player.to.col - player.from.col;
      const dy = player.to.row - player.from.row;
      const distance = Math.abs(dx) + Math.abs(dy);

      if (distance === 0) {
        player.moving = false;
        player.t = 0;
        return;
      }

      const budget = CONFIG.playerSpeed * (dtMs / 1000);
      const remaining = distance * (1 - player.t);

      if (remaining <= budget) {
        // Arrive exactly on the target cell, discard leftover budget, stop.
        player.col = player.to.col;
        player.row = player.to.row;

        player.from = { ...player.to };
        player.t = 0;
        player.moving = false;

        this.revealAroundPlayer();
        this.handleCellArrival();
        return;
      }

      // Still travelling: smooth interpolation toward the same target cell.
      player.t += budget / distance;

      player.col = player.from.col + (player.to.col - player.from.col) * player.t;
      player.row = player.from.row + (player.to.row - player.from.row) * player.t;

      this.revealAroundPlayer();
    }

    // CHOOSE NEXT CELL
    chooseNextCell() {
      return this.chooseNormalCell();
    }

    chooseNormalCell() {
      const { player, maze } = this.state;

      const col = Math.round(player.col);
      const row = Math.round(player.row);

      for (let i = this.held.length - 1; i >= 0; i -= 1) {
        const dir = this.mapDir(this.held[i]); // mapped through disorient
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

    // CELL ARRIVAL
    handleCellArrival() {
      const { status, player, maze } = this.state;

      const currentCell = { col: Math.round(player.col), row: Math.round(player.row) };

      // RETURN TO START
      if (status === 'RETURN_TO_START') {
        if (sameCell(currentCell, maze.start)) {
          // back at START -> controls return to normal
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

        this.state.controlsReversedMs = 0;

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

      // wrong key swaps the controls
      this.state.controlsReversedMs = !CONFIG.disorient.enabled
        ? 0
        : CONFIG.disorient.untilStart
          ? Infinity
          : CONFIG.disorient.durationMs;

      this.releaseAll();

      this.notify();

      if (typeof this.onWrongKey === 'function') {
        this.onWrongKey(key.color, this.state.clue, this.state.clueLevel);
      }
    }

    // FOG OF WAR
    revealAroundPlayer() {
      const { maze, seen, player, lamp } = this.state;

      // a dim lamp reveals less (radius follows the flicker).
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

        controlsReversed: this.state.controlsReversedMs > 0,
        controlsReversedMs: isFinite(this.state.controlsReversedMs) ? this.state.controlsReversedMs : null,

        // Only expose correct key when DEBUG is ON.
        correctKey: this.state.debug ? this.state.correctKey : null
      };
    }
  }

  GameEngine.debugListenerInstalled = false;

  // ==========================================================================
  // RENDERER — ENCHANTED NIGHT-FOREST HEDGE MAZE (visual only)
  //
  // Replace EVERYTHING from the old "RENDERER" header down to the final
  // "})(window);" with this file. The engine above it is untouched.
  //
  //  - Walls: tall layered hedges (dark base, mid foliage, sunlit top leaves,
  //    leaf flecks, berries and wildflowers, long cast shadow)
  //  - Floor: forest ground with dirt trails, grass blades, fallen autumn
  //    leaves, pebbles, twigs, clover, wildflowers and dappled moonlight
  //  - Light: glowing mushroom clusters (teal / violet / amber) throw coloured
  //    light pools, fireflies, drifting leaves and mist (all lamp-limited)
  //  - Keys, player, feedback banners and the public API are unchanged
  // ==========================================================================

  // Deterministic hash -> [0,1). Textures never shimmer between frames.
  function hash(a, b, c) {
    let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }

  const caches = new WeakMap();

  // Forest colour palette (renderer only). [r, g, b]
  const FOREST = {
    hedgeDeep: [6, 30, 14],
    hedgeDark: [14, 58, 24],
    hedgeMid: [28, 96, 36],
    hedgeLight: [66, 148, 52],
    hedgeGlow: [140, 200, 84],

    grassDeep: [26, 52, 24],
    grassMid: [48, 90, 38],
    grassLight: [70, 118, 46],
    dirt: [96, 70, 44],
    blade: [104, 160, 64],
    bladeDark: [36, 78, 34],

    leaves: [[200, 120, 34], [222, 168, 52], [168, 70, 34], [140, 96, 36], [190, 60, 40]],
    berries: [[210, 40, 64], [150, 54, 150], [236, 200, 62]],
    petals: [[250, 250, 240], [255, 190, 210], [255, 226, 110], [190, 170, 255]],
    shroomHues: [[90, 255, 214], [196, 150, 255], [255, 196, 96]]
  };

  // rgba() string from an [r,g,b] array, brightness multiplier k and alpha a
  function rgba(c, k, a) {
    return 'rgba(' +
      Math.max(0, Math.min(255, Math.round(c[0] * k))) + ',' +
      Math.max(0, Math.min(255, Math.round(c[1] * k))) + ',' +
      Math.max(0, Math.min(255, Math.round(c[2] * k))) + ',' + a + ')';
  }

  /**
   * MAXIMISED VIEWPORT: the maze fills the canvas. The only margin left is
   * the small overhang needed so the outer wall stroke is not clipped.
   */
  function computeViewport(maze, width, height) {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);

    const overhang = 0.5; // total extra cells (hedge thickness + shadow)

    const size = Math.max(
      1,
      Math.min(safeWidth / (maze.cols + overhang), safeHeight / (maze.rows + overhang))
    );

    return {
      size,
      originX: (safeWidth - size * maze.cols) / 2,
      originY: (safeHeight - size * maze.rows) / 2
    };
  }

  function getSegments(maze) {
    if (maze._segments) return maze._segments;

    const segs = [];

    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        const m = maze.walls[index(maze, col, row)];

        if (m & WALL.N) segs.push([col, row, col + 1, row]);
        if (m & WALL.W) segs.push([col, row, col, row + 1]);
        if (row === maze.rows - 1 && (m & WALL.S)) segs.push([col, row + 1, col + 1, row + 1]);
        if (col === maze.cols - 1 && (m & WALL.E)) segs.push([col + 1, row, col + 1, row + 1]);
      }
    }

    maze._segments = segs;
    return segs;
  }

  // Glow-mushroom positions (chosen once per maze, deterministic).
  function getTorches(maze) {
    if (maze._torches) return maze._torches;

    const segs = getSegments(maze);
    const torches = [];

    for (let i = 0; i < segs.length; i += 1) {
      if (hash(i, 3, 55) < 0.955) continue;

      const s = segs[i];

      torches.push({
        i,
        x: (s[0] + s[2]) / 2,
        y: (s[1] + s[3]) / 2
      });
    }

    maze._torches = torches;
    return torches;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  }

  // ------------------------------------------------------------------------
  // STATIC ART (painted once per size)
  // ------------------------------------------------------------------------

  // Forest floor
  function paintFloors(g, maze, vp, lit) {
    const { size, originX, originY } = vp;
    const K = lit ? 1 : 0.4;
    const W = maze.cols * size;
    const H = maze.rows * size;

    g.save();
    g.beginPath();
    g.rect(originX, originY, W, H);
    g.clip();

    // Mossy ground base with a soft centre glow
    const base = g.createRadialGradient(
      originX + W / 2, originY + H / 2, 0,
      originX + W / 2, originY + H / 2, Math.max(W, H) * 0.75
    );

    base.addColorStop(0, rgba(FOREST.grassMid, K, 1));
    base.addColorStop(1, rgba(FOREST.grassDeep, K, 1));

    g.fillStyle = base;
    g.fillRect(originX, originY, W, H);

    g.lineCap = 'round';

    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        const x0 = originX + col * size;
        const y0 = originY + row * size;

        // Soft overlapping ground patch (dirt trail / grass): no visible grid
        const t = hash(col, row, 1);
        const ground = t < 0.3 ? FOREST.dirt : t < 0.65 ? FOREST.grassMid : FOREST.grassLight;
        const gx = x0 + size * (0.3 + hash(col, row, 9) * 0.4);
        const gy = y0 + size * (0.3 + hash(col, row, 10) * 0.4);
        const gr = size * (0.8 + hash(col, row, 11) * 0.4);
        const patch = g.createRadialGradient(gx, gy, 0, gx, gy, gr);

        patch.addColorStop(0, rgba(ground, K, 0.6));
        patch.addColorStop(1, rgba(ground, K, 0));

        g.fillStyle = patch;
        g.fillRect(x0 - size * 0.5, y0 - size * 0.5, size * 2, size * 2);

        // Clover / moss patches
        if (hash(col, row, 16) < 0.09) {
          const mx = x0 + (0.25 + hash(col, row, 17) * 0.5) * size;
          const my = y0 + (0.25 + hash(col, row, 18) * 0.5) * size;
          const mr = size * 0.32;
          const moss = g.createRadialGradient(mx, my, 0, mx, my, mr);

          moss.addColorStop(0, lit ? 'rgba(96,170,70,0.5)' : 'rgba(60,110,44,0.3)');
          moss.addColorStop(1, 'rgba(0,0,0,0)');

          g.fillStyle = moss;
          g.beginPath();
          g.arc(mx, my, mr, 0, Math.PI * 2);
          g.fill();
        }

        // Dappled moonlight through the canopy (lit layer only)
        if (lit && hash(col, row, 40) < 0.2) {
          g.fillStyle = 'rgba(214,236,150,0.09)';
          g.beginPath();
          g.ellipse(
            x0 + hash(col, row, 41) * size,
            y0 + hash(col, row, 42) * size,
            size * (0.22 + hash(col, row, 43) * 0.2),
            size * (0.14 + hash(col, row, 44) * 0.14),
            hash(col, row, 45) * Math.PI, 0, Math.PI * 2
          );
          g.fill();
        }

        // Grass blades
        g.lineWidth = Math.max(0.8, size * 0.024);

        for (let b = 0; b < 8; b += 1) {
          const bx = x0 + hash(col, row, 100 + b) * size;
          const by = y0 + (0.15 + hash(col, row, 110 + b) * 0.85) * size;
          const bh = size * (0.06 + hash(col, row, 120 + b) * 0.1);
          const lean = (hash(col, row, 130 + b) - 0.5) * size * 0.1;

          g.strokeStyle = rgba(
            hash(col, row, 140 + b) > 0.5 ? FOREST.blade : FOREST.bladeDark,
            K,
            0.78
          );

          g.beginPath();
          g.moveTo(bx, by);
          g.quadraticCurveTo(bx + lean * 0.3, by - bh * 0.6, bx + lean, by - bh);
          g.stroke();
        }

        // Fallen autumn leaves
        if (hash(col, row, 20) < 0.4) {
          const n = hash(col, row, 21) > 0.6 ? 2 : 1;

          for (let k = 0; k < n; k += 1) {
            const lx = x0 + (0.12 + hash(col, row, 22 + k) * 0.76) * size;
            const ly = y0 + (0.12 + hash(col, row, 25 + k) * 0.76) * size;
            const rot = hash(col, row, 28 + k) * Math.PI;
            const lc = FOREST.leaves[Math.floor(hash(col, row, 31 + k) * FOREST.leaves.length)];
            const rx = size * 0.055;

            g.fillStyle = rgba(lc, K, 0.92);
            g.beginPath();
            g.ellipse(lx, ly, rx, size * 0.028, rot, 0, Math.PI * 2);
            g.fill();

            g.strokeStyle = rgba([40, 24, 10], K, 0.5);
            g.lineWidth = Math.max(0.5, size * 0.008);
            g.beginPath();
            g.moveTo(lx - Math.cos(rot) * rx, ly - Math.sin(rot) * rx);
            g.lineTo(lx + Math.cos(rot) * rx, ly + Math.sin(rot) * rx);
            g.stroke();
          }
        }

        // Pebbles
        if (hash(col, row, 2) < 0.3) {
          const pxx = x0 + hash(col, row, 3) * size;
          const pyy = y0 + hash(col, row, 4) * size;
          const pr = Math.max(1, size * (0.025 + hash(col, row, 5) * 0.03));

          g.fillStyle = rgba([120, 122, 116], K, 0.85);
          g.beginPath();
          g.ellipse(pxx, pyy, pr * 1.2, pr, 0, 0, Math.PI * 2);
          g.fill();

          g.fillStyle = rgba([210, 214, 200], K, 0.4);
          g.beginPath();
          g.arc(pxx - pr * 0.3, pyy - pr * 0.3, pr * 0.4, 0, Math.PI * 2);
          g.fill();
        }

        // Twigs
        if (hash(col, row, 6) < 0.1) {
          const tx = x0 + (0.15 + hash(col, row, 7) * 0.7) * size;
          const ty = y0 + (0.15 + hash(col, row, 8) * 0.7) * size;
          const ta = hash(col, row, 50) * Math.PI;
          const tl = size * 0.2;

          g.strokeStyle = rgba([70, 48, 28], K, 0.9);
          g.lineWidth = Math.max(0.8, size * 0.026);
          g.beginPath();
          g.moveTo(tx, ty);
          g.lineTo(tx + Math.cos(ta) * tl, ty + Math.sin(ta) * tl);
          g.moveTo(tx + Math.cos(ta) * tl * 0.5, ty + Math.sin(ta) * tl * 0.5);
          g.lineTo(
            tx + Math.cos(ta + 0.7) * tl * 0.8,
            ty + Math.sin(ta + 0.7) * tl * 0.8
          );
          g.stroke();
        }

        // Tiny wildflowers
        if (hash(col, row, 60) < 0.06) {
          const fx = x0 + (0.2 + hash(col, row, 61) * 0.6) * size;
          const fy = y0 + (0.2 + hash(col, row, 62) * 0.6) * size;
          const fc = FOREST.petals[Math.floor(hash(col, row, 63) * FOREST.petals.length)];
          const pr = size * 0.024;

          g.fillStyle = rgba(fc, K, 0.95);

          for (let p = 0; p < 5; p += 1) {
            const a = (p / 5) * Math.PI * 2;
            g.beginPath();
            g.arc(fx + Math.cos(a) * pr * 1.3, fy + Math.sin(a) * pr * 1.3, pr, 0, Math.PI * 2);
            g.fill();
          }

          g.fillStyle = rgba([255, 200, 60], K, 1);
          g.beginPath();
          g.arc(fx, fy, pr * 0.8, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    g.restore();
  }

  function strokeSegs(g, segs, vp, ox, oy) {
    g.beginPath();

    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      g.moveTo(vp.originX + s[0] * vp.size + ox, vp.originY + s[1] * vp.size + oy);
      g.lineTo(vp.originX + s[2] * vp.size + ox, vp.originY + s[3] * vp.size + oy);
    }

    g.stroke();
  }

  // Tall layered hedge walls
  function paintWalls(g, maze, vp, lit) {
    const segs = getSegments(maze);
    const { size, originX, originY } = vp;
    const K = lit ? 1 : 0.42;
    const thick = Math.max(6, size * 0.36);

    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // Long cast shadow: gives the hedges height
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = thick * 1.5;
    strokeSegs(g, segs, vp, thick * 0.18, thick * 0.4);

    // Deep undergrowth base
    g.strokeStyle = rgba(FOREST.hedgeDeep, K, 1);
    g.lineWidth = thick * 1.05;
    strokeSegs(g, segs, vp, 0, 0);

    // One layer of overlapping foliage blobs along every wall piece
    function foliage(count, rMin, rVar, color, offX, offY, alpha, skip, salt) {
      for (let i = 0; i < segs.length; i += 1) {
        const s = segs[i];
        const horiz = s[1] === s[3];

        for (let k = 0; k < count; k += 1) {
          if (skip && hash(i, k, salt + 1) < skip) continue;

          const t = -0.03 + ((k + hash(i, k, salt) * 0.8) / count) * 1.06;
          const jit = (hash(i, k, salt + 2) - 0.5) * thick * 0.5;
          const px = originX + (s[0] + (s[2] - s[0]) * t) * size + offX + (horiz ? 0 : jit);
          const py = originY + (s[1] + (s[3] - s[1]) * t) * size + offY + (horiz ? jit : 0);
          const r = thick * (rMin + hash(i, k, salt + 3) * rVar);
          const v = 0.8 + hash(i, k, salt + 4) * 0.4;

          g.fillStyle = rgba(color, K * v, alpha);
          g.beginPath();
          g.arc(px, py, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    foliage(9, 0.5, 0.2, FOREST.hedgeDark, 0, 0, 1, 0, 200);
    foliage(8, 0.4, 0.2, FOREST.hedgeMid, -thick * 0.03, -thick * 0.1, 1, 0, 300);
    foliage(7, 0.28, 0.18, FOREST.hedgeLight, -thick * 0.06, -thick * 0.22, 0.95, 0.25, 400);
    foliage(4, 0.13, 0.1, FOREST.hedgeGlow, -thick * 0.1, -thick * 0.3, 0.55, 0.35, 500);

    // Individual leaf flecks for a leafy texture
    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      const horiz = s[1] === s[3];

      for (let k = 0; k < 12; k += 1) {
        const t = hash(i, k, 700);
        const jit = (hash(i, k, 701) - 0.5) * thick * 0.85;
        const px = originX + (s[0] + (s[2] - s[0]) * t) * size - thick * 0.05 + (horiz ? 0 : jit);
        const py = originY + (s[1] + (s[3] - s[1]) * t) * size - thick * 0.15 + (horiz ? jit : 0);
        const rot = hash(i, k, 702) * Math.PI;
        const bright = hash(i, k, 703);

        g.fillStyle = bright > 0.5
          ? rgba(FOREST.hedgeLight, K * (0.85 + bright * 0.4), 0.85)
          : rgba(FOREST.hedgeDeep, K * (0.8 + bright), 0.75);

        g.beginPath();
        g.ellipse(px, py, thick * 0.12, thick * 0.055, rot, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Berries and wildflowers tucked into the hedge
    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      const horiz = s[1] === s[3];
      const roll = hash(i, 2, 610);

      if (roll > 0.22) continue;

      const isBerry = roll < 0.12;
      const t0 = 0.15 + hash(i, 3, 611) * 0.7;
      const clusterColor = isBerry
        ? FOREST.berries[Math.floor(hash(i, 4, 612) * FOREST.berries.length)]
        : FOREST.petals[Math.floor(hash(i, 4, 613) * FOREST.petals.length)];

      for (let k = 0; k < 3; k += 1) {
        const t = Math.min(0.95, Math.max(0.05, t0 + (hash(i, k, 614) - 0.5) * 0.14));
        const jit = (hash(i, k, 615) - 0.5) * thick * 0.5;
        const px = originX + (s[0] + (s[2] - s[0]) * t) * size - thick * 0.08 + (horiz ? 0 : jit);
        const py = originY + (s[1] + (s[3] - s[1]) * t) * size - thick * 0.22 + (horiz ? jit : 0);

        if (isBerry) {
          const r = Math.max(1, size * 0.028);

          g.fillStyle = rgba(clusterColor, K, 1);
          g.beginPath();
          g.arc(px, py, r, 0, Math.PI * 2);
          g.fill();

          g.fillStyle = 'rgba(255,255,255,' + (lit ? 0.6 : 0.25) + ')';
          g.beginPath();
          g.arc(px - r * 0.3, py - r * 0.3, r * 0.35, 0, Math.PI * 2);
          g.fill();
        } else {
          const pr = Math.max(0.8, size * 0.022);

          g.fillStyle = rgba(clusterColor, K, 0.95);

          for (let p = 0; p < 5; p += 1) {
            const a = (p / 5) * Math.PI * 2;
            g.beginPath();
            g.arc(px + Math.cos(a) * pr * 1.3, py + Math.sin(a) * pr * 1.3, pr, 0, Math.PI * 2);
            g.fill();
          }

          g.fillStyle = rgba([255, 200, 60], K, 1);
          g.beginPath();
          g.arc(px, py, pr * 0.75, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    g.restore();
  }

  function paintStatic(canvas, maze, vp, dpr, lit) {
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    paintFloors(g, maze, vp, lit);
    paintWalls(g, maze, vp, lit);
  }

  function buildCache(state, vp, width, height, dpr, key) {
    const W = Math.round(width * dpr);
    const H = Math.round(height * dpr);

    const lit = makeCanvas(W, H);
    const light = makeCanvas(W, H);

    paintStatic(lit, state.maze, vp, dpr, true);

    // Background: deep forest gradient
    const bg = makeCanvas(W, H);
    const bgc = bg.getContext('2d');
    bgc.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bgGrad = bgc.createRadialGradient(
      width / 2, height / 2, 0,
      width / 2, height / 2, Math.max(width, height) * 0.7
    );
    bgGrad.addColorStop(0, '#0f2014');
    bgGrad.addColorStop(1, '#030804');
    bgc.fillStyle = bgGrad;
    bgc.fillRect(0, 0, width, height);

    // Vignette (gentle, so the maze stays visible)
    const vig = makeCanvas(W, H);
    const vg = vig.getContext('2d');
    vg.setTransform(dpr, 0, 0, dpr, 0, 0);

    const vGrad = vg.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.4,
      width / 2, height / 2, Math.max(width, height) * 0.8
    );
    vGrad.addColorStop(0, 'rgba(2,6,3,0)');
    vGrad.addColorStop(1, 'rgba(2,6,3,0.62)');
    vg.fillStyle = vGrad;
    vg.fillRect(0, 0, width, height);

    const cache = {
      key, W, H, dpr,
      lit, light, bg, vig,
      lctx: light.getContext('2d'),
      memSeen: new Uint8Array(state.maze.cols * state.maze.rows),
      seenRef: null,
      _dim: null,
      _mem: null,
      _mctx: null
    };

    // The dim (unlit) art and the memory layer are only needed for debug mode
    // or when memoryAlpha > 0, so they are built lazily. This halves startup
    // paint time and saves two full-size canvases of memory.
    cache.getDim = function () {
      if (!cache._dim) {
        cache._dim = makeCanvas(W, H);
        paintStatic(cache._dim, state.maze, vp, dpr, false);
      }
      return cache._dim;
    };

    cache.getMem = function () {
      if (!cache._mem) {
        cache._mem = makeCanvas(W, H);
        cache._mctx = cache._mem.getContext('2d');
      }
      return cache._mem;
    };

    return cache;
  }

  function getCache(state, vp, width, height, dpr) {
    const key = width + '|' + height + '|' + dpr + '|' + vp.size.toFixed(3);

    let c = caches.get(state.maze);

    if (!c || c.key !== key) {
      c = buildCache(state, vp, width, height, dpr, key);
      caches.set(state.maze, c);
    }

    return c;
  }

  /** Copies newly seen cells from the dim layer into the persistent memory layer. */
  function syncMemory(cache, state, vp) {
    const { maze, seen } = state;
    const dpr = cache.dpr;

    cache.getMem();

    if (cache.seenRef !== seen) {
      cache._mctx.setTransform(1, 0, 0, 1, 0, 0);
      cache._mctx.clearRect(0, 0, cache.W, cache.H);
      cache.memSeen.fill(0);
      cache.seenRef = seen;
    }

    const pad = Math.max(6, vp.size * 0.36) * 0.9;
    const g = cache._mctx;
    const dimCanvas = cache.getDim();

    g.setTransform(1, 0, 0, 1, 0, 0);

    for (let i = 0; i < seen.length; i += 1) {
      if (!seen[i] || cache.memSeen[i]) continue;

      cache.memSeen[i] = 1;

      const col = i % maze.cols;
      const row = (i / maze.cols) | 0;

      const x0 = Math.max(0, Math.floor((vp.originX + col * vp.size - pad) * dpr));
      const y0 = Math.max(0, Math.floor((vp.originY + row * vp.size - pad) * dpr));
      const x1 = Math.min(cache.W, Math.ceil((vp.originX + (col + 1) * vp.size + pad) * dpr));
      const y1 = Math.min(cache.H, Math.ceil((vp.originY + (row + 1) * vp.size + pad) * dpr));

      if (x1 > x0 && y1 > y0) {
        g.drawImage(dimCanvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      }
    }
  }

  // ------------------------------------------------------------------------
  // DYNAMIC ART
  // ------------------------------------------------------------------------

  // START PORTAL (warm golden sigil)
  function drawStartPad(ctx, state, vp, time, lit) {
    const { start } = state.maze;

    const cx = vp.originX + (start.col + 0.5) * vp.size;
    const cy = vp.originY + (start.row + 0.5) * vp.size;

    const pulse = 0.5 + 0.5 * Math.sin(time / 700);

    ctx.save();

    // Soft floor glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, vp.size * 0.7);
    glow.addColorStop(0, 'rgba(255,200,110,' + (lit ? 0.32 + pulse * 0.16 : 0.18) + ')');
    glow.addColorStop(1, 'rgba(255,200,110,0)');

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, vp.size * 0.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = PALETTE.start;
    ctx.lineWidth = Math.max(1, vp.size * 0.06);

    // Rotating dashed outer ring
    ctx.globalAlpha = lit ? 0.6 + pulse * 0.35 : 0.5;
    ctx.setLineDash([vp.size * 0.16, vp.size * 0.12]);
    ctx.lineDashOffset = -time / 55;

    ctx.beginPath();
    ctx.arc(cx, cy, vp.size * (0.32 + pulse * 0.04), 0, Math.PI * 2);
    ctx.stroke();

    // Solid inner ring
    ctx.setLineDash([]);
    ctx.globalAlpha = lit ? 0.7 : 0.4;
    ctx.lineWidth = Math.max(0.8, vp.size * 0.03);

    ctx.beginPath();
    ctx.arc(cx, cy, vp.size * 0.16, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  // KEY — high-visibility version: dark contrast disc, floor beacon + ripples,
  // dark/white outlined body filled with the key colour, glowing gem, sparkles.
  function drawKey(ctx, x, y, size, hex, time) {
    const pulse = 0.5 + 0.5 * Math.sin(time / 420 + x);
    const bob = Math.sin(time / 520 + x) * size * 0.05;
    const scale = size * 0.18;
    const w = Math.max(3, size * 0.09);
    const floorY = y + size * 0.16;

    ctx.save();

    // FLOOR BEACON (additive colour pool, pulsing)
    ctx.globalCompositeOperation = 'lighter';

    const beacon = ctx.createRadialGradient(x, floorY, 0, x, floorY, size * 1.15);
    beacon.addColorStop(0, hex + Math.round((0.38 + 0.18 * pulse) * 255).toString(16).padStart(2, '0'));
    beacon.addColorStop(0.5, hex + '22');
    beacon.addColorStop(1, hex + '00');

    ctx.fillStyle = beacon;
    ctx.beginPath();
    ctx.arc(x, floorY, size * 1.15, 0, Math.PI * 2);
    ctx.fill();

    // EXPANDING RIPPLES on the ground
    ctx.strokeStyle = hex;
    ctx.lineWidth = Math.max(1.5, size * 0.04);

    for (let r = 0; r < 2; r += 1) {
      const phase = ((time / 1400 + r * 0.5 + x * 0.013) % 1 + 1) % 1;
      const rad = size * (0.22 + 0.6 * phase);

      ctx.globalAlpha = (1 - phase) * 0.85;
      ctx.beginPath();
      ctx.ellipse(x, floorY, rad, rad * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // DARK BACKING DISC: makes every colour (especially green) pop on the forest
    const backing = ctx.createRadialGradient(x, y + bob, 0, x, y + bob, size * 0.52);
    backing.addColorStop(0, 'rgba(0,0,0,0.72)');
    backing.addColorStop(0.7, 'rgba(0,0,0,0.42)');
    backing.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = backing;
    ctx.beginPath();
    ctx.arc(x, y + bob, size * 0.52, 0, Math.PI * 2);
    ctx.fill();

    // KEY BODY
    ctx.translate(x, y + bob);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const keyPath = function () {
      ctx.beginPath();
      ctx.arc(0, -scale * 0.65, scale, 0, Math.PI * 2);
      ctx.moveTo(0, scale * 0.35);
      ctx.lineTo(0, scale * 2.15);
      ctx.moveTo(0, scale * 1.25);
      ctx.lineTo(scale * 0.7, scale * 1.25);
      ctx.lineTo(scale * 0.7, scale * 1.6);
      ctx.moveTo(0, scale * 1.8);
      ctx.lineTo(scale * 0.55, scale * 1.8);
      ctx.lineTo(scale * 0.55, scale * 2.1);
    };

    // 1) dark outline with coloured glow
    ctx.shadowColor = hex;
    ctx.shadowBlur = size * 0.5;
    ctx.strokeStyle = '#050805';
    ctx.lineWidth = w + size * 0.07;
    keyPath();
    ctx.stroke();

    // 2) white rim
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = w + size * 0.03;
    keyPath();
    ctx.stroke();

    // 3) key colour body
    ctx.strokeStyle = hex;
    ctx.lineWidth = w;
    keyPath();
    ctx.stroke();

    // 4) specular highlight
    ctx.save();
    ctx.translate(-w * 0.18, -w * 0.18);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = w * 0.28;
    keyPath();
    ctx.stroke();
    ctx.restore();

    // GLOWING GEM in the bow
    ctx.shadowColor = hex;
    ctx.shadowBlur = size * (0.3 + pulse * 0.2);
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(0, -scale * 0.65, scale * 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, -scale * 0.65, scale * 0.13, 0, Math.PI * 2);
    ctx.fill();

    // ORBITING SPARKLES
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1, size * 0.02);

    for (let i = 0; i < 4; i += 1) {
      const ang = time / 900 + i * (Math.PI / 2);
      const sx = Math.cos(ang) * scale * 2.0;
      const sy = Math.sin(ang) * scale * 1.7 + scale * 0.5;
      const blink = 0.5 + 0.5 * Math.sin(time / 240 + i * 1.7);
      const arm = size * (0.03 + 0.05 * blink);

      ctx.globalAlpha = 0.35 + 0.65 * blink;
      ctx.strokeStyle = i % 2 === 0 ? '#ffffff' : hex;
      ctx.beginPath();
      ctx.moveTo(sx - arm, sy);
      ctx.lineTo(sx + arm, sy);
      ctx.moveTo(sx, sy - arm);
      ctx.lineTo(sx, sy + arm);
      ctx.stroke();
    }

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

  // GLOWING MUSHROOM CLUSTERS growing on the hedges (drawn in the lit layer,
  // so the fog hides them until your lamp reaches them). Each throws a
  // coloured light pool onto the forest floor.
  function drawGlowShrooms(g, state, vp, time, px, py, reach) {
    const torches = getTorches(state.maze);
    const s = vp.size;
    const thick = Math.max(6, s * 0.36);

    g.save();

    for (let n = 0; n < torches.length; n += 1) {
      const t = torches[n];
      const x = vp.originX + t.x * s - thick * 0.06;
      const y = vp.originY + t.y * s - thick * 0.22;

      if (Math.abs(x - px) > reach || Math.abs(y - py) > reach) continue;

      const h = FOREST.shroomHues[t.i % FOREST.shroomHues.length];
      const hs = h.join(',');
      const f = 0.72 + 0.28 * Math.sin(time / (520 + (t.i % 5) * 110) + t.i);

      // Coloured light pool on the floor
      g.globalCompositeOperation = 'lighter';

      const pr = s * (1.4 + 0.2 * f);
      const pool = g.createRadialGradient(x, y + s * 0.15, 0, x, y + s * 0.15, pr);

      pool.addColorStop(0, 'rgba(' + hs + ',' + (0.26 * f).toFixed(3) + ')');
      pool.addColorStop(0.5, 'rgba(' + hs + ',' + (0.08 * f).toFixed(3) + ')');
      pool.addColorStop(1, 'rgba(' + hs + ',0)');

      g.fillStyle = pool;
      g.beginPath();
      g.arc(x, y + s * 0.15, pr, 0, Math.PI * 2);
      g.fill();

      g.globalCompositeOperation = 'source-over';

      // Cluster of three mushrooms
      const caps = [[-0.07, 0.02, 0.075], [0.03, -0.02, 0.095], [0.1, 0.04, 0.06]];

      for (let c = 0; c < caps.length; c += 1) {
        const mx = x + caps[c][0] * s;
        const my = y + caps[c][1] * s;
        const r = caps[c][2] * s;

        // Stem
        g.fillStyle = '#d9e8d0';
        g.fillRect(mx - s * 0.012, my, s * 0.024, s * 0.07);

        // Glowing cap
        g.shadowColor = 'rgba(' + hs + ',1)';
        g.shadowBlur = s * 0.28 * f;

        const cg = g.createLinearGradient(mx, my - r, mx, my);
        cg.addColorStop(0, 'rgba(255,255,255,0.95)');
        cg.addColorStop(0.35, rgba(h, 1, 1));
        cg.addColorStop(1, rgba(h, 0.55, 1));

        g.fillStyle = cg;
        g.beginPath();
        g.ellipse(mx, my, r, r * 0.62, 0, Math.PI, Math.PI * 2);
        g.closePath();
        g.fill();

        g.shadowBlur = 0;

        // Spot
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.beginPath();
        g.arc(mx - r * 0.35, my - r * 0.28, Math.max(0.7, s * 0.011), 0, Math.PI * 2);
        g.fill();
      }
    }

    g.restore();
  }

  // FIREFLIES, FALLING LEAVES AND MIST (drawn in the lit layer, so the fog
  // hides them outside the lamp)
  function drawAmbience(g, state, vp, time) {
    const { maze } = state;
    const s = vp.size;
    const W = maze.cols * s;
    const H = maze.rows * s;
    const px = vp.originX + (state.player.col + 0.5) * s;
    const py = vp.originY + (state.player.row + 0.5) * s;
    const reach = s * 7;

    g.save();

    // Drifting mist wisps around the player
    for (let i = 0; i < 6; i += 1) {
      const ang = time / 9000 + i * 1.05;
      const mx = px + Math.cos(ang * (0.6 + i * 0.1)) * s * 3.2;
      const my = py + Math.sin(ang * 0.8 + i) * s * 2.4;
      const mist = g.createRadialGradient(mx, my, 0, mx, my, s * 2.2);

      mist.addColorStop(0, 'rgba(170,215,200,0.075)');
      mist.addColorStop(1, 'rgba(170,215,200,0)');

      g.fillStyle = mist;
      g.beginPath();
      g.arc(mx, my, s * 2.2, 0, Math.PI * 2);
      g.fill();
    }

    // Falling leaves
    for (let i = 0; i < 26; i += 1) {
      const sp = (6 + hash(i, 3, 21) * 8) * (s / 18);
      const x = vp.originX + hash(i, 1, 21) * W + Math.sin(time / 1300 + i) * s * 0.5;
      const y = vp.originY + (((hash(i, 2, 21) * H + time * 0.001 * sp) % H) + H) % H;

      if (Math.abs(x - px) > reach || Math.abs(y - py) > reach) continue;

      const lc = FOREST.leaves[i % FOREST.leaves.length];

      g.globalAlpha = 0.85;
      g.fillStyle = rgba(lc, 1, 1);
      g.beginPath();
      g.ellipse(x, y, s * 0.05, s * 0.026, time / 900 + i, 0, Math.PI * 2);
      g.fill();
    }

    g.globalAlpha = 1;

    // Fireflies
    g.globalCompositeOperation = 'lighter';

    for (let i = 0; i < 110; i += 1) {
      const x = vp.originX + hash(i, 1, 11) * W +
        Math.sin(time / (1400 + hash(i, 3, 11) * 1800) + i) * s * 0.9;
      const y = vp.originY + hash(i, 2, 11) * H +
        Math.cos(time / (1700 + hash(i, 4, 11) * 1500) + i * 1.3) * s * 0.7;

      if (Math.abs(x - px) > reach || Math.abs(y - py) > reach) continue;

      const blink = Math.pow(0.5 + 0.5 * Math.sin(time / (500 + hash(i, 5, 11) * 600) + i * 2.1), 3);

      if (blink < 0.03) continue;

      const gr = s * 0.24;
      const fg = g.createRadialGradient(x, y, 0, x, y, gr);

      fg.addColorStop(0, 'rgba(210,255,130,' + (0.9 * blink).toFixed(3) + ')');
      fg.addColorStop(0.3, 'rgba(180,255,100,' + (0.3 * blink).toFixed(3) + ')');
      fg.addColorStop(1, 'rgba(160,255,90,0)');

      g.fillStyle = fg;
      g.beginPath();
      g.arc(x, y, gr, 0, Math.PI * 2);
      g.fill();
    }

    g.restore();
  }

  // PLAYER
  function drawPlayer(ctx, state, vp, time) {
    const { player } = state;

    const cx = vp.originX + (player.col + 0.5) * vp.size;
    const cy = vp.originY + (player.row + 0.5) * vp.size;

    const s = vp.size;
    const playerScale = 1.22;

    const pulse = 0.5 + 0.5 * Math.sin(time / 420);

    const lampLevel = state.lamp ? state.lamp.intensity : 1;

    // PLAYER SHADOW
    ctx.save();

    ctx.fillStyle = 'rgba(0,0,0,0.55)';

    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.2, s * 0.2, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // HEADLAMP GLOW (follows the flicker) — warm lantern light
    const gr = s * 1.7 * (0.55 + 0.45 * lampLevel);

    const lampGlow = ctx.createRadialGradient(cx, cy - s * 0.18, 0, cx, cy - s * 0.18, gr);

    lampGlow.addColorStop(0, 'rgba(255,200,120,' + (0.3 * lampLevel).toFixed(3) + ')');
    lampGlow.addColorStop(0.35, 'rgba(255,170,90,' + (0.12 * lampLevel).toFixed(3) + ')');
    lampGlow.addColorStop(1, 'rgba(255,160,80,0)');

    ctx.fillStyle = lampGlow;

    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.18, gr, 0, Math.PI * 2);
    ctx.fill();

    // PLAYER BODY
    ctx.save();

    ctx.translate(cx, cy);

    // Subtle breathing movement
    const breathe = Math.sin(time / 650) * s * 0.012;

    ctx.translate(0, breathe);
    ctx.scale(playerScale, playerScale);

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

    // HEADLAMP (warm)
    ctx.shadowColor = '#ffb45c';
    ctx.shadowBlur = s * (0.25 + pulse * 0.12);

    ctx.fillStyle = '#fff1d0';

    ctx.beginPath();
    ctx.arc(0, -s * 0.22, s * 0.035, 0, Math.PI * 2);
    ctx.fill();

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

  // WRONG-KEY RETURN BANNER
  function drawDisorientBanner(ctx, state, width) {
    const remaining = state.controlsReversedMs;

    if (!remaining || remaining <= 0) return;

    const total = CONFIG.disorient.durationMs;

    const fade = isFinite(remaining)
      ? Math.min(
          1,
          (total - remaining) / 150 + 0.2,
          remaining / 400
        )
      : 1;

    const w = Math.min(300, width - 24);
    const h = 135;

    const x = Math.max(12, width - w - 14);
    const y = 14;

    const centerX = x + w / 2;

    ctx.save();

    ctx.globalAlpha = Math.max(0, fade);

    // Background
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;

    ctx.fillStyle = 'rgba(8,4,12,0.95)';

    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 12);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }

    // Border
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 1.8;

    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 12);
      ctx.stroke();
    } else {
      ctx.strokeRect(x, y, w, h);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Title
    ctx.font = '800 19px Arial, sans-serif';
    ctx.fillStyle = '#ff4d6d';

    ctx.fillText(
      '❌ WRONG KEY',
      centerX,
      y + 27
    );

    // Instruction
    ctx.font = '700 11px Arial, sans-serif';
    ctx.fillStyle = '#d7e4ff';

    ctx.fillText(
      'RETURN TO START — THEN TRY AGAIN',
      centerX,
      y + 49
    );

    // Separator
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(x + 22, y + 66);
    ctx.lineTo(x + w - 22, y + 66);
    ctx.stroke();

    // Controls warning
    ctx.font = '800 10px Arial, sans-serif';
    ctx.fillStyle = '#ffd166';

    ctx.fillText(
      '⚠ CONTROLS DISORIENTED',
      centerX,
      y + 86
    );

    // Controls
    ctx.font = '700 10px Arial, sans-serif';
    ctx.fillStyle = '#d7e4ff';

    ctx.fillText(
      'W → DOWN     S → UP',
      centerX,
      y + 105
    );

    ctx.fillText(
      'D → LEFT     A → RIGHT',
      centerX,
      y + 121
    );

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
  // width/height are CSS pixels. `lightCtx` is accepted for compatibility but
  // unused: the renderer owns its cached offscreen layers.
  function renderScene(ctx, lightCtx, state, width, height, time) {
    if (!state || !state.maze) return;

    if (time == null) time = performance.now();

    const dpr = Math.max(1, Math.min(4, ctx.canvas.width / Math.max(1, width)));

    const vp = computeViewport(state.maze, width, height);

    const cache = getCache(state, vp, width, height, dpr);

    const { player, debug } = state;

    const lamp = state.lamp || { radiusScale: 1, alpha: 1, intensity: 1 };

    // WRONG-KEY SHAKE (visual only)
    ctx.save();

    if (state.status === 'WRONG_KEY') {
      const power = Math.max(0, Math.min(1, state.wrongFeedbackRemainingMs / CONFIG.wrongFeedbackMs));
      const amp = 7 * power;

      ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }

    // BACKGROUND
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(-10, -10, width + 20, height + 20);

    ctx.drawImage(cache.bg, 0, 0, width, height);

    // REMEMBERED GEOMETRY
    if (debug) {
      // Organizer-only debug view: reveals the whole maze and all keys.
      ctx.globalAlpha = 0.42;
      ctx.drawImage(cache.getDim(), 0, 0, width, height);
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.globalAlpha = 0.42;
      drawKeys(ctx, state, vp, time, true);
      ctx.restore();
    } else if (CONFIG.memoryAlpha > 0) {
      // Explored-area memory (disabled when memoryAlpha is 0).
      syncMemory(cache, state, vp);

      ctx.globalAlpha = CONFIG.memoryAlpha;
      ctx.drawImage(cache.getMem(), 0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    // LIT WORLD (only inside the lamp's bounding box)
    const cx = vp.originX + (player.col + 0.5) * vp.size;
    const cy = vp.originY + (player.row + 0.5) * vp.size;

    // flickering lamp: radius and strength follow state.lamp
    const inner = CONFIG.sightRadius * vp.size * lamp.radiusScale;

    const outer = (CONFIG.sightRadius + CONFIG.sightFalloff) * vp.size * lamp.radiusScale;

    const a = lamp.alpha;

    const x0 = Math.max(0, Math.floor(cx - outer));
    const y0 = Math.max(0, Math.floor(cy - outer));
    const x1 = Math.min(width, Math.ceil(cx + outer));
    const y1 = Math.min(height, Math.ceil(cy + outer));

    if (x1 > x0 && y1 > y0) {
      const dx = Math.floor(x0 * dpr);
      const dy = Math.floor(y0 * dpr);
      const dw = Math.min(cache.W - dx, Math.ceil((x1 - x0) * dpr));
      const dh = Math.min(cache.H - dy, Math.ceil((y1 - y0) * dpr));

      const bx = dx / dpr;
      const by = dy / dpr;
      const bw = dw / dpr;
      const bh = dh / dpr;

      const lg = cache.lctx;

      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.globalCompositeOperation = 'source-over';
      lg.globalAlpha = 1;
      lg.clearRect(dx, dy, dw, dh);
      lg.drawImage(cache.lit, dx, dy, dw, dh, dx, dy, dw, dh);

      lg.save();
      lg.setTransform(dpr, 0, 0, dpr, 0, 0);

      lg.beginPath();
      lg.rect(bx, by, bw, bh);
      lg.clip();

      drawStartPad(lg, state, vp, time, true);

      drawKeys(lg, state, vp, time, true);

      drawGlowShrooms(lg, state, vp, time, cx, cy, outer + vp.size * 2);

      drawAmbience(lg, state, vp, time);

      const mask = lg.createRadialGradient(cx, cy, inner * 0.2, cx, cy, outer);

      mask.addColorStop(0, `rgba(255,255,255,${a})`);
      mask.addColorStop(0.55, `rgba(255,255,255,${0.92 * a})`);
      mask.addColorStop(0.8, `rgba(255,255,255,${0.35 * a})`);
      mask.addColorStop(1, 'rgba(255,255,255,0)');

      lg.globalCompositeOperation = 'destination-in';
      lg.fillStyle = mask;
      lg.fillRect(bx, by, bw, bh);

      lg.restore();

      // COMPOSITE
      ctx.drawImage(cache.light, dx, dy, dw, dh, bx, by, bw, bh);

      // Warm ambient glow from the lantern (additive), breathing with the lamp
      const amb = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer * 0.9);

      amb.addColorStop(0, 'rgba(255,170,90,' + (0.13 * lamp.intensity).toFixed(3) + ')');
      amb.addColorStop(1, 'rgba(255,150,70,0)');

      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = amb;
      ctx.fillRect(bx, by, bw, bh);
      ctx.globalCompositeOperation = 'source-over';
    }

    // PLAYER
    drawPlayer(ctx, state, vp, time);

    // FEEDBACK
    drawWrongKeyFeedback(ctx, state, width, height);

    drawSuccessFeedback(ctx, state, width, height);

    // VIGNETTE
    ctx.drawImage(cache.vig, 0, 0, width, height);

    // end shake
    ctx.restore();

    // disoriented controls banner
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