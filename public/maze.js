/**
 * BRAIN BREAKER — Stage 02: Fog Maze Game Engine & Renderer
 *
 * Pure Vanilla JavaScript + HTML5 Canvas
 *
 * GAME LOGIC: identical to the previous version except for:
 * - Movement: exactly ONE cell per movement step (no leftover budget carried
 *   into the next cell inside a single update() call)
 * - Wrong-key clue: deterministic clue built from the real key positions,
 *   with three difficulty levels (exposed via snapshot.clue / snapshot.clueLevel
 *   and onWrongKey(color, clue, level))
 *
 * THE LOOK (renderer / PALETTE) IS UNCHANGED:
 * - Walls are real stone brick: mortar joints, weathered tone variation,
 *   chipped cracks, moss, lit top edge, cast shadow
 * - Floor is worn flagstone with cracks, dirt stains, moss and pebbles
 * - Warm torch-light palette: amber headlamp, ember dust, warm ambient glow
 * - Interactive lighting: flickering wall torches that throw light pools onto
 *   the floor (only visible inside your lamp), lamp-reactive glow
 * - Wrong-key screen shake
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
    memoryAlpha: 0.2,      // visual only: how visible explored (remembered) areas are

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

  // Torch-lit stone dungeon palette
  const PALETTE = {
    void: '#070504',
    floor: '#231d18',
    floorLit: '#3e342c',
    wall: '#6b6157',
    wallGlow: '#ffb15c',
    player: '#ffd9a0',
    start: '#ffe0a3',
    accent: '#ff8a3d',
    success: '#3df5a5',
    wrong: '#ff4d6d'
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

  // ==========================================================================
  // WRONG-KEY CLUE TEXT
  // ==========================================================================

  // Wrong-key clue wording. Chosen deterministically from real key positions.
 // ==========================================================================
// DIFFICULT COLOUR CLUES
// ==========================================================================
//
// These clues NEVER reveal the colour directly.
// They describe an association with the correct colour.
//
// Difficulty increases after every wrong attempt:
//
// WRONG #1 -> cryptic but solvable
// WRONG #2 -> more abstract
// WRONG #3+ -> very cryptic
//
// The correct colour is passed internally, but the actual colour name is
// never sent in the clue text.
//

const COLOR_CLUES = {
  RED: {
    1: [
      'The internet calls this a warning. Dating apps practically made it famous.',
      'Two card suits would answer this immediately.',
      'Mars has been carrying this association for centuries.',
      'A traffic light uses this when the conversation is over.',
      'If “danger” had a favourite outfit, this would be it.',
      'The opposite of a green flag, but somehow much better at getting ignored.',
      'A certain planet, two card suits, and a stop signal share something obvious.',
      'In Among Us, seeing this colour does not exactly improve your trust issues.'
    ],

    2: [
      'A carpet can have it, a flag can have it, and a person can see it when they are furious.',
      'The group chat would call it a red flag before you finished explaining the story.',
      'It can mean love, danger, debt, and embarrassment without changing its identity.',
      'In roulette, half the numbered pockets are associated with it.',
      'A superhero may wear it. A warning sign may use it. Your bank balance may fear it.',
      'One colour somehow connects roses, revolutions, rage, and roulette.'
    ],

    3: [
      '🚩 You know the meme. Now solve the colour without being told the meme.',
      'It can signal “stop”, “danger”, “passion”, or “you should probably leave.”',
      'A colour with enough meanings to start a fight, end a relationship, or win a card game.',
      'Think: Ferrari, Mars, roses, roulette. What do they secretly agree on?',
      'The answer is hiding in the sentence: “That was a massive warning sign, bro.”'
    ]
  },

  BLUE: {
    1: [
      'A person can be one without being painted.',
      'Some playlists are basically this colour in audio form.',
      'The sky gets accused of it every clear afternoon.',
      'A police officer might be described using this colour.',
      'A certain moon in the Solar System has this as its name.',
      'The opposite of “seeing red” in one very specific emotional sense.'
    ],

    2: [
      'A mood, a music genre, and a police uniform can all point to the same answer.',
      'Someone can have this colour without owning a single piece of clothing.',
      'If the playlist starts at midnight and every song hurts, you are getting warmer.',
      'It can describe an inexperienced worker, a sad mood, and a law-enforcement officer.',
      'A planet looks this way from space, but that is not the only reason you know it.'
    ],

    3: [
      '“I am fine” + headphones + rain outside = suspiciously specific clue.',
      'The answer can describe a mood without describing a facial expression.',
      'One word connects sadness, uniforms, music, and a planet.',
      'If the vibe is immaculate but emotionally devastating, think here.',
      'The colour is also hiding inside an adjective meaning inexperienced.'
    ]
  },

  GREEN: {
    1: [
      'Traffic says go. Dating advice says good sign.',
      'A beginner can be one.',
      'Fruit sometimes starts here before becoming edible.',
      'The opposite of a red flag.',
      'The Hulk would probably approve.',
      'Money can be associated with it even when nobody is talking about trees.'
    ],

    2: [
      'A traffic signal, a jealous person, and an inexperienced person can all point to the same word.',
      'The internet turned this colour into relationship approval.',
      'It can describe envy without ever mentioning jealousy directly.',
      'A monster, a beginner, and an environmental movement all share this clue.',
      'When the group chat says “he actually communicates,” this colour gets involved.'
    ],

    3: [
      '🚦 + “he respects boundaries” + 🌱 = solve the common denominator.',
      'The same word can describe a traffic instruction, jealousy, and someone new to the game.',
      'One colour became the internet’s shorthand for “okay, this person is probably safe.”',
      'It can mean “go”, “grow”, “beginner”, and “jealous” depending on what follows it.',
      'A flag, a traffic light, and a fruit before breakfast all know the answer.'
    ]
  },

  YELLOW: {
    1: [
      'Not stop. Not go. Basically “bro, wait.”',
      'A banana usually gives this one away.',
      'A school bus would know the answer.',
      'It appears between two more decisive choices on a traffic signal.',
      'The Sun gets drawn wearing it by approximately every five-year-old ever.',
      'A warning sign might choose this when red feels too aggressive.'
    ],

    2: [
      'A newspaper can practice it. A fruit can be it. A traffic light can flash it.',
      'It lives somewhere between “absolutely not” and “send it.”',
      'The colour equivalent of typing “hmmm…” before replying.',
      'A certain journalism style shares its name with this colour.',
      'If red says stop and green says go, this one says “your call.”'
    ],

    3: [
      'Traffic uses it for hesitation; journalism uses it for sensationalism.',
      'A banana, a school bus, and a controversial newspaper style walk into a room.',
      'Neither W nor L. Just pure “let me think about it.”',
      'The middle child of the traffic signal has an unexpectedly dramatic career in journalism.',
      'If a colour could leave you on read while technically responding, this would be it.'
    ]
  }
};

/**
 * Return one difficult clue for the correct colour.
 *
 * The colour itself is NEVER included in the returned text.
 */
function getColourClue(correctColor, level) {
  const normalized = normalizeColor(correctColor);

  if (!normalized || !COLOR_CLUES[normalized]) {
    return 'Something remains hidden.';
  }

  const difficulty = Math.min(3, Math.max(1, level));

  const clues = COLOR_CLUES[normalized][difficulty];

  if (!clues || clues.length === 0) {
    return 'Something remains hidden.';
  }

  return clues[Math.floor(Math.random() * clues.length)];
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
        wrongFeedbackRemainingMs: 0,
        held: [],
        seen: new Uint8Array(maze.cols * maze.rows),
        debug: false,

        // flickering lamp
        lamp: newLamp(),

        // remaining time (ms) of reversed controls
        controlsReversedMs: 0,

        // wrong-key clue (survives the reshuffle until the next wrong key)
        clue: null,
        clueLevel: 0
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

      // Clue is computed BEFORE resetAfterWrongKey() reshuffles the keys.
      const level = Math.min(3, this.state.wrongKeyCount);
      this.state.clueLevel = level;
      this.state.clue = this.buildWrongKeyClue(key, level);

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

    // WRONG-KEY CLUE
    // Built from the REAL positions before the reshuffle. Deterministic.
    // level 1 = depth + direction, level 2 = depth only, level 3+ = one cryptic line.
  // ==========================================================================
// WRONG-KEY COLOUR CLUE
// ==========================================================================
//
// IMPORTANT:
//
// The clue is generated BEFORE the keys are reshuffled.
//
// Example:
//
// Correct key = RED
//
// Player chooses BLUE
//
// They receive:
// "An ember knows the answer."
//
// Then the four keys move to completely new positions.
//
// This means the clue tells them WHAT COLOUR to search for,
// but not WHERE the key is.
//
// ==========================================================================

buildWrongKeyClue(wrongKey, level) {
  const correctColor = this.state.correctKey;

  if (!correctColor) {
    return 'Something remains hidden.';
  }

  return getColourClue(correctColor, level);
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

        clue: this.state.clue,
        clueLevel: this.state.clueLevel,

        controlsReversed: this.state.controlsReversedMs > 0,
        controlsReversedMs: isFinite(this.state.controlsReversedMs) ? this.state.controlsReversedMs : null,

        // Only expose correct key when DEBUG is ON.
        correctKey: this.state.debug ? this.state.correctKey : null
      };
    }
  }

  GameEngine.debugListenerInstalled = false;

  // ==========================================================================
  // RENDERER — everything below is visual only
  // ==========================================================================

  // Deterministic hash -> [0,1). Textures never shimmer between frames.
  function hash(a, b, c) {
    let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }

  const caches = new WeakMap();

  /**
   * MAXIMISED VIEWPORT: the maze fills the canvas. The only margin left is
   * the small overhang needed so the outer wall stroke is not clipped.
   */
  function computeViewport(maze, width, height) {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);

    const overhang = 0.42; // total extra cells (wall thickness + shadow)

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

  // Wall-mounted torch positions (chosen once per maze, deterministic).
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

  // Worn flagstone floor
  function paintFloors(g, maze, vp, lit) {
    const { size, originX, originY } = vp;
    const W = maze.cols * size;
    const H = maze.rows * size;

    // Warm earthen base with a soft centre glow
    const base = g.createRadialGradient(
      originX + W / 2, originY + H / 2, 0,
      originX + W / 2, originY + H / 2, Math.max(W, H) * 0.75
    );

    if (lit) {
      base.addColorStop(0, '#463b31');
      base.addColorStop(1, '#2a221c');
    } else {
      base.addColorStop(0, '#2a231d');
      base.addColorStop(1, '#15110e');
    }

    g.fillStyle = base;
    g.fillRect(originX, originY, W, H);

    const tone = lit ? [66, 55, 46] : [38, 32, 27];

    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        const x0 = Math.floor(originX + col * size);
        const y0 = Math.floor(originY + row * size);
        const x1 = Math.floor(originX + (col + 1) * size);
        const y1 = Math.floor(originY + (row + 1) * size);
        const cw = x1 - x0;
        const ch = y1 - y0;

        // Each flagstone gets its own slightly different tone
        const v = (hash(col, row, 1) - 0.5) * (lit ? 20 : 11);

        g.fillStyle =
          'rgba(' + Math.round(tone[0] + v) + ',' + Math.round(tone[1] + v * 0.9) + ',' +
          Math.round(tone[2] + v * 0.8) + ',0.82)';
        g.fillRect(x0, y0, cw, ch);

        // Mortar gap + bevel highlight
        g.strokeStyle = lit ? 'rgba(6,4,3,0.42)' : 'rgba(4,3,2,0.38)';
        g.lineWidth = Math.max(1, size * 0.045);
        g.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1);

        g.strokeStyle = lit ? 'rgba(255,225,190,0.07)' : 'rgba(255,225,190,0.03)';
        g.lineWidth = Math.max(1, size * 0.02);
        g.beginPath();
        g.moveTo(x0 + size * 0.05, y1 - size * 0.06);
        g.lineTo(x0 + size * 0.05, y0 + size * 0.05);
        g.lineTo(x1 - size * 0.06, y0 + size * 0.05);
        g.stroke();

        // Dirt stains
        if (hash(col, row, 12) < 0.12) {
          const sx = x0 + hash(col, row, 13) * cw;
          const sy = y0 + hash(col, row, 14) * ch;
          const sr = size * (0.25 + hash(col, row, 15) * 0.25);
          const dirt = g.createRadialGradient(sx, sy, 0, sx, sy, sr);

          dirt.addColorStop(0, lit ? 'rgba(20,12,6,0.4)' : 'rgba(10,6,3,0.3)');
          dirt.addColorStop(1, 'rgba(0,0,0,0)');

          g.fillStyle = dirt;
          g.beginPath();
          g.arc(sx, sy, sr, 0, Math.PI * 2);
          g.fill();
        }

        // Moss patches
        if (hash(col, row, 16) < 0.06) {
          const mx = x0 + (0.25 + hash(col, row, 17) * 0.5) * cw;
          const my = y0 + (0.25 + hash(col, row, 18) * 0.5) * ch;
          const mr = size * 0.3;
          const moss = g.createRadialGradient(mx, my, 0, mx, my, mr);

          moss.addColorStop(0, lit ? 'rgba(88,128,52,0.42)' : 'rgba(70,100,42,0.22)');
          moss.addColorStop(1, 'rgba(0,0,0,0)');

          g.fillStyle = moss;
          g.beginPath();
          g.arc(mx, my, mr, 0, Math.PI * 2);
          g.fill();
        }

        // Pebbles / grit
        if (hash(col, row, 2) < 0.45) {
          g.fillStyle = lit ? 'rgba(210,190,160,0.16)' : 'rgba(210,190,160,0.07)';
          g.beginPath();
          g.arc(
            x0 + hash(col, row, 3) * cw,
            y0 + hash(col, row, 4) * ch,
            Math.max(1, size * (0.02 + hash(col, row, 5) * 0.03)),
            0, Math.PI * 2
          );
          g.fill();
        }

        // Hairline cracks
        if (hash(col, row, 6) < 0.1) {
          let px = x0 + (0.15 + hash(col, row, 7) * 0.7) * cw;
          let py = y0 + (0.15 + hash(col, row, 8) * 0.7) * ch;

          g.strokeStyle = lit ? 'rgba(8,5,3,0.55)' : 'rgba(6,4,2,0.4)';
          g.lineWidth = Math.max(0.8, size * 0.025);
          g.beginPath();
          g.moveTo(px, py);

          for (let k = 0; k < 3; k += 1) {
            px += (hash(col, row, 20 + k) - 0.5) * size * 0.4;
            py += (hash(col, row, 30 + k) - 0.2) * size * 0.25;
            g.lineTo(px, py);
          }

          g.stroke();
        }
      }
    }
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

  // Real stone brick walls
  function paintWalls(g, maze, vp, lit) {
    const segs = getSegments(maze);
    const { size, originX, originY } = vp;
    const thick = Math.max(5, size * 0.28);
    const ox = -thick * 0.1;
    const oy = -thick * 0.14;

    g.save();
    g.lineCap = 'square';
    g.lineJoin = 'miter';

    // Cast shadow: gives the walls height
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = thick * 1.3;
    strokeSegs(g, segs, vp, thick * 0.12, thick * 0.3);

    // Dark stone body (faint warm torch bounce when lit)
    g.strokeStyle = lit ? '#4b433b' : '#2a2520';
    g.lineWidth = thick;

    if (lit) {
      g.shadowColor = 'rgba(255,150,70,0.4)';
      g.shadowBlur = size * 0.32;
    }

    strokeSegs(g, segs, vp, 0, 0);
    g.shadowBlur = 0;

    // Lighter top face of the stone
    g.strokeStyle = lit ? '#82776a' : '#463f38';
    g.lineWidth = thick * 0.66;
    strokeSegs(g, segs, vp, ox, oy);

    // Per-segment weathering: every wall piece gets its own tone
    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      const h = hash(i, 1, 41);

      g.strokeStyle = h > 0.5
        ? 'rgba(255,236,205,' + ((h - 0.5) * (lit ? 0.24 : 0.14)).toFixed(3) + ')'
        : 'rgba(0,0,0,' + ((0.5 - h) * (lit ? 0.4 : 0.3)).toFixed(3) + ')';

      g.lineWidth = thick * 0.66;
      g.beginPath();
      g.moveTo(originX + s[0] * size + ox, originY + s[1] * size + oy);
      g.lineTo(originX + s[2] * size + ox, originY + s[3] * size + oy);
      g.stroke();
    }

    // Mortar joints: a course line down the middle + staggered brick ends
    g.lineCap = 'butt';
    g.strokeStyle = lit ? 'rgba(22,17,13,0.72)' : 'rgba(8,6,4,0.62)';
    g.lineWidth = Math.max(0.8, size * 0.024);
    g.beginPath();

    const half = thick * 0.33;

    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      const ax = originX + s[0] * size + ox;
      const ay = originY + s[1] * size + oy;

      if (s[1] === s[3]) {
        g.moveTo(ax, ay);
        g.lineTo(ax + size, ay);

        [1 / 3, 2 / 3].forEach(t => {
          g.moveTo(ax + size * t, ay - half);
          g.lineTo(ax + size * t, ay);
        });

        [1 / 6, 0.5, 5 / 6].forEach(t => {
          g.moveTo(ax + size * t, ay);
          g.lineTo(ax + size * t, ay + half);
        });
      } else {
        g.moveTo(ax, ay);
        g.lineTo(ax, ay + size);

        [1 / 3, 2 / 3].forEach(t => {
          g.moveTo(ax - half, ay + size * t);
          g.lineTo(ax, ay + size * t);
        });

        [1 / 6, 0.5, 5 / 6].forEach(t => {
          g.moveTo(ax, ay + size * t);
          g.lineTo(ax + half, ay + size * t);
        });
      }
    }

    g.stroke();

    // Bright chiselled top edge
    g.lineCap = 'square';
    g.strokeStyle = lit ? 'rgba(255,238,210,0.5)' : 'rgba(225,205,175,0.24)';
    g.lineWidth = Math.max(1, thick * 0.11);
    strokeSegs(g, segs, vp, ox, oy - thick * 0.3);

    // Dark lower lip
    g.strokeStyle = lit ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.3)';
    g.lineWidth = Math.max(1, thick * 0.1);
    strokeSegs(g, segs, vp, 0, thick * 0.4);

    // Grit flecks
    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];

      for (let k = 0; k < 3; k += 1) {
        if (hash(i, k, 47) < 0.45) continue;

        const t = 0.1 + 0.8 * hash(i, k, 48);
        const jitter = (hash(i, k, 49) - 0.5) * thick * 0.5;
        const horiz = s[1] === s[3];
        const px = originX + (s[0] + (s[2] - s[0]) * t) * size + ox + (horiz ? 0 : jitter);
        const py = originY + (s[1] + (s[3] - s[1]) * t) * size + oy + (horiz ? jitter : 0);

        g.fillStyle = hash(i, k, 50) > 0.5
          ? (lit ? 'rgba(220,205,180,0.4)' : 'rgba(190,175,150,0.2)')
          : 'rgba(0,0,0,0.35)';

        g.beginPath();
        g.arc(px, py, Math.max(0.7, size * 0.02), 0, Math.PI * 2);
        g.fill();
      }
    }

    // Cracks and chips
    g.lineCap = 'round';
    g.strokeStyle = lit ? 'rgba(8,5,3,0.75)' : 'rgba(6,4,2,0.55)';
    g.lineWidth = Math.max(0.8, size * 0.022);

    for (let i = 0; i < segs.length; i += 1) {
      if (hash(i, 2, 71) > 0.13) continue;

      const s = segs[i];
      const horiz = s[1] === s[3];
      let t = 0.15 + 0.6 * hash(i, 3, 71);
      let px = originX + (s[0] + (s[2] - s[0]) * t) * size + ox;
      let py = originY + (s[1] + (s[3] - s[1]) * t) * size + oy;

      g.beginPath();
      g.moveTo(px, py);

      for (let k = 0; k < 3; k += 1) {
        const along = size * 0.07 * (0.5 + hash(i, k, 72));
        const across = (hash(i, k, 73) - 0.5) * thick * 0.5;

        px += horiz ? along : across;
        py += horiz ? across : along;

        g.lineTo(px, py);
      }

      g.stroke();
    }

    // Moss creeping over the stone
    for (let i = 0; i < segs.length; i += 1) {
      if (hash(i, 2, 61) > 0.17) continue;

      const s = segs[i];
      const horiz = s[1] === s[3];

      for (let k = 0; k < 5; k += 1) {
        const t = hash(i, k, 62);
        const jitter = (hash(i, k, 63) - 0.3) * thick * 0.55;
        const px = originX + (s[0] + (s[2] - s[0]) * t) * size + ox + (horiz ? 0 : jitter);
        const py = originY + (s[1] + (s[3] - s[1]) * t) * size + oy + (horiz ? jitter : 0);
        const r = size * (0.05 + hash(i, k, 64) * 0.07);

        g.fillStyle = lit ? 'rgba(74,116,46,0.62)' : 'rgba(52,84,34,0.42)';
        g.beginPath();
        g.arc(px, py, r, 0, Math.PI * 2);
        g.fill();

        g.fillStyle = lit ? 'rgba(130,175,80,0.45)' : 'rgba(90,125,55,0.22)';
        g.beginPath();
        g.arc(px - r * 0.25, py - r * 0.3, r * 0.5, 0, Math.PI * 2);
        g.fill();
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
    const dim = makeCanvas(W, H);
    const mem = makeCanvas(W, H);
    const light = makeCanvas(W, H);

    paintStatic(lit, state.maze, vp, dpr, true);
    paintStatic(dim, state.maze, vp, dpr, false);

    // Background: deep earth gradient
    const bg = makeCanvas(W, H);
    const bgc = bg.getContext('2d');
    bgc.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bgGrad = bgc.createRadialGradient(
      width / 2, height / 2, 0,
      width / 2, height / 2, Math.max(width, height) * 0.7
    );
    bgGrad.addColorStop(0, '#17110d');
    bgGrad.addColorStop(1, '#060403');
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
    vGrad.addColorStop(0, 'rgba(6,4,3,0)');
    vGrad.addColorStop(1, 'rgba(6,4,3,0.6)');
    vg.fillStyle = vGrad;
    vg.fillRect(0, 0, width, height);

    return {
      key, W, H, dpr,
      lit, dim, mem, light, bg, vig,
      lctx: light.getContext('2d'),
      mctx: mem.getContext('2d'),
      memSeen: new Uint8Array(state.maze.cols * state.maze.rows),
      seenRef: null
    };
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

    if (cache.seenRef !== seen) {
      cache.mctx.setTransform(1, 0, 0, 1, 0, 0);
      cache.mctx.clearRect(0, 0, cache.W, cache.H);
      cache.memSeen.fill(0);
      cache.seenRef = seen;
    }

    const pad = Math.max(5, vp.size * 0.28) * 0.9;
    const g = cache.mctx;

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
        g.drawImage(cache.dim, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
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

  // KEY
  function drawKey(ctx, x, y, size, hex, time) {
    const bob = Math.sin(time / 520 + x) * size * 0.035;

    const scale = size * 0.16;

    // Floor halo (stays on the ground while the key bobs)
    const halo = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(time / 420 + x));
    const floor = ctx.createRadialGradient(x, y + size * 0.16, 0, x, y + size * 0.16, size * 0.85);

    floor.addColorStop(0, hex + Math.round(halo * 255).toString(16).padStart(2, '0'));
    floor.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(x, y + size * 0.16, size * 0.85, 0, Math.PI * 2);
    ctx.fill();

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

  // FLICKERING WALL TORCHES (drawn in the lit layer, so the fog hides them
  // until your lamp reaches them). Each one throws a warm light pool.
  function drawTorches(g, state, vp, time, px, py, reach) {
    const torches = getTorches(state.maze);
    const s = vp.size;
    const thick = Math.max(5, s * 0.28);

    g.save();

    for (let n = 0; n < torches.length; n += 1) {
      const t = torches[n];
      const x = vp.originX + t.x * s - thick * 0.1;
      const y = vp.originY + t.y * s - thick * 0.14 - thick * 0.3;

      if (Math.abs(x - px) > reach || Math.abs(y - py) > reach) continue;

      const f = Math.max(
        0.35,
        0.78 + 0.2 * Math.sin(time / (80 + (t.i % 7) * 13) + t.i) + 0.1 * Math.sin(time / 31 + t.i * 2.3)
      );

      // Warm light pool on the floor
      g.globalCompositeOperation = 'lighter';

      const pr = s * (1.55 + 0.25 * f);
      const pool = g.createRadialGradient(x, y + s * 0.12, 0, x, y + s * 0.12, pr);

      pool.addColorStop(0, 'rgba(255,150,60,' + (0.26 * f).toFixed(3) + ')');
      pool.addColorStop(0.5, 'rgba(255,110,40,' + (0.09 * f).toFixed(3) + ')');
      pool.addColorStop(1, 'rgba(255,100,30,0)');

      g.fillStyle = pool;
      g.beginPath();
      g.arc(x, y + s * 0.12, pr, 0, Math.PI * 2);
      g.fill();

      g.globalCompositeOperation = 'source-over';

      // Iron bracket
      g.fillStyle = '#17120f';
      g.fillRect(x - s * 0.035, y - s * 0.005, s * 0.07, s * 0.1);

      g.fillStyle = '#2b231d';
      g.fillRect(x - s * 0.05, y + s * 0.07, s * 0.1, s * 0.03);

      // Flame
      const fh = s * 0.17 * (0.8 + 0.4 * f);
      const fw = s * 0.06 * (0.85 + 0.3 * f);
      const sway = Math.sin(time / 140 + t.i) * s * 0.012;

      g.shadowColor = 'rgba(255,140,40,1)';
      g.shadowBlur = s * 0.3;

      const flame = g.createLinearGradient(x, y - fh, x, y + s * 0.02);

      flame.addColorStop(0, '#ffdf8a');
      flame.addColorStop(0.5, '#ff9a2e');
      flame.addColorStop(1, '#c8380f');

      g.fillStyle = flame;
      g.beginPath();
      g.moveTo(x + sway, y - fh);
      g.quadraticCurveTo(x + fw * 1.4, y - fh * 0.25, x, y + s * 0.02);
      g.quadraticCurveTo(x - fw * 1.4, y - fh * 0.25, x + sway, y - fh);
      g.fill();

      g.shadowBlur = 0;

      g.fillStyle = 'rgba(255,245,200,0.9)';
      g.beginPath();
      g.moveTo(x + sway * 0.5, y - fh * 0.55);
      g.quadraticCurveTo(x + fw * 0.6, y - fh * 0.15, x, y);
      g.quadraticCurveTo(x - fw * 0.6, y - fh * 0.15, x + sway * 0.5, y - fh * 0.55);
      g.fill();
    }

    g.restore();
  }

  // DRIFTING DUST + EMBERS (drawn in the lit layer, so the fog hides them)
  function drawMotes(g, state, vp, time) {
    const { maze } = state;
    const W = maze.cols * vp.size;
    const H = maze.rows * vp.size;
    const px = vp.originX + (state.player.col + 0.5) * vp.size;
    const py = vp.originY + (state.player.row + 0.5) * vp.size;
    const reach = vp.size * 7;
    const k = vp.size / 18;

    for (let i = 0; i < 90; i += 1) {
      const sp = (5 + hash(i, 3, 11) * 9) * k;

      const x = vp.originX + ((hash(i, 1, 11) * W + time * 0.001 * sp) % W);
      const y = vp.originY + ((((hash(i, 2, 11) * H - time * 0.001 * sp * 0.6) % H) + H) % H);

      if (Math.abs(x - px) > reach || Math.abs(y - py) > reach) continue;

      const tw = 0.25 + 0.75 * Math.abs(Math.sin(time / 700 + i * 1.7));

      g.globalAlpha = 0.5 * tw;
      g.fillStyle = i % 3 === 0 ? '#ffb25c' : '#e6d5b8';

      g.beginPath();
      g.arc(x, y, Math.max(0.8, vp.size * (0.018 + hash(i, 4, 11) * 0.03)), 0, Math.PI * 2);
      g.fill();
    }

    g.globalAlpha = 1;
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

    // --------------------------------
    // BANNER SIZE
    // --------------------------------

    const w = Math.min(430, width - 24);
    const h = state.clue ? 220 : 175;

    const x = Math.max(12, width - w - 14);
    const y = 14;

    const centerX = x + w / 2;

    ctx.save();

    ctx.globalAlpha = Math.max(0, fade);

    // --------------------------------
    // SHADOW
    // --------------------------------

    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;

    // --------------------------------
    // BACKGROUND
    // --------------------------------

    ctx.fillStyle = 'rgba(8, 4, 12, 0.96)';

    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 12);
        ctx.fill();
    } else {
        ctx.fillRect(x, y, w, h);
    }

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // --------------------------------
    // BORDER
    // --------------------------------

    ctx.strokeStyle = 'rgba(255, 77, 109, 0.9)';
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

    // --------------------------------
    // WRONG KEY
    // --------------------------------

    ctx.font = '800 20px Arial, sans-serif';
    ctx.fillStyle = '#ff4d6d';

    ctx.fillText(
        '❌ WRONG KEY',
        centerX,
        y + 27
    );

    // --------------------------------
    // RETURN INSTRUCTION
    // --------------------------------

    ctx.font = '700 11px Arial, sans-serif';
    ctx.fillStyle = '#d7e4ff';

    ctx.fillText(
        'RETURN TO START — THEN TRY AGAIN',
        centerX,
        y + 49
    );

    // --------------------------------
    // SEPARATOR
    // --------------------------------

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(x + 24, y + 64);
    ctx.lineTo(x + w - 24, y + 64);
    ctx.stroke();

    // --------------------------------
    // KEY HINT
    // --------------------------------

    let currentY = y + 82;

    if (state.clue) {

        ctx.font = '800 13px Arial, sans-serif';
        ctx.fillStyle = '#ffd166';

        ctx.fillText(
            '🔎 YOUR KEY HINT',
            centerX,
            currentY
        );

        currentY += 18;

        ctx.font = '600 11px Arial, sans-serif';
        ctx.fillStyle = '#cfd8ea';

        ctx.fillText(
            'Solve this to identify your key colour.',
            centerX,
            currentY
        );

        currentY += 22;

        // --------------------------------
        // CLUE TEXT
        // --------------------------------

        ctx.font = 'italic 14px Arial, sans-serif';
        ctx.fillStyle = '#ffffff';

        const maxTextWidth = w - 50;
        const words = String(state.clue).split(/\s+/);

        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine
                ? `${currentLine} ${word}`
                : word;

            if (
                ctx.measureText(testLine).width <= maxTextWidth
            ) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                }

                currentLine = word;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        // Limit to 3 lines so the banner never overflows.
        const visibleLines = lines.slice(0, 3);

        for (const line of visibleLines) {
            ctx.fillText(
                `"${line}"`,
                centerX,
                currentY
            );

            currentY += 19;
        }
    }

    // --------------------------------
    // CONTROLS SECTION
    // --------------------------------

    const controlsSeparatorY = y + h - 66;

    // Separator above controls
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(x + 24, controlsSeparatorY);
    ctx.lineTo(x + w - 24, controlsSeparatorY);
    ctx.stroke();

    // Controls title
    ctx.font = '800 10px Arial, sans-serif';
    ctx.fillStyle = '#ffd166';

    ctx.fillText(
        '⚠ CONTROLS DISORIENTED',
        centerX,
        controlsSeparatorY + 17
    );

    // Control mappings
    ctx.font = '700 10px Arial, sans-serif';
    ctx.fillStyle = '#d7e4ff';

    ctx.fillText(
        'W → DOWN     S → UP',
        centerX,
        controlsSeparatorY + 36
    );

    ctx.fillText(
        'D → LEFT     A → RIGHT',
        centerX,
        controlsSeparatorY + 51
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
      ctx.globalAlpha = 0.42;
      ctx.drawImage(cache.dim, 0, 0, width, height);
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.globalAlpha = 0.42;
      drawKeys(ctx, state, vp, time, true);
      ctx.restore();
    } else {
      syncMemory(cache, state, vp);

      ctx.globalAlpha = CONFIG.memoryAlpha;
      ctx.drawImage(cache.mem, 0, 0, width, height);
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

      drawTorches(lg, state, vp, time, cx, cy, outer + vp.size * 2);

      drawMotes(lg, state, vp, time);

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

    // START
    if (!debug) drawStartPad(ctx, state, vp, time, false);

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