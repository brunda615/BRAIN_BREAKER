/* Brain Breaker: living background + cursor.
 *
 * Background: a halftone dot field (the poster's print screen) that breathes on
 * its own. Dots swell into sun and tomato ink around the cursor, and clicks or
 * game events send ink ripples across it. Call window.bbRipple(x, y, kind).
 *
 * Cursor: a tomato dot with a trailing ring that grows over anything clickable.
 * Only on mouse/trackpad devices; text fields keep the normal I-beam.
 *
 * Both switch off with prefers-reduced-motion. The field pauses while the maze
 * is on screen (the maze canvas needs the frame budget) and when the tab is hidden.
 */
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE = window.matchMedia('(pointer: fine)').matches;

  var GAP = 24;
  var INK = {
    base:   'rgba(244, 236, 216, 0.11)',
    sun:    'rgba(255, 200, 61, 0.85)',
    tomato: 'rgba(255, 90, 60, 0.95)'
  };

  var canvas, ctx, w = 0, h = 0, dpr = 1;
  var mouse = { x: -9999, y: -9999, sx: -9999, sy: -9999, energy: 0, last: 0 };
  var ripples = [];
  var running = false;

  function mazeOnScreen() {
    var m = document.getElementById('viewLevel2');
    return m && !m.classList.contains('hidden');
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (REDUCED) draw(0);
  }

  function draw(time) {
    var t = time / 1000;
    ctx.clearRect(0, 0, w, h);

    // Ease the spotlight towards the pointer, and let it fade when the mouse rests.
    mouse.sx += (mouse.x - mouse.sx) * 0.14;
    mouse.sy += (mouse.y - mouse.sy) * 0.14;
    var idle = time - mouse.last;
    var target = idle < 1800 ? 1 : 0;
    mouse.energy += (target - mouse.energy) * (target ? 0.08 : 0.02);

    for (var i = ripples.length - 1; i >= 0; i--) {
      var rp = ripples[i];
      rp.r += rp.speed;
      rp.life -= 0.012;
      if (rp.life <= 0) ripples.splice(i, 1);
    }

    var buckets = { base: [], sun: [], tomato: [] };
    var rows = Math.ceil(h / GAP) + 1;
    var cols = Math.ceil(w / GAP) + 2;
    var reach = 190;

    for (var row = 0; row < rows; row++) {
      var y = row * GAP;
      var offset = (row % 2) * (GAP / 2);
      for (var col = 0; col < cols; col++) {
        var x = col * GAP - offset;

        // Slow ink swell drifting across the sheet
        var wave = (Math.sin(x * 0.011 + t * 0.7) + Math.sin(y * 0.014 - t * 0.55) + Math.sin((x + y) * 0.006 + t * 0.4)) / 6 + 0.5;
        var r = 0.7 + wave * 1.1;
        var heat = 0;

        if (mouse.energy > 0.01) {
          var dx = x - mouse.sx, dy = y - mouse.sy;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < reach) {
            var f = 1 - d / reach;
            f = f * f * mouse.energy;
            r += f * 5.2;
            heat = f;
          }
        }

        for (var k = 0; k < ripples.length; k++) {
          var p = ripples[k];
          var rx = x - p.x, ry = y - p.y;
          var band = Math.abs(Math.sqrt(rx * rx + ry * ry) - p.r);
          if (band < 42) {
            var g = (1 - band / 42) * p.life * p.strength;
            r += g * 4.5;
            heat = Math.max(heat, p.kind === 'tomato' ? g + 0.5 : g * 0.9);
          }
        }

        var bucket = heat > 0.55 ? 'tomato' : heat > 0.16 ? 'sun' : 'base';
        buckets[bucket].push(x, y, r);
      }
    }

    fill(buckets.base, INK.base);
    fill(buckets.sun, INK.sun);
    fill(buckets.tomato, INK.tomato);
  }

  function fill(list, color) {
    if (!list.length) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 0; i < list.length; i += 3) {
      ctx.moveTo(list[i] + list[i + 2], list[i + 1]);
      ctx.arc(list[i], list[i + 1], list[i + 2], 0, 6.2832);
    }
    ctx.fill();
  }

  function loop(time) {
    if (!running) return;
    if (document.hidden || mazeOnScreen()) {
      ctx.clearRect(0, 0, w, h);
    } else {
      draw(time);
    }
    requestAnimationFrame(loop);
  }

  window.bbRipple = function (x, y, kind) {
    if (REDUCED || !ctx) return;
    ripples.push({ x: x, y: y, r: 0, speed: kind === 'big' ? 9 : 7, life: 1, strength: kind === 'big' ? 1.3 : 1, kind: kind === 'miss' ? 'sun' : 'tomato' });
    if (ripples.length > 6) ripples.shift();
  };
  window.bbRippleFrom = function (el, kind) {
    if (!el || !el.getBoundingClientRect) return;
    var b = el.getBoundingClientRect();
    window.bbRipple(b.left + b.width / 2, b.top + b.height / 2, kind);
  };

  // ── Cursor ─────────────────────────────────────────────────────────────
  function setupCursor() {
    if (!FINE || REDUCED) return;
    var dot = document.createElement('div');
    var ring = document.createElement('div');
    dot.className = 'cursor-dot';
    ring.className = 'cursor-ring';
    dot.setAttribute('aria-hidden', 'true');
    ring.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ring);
    document.body.appendChild(dot);
    document.documentElement.classList.add('has-cursor');

    var pos = { x: -100, y: -100, rx: -100, ry: -100 };
    var CLICKABLE = 'a, button, [role="switch"], select, label[for], summary, .maze-frame';

    window.addEventListener('mousemove', function (e) {
      pos.x = e.clientX; pos.y = e.clientY;
      document.documentElement.classList.remove('cursor-away');
    }, { passive: true });
    document.addEventListener('mouseleave', function () { document.documentElement.classList.add('cursor-away'); });
    window.addEventListener('mousedown', function () { ring.classList.add('is-down'); });
    window.addEventListener('mouseup', function () { ring.classList.remove('is-down'); });

    document.addEventListener('mouseover', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var typing = t.closest('input, textarea, [contenteditable="true"]');
      var hot = !typing && t.closest(CLICKABLE);
      var disabled = hot && (hot.disabled || hot.getAttribute('aria-disabled') === 'true');
      ring.classList.toggle('is-hover', !!hot && !disabled);
      document.documentElement.classList.toggle('cursor-text', !!typing);
    });

    (function follow() {
      pos.rx += (pos.x - pos.rx) * 0.2;
      pos.ry += (pos.y - pos.ry) * 0.2;
      dot.style.transform = 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)';
      ring.style.transform = 'translate3d(' + pos.rx + 'px,' + pos.ry + 'px,0)';
      requestAnimationFrame(follow);
    })();
  }

  function start() {
    canvas = document.createElement('canvas');
    canvas.id = 'bgfx';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(canvas, document.body.firstChild);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    window.addEventListener('pointermove', function (e) {
      mouse.x = e.clientX; mouse.y = e.clientY;
      mouse.last = performance.now();
    }, { passive: true });
    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') window.bbRipple(e.clientX, e.clientY, 'miss');
    }, { passive: true });

    if (!REDUCED) {
      running = true;
      requestAnimationFrame(loop);
    }
    setupCursor();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
