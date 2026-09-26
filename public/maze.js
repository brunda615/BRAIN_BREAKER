

(function (window) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────────────────────────────────────────────

  const CONFIG = {
    cols: 27,
    rows: 27,

    // Player movement
    playerSpeed: 8.6,
    straightBias: 0.72,
    inputBufferMs: 220,

    // Fog / visibility
    sightRadius: 3.1,
    sightFalloff: 2.4,
    memoryAlpha: 0.13,

    // Keys
    keyCount: 4,

    // Maze complexity
    // 0  = perfect maze
    // 20 = some alternate paths
    // 38 = good amount of loops
    // 50+ = increasingly open
    extraConnections: 38,

    // Time shown after hitting wrong key
    // before teleporting back to start.
    wrongKeyResetDelay: 900,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // KEY DATA
  // ─────────────────────────────────────────────────────────────────────────────

  const KEY_COLORS = [
    'RED',
    'BLUE',
    'GREEN',
    'YELLOW',
  ];

  const KEY_HEX = {
    RED: '#ff4d6d',
    BLUE: '#4fa8ff',
    GREEN: '#3df5a5',
    YELLOW: '#ffd166',
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // COLORS
  // ─────────────────────────────────────────────────────────────────────────────

  const PALETTE = {
    void: '#04060d',
    floor: '#0a1022',
    floorLit: '#111c38',

    wall: '#2f5a94',
    wallGlow: '#4fd8ff',

    player: '#7ef0ff',
    start: '#4fd8ff',
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // WALL FLAGS
  // ─────────────────────────────────────────────────────────────────────────────

  const WALL = {
    N: 1,
    E: 2,
    S: 4,
    W: 8,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // MOVEMENT VECTORS
  // ─────────────────────────────────────────────────────────────────────────────

  const VECTORS = {
    up: {
      dc: 0,
      dr: -1,
    },

    down: {
      dc: 0,
      dr: 1,
    },

    left: {
      dc: -1,
      dr: 0,
    },

    right: {
      dc: 1,
      dr: 0,
    },
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // BASIC HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  function index(maze, col, row) {
    return row * maze.cols + col;
  }

  function inBounds(maze, col, row) {
    return (
      col >= 0 &&
      row >= 0 &&
      col < maze.cols &&
      row < maze.rows
    );
  }

  function sameCell(a, b) {
    return (
      a &&
      b &&
      a.col === b.col &&
      a.row === b.row
    );
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

  // ─────────────────────────────────────────────────────────────────────────────
  // MOVEMENT / COLLISION
  // ─────────────────────────────────────────────────────────────────────────────

  function canMove(maze, col, row, dc, dr) {
    const nextCol = col + dc;
    const nextRow = row + dr;

    if (!inBounds(maze, nextCol, nextRow)) {
      return false;
    }

    const currentMask =
      maze.walls[index(maze, col, row)];

    if (dr === -1) {
      return (currentMask & WALL.N) === 0;
    }

    if (dr === 1) {
      return (currentMask & WALL.S) === 0;
    }

    if (dc === -1) {
      return (currentMask & WALL.W) === 0;
    }

    if (dc === 1) {
      return (currentMask & WALL.E) === 0;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // WALL COUNT
  // ─────────────────────────────────────────────────────────────────────────────

  function countWalls(mask) {
    let count = 0;

    if (mask & WALL.N) count += 1;
    if (mask & WALL.E) count += 1;
    if (mask & WALL.S) count += 1;
    if (mask & WALL.W) count += 1;

    return count;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DEAD END DETECTION
  // ─────────────────────────────────────────────────────────────────────────────

  function findDeadEnds(maze) {
    const out = [];

    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        const cellIndex = index(maze, col, row);
        const mask = maze.walls[cellIndex];

        if (countWalls(mask) === 3) {
          out.push({
            col,
            row,
          });
        }
      }
    }

    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAZE GENERATION
  // ─────────────────────────────────────────────────────────────────────────────
  //
  // First creates a connected DFS maze.
  // Then removes additional walls to create loops / alternate routes.
  //
  // The maze itself NEVER changes after generation.
  // Wrong keys only reshuffle the key locations.
  // ─────────────────────────────────────────────────────────────────────────────

  function generateMaze(
    cols = CONFIG.cols,
    rows = CONFIG.rows
  ) {
    const walls = new Uint8Array(
      cols * rows
    ).fill(
      WALL.N |
      WALL.E |
      WALL.S |
      WALL.W
    );

    const visited = new Uint8Array(
      cols * rows
    );

    const start = {
      col: 0,
      row: rows - 1,
    };

    const startIndex =
      start.row * cols + start.col;

    visited[startIndex] = 1;

    const stack = [start];

    const steps = [
      {
        dc: 0,
        dr: -1,
        here: WALL.N,
        there: WALL.S,
      },

      {
        dc: 1,
        dr: 0,
        here: WALL.E,
        there: WALL.W,
      },

      {
        dc: 0,
        dr: 1,
        here: WALL.S,
        there: WALL.N,
      },

      {
        dc: -1,
        dr: 0,
        here: WALL.W,
        there: WALL.E,
      },
    ];

    // ─────────────────────────────────────────────
    // DFS MAZE
    // ─────────────────────────────────────────────

    while (stack.length > 0) {
      const current =
        stack[stack.length - 1];

      const options = shuffle(
        steps
      ).filter(({ dc, dr }) => {
        const nextCol =
          current.col + dc;

        const nextRow =
          current.row + dr;

        if (
          nextCol < 0 ||
          nextRow < 0 ||
          nextCol >= cols ||
          nextRow >= rows
        ) {
          return false;
        }

        const nextIndex =
          nextRow * cols + nextCol;

        return !visited[nextIndex];
      });

      if (options.length === 0) {
        stack.pop();
        continue;
      }

      const move = options[0];

      const next = {
        col: current.col + move.dc,
        row: current.row + move.dr,
      };

      const currentIndex =
        current.row * cols +
        current.col;

      const nextIndex =
        next.row * cols +
        next.col;

      // Remove wall between cells.
      walls[currentIndex] &=
        ~move.here;

      walls[nextIndex] &=
        ~move.there;

      visited[nextIndex] = 1;

      stack.push(next);
    }

    const maze = {
      cols,
      rows,
      walls,
      start,
      deadEnds: [],
    };

    // Add loops / alternate paths.
    addExtraConnections(
      maze,
      CONFIG.extraConnections
    );

    maze.deadEnds =
      findDeadEnds(maze);

    return maze;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ADD EXTRA CONNECTIONS
  // ─────────────────────────────────────────────────────────────────────────────
  //
  // Removes walls between already connected cells.
  // This creates multiple possible routes.
  // ─────────────────────────────────────────────────────────────────────────────

  function addExtraConnections(
    maze,
    count = CONFIG.extraConnections
  ) {
    const candidates = [];

    // Only inspect internal cells.
    for (
      let row = 1;
      row < maze.rows - 1;
      row += 1
    ) {
      for (
        let col = 1;
        col < maze.cols - 1;
        col += 1
      ) {
        const currentIndex =
          index(maze, col, row);

        const mask =
          maze.walls[currentIndex];

        // East connection candidate
        if (mask & WALL.E) {
          candidates.push({
            col,
            row,

            dc: 1,
            dr: 0,

            here: WALL.E,
            there: WALL.W,
          });
        }

        // South connection candidate
        if (mask & WALL.S) {
          candidates.push({
            col,
            row,

            dc: 0,
            dr: 1,

            here: WALL.S,
            there: WALL.N,
          });
        }
      }
    }

    const shuffled =
      shuffle(candidates);

    let added = 0;

    for (
      const connection of shuffled
    ) {
      if (added >= count) {
        break;
      }

      const {
        col,
        row,
        dc,
        dr,
        here,
        there,
      } = connection;

      const nextCol =
        col + dc;

      const nextRow =
        row + dr;

      if (
        !inBounds(
          maze,
          nextCol,
          nextRow
        )
      ) {
        continue;
      }

      const currentIndex =
        index(
          maze,
          col,
          row
        );

      const nextIndex =
        index(
          maze,
          nextCol,
          nextRow
        );

      const currentMask =
        maze.walls[currentIndex];

      // Wall has already been removed
      // by another connection.
      if (!(currentMask & here)) {
        continue;
      }

      maze.walls[currentIndex] &=
        ~here;

      maze.walls[nextIndex] &=
        ~there;

      added += 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DISTANCE FIELD
  // ─────────────────────────────────────────────────────────────────────────────

  function distanceField(
    maze,
    from
  ) {
    const total =
      maze.cols * maze.rows;

    const dist =
      new Int32Array(total);

    dist.fill(-1);

    const queue = [from];

    dist[
      index(
        maze,
        from.col,
        from.row
      )
    ] = 0;

    const steps = [
      {
        dc: 0,
        dr: -1,
      },

      {
        dc: 1,
        dr: 0,
      },

      {
        dc: 0,
        dr: 1,
      },

      {
        dc: -1,
        dr: 0,
      },
    ];

    for (
      let head = 0;
      head < queue.length;
      head += 1
    ) {
      const cell =
        queue[head];

      const base =
        dist[
          index(
            maze,
            cell.col,
            cell.row
          )
        ];

      for (
        const { dc, dr } of steps
      ) {
        if (
          !canMove(
            maze,
            cell.col,
            cell.row,
            dc,
            dr
          )
        ) {
          continue;
        }

        const next = {
          col: cell.col + dc,
          row: cell.row + dr,
        };

        const nextIndex =
          index(
            maze,
            next.col,
            next.row
          );

        if (
          dist[nextIndex] !== -1
        ) {
          continue;
        }

        dist[nextIndex] =
          base + 1;

        queue.push(next);
      }
    }

    return dist;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KEY PLACEMENT
  // ─────────────────────────────────────────────────────────────────────────────
  //
  // Keys are NOT restricted to dead ends because loops reduce dead-end count.
  // Instead:
  // - Must be reasonably far from start.
  // - Must be spread apart.
  // ─────────────────────────────────────────────────────────────────────────────

  function placeKeys(
  maze,
  assignedColor = null,
  existingCorrectKey = null
) {
  const dist =
    distanceField(
      maze,
      maze.start
    );

  const candidates = [];

  for (
    let row = 0;
    row < maze.rows;
    row += 1
  ) {
    for (
      let col = 0;
      col < maze.cols;
      col += 1
    ) {
      const distance =
        dist[
          index(
            maze,
            col,
            row
          )
        ];

      // Don't place keys too close to start.
      if (distance > 8) {
        candidates.push({
          col,
          row,
          distance,
        });
      }
    }
  }

  const shuffledCandidates =
    shuffle(candidates);

  const chosen = [];

  // Spread keys apart.
  for (
    const cell of shuffledCandidates
  ) {
    if (
      chosen.length >=
      CONFIG.keyCount
    ) {
      break;
    }

    const farEnough =
      chosen.every(
        (other) =>
          Math.abs(
            other.col -
            cell.col
          ) +
          Math.abs(
            other.row -
            cell.row
          ) >= 7
      );

    if (farEnough) {
      chosen.push(cell);
    }
  }

  // Fallback if we couldn't
  // find enough well-spaced cells.
  for (
    const cell of shuffledCandidates
  ) {
    if (
      chosen.length >=
      CONFIG.keyCount
    ) {
      break;
    }

    const alreadyChosen =
      chosen.some(
        (existing) =>
          existing.col ===
            cell.col &&
          existing.row ===
            cell.row
      );

    if (!alreadyChosen) {
      chosen.push(cell);
    }
  }

  // ─────────────────────────────────────────
  // DETERMINE CORRECT COLOR
  // ─────────────────────────────────────────

  let correctKey;

  if (
    existingCorrectKey &&
    KEY_COLORS.includes(
      existingCorrectKey
    )
  ) {
    // Keep the existing correct color.
    correctKey =
      existingCorrectKey;
  } else if (
    assignedColor &&
    KEY_COLORS.includes(
      String(
        assignedColor
      ).toUpperCase()
    )
  ) {
    // Use externally assigned color.
    correctKey =
      String(
        assignedColor
      ).toUpperCase();
  } else {
    // First game only:
    // choose a random correct color.
    correctKey =
      KEY_COLORS[
        Math.floor(
          Math.random() *
          KEY_COLORS.length
        )
      ];
  }

  // ─────────────────────────────────────────
  // CREATE KEY POSITIONS
  // ─────────────────────────────────────────
  //
  // Colors remain fixed.
  // Positions are randomized.
  //

  const colors =
    shuffle(
      KEY_COLORS
    );

  const keys =
    chosen.map(
      (cell, i) => ({
        id: `key-${i}`,

        color:
          colors[i],

        cell: {
          col: cell.col,
          row: cell.row,
        },

        collected: false,
      })
    );

  return {
    keys,
    correctKey,
  };
}

  // ─────────────────────────────────────────────────────────────────────────────
  // GAME ENGINE
  // ─────────────────────────────────────────────────────────────────────────────

  class GameEngine {
    constructor(
      initialElapsedMs = 0,
      initialRound = 0,
      assignedColor = null
    ) {
      this.assignedColor =
        assignedColor
          ? String(
              assignedColor
            ).toUpperCase()
          : null;

      this.held = [];

      this.onStateChange =
        null;

      this.onSuccess =
        null;

      this.state =
        this.buildState(
          initialRound,
          initialElapsedMs
        );
    }

    // ───────────────────────────────────────────
    // BUILD STATE
    // ───────────────────────────────────────────

    buildState(
      round,
      elapsedMs
    ) {
      const maze =
        generateMaze();

      const {
        keys,
        correctKey,
      } =
        placeKeys(
          maze,
          this.assignedColor
        );

      return {
        status: 'READY',

        maze,

        keys,

        correctKey,

        round,

        elapsedMs,

        debug: false,

        seen:
          new Uint8Array(
            maze.cols *
            maze.rows
          ),

        wrongKey: null,

        player: {
          col:
            maze.start.col,

          row:
            maze.start.row,

          from: {
            ...maze.start,
          },

          to: {
            ...maze.start,
          },

          t: 0,

          facing: 'right',

          moving: false,
        },
      };
    }

    // ───────────────────────────────────────────
    // START GAME
    // ───────────────────────────────────────────

    start() {
      if (
        this.state.status !==
        'READY'
      ) {
        return;
      }

      this.state.status =
        'PLAYING';

      this.revealAroundPlayer();

      this.notify();
    }

    // ───────────────────────────────────────────
    // RESET AFTER WRONG KEY
    // ───────────────────────────────────────────
    //
    // IMPORTANT:
    // The maze itself is NOT regenerated.
    //
    // Only:
    // - Player goes to start.
    // - Keys are regenerated.
    // - Correct key is regenerated.
    // - Fog is cleared.
    //
    // This means the player can learn
    // the maze over repeated attempts.
    // ───────────────────────────────────────────

    resetAfterWrongKey() {
      const {
        maze,
      } = this.state;

      const {
        keys,
        correctKey,
      } =
        placeKeys(
          maze,
          this.assignedColor
        );

      // Teleport player to start.
      this.state.player = {
        col:
          maze.start.col,

        row:
          maze.start.row,

        from: {
          ...maze.start,
        },

        to: {
          ...maze.start,
        },

        t: 0,

        facing: 'right',

        moving: false,
      };

      // New key layout.
      this.state.keys =
        keys;

      this.state.correctKey =
        correctKey;

      // Clear explored fog memory.
      this.state.seen.fill(0);

      this.state.wrongKey =
        null;

      this.state.status =
        'PLAYING';

      // Clear keyboard input.
      this.held = [];

      // Reveal starting area.
      this.revealAroundPlayer();

      this.notify();
    }

    // ───────────────────────────────────────────
    // ASSIGN CORRECT COLOR
    // ───────────────────────────────────────────

    setAssignedColor(color) {
      if (!color) {
        return;
      }

      const normalized =
        String(
          color
        ).toUpperCase();

      if (
        !KEY_COLORS.includes(
          normalized
        )
      ) {
        return;
      }

      this.assignedColor =
        normalized;

      if (this.state) {
        this.state.correctKey =
          normalized;

        this.notify();
      }
    }

    // ───────────────────────────────────────────
    // DEBUG
    // ───────────────────────────────────────────

    toggleDebug() {
      this.state.debug =
        !this.state.debug;

      this.notify();
    }

    // ───────────────────────────────────────────
    // INPUT
    // ───────────────────────────────────────────

    press(dir) {
      if (
        !this.held.includes(dir)
      ) {
        this.held.push(dir);
      }
    }

    release(dir) {
      this.held =
        this.held.filter(
          (d) => d !== dir
        );
    }

    releaseAll() {
      this.held = [];
    }

    // ───────────────────────────────────────────
    // UPDATE
    // ───────────────────────────────────────────

    update(dtMs) {
      // Only move during PLAYING.
      if (
        this.state.status !==
        'PLAYING'
      ) {
        return;
      }

      this.state.elapsedMs +=
        dtMs;

      const dt =
        dtMs / 1000;

      let budget =
        CONFIG.playerSpeed *
        dt;

      while (
        budget > 0
      ) {
        const {
          player,
        } = this.state;

        if (
          !player.moving &&
          !this.chooseNextCell()
        ) {
          break;
        }

        const dx =
          player.to.col -
          player.from.col;

        const dy =
          player.to.row -
          player.from.row;

        const distance =
          Math.abs(dx) +
          Math.abs(dy);

        if (
          distance === 0
        ) {
          player.moving =
            false;

          player.t = 0;

          break;
        }

        const remaining =
          distance *
          (1 - player.t);

        // Finished moving to next cell.
        if (
          remaining <=
          budget
        ) {
          player.t = 1;

          player.col =
            player.to.col;

          player.row =
            player.to.row;

          player.from = {
            ...player.to,
          };

          player.t = 0;

          player.moving =
            false;

          budget -=
            remaining;

          this.revealAroundPlayer();

          this.handleCellArrival();

          // Wrong/correct key may have
          // changed the game state.
          if (
            this.state.status !==
            'PLAYING'
          ) {
            break;
          }
        }

        // Still moving.
        else {
          player.t +=
            budget /
            distance;

          player.col =
            player.from.col +
            (
              player.to.col -
              player.from.col
            ) *
              player.t;

          player.row =
            player.from.row +
            (
              player.to.row -
              player.from.row
            ) *
              player.t;

          budget = 0;

          this.revealAroundPlayer();
        }
      }
    }

    // ───────────────────────────────────────────
    // CHOOSE NEXT CELL
    // ───────────────────────────────────────────

    chooseNextCell() {
      if (
        this.state.status !==
        'PLAYING'
      ) {
        return false;
      }

      return this.chooseNormalCell();
    }

    // ───────────────────────────────────────────
    // NORMAL MOVEMENT
    // ───────────────────────────────────────────

    chooseNormalCell() {
      const {
        player,
        maze,
      } = this.state;

      const col =
        Math.round(
          player.col
        );

      const row =
        Math.round(
          player.row
        );

      // Most recently pressed
      // direction gets priority.
      for (
        let i =
          this.held.length - 1;
        i >= 0;
        i -= 1
      ) {
        const dir =
          this.held[i];

        const vector =
          VECTORS[dir];

        if (!vector) {
          continue;
        }

        const {
          dc,
          dr,
        } = vector;

        player.facing =
          dir;

        if (
          !canMove(
            maze,
            col,
            row,
            dc,
            dr
          )
        ) {
          continue;
        }

        player.from = {
          col,
          row,
        };

        player.to = {
          col:
            col + dc,

          row:
            row + dr,
        };

        player.t = 0;

        player.moving =
          true;

        return true;
      }

      return false;
    }

    // ───────────────────────────────────────────
    // CELL ARRIVAL
    // ───────────────────────────────────────────

    handleCellArrival() {
      const {
        status,
        player,
      } = this.state;

      if (
        status !==
        'PLAYING'
      ) {
        return;
      }

      const currentCell = {
        col:
          Math.round(
            player.col
          ),

        row:
          Math.round(
            player.row
          ),
      };

      const key =
        this.state.keys.find(
          (candidate) =>
            !candidate.collected &&
            sameCell(
              candidate.cell,
              currentCell
            )
        );

      if (!key) {
        return;
      }

      key.collected =
        true;

      // ─────────────────────────────────────────
      // CORRECT KEY
      // ─────────────────────────────────────────

      if (
        key.color ===
        this.state.correctKey
      ) {
        this.state.status =
          'SUCCESS';

        this.held = [];

        this.notify();

        if (
          this.onSuccess
        ) {
          this.onSuccess(
            this.state.elapsedMs,
            this.state.round
          );
        }

        return;
      }

      // ─────────────────────────────────────────
      // WRONG KEY
      // ─────────────────────────────────────────

      this.state.wrongKey =
        key.color;

      this.state.status =
        'WRONG_KEY';

      this.held = [];

      this.notify();

      // Do not refresh the page.
      // Do not regenerate the maze.
      // Simply reset the player after
      // a short feedback period.

      setTimeout(() => {
        if (
          this.state.status !==
          'WRONG_KEY'
        ) {
          return;
        }

        this.resetAfterWrongKey();
      }, CONFIG.wrongKeyResetDelay);
    }

    // ───────────────────────────────────────────
    // FOG OF WAR
    // ───────────────────────────────────────────

    revealAroundPlayer() {
      const {
        maze,
        seen,
        player,
      } = this.state;

      const radius =
        CONFIG.sightRadius +
        CONFIG.sightFalloff *
          0.5;

      const minCol =
        Math.max(
          0,
          Math.floor(
            player.col -
              radius
          )
        );

      const maxCol =
        Math.min(
          maze.cols - 1,
          Math.ceil(
            player.col +
              radius
          )
        );

      const minRow =
        Math.max(
          0,
          Math.floor(
            player.row -
              radius
          )
        );

      const maxRow =
        Math.min(
          maze.rows - 1,
          Math.ceil(
            player.row +
              radius
          )
        );

      for (
        let row = minRow;
        row <= maxRow;
        row += 1
      ) {
        for (
          let col = minCol;
          col <= maxCol;
          col += 1
        ) {
          const dx =
            col -
            player.col;

          const dy =
            row -
            player.row;

          if (
            dx * dx +
              dy * dy <=
            radius * radius
          ) {
            seen[
              index(
                maze,
                col,
                row
              )
            ] = 1;
          }
        }
      }
    }

    // ───────────────────────────────────────────
    // STATE NOTIFICATION
    // ───────────────────────────────────────────

    notify() {
      if (
        this.onStateChange
      ) {
        this.onStateChange(
          this.getSnapshot()
        );
      }
    }

    // ───────────────────────────────────────────
    // PUBLIC SNAPSHOT
    // ───────────────────────────────────────────

    getSnapshot() {
      return {
        status:
          this.state.status,

        elapsedMs:
          this.state.elapsedMs,

        debug:
          this.state.debug,

        round:
          this.state.round,

        correctKey:
          this.state.correctKey,

        wrongKey:
          this.state.wrongKey,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEWPORT
  // ─────────────────────────────────────────────────────────────────────────────

  function computeViewport(
    maze,
    width,
    height
  ) {
    const pad =
      Math.min(
        width,
        height
      ) * 0.012;

    const size =
      Math.min(
        (
          width -
          pad * 2
        ) / maze.cols,

        (
          height -
          pad * 2
        ) / maze.rows
      );

    return {
      size,

      originX:
        (
          width -
          size *
            maze.cols
        ) / 2,

      originY:
        (
          height -
          size *
            maze.rows
        ) / 2,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DRAW FLOORS
  // ─────────────────────────────────────────────────────────────────────────────

  function drawFloors(
    ctx,
    state,
    vp,
    lit,
    all
  ) {
    const {
      maze,
      seen,
    } = state;

    ctx.fillStyle =
      lit
        ? PALETTE.floorLit
        : PALETTE.floor;

    for (
      let row = 0;
      row < maze.rows;
      row += 1
    ) {
      for (
        let col = 0;
        col < maze.cols;
        col += 1
      ) {
        const cellIndex =
          row *
            maze.cols +
          col;

        if (
          !all &&
          !seen[cellIndex]
        ) {
          continue;
        }

        ctx.fillRect(
          vp.originX +
            col *
              vp.size +
            1,

          vp.originY +
            row *
              vp.size +
            1,

          vp.size - 2,

          vp.size - 2
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DRAW WALLS
  // ─────────────────────────────────────────────────────────────────────────────

  function drawWalls(
    ctx,
    state,
    vp,
    lit,
    all
  ) {
    const {
      maze,
      seen,
    } = state;

    const {
      size,
      originX,
      originY,
    } = vp;

    ctx.lineWidth =
      Math.max(
        1.5,
        size * 0.1
      );

    ctx.lineCap =
      'round';

    ctx.strokeStyle =
      lit
        ? PALETTE.wallGlow
        : PALETTE.wall;

    if (lit) {
      ctx.shadowColor =
        PALETTE.wallGlow;

      ctx.shadowBlur =
        size * 0.45;
    }

    ctx.beginPath();

    for (
      let row = 0;
      row < maze.rows;
      row += 1
    ) {
      for (
        let col = 0;
        col < maze.cols;
        col += 1
      ) {
        const cellIndex =
          row *
            maze.cols +
          col;

        if (
          !all &&
          !seen[cellIndex]
        ) {
          continue;
        }

        const mask =
          maze.walls[
            cellIndex
          ];

        const x =
          originX +
          col * size;

        const y =
          originY +
          row * size;

        // North wall
        if (
          mask & WALL.N
        ) {
          ctx.moveTo(
            x,
            y
          );

          ctx.lineTo(
            x + size,
            y
          );
        }

        // West wall
        if (
          mask & WALL.W
        ) {
          ctx.moveTo(
            x,
            y
          );

          ctx.lineTo(
            x,
            y + size
          );
        }

        // Bottom border
        if (
          row ===
            maze.rows - 1 &&
          mask & WALL.S
        ) {
          ctx.moveTo(
            x,
            y + size
          );

          ctx.lineTo(
            x + size,
            y + size
          );
        }

        // Right border
        if (
          col ===
            maze.cols - 1 &&
          mask & WALL.E
        ) {
          ctx.moveTo(
            x + size,
            y
          );

          ctx.lineTo(
            x + size,
            y + size
          );
        }

        // Internal EAST walls.
        if (
          col <
            maze.cols - 1 &&
          mask & WALL.E
        ) {
          ctx.moveTo(
            x + size,
            y
          );

          ctx.lineTo(
            x + size,
            y + size
          );
        }

        // Internal SOUTH walls.
        if (
          row <
            maze.rows - 1 &&
          mask & WALL.S
        ) {
          ctx.moveTo(
            x,
            y + size
          );

          ctx.lineTo(
            x + size,
            y + size
          );
        }
      }
    }

    ctx.stroke();

    ctx.shadowBlur = 0;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // START PAD
  // ─────────────────────────────────────────────────────────────────────────────

  function drawStartPad(
    ctx,
    state,
    vp,
    time,
    lit
  ) {
    const {
      start,
    } = state.maze;

    const cx =
      vp.originX +
      (
        start.col +
        0.5
      ) *
        vp.size;

    const cy =
      vp.originY +
      (
        start.row +
        0.5
      ) *
        vp.size;

    const pulse =
      0.5 +
      0.5 *
        Math.sin(
          time / 700
        );

    ctx.save();

    ctx.globalAlpha =
      lit
        ? 0.55 +
          pulse * 0.35
        : 0.5;

    ctx.strokeStyle =
      PALETTE.start;

    ctx.lineWidth =
      Math.max(
        1,
        vp.size * 0.06
      );

    ctx.setLineDash([
      vp.size * 0.16,
      vp.size * 0.12,
    ]);

    ctx.beginPath();

    ctx.arc(
      cx,
      cy,
      vp.size *
        (
          0.3 +
          pulse * 0.04
        ),
      0,
      Math.PI * 2
    );

    ctx.stroke();

    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DRAW KEY
  // ─────────────────────────────────────────────────────────────────────────────

  function drawKey(
    ctx,
    x,
    y,
    size,
    hex,
    time
  ) {
    const bob =
      Math.sin(
        time / 520 + x
      ) *
      size *
      0.04;

    const r =
      size * 0.15;

    ctx.save();

    ctx.translate(
      x,
      y + bob
    );

    ctx.shadowColor =
      hex;

    ctx.shadowBlur =
      size * 0.7;

    ctx.strokeStyle =
      hex;

    ctx.fillStyle =
      hex;

    ctx.lineWidth =
      Math.max(
        1.2,
        size * 0.07
      );

    ctx.lineCap =
      'round';

    // Key bow
    ctx.beginPath();

    ctx.arc(
      0,
      -r * 0.6,
      r,
      0,
      Math.PI * 2
    );

    ctx.stroke();

    // Shaft
    ctx.beginPath();

    ctx.moveTo(
      0,
      r * 0.4
    );

    ctx.lineTo(
      0,
      r * 2.1
    );

    ctx.stroke();

    // Teeth
    ctx.beginPath();

    ctx.moveTo(
      0,
      r * 1.35
    );

    ctx.lineTo(
      r * 0.75,
      r * 1.35
    );

    ctx.moveTo(
      0,
      r * 2.0
    );

    ctx.lineTo(
      r * 0.55,
      r * 2.0
    );

    ctx.stroke();

    // Core
    ctx.beginPath();

    ctx.arc(
      0,
      -r * 0.6,
      r * 0.34,
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DRAW ALL KEYS
  // ─────────────────────────────────────────────────────────────────────────────

  function drawKeys(
    ctx,
    state,
    vp,
    time,
    all
  ) {
    for (
      const token of state.keys
    ) {
      if (
        token.collected
      ) {
        continue;
      }

      const tokenIndex =
        token.cell.row *
          state.maze.cols +
        token.cell.col;

      if (
        !all &&
        !state.seen[tokenIndex]
      ) {
        continue;
      }

      drawKey(
        ctx,

        vp.originX +
          (
            token.cell.col +
            0.5
          ) *
            vp.size,

        vp.originY +
          (
            token.cell.row +
            0.5
          ) *
            vp.size,

        vp.size,

        KEY_HEX[
          token.color
        ],

        time
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DRAW PLAYER
  // ─────────────────────────────────────────────────────────────────────────────

  function drawPlayer(
    ctx,
    state,
    vp,
    time
  ) {
    const {
      player,
    } = state;

    const cx =
      vp.originX +
      (
        player.col +
        0.5
      ) *
        vp.size;

    const cy =
      vp.originY +
      (
        player.row +
        0.5
      ) *
        vp.size;

    const pulse =
      0.5 +
      0.5 *
        Math.sin(
          time / 420
        );

    const r =
      vp.size * 0.24;

    // Player halo
    const halo =
      ctx.createRadialGradient(
        cx,
        cy,
        r * 0.2,
        cx,
        cy,
        r * 4.5
      );

    halo.addColorStop(
      0,
      'rgba(126,240,255,0.5)'
    );

    halo.addColorStop(
      1,
      'rgba(126,240,255,0)'
    );

    ctx.fillStyle =
      halo;

    ctx.fillRect(
      cx - r * 5,
      cy - r * 5,
      r * 10,
      r * 10
    );

    ctx.save();

    ctx.shadowColor =
      PALETTE.player;

    ctx.shadowBlur =
      vp.size * 0.9;

    ctx.strokeStyle =
      'rgba(126,240,255,0.85)';

    ctx.lineWidth =
      Math.max(
        1,
        vp.size * 0.05
      );

    // Outer ring
    ctx.beginPath();

    ctx.arc(
      cx,
      cy,
      r *
        (
          1.35 +
          pulse * 0.12
        ),
      0,
      Math.PI * 2
    );

    ctx.stroke();

    // Core
    ctx.fillStyle =
      '#eafcff';

    ctx.beginPath();

    ctx.arc(
      cx,
      cy,
      r * 0.62,
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER SCENE
  // ─────────────────────────────────────────────────────────────────────────────

  function renderScene(
    ctx,
    lightCtx,
    state,
    width,
    height,
    time
  ) {
    const vp =
      computeViewport(
        state.maze,
        width,
        height
      );

    const {
      player,
      debug,
    } = state;

    // ───────────────────────────────────────────
    // BACKGROUND
    // ───────────────────────────────────────────

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    ctx.fillStyle =
      PALETTE.void;

    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    // ───────────────────────────────────────────
    // MEMORY PASS
    // ───────────────────────────────────────────

    ctx.save();

    ctx.globalAlpha =
      debug
        ? 0.42
        : CONFIG.memoryAlpha;

    drawFloors(
      ctx,
      state,
      vp,
      false,
      debug
    );

    drawWalls(
      ctx,
      state,
      vp,
      false,
      debug
    );

    if (debug) {
      drawKeys(
        ctx,
        state,
        vp,
        time,
        true
      );
    }

    ctx.restore();

    // ───────────────────────────────────────────
    // LIGHT PASS
    // ───────────────────────────────────────────

    lightCtx.clearRect(
      0,
      0,
      width,
      height
    );

    drawFloors(
      lightCtx,
      state,
      vp,
      true,
      true
    );

    drawWalls(
      lightCtx,
      state,
      vp,
      true,
      true
    );

    drawStartPad(
      lightCtx,
      state,
      vp,
      time,
      true
    );

    drawKeys(
      lightCtx,
      state,
      vp,
      time,
      true
    );

    // ───────────────────────────────────────────
    // FOG MASK
    // ───────────────────────────────────────────

    const cx =
      vp.originX +
      (
        player.col +
        0.5
      ) *
        vp.size;

    const cy =
      vp.originY +
      (
        player.row +
        0.5
      ) *
        vp.size;

    const inner =
      CONFIG.sightRadius *
      vp.size;

    const outer =
      (
        CONFIG.sightRadius +
        CONFIG.sightFalloff
      ) *
        vp.size;

    const mask =
      lightCtx.createRadialGradient(
        cx,
        cy,
        inner * 0.2,
        cx,
        cy,
        outer
      );

    mask.addColorStop(
      0,
      'rgba(255,255,255,1)'
    );

    mask.addColorStop(
      0.55,
      'rgba(255,255,255,0.92)'
    );

    mask.addColorStop(
      0.8,
      'rgba(255,255,255,0.35)'
    );

    mask.addColorStop(
      1,
      'rgba(255,255,255,0)'
    );

    lightCtx.globalCompositeOperation =
      'destination-in';

    lightCtx.fillStyle =
      mask;

    lightCtx.fillRect(
      0,
      0,
      width,
      height
    );

    lightCtx.globalCompositeOperation =
      'source-over';

    // ───────────────────────────────────────────
    // COMPOSITE LIGHT PASS
    // ───────────────────────────────────────────

    ctx.drawImage(
      lightCtx.canvas,
      0,
      0,
      width,
      height
    );

    // Start remains slightly visible.
    if (!debug) {
      drawStartPad(
        ctx,
        state,
        vp,
        time,
        false
      );
    }

    // ───────────────────────────────────────────
    // PLAYER
    // ───────────────────────────────────────────

    drawPlayer(
      ctx,
      state,
      vp,
      time
    );

    // ───────────────────────────────────────────
    // VIGNETTE
    // ───────────────────────────────────────────

    const vignette =
      ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(
          width,
          height
        ) * 0.25,

        width / 2,
        height / 2,
        Math.max(
          width,
          height
        ) * 0.75
      );

    vignette.addColorStop(
      0,
      'rgba(4,6,13,0)'
    );

    vignette.addColorStop(
      1,
      'rgba(4,6,13,0.85)'
    );

    ctx.fillStyle =
      vignette;

    ctx.fillRect(
      0,
      0,
      width,
      height
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GLOBAL EXPORT
  // ─────────────────────────────────────────────────────────────────────────────

  window.BrainBreakerMaze = {
    CONFIG,
    KEY_COLORS,
    KEY_HEX,
    PALETTE,
    GameEngine,
    renderScene,
  };

})(window);
