/* Starship Sus — UI layer: menus, lobby, HUD, meeting, splashes, touch controls. See SPEC.md §4.6.
 * Builds all of its DOM inside #ui-layer (created if missing). CSS lives in index.html.
 * Degrades gracefully when IS.render / IS.audio / IS.map are missing. */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});

  // ------------------------------------------------------------------ constants / helpers
  var FALLBACK_COLORS = [
    ['Red', '#c51111', '#7a0838'], ['Blue', '#132ed1', '#09158e'], ['Green', '#117f2d', '#0a4d2e'],
    ['Pink', '#ed54ba', '#ab2bad'], ['Orange', '#ef7d0d', '#b33e15'], ['Yellow', '#f5f557', '#c38823'],
    ['Black', '#3f474e', '#1e1f26'], ['White', '#d6e0f0', '#8394bf'], ['Purple', '#6b2fbb', '#3b177c'],
    ['Brown', '#71491e', '#5e2615'], ['Cyan', '#38fedc', '#24a8be'], ['Lime', '#50ef39', '#15a742']
  ];
  var DEFAULT_SETTINGS = { imp: 1, kcd: 25, spd: 1, cvis: 1, ivis: 1.5, dis: 15, vot: 45, emg: 1, nt: 5, conf: 1, kd: 1, free: 0 };
  var FUN_NAMES = ['Nova', 'Comet', 'Orbit', 'Pixel', 'Rocket', 'Astro', 'Blip', 'Zappy', 'Nebula', 'Quasar', 'Sputnik', 'Cosmo', 'Luna', 'Rover'];

  function CFG() { return IS.CONFIG || {}; }
  function COLORS() { return (CFG().COLORS && CFG().COLORS.length) ? CFG().COLORS : FALLBACK_COLORS; }
  function col(i) { var c = COLORS(); i = i | 0; return c[((i % c.length) + c.length) % c.length]; }
  function maxPlayers() { return CFG().MAX_PLAYERS || 10; }
  function minPlayers() { return CFG().MIN_PLAYERS || 3; }
  function alphabet() { return CFG().CODE_ALPHABET || 'ABCDEFGHJKLMNPQRSTUVWXYZ'; }
  function isImp(role) { return role === 1 || role === 'imp' || role === 'impostor'; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // hats (IS.HATS / IS.hats from hats.js; everything degrades to "no hat" when missing)
  function HATS() { return (IS.HATS && IS.HATS.length) ? IS.HATS : null; }
  function hatCount() { return HATS() ? HATS().length : 1; }
  function cleanHat(i) { i = parseInt(i, 10) | 0; return i > 0 && i < hatCount() ? i : 0; }
  function hatName(i) { var L = HATS(); return L && L[cleanHat(i)] ? L[cleanHat(i)].name : 'No hat'; }
  function hatTop(i) { i = cleanHat(i); return i && IS.hats && IS.hats.top ? Math.min(-58, IS.hats.top(i)) : -58; }
  function lsGet(k, d) { try { var v = window.localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (e) { /* storage unavailable */ } }

  // tiny hyperscript: h('div.a.b#id', {attrs/on/text/html}, [children])
  function h(sel, props, kids) {
    var parts = sel.split(/(?=[.#])/);
    var tag = (parts[0] && parts[0].charAt(0) !== '.' && parts[0].charAt(0) !== '#') ? parts.shift() : 'div';
    var el = document.createElement(tag);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].charAt(0) === '.') el.classList.add(parts[i].slice(1)); else el.id = parts[i].slice(1);
    }
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v == null || v === false) continue;
        if (k === 'on') { for (var ev in v) el.addEventListener(ev, v[ev]); }
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style') el.style.cssText = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    if (kids != null) {
      if (!Array.isArray(kids)) kids = [kids];
      for (var j = 0; j < kids.length; j++) {
        var c = kids[j];
        if (c == null || c === false) continue;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return el;
  }
  function show(el, on) { if (el) el.classList.toggle('is-hidden', !on); }
  function txt(el, s) { if (el && el.textContent !== s) el.textContent = s; }

  // ------------------------------------------------------------------ icons
  function svg(inner, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + inner + '</svg>';
  }
  var ICON = {
    use: svg('<path d="M9 11.5V5.2a1.6 1.6 0 0 1 3.2 0V10m0-1.2a1.6 1.6 0 0 1 3.2 0V11m0-.6a1.6 1.6 0 0 1 3.2 0v4.4a6.2 6.2 0 0 1-6.2 6.2h-.9a6.2 6.2 0 0 1-5.1-2.7l-2.8-4.2a1.6 1.6 0 0 1 2.6-1.9L9 14.6" fill="currentColor" fill-opacity=".2"/>'),
    report: svg('<path d="M3 10v4h3l7 5V5l-7 5H3z" fill="currentColor" fill-opacity=".25"/><path d="M16.5 8.8a4.6 4.6 0 0 1 0 6.4M19.2 6.2a8.4 8.4 0 0 1 0 11.6"/>'),
    kill: svg('<path d="M20.5 3.5C14 4.5 10 8.5 8 12.5l3.5 3.5c4-2 8-6 9-12.5z" fill="currentColor" fill-opacity=".3"/><path d="M6 12.5l5.5 5.5M8.5 15.5l-5 5"/>'),
    sabotage: svg('<path d="M12 3L2 20.5h20L12 3z" fill="currentColor" fill-opacity=".22"/><path d="M13 9l-3 5h4l-3 4.5"/>'),
    vent: svg('<rect x="3" y="5" width="18" height="14" rx="2.5" fill="currentColor" fill-opacity=".18"/><path d="M7 9h10M7 12h10M7 15h10"/>'),
    map: svg('<path d="M9 4L3 6.2v13.8l6-2.2 6 2.2 6-2.2V4l-6 2.2L9 4z" fill="currentColor" fill-opacity=".18"/><path d="M9 4v13.8M15 6.2V20"/>'),
    soundOn: svg('<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" fill-opacity=".25"/><path d="M16.2 9.2a4 4 0 0 1 0 5.6M18.8 6.6a7.6 7.6 0 0 1 0 10.8"/>'),
    soundOff: svg('<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" fill-opacity=".25"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>'),
    copy: svg('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>'),
    crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="#050814" stroke-width="1.8" stroke-linejoin="round" d="M3 8.5l4.6 4L12 5l4.4 7.5L21 8.5 19 19H5L3 8.5z"/></svg>',
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>', ' stroke-width="3"'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>', ' stroke-width="3.2"'),
    cross: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', ' stroke-width="3.2"'),
    chat: svg('<path d="M4 5h16v11H9.5L4 20V5z" fill="currentColor" fill-opacity=".2"/><path d="M8 9.5h8M8 12.5h5"/>'),
    players: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>'),
    leave: svg('<path d="M13 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7"/><path d="M10.5 12H21M17 8l4 4-4 4"/>'),
    rocket: svg('<path d="M12 2.5c3 2 4.5 5.5 4.5 9.5l-2 4h-5l-2-4c0-4 1.5-7.5 4.5-9.5z" fill="currentColor" fill-opacity=".25"/><circle cx="12" cy="9.5" r="1.8"/><path d="M7.5 12L4.5 15v3l3.5-2M16.5 12l3 3v3l-3.5-2M10.5 19.5L12 22l1.5-2.5"/>'),
    play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" fill-opacity=".3"/>'),
    join: svg('<path d="M4 12h12M12 7l5 5-5 5"/><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/>'),
    reactor: svg('<circle cx="12" cy="12" r="1.9" fill="currentColor"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)"/>', ' stroke-width="1.9"'),
    o2: svg('<circle cx="9" cy="14" r="5.2"/><circle cx="17" cy="6.8" r="3"/><circle cx="18.6" cy="16.6" r="2"/><path d="M7 12.5a2.4 2.4 0 0 1 2-1.6"/>'),
    lights: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" fill="currentColor" fill-opacity=".22"/>'),
    comms: svg('<path d="M12 12v9M8 21h8"/><circle cx="12" cy="10" r="2"/><path d="M8.2 6.6a5.2 5.2 0 0 0 0 6.8M15.8 6.6a5.2 5.2 0 0 1 0 6.8M5.2 4a9 9 0 0 0 0 12M18.8 4a9 9 0 0 1 0 12"/>'),
    chev: svg('<path d="M6 9l6 6 6-6"/>', ' stroke-width="3"'),
    xmark: svg('<path d="M5 5l14 14M19 5L5 19"/>', ' stroke-width="4"'),
    send: svg('<path d="M3.5 11.5L21 3.5l-8 17.5-2-7.5z" fill="currentColor" fill-opacity=".25"/>'),
    megaphone: svg('<path d="M3 10v4h3l7 5V5l-7 5H3z" fill="currentColor"/><path d="M16.5 9a4.2 4.2 0 0 1 0 6"/>'),
    sliders: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>')
  };

  // ------------------------------------------------------------------ state
  var H = {};
  var E = {};
  var S = {
    inited: false, screen: null, mode: null,
    name: '', color: 0, myColor: 0, hat: 0, hatAt: 0, muted: false, touch: false,
    games: [], lobby: null, lobbySigs: {}, panelOpen: null, panelTab: 'players', localSet: null, localSetAt: 0,
    hud: null, hudSigs: {}, tasksCollapsed: false,
    meeting: null, meetingOpen: false, cards: {}, cardsSig: '', selected: null, pendingVote: null, meetDeadline: 0,
    chat: [], unread: 0, chatOpen: false,
    mapView: null, mapOpen: false, mapLast: 0, sabOpen: false,
    stick: { x: 0, y: 0 }, stickId: null,
    timers: {}, redraw: {}, eject: null
  };

  function fire(name, arg) {
    var fn = H[name];
    if (typeof fn !== 'function') return false;
    try { fn(arg); } catch (e) { if (window.console) console.error('[ui] handler ' + name + ' failed', e); }
    return true;
  }
  function sfx(key) { try { if (IS.audio && IS.audio.play) IS.audio.play(key); } catch (e) { /* no audio */ } }
  function unlockAudio() { try { if (IS.audio && IS.audio.unlock) IS.audio.unlock(); } catch (e) { /* ignore */ } }
  function clearTimer(k) { if (S.timers[k]) { clearTimeout(S.timers[k]); S.timers[k] = null; } }
  function later(k, ms, fn) { clearTimer(k); S.timers[k] = setTimeout(function () { S.timers[k] = null; fn(); }, ms); }

  // ------------------------------------------------------------------ canvas + crewmate drawing
  function dpr() { return Math.min(window.devicePixelRatio || 1, 2.5); }
  function sizeCanvas(cv, w, hh) {
    var d = dpr(), W = Math.max(1, Math.round(w * d)), HH = Math.max(1, Math.round(hh * d));
    if (cv.width !== W || cv.height !== HH) { cv.width = W; cv.height = HH; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return ctx;
  }

  function rrect(ctx, x, y, w, hh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + hh - r); ctx.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
    ctx.lineTo(x + r, y + hh); ctx.quadraticCurveTo(x, y + hh, x, y + hh - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function bodyPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(-18, -38);
    ctx.arc(0, -38, 18, Math.PI, 0);
    ctx.lineTo(18, -4); ctx.quadraticCurveTo(18, 0, 14, 0); ctx.lineTo(7, 0); ctx.quadraticCurveTo(3, 0, 3, -4);
    ctx.lineTo(3, -8); ctx.lineTo(-3, -8); ctx.lineTo(-3, -4);
    ctx.quadraticCurveTo(-3, 0, -7, 0); ctx.lineTo(-14, 0); ctx.quadraticCurveTo(-18, 0, -18, -4);
    ctx.closePath();
  }
  // Vector fallback crewmate (feet at x,y; ~56px tall at scale 1)
  function fallbackCrew(ctx, x, y, ci, o) {
    var c = col(ci), s = o.scale || 1, f = o.facing < 0 ? -1 : 1;
    ctx.save();
    ctx.translate(x, y); ctx.scale(s * f, s);
    if (o.ghost) ctx.globalAlpha *= 0.5;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#0b0d17'; ctx.lineWidth = 3.2;
    if (!o.ghost && !o.noShadow) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, 0, 21, 4.5, 0, 0, Math.PI * 2); ctx.fill(); }
    if (o.dead) {
      ctx.save(); ctx.beginPath(); ctx.rect(-40, -24, 80, 40); ctx.clip();
      rrect(ctx, -27, -40, 14, 26, 6); ctx.fillStyle = c[2]; ctx.fill(); ctx.stroke();
      bodyPath(ctx); ctx.fillStyle = c[1]; ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#f3f0e6'; ctx.strokeStyle = '#0b0d17'; ctx.lineWidth = 2.6;
      rrect(ctx, -3, -33, 6, 11, 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(-3, -34, 3, 0, Math.PI * 2); ctx.arc(3, -34, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, -24, 18, 4, 0, 0, Math.PI * 2); ctx.fillStyle = '#c0182a'; ctx.fill(); ctx.stroke();
      ctx.restore();
      return;
    }
    // backpack
    rrect(ctx, -27, -44, 14, 27, 6); ctx.fillStyle = c[2]; ctx.fill(); ctx.stroke();
    // body + shading
    bodyPath(ctx); ctx.fillStyle = c[1]; ctx.fill();
    ctx.save(); bodyPath(ctx); ctx.clip();
    ctx.fillStyle = c[2]; ctx.beginPath(); ctx.ellipse(-12, -6, 16, 26, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.ellipse(6, -50, 8, 4, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    bodyPath(ctx); ctx.stroke();
    // visor
    ctx.beginPath(); ctx.ellipse(7, -38, 12.5, 7.8, 0, 0, Math.PI * 2);
    var g = ctx.createLinearGradient(0, -46, 0, -30);
    g.addColorStop(0, '#d6f6ff'); g.addColorStop(0.45, '#8fcfe8'); g.addColorStop(1, '#3d7a99');
    ctx.fillStyle = g; ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.ellipse(11, -41, 5, 2.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawCrew(ctx, x, y, ci, o) {
    o = o || {};
    if (IS.render && typeof IS.render.drawCrewmate === 'function') {
      ctx.save();
      try { IS.render.drawCrewmate(ctx, x, y, ci, o); ctx.restore(); return; }
      catch (e) { ctx.restore(); }
    }
    fallbackCrew(ctx, x, y, ci, o);
  }
  // paint a square canvas with one crewmate filling it
  function paintCrew(cv, size, ci, o) {
    var ctx = sizeCanvas(cv, size, size);
    ctx.clearRect(0, 0, size, size);
    var s = size / 70;
    drawCrew(ctx, size / 2 + (o && o.dead ? 0 : -1 * s), size * 0.9, ci, Object.assign({ scale: s, facing: 1, noShadow: size < 30 }, o || {}));
  }
  // Crewmate avatar framed to fit hats: crew-space y from `top` (default: this hat's top) to the feet.
  function paintAvatar(cv, w, hh, ci, o) {
    o = o || {};
    var ctx = sizeCanvas(cv, w, hh);
    ctx.clearRect(0, 0, w, hh);
    var top = Math.min(-61, o.top != null ? o.top : hatTop(o.hat)) - 3, bot = 5;
    var s = Math.min(hh / (bot - top), w / 60, o.maxScale || 99);
    var d = Object.assign({ scale: s, facing: 1, noShadow: w < 30 }, o);
    delete d.top; delete d.maxScale;
    drawCrew(ctx, w / 2 - s, hh - bot * s, ci, d);
  }
  function avatarCanvas(w, hh, ci, o, cls) {
    var cv = h('canvas.crew-cv' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' });
    cv.style.width = w + 'px'; cv.style.height = hh + 'px';
    paintAvatar(cv, w, hh, ci, o);
    return cv;
  }
  // shared framing for a list of people so every avatar in it has the same scale
  function listTop(list) { var t = -58; (list || []).forEach(function (p) { t = Math.min(t, hatTop(p && p.hat)); }); return t; }
  function crewCanvas(size, ci, o, cls) {
    var cv = h('canvas.crew-cv' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' });
    cv.style.width = size + 'px'; cv.style.height = size + 'px';
    paintCrew(cv, size, ci, o);
    return cv;
  }

  // Lineup of crewmates (role reveal, game over). people: [{color,name,isMe,ghost}]
  function lineupBase(n, w, hAvail, nameSpace, head) {
    var spanK = Math.max(0, n - 1);
    head = head || 64;
    return Math.min((hAvail - nameSpace - 10) / head, 3, (w - 24) / (46 * spanK + 60), hAvail / (165 * head / 64));
  }
  function drawLineup(cv, people, o) {
    o = o || {};
    var w = cv.clientWidth, hh = cv.clientHeight;
    if (!w || !hh) return;
    var ctx = sizeCanvas(cv, w, hh);
    ctx.clearRect(0, 0, w, hh);
    var n = people.length;
    if (!n) return;
    var arr = people.slice().sort(function (a, b) { return (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0); });
    var nameSpace = o.names ? 26 : 6;
    o = Object.assign({}, o, { head: 64 + (-58 - listTop(people)) });
    var single = lineupBase(n, w, hh, nameSpace, o.head);
    if (n > 4 && single < 1.35 && hh > 240) {
      // two rows: back row (higher, slightly dimmer) then front row with me in the middle
      var nf = Math.ceil(n / 2);
      var front = arr.slice(0, nf), back = arr.slice(nf);
      var rowH = hh * 0.56;
      drawLineupRow(ctx, w, rowH, hh - rowH * 0.62, back, o, nameSpace, 0.12);
      drawLineupRow(ctx, w, rowH, hh - nameSpace - 6, front, o, nameSpace, 0);
    } else {
      drawLineupRow(ctx, w, hh, hh - nameSpace - 6, arr, o, nameSpace, 0);
    }
  }
  function drawLineupRow(ctx, w, hAvail, feetY, arr, o, nameSpace, dim) {
    var n = arr.length;
    if (!n) return;
    var slots = [];
    for (var i = 0; i < n; i++) slots.push({ p: arr[i], k: i === 0 ? 0 : (i % 2 ? -Math.ceil(i / 2) : Math.ceil(i / 2)) });
    var minK = 0, maxK = 0;
    slots.forEach(function (s) { minK = Math.min(minK, s.k); maxK = Math.max(maxK, s.k); });
    var spanK = maxK - minK;
    // fit height, and fit width: total extent = spanK*spacing + ~56*base, with spacing = 46*base
    var head = o.head || 64;
    var base = Math.min((hAvail - nameSpace - 10) / head, 3, (w - 24) / (46 * spanK + 60), hAvail / (165 * head / 64));
    var spacing = base * 46;
    var shift = -(minK + maxK) / 2 * spacing;
    slots.sort(function (a, b) { return Math.abs(b.k) - Math.abs(a.k); });
    for (var j = 0; j < slots.length; j++) {
      var sl = slots[j], ak = Math.abs(sl.k);
      var sc = base * (1 - 0.045 * ak);
      var x = w / 2 + shift + sl.k * spacing, y = feetY - ak * base * 3;
      ctx.save();
      try { ctx.filter = 'brightness(' + (1 - dim - 0.07 * ak).toFixed(2) + ')'; } catch (e) { /* unsupported */ }
      drawCrew(ctx, x, y, sl.p.color, { scale: sc, facing: sl.k > 0 ? -1 : 1, ghost: !!sl.p.ghost, hat: cleanHat(sl.p.hat) });
      ctx.restore();
      if (o.names && sl.p.name) {
        var fs = clamp(Math.round(Math.min(sc * 6, spacing * 0.26)), 9, 18);
        var maxCh = Math.max(3, Math.floor(spacing * 0.98 / (fs * 0.56)));
        ctx.font = '500 ' + fs + 'px Rubik, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.lineWidth = 4; ctx.strokeStyle = '#050814'; ctx.lineJoin = 'round';
        var label = sl.p.name.length > Math.min(12, maxCh) ? sl.p.name.slice(0, Math.min(12, maxCh) - 1) + '…' : sl.p.name;
        ctx.strokeText(label, x, y + 8); ctx.fillStyle = sl.p.isMe ? '#ffcc33' : '#ffffff'; ctx.fillText(label, x, y + 8);
      }
    }
  }

  // ------------------------------------------------------------------ starfield
  function Stars(cv, o) { this.cv = cv; this.o = o || {}; this.list = []; this.w = 0; this.h = 0; this.t = 0; this.fl = null; this.nextFl = 3; }
  Stars.prototype.fit = function () {
    var w = this.cv.clientWidth, hh = this.cv.clientHeight;
    if (!w || !hh) return false;
    if (w !== this.w || hh !== this.h || !this.ctx) {
      this.w = w; this.h = hh; this.ctx = sizeCanvas(this.cv, w, hh);
      if (!this.list.length) {
        var n = Math.min(560, Math.round(w * hh / 2400));
        for (var i = 0; i < n; i++) this.list.push({ x: Math.random(), y: Math.random(), z: 0.15 + Math.pow(Math.random(), 2) * 0.85, tw: Math.random() * 6.28, s: Math.random() });
      }
    }
    return true;
  };
  Stars.prototype.draw = function (dt) {
    if (!this.fit()) return;
    var ctx = this.ctx, w = this.w, hh = this.h, o = this.o;
    this.t += dt;
    ctx.clearRect(0, 0, w, hh);
    var vx = o.vx == null ? -0.01 : o.vx;
    for (var i = 0; i < this.list.length; i++) {
      var s = this.list[i];
      s.x += vx * s.z * dt;
      if (s.x < -0.01) s.x += 1.02; else if (s.x > 1.01) s.x -= 1.02;
      var a = (0.3 + 0.7 * s.z) * (0.72 + 0.28 * Math.sin(this.t * 2.2 + s.tw));
      var size = s.z * 2.1 + 0.5;
      ctx.globalAlpha = a;
      ctx.fillStyle = s.s > 0.94 ? '#ffd98a' : s.s > 0.87 ? '#a5ecff' : '#ffffff';
      if (o.streak) ctx.fillRect(s.x * w, s.y * hh, size + s.z * o.streak, Math.max(1, size * 0.6));
      else ctx.fillRect(s.x * w, s.y * hh, size, size);
    }
    ctx.globalAlpha = 1;
    if (o.floaters) {
      this.nextFl -= dt;
      if (!this.fl && this.nextFl <= 0) {
        this.fl = { x: -0.08, y: 0.15 + Math.random() * 0.6, vx: 0.022 + Math.random() * 0.015, vy: (Math.random() - 0.5) * 0.01, r: 0, vr: 0.5 + Math.random() * 0.6, c: (Math.random() * COLORS().length) | 0, s: 0.55 + Math.random() * 0.35, hat: Math.random() < 0.75 ? cleanHat(1 + Math.random() * (hatCount() - 1)) : 0 };
      }
      if (this.fl) {
        var f = this.fl;
        f.x += f.vx * dt; f.y += f.vy * dt; f.r += f.vr * dt;
        ctx.save(); ctx.translate(f.x * w, f.y * hh); ctx.rotate(f.r); ctx.globalAlpha = 0.85;
        drawCrew(ctx, 0, 28 * f.s, f.c, { scale: f.s, facing: 1, noShadow: true, hat: f.hat });
        ctx.restore();
        if (f.x > 1.1) { this.fl = null; this.nextFl = 10 + Math.random() * 8; }
      }
    }
  };

  // ------------------------------------------------------------------ press helper (pointer-first, keyboard-friendly)
  function press(el, fn) {
    var fired = 0;
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      el.classList.add('pressed');
      fired = Date.now();
      fn(e);
    });
    var up = function () { el.classList.remove('pressed'); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
    el.addEventListener('click', function (e) {
      if (e.detail === 0 && Date.now() - fired > 300) fn(e); // keyboard activation
    });
  }

  // ------------------------------------------------------------------ colour swatches
  function makeSwatches(onPick) {
    var wrap = h('div.swatches', { role: 'group', 'aria-label': 'Colour' });
    var btns = [];
    COLORS().forEach(function (c, i) {
      var b = h('button.swatch', { type: 'button', title: c[0], 'aria-label': c[0], 'aria-pressed': 'false' });
      var cv = h('canvas', { 'aria-hidden': 'true' });
      b.appendChild(cv);
      b.addEventListener('click', function () { if (!b.disabled) onPick(i); });
      btns.push({ b: b, cv: cv, drawn: 0 });
      wrap.appendChild(b);
    });
    var api = {
      el: wrap,
      set: function (sel, taken) {
        btns.forEach(function (o, i) {
          o.b.setAttribute('aria-pressed', i === sel ? 'true' : 'false');
          var dis = !!(taken && taken[i] && i !== sel);
          if (o.b.disabled !== dis) o.b.disabled = dis;
          o.b.title = COLORS()[i][0] + (dis ? ' (taken)' : '');
        });
      },
      paint: function () {
        btns.forEach(function (o, i) {
          var sz = Math.min(o.b.clientWidth, o.b.clientHeight);
          if (!sz) return;
          sz = Math.round(sz * 0.9);
          if (o.drawn === sz) return;
          o.drawn = sz;
          o.cv.style.width = sz + 'px'; o.cv.style.height = sz + 'px';
          paintCrew(o.cv, sz, i, {});
        });
      }
    };
    return api;
  }

  // ------------------------------------------------------------------ hat picker
  // Grid of mini crewmates (in the given colour) wearing every hat. Hats are not exclusive.
  var HAT_TOP = -99, HAT_BOT = -24;   // bust framing shared by every button: hat + head + upper body
  function makeHatPicker(onPick, cls) {
    var wrap = h('div.hat-grid' + (cls ? '.' + cls : ''), { role: 'group', 'aria-label': 'Hat' });
    var btns = [];
    var L = HATS() || [];
    L.forEach(function (hat, i) {
      var b = h('button.hat-btn', { type: 'button', title: hat.name, 'aria-label': hat.name, 'aria-pressed': 'false' });
      var cv = h('canvas', { 'aria-hidden': 'true' });
      b.appendChild(cv);
      b.addEventListener('click', function () { onPick(i); });
      btns.push({ b: b, cv: cv, drawn: '' });
      wrap.appendChild(b);
    });
    var api = {
      el: wrap, sel: -1, color: 0,
      set: function (sel) {
        sel = cleanHat(sel);
        if (api.sel === sel) return;
        api.sel = sel;
        btns.forEach(function (o, i) { o.b.setAttribute('aria-pressed', i === sel ? 'true' : 'false'); });
      },
      reveal: function () {   // keep the selected hat in view inside a scrolling grid
        var o = btns[api.sel];
        if (!o || wrap.scrollHeight <= wrap.clientHeight + 2) return;
        var top = o.b.offsetTop - wrap.offsetTop, bh = o.b.offsetHeight;
        if (top < wrap.scrollTop || top + bh > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = Math.max(0, top - (wrap.clientHeight - bh) / 2);
      },
      paint: function (color) {
        if (color != null) api.color = color | 0;
        btns.forEach(function (o, i) {
          var w = o.b.clientWidth, hh = o.b.clientHeight;
          if (!w || !hh) return;
          var key = w + 'x' + hh + '|' + api.color;
          if (o.drawn === key) return;
          o.drawn = key;
          o.cv.style.width = w + 'px'; o.cv.style.height = hh + 'px';
          var ctx = sizeCanvas(o.cv, w, hh);
          ctx.clearRect(0, 0, w, hh);
          var sc = Math.min((hh - 4) / (HAT_BOT - HAT_TOP), w / 62);
          drawCrew(ctx, w / 2 - sc * 1.5, hh - 2 - HAT_BOT * sc, api.color, { scale: sc, facing: 1, noShadow: true, hat: i, time: 1.3 });
        });
      }
    };
    return api;
  }
  function injectCss() {
    if (document.getElementById('ui-hats-css')) return;
    var css = [
      '.hat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(50px,1fr));gap:6px}',
      '.hat-grid.scroll{max-height:124px;overflow-y:auto;overflow-x:hidden;padding:4px 6px 4px 4px;margin:-4px -6px -4px -4px;touch-action:pan-y;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--line) transparent}',
      '.hat-btn{position:relative;aspect-ratio:1;min-width:0;padding:0;border:3px solid var(--outline);border-radius:12px;cursor:pointer;',
      '  background:radial-gradient(circle at 50% 30%,#2c3a6e,#141b36);box-shadow:0 3px 0 var(--outline);transition:transform .1s, box-shadow .1s;',
      '  display:block;overflow:hidden;pointer-events:auto}',
      '.hat-btn canvas{display:block;width:100%;height:100%}',
      '.hat-btn:hover{transform:translateY(-2px)}',
      '.hat-btn[aria-pressed="true"]{box-shadow:0 0 0 3px var(--amber), 0 3px 0 var(--outline);background:radial-gradient(circle at 50% 30%,#55497a,#241b40)}',
      '.hat-btn:first-child::after{content:"";position:absolute;right:4px;top:4px;width:12px;height:12px;border-radius:50%;border:2px solid var(--ink-3);',
      '  background:linear-gradient(135deg,transparent 43%,var(--ink-3) 43%,var(--ink-3) 57%,transparent 57%)}',
      '.field-label .hat-cur{margin-left:8px;font:500 13px var(--font-body);letter-spacing:0;text-transform:none;color:var(--amber)}',
      /* talking indicators */
      '.plist .av{position:relative;flex:none;display:block;border-radius:12px;transition:box-shadow .15s, background .15s}',
      '.plist .av canvas{display:block}',
      '.spk{position:absolute;right:-7px;bottom:-6px;width:21px;height:21px;border-radius:50%;background:var(--green);color:#002611;',
      '  border:2px solid var(--outline);display:none;place-items:center;pointer-events:none;z-index:2}',
      '.spk svg{width:13px;height:13px}',
      '.speaking > .spk,.speaking .av > .spk,.speaking .m-av > .spk{display:grid;animation:spkPulse .7s ease-in-out infinite alternate}',
      '.plist li.speaking .av,.m-card.speaking .m-crew{box-shadow:0 0 0 3px var(--green), 0 0 14px 4px rgba(62,224,122,.6);background:rgba(62,224,122,.16)}',
      '.plist li.speaking{border-color:rgba(62,224,122,.55)}',
      '.m-av{position:relative;flex:none;display:block}',
      '.m-av .spk{right:-6px;bottom:-4px}',
      '@keyframes spkPulse{from{transform:scale(.92)}to{transform:scale(1.12)}}',
      '@media (prefers-reduced-motion:reduce){.speaking > .spk,.speaking .av > .spk,.speaking .m-av > .spk{animation:none}}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'ui-hats-css'; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  function spkBadge() { return h('span.spk', { 'aria-hidden': 'true', html: ICON.soundOn }); }

  // ------------------------------------------------------------------ mute
  var muteBtns = [];
  function makeMuteBtn(cls) {
    var b = h('button.icon-btn' + (cls ? '.' + cls : ''), { type: 'button' });
    b.addEventListener('click', function () { setMuted(!S.muted); });
    muteBtns.push(b);
    syncMute();
    return b;
  }
  function setMuted(m) {
    S.muted = !!m;
    lsSet('ss_muted', S.muted ? '1' : '0');
    if (!fire('onMute', S.muted)) { try { if (IS.audio && IS.audio.setMuted) IS.audio.setMuted(S.muted); } catch (e) { /* ignore */ } }
    if (!S.muted) { unlockAudio(); sfx('click'); }
    syncMute();
  }
  function syncMute() {
    muteBtns.forEach(function (b) {
      b.innerHTML = S.muted ? ICON.soundOff : ICON.soundOn;
      b.setAttribute('aria-label', S.muted ? 'Unmute sound' : 'Mute sound');
      b.title = S.muted ? 'Unmute' : 'Mute';
      b.setAttribute('aria-pressed', S.muted ? 'true' : 'false');
    });
  }

  // ================================================================== MENU
  function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14); }
  function currentName() {
    var n = cleanName(E.nameIn ? E.nameIn.value : S.name);
    if (!n) {
      n = FUN_NAMES[(Math.random() * FUN_NAMES.length) | 0] + ((Math.random() * 90 + 10) | 0);
      if (E.nameIn) E.nameIn.value = n;
    }
    S.name = n; lsSet('ss_name', n);
    return n;
  }
  function filterCode(v) {
    var A = alphabet(), out = '';
    v = String(v || '').toUpperCase();
    for (var i = 0; i < v.length && out.length < 4; i++) if (A.indexOf(v.charAt(i)) >= 0) out += v.charAt(i);
    return out;
  }
  function menuBusy(ms) {
    S.menuBusy = true; syncMenuButtons();
    later('menuBusy', ms || 2000, function () { S.menuBusy = false; syncMenuButtons(); });
  }
  function syncMenuButtons() {
    var off = S.mode === 'offline';
    if (E.hostBtn) E.hostBtn.disabled = off || !!S.menuBusy;
    if (E.joinBtn) E.joinBtn.disabled = off || !!S.menuBusy || filterCode(E.codeIn.value).length !== 4;
    if (E.codeIn) E.codeIn.disabled = off;
    if (E.freeBtn) { E.freeBtn.disabled = !!S.menuBusy; E.freeBtn.classList.toggle('ui-btn--dark', !off); }
  }
  function doHost() { if (E.hostBtn.disabled) return; sfx('click'); unlockAudio(); var n = currentName(); menuBusy(); fire('onCreate', { name: n, color: S.color, hat: S.hat }); }
  function doJoin(code) {
    code = filterCode(code != null ? code : E.codeIn.value);
    if (code.length !== 4) { toast('Enter the 4-letter game code'); E.codeIn.focus(); return; }
    if (S.mode === 'offline') { toast('Offline — only Freeplay is available'); return; }
    sfx('click'); unlockAudio();
    var n = currentName(); menuBusy();
    fire('onJoin', { code: code, name: n, color: S.color, hat: S.hat });
  }
  function doFree() { sfx('click'); unlockAudio(); var n = currentName(); menuBusy(); fire('onFreeplay', { name: n, color: S.color, hat: S.hat }); }
  function pickMenuColor(i) {
    S.color = i; S.myColor = i; lsSet('ss_color', i);
    E.menuSw.set(i, null);
    paintHero();
    if (E.menuHats) E.menuHats.paint(i);
    sfx('click');
  }
  function setMyHat(i) {
    S.hat = cleanHat(i); S.hatAt = Date.now();
    lsSet('ss_hat', S.hat);
    if (E.menuHats) E.menuHats.set(S.hat);
    if (E.lobbyHats) E.lobbyHats.set(S.hat);
    txt(E.menuHatCur, hatName(S.hat));
    txt(E.lobbyHatCur, hatName(S.hat));
  }
  function pickMenuHat(i) {
    setMyHat(i);
    paintHero();
    sfx('click');
  }
  function paintHero() {
    if (!E.heroCv) return;
    var sz = E.heroCv.clientWidth || 190;
    var ctx = sizeCanvas(E.heroCv, sz, sz);
    ctx.clearRect(0, 0, sz, sz);
    var top = hatTop(S.hat) - 3, s = Math.min(sz / 72, sz / (6 - top));
    drawCrew(ctx, sz * 0.5, Math.min(sz * 0.9, sz - 6 * s), S.color, { scale: s, facing: 1, hat: S.hat });
  }
  function makeHowto(cls) {
    return h('section.ui-card.howto' + (cls ? '.' + cls : ''), { 'aria-label': 'How to play' }, [
      h('h2.card-title', { text: 'How to play' }),
      h('div.howto-roles', null, [
        h('div.howto-role.crew', null, [h('b', { text: 'Crewmates' }), 'Finish your tasks around the ship and vote out the Impostors.']),
        h('div.howto-role.imp', null, [h('b', { text: 'Impostors' }), 'Blend in, sabotage the ship and eliminate the crew.'])
      ]),
      h('div.keys', null, [
        h('span', null, [h('kbd', { text: 'WASD' }), 'Move']),
        h('span', null, [h('kbd', { text: 'E' }), 'Use']),
        h('span', null, [h('kbd', { text: 'Q' }), 'Kill']),
        h('span', null, [h('kbd', { text: 'R' }), 'Report']),
        h('span', null, [h('kbd', { text: 'V' }), 'Vent']),
        h('span', null, [h('kbd', { text: 'Tab' }), 'Map']),
        h('span.touch-note', { text: 'On touch screens: drag the joystick to move and tap the action buttons.' })
      ])
    ]);
  }
  function buildMenu() {
    var scr = h('section.screen.scr-menu', { 'aria-label': 'Main menu' });
    E.menuStarsCv = h('canvas.stars-cv', { 'aria-hidden': 'true' });
    E.menuStars = new Stars(E.menuStarsCv, { vx: -0.006, floaters: true });
    scr.appendChild(E.menuStarsCv);
    scr.appendChild(h('div.menu-planet.p1')); scr.appendChild(h('div.menu-planet.p2'));
    var scroll = h('div.menu-scroll');
    var wrap = h('div.menu-wrap');

    // hero
    E.heroCv = h('canvas.logo-crew', { 'aria-hidden': 'true' });
    E.status = h('div.status', { role: 'status' }, [h('span.dot'), E.statusTxt = h('span', { text: 'Connecting to the ship…' })]);
    var hero = h('div.menu-hero', null, [
      h('div.logo', null, [E.heroCv, h('h1.logo-text', { 'aria-label': 'Starship Sus' }, [h('span.l1', { text: 'Starship' }), h('span.l2', { text: 'Sus' })])]),
      h('p.logo-tag', { text: 'Find the Impostor before it’s too late. 3–10 players, right in your browser.' }),
      E.status,
      makeHowto()
    ]);

    // main card
    E.nameIn = h('input.ui-input#ui-name', { type: 'text', maxlength: '14', placeholder: 'Your name', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done' });
    E.nameIn.value = S.name;
    E.nameIn.addEventListener('input', function () { var v = cleanName(E.nameIn.value); if (v) { S.name = v; lsSet('ss_name', v); } });
    E.nameIn.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') E.nameIn.blur(); });
    E.menuSw = makeSwatches(pickMenuColor);
    E.menuHats = makeHatPicker(pickMenuHat, 'scroll');
    E.menuHatCur = h('span.hat-cur', { text: hatName(S.hat) });
    E.hostBtn = h('button.ui-btn.ui-btn--big.ui-btn--block', { type: 'button', html: ICON.rocket + '<span>Host Game</span>' });
    E.hostBtn.addEventListener('click', doHost);
    E.codeIn = h('input.ui-input', { type: 'text', placeholder: 'CODE', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Game code', enterkeyhint: 'go', inputmode: 'text' });
    E.codeIn.addEventListener('input', function () {
      var v = filterCode(E.codeIn.value);
      if (E.codeIn.value !== v) E.codeIn.value = v;
      syncMenuButtons();
    });
    E.codeIn.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') doJoin(); if (e.key === 'Escape') E.codeIn.blur(); });
    E.joinBtn = h('button.ui-btn.ui-btn--cyan', { type: 'button', html: ICON.join + '<span>Join</span>' });
    E.joinBtn.addEventListener('click', function () { doJoin(); });
    E.freeBtn = h('button.ui-btn.ui-btn--dark.ui-btn--block', { type: 'button', html: ICON.play + '<span>Freeplay</span>' });
    E.freeBtn.title = 'Practice solo: explore the ship and try every task';
    E.freeBtn.addEventListener('click', doFree);
    E.gamesList = h('div.games', { role: 'list' });
    E.gamesNote = h('small', { text: '' });
    var main = h('section.ui-card.menu-main', { 'aria-label': 'Play' }, [
      h('div', null, [h('label.field-label', { for: 'ui-name', text: 'Your name' }), E.nameIn]),
      h('div', null, [h('span.field-label', { text: 'Colour' }), E.menuSw.el]),
      HATS() ? h('div.hat-sec', null, [h('span.field-label', null, ['Hat', E.menuHatCur]), E.menuHats.el]) : null,
      E.hostBtn,
      h('div', null, [h('span.field-label', { text: 'Have a code?' }), h('div.join-row', null, [E.codeIn, E.joinBtn])]),
      h('div.or-sep', { text: 'OR' }),
      E.freeBtn,
      h('div', null, [h('div.games-head', null, [h('span.field-label', { text: 'Open games', style: 'margin:0' }), E.gamesNote]), E.gamesList])
    ]);
    wrap.appendChild(hero); wrap.appendChild(main); wrap.appendChild(makeHowto('howto-m'));
    scroll.appendChild(wrap);
    scr.appendChild(scroll);
    var mb = makeMuteBtn('menu-mute');
    scr.appendChild(mb);
    E.menu = scr;
    renderGames();
    return scr;
  }
  function renderGames() {
    if (!E.gamesList) return;
    var list = S.games || [];
    var sig = S.mode + '|' + JSON.stringify(list);
    if (sig === S.gamesSig) return;
    S.gamesSig = sig;
    E.gamesList.textContent = '';
    if (S.mode === 'offline') {
      E.gamesList.appendChild(h('div.games-empty', { text: 'You’re offline — Freeplay is still available.' }));
      txt(E.gamesNote, '');
      return;
    }
    if (!list.length) {
      E.gamesList.appendChild(h('div.games-empty', { text: 'No open games right now — host one and share the code.' }));
      txt(E.gamesNote, '');
      return;
    }
    txt(E.gamesNote, list.length + (list.length === 1 ? ' game' : ' games'));
    list.forEach(function (g) {
      var max = g.max || maxPlayers();
      var full = (g.count | 0) >= max;
      var inGame = g.phase && g.phase !== 'lobby';
      var chip = full ? h('span.chip.full', { text: 'Full' }) : inGame ? h('span.chip.busy', { text: 'In game' }) : h('span.chip', { text: 'Lobby' });
      var b = h('button.game-row', { type: 'button', role: 'listitem', 'aria-label': 'Join game ' + g.code + ' hosted by ' + (g.host || 'someone') }, [
        h('span.g-code', { text: g.code || '????' }),
        h('span.g-host', null, [h('span.hb', { text: 'Hosted by ' }), h('b', { text: g.host || 'Someone' })]),
        h('span.g-count', { text: (g.count | 0) + '/' + max }),
        chip
      ]);
      if (full) b.disabled = true;
      b.addEventListener('click', function () { if (E.codeIn) { E.codeIn.value = g.code; syncMenuButtons(); } doJoin(g.code); });
      E.gamesList.appendChild(b);
    });
  }

  // ================================================================== LOBBY
  var SETTING_DEFS = [
    { k: 'map', label: 'Map', type: 'seg', opts: null },
    { k: 'imp', label: 'Impostors', step: 1, fmt: function (v) { return String(v); } },
    { k: 'kcd', label: 'Kill cooldown', step: 2.5, fmt: function (v) { return v + 's'; } },
    { k: 'kd', label: 'Kill distance', type: 'seg', opts: ['Short', 'Medium', 'Long'] },
    { k: 'spd', label: 'Player speed', step: 0.25, fmt: function (v) { return v + 'x'; } },
    { k: 'cvis', label: 'Crewmate vision', step: 0.25, fmt: function (v) { return v + 'x'; } },
    { k: 'ivis', label: 'Impostor vision', step: 0.25, fmt: function (v) { return v + 'x'; } },
    { k: 'dis', label: 'Discussion time', step: 5, fmt: function (v) { return v + 's'; } },
    { k: 'vot', label: 'Voting time', step: 15, fmt: function (v) { return v + 's'; } },
    { k: 'emg', label: 'Emergency meetings', step: 1, fmt: function (v) { return String(v); } },
    { k: 'nt', label: 'Tasks per player', step: 1, fmt: function (v) { return String(v); } },
    { k: 'conf', label: 'Confirm ejects', type: 'toggle' }
  ];
  function limits(k) {
    var L = CFG().SETTINGS_LIMITS || {};
    var d = { imp: [1, 3], kcd: [10, 60], spd: [0.5, 2], cvis: [0.25, 2], ivis: [0.25, 2.5], dis: [0, 60], vot: [15, 120], emg: [0, 3], nt: [1, 10], conf: [0, 1], kd: [0, 2] };
    return L[k] || d[k] || [0, 100];
  }
  function fullSettings(st) { return Object.assign({}, CFG().DEFAULT_SETTINGS || DEFAULT_SETTINGS, st || {}); }
  function shownSettings() {
    var st = fullSettings(S.lobby && S.lobby.settings);
    if (S.localSet && Date.now() - S.localSetAt < 1500) st = Object.assign({}, st, S.localSet);
    return st;
  }
  function changeSetting(k, v) {
    if (!S.lobby || !S.lobby.isHost) return;
    var st = shownSettings();
    st[k] = v;
    S.localSet = st; S.localSetAt = Date.now();
    renderSettings();
    sfx('click');
    fire('onSettings', st);
  }
  function mapOpts() {
    var L = IS.map && IS.map.list ? IS.map.list() : [];
    return L.length ? L.map(function (m) { return m.short || m.name; }) : ['Starship'];
  }
  function buildSettings() {
    var list = h('div.set-list');
    SETTING_DEFS[0].opts = mapOpts();
    S.setRows = {};
    SETTING_DEFS.forEach(function (d) {
      var ro = h('span.set-ro');
      var ctl = h('div.set-ctl');
      var row = { d: d, ro: ro };
      if (d.type === 'seg') {
        var seg = h('div.seg', { role: 'group', 'aria-label': d.label });
        row.segBtns = d.opts.map(function (lab, i) {
          var b = h('button', { type: 'button', text: lab, 'aria-pressed': 'false' });
          b.addEventListener('click', function () { changeSetting(d.k, i); });
          seg.appendChild(b);
          return b;
        });
        ctl.appendChild(seg);
      } else if (d.type === 'toggle') {
        var sw = h('button.switch', { type: 'button', role: 'switch', 'aria-label': d.label, 'aria-pressed': 'false' });
        sw.addEventListener('click', function () { changeSetting(d.k, shownSettings()[d.k] ? 0 : 1); });
        row.sw = sw; ctl.appendChild(sw);
      } else {
        var minus = h('button.step', { type: 'button', text: '−', 'aria-label': 'Decrease ' + d.label });
        var plus = h('button.step', { type: 'button', text: '+', 'aria-label': 'Increase ' + d.label });
        var val = h('span.set-val');
        var bump = function (dir) {
          var L = limits(d.k), cur = Number(shownSettings()[d.k]) || 0;
          var nv = clamp(Math.round((cur + dir * d.step) / d.step) * d.step, L[0], L[1]);
          nv = parseFloat(nv.toFixed(2));
          if (nv !== cur) changeSetting(d.k, nv);
        };
        minus.addEventListener('click', function () { bump(-1); });
        plus.addEventListener('click', function () { bump(1); });
        row.minus = minus; row.plus = plus; row.val = val;
        ctl.appendChild(minus); ctl.appendChild(val); ctl.appendChild(plus);
      }
      list.appendChild(h('div.set-row', null, [h('span.set-lbl', { text: d.label }), ro, ctl]));
      S.setRows[d.k] = row;
    });
    return list;
  }
  function renderSettings() {
    if (!S.setRows) return;
    var st = shownSettings();
    SETTING_DEFS.forEach(function (d) {
      var r = S.setRows[d.k], v = st[d.k];
      if (d.type === 'seg') {
        txt(r.ro, d.opts[clamp(v | 0, 0, d.opts.length - 1)]);
        r.segBtns.forEach(function (b, i) { b.setAttribute('aria-pressed', i === (v | 0) ? 'true' : 'false'); });
      } else if (d.type === 'toggle') {
        txt(r.ro, v ? 'On' : 'Off');
        r.sw.setAttribute('aria-pressed', v ? 'true' : 'false');
      } else {
        var n = parseFloat(Number(v).toFixed(2));
        txt(r.ro, d.fmt(n)); txt(r.val, d.fmt(n));
        var L = limits(d.k);
        r.minus.disabled = n <= L[0]; r.plus.disabled = n >= L[1];
      }
    });
  }
  function setPanelOpen(open) {
    S.panelOpen = !!open;
    E.lpanel.classList.toggle('closed', !S.panelOpen);
    E.panelBtn.setAttribute('aria-expanded', S.panelOpen ? 'true' : 'false');
    if (S.panelOpen) requestAnimationFrame(paintLobbyPickers);
  }
  function paintLobbyPickers() {
    E.lobbySw.paint();
    if (E.lobbyHats) { E.lobbyHats.paint(S.myColor); }
  }
  function setPanelTab(t) {
    S.panelTab = t;
    E.tabPlayers.setAttribute('aria-selected', t === 'players' ? 'true' : 'false');
    E.tabSettings.setAttribute('aria-selected', t === 'settings' ? 'true' : 'false');
    show(E.secPlayers, t === 'players');
    show(E.secSettings, t === 'settings');
    if (t === 'players') requestAnimationFrame(paintLobbyPickers);
  }
  function selectText(el) {
    try { var r = document.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* ignore */ }
  }
  function copyCode() {
    var code = (S.lobby && S.lobby.code) || '';
    if (!code) return;
    sfx('click');
    var fallback = function () {
      selectText(E.codeVal);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      toast(ok ? 'Code ' + code + ' copied' : 'Code selected — press Ctrl+C (or long-press) to copy');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () { toast('Code ' + code + ' copied — share it with your friends!'); }, fallback);
        return;
      }
    } catch (e) { /* fall through */ }
    fallback();
  }
  function buildLobby() {
    var scr = h('section.screen.scr-lobby', { 'aria-label': 'Lobby' });
    var leave = h('button.ui-btn.ui-btn--dark.lobby-leave', { type: 'button', 'aria-label': 'Leave lobby', html: ICON.leave + '<span>Leave</span>' });
    leave.addEventListener('click', function () { sfx('click'); fire('onLeave'); });
    E.codeVal = h('span.code-val', { text: '----' });
    E.modeChip = h('span.mode-chip', null, [h('i'), E.modeTxt = h('span', { text: 'Online' })]);
    var copy = h('button.icon-btn.icon-btn--sm', { type: 'button', 'aria-label': 'Copy game code', title: 'Copy code', html: ICON.copy });
    copy.addEventListener('click', copyCode);
    var codeCard = h('div.ui-card.code-card', null, [
      h('div.code-meta', null, [h('span.code-label', { text: 'Game code' }), E.codeVal, E.modeChip]),
      copy
    ]);
    E.panelBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Players and settings', title: 'Players & settings', 'aria-expanded': 'false', html: ICON.players });
    E.pcount = h('span.badge', { text: '1', style: 'background:var(--cyan);color:#00222e' });
    E.panelBtn.appendChild(E.pcount);
    E.panelBtn.addEventListener('click', function () { sfx('click'); setPanelOpen(!S.panelOpen); });
    var top = h('div.lobby-top', null, [
      h('div.top-group.l', null, [leave]),
      codeCard,
      h('div.top-group.r', null, [makeMuteBtn('mute-btn'), E.panelBtn])
    ]);

    // side panel
    E.plist = h('ul.plist');
    E.lobbySw = makeSwatches(function (i) {
      sfx('click');
      S.myColor = i; S.color = i; lsSet('ss_color', i);
      if (S.lobbyTaken) E.lobbySw.set(i, S.lobbyTaken);
      E.lobbyHats.paint(i);
      fire('onColor', i);
    });
    E.lobbyHats = makeHatPicker(function (i) {
      sfx('click');
      setMyHat(i);
      fire('onHat', S.hat);
      if (S.lobby) updateLobby(S.lobby);
    });
    E.lobbyHatCur = h('span.hat-cur', { text: hatName(S.hat) });
    E.tabPlayers = h('button.panel-tab', { type: 'button', role: 'tab', text: 'Players' });
    E.tabSettings = h('button.panel-tab', { type: 'button', role: 'tab', text: 'Settings' });
    E.tabPlayers.addEventListener('click', function () { setPanelTab('players'); });
    E.tabSettings.addEventListener('click', function () { setPanelTab('settings'); });
    E.plHead = h('span.field-label', { text: 'Crew (1/10)' });
    E.secPlayers = h('div', null, [
      h('div.panel-sec', null, [E.plHead, E.plist]),
      h('div.panel-sec', null, [h('span.field-label', { text: 'Your colour' }), E.lobbySw.el]),
      HATS() ? h('div.panel-sec.hat-sec', null, [h('span.field-label', null, ['Your hat', E.lobbyHatCur]), E.lobbyHats.el]) : null
    ]);
    E.setNote = h('p.set-note', { text: 'Only the host can change these settings.' });
    E.secSettings = h('div', null, [buildSettings(), E.setNote]);
    E.lpanel = h('aside.ui-card.lobby-panel.closed.ro', { 'aria-label': 'Players and settings' }, [
      h('div.panel-tabs', { role: 'tablist' }, [E.tabPlayers, E.tabSettings]),
      h('div.panel-body', null, [E.secPlayers, E.secSettings])
    ]);

    // bottom
    E.startBtn = h('button.ui-btn.ui-btn--green.ui-btn--big.start-btn', { type: 'button', html: ICON.play + '<span>Start</span>' });
    E.startBtn.addEventListener('click', function () { if (E.startBtn.disabled) return; sfx('click'); fire('onStart'); });
    E.startHint = h('span.start-hint', { text: 'Need at least ' + minPlayers() + ' players' });
    E.startWrap = h('div.lobby-bottom', null, [E.startHint, E.startBtn]);
    E.waitPill = h('div.wait-pill', null, ['Waiting for host to start', h('span.dots')]);
    E.lobbyHint = h('div.lobby-hint', { text: 'Walk around while you wait — share the code to invite friends' });

    scr.appendChild(top); scr.appendChild(E.lpanel); scr.appendChild(E.startWrap); scr.appendChild(E.waitPill); scr.appendChild(E.lobbyHint);
    E.lobby = scr;
    setPanelTab('players');
    renderSettings();
    return scr;
  }
  function updateLobby(d) {
    d = d || {};
    S.lobby = d;
    if (!E.lobby) return;
    var players = d.players || [];
    var me = null;
    var recentHat = Date.now() - S.hatAt < 1500;
    for (var i = 0; i < players.length; i++) if (players[i].isMe) me = players[i];
    if (me) {
      if (S.myColor !== me.color && E.lobbyHats) E.lobbyHats.paint(me.color);
      S.myColor = me.color;
      // my own hat: show the local choice right away (presence round-trip lags a little)
      if (recentHat || me.hat == null) players = players.map(function (p) { return p.isMe ? Object.assign({}, p, { hat: S.hat }) : p; });
    }
    if (E.lobbyHats) E.lobbyHats.set(S.hat);
    txt(E.codeVal, d.code || '----');
    var st = fullSettings(d.settings);
    var mode = st.free ? 'free' : (d.mode || S.mode || 'room');
    E.modeChip.className = 'mode-chip ' + mode;
    txt(E.modeTxt, mode === 'free' ? 'Freeplay' : mode === 'local' ? 'Local (this browser)' : 'Online');

    // rebuild rows only when something other than the talking state changes
    var psig = JSON.stringify(players.map(function (p) { return [p.slot, p.name, p.color, cleanHat(p.hat), !!p.isMe, !!p.isHost]; }));
    if (psig !== S.lobbySigs.players) {
      S.lobbySigs.players = psig;
      E.plist.textContent = '';
      E.plRows = [];
      var top = listTop(players);
      players.forEach(function (p) {
        var li = h('li' + (p.isMe ? '.me' : ''), null, [
          h('span.av', null, [avatarCanvas(44, 50, p.color, { hat: cleanHat(p.hat), top: top }), spkBadge()]),
          h('span.pn', null, [p.name || 'Player', p.isMe ? h('small', { text: '(you)' }) : null]),
          p.isHost ? h('span.crown', { title: 'Host', html: ICON.crown }) : null
        ]);
        E.plRows.push(li);
        E.plist.appendChild(li);
      });
      txt(E.pcount, String(players.length));
      txt(E.plHead, 'Crew (' + players.length + '/' + maxPlayers() + ')');
    }
    players.forEach(function (p, k) {
      var li = E.plRows && E.plRows[k];
      if (!li) return;
      var on = !!p.speaking;
      if (li.classList.contains('speaking') !== on) li.classList.toggle('speaking', on);
    });
    var taken = {};
    players.forEach(function (p) { if (!p.isMe) taken[p.color] = true; });
    S.lobbyTaken = taken;
    E.lobbySw.set(me ? me.color : S.myColor, taken);

    E.lpanel.classList.toggle('ro', !d.isHost);
    txt(E.setNote, d.isHost ? 'You are the host — changes apply to everyone.' : 'Only the host can change these settings.');
    if (S.localSet && d.settings && JSON.stringify(fullSettings(d.settings)) === JSON.stringify(fullSettings(S.localSet))) S.localSet = null;
    renderSettings();

    show(E.startWrap, !!d.isHost);
    show(E.waitPill, !d.isHost);
    E.startBtn.disabled = !d.canStart;
    show(E.startHint, !d.canStart);
    txt(E.startHint, 'Need at least ' + minPlayers() + ' players');
  }

  // ================================================================== HUD
  var ACTS = [
    { k: 'sabotage', label: 'Sabotage', icon: 'sabotage' },
    { k: 'vent', label: 'Vent', icon: 'vent' },
    { k: 'map', label: 'Map', icon: 'map' },
    { k: 'report', label: 'Report', icon: 'report' },
    { k: 'kill', label: 'Kill', icon: 'kill' },
    { k: 'use', label: 'Use', icon: 'use' }
  ];
  function onAct(k) {
    var b = S.hud && S.hud.buttons ? S.hud.buttons[k] : null;
    if (k !== 'map' && !(b && b.on)) return;
    switch (k) {
      case 'use': fire('onUse'); break;
      case 'report': fire('onReport'); break;
      case 'kill': fire('onKill'); break;
      case 'vent': fire('onVent'); break;
      case 'sabotage': showSabotageMenu(!S.sabOpen); break;
      case 'map': if (!fire('onMap')) showMap(!S.mapOpen); break;
    }
  }
  function buildHud() {
    var scr = h('section.screen.scr-game', { 'aria-label': 'Game HUD' });
    E.sabFlash = h('div.sab-flash.is-hidden', { 'aria-hidden': 'true' });
    scr.appendChild(E.sabFlash);

    E.progFill = h('div.fill');
    E.progPct = h('span', { text: '0%' });
    E.progress = h('div.progress', { role: 'progressbar', 'aria-label': 'Total tasks completed', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [
      h('div.lbl', null, [h('span', { text: 'Total tasks completed' }), E.progPct]),
      h('div.bar', null, [E.progFill])
    ]);
    E.sabBanner = h('div.sab-banner.is-hidden', { role: 'alert' }, [h('span', { html: ICON.sabotage, style: 'display:inline-flex' }), E.sabTxt = h('span'), E.sabT = h('span.t')]);
    E.ghostHint = h('div.ghost-hint.is-hidden', { text: '' });
    E.alerts = h('div.hud-alerts', null, [E.sabBanner, E.ghostHint]);
    E.tasksTitle = h('span', { text: 'Tasks' });
    E.tasksCnt = h('span.cnt');
    E.tasksHead = h('button.tasks-head', { type: 'button', 'aria-expanded': 'true' }, [h('span.chev', { html: ICON.chev }), E.tasksTitle, E.tasksCnt]);
    E.tasksHead.addEventListener('click', function () { S.tasksCollapsed = !S.tasksCollapsed; syncTasksCollapsed(); });
    E.tasksNote = h('p.tasks-note.is-hidden');
    E.tlist = h('ul.tlist');
    E.tasks = h('div.tasks', null, [E.tasksHead, h('div.tasks-body', null, [E.tasksNote, E.tlist])]);
    scr.appendChild(h('div.hud-tl', null, [E.progress, E.alerts, E.tasks]));

    // top right
    E.freeChip = h('span.free-chip.is-hidden', { text: 'Freeplay' });
    E.exitBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Leave game', title: 'Leave game', html: ICON.leave });
    var stay = h('button.ui-btn.ui-btn--dark.ui-btn--sm', { type: 'button', text: 'Stay' });
    var go = h('button.ui-btn.ui-btn--red.ui-btn--sm', { type: 'button', text: 'Leave' });
    E.exitPop = h('div.ui-card.confirm-pop.is-hidden', { role: 'dialog', 'aria-label': 'Leave game?' }, [h('p', { text: 'Leave this game?' }), h('div.row', null, [stay, go])]);
    E.exitBtn.addEventListener('click', function () { show(E.exitPop, E.exitPop.classList.contains('is-hidden')); });
    stay.addEventListener('click', function () { show(E.exitPop, false); });
    go.addEventListener('click', function () { show(E.exitPop, false); fire('onLeave'); });
    var tr = h('div.hud-tr', null, [E.freeChip, makeMuteBtn(), h('div', { style: 'position:relative' }, [E.exitBtn, E.exitPop])]);
    scr.appendChild(tr);

    // actions
    E.acts = {};
    var grid = h('div.hud-actions', { role: 'toolbar', 'aria-label': 'Actions' });
    ACTS.forEach(function (a) {
      var b = h('button.act.act--' + a.k + '.off', { type: 'button', 'aria-label': a.label, 'aria-disabled': 'true' }, [
        h('span.act-ic', { html: ICON[a.icon] }), h('span.act-lbl', { text: a.label }), h('span.act-cd')
      ]);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // never steal focus from the game
      press(b, function () { onAct(a.k); });
      E.acts[a.k] = { b: b, lbl: b.querySelector('.act-lbl'), cd: b.querySelector('.act-cd') };
      grid.appendChild(b);
    });
    scr.appendChild(grid);
    E.hud = scr;
    syncTasksCollapsed();
    return scr;
  }
  function syncTasksCollapsed() {
    E.tasks.classList.toggle('collapsed', !!S.tasksCollapsed);
    E.tasksHead.setAttribute('aria-expanded', S.tasksCollapsed ? 'false' : 'true');
  }
  var SAB_TEXT = { reactor: 'Reactor meltdown', o2: 'Oxygen depleted', lights: 'Lights sabotaged', comms: 'Comms sabotaged' };
  function updateHud(d) {
    d = d || {};
    S.hud = d;
    if (!E.hud) return;
    var imp = isImp(d.role), alive = d.alive !== false;
    E.hud.classList.toggle('imp', imp);

    // progress
    var pct = Math.round(clamp(Number(d.progress) || 0, 0, 1) * 100);
    E.progress.classList.toggle('hidden', !!d.hidden);
    E.progFill.style.width = pct + '%';
    txt(E.progPct, d.hidden ? '??' : pct + '%');
    E.progress.setAttribute('aria-valuenow', d.hidden ? '0' : String(pct));

    // tasks
    var tasks = d.tasks || [];
    var tsig = JSON.stringify([tasks, imp, !!d.hidden, !!d.freeplay]);
    if (tsig !== S.hudSigs.tasks) {
      S.hudSigs.tasks = tsig;
      E.tasks.classList.toggle('imp', imp);
      txt(E.tasksTitle, imp ? 'Fake tasks' : 'Tasks');
      E.tlist.textContent = '';
      var done = 0;
      if (d.hidden) {
        E.tasksNote.className = 'tasks-note comms';
        txt(E.tasksNote, 'Comms Sabotaged');
        txt(E.tasksCnt, '?/?');
      } else {
        E.tasksNote.className = 'tasks-note' + (imp ? '' : ' is-hidden');
        txt(E.tasksNote, 'Sabotage and kill everyone.');
        tasks.forEach(function (t) {
          if (t.done) done++;
          E.tlist.appendChild(h('li' + (t.done ? '.done' : ''), null, [h('span', null, [t.room ? h('span.room', { text: t.room + ': ' }) : null, t.name || 'Task'])]));
        });
        txt(E.tasksCnt, imp ? '' : done + '/' + tasks.length);
        if (!tasks.length && !imp) E.tlist.appendChild(h('li', { text: 'No tasks', style: 'opacity:.6' }));
      }
    }

    // ghost / spectator hint
    var hint = '';
    if (d.spectator) hint = 'Spectating — you joined while a game was running';
    else if (!alive) hint = imp ? 'You are a ghost — you can still sabotage' : 'You are a ghost — finish your tasks to help your team';
    txt(E.ghostHint, hint);
    show(E.ghostHint, !!hint);
    show(E.freeChip, !!d.freeplay);

    // sabotage alert
    var sb = d.sabotage;
    if (sb && sb.k) {
      var crit = sb.remain != null && (sb.k === 'reactor' || sb.k === 'o2');
      txt(E.sabTxt, SAB_TEXT[sb.k] || 'Sabotage!');
      txt(E.sabT, crit ? Math.max(0, Math.ceil(sb.remain)) + 's' : '');
      show(E.sabT, crit);
      E.sabBanner.className = 'sab-banner ' + (crit ? 'crit' : 'soft');
      show(E.sabFlash, crit);
    } else {
      show(E.sabBanner, false);
      show(E.sabFlash, false);
    }

    // buttons
    var B = d.buttons || {};
    ACTS.forEach(function (a) {
      var o = B[a.k] || {}, el = E.acts[a.k];
      var vis;
      if (o.show != null) vis = !!o.show;
      else if (a.k === 'kill' || a.k === 'vent') vis = imp && alive;
      else if (a.k === 'sabotage') vis = imp;
      else if (a.k === 'report') vis = alive && !d.spectator;
      else if (a.k === 'use') vis = !d.spectator;
      else vis = true;
      if (a.k === 'report' && !alive) vis = false;
      show(el.b, vis);
      var on = a.k === 'map' ? o.on !== false : !!o.on;
      el.b.classList.toggle('off', !on);
      el.b.setAttribute('aria-disabled', on ? 'false' : 'true');
      el.b.classList.toggle('ready', on && (a.k === 'kill' || a.k === 'report'));
      var cd = Math.ceil(Number(o.cd) || 0);
      var cooling = (a.k === 'kill' || a.k === 'sabotage') && cd > 0;
      el.b.classList.toggle('cooling', cooling);
      txt(el.cd, cooling ? String(cd) : '');
      if (a.k === 'use') {
        var lab = (o.label || 'Use');
        lab = lab.length > 9 ? lab.slice(0, 9) : lab;
        txt(el.lbl, lab);
        el.b.setAttribute('aria-label', o.label || 'Use');
      }
    });
    // sabotage menu state
    if (S.sabOpen) syncSabMenu();
  }

  // ------------------------------------------------------------------ sabotage menu
  var SAB_KINDS = [
    { k: 'reactor', name: 'Reactor', note: 'Critical · 2 players must fix', icon: 'reactor' },
    { k: 'o2', name: 'Oxygen', note: 'Critical · 2 codes to enter', icon: 'o2' },
    { k: 'lights', name: 'Lights', note: 'Crew vision drops', icon: 'lights' },
    { k: 'comms', name: 'Comms', note: 'Hides the task list', icon: 'comms' }
  ];
  function buildSabMenu() {
    var close = h('button.icon-btn.icon-btn--sm', { type: 'button', 'aria-label': 'Close sabotage menu', html: ICON.close });
    close.addEventListener('click', function () { showSabotageMenu(false); });
    var grid = h('div.sab-grid');
    E.sabTiles = {};
    SAB_KINDS.forEach(function (s) {
      var b = h('button.sab-tile', { type: 'button' }, [h('span', { html: ICON[s.icon], style: 'display:inline-flex' }), h('b', { text: s.name }), h('small', { text: s.note })]);
      b.addEventListener('click', function () {
        if (b.disabled) return;
        fire('onSabotage', s.k);
        showSabotageMenu(false);
      });
      E.sabTiles[s.k] = b;
      grid.appendChild(b);
    });
    E.sabNote = h('p.sab-note');
    var card = h('div.ui-card.sab-card', { role: 'dialog', 'aria-label': 'Sabotage' }, [
      h('div.modal-head', null, [h('h2.card-title', { text: 'Sabotage', style: 'color:var(--danger-2)' }), close]), grid, E.sabNote
    ]);
    E.sab = h('div.ov.ov-dim.ov-sab', null, [card]);
    E.sab.addEventListener('pointerdown', function (e) { if (e.target === E.sab) showSabotageMenu(false); });
    return E.sab;
  }
  function syncSabMenu() {
    var d = S.hud || {}, B = d.buttons || {}, sb = B.sabotage || {};
    var active = !!(d.sabotage && d.sabotage.k);
    var cd = Math.ceil(Number(sb.cd) || 0);
    var dis = active || cd > 0 || sb.on === false;
    for (var k in E.sabTiles) E.sabTiles[k].disabled = dis;
    txt(E.sabNote, active ? 'A sabotage is already in progress.' : cd > 0 ? 'Sabotage ready in ' + cd + 's' : 'Pick a system to break. Critical sabotages win the game if not fixed in time.');
  }
  function showSabotageMenu(open) {
    S.sabOpen = !!open;
    if (!E.sab) return;
    if (S.sabOpen) syncSabMenu();
    E.sab.classList.toggle('on', S.sabOpen);
  }

  // ------------------------------------------------------------------ map
  function buildMap() {
    var close = h('button.icon-btn.icon-btn--sm', { type: 'button', 'aria-label': 'Close map', html: ICON.close });
    close.addEventListener('click', closeMapFromUi);
    E.mapCv = h('canvas', { 'aria-label': 'Ship map' });
    E.mapFb = h('div.map-fallback.is-hidden', { text: 'Map unavailable' });
    E.mapWrap = h('div.map-wrap', null, [E.mapCv, E.mapFb]);
    E.mapTitle = h('h2.card-title', { text: 'Ship map' });
    var card = h('div.ui-card.map-card', { role: 'dialog', 'aria-label': 'Ship map' }, [h('div.modal-head', null, [E.mapTitle, close]), E.mapWrap]);
    E.map = h('div.ov.ov-dim.ov-map', null, [card]);
    E.map.addEventListener('pointerdown', function (e) { if (e.target === E.map) closeMapFromUi(); });
    return E.map;
  }
  function closeMapFromUi() {
    if (!S.mapOpen) return;
    if (!fire('onMap')) showMap(false);
    if (S.mapOpen) showMap(false); // handler didn't close it — close anyway
  }
  function mapAspect() {
    var W = IS.map && IS.map.W, HH = IS.map && IS.map.H;
    return (W && HH) ? W / HH : 1.6;
  }
  function layoutMap() {
    if (!E.map || !S.mapOpen) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var maxW = Math.min(1000, vw - 24) - 38, maxH = vh - 24 - 38 - 54;
    var a = mapAspect(), w = maxW, hh = w / a;
    if (hh > maxH) { hh = maxH; w = hh * a; }
    E.mapWrap.style.width = Math.floor(w) + 'px';
    E.mapWrap.style.height = Math.floor(hh) + 'px';
    E.mapWrap.style.flex = 'none';
  }
  function drawMap() {
    if (!E.mapCv) return;
    var w = E.mapWrap.clientWidth - 6, hh = E.mapWrap.clientHeight - 6;
    if (w <= 0 || hh <= 0) return;
    var ctx = sizeCanvas(E.mapCv, w, hh);
    var ok = false;
    if (IS.render && typeof IS.render.drawMinimap === 'function') {
      ctx.save();
      try { ctx.clearRect(0, 0, w, hh); IS.render.drawMinimap(ctx, w, hh, S.mapView || {}); ok = true; } catch (e) { ok = false; }
      ctx.restore();
    }
    show(E.mapFb, !ok);
  }
  function showMap(open) {
    S.mapOpen = !!open;
    if (!E.map) return;
    E.map.classList.toggle('on', S.mapOpen);
    if (S.mapOpen) {
      txt(E.mapTitle, (IS.map && IS.map.name) || 'Ship map');
      layoutMap(); drawMap(); S.mapLast = nowMs();
    }
  }
  function setMapView(v) { S.mapView = v; }

  // ------------------------------------------------------------------ joystick
  var STICK_R = 52;
  function enableTouch() {
    if (S.touch) return;
    S.touch = true;
    document.body.classList.add('is-touch');
  }
  function buildStick() {
    E.stickKnob = h('div.stick-knob');
    E.stickBase = h('div.stick-base', null, [E.stickKnob]);
    E.stickZone = h('div.stick-zone', { 'aria-hidden': 'true' }, [E.stickBase]);
    var z = E.stickZone;
    var ox = 0, oy = 0;
    z.addEventListener('pointerdown', function (e) {
      if (S.stickId != null) return;
      if (e.pointerType === 'mouse' && !S.touch) return;
      e.preventDefault();
      S.stickId = e.pointerId;
      try { z.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      var r = z.getBoundingClientRect(), half = E.stickBase.offsetWidth / 2;
      var cx = clamp(e.clientX, r.left + half, r.right - half), cy = clamp(e.clientY, r.top + half, r.bottom - half);
      E.stickBase.style.left = (cx - r.left - half) + 'px';
      E.stickBase.style.bottom = (r.bottom - cy - half) + 'px';
      ox = cx; oy = cy;
      z.classList.add('active');
      moveStick(e.clientX - ox, e.clientY - oy);
    });
    z.addEventListener('pointermove', function (e) {
      if (e.pointerId !== S.stickId) return;
      e.preventDefault();
      moveStick(e.clientX - ox, e.clientY - oy);
    });
    var end = function (e) {
      if (e.pointerId !== S.stickId) return;
      resetStick();
    };
    z.addEventListener('pointerup', end); z.addEventListener('pointercancel', end); z.addEventListener('lostpointercapture', end);
    return z;
  }
  function moveStick(dx, dy) {
    var l = Math.sqrt(dx * dx + dy * dy);
    if (l > STICK_R) { dx = dx / l * STICK_R; dy = dy / l * STICK_R; l = STICK_R; }
    E.stickKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    var m = l / STICK_R;
    if (m < 0.14) { S.stick.x = 0; S.stick.y = 0; return; }
    S.stick.x = dx / STICK_R; S.stick.y = dy / STICK_R;
  }
  function resetStick() {
    S.stickId = null; S.stick.x = 0; S.stick.y = 0;
    if (!E.stickZone) return;
    E.stickZone.classList.remove('active');
    E.stickKnob.style.transform = '';
    E.stickBase.style.left = ''; E.stickBase.style.bottom = '';
  }

  // ================================================================== MEETING
  function buildMeeting() {
    // splash
    E.splashCv = h('canvas.splash-cv', { 'aria-hidden': 'true' });
    E.splashTitle = h('h2.splash-title');
    E.splashSub = h('div.splash-sub');
    E.splash = h('div.ov.ov-splash', { role: 'alert' }, [h('div.rays'), E.splashCv, E.splashTitle, E.splashSub]);

    // tablet
    E.mTitle = h('h2.m-title', { text: 'Who Is The Impostor?' });
    E.mTimer = h('div.m-timer', { 'aria-live': 'off' });
    E.chatBtn = h('button.icon-btn.chat-toggle', { type: 'button', 'aria-label': 'Open chat', title: 'Chat', html: ICON.chat });
    E.chatBadge = h('span.badge.is-hidden', { text: '0' });
    E.chatBtn.appendChild(E.chatBadge);
    E.chatBtn.addEventListener('click', function () { setChatOpen(!S.chatOpen); });
    E.mGrid = h('div.m-grid', { role: 'list' });
    E.skipBtn = h('button.ui-btn.ui-btn--dark.ui-btn--sm', { type: 'button', text: 'Skip vote' });
    var sy = h('button.yes', { type: 'button', 'aria-label': 'Confirm skip', html: ICON.check });
    var sn = h('button.no', { type: 'button', 'aria-label': 'Cancel', html: ICON.cross });
    E.skipVotes = h('div.skip-votes');
    E.skipWrap = h('div.skip-wrap', null, [E.skipBtn, h('div.skip-confirm', null, [sy, sn]), E.skipVotes]);
    E.skipBtn.addEventListener('click', function () { if (!canVoteNow()) return; S.selected = S.selected === -1 ? null : -1; renderMeetingState(); });
    sy.addEventListener('click', function () { castVote(-1); });
    sn.addEventListener('click', function () { S.selected = null; renderMeetingState(); });
    E.mStatus = h('div.m-status');

    // chat
    E.chatList = h('div.chat-list', { 'aria-live': 'polite' });
    E.chatEmpty = h('div.chat-empty', { text: 'No messages yet. Say what you saw!' });
    E.chatList.appendChild(E.chatEmpty);
    E.chatIn = h('input.ui-input', { type: 'text', maxlength: '100', placeholder: 'Type a message…', autocomplete: 'off', 'aria-label': 'Chat message', enterkeyhint: 'send' });
    var send = h('button.ui-btn.ui-btn--cyan', { type: 'button', 'aria-label': 'Send', html: ICON.send });
    var chatClose = h('button.icon-btn.icon-btn--sm', { type: 'button', 'aria-label': 'Close chat', html: ICON.close });
    chatClose.addEventListener('click', function () { setChatOpen(false); });
    E.chatIn.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
      else if (e.key === 'Escape') { setChatOpen(false); }
    });
    E.chatIn.addEventListener('keyup', function (e) { e.stopPropagation(); });
    send.addEventListener('click', function () { sendChat(); });
    E.chat = h('div.m-chat', { role: 'dialog', 'aria-label': 'Meeting chat' }, [
      h('div.chat-head', null, [h('h3', { text: 'Chat' }), chatClose]),
      E.chatList,
      h('div.chat-form', null, [E.chatIn, send])
    ]);
    E.tablet = h('div.tablet', null, [h('div.screen-in', null, [
      h('div.m-head', null, [E.mTitle, E.mTimer, E.chatBtn]),
      E.mGrid,
      h('div.m-foot', null, [E.skipWrap, E.mStatus]),
      E.chat
    ])]);
    E.meet = h('div.ov.ov-meet', { role: 'dialog', 'aria-label': 'Emergency meeting' }, [E.tablet]);
    return [E.meet, E.splash];
  }
  function sendChat() {
    var t = String(E.chatIn.value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100);
    if (!t) return;
    E.chatIn.value = '';
    fire('onChat', t);
    E.chatIn.focus();
  }
  function setChatOpen(open) {
    S.chatOpen = !!open;
    if (!E.chat) return;
    E.chat.classList.toggle('open', S.chatOpen);
    E.chatBtn.setAttribute('aria-label', S.chatOpen ? 'Close chat' : 'Open chat');
    if (S.chatOpen) {
      S.unread = 0; syncUnread();
      E.chatList.scrollTop = E.chatList.scrollHeight;
      if (!S.touch) setTimeout(function () { try { E.chatIn.focus(); } catch (e) { /* ignore */ } }, 60);
    } else if (document.activeElement === E.chatIn) E.chatIn.blur();
  }
  function syncUnread() {
    show(E.chatBadge, S.unread > 0);
    txt(E.chatBadge, S.unread > 9 ? '9+' : String(S.unread));
  }
  function chatMsgEl(m) {
    var el = h('div.msg' + (m.isMe ? '.me' : '') + (m.dead ? '.dead' : ''), null, [
      crewCanvas(34, m.color, { ghost: !!m.dead }),
      h('div.bub', null, [h('span.who', { text: m.name || 'Player', style: 'color:' + (m.dead ? '#5b607a' : shadeInk(m.color)) }), h('span.txt', { text: m.text || '' })])
    ]);
    return el;
  }
  function shadeInk(ci) { var c = col(ci); return (ci === 5 || ci === 7 || ci === 10 || ci === 11) ? c[2] : c[1]; }
  function addChat(m) {
    if (!m) return;
    m = { name: m.name, color: m.color | 0, text: String(m.text || '').slice(0, 100), dead: !!m.dead, isMe: !!m.isMe };
    S.chat.push(m);
    if (S.chat.length > 200) S.chat.shift();
    if (!E.chatList) return;
    var near = E.chatList.scrollHeight - E.chatList.scrollTop - E.chatList.clientHeight < 60;
    if (E.chatEmpty.parentNode) E.chatEmpty.remove();
    E.chatList.appendChild(chatMsgEl(m));
    while (E.chatList.children.length > 200) E.chatList.removeChild(E.chatList.firstChild);
    if (near || m.isMe) E.chatList.scrollTop = E.chatList.scrollHeight;
    if (!S.chatOpen && !m.isMe) { S.unread++; syncUnread(); }
  }
  function clearChat() {
    S.chat = []; S.unread = 0;
    if (!E.chatList) return;
    E.chatList.textContent = '';
    E.chatList.appendChild(E.chatEmpty);
    syncUnread();
  }

  function meMeeting() {
    var d = S.meeting;
    if (!d || !d.players) return null;
    for (var i = 0; i < d.players.length; i++) if (d.players[i].isMe) return d.players[i];
    return null;
  }
  function myVote() {
    var d = S.meeting || {};
    if (d.myVote != null && d.myVote !== -2) return d.myVote;
    return S.pendingVote;
  }
  function canVoteNow() {
    var d = S.meeting;
    if (!d || d.phase !== 'vote') return false;
    if (myVote() != null) return false;
    if (d.canVote != null) return !!d.canVote;
    var me = meMeeting();
    return !!(me && me.alive && me.canVote !== false && !me.voted);
  }
  function castVote(target) {
    if (!canVoteNow()) return;
    S.pendingVote = target; S.selected = null;
    fire('onVote', target);
    renderMeetingState();
  }
  function colorKey(p) { return p ? (p.color | 0) : -99; }
  function buildCards(players) {
    E.mGrid.textContent = '';
    S.cards = {};
    players.forEach(function (p) {
      var crew = h('canvas.crew-cv.m-crew', { 'aria-hidden': 'true' });
      var name = h('span.m-name', { text: p.name || 'Player' });
      var votes = h('div.m-votes');
      var yes = h('button.yes', { type: 'button', 'aria-label': 'Vote ' + (p.name || 'player'), html: ICON.check });
      var no = h('button.no', { type: 'button', 'aria-label': 'Cancel', html: ICON.cross });
      var card = h('div.m-card', { role: 'listitem', tabindex: '-1' }, [
        h('span.m-av', null, [crew, spkBadge()]),
        h('span.xmark', { html: ICON.xmark }),
        h('div.m-info', null, [name, votes]),
        h('div.m-badges', null, [h('span.b-voted', { text: 'I voted' }), h('span.b-caller', { title: 'Called the meeting', html: ICON.megaphone })]),
        h('div.m-confirm', null, [yes, no])
      ]);
      var slot = p.slot;
      card.addEventListener('click', function () {
        var pp = S.cards[slot] && S.cards[slot].p;
        if (!canVoteNow() || !pp || !pp.alive) return;
        S.selected = S.selected === slot ? null : slot;
        renderMeetingState();
      });
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); } });
      yes.addEventListener('click', function (e) { e.stopPropagation(); castVote(slot); });
      no.addEventListener('click', function (e) { e.stopPropagation(); S.selected = null; renderMeetingState(); });
      S.cards[slot] = { el: card, crew: crew, name: name, votes: votes, p: p, crewSig: '', votesSig: '' };
      E.mGrid.appendChild(card);
    });
  }
  function voterIcons(box, colors, sigHolder) {
    var sig = JSON.stringify(colors || []);
    if (sigHolder.votesSig === sig) return;
    sigHolder.votesSig = sig;
    box.textContent = '';
    (colors || []).forEach(function (c, i) {
      var cv = crewCanvas(22, c, {});
      cv.style.animationDelay = (0.25 + i * 0.18) + 's';
      box.appendChild(cv);
    });
  }
  function renderMeeting(d) {
    S.meeting = d;
    var players = d.players || [];
    var sig = players.map(function (p) { return p.slot; }).join(',');
    if (sig !== S.cardsSig) { S.cardsSig = sig; buildCards(players); }
    if (typeof d.remain === 'number') S.meetDeadline = nowMs() + d.remain * 1000;
    if (d.phase === 'result') S.selected = null;
    renderMeetingState();
  }
  function renderMeetingState() {
    var d = S.meeting;
    if (!d) return;
    var vote = canVoteNow();
    if (!vote && S.selected != null) S.selected = null;
    var byColor = d.by ? colorKey(d.by) : -99;
    var res = d.phase === 'result';
    var votes = d.votes || {};
    var top = listTop(d.players);
    (d.players || []).forEach(function (p) {
      var c = S.cards[p.slot];
      if (!c) return;
      c.p = p;
      var el = c.el;
      el.classList.toggle('dead', !p.alive);
      el.classList.toggle('me', !!p.isMe);
      el.classList.toggle('voted', !!p.voted && !res);
      el.classList.toggle('caller', p.caller != null ? !!p.caller : (colorKey(p) === byColor));
      el.classList.toggle('votable', vote && !!p.alive);
      el.classList.toggle('sel', vote && S.selected === p.slot);
      el.setAttribute('tabindex', vote && p.alive ? '0' : '-1');
      txt(c.name, p.name || 'Player');
      el.classList.toggle('speaking', !!p.speaking);
      var hat = cleanHat(p.hat);
      var csig = p.color + '|' + (p.alive ? 1 : 0) + '|' + hat + '|' + top;
      if (c.crewSig !== csig) { c.crewSig = csig; paintAvatar(c.crew, 52, 52, p.color, { hat: hat, top: top }); }
      voterIcons(c.votes, res ? votes[String(p.slot)] : null, c);
    });
    // skip
    E.skipBtn.disabled = !vote;
    E.skipWrap.classList.toggle('sel', vote && S.selected === -1);
    voterIcons(E.skipVotes, res ? votes['-1'] : null, E.skipWrap);
    if (res && votes['-1'] && votes['-1'].length) E.skipBtn.textContent = 'Skipped'; else txt(E.skipBtn, 'Skip vote');
    // status
    var me = meMeeting(), mv = myVote(), status = '';
    if (res) status = 'Votes are in!';
    else if (!me) status = 'Spectating this meeting';
    else if (!me.alive) status = 'You are dead — you can’t vote';
    else if (d.phase === 'discuss') status = 'Discuss! Voting opens soon.';
    else if (mv === -1) status = 'You skipped voting';
    else if (mv != null) {
      var tp = null;
      (d.players || []).forEach(function (p) { if (p.slot === mv) tp = p; });
      status = 'You voted for ' + (tp ? tp.name : 'someone');
    } else if (S.selected != null) status = 'Confirm your vote ✓';
    else status = 'Tap a player to vote';
    txt(E.mStatus, status);
    tickMeeting();
  }
  function tickMeeting() {
    var d = S.meeting;
    if (!d || !E.mTimer) return;
    var r = Math.max(0, Math.ceil((S.meetDeadline - nowMs()) / 1000));
    var t = d.phase === 'discuss' ? 'Discussion ends in ' + r + 's' : d.phase === 'vote' ? 'Voting ends in ' + r + 's' : 'Proceeding…';
    txt(E.mTimer, t);
    E.mTimer.classList.toggle('urgent', d.phase === 'vote' && r <= 10);
  }
  function paintSplash() {
    var d = S.meeting || {};
    var cv = E.splashCv, w = cv.clientWidth, hh = cv.clientHeight;
    if (!w || !hh) return;
    var ctx = sizeCanvas(cv, w, hh);
    ctx.clearRect(0, 0, w, hh);
    var sc = Math.min(hh / (64 + (-58 - hatTop(d.by && d.by.hat))), 3.2);
    if (d.body) {
      drawCrew(ctx, w * 0.33, hh * 0.97, d.by ? d.by.color : 0, { scale: sc, facing: 1, hat: d.by ? cleanHat(d.by.hat) : 0 });
      drawCrew(ctx, w * 0.72, hh * 0.97, d.body.color, { scale: sc * 0.95, facing: -1, dead: true });
    } else {
      drawCrew(ctx, w * 0.5, hh * 0.97, d.by ? d.by.color : 0, { scale: sc, facing: 1, hat: d.by ? cleanHat(d.by.hat) : 0 });
    }
  }
  function showMeeting(d) {
    d = d || {};
    if (S.meetingOpen) { updateMeeting(d); return; }
    S.meetingOpen = true;
    S.pendingVote = null; S.selected = null;
    S.cardsSig = '';
    showSabotageMenu(false);
    if (S.mapOpen) closeMapFromUi();
    setChatOpen(false);
    renderMeeting(d);
    // splash first
    var isBody = !!d.body;
    E.splash.classList.toggle('emg', !isBody);
    txt(E.splashTitle, isBody ? 'Dead Body Reported' : 'Emergency Meeting');
    txt(E.splashSub, isBody ? (d.by ? d.by.name : 'Someone') + ' found ' + (d.body.name || 'a body') + '’s body' : (d.by ? d.by.name : 'Someone') + ' called a meeting');
    // restart animations
    E.splashTitle.style.animation = 'none'; void E.splashTitle.offsetWidth; E.splashTitle.style.animation = '';
    E.splash.classList.add('on');
    E.meet.classList.remove('on');
    requestAnimationFrame(paintSplash);
    S.redraw.splash = paintSplash;
    later('splash', 2100, function () {
      E.splash.classList.remove('on');
      S.redraw.splash = null;
      if (!S.meetingOpen) return;
      E.meet.classList.add('on');
      E.tablet.classList.remove('enter'); void E.tablet.offsetWidth; E.tablet.classList.add('enter');
    });
  }
  function updateMeeting(d) {
    if (!d) return;
    if (!S.meetingOpen) { showMeeting(d); return; }
    if (d.phase === 'result') S.pendingVote = S.pendingVote; // keep
    renderMeeting(d);
  }
  function hideMeeting() {
    clearTimer('splash');
    S.meetingOpen = false;
    S.redraw.splash = null;
    if (!E.meet) return;
    setChatOpen(false);
    E.meet.classList.remove('on');
    E.splash.classList.remove('on');
    S.selected = null;
  }

  // ================================================================== ROLE / EJECT / GAME OVER
  function buildRole() {
    E.roleTitle = h('h2.role-title');
    E.roleSub = h('p.role-sub');
    E.roleCv = h('canvas.role-cv', { 'aria-hidden': 'true' });
    E.role = h('div.ov.ov-role', { role: 'alert' }, [h('div.role-glow'), h('div.role-shh', { text: 'Shhhhh!' }), E.roleTitle, E.roleSub, E.roleCv]);
    E.role.addEventListener('click', function () { hideRole(); });
    return E.role;
  }
  function hideRole() { clearTimer('role'); S.redraw.role = null; if (E.role) E.role.classList.remove('on'); }
  function showRole(d) {
    d = d || {};
    var imp = isImp(d.role);
    clearChat();
    showSabotageMenu(false);
    E.role.classList.toggle('imp', imp);
    E.roleTitle.textContent = imp ? 'Impostor' : 'Crewmate';
    E.roleSub.textContent = '';
    var count = d.count != null ? d.count : (d.impostors ? d.impostors.length : 1);
    var people = [];
    var myColor = S.myColor;
    if (imp) {
      var others = (d.impostors || []).filter(function (p) { return (p.color | 0) !== myColor; });
      if (others.length) {
        E.roleSub.appendChild(document.createTextNode(others.length === 1 ? 'Your fellow Impostor: ' : 'Your fellow Impostors: '));
        others.forEach(function (p, i) {
          if (i) E.roleSub.appendChild(document.createTextNode(', '));
          E.roleSub.appendChild(h('span.c', { text: p.name || 'Player' }));
        });
      } else E.roleSub.textContent = 'Sabotage and kill everyone.';
      people = (d.impostors || []).map(function (p) { return { color: p.color, name: p.name, hat: p.hat, isMe: (p.color | 0) === myColor }; });
      if (!people.some(function (p) { return p.isMe; })) people.push({ color: myColor, name: S.name, hat: S.hat, isMe: true });
    } else {
      E.roleSub.appendChild(document.createTextNode('There ' + (count === 1 ? 'is ' : 'are ')));
      E.roleSub.appendChild(h('b', { text: count + ' Impostor' + (count === 1 ? '' : 's') }));
      E.roleSub.appendChild(document.createTextNode(' among us'));
      var lp = (d.players) || (S.lobby && S.lobby.players) || [];
      people = lp.map(function (p) { return { color: p.color, name: p.name, hat: p.hat, isMe: !!p.isMe }; });
      if (!people.length) people = [{ color: myColor, name: S.name, hat: S.hat, isMe: true }];
    }
    E.role.classList.add('on');
    var paint = function () { drawLineup(E.roleCv, people, { names: true }); };
    S.redraw.role = paint;
    requestAnimationFrame(paint);
    later('role', 4200, hideRole);
  }

  function buildEject() {
    E.ejectCv = h('canvas', { 'aria-hidden': 'true' });
    E.ejectTxt = h('div.eject-text', { 'aria-live': 'polite' });
    E.eject = h('div.ov.ov-eject', null, [E.ejectCv, E.ejectTxt]);
    E.ejectStars = new Stars(E.ejectCv, { vx: -0.05, streak: 3 });
    return E.eject;
  }
  function showEjection(d) {
    d = d || {};
    var text = String(d.text || (d.name ? d.name + ' was ejected.' : 'No one was ejected.'));
    var lines = text.split('\n');
    S.eject = { t: 0, color: (d.color != null && d.color >= 0 && d.name) ? d.color : -1, hat: cleanHat(d.hat), main: lines[0], sub: lines.slice(1).join('\n'), shown: -1, rot: Math.random() * 6 };
    E.ejectTxt.textContent = '';
    E.eject.classList.add('on');
    later('eject', 6000, hideEjection);
  }
  function hideEjection() { clearTimer('eject'); S.eject = null; if (E.eject) E.eject.classList.remove('on'); }
  function drawEject(dt) {
    var ej = S.eject;
    if (!ej) return;
    ej.t += dt;
    E.ejectStars.draw(dt);
    var st = E.ejectStars;
    if (!st.ctx) return;
    var ctx = st.ctx, w = st.w, hh = st.h;
    if (ej.color >= 0) {
      var dur = 4.0, p = clamp(ej.t / dur, 0, 1.2);
      var x = -80 + (w + 160) * p, y = hh * 0.4 + Math.sin(ej.t * 1.3) * 16;
      var sc = clamp(Math.min(w, hh) / 300, 1.1, 2.2);
      ctx.save(); ctx.translate(x, y); ctx.rotate(ej.rot + ej.t * 1.6);
      drawCrew(ctx, 0, 28 * sc, ej.color, { scale: sc, facing: 1, noShadow: true, hat: ej.hat });
      ctx.restore();
    }
    // typewriter
    var start = 0.5, cps = 30;
    var all = ej.main + (ej.sub ? '\n' + ej.sub : '');
    var n = clamp(Math.floor((ej.t - start) * cps), 0, all.length);
    if (n !== ej.shown) {
      ej.shown = n;
      var vis = all.slice(0, n), parts = vis.split('\n');
      E.ejectTxt.textContent = '';
      E.ejectTxt.appendChild(document.createTextNode(parts[0]));
      if (parts.length > 1) E.ejectTxt.appendChild(h('span.sub', { text: parts.slice(1).join('\n') }));
      if (n < all.length) E.ejectTxt.appendChild(h('span.caret'));
    }
  }

  var REASONS = {
    crew: { tasks: 'Crewmates completed all tasks', vote: 'All Impostors were voted out', disconnect: 'The Impostors left the game', kills: 'The Impostors were eliminated' },
    imp: { kills: 'The Impostors eliminated the crew', vote: 'The crew voted out one of their own', sabotage: 'Impostors sabotaged the ship', disconnect: 'Too many Crewmates left the game', tasks: 'The Impostors won' }
  };
  function buildOver() {
    E.overTitle = h('h2.over-title');
    E.overTeam = h('div.over-team');
    E.overReason = h('p.over-reason');
    E.overCv = h('canvas.over-cv', { 'aria-hidden': 'true' });
    E.againBtn = h('button.ui-btn.ui-btn--big.ui-btn--green', { type: 'button', html: ICON.play + '<span>Play again</span>' });
    E.overWait = h('span.over-wait', null, ['Waiting for host', h('span.dots')]);
    E.overLeave = h('button.ui-btn.ui-btn--big.ui-btn--dark', { type: 'button', html: ICON.leave + '<span>Leave</span>' });
    E.againBtn.addEventListener('click', function () { sfx('click'); fire('onAgain'); });
    E.overLeave.addEventListener('click', function () { sfx('click'); fire('onLeave'); });
    E.over = h('div.ov.ov-over', { role: 'dialog', 'aria-label': 'Game over' }, [E.overTitle, E.overTeam, E.overReason, E.overCv, h('div.over-actions', null, [E.againBtn, E.overWait, E.overLeave])]);
    return E.over;
  }
  function showGameOver(d) {
    d = d || {};
    var w = d.winner === 'imp' ? 'imp' : 'crew';
    hideMeeting(); hideEjection(); hideRole(); showSabotageMenu(false);
    if (S.mapOpen) closeMapFromUi();
    E.over.classList.toggle('imp', w === 'imp');
    E.over.classList.toggle('lose', !d.youWon);
    txt(E.overTitle, d.youWon ? 'Victory' : 'Defeat');
    txt(E.overTeam, (w === 'imp' ? 'Impostors' : 'Crewmates') + ' win');
    var r = d.reason || '';
    if (REASONS[w][r]) r = REASONS[w][r];
    txt(E.overReason, r);
    var winners = (d.players || []).filter(function (p) { return (w === 'imp') === isImp(p.role); })
      .map(function (p) { return { color: p.color, name: p.name, hat: p.hat, ghost: p.alive === false || p.alive === 0, isMe: (p.color | 0) === S.myColor || !!p.isMe }; });
    show(E.againBtn, !!d.isHost);
    show(E.overWait, !d.isHost);
    E.over.classList.add('on');
    var paint = function () { drawLineup(E.overCv, winners, { names: true }); };
    S.redraw.over = paint;
    requestAnimationFrame(paint);
  }
  function hideOver() { S.redraw.over = null; if (E.over) E.over.classList.remove('on'); }

  // ------------------------------------------------------------------ toasts
  function toast(text) {
    if (!E.toasts || !text) return;
    var el = h('div.toast', { role: 'status', text: String(text) });
    E.toasts.appendChild(el);
    while (E.toasts.children.length > 3) E.toasts.removeChild(E.toasts.firstChild);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320); }, 2800);
  }

  // ------------------------------------------------------------------ mode
  var MODE_TEXT = {
    room: 'Online — anyone with this page can join',
    local: 'Local mode — open more tabs to play together',
    offline: 'Offline — Freeplay only'
  };
  function setMode(m) {
    S.mode = m;
    if (!E.status) return;
    E.status.className = 'status st-' + (MODE_TEXT[m] ? m : 'wait');
    txt(E.statusTxt, MODE_TEXT[m] || 'Connecting to the ship…');
    syncMenuButtons();
    renderGames();
  }

  // ------------------------------------------------------------------ screens / overlays
  function showScreen(name) {
    S.screen = name;
    if (!E.menu) return;
    E.menu.classList.toggle('on', name === 'menu');
    E.lobby.classList.toggle('on', name === 'lobby');
    E.hud.classList.toggle('on', name === 'game');
    E.stickZone.classList.toggle('live', name === 'lobby' || name === 'game');
    resetStick();
    var a = document.activeElement;
    if (a && a !== document.body && a.closest && !a.closest('.screen.on') && !a.closest('.ov.on')) { try { a.blur(); } catch (e) { /* ignore */ } }
    if (name === 'menu') {
      hideOverlays(); hideMeeting();
      clearTimer('menuBusy'); S.menuBusy = false; syncMenuButtons();
      requestAnimationFrame(function () { E.menuSw.paint(); paintHero(); if (E.menuHats) { E.menuHats.paint(S.color); E.menuHats.reveal(); } });
    } else if (name === 'lobby') {
      hideOver(); hideEjection(); hideRole(); showSabotageMenu(false);
      S.hudSigs = {};
      if (S.panelOpen == null) setPanelOpen(window.innerWidth > 640);
      else requestAnimationFrame(paintLobbyPickers);
    } else if (name === 'game') {
      hideOver();
      show(E.exitPop, false);
    }
  }
  function hideOverlays() {
    hideRole(); hideEjection(); hideOver();
    showSabotageMenu(false);
    if (E.map) { S.mapOpen = false; E.map.classList.remove('on'); }
    if (E.exitPop) show(E.exitPop, false);
  }
  function isTyping() {
    var a = document.activeElement;
    if (!a || a === document.body) return false;
    if (a.isContentEditable) return true;
    var t = a.tagName;
    if (t === 'TEXTAREA' || t === 'SELECT') return true;
    if (t === 'INPUT') {
      var ty = (a.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'search', 'email', 'number', 'password', 'tel', 'url'].indexOf(ty) >= 0;
    }
    return false;
  }

  // ------------------------------------------------------------------ main loop (UI animations only)
  var lastTs = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, ((ts - (lastTs || ts)) / 1000) || 0);
    lastTs = ts;
    if (S.screen === 'menu' && E.menuStars && !document.hidden) E.menuStars.draw(dt);
    if (S.eject) drawEject(dt);
    if (S.meetingOpen) tickMeeting();
    if (S.mapOpen && ts - S.mapLast > 66) { S.mapLast = ts; drawMap(); }
  }
  function onResize() {
    for (var k in S.redraw) if (S.redraw[k]) S.redraw[k]();
    if (S.mapOpen) layoutMap();
    if (E.menuSw) E.menuSw.paint();
    if (E.lobbySw && S.panelOpen) paintLobbyPickers();
    if (E.menuHats && S.screen === 'menu') E.menuHats.paint(S.color);
    if (S.screen === 'menu') paintHero();
  }

  // ------------------------------------------------------------------ init
  function init(handlers) {
    H = handlers || {};
    if (S.inited) return;
    S.inited = true;
    S.name = cleanName(lsGet('ss_name', '')) || (FUN_NAMES[(Math.random() * FUN_NAMES.length) | 0] + ((Math.random() * 90 + 10) | 0));
    var c = parseInt(lsGet('ss_color', ''), 10);
    S.color = (c >= 0 && c < COLORS().length) ? c : (Math.random() * COLORS().length) | 0;
    S.myColor = S.color;
    S.hat = cleanHat(lsGet('ss_hat', '0'));
    var storedMute = lsGet('ss_muted', null);
    S.muted = storedMute != null ? storedMute === '1' : !!(IS.audio && IS.audio.muted);
    S.tasksCollapsed = window.innerWidth <= 640 || window.innerHeight <= 520;
    try { if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) S.touch = true; } catch (e) { /* ignore */ }

    injectCss();
    var root = document.getElementById('ui-layer');
    if (!root) { root = h('div#ui-layer'); document.body.appendChild(root); }
    root.textContent = '';
    root.appendChild(buildMenu());
    root.appendChild(buildLobby());
    root.appendChild(buildHud());
    root.appendChild(buildStick());
    root.appendChild(buildSabMenu());
    root.appendChild(buildMap());
    buildMeeting().forEach(function (el) { root.appendChild(el); });
    root.appendChild(buildRole());
    root.appendChild(buildEject());
    root.appendChild(buildOver());
    E.toasts = h('div.toasts', { 'aria-live': 'polite' });
    root.appendChild(E.toasts);
    E.menuSw.set(S.color, null);
    setMyHat(S.hat); S.hatAt = 0;
    if (S.touch) document.body.classList.add('is-touch');
    if (S.muted) fire('onMute', true);
    syncMute();
    syncMenuButtons();

    window.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch') enableTouch(); }, true);
    window.addEventListener('touchstart', enableTouch, { passive: true, once: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', resetStick);
    // keyboard: Escape closes UI-owned popups; never block the game's keys otherwise
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (S.chatOpen) { setChatOpen(false); return; }
      if (S.sabOpen) { showSabotageMenu(false); return; }
      if (E.exitPop && !E.exitPop.classList.contains('is-hidden')) { show(E.exitPop, false); return; }
      if (S.mapOpen && typeof H.onMap !== 'function') showMap(false);
    });
    // buttons must not keep focus after a mouse/touch click (Space would re-trigger them)
    document.addEventListener('click', function (e) {
      if (!e.detail) return;
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (b) setTimeout(function () { if (document.activeElement === b) b.blur(); }, 0);
    }, true);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { onResize(); }).catch(function () { /* ignore */ });
    requestAnimationFrame(function () { paintHero(); E.menuSw.paint(); if (E.menuHats) { E.menuHats.paint(S.color); E.menuHats.reveal(); } });
    requestAnimationFrame(loop);
  }

  IS.ui = {
    init: init,
    showScreen: showScreen,
    setGameList: function (list) { S.games = Array.isArray(list) ? list : []; renderGames(); },
    setMode: setMode,
    updateLobby: updateLobby,
    updateHud: updateHud,
    showRole: showRole,
    showMeeting: showMeeting,
    updateMeeting: updateMeeting,
    hideMeeting: hideMeeting,
    addChat: addChat,
    showEjection: showEjection,
    showGameOver: showGameOver,
    hideOverlays: hideOverlays,
    toast: toast,
    showSabotageMenu: showSabotageMenu,
    showMap: showMap,
    setMapView: setMapView,
    getStick: function () { return { x: S.stick.x, y: S.stick.y }; },
    isTyping: isTyping,
    profile: function () { return { name: currentName(), color: S.color, hat: S.hat }; },
    hat: function () { return S.hat; },
    _state: S
  };
})();
