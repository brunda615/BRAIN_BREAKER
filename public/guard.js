/* Brain Breaker: developer tools deterrent for the player page.
 *
 * No web page can fully stop someone who owns the browser (view-source:, a
 * second device, disabling JavaScript). This layer raises the bar during a
 * live event:
 *   1. Blocks the keyboard shortcuts and right-click menu that open DevTools.
 *   2. Detects DevTools opening (debugger pause timing + docked-panel size jump).
 *   3. Covers the game with a lock screen and reports the team to the admin.
 *
 * Skipped on http://localhost so the organizer can still debug locally.
 * Use http://127.0.0.1 to test the guard on your own machine.
 */
(function () {
  'use strict';

  if (location.hostname === 'localhost') return;

  var locked = false;
  var reportedThisEpisode = false;
  var cleanTicks = 0;
  var overlay = null;

  // ── 1. Shortcut + context menu blocking ──────────────────────────────────
  function isBlockedCombo(e) {
    var key = (e.key || '').toLowerCase();
    var code = e.code || '';
    var mod = e.ctrlKey || e.metaKey;

    if (key === 'f12' || code === 'F12') return true;
    // Ctrl+Shift+I / J / C / K / E, Cmd+Opt+I / J / C (Chrome, Edge, Brave, Opera, Firefox, Safari)
    if (mod && (e.shiftKey || e.altKey) && /^(KeyI|KeyJ|KeyC|KeyK|KeyE|KeyM)$/.test(code)) return true;
    // View source (Ctrl+U / Cmd+Opt+U) and save page (Ctrl+S)
    if (mod && (code === 'KeyU' || code === 'KeyS')) return true;
    return false;
  }

  function onKey(e) {
    if (isBlockedCombo(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', function (e) { if (isBlockedCombo(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); }, true);
  window.addEventListener('dragstart', function (e) {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  }, true);

  // ── 2. Detection ─────────────────────────────────────────────────────────
  // (a) A debugger statement only pauses when DevTools is open. Measuring the
  //     gap tells us it paused, and the repeated pauses make DevTools unusable.
  var trap = Function('debugger');
  function debuggerProbe() {
    var t = performance.now();
    trap();
    return performance.now() - t > 120;
  }

  // (b) Docked DevTools shrinks the viewport while the window stays the same
  //     size. Zooming also shrinks it, so ignore changes to devicePixelRatio.
  var baseline = null;
  function snapshot() {
    return {
      ow: window.outerWidth, oh: window.outerHeight,
      iw: window.innerWidth, ih: window.innerHeight,
      dpr: window.devicePixelRatio
    };
  }
  var coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  function sizeProbe() {
    // Phones and tablets have no DevTools, and their on-screen keyboard resizes the viewport.
    if (coarsePointer) return false;
    var s = snapshot();
    if (!baseline || s.ow !== baseline.ow || s.oh !== baseline.oh || s.dpr !== baseline.dpr) {
      baseline = s;
      return false;
    }
    var typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    return (baseline.iw - s.iw > 220) || (!typing && baseline.ih - s.ih > 220);
  }
  window.addEventListener('resize', function () {
    var s = snapshot();
    if (baseline && (s.ow !== baseline.ow || s.oh !== baseline.oh || s.dpr !== baseline.dpr)) baseline = s;
    else if (baseline && (s.iw > baseline.iw || s.ih > baseline.ih)) baseline = s;
    tick();
  });

  function tick() {
    var open = debuggerProbe() || sizeProbe();
    if (open) {
      cleanTicks = 0;
      if (!locked) lock();
    } else if (locked) {
      cleanTicks += 1;
      if (cleanTicks >= 3) unlock();
    }
  }

  // ── 3. Lock screen + report ──────────────────────────────────────────────
  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'overlay lock hidden';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'guardTitle');
    overlay.innerHTML =
      '<div class="sheet" style="text-align:left">' +
        '<div class="ball is-hit" style="--size:64px;margin-bottom:1.25rem"><span>!</span></div>' +
        '<h2 id="guardTitle">Close developer tools</h2>' +
        '<p style="margin-top:1rem;color:var(--chalk-2)">Inspecting the game page is not allowed during the event. ' +
        'Your team has been flagged to the organizers.</p>' +
        '<p style="margin-top:.75rem;color:var(--chalk-2)">The game comes back as soon as DevTools (or any side panel docked to this window) is closed.</p>' +
      '</div>';
    document.body.appendChild(overlay);
  }

  function report() {
    if (reportedThisEpisode) return;
    reportedThisEpisode = true;
    var token = '';
    try { token = localStorage.getItem('brain_token') || ''; } catch (e) {}
    if (!token) return;
    try {
      fetch('/api/tab-violation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, reason: 'devtools' }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  function lock() {
    locked = true;
    if (!overlay && document.body) buildOverlay();
    if (overlay) overlay.classList.remove('hidden');
    var main = document.querySelector('main');
    if (main) main.style.visibility = 'hidden';
    report();
  }

  function unlock() {
    locked = false;
    reportedThisEpisode = false;
    if (overlay) overlay.classList.add('hidden');
    var main = document.querySelector('main');
    if (main) main.style.visibility = '';
  }

  function start() {
    baseline = snapshot();
    setInterval(tick, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
