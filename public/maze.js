/**
 * BRAIN BREAKER — Stage 02: Fog Maze Game Engine & Renderer
 * Pure Vanilla JavaScript & HTML5 Canvas (No frameworks)
 * Ported from Stage 2 TypeScript/React engine
 */

(function (window) {
  'use strict';

  const CONFIG = {
    cols: 27,
    rows: 17,
    playerSpeed: 8.6, // Cells per second
    straightBias: 0.72,
    inputBufferMs: 220,
    sightRadius: 3.1, // Fully lit cells
    sightFalloff: 2.4, // Falloff to black
    memoryAlpha: 0.13, // Faint memory alpha
    keyCount: 4,
  };

  const KEY_COLORS = ['RED', 'BLUE', 'GREEN', 'YELLOW'];

  const KEY_HEX = {
    RED: '#ff4d6d',
    BLUE: '#4fa8ff',
    GREEN: '#3df5a5',
    YELLOW: '#ffd166',
  };

  const PALETTE = {
    void: '#04060d',
    floor: '#0a1022',
    floorLit: '#111c38',
    wall: '#2f5a94',
    wallGlow: '#4fd8ff',
    player: '#7ef0ff',
    start: '#4fd8ff',
  };

  const WALL = {
    N: 1,
    E: 2,
    S: 4,
    W: 8,
  };

  const VECTORS = {
    up: { dc: 0, dr: -1 },
    down: { dc: 0, dr: 1 },
    left: { dc: -1, dr: 0 },
    right: { dc: 1, dr: 0 },
  };

  function index(maze, col, row) {
    return row * maze.cols + col;
  }

  function inBounds(maze, col, row) {
    return col >= 0 && row >= 0 && col < maze.cols && row < maze.rows;
  }

  function canMove(maze, col, row, dc, dr) {
    if (!inBounds(maze, col + dc, row + dr)) return false;
    const mask = maze.walls[index(maze, col, row)];
    if (dr === -1) return (mask & WALL.N) === 0;
    if (dr === 1) return (mask & WALL.S) === 0;
    if (dc === -1) return (mask & WALL.W) === 0;
    if (dc === 1) return (mask & WALL.E) === 0;
    return false;
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

  function countWalls(mask) {
    let n = 0;
    for (const bit of [WALL.N, WALL.E, WALL.S, WALL.W]) {
      if (mask & bit) n += 1;
    }
    return n;
  }

  function findDeadEnds(maze) {
    const out = [];
    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        if (countWalls(maze.walls[index(maze, col, row)]) === 3) {
          out.push({ col, row });
        }
      }
    }
    return out;
  }

  function generateMaze(cols = CONFIG.cols, rows = CONFIG.rows) {
    const walls = new Uint8Array(cols * rows).fill(WALL.N | WALL.E | WALL.S | WALL.W);
    const visited = new Uint8Array(cols * rows);
    const start = { col: 0, row: rows - 1 };

    const stack = [start];
    visited[start.row * cols + start.col] = 1;

    const steps = [
      { dc: 0, dr: -1, here: WALL.N, there: WALL.S },
      { dc: 1, dr: 0, here: WALL.E, there: WALL.W },
      { dc: 0, dr: 1, here: WALL.S, there: WALL.N },
      { dc: -1, dr: 0, here: WALL.W, there: WALL.E },
    ];

    while (stack.length) {
      const current = stack[stack.length - 1];
      const options = shuffle(steps).filter(({ dc, dr }) => {
        const c = current.col + dc;
        const r = current.row + dr;
        return c >= 0 && r >= 0 && c < cols && r < rows && !visited[r * cols + c];
      });

      if (!options.length) {
        stack.pop();
        continue;
      }

      const move = options[0];
      const next = { col: current.col + move.dc, row: current.row + move.dr };
      walls[current.row * cols + current.col] &= ~move.here;
      walls[next.row * cols + next.col] &= ~move.there;
      visited[next.row * cols + next.col] = 1;
      stack.push(next);
    }

    const maze = { cols, rows, walls, start, deadEnds: [] };
    maze.deadEnds = findDeadEnds(maze);
    return maze;
  }

  function distanceField(maze, from) {
    const dist = new Int32Array(maze.cols * maze.rows).fill(-1);
    const queue = [from];
    dist[index(maze, from.col, from.row)] = 0;

    const steps = [
      { dc: 0, dr: -1 },
      { dc: 1, dr: 0 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
    ];

    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head];
      const base = dist[index(maze, cell.col, cell.row)];
      for (const { dc, dr } of steps) {
        if (!canMove(maze, cell.col, cell.row, dc, dr)) continue;
        const next = { col: cell.col + dc, row: cell.row + dr };
        const at = index(maze, next.col, next.row);
        if (dist[at] !== -1) continue;
        dist[at] = base + 1;
        queue.push(next);
      }
    }
    return dist;
  }

  function findPath(maze, from, to) {
    const total = maze.cols * maze.rows;
    const visited = new Uint8Array(total);
    const previous = new Int32Array(total).fill(-1);
    const queue = [from];
    const fromIdx = index(maze, from.col, from.row);
    const toIdx = index(maze, to.col, to.row);

    visited[fromIdx] = 1;

    const steps = [
      { dc: 0, dr: -1 },
      { dc: 1, dr: 0 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
    ];

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const curIdx = index(maze, current.col, current.row);
      if (curIdx === toIdx) break;

      for (const { dc, dr } of steps) {
        if (!canMove(maze, current.col, current.row, dc, dr)) continue;
        const next = { col: current.col + dc, row: current.row + dr };
        const nextIdx = index(maze, next.col, next.row);
        if (visited[nextIdx]) continue;

        visited[nextIdx] = 1;
        previous[nextIdx] = curIdx;
        queue.push(next);
      }
    }

    if (!visited[toIdx]) return [];

    const path = [];
    let cur = toIdx;
    while (cur !== -1) {
      const row = Math.floor(cur / maze.cols);
      const col = cur % maze.cols;
      path.push({ col, row });
      if (cur === fromIdx) break;
      cur = previous[cur];
    }
    path.reverse();
    return path;
  }

  function placeKeys(maze, assignedColor) {
    const dist = distanceField(maze, maze.start);
    const candidates = maze.deadEnds
      .filter((cell) => dist[index(maze, cell.col, cell.row)] > 4)
      .sort((a, b) => dist[index(maze, b.col, b.row)] - dist[index(maze, a.col, a.row)]);

    const chosen = [];
    for (const cell of candidates) {
      if (chosen.length >= CONFIG.keyCount) break;
      const farEnough = chosen.every(
        (other) => Math.abs(other.col - cell.col) + Math.abs(other.row - cell.row) > 5
      );
      if (farEnough) chosen.push(cell);
    }
    for (const cell of candidates) {
      if (chosen.length >= CONFIG.keyCount) break;
      if (!chosen.some((c) => c.col === cell.col && c.row === cell.row)) chosen.push(cell);
    }

    const colors = shuffle(KEY_COLORS);
    const keys = chosen.map((cell, i) => ({
      id: `key-${i}`,
      color: colors[i],
      cell,
      collected: false,
    }));

    // If an assigned color is provided, keep it locked as the authentic key
    const normalizedAssigned = assignedColor ? String(assignedColor).toUpperCase() : null;
    const correctKey = (normalizedAssigned && KEY_COLORS.includes(normalizedAssigned))
      ? normalizedAssigned
      : colors[Math.floor(Math.random() * colors.length)];

    return { keys, correctKey };
  }

  function sameCell(a, b) {
    return a && b && a.col === b.col && a.row === b.row;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GAME ENGINE
  // ─────────────────────────────────────────────────────────────────────────────
  class GameEngine {
    constructor(initialElapsedMs = 0, initialRound = 0, assignedColor = null) {
      this.assignedColor = assignedColor ? String(assignedColor).toUpperCase() : null;
      this.held = [];
      this.onStateChange = null;
      this.onSuccess = null;
      this.state = this.buildState(initialRound, initialElapsedMs);
    }

    setAssignedColor(color) {
      if (!color) return;
      const norm = String(color).toUpperCase();
      if (KEY_COLORS.includes(norm)) {
        this.assignedColor = norm;
        if (this.state) {
          this.state.correctKey = norm;
        }
      }
    }

    buildState(round, elapsedMs) {
      const maze = generateMaze();
      const { keys, correctKey } = placeKeys(maze, this.assignedColor);

      return {
        status: 'READY',
        maze,
        keys,
        correctKey,
        round,
        elapsedMs,
        debug: false,
        seen: new Uint8Array(maze.cols * maze.rows),
        returnPath: [],
        returnPathIndex: 0,
        wrongKey: null,
        player: {
          col: maze.start.col,
          row: maze.start.row,
          from: { ...maze.start },
          to: { ...maze.start },
          t: 0,
          facing: 'right',
          moving: false,
        },
      };
    }

    start() {
      if (this.state.status !== 'READY') return;
      this.state.status = 'PLAYING';
      this.revealAroundPlayer();
      this.notify();
    }

    regenerate() {
      const { elapsedMs, round, debug } = this.state;
      this.state = this.buildState(round + 1, elapsedMs);
      this.state.debug = debug;
      this.state.status = 'PLAYING';
      this.held = [];
      this.revealAroundPlayer();
      this.notify();
    }

    toggleDebug() {
      this.state.debug = !this.state.debug;
      this.notify();
    }

    press(dir) {
      if (!this.held.includes(dir)) {
        this.held.push(dir);
      }
    }

    release(dir) {
      this.held = this.held.filter((d) => d !== dir);
    }

    releaseAll() {
      this.held = [];
    }

    update(dtMs) {
      if (this.state.status !== 'PLAYING' && this.state.status !== 'RETURN_TO_START') {
        return;
      }

      this.state.elapsedMs += dtMs;
      const dt = dtMs / 1000;
      let budget = CONFIG.playerSpeed * dt;

      while (budget > 0) {
        const { player } = this.state;
        if (!player.moving && !this.chooseNextCell()) {
          break;
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

    chooseNextCell() {
      const { status } = this.state;
      if (status === 'RETURN_TO_START') {
        return this.chooseReturnCell();
      }
      if (status !== 'PLAYING') {
        return false;
      }
      return this.chooseNormalCell();
    }

    chooseNormalCell() {
      const { player, maze } = this.state;
      const col = Math.round(player.col);
      const row = Math.round(player.row);

      for (let i = this.held.length - 1; i >= 0; i -= 1) {
        const dir = this.held[i];
        const { dc, dr } = VECTORS[dir];
        player.facing = dir;

        if (!canMove(maze, col, row, dc, dr)) continue;

        player.from = { col, row };
        player.to = { col: col + dc, row: row + dr };
        player.t = 0;
        player.moving = true;
        return true;
      }
      return false;
    }

    chooseReturnCell() {
      const { player, returnPath, returnPathIndex } = this.state;
      if (returnPath.length === 0 || returnPathIndex >= returnPath.length - 1) {
        return false;
      }

      const current = returnPath[returnPathIndex];
      const next = returnPath[returnPathIndex + 1];
      const dc = next.col - current.col;
      const dr = next.row - current.row;

      let requiredDirection = 'up';
      if (dc === 1) requiredDirection = 'right';
      else if (dc === -1) requiredDirection = 'left';
      else if (dr === 1) requiredDirection = 'down';

      if (!this.held.includes(requiredDirection)) {
        return false;
      }

      player.facing = requiredDirection;
      player.from = { ...current };
      player.to = { ...next };
      player.t = 0;
      player.moving = true;
      return true;
    }

    handleCellArrival() {
      const { status, player, maze } = this.state;
      const currentCell = {
        col: Math.round(player.col),
        row: Math.round(player.row),
      };

      if (status === 'RETURN_TO_START') {
        const nextIndex = this.state.returnPathIndex + 1;
        const expected = this.state.returnPath[nextIndex];
        if (expected && sameCell(currentCell, expected)) {
          this.state.returnPathIndex = nextIndex;
        }

        if (sameCell(currentCell, maze.start)) {
          this.state.status = 'RESETTING';
          this.notify();
          this.regenerate();
        }
        return;
      }

      if (status !== 'PLAYING') return;

      const key = this.state.keys.find(
        (candidate) => !candidate.collected && sameCell(candidate.cell, currentCell)
      );

      if (!key) return;

      key.collected = true;

      if (key.color === this.state.correctKey) {
        this.state.status = 'SUCCESS';
        this.held = [];
        this.notify();
        if (this.onSuccess) {
          this.onSuccess(this.state.elapsedMs, this.state.round);
        }
        return;
      }

      // Wrong key picked
      this.state.wrongKey = key.color;
      this.state.status = 'RETURN_TO_START';
      this.state.returnPath = findPath(this.state.maze, currentCell, maze.start);
      this.state.returnPathIndex = 0;
      this.held = [];
      this.notify();
    }

    revealAroundPlayer() {
      const { maze, seen, player } = this.state;
      const radius = CONFIG.sightRadius + CONFIG.sightFalloff * 0.5;
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

    notify() {
      if (this.onStateChange) {
        this.onStateChange(this.getSnapshot());
      }
    }

    getSnapshot() {
      return {
        status: this.state.status,
        elapsedMs: this.state.elapsedMs,
        debug: this.state.debug,
        round: this.state.round,
        correctKey: this.state.correctKey,
        wrongKey: this.state.wrongKey,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDERER
  // ─────────────────────────────────────────────────────────────────────────────
  function computeViewport(maze, width, height) {
    const pad = Math.min(width, height) * 0.012;
    const size = Math.min((width - pad * 2) / maze.cols, (height - pad * 2) / maze.rows);
    return {
      size,
      originX: (width - size * maze.cols) / 2,
      originY: (height - size * maze.rows) / 2,
    };
  }

  function drawFloors(ctx, state, vp, lit, all) {
    const { maze, seen } = state;
    ctx.fillStyle = lit ? PALETTE.floorLit : PALETTE.floor;
    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        if (!all && !seen[row * maze.cols + col]) continue;
        ctx.fillRect(
          vp.originX + col * vp.size + 1,
          vp.originY + row * vp.size + 1,
          vp.size - 2,
          vp.size - 2
        );
      }
    }
  }

  function drawWalls(ctx, state, vp, lit, all) {
    const { maze, seen } = state;
    const { size, originX, originY } = vp;

    ctx.lineWidth = Math.max(1.5, size * 0.1);
    ctx.lineCap = 'round';
    ctx.strokeStyle = lit ? PALETTE.wallGlow : PALETTE.wall;
    if (lit) {
      ctx.shadowColor = PALETTE.wallGlow;
      ctx.shadowBlur = size * 0.45;
    }

    ctx.beginPath();
    for (let row = 0; row < maze.rows; row += 1) {
      for (let col = 0; col < maze.cols; col += 1) {
        if (!all && !seen[row * maze.cols + col]) continue;
        const mask = maze.walls[row * maze.cols + col];
        const x = originX + col * size;
        const y = originY + row * size;

        if (mask & WALL.N) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + size, y);
        }
        if (mask & WALL.W) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + size);
        }
        if (row === maze.rows - 1 && mask & WALL.S) {
          ctx.moveTo(x, y + size);
          ctx.lineTo(x + size, y + size);
        }
        if (col === maze.cols - 1 && mask & WALL.E) {
          ctx.moveTo(x + size, y);
          ctx.lineTo(x + size, y + size);
        }
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

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

  function drawKey(ctx, x, y, size, hex, time) {
    const bob = Math.sin(time / 520 + x) * size * 0.04;
    const r = size * 0.15;

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.shadowColor = hex;
    ctx.shadowBlur = size * 0.7;
    ctx.strokeStyle = hex;
    ctx.fillStyle = hex;
    ctx.lineWidth = Math.max(1.2, size * 0.07);
    ctx.lineCap = 'round';

    // bow
    ctx.beginPath();
    ctx.arc(0, -r * 0.6, r, 0, Math.PI * 2);
    ctx.stroke();
    // shaft
    ctx.beginPath();
    ctx.moveTo(0, r * 0.4);
    ctx.lineTo(0, r * 2.1);
    ctx.stroke();
    // teeth
    ctx.beginPath();
    ctx.moveTo(0, r * 1.35);
    ctx.lineTo(r * 0.75, r * 1.35);
    ctx.moveTo(0, r * 2.0);
    ctx.lineTo(r * 0.55, r * 2.0);
    ctx.stroke();
    // core
    ctx.beginPath();
    ctx.arc(0, -r * 0.6, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawKeys(ctx, state, vp, time, all) {
    for (const token of state.keys) {
      if (token.collected) continue;
      if (!all && !state.seen[token.cell.row * state.maze.cols + token.cell.col]) continue;
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

  function drawPlayer(ctx, state, vp, time) {
    const { player } = state;
    const cx = vp.originX + (player.col + 0.5) * vp.size;
    const cy = vp.originY + (player.row + 0.5) * vp.size;
    const pulse = 0.5 + 0.5 * Math.sin(time / 420);
    const r = vp.size * 0.24;

    const halo = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 4.5);
    halo.addColorStop(0, 'rgba(126,240,255,0.5)');
    halo.addColorStop(1, 'rgba(126,240,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - r * 5, cy - r * 5, r * 10, r * 10);

    ctx.save();
    ctx.shadowColor = PALETTE.player;
    ctx.shadowBlur = vp.size * 0.9;
    ctx.strokeStyle = 'rgba(126,240,255,0.85)';
    ctx.lineWidth = Math.max(1, vp.size * 0.05);
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.35 + pulse * 0.12), 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#eafcff';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawReturnBarriers(ctx, state, vp) {
    if (state.status !== 'RETURN_TO_START' || state.returnPath.length === 0) return;
    const current = state.returnPath[state.returnPathIndex];
    if (!current) return;

    const { maze } = state;
    const x = vp.originX + current.col * vp.size;
    const y = vp.originY + current.row * vp.size;
    const next = state.returnPath[state.returnPathIndex + 1];

    ctx.save();
    ctx.strokeStyle = 'rgba(255,75,109,0.85)';
    ctx.shadowColor = 'rgba(255,75,109,0.75)';
    ctx.shadowBlur = vp.size * 0.35;
    ctx.lineWidth = Math.max(2, vp.size * 0.08);
    ctx.lineCap = 'round';

    const allowed = next ? { dc: next.col - current.col, dr: next.row - current.row } : null;

    const barriers = [
      { dc: 0, dr: -1, wall: WALL.N, x1: x, y1: y, x2: x + vp.size, y2: y },
      { dc: 1, dr: 0, wall: WALL.E, x1: x + vp.size, y1: y, x2: x + vp.size, y2: y + vp.size },
      { dc: 0, dr: 1, wall: WALL.S, x1: x, y1: y + vp.size, x2: x + vp.size, y2: y + vp.size },
      { dc: -1, dr: 0, wall: WALL.W, x1: x, y1: y, x2: x, y2: y + vp.size },
    ];

    for (const barrier of barriers) {
      if (allowed && barrier.dc === allowed.dc && barrier.dr === allowed.dr) continue;
      const mask = maze.walls[current.row * maze.cols + current.col];
      if (mask & barrier.wall) continue; // Only draw barriers on actual passages!

      ctx.beginPath();
      ctx.moveTo(barrier.x1, barrier.y1);
      ctx.lineTo(barrier.x2, barrier.y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderScene(ctx, lightCtx, state, width, height, time) {
    const vp = computeViewport(state.maze, width, height);
    const { player, debug } = state;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, width, height);

    // 1. Remembered geometry pass (faint memory)
    ctx.save();
    ctx.globalAlpha = debug ? 0.42 : CONFIG.memoryAlpha;
    drawFloors(ctx, state, vp, false, debug);
    drawWalls(ctx, state, vp, false, debug);
    if (debug) drawKeys(ctx, state, vp, time, true);
    ctx.restore();

    // 2. Lit pass onto offscreen canvas
    lightCtx.clearRect(0, 0, width, height);
    drawFloors(lightCtx, state, vp, true, true);
    drawWalls(lightCtx, state, vp, true, true);
    drawStartPad(lightCtx, state, vp, time, true);
    drawKeys(lightCtx, state, vp, time, true);

    const cx = vp.originX + (player.col + 0.5) * vp.size;
    const cy = vp.originY + (player.row + 0.5) * vp.size;
    const inner = CONFIG.sightRadius * vp.size;
    const outer = (CONFIG.sightRadius + CONFIG.sightFalloff) * vp.size;

    const mask = lightCtx.createRadialGradient(cx, cy, inner * 0.2, cx, cy, outer);
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(0.55, 'rgba(255,255,255,0.92)');
    mask.addColorStop(0.8, 'rgba(255,255,255,0.35)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');

    lightCtx.globalCompositeOperation = 'destination-in';
    lightCtx.fillStyle = mask;
    lightCtx.fillRect(0, 0, width, height);
    lightCtx.globalCompositeOperation = 'source-over';

    // Composite lit pass over background
    ctx.drawImage(lightCtx.canvas, 0, 0, width, height);

    if (!debug) {
      drawStartPad(ctx, state, vp, time, false);
    }

    drawReturnBarriers(ctx, state, vp);
    drawPlayer(ctx, state, vp, time);

    // Screen vignette
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
  }

  // Export to global window object
  window.BrainBreakerMaze = {
    CONFIG,
    KEY_COLORS,
    KEY_HEX,
    PALETTE,
    GameEngine,
    renderScene,
  };
})(window);
