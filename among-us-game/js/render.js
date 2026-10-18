/* Starship Sus — canvas renderer: station, props, crewmates, vision, markers, minimap.
   See SPEC.md §4.4. Classic script, attaches IS.render. */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});
  var CFG = IS.CONFIG || {};
  var T = CFG.TILE || 48;
  var COLORS = CFG.COLORS || [['Red', '#c51111', '#7a0838']];
  var TAU = Math.PI * 2;

  var OL = '#10131f';            // outline ink
  var CHUNK = 384;               // static-layer chunk size (world px)

  var canvas = null, ctx = null;
  var dpr = 1, cssW = 0, cssH = 0, devW = 0, devH = 0;
  var lastCam = { x: 0, y: 0 }, lastZoom = 1;

  var chunks = new Map();        // "cx,cy" -> canvas
  var chunkScale = 0, chunkCap = 24;
  var sprites = new Map();       // sprite key -> {c, ox, oy, w, h}
  var outlines = new Map();
  var starTile = null;
  var assetSig = '';
  var frameNo = 0, lastMapVer = -1;
  var pendingS = 0, pendingN = 0;
  var mini = { key: '', c: null };

  // ------------------------------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------------------------------
  function M() { return IS.map; }
  function img(key) {
    if (!IS.assets || !IS.assets.img) return null;
    var im = IS.assets.img(key);
    if (!im) return null;
    if (im.naturalWidth === 0 && !(im.width > 0 && !('naturalWidth' in im))) return null;
    return im;
  }
  function fontD() { return (IS.assets && IS.assets.FONT_DISPLAY) || '"Russo One", system-ui, sans-serif'; }
  function fontB() { return (IS.assets && IS.assets.FONT_BODY) || '"Rubik", system-ui, sans-serif'; }
  function col(i) { return COLORS[((i | 0) % COLORS.length + COLORS.length) % COLORS.length] || COLORS[0]; }
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); }
  function fillStroke(c, fill, stroke, lw) {
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 2.5; c.stroke(); }
  }
  function shade(hex, f) { // f<0 darker, f>0 lighter
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function hash(x, y) { var h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  // ------------------------------------------------------------------------------------------
  // Floors & walls (static layer)
  // ------------------------------------------------------------------------------------------
  var THEME = {
    cafeteria: ['#93a0b9', '#8693ad'], weapons: ['#6f7a94', '#67718a'], o2: ['#84a8a0', '#7a9d95'],
    navigation: ['#8191b6', '#7887ab'], shields: ['#8d93ad', '#8389a3'], communications: ['#6d7894', '#66708b'],
    storage: ['#80786a', '#787062'], admin: ['#958bab', '#8a81a0'], electrical: ['#646f78', '#5d6870'],
    lowerEngine: ['#6e7284', '#686c7d'], upperEngine: ['#6e7284', '#686c7d'], security: ['#656e88', '#5f6881'],
    reactor: ['#5f6a82', '#59647b'], medbay: ['#a9c0cc', '#9fb6c3'], hall: ['#5d6883', '#58637d']
  };
  var FLOOR_IMG = { room: 'floor_room', tech: 'floor_tech', hall: 'floor_hall' };
  var WALL_TOP = '#2e3758', WALL_TOP_HI = '#414c78';
  var WALL_FACE_A = '#6a789f', WALL_FACE_B = '#4a5679', WALL_BASE = '#2b3354';
  var VOID = '#04060f';
  // Per-map look: IS.map.theme = { bg: 'stars'|'snow'|'sky', void, hall: [a, b], hallFloor,
  //   wall: {top, topHi, faceA, faceB, base} }. Rooms may carry their own tint: [a, b].
  function applyTheme() {
    var th = (M() && M().theme) || {}, w = th.wall || {};
    WALL_TOP = w.top || '#2e3758'; WALL_TOP_HI = w.topHi || '#414c78';
    WALL_FACE_A = w.faceA || '#6a789f'; WALL_FACE_B = w.faceB || '#4a5679'; WALL_BASE = w.base || '#2b3354';
    VOID = th.void || (th.bg === 'snow' ? '#c9d6e6' : th.bg === 'sky' ? '#5d8fd0' : '#04060f');
  }

  function cellAt(x, y) { var m = M(); if (x < 0 || y < 0 || x >= m.W || y >= m.H) return 0; return m.grid[y * m.W + x]; }

  function drawFloorExtra(c, kind, th, x, y, px, py) {
    var h1 = hash(x, y), h2 = hash(y + 7, x + 3), i;
    if (kind === 'snow') {
      c.fillStyle = th[0]; c.fillRect(px, py, T, T);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (i = 0; i < 5; i++) c.fillRect(px + hash(x * 5 + i, y) * (T - 4), py + hash(y * 5 + i, x) * (T - 4), 2.5, 2.5);
      c.fillStyle = 'rgba(80,110,160,0.10)';
      if (h1 < 0.35) { c.beginPath(); c.ellipse(px + T * h2, py + T * h1 * 2, T * 0.45, T * 0.16, 0, 0, TAU); c.fill(); }
      if (h2 < 0.06) { c.fillStyle = '#7c8799'; c.beginPath(); c.ellipse(px + 24, py + 30, 7, 4.5, 0, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(px + 20, py + 26, 7, 2); }
    } else if (kind === 'carpet') {
      c.fillStyle = ((x + y) & 1) ? th[1] : th[0]; c.fillRect(px, py, T, T);
      c.fillStyle = 'rgba(255,255,255,0.06)';
      for (i = 0; i < 4; i++) c.fillRect(px + 6 + i * 11, py + 6 + ((i & 1) ? 18 : 0), 5, 5);
      c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(px, py + T - 1, T, 1); c.fillRect(px + T - 1, py, 1, T);
    } else if (kind === 'wood') {
      for (i = 0; i < 4; i++) {
        var pyy = py + i * (T / 4), off = ((y * 4 + i) * 37 % 3) * 16;
        c.fillStyle = (hash(x, y * 4 + i) < 0.5) ? th[0] : th[1]; c.fillRect(px, pyy, T, T / 4);
        c.fillStyle = 'rgba(0,0,0,0.20)'; c.fillRect(px, pyy + T / 4 - 1.5, T, 1.5);
        c.fillRect(px + (off + x * 16) % T, pyy, 1.5, T / 4);
        c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(px, pyy, T, 1);
      }
    } else if (kind === 'grass') {
      c.fillStyle = ((x + y) & 1) ? th[1] : th[0]; c.fillRect(px, py, T, T);
      c.strokeStyle = 'rgba(20,60,20,0.35)'; c.lineWidth = 1.5;
      for (i = 0; i < 6; i++) {
        var gx = px + hash(x * 9 + i, y) * (T - 6) + 3, gy = py + hash(y * 9 + i, x) * (T - 8) + 6;
        c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx - 2, gy - 5); c.moveTo(gx, gy); c.lineTo(gx + 2, gy - 6); c.stroke();
      }
      if (h1 < 0.07) { c.fillStyle = h2 < 0.5 ? '#ffd84a' : '#ff8fc8'; c.beginPath(); c.arc(px + 20, py + 22, 3, 0, TAU); c.fill(); }
    } else { // dirt
      c.fillStyle = th[0]; c.fillRect(px, py, T, T);
      c.fillStyle = 'rgba(0,0,0,0.10)';
      for (i = 0; i < 6; i++) c.fillRect(px + hash(x * 3 + i, y * 2) * (T - 5), py + hash(y * 3 + i, x * 2) * (T - 5), 4, 3);
      c.fillStyle = 'rgba(255,255,255,0.08)';
      for (i = 0; i < 4; i++) c.fillRect(px + hash(x + i * 11, y) * (T - 3), py + hash(y + i * 11, x) * (T - 3), 2, 2);
    }
  }

  function drawFloorCell(c, x, y) {
    var m = M(), ri = m.cellRoom[y * m.W + x], room = ri >= 0 ? m.rooms[ri] : null;
    var mth = m.theme || {};
    var kind = room ? room.floor : (mth.hallFloor || 'hall');
    var th = (room && room.tint) || (room && !mth.hall && THEME[room.id]) || mth.hall || THEME.hall;
    var px = x * T, py = y * T;
    if (kind === 'snow' || kind === 'carpet' || kind === 'wood' || kind === 'grass' || kind === 'dirt') {
      drawFloorExtra(c, kind, th, x, y, px, py);
      return;
    }
    var im = img(FLOOR_IMG[kind]);
    if (im) {
      c.drawImage(im, px, py, T, T);
      c.globalAlpha = 0.16; c.fillStyle = th[0]; c.fillRect(px, py, T, T); c.globalAlpha = 1;
      return;
    }
    var alt = ((x + y) & 1) === 1;
    if (kind === 'room') {
      c.fillStyle = alt ? th[1] : th[0];
      c.fillRect(px, py, T, T);
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(px + 2, py + 2, T - 4, 2); c.fillRect(px + 2, py + 2, 2, T - 4);
      c.fillStyle = 'rgba(0,0,0,0.13)';
      c.fillRect(px + 2, py + T - 4, T - 4, 2); c.fillRect(px + T - 4, py + 2, 2, T - 4);
      c.fillStyle = 'rgba(0,0,0,0.16)';
      c.fillRect(px, py, T, 1); c.fillRect(px, py, 1, T);
    } else if (kind === 'tech') {
      c.fillStyle = th[0]; c.fillRect(px, py, T, T);
      // diamond plate
      c.fillStyle = 'rgba(255,255,255,0.07)';
      for (var j = 0; j < 4; j++) for (var i = 0; i < 4; i++) {
        var ox = px + 6 + i * 12 + (j & 1) * 6, oy = py + 6 + j * 12;
        c.save(); c.translate(ox, oy); c.rotate(((i + j) & 1) ? 0.7 : -0.7); c.fillRect(-3.5, -1, 7, 2); c.restore();
      }
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.fillRect(px, py, T, 1.5); c.fillRect(px, py, 1.5, T);
      c.fillStyle = 'rgba(255,255,255,0.06)';
      c.fillRect(px + 1.5, py + 1.5, T - 1.5, 1);
      if (hash(x, y) < 0.18) { c.fillStyle = 'rgba(0,0,0,0.07)'; c.fillRect(px + 2, py + 2, T - 3, T - 3); }
    } else { // hall: metal grating
      c.fillStyle = th[0]; c.fillRect(px, py, T, T);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      for (var g = 0; g < 6; g++) c.fillRect(px + 4, py + 4 + g * 7.4, T - 8, 3);
      c.fillStyle = 'rgba(255,255,255,0.06)';
      for (g = 0; g < 6; g++) c.fillRect(px + 4, py + 7 + g * 7.4, T - 8, 1);
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1.5;
      c.strokeRect(px + 2.5, py + 2.5, T - 5, T - 5);
    }
  }

  function drawFloorShadows(c, x, y) {
    var px = x * T, py = y * T, g;
    if (cellAt(x, y - 1) === 2) {
      g = c.createLinearGradient(0, py, 0, py + 22);
      g.addColorStop(0, 'rgba(8,10,25,0.42)'); g.addColorStop(1, 'rgba(8,10,25,0)');
      c.fillStyle = g; c.fillRect(px, py, T, 22);
    }
    if (cellAt(x - 1, y) === 2) {
      g = c.createLinearGradient(px, 0, px + 12, 0);
      g.addColorStop(0, 'rgba(8,10,25,0.32)'); g.addColorStop(1, 'rgba(8,10,25,0)');
      c.fillStyle = g; c.fillRect(px, py, 12, T);
    }
    if (cellAt(x + 1, y) === 2) {
      g = c.createLinearGradient(px + T, 0, px + T - 12, 0);
      g.addColorStop(0, 'rgba(8,10,25,0.32)'); g.addColorStop(1, 'rgba(8,10,25,0)');
      c.fillStyle = g; c.fillRect(px + T - 12, py, 12, T);
    }
  }

  function drawWallCell(c, x, y) {
    var px = x * T, py = y * T;
    var front = cellAt(x, y + 1) === 1;
    var nUp = cellAt(x, y - 1), nL = cellAt(x - 1, y), nR = cellAt(x + 1, y);
    if (front) {
      var lip = nUp === 1 ? 12 : 0;
      if (lip) { c.fillStyle = WALL_TOP; c.fillRect(px, py, T, lip); }
      var wim = M().theme && M().theme.wall ? null : img('wall');
      if (wim) {
        c.drawImage(wim, px, py + lip, T, T - lip);
      } else {
        var g = c.createLinearGradient(0, py + lip, 0, py + T);
        g.addColorStop(0, WALL_FACE_A); g.addColorStop(0.78, WALL_FACE_B); g.addColorStop(0.78, WALL_BASE); g.addColorStop(1, WALL_BASE);
        c.fillStyle = g; c.fillRect(px, py + lip, T, T - lip);
        // panel seams and a light strip
        c.fillStyle = 'rgba(0,0,0,0.22)';
        if ((x & 1) === 0) c.fillRect(px, py + lip, 2, T * 0.78 - lip);
        c.fillStyle = 'rgba(255,255,255,0.10)';
        c.fillRect(px, py + lip + 4, T, 3);
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.fillRect(px + 8, py + lip + 14, T - 16, Math.max(4, T * 0.78 - lip - 22));
        if (hash(x, y) < 0.22) { c.fillStyle = 'rgba(120,230,255,0.55)'; c.fillRect(px + 10 + hash(y, x) * 20, py + lip + 18, 5, 3); }
      }
      // top edge highlight / bottom outline
      c.fillStyle = 'rgba(190,205,255,0.35)'; c.fillRect(px, py + lip, T, 2);
      c.fillStyle = OL; c.fillRect(px, py + T - 2.5, T, 2.5);
      if (lip) c.fillRect(px, py, T, 2.5);
    } else {
      c.fillStyle = WALL_TOP; c.fillRect(px, py, T, T);
      c.fillStyle = 'rgba(255,255,255,0.035)';
      c.fillRect(px + 6, py + 6, T - 12, T - 12);
      if (cellAt(x, y + 1) === 0) { c.fillStyle = '#1a2036'; c.fillRect(px, py + T - 8, T, 8); }
      // inner rim where the top face meets floor (bottom walls, side walls)
      c.fillStyle = WALL_TOP_HI;
      if (nUp === 1) c.fillRect(px, py, T, 5);
      if (nL === 1) c.fillRect(px, py, 5, T);
      if (nR === 1) c.fillRect(px + T - 5, py, 5, T);
      c.fillStyle = OL;
      if (nUp === 1) c.fillRect(px, py, T, 2.5);
      if (nL === 1) c.fillRect(px, py, 2.5, T);
      if (nR === 1) c.fillRect(px + T - 2.5, py, 2.5, T);
    }
    // hull edge toward space
    c.fillStyle = '#0a0d18';
    if (nUp === 0) c.fillRect(px, py, T, 3);
    if (nL === 0) c.fillRect(px, py, 3, T);
    if (nR === 0) c.fillRect(px + T - 3, py, 3, T);
    if (cellAt(x, y + 1) === 0) c.fillRect(px, py + T - 3, T, 3);
    // side outline of front faces next to floor (doorway jambs)
    if (front) {
      c.fillStyle = OL;
      if (nL === 1) c.fillRect(px, py, 2.5, T);
      if (nR === 1) c.fillRect(px + T - 2.5, py, 2.5, T);
    }
  }

  function renderChunk(cx, cy, S) {
    var m = M();
    var c0 = mk(CHUNK * S, CHUNK * S), c = c0.getContext('2d', chunkOpaque(cx, cy) ? { alpha: false } : undefined);
    c.setTransform(S, 0, 0, S, -cx * CHUNK * S, -cy * CHUNK * S);
    var x0 = Math.floor(cx * CHUNK / T) - 1, y0 = Math.floor(cy * CHUNK / T) - 1;
    var x1 = Math.ceil((cx + 1) * CHUNK / T) + 1, y1 = Math.ceil((cy + 1) * CHUNK / T) + 1;
    var x, y, v;
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) if (cellAt(x, y) === 1) drawFloorCell(c, x, y);
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) if (cellAt(x, y) === 1) drawFloorShadows(c, x, y);
    // room labels on the floor
    c.textAlign = 'center'; c.textBaseline = 'middle';
    m.rooms.forEach(function (r) {
      var lx = (r.x + r.w / 2 + r.label[0]) * T, ly = (r.y + r.h / 2 + r.label[1]) * T;
      if (lx < cx * CHUNK - 400 || lx > (cx + 1) * CHUNK + 400 || ly < cy * CHUNK - 60 || ly > (cy + 1) * CHUNK + 60) return;
      c.font = '30px ' + fontD();
      var mth = m.theme || {};
      var tn = (r.tint || (!mth.hall && THEME[r.id]) || mth.hall || THEME.hall)[0];
      var n = parseInt(tn.slice(1), 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
      c.fillStyle = 'rgba(10,14,30,0.20)';
      c.fillText(r.name.toUpperCase(), lx + 2, ly + 3);
      c.fillStyle = lum > 0.68 ? 'rgba(30,40,80,0.30)' : 'rgba(255,255,255,0.30)';
      c.fillText(r.name.toUpperCase(), lx, ly);
    });
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) if (cellAt(x, y) === 2) drawWallCell(c, x, y);
    // flat & wall-mounted props
    var bx0 = cx * CHUNK - 40, by0 = cy * CHUNK - 40, bx1 = (cx + 1) * CHUNK + 40, by1 = (cy + 1) * CHUNK + 40;
    for (var i = 0; i < m.props.length; i++) {
      v = m.props[i];
      if (!(v.flat || v.wall)) continue;
      if (v.x > bx1 || v.y > by1 || v.x + v.w < bx0 || v.y + v.h < by0) continue;
      drawPropSprite(c, v, S);
    }
    return c0;
  }

  var emptyChunk = null;
  function chunkHasContent(cx, cy) {
    if (!emptyChunk) {
      var m = M(), nx = Math.ceil(m.W * T / CHUNK), ny = Math.ceil(m.H * T / CHUNK);
      emptyChunk = { nx: nx, ny: ny, a: new Uint8Array(nx * ny) };
      for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
        var any = false, all = true;
        for (var y = Math.floor(j * CHUNK / T); y < Math.ceil((j + 1) * CHUNK / T); y++)
          for (var x = Math.floor(i * CHUNK / T); x < Math.ceil((i + 1) * CHUNK / T); x++) { if (cellAt(x, y) !== 0) any = true; else all = false; }
        emptyChunk.a[j * nx + i] = all ? 2 : any ? 1 : 0;
      }
    }
    if (cx < 0 || cy < 0 || cx >= emptyChunk.nx || cy >= emptyChunk.ny) return false;
    return emptyChunk.a[cy * emptyChunk.nx + cx] > 0;
  }
  function chunkOpaque(cx, cy) {
    chunkHasContent(0, 0);
    if (cx < 0 || cy < 0 || cx >= emptyChunk.nx || cy >= emptyChunk.ny) return false;
    return emptyChunk.a[cy * emptyChunk.nx + cx] === 2;
  }
  function getChunk(cx, cy, S) {
    var key = cx + ',' + cy, c = chunks.get(key);
    if (c) { chunks.delete(key); chunks.set(key, c); return c; }
    c = renderChunk(cx, cy, S);
    chunks.set(key, c);
    var max = chunkCap;
    while (chunks.size > max) chunks.delete(chunks.keys().next().value);
    return c;
  }

  // ------------------------------------------------------------------------------------------
  // Props (vector fallbacks; IS.assets image used when present)
  // ------------------------------------------------------------------------------------------
  var EXT = { prop_table: 16, emergency: 26, prop_engine: 44, prop_reactor: 96, prop_crate: 28, prop_console: 30,
    prop_chair: 22, prop_plant: 40, prop_barrel: 26, prop_bed: 12, fuelport: 18, handstand: 34, secdesk: 30, cabinet: 40,
    generator: 46, admintable: 20, gunseat: 34, navconsole: 30, shieldgen: 54 };
  var SCREEN = { cyan: '#5fe3ff', amber: '#ffc44d', green: '#6dff9a' };

  // 2.5D box: footprint (x,y,w,h) raised by height H. Top face then front face.
  function box(c, x, y, w, h, H, top, front, r) {
    r = r || 4;
    rr(c, x, y - H, w, h + H, r);
    c.fillStyle = front; c.fill();
    rr(c, x, y - H, w, h, r);
    c.fillStyle = top; c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x + r, y - H + 1.5, w - 2 * r, 2);
    rr(c, x, y - H, w, h + H, r);
    c.strokeStyle = OL; c.lineWidth = 2.5; c.stroke();
    c.beginPath(); c.moveTo(x + 1, y + h - H); c.lineTo(x + w - 1, y + h - H);
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1.5; c.stroke();
  }
  function screen(c, x, y, w, h, color) {
    rr(c, x, y, w, h, 3); c.fillStyle = '#0f1b2e'; c.fill();
    c.save(); rr(c, x, y, w, h, 3); c.clip();
    var g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 0.35; c.fillStyle = g; c.fillRect(x, y, w, h);
    c.globalAlpha = 0.9; c.fillStyle = color;
    for (var i = 0; i < 3; i++) c.fillRect(x + 3, y + 3 + i * (h - 4) / 3, (w - 6) * (0.4 + 0.5 * hash(i, w | 0)), 1.6);
    c.restore();
    rr(c, x, y, w, h, 3); c.strokeStyle = OL; c.lineWidth = 1.6; c.stroke();
  }
  function hazard(c, x, y, w, h) {
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = '#f2c230'; c.fillRect(x, y, w, h);
    c.fillStyle = '#222';
    for (var i = -h; i < w + h; i += 10) { c.beginPath(); c.moveTo(x + i, y + h); c.lineTo(x + i + 5, y + h); c.lineTo(x + i + 5 + h, y); c.lineTo(x + i + h, y); c.fill(); }
    c.restore();
  }
  function cylinder(c, x, y, w, h, H, body, dark, top) {
    var ry = Math.min(h / 2, w * 0.28);
    var g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, dark); g.addColorStop(0.35, body); g.addColorStop(1, dark);
    c.beginPath();
    c.moveTo(x, y + h - ry - H); c.lineTo(x, y + h - ry);
    c.ellipse(x + w / 2, y + h - ry, w / 2, ry, 0, Math.PI, 0, true);
    c.lineTo(x + w, y + h - ry - H);
    c.closePath();
    c.fillStyle = g; c.fill(); c.strokeStyle = OL; c.lineWidth = 2.5; c.stroke();
    ell(c, x + w / 2, y + h - ry - H, w / 2, ry); fillStroke(c, top, OL, 2.5);
  }

  var DRAW = {
    prop_table: function (c, w, h) {
      var r = w / 2;
      ell(c, r, h / 2 + 6, r * 0.98, h * 0.42); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
      // stools
      for (var i = 0; i < 5; i++) {
        var a = -Math.PI / 2 + i * TAU / 5 + 0.3, sx = r + Math.cos(a) * r * 0.98, sy = h / 2 + Math.sin(a) * h * 0.4;
        ell(c, sx, sy, 9, 6); fillStroke(c, '#7c88a6', OL, 2);
      }
      ell(c, r, h / 2 - 2, r * 0.82, h * 0.34 + 2);
      fillStroke(c, '#5d6987', OL, 2.5);
      ell(c, r, h / 2 - 10, r * 0.82, h * 0.34);
      var g = c.createRadialGradient(r * 0.8, h / 2 - 18, 4, r, h / 2 - 10, r);
      g.addColorStop(0, '#e9eef8'); g.addColorStop(1, '#b6c0d6');
      fillStroke(c, g, OL, 2.5);
      ell(c, r, h / 2 - 10, r * 0.55, h * 0.2); c.strokeStyle = 'rgba(80,95,130,0.35)'; c.lineWidth = 2; c.stroke();
    },
    emergency: function (c, w, h) {
      var r = w / 2;
      ell(c, r, h / 2 + 6, r, h * 0.42); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
      ell(c, r, h / 2 - 2, r * 0.92, h * 0.36 + 3); fillStroke(c, '#4c5776', OL, 2.5);
      ell(c, r, h / 2 - 10, r * 0.92, h * 0.36);
      var g = c.createRadialGradient(r * 0.8, h / 2 - 18, 4, r, h / 2 - 10, r);
      g.addColorStop(0, '#c9d2e6'); g.addColorStop(1, '#8a96b4');
      fillStroke(c, g, OL, 2.5);
      var bim = img('button');
      if (bim) {
        var bw = w * 0.62, bh = bw * (bim.naturalHeight || bim.height) / (bim.naturalWidth || bim.width);
        c.drawImage(bim, r - bw / 2, h / 2 - 12 - bh * 0.8, bw, bh);
        return;
      }
      ell(c, r, h / 2 - 12, 18, 10); fillStroke(c, '#30364a', OL, 2);
      // red button
      c.beginPath(); c.ellipse(r, h / 2 - 16, 13, 8, 0, 0, TAU); fillStroke(c, '#8f0d18', null);
      c.beginPath(); c.ellipse(r, h / 2 - 20, 13, 8, 0, 0, TAU); fillStroke(c, '#e5232f', OL, 2);
      c.beginPath(); c.ellipse(r - 4, h / 2 - 22, 5, 2.5, -0.2, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
      // glass dome
      c.beginPath(); c.ellipse(r, h / 2 - 18, 19, 18, 0, Math.PI, 0); c.ellipse(r, h / 2 - 12, 19, 8, 0, 0, Math.PI);
      c.fillStyle = 'rgba(190,235,255,0.22)'; c.fill(); c.strokeStyle = 'rgba(220,245,255,0.75)'; c.lineWidth = 1.5; c.stroke();
      c.beginPath(); c.arc(r - 6, h / 2 - 26, 8, Math.PI * 1.1, Math.PI * 1.5); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2.5; c.stroke();
    },
    prop_engine: function (c, w, h, ext) {
      var top = -ext + 6, bot = h - 4, cy = (top + bot) / 2, hh = bot - top;
      // exhaust flame (left)
      var fg = c.createLinearGradient(0, 0, w * 0.32, 0);
      fg.addColorStop(0, 'rgba(255,120,40,0)'); fg.addColorStop(0.5, 'rgba(255,150,60,0.6)'); fg.addColorStop(1, 'rgba(255,230,140,0.95)');
      c.beginPath(); c.moveTo(w * 0.3, cy - hh * 0.28); c.quadraticCurveTo(-4, cy - hh * 0.1, -6, cy); c.quadraticCurveTo(-4, cy + hh * 0.1, w * 0.3, cy + hh * 0.28);
      c.fillStyle = fg; c.fill();
      // nozzle
      c.beginPath(); c.moveTo(w * 0.17, cy - hh * 0.36); c.lineTo(w * 0.34, cy - hh * 0.46); c.lineTo(w * 0.34, cy + hh * 0.46); c.lineTo(w * 0.17, cy + hh * 0.36); c.closePath();
      fillStroke(c, '#3b4260', OL, 2.5);
      ell(c, w * 0.17, cy, 8, hh * 0.36); fillStroke(c, '#ffb347', OL, 2);
      ell(c, w * 0.17, cy, 4, hh * 0.25); c.fillStyle = '#fff2c4'; c.fill();
      // body
      var g = c.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, '#d4dbe9'); g.addColorStop(0.45, '#97a3bf'); g.addColorStop(1, '#4e5874');
      rr(c, w * 0.32, top, w * 0.62, hh, hh * 0.3); fillStroke(c, g, OL, 3);
      c.strokeStyle = 'rgba(30,36,60,0.45)'; c.lineWidth = 2;
      for (var i = 1; i < 5; i++) { var xx = w * 0.32 + i * w * 0.62 / 5; c.beginPath(); c.moveTo(xx, top + 4); c.lineTo(xx, bot - 4); c.stroke(); }
      hazard(c, w * 0.36, cy - 5, w * 0.12, 10);
      // cap
      ell(c, w * 0.94, cy, w * 0.06, hh * 0.45); fillStroke(c, '#7d88a6', OL, 2.5);
      // pipe on top
      rr(c, w * 0.5, top - 10, w * 0.3, 12, 5); fillStroke(c, '#5c6787', OL, 2);
    },
    prop_reactor: function (c, w, h, ext) {
      var r = w / 2, base = h * 0.62;
      var glow = c.createRadialGradient(r, base - ext * 0.4, 10, r, base - ext * 0.4, w * 0.75);
      glow.addColorStop(0, 'rgba(90,240,255,0.35)'); glow.addColorStop(1, 'rgba(90,240,255,0)');
      c.fillStyle = glow; c.fillRect(-20, -ext - 20, w + 40, h + ext + 40);
      ell(c, r, base + 6, r, h * 0.36); fillStroke(c, '#2f3654', OL, 3);
      ell(c, r, base - 2, r * 0.94, h * 0.32); fillStroke(c, '#59648a', OL, 2.5);
      ell(c, r, base - 4, r * 0.6, h * 0.2); fillStroke(c, '#3a4366', OL, 2);
      // core column
      var cw = w * 0.36, top = -ext + 14;
      var g = c.createLinearGradient(r - cw / 2, 0, r + cw / 2, 0);
      g.addColorStop(0, '#1f8fb3'); g.addColorStop(0.4, '#8ff6ff'); g.addColorStop(1, '#1b7ca0');
      rr(c, r - cw / 2, top, cw, base - top - 4, 10); fillStroke(c, g, OL, 2.5);
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(r - cw / 2 + 7, top + 10); c.lineTo(r - cw / 2 + 7, base - 14); c.stroke();
      // rings
      for (var i = 0; i < 3; i++) {
        var yy = top + 16 + i * (base - top - 30) / 2;
        ell(c, r, yy, cw / 2 + 8, 6); fillStroke(c, '#a9b4d0', OL, 2);
      }
      ell(c, r, top, cw / 2 + 4, 7); fillStroke(c, '#c7d0e6', OL, 2.5);
    },
    prop_crate: function (c, w, h, ext) {
      var H = Math.min(ext, h * 0.9);
      box(c, 1, 0, w - 2, h - 1, H, '#c99a5b', '#93693a', 4);
      c.strokeStyle = 'rgba(70,40,15,0.55)'; c.lineWidth = 2;
      c.strokeRect(6, -H + 5, w - 12, h - 11);
      c.beginPath(); c.moveTo(6, -H + 5); c.lineTo(w - 6, -H + h - 6); c.moveTo(w - 6, -H + 5); c.lineTo(6, -H + h - 6); c.stroke();
      c.fillStyle = 'rgba(70,40,15,0.35)'; c.fillRect(6, h - H + 4, w - 12, 3);
    },
    prop_console: function (c, w, h, ext, p) {
      var sc = SCREEN[p.tint] || SCREEN.cyan;
      box(c, 1, 2, w - 2, h - 3, ext, '#56628a', '#353f60', 5);
      screen(c, 8, -ext + 6, w - 16, h * 0.5, sc);
      for (var i = 0; i < 4; i++) {
        c.beginPath(); c.arc(12 + i * (w - 24) / 3, -ext + h * 0.5 + 14, 3, 0, TAU);
        c.fillStyle = ['#ff5a5a', '#ffd84d', '#5aff8a', '#5ac8ff'][i]; c.fill();
      }
    },
    prop_chair: function (c, w, h) {
      ell(c, w / 2, h - 6, w * 0.32, 5); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
      c.fillStyle = '#2c3350'; c.fillRect(w / 2 - 2, h * 0.4, 4, h * 0.45);
      rr(c, w * 0.18, -16, w * 0.64, 22, 6); fillStroke(c, '#4f5a7e', OL, 2.5);
      ell(c, w / 2, h * 0.38, w * 0.4, h * 0.22); fillStroke(c, '#66729a', OL, 2.5);
    },
    prop_plant: function (c, w, h) {
      ell(c, w / 2, h - 4, w * 0.45, 6); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
      var leaves = [[-0.9, 0.95], [0.9, 0.95], [-0.35, 1.25], [0.35, 1.25], [0, 1.45], [-1.3, 0.55], [1.3, 0.55]];
      leaves.forEach(function (l, i) {
        c.save(); c.translate(w / 2, h * 0.3); c.rotate(l[0] * 0.55);
        ell(c, 0, -14 * l[1], 6.5, 16 * l[1] * 0.7);
        fillStroke(c, i % 2 ? '#3fae55' : '#2f9146', OL, 2);
        c.restore();
      });
      c.beginPath(); c.moveTo(w * 0.15, h * 0.3); c.lineTo(w * 0.85, h * 0.3); c.lineTo(w * 0.74, h - 2); c.lineTo(w * 0.26, h - 2); c.closePath();
      fillStroke(c, '#d9dfef', OL, 2.5);
      c.fillStyle = '#9aa6c3'; c.fillRect(w * 0.2, h * 0.3 + 4, w * 0.6, 4);
    },
    prop_barrel: function (c, w, h, ext, p) {
      var t = p.tint;
      var body = t === 'fuel' ? '#f0b432' : t === 'o2' ? '#dff3ff' : '#7f8bab';
      var dark = t === 'fuel' ? '#a86b12' : t === 'o2' ? '#7fa9c4' : '#4b5573';
      var topc = t === 'fuel' ? '#ffd772' : t === 'o2' ? '#ffffff' : '#a9b4cf';
      cylinder(c, 2, 0, w - 4, h - 2, ext, body, dark, topc);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(3, h * 0.3 - ext * 0.3, w - 6, 3); c.fillRect(3, h * 0.6, w - 6, 3);
      if (t === 'fuel') { c.fillStyle = '#d33'; c.fillRect(w / 2 - 6, h * 0.25 - ext * 0.1, 12, 8); }
      if (t === 'o2') { c.fillStyle = '#2aa0d8'; c.font = 'bold 11px ' + fontB(); c.textAlign = 'center'; c.fillText('O2', w / 2, h * 0.35); }
    },
    prop_bed: function (c, w, h, ext) {
      box(c, 2, 0, w - 4, h - 2, ext, '#e8eef8', '#8f9bb8', 6);
      rr(c, 8, -ext + 6, w - 16, 24, 8); fillStroke(c, '#ffffff', OL, 2);
      rr(c, 4, -ext + h * 0.42, w - 8, h * 0.55, 6); fillStroke(c, '#5fa4e8', OL, 2);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(8, -ext + h * 0.42 + 4, w - 16, 3);
    },
    prop_screen: function (c, w, h) {
      rr(c, 0, 0, w, h - 4, 4); fillStroke(c, '#2a3150', OL, 2.5);
      screen(c, 4, 4, w - 8, h - 14, '#5fe3ff');
    },
    wallscreen: function (c, w, h) {
      rr(c, 0, 0, w, h - 4, 4); fillStroke(c, '#2a3150', OL, 2.5);
      screen(c, 4, 4, w - 8, h - 14, '#6dff9a');
      c.fillStyle = '#6dff9a'; c.beginPath(); c.moveTo(w / 2 - 6, h / 2 - 6); c.lineTo(w / 2 + 6, h / 2 - 6); c.lineTo(w / 2, h / 2 + 3); c.fill();
    },
    window: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 6); fillStroke(c, '#59658a', OL, 2.5);
      rr(c, 4, 4, w - 8, h - 10, 4);
      var g = c.createLinearGradient(0, 4, 0, h - 6); g.addColorStop(0, '#0c1636'); g.addColorStop(1, '#1a2c5c');
      fillStroke(c, g, OL, 1.5);
      c.fillStyle = '#fff';
      for (var i = 0; i < 6; i++) c.fillRect(6 + hash(i, 3) * (w - 12), 6 + hash(3, i) * (h - 14), 1.6, 1.6);
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(8, h - 12); c.lineTo(w - 12, 8); c.stroke();
    },
    wallpanel: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 4); fillStroke(c, '#8b96b2', OL, 2.5);
      rr(c, 4, 4, w - 8, h - 10, 3); fillStroke(c, '#3a4262', null);
      ['#ff4b4b', '#4b8bff', '#ffd84b', '#ff5ad6'].forEach(function (cc, i) {
        c.fillStyle = cc; c.fillRect(6, 7 + i * (h - 14) / 4, w - 12, 3);
      });
    },
    chute: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 5); fillStroke(c, '#7b86a4', OL, 2.5);
      rr(c, 6, 6, w - 12, h * 0.42, 4); fillStroke(c, '#1b2033', OL, 1.5);
      hazard(c, 4, h - 14, w - 8, 6);
      c.fillStyle = '#ffd23f'; c.fillRect(w - 8, 8, 4, h * 0.5);
      ell(c, w - 6, 8, 4, 4); fillStroke(c, '#ff4b4b', OL, 1.5);
    },
    fuelport: function (c, w, h, ext) {
      box(c, 2, 0, w - 4, h - 1, ext, '#f0c040', '#b07a14', 4);
      ell(c, w / 2, -ext + h / 2, 7, 5); fillStroke(c, '#3a2c10', OL, 1.5);
    },
    handscan: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 5); fillStroke(c, '#5d6990', OL, 2.5);
      rr(c, 4, 4, w - 8, h - 10, 4); fillStroke(c, '#183248', OL, 1.5);
      hand(c, w / 2, h / 2 + 1, 0.55);
    },
    handstand: function (c, w, h, ext) {
      c.fillStyle = '#353f60'; c.fillRect(w / 2 - 6, -ext * 0.4, 12, h + ext * 0.4 - 4);
      ell(c, w / 2, h - 6, w * 0.4, 6); fillStroke(c, '#2a3150', OL, 2);
      c.save(); c.translate(0, -ext);
      rr(c, 2, 0, w - 4, h * 0.9, 6); fillStroke(c, '#5d6990', OL, 2.5);
      rr(c, 6, 4, w - 12, h * 0.9 - 8, 4); fillStroke(c, '#183248', OL, 1.5);
      hand(c, w / 2, h * 0.45, 0.6);
      c.restore();
    },
    secdesk: function (c, w, h, ext) {
      box(c, 1, 2, w - 2, h - 3, ext, '#4f5a80', '#323b5c', 5);
      for (var i = 0; i < 4; i++) screen(c, 6 + i * (w - 12) / 4, -ext + 5, (w - 12) / 4 - 4, h * 0.55, i % 2 ? '#6dff9a' : '#5fe3ff');
    },
    cabinet: function (c, w, h, ext) {
      box(c, 1, 0, w - 2, h - 2, ext, '#eef3fb', '#b7c3da', 5);
      c.fillStyle = '#e33'; c.fillRect(w / 2 - 3, h - ext - 4 + 6, 6, 16); c.fillRect(w / 2 - 8, h - ext - 4 + 11, 16, 6);
      c.strokeStyle = 'rgba(60,70,100,0.5)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(w / 2, h - ext + 1); c.lineTo(w / 2, h - 3); c.stroke();
    },
    scanpad: function (c, w, h) {
      ell(c, w / 2, h / 2, w / 2 - 2, h / 2 - 6); fillStroke(c, '#3c4566', OL, 2.5);
      ell(c, w / 2, h / 2, w / 2 - 9, h / 2 - 13);
      var g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(110,255,160,0.9)'); g.addColorStop(1, 'rgba(40,170,110,0.6)');
      fillStroke(c, g, '#1d6b4a', 2);
      c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1.5;
      ell(c, w / 2, h / 2, w / 4, h / 4 - 3); c.stroke();
      c.beginPath(); c.moveTo(w / 2, 12); c.lineTo(w / 2, h - 12); c.moveTo(12, h / 2); c.lineTo(w - 12, h / 2); c.stroke();
    },
    breaker: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 4); fillStroke(c, '#8c94a8', OL, 2.5);
      hazard(c, 3, 3, w - 6, 5);
      c.fillStyle = '#ffd23f';
      c.beginPath(); c.moveTo(w / 2 + 3, 10); c.lineTo(w / 2 - 6, h / 2 + 2); c.lineTo(w / 2, h / 2 + 2); c.lineTo(w / 2 - 3, h - 8); c.lineTo(w / 2 + 7, h / 2 - 3); c.lineTo(w / 2 + 1, h / 2 - 3); c.closePath();
      fillStroke(c, '#ffd23f', OL, 1.5);
    },
    calib: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 4); fillStroke(c, '#6f7a99', OL, 2.5);
      for (var i = 0; i < 3; i++) {
        var yy = 8 + i * (h - 14) / 3 + 3;
        c.fillStyle = '#1b2033'; c.fillRect(5, yy - 3, w - 10, 7);
        c.fillStyle = ['#ffd84b', '#5ac8ff', '#ff5a5a'][i]; c.fillRect(6, yy - 2, (w - 12) * (0.3 + 0.25 * i), 5);
      }
    },
    divert: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 4); fillStroke(c, '#6f7a99', OL, 2.5);
      for (var i = 0; i < 4; i++) {
        var xx = 7 + i * (w - 14) / 3;
        c.fillStyle = '#1b2033'; c.fillRect(xx - 1.5, 6, 3, h - 14);
        rr(c, xx - 4, 8 + hash(i, 9) * (h - 22), 8, 5, 2); fillStroke(c, i === 2 ? '#ffd23f' : '#c6cde0', OL, 1);
      }
    },
    generator: function (c, w, h, ext) {
      box(c, 2, 0, w - 4, h - 2, ext, '#7a86a6', '#4b5573', 6);
      for (var i = 0; i < 3; i++) {
        ell(c, 12 + i * (w - 24) / 2, -ext + h / 2 - 4, 7, 7); fillStroke(c, '#30374f', OL, 2);
        ell(c, 12 + i * (w - 24) / 2, -ext + h / 2 - 4, 3, 3); c.fillStyle = '#ffd23f'; c.fill();
      }
      hazard(c, 6, h - ext + 6, w - 12, 8);
    },
    admintable: function (c, w, h, ext) {
      box(c, 2, 0, w - 4, h - 2, ext, '#5b6790', '#39436a', 8);
      rr(c, 10, -ext + 8, w - 20, h - 18, 6);
      c.fillStyle = 'rgba(40,220,160,0.25)'; c.fill(); c.strokeStyle = '#3cf0b4'; c.lineWidth = 1.5; c.stroke();
      // mini station outline
      var m = M();
      if (m) {
        var sx = (w - 28) / (m.W * T), sy = (h - 26) / (m.H * T), s = Math.min(sx, sy);
        c.save(); c.translate(w / 2 - m.W * T * s / 2, -ext + 8 + (h - 18) / 2 - m.H * T * s / 2);
        c.fillStyle = 'rgba(120,255,200,0.75)';
        m.rooms.forEach(function (r) { c.fillRect(r.x * T * s, r.y * T * s, r.w * T * s, r.h * T * s); });
        c.fillStyle = 'rgba(120,255,200,0.4)';
        m.corridors.forEach(function (r) { c.fillRect(r.x * T * s, r.y * T * s, r.w * T * s, r.h * T * s); });
        c.restore();
      }
    },
    cardslot: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 4); fillStroke(c, '#7b86a4', OL, 2.5);
      c.fillStyle = '#12182a'; c.fillRect(5, h / 2 - 2, w - 10, 4);
      ell(c, w / 2, 9, 3.5, 3.5); c.fillStyle = '#5aff8a'; c.fill();
      rr(c, w / 2 - 9, h / 2 + 6, 18, 9, 2); fillStroke(c, '#e8ecff', OL, 1);
    },
    keypad: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 4); fillStroke(c, '#7b86a4', OL, 2.5);
      c.fillStyle = '#163a2c'; c.fillRect(5, 4, w - 10, 7);
      for (var j = 0; j < 3; j++) for (var i = 0; i < 3; i++) { c.fillStyle = '#d6dcea'; c.fillRect(7 + i * (w - 14) / 3, 14 + j * 7, (w - 14) / 3 - 2, 5); }
    },
    o2filter: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 5); fillStroke(c, '#7b86a4', OL, 2.5);
      rr(c, 5, 5, w - 10, h - 12, 3); fillStroke(c, '#2b3b3a', OL, 1.5);
      c.strokeStyle = 'rgba(160,220,200,0.45)'; c.lineWidth = 1.5;
      for (var i = 0; i < 5; i++) { c.beginPath(); c.moveTo(8, 9 + i * 5); c.lineTo(w - 8, 9 + i * 5); c.stroke(); }
      c.save(); c.translate(w / 2, h / 2 - 1); c.rotate(-0.6); ell(c, 0, 0, 4, 8); fillStroke(c, '#58c46a', OL, 1.2); c.restore();
    },
    commspanel: function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 4); fillStroke(c, '#6f7a99', OL, 2.5);
      ell(c, w / 2, h / 2, 10, 10); fillStroke(c, '#1b2033', OL, 1.5);
      c.strokeStyle = '#5fe3ff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2 + 6, h / 2 - 6); c.stroke();
      c.strokeStyle = 'rgba(95,227,255,0.6)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(w / 2, h / 2, 14, -0.8, 0.8); c.stroke();
    },
    gunseat: function (c, w, h, ext) {
      // targeting screen + seat
      c.fillStyle = '#2c3350'; c.fillRect(w / 2 - 5, -ext * 0.2, 10, h * 0.6);
      rr(c, 6, -ext, w - 12, h * 0.75, 8); fillStroke(c, '#3e486c', OL, 2.5);
      screen(c, 12, -ext + 6, w - 24, h * 0.75 - 12, '#ff6a5a');
      c.strokeStyle = '#ffb0a8'; c.lineWidth = 1.5;
      ell(c, w / 2, -ext + h * 0.37, 8, 8); c.stroke();
      c.beginPath(); c.moveTo(w / 2 - 12, -ext + h * 0.37); c.lineTo(w / 2 + 12, -ext + h * 0.37); c.moveTo(w / 2, -ext + h * 0.37 - 12); c.lineTo(w / 2, -ext + h * 0.37 + 12); c.stroke();
      ell(c, w / 2, h - 10, w * 0.3, 9); fillStroke(c, '#59648a', OL, 2.5);
    },
    navconsole: function (c, w, h, ext) {
      box(c, 1, 0, w - 2, h - 2, ext, '#56628a', '#353f60', 8);
      for (var i = 0; i < 3; i++) screen(c, 8, -ext + 8 + i * (h - 22) / 3, w - 16, (h - 22) / 3 - 6, i === 1 ? '#ffc44d' : '#5fe3ff');
    },
    shieldgen: function (c, w, h, ext) {
      var r = w / 2, base = h * 0.6;
      ell(c, r, base + 8, r, h * 0.34); fillStroke(c, '#2f3654', OL, 3);
      var top = -ext + 10;
      rr(c, r - w * 0.3, top + 20, w * 0.6, base - top - 16, 12); fillStroke(c, '#59648a', OL, 2.5);
      // hex dome
      var g = c.createRadialGradient(r - 8, top + 10, 4, r, top + 26, w * 0.45);
      g.addColorStop(0, '#d8f2ff'); g.addColorStop(0.5, '#6db8ff'); g.addColorStop(1, '#2a5cc0');
      c.beginPath();
      for (var k = 0; k < 6; k++) { var a = Math.PI / 6 + k * TAU / 6; c.lineTo(r + Math.cos(a) * w * 0.38, top + 30 + Math.sin(a) * w * 0.3); }
      c.closePath(); fillStroke(c, g, OL, 2.5);
      c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1.5;
      c.beginPath(); for (k = 0; k < 6; k++) { var b = Math.PI / 6 + k * TAU / 6; c.moveTo(r, top + 30); c.lineTo(r + Math.cos(b) * w * 0.38, top + 30 + Math.sin(b) * w * 0.3); } c.stroke();
    },
    vent: function (c, w, h) {
      rr(c, 0, 0, w, h, 6); fillStroke(c, '#7a86a6', OL, 2.5);
      rr(c, 5, 5, w - 10, h - 10, 3); fillStroke(c, '#141a2c', null);
      c.fillStyle = '#5b6687';
      for (var i = 0; i < 4; i++) c.fillRect(7, 7 + i * (h - 14) / 3.6, w - 14, 2.6);
      c.fillStyle = '#c4cce0';
      [[4, 4], [w - 4, 4], [4, h - 4], [w - 4, h - 4]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 1.6, 0, TAU); c.fill(); });
    }
  };
  function hand(c, x, y, s) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = '#5fe3ff';
    rr(c, -10, -4, 20, 18, 7); c.fill();
    for (var i = 0; i < 4; i++) { rr(c, -10 + i * 5.2, -18 + Math.abs(i - 1.5) * 3, 4.4, 16, 2.2); c.fill(); }
    c.save(); c.translate(-12, 2); c.rotate(-0.6); rr(c, -2, -8, 4.4, 12, 2.2); c.fill(); c.restore();
    c.restore();
  }

  function spriteKey(p) { return p.key + '|' + p.w + 'x' + p.h + '|' + (p.tint || ''); }
  function getSprite(p, S) {
    var key = spriteKey(p), s = sprites.get(key);
    if (s) return s;
    var ext = EXT[p.key] || 0, pad = 12;
    var w = p.w + pad * 2, h = p.h + ext + pad * 2;
    var cv = mk(w * S, h * S), c = cv.getContext('2d');
    c.scale(S, S); c.translate(pad, pad + ext);
    c.lineJoin = 'round'; c.lineCap = 'round';
    var im = img(p.key);
    if (im) {
      var bw = p.w, bh = p.h + ext, ar = (im.naturalWidth || im.width) / (im.naturalHeight || im.height);
      if (p.flat) c.drawImage(im, 0, 0, p.w, p.h);           // e.g. vents: fill the footprint
      else {
        var dw = bw, dh = bw / ar;
        if (dh > bh) { dh = bh; dw = bh * ar; }
        var dy = p.wall ? (p.h - dh) / 2 : p.round ? Math.min(p.h - dh, (p.h - ext) / 2 - dh / 2 + ext * 0.1) : p.h - dh;
        c.drawImage(im, (bw - dw) / 2, dy, dw, dh);
      }
    } else if (DRAW[p.key]) {
      DRAW[p.key](c, p.w, p.h, ext, p);
    } else {
      box(c, 0, 0, p.w, p.h, ext, '#7a86a6', '#4b5573', 4);
    }
    s = { c: cv, ox: -pad, oy: -pad - ext, w: w, h: h };
    sprites.set(key, s);
    return s;
  }
  function drawPropSprite(c, p, S) {
    var s = getSprite(p, S);
    c.drawImage(s.c, p.x + s.ox, p.y + s.oy, s.w, s.h);
  }
  function getOutline(p, S, color) {
    var key = spriteKey(p) + '|' + color, o = outlines.get(key);
    if (o) return o;
    var s = getSprite(p, S);
    var cv = mk(s.c.width, s.c.height), c = cv.getContext('2d');
    var d = 3.5 * S;
    for (var a = 0; a < 12; a++) c.drawImage(s.c, Math.cos(a * TAU / 12) * d, Math.sin(a * TAU / 12) * d);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = color; c.fillRect(0, 0, cv.width, cv.height);
    o = { c: cv, ox: s.ox, oy: s.oy, w: s.w, h: s.h };
    outlines.set(key, o);
    return o;
  }
  function drawOutlined(c, p, S, color, alpha) {
    var o = getOutline(p, S, color);
    c.globalAlpha = alpha;
    c.drawImage(o.c, p.x + o.ox, p.y + o.oy, o.w, o.h);
    c.globalAlpha = 1;
    drawPropSprite(c, p, S);
  }

  // ------------------------------------------------------------------------------------------
  // Crewmate
  // ------------------------------------------------------------------------------------------
  function bodyPath(c) {
    c.beginPath();
    c.moveTo(-15, -13);
    c.lineTo(-15, -38);
    c.bezierCurveTo(-15, -60, 17, -60, 17, -38);
    c.lineTo(17, -13);
    c.quadraticCurveTo(1, -9, -15, -13);
    c.closePath();
  }
  function ghostPath(c, t) {
    c.beginPath();
    c.moveTo(-15, -38);
    c.bezierCurveTo(-15, -60, 17, -60, 17, -38);
    c.lineTo(17, -16);
    for (var i = 0; i <= 8; i++) {
      var x = 17 - i * 4, y = -14 + Math.sin(t * 6 + i * 1.3) * 3 + (i % 2 ? 3 : -1);
      c.lineTo(x, y);
    }
    c.closePath();
  }
  function deadPath(c) {
    c.beginPath();
    c.moveTo(-15, -13);
    c.lineTo(-15, -28);
    c.lineTo(-9, -31); c.lineTo(-4, -28); c.lineTo(2, -32); c.lineTo(8, -28); c.lineTo(13, -31); c.lineTo(17, -28);
    c.lineTo(17, -13);
    c.quadraticCurveTo(1, -9, -15, -13);
    c.closePath();
  }
  function legPath(c, x, lift) {
    rr(c, x, -20 - lift, 13, 20, 6);
  }
  function packPath(c, dead) { if (dead) rr(c, -24, -29, 13, 12, 4); else rr(c, -24, -47, 13, 27, 5); }
  function visorPath(c) { rr(c, -1, -48, 23, 15, 7.5); }

  function drawCrewmate(c, x, y, colorIdx, opts) {
    opts = opts || {};
    var cc = col(colorIdx), main = cc[1], dark = cc[2];
    var s = opts.scale || 1, f = opts.facing < 0 ? -1 : 1;
    var t = opts.time !== undefined ? opts.time : performance.now() / 1000;
    var ghost = !!opts.ghost, dead = !!opts.dead;
    var walking = typeof opts.walk === 'number' && !ghost && !dead;
    var ph = walking ? Math.sin(opts.walk * TAU) : 0;
    var bob = walking ? -Math.abs(ph) * 2 : 0;
    var lb = walking ? Math.max(0, ph) * 4 : 0, lf = walking ? Math.max(0, -ph) * 4 : 0;
    var db = walking ? -ph * 4 : 0, dfr = walking ? ph * 4 : 0;
    c.save();
    c.translate(x, y);
    c.scale(s * f, s);
    c.lineJoin = 'round'; c.lineCap = 'round';
    if (!ghost) { ell(c, 1, 0, 19, 5.5); c.fillStyle = 'rgba(0,0,0,0.28)'; c.fill(); }
    if (ghost) { c.globalAlpha *= 0.5; c.translate(0, -8 + (opts.noBob ? 0 : Math.sin(t * 2.2) * 3)); }
    c.translate(0, bob);
    var outline = opts.outline || null;

    // pass 1: thick dark underlay = unified outline (and optional glow)
    var shapes = [];
    var drawShapes = function (fn) {
      packPath(c, dead); fn('pack');
      if (!ghost) { c.save(); c.translate(db, 0); legPath(c, -14, lb); fn('legb'); c.restore(); c.save(); c.translate(dfr, 0); legPath(c, 3, lf); fn('legf'); c.restore(); }
      if (ghost) ghostPath(c, t); else if (dead) deadPath(c); else bodyPath(c);
      fn('body');
      if (!dead) { visorPath(c); fn('visor'); }
    };
    if (outline) {
      c.strokeStyle = outline; c.lineWidth = 14;
      drawShapes(function () { c.stroke(); });
    }
    c.strokeStyle = OL; c.lineWidth = 6.5;
    drawShapes(function () { c.stroke(); });

    // pass 2: fills
    // backpack
    packPath(c, dead); c.fillStyle = dark; c.fill();
    if (!dead) { rr(c, -22, -45, 8, 13, 4); c.fillStyle = main; c.fill(); }
    if (!ghost) {
      c.save(); c.translate(db, 0); legPath(c, -14, lb); c.fillStyle = dark; c.fill(); c.restore();
      c.save(); c.translate(dfr, 0); legPath(c, 3, lf); c.fillStyle = main; c.fill();
      c.fillStyle = dark; c.fillRect(3, -4 - lf, 13, 4); c.restore();
    }
    // body with shadow side
    if (ghost) ghostPath(c, t); else if (dead) deadPath(c); else bodyPath(c);
    c.fillStyle = dark; c.fill();
    c.save();
    c.clip();
    c.translate(4.5, -3.5);
    if (ghost) ghostPath(c, t); else if (dead) deadPath(c); else bodyPath(c);
    c.fillStyle = main; c.fill();
    c.restore();
    if (!dead) {
      // soft highlight
      ell(c, 8, -52, 5, 2.5); c.fillStyle = 'rgba(255,255,255,0.22)'; c.fill();
      // visor
      visorPath(c); c.fillStyle = '#3d6577'; c.fill();
      rr(c, 0, -48, 21, 12, 6); c.fillStyle = '#9fd5ea'; c.fill();
      rr(c, 9, -45.5, 9, 3.6, 1.8); c.fillStyle = '#eaffff'; c.fill();
      visorPath(c); c.strokeStyle = OL; c.lineWidth = 2.4; c.stroke();
    } else {
      // cut + bone
      ell(c, 1, -28.5, 15, 3.5); c.fillStyle = '#f0b6be'; c.fill();
      c.fillStyle = '#f4f1ea'; c.strokeStyle = OL; c.lineWidth = 2;
      rr(c, -1, -42, 5, 15, 2); c.fill(); c.stroke();
      c.beginPath(); c.arc(-1, -42, 3.6, 0, TAU); c.arc(4, -42, 3.6, 0, TAU); c.fill();
      c.beginPath(); c.arc(-1, -42, 3.6, Math.PI * 0.5, Math.PI * 1.9); c.stroke();
      c.beginPath(); c.arc(4, -42, 3.6, Math.PI * 1.1, Math.PI * 2.5); c.stroke();
      ell(c, 8, 2, 13, 4); c.fillStyle = 'rgba(160,20,30,0.55)'; c.fill();
    }
    // hat: above the body (inside the facing / bob / ghost transform), below name tags
    if (opts.hat && !dead && !opts.noHat && IS.hats && IS.hats.draw) {
      IS.hats.draw(c, opts.hat, { facing: f, ghost: ghost, time: t, walk: walking ? opts.walk : undefined, color: main, dark: dark });
    }
    c.restore();
  }
  function hatIdx(h) { return IS.hats && IS.hats.valid ? IS.hats.valid(h) : 0; }
  function hatAnimated(h) { return !!(h && IS.hats && IS.hats.animated && IS.hats.animated(h)); }
  // highest painted point of a crewmate wearing hat h (crew coords, unscaled)
  function hatTop(h) { return h && IS.hats && IS.hats.top ? IS.hats.top(h) : -58; }
  // Hat only, with exactly the transform drawCrewmate would use (for animated hats over cached sprites)
  function drawHatLive(c, x, y, colorIdx, opts) {
    var h = hatIdx(opts.hat);
    if (!h || opts.dead || !IS.hats || !IS.hats.draw) return;
    var cc = col(colorIdx), f = opts.facing < 0 ? -1 : 1, ghost = !!opts.ghost;
    var t = opts.time !== undefined ? opts.time : performance.now() / 1000;
    var walking = typeof opts.walk === 'number' && !ghost;
    var bob = walking ? -Math.abs(Math.sin(opts.walk * TAU)) * 2 : 0;
    c.save();
    c.translate(x, y); c.scale(f, 1);
    if (ghost) { c.globalAlpha *= 0.5; c.translate(0, -8); }
    c.translate(0, bob);
    IS.hats.draw(c, h, { facing: f, ghost: ghost, time: t, walk: walking ? opts.walk : undefined, color: cc[1], dark: cc[2] });
    c.restore();
  }

  // Cached crewmate sprites (per colour / facing / walk frame / ghost wave frame) for the world view.
  var CREW_W = 84, CREW_H = 136, CREW_OX = 42, CREW_OY = 116;
  function crewSprite(color, facing, frame, ghost, dead, outline, S, hat) {
    var key = 'crew|' + color + '|' + facing + '|' + frame + '|' + (ghost ? 1 : 0) + (dead ? 1 : 0) + '|' + (outline || '') + '|h' + (hat || 0);
    var sp = sprites.get(key);
    if (sp) return sp;
    var cv = mk(CREW_W * S, CREW_H * S), c = cv.getContext('2d');
    c.scale(S, S);
    var o = { facing: facing, dead: dead, ghost: ghost, outline: outline, noBob: true, hat: hat || 0 };
    if (ghost) o.time = frame / 8 * (TAU / 6);
    else if (frame >= 0) o.walk = frame / 8;
    drawCrewmate(c, CREW_OX, CREW_OY, color, o);
    sp = { c: cv };
    sprites.set(key, sp);
    return sp;
  }
  function blitCrew(c, x, y, color, opts, S) {
    var ghost = !!opts.ghost, frame = -1, dy = 0;
    if (ghost) { frame = Math.floor(((opts.time || 0) * 6 / TAU) * 8) % 8; dy = Math.sin((opts.time || 0) * 2.2) * 3; }
    else if (typeof opts.walk === 'number') frame = Math.floor(opts.walk * 8) % 8;
    var hat = opts.dead ? 0 : hatIdx(opts.hat), live = hatAnimated(hat);
    var sp = crewSprite(color | 0, opts.facing < 0 ? -1 : 1, frame, ghost, !!opts.dead, opts.outline || '', S, live ? 0 : hat);
    c.drawImage(sp.c, x - CREW_OX, y - CREW_OY + dy, CREW_W, CREW_H);
    if (live) drawHatLive(c, x, y + dy, color, { hat: hat, facing: opts.facing, ghost: ghost, time: opts.time, walk: frame >= 0 && !ghost ? frame / 8 : undefined });
  }

  // ------------------------------------------------------------------------------------------
  // Stars background
  // ------------------------------------------------------------------------------------------
  function getStarTile() {
    if (starTile) return starTile;
    var bg = ((M() && M().theme) || {}).bg || 'stars';
    if (bg === 'snow' || bg === 'sky') { starTile = makeBgTile(bg); return starTile; }
    var im = img('stars');
    if (im) { starTile = { c: im, w: im.naturalWidth || im.width, h: im.naturalHeight || im.height }; return starTile; }
    var N = 512, cv = mk(N, N), c = cv.getContext('2d');
    c.fillStyle = '#04060f'; c.fillRect(0, 0, N, N);
    var neb = [[120, 140, 200, 'rgba(70,40,140,0.20)'], [380, 360, 240, 'rgba(20,80,150,0.18)'], [420, 90, 140, 'rgba(140,40,110,0.10)']];
    neb.forEach(function (n) {
      for (var dx = -N; dx <= N; dx += N) for (var dy = -N; dy <= N; dy += N) {
        var g = c.createRadialGradient(n[0] + dx, n[1] + dy, 0, n[0] + dx, n[1] + dy, n[2]);
        g.addColorStop(0, n[3]); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(0, 0, N, N);
      }
    });
    for (var i = 0; i < 260; i++) {
      var x = hash(i, 1) * N, y = hash(1, i) * N, r = hash(i, i) < 0.92 ? 0.6 + hash(i, 7) * 0.8 : 1.4 + hash(i, 5) * 1.2;
      c.globalAlpha = 0.35 + hash(i, 3) * 0.65;
      c.fillStyle = hash(i, 9) < 0.15 ? '#ffe6b0' : hash(i, 9) < 0.3 ? '#b8d8ff' : '#ffffff';
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
      if (r > 1.6) { c.globalAlpha *= 0.4; c.fillRect(x - r * 3, y - 0.5, r * 6, 1); c.fillRect(x - 0.5, y - r * 3, 1, r * 6); }
    }
    c.globalAlpha = 1;
    starTile = { c: cv, w: N, h: N };
    return starTile;
  }
  function makeBgTile(bg) {
    var N = 512, cv = mk(N, N), c = cv.getContext('2d'), i;
    if (bg === 'snow') {
      // frozen ground around the outpost: soft drifts, rocks and footprint-like pits
      c.fillStyle = '#d3deea'; c.fillRect(0, 0, N, N);
      for (i = 0; i < 40; i++) {
        var x = hash(i, 3) * N, y = hash(3, i) * N, r = 30 + hash(i, i) * 80;
        for (var dx = -N; dx <= N; dx += N) for (var dy = -N; dy <= N; dy += N) {
          var g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          g.addColorStop(0, i & 1 ? 'rgba(255,255,255,0.55)' : 'rgba(150,175,205,0.30)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g; c.fillRect(0, 0, N, N);
        }
      }
      for (i = 0; i < 26; i++) {
        var rx = hash(i, 11) * N, ry = hash(11, i) * N, rs = 6 + hash(i, 13) * 16;
        c.fillStyle = '#6f7b8f'; c.beginPath(); c.ellipse(rx, ry, rs, rs * 0.62, hash(i, 2) * 3, 0, TAU); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.ellipse(rx - rs * 0.15, ry - rs * 0.3, rs * 0.7, rs * 0.28, 0, 0, TAU); c.fill();
      }
      for (i = 0; i < 400; i++) { c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(hash(i, 21) * N, hash(21, i) * N, 2, 2); }
    } else {
      // high above the clouds
      c.fillStyle = '#5d8fd0'; c.fillRect(0, 0, N, N);
      for (i = 0; i < 22; i++) {
        var cx = hash(i, 5) * N, cy = hash(5, i) * N, cw = 50 + hash(i, 8) * 90;
        for (var ex = -N; ex <= N; ex += N) for (var ey = -N; ey <= N; ey += N) {
          c.fillStyle = 'rgba(255,255,255,' + (0.35 + hash(i, 4) * 0.45).toFixed(2) + ')';
          for (var j = 0; j < 5; j++) {
            c.beginPath();
            c.ellipse(cx + ex + (j - 2) * cw * 0.28, cy + ey + Math.sin(j * 1.7) * cw * 0.07, cw * 0.3, cw * 0.18, 0, 0, TAU);
            c.fill();
          }
        }
      }
    }
    return { c: cv, w: N, h: N };
  }
  function drawStars(cam, k) {
    var st = getStarTile();
    var sc = Math.max(1, dpr * 1.0);
    var tw = st.w * sc, th = st.h * sc;
    var ox = -((cam.x * 0.18 * k) % tw), oy = -((cam.y * 0.18 * k) % th);
    if (ox > 0) ox -= tw; if (oy > 0) oy -= th;
    for (var y = oy; y < devH; y += th) for (var x = ox; x < devW; x += tw) ctx.drawImage(st.c, Math.floor(x), Math.floor(y), Math.ceil(tw), Math.ceil(th));
  }

  // ------------------------------------------------------------------------------------------
  // Vision
  // ------------------------------------------------------------------------------------------
  var angBuf = [];
  var polyX = new Float32Array(4096), polyY = new Float32Array(4096), polyN = 0;
  function computeVision(mx, my, R) {
    var m = M();
    angBuf.length = 0;
    var N = 220, i;
    for (i = 0; i < N; i++) angBuf.push(i * TAU / N - Math.PI);
    var cx0 = Math.floor((mx - R) / T), cx1 = Math.floor((mx + R) / T), cy0 = Math.floor((my - R) / T), cy1 = Math.floor((my + R) / T);
    var R2 = R * R;
    for (var cy = cy0; cy <= cy1; cy++) for (var cx = cx0; cx <= cx1; cx++) {
      if (!m.solidCell(cx, cy)) continue;
      if (m.solidCell(cx - 1, cy) && m.solidCell(cx + 1, cy) && m.solidCell(cx, cy - 1) && m.solidCell(cx, cy + 1)) continue;
      for (var k = 0; k < 4; k++) {
        var px = (cx + (k & 1)) * T, py = (cy + (k >> 1)) * T;
        var dx = px - mx, dy = py - my;
        if (dx * dx + dy * dy > R2) continue;
        var a = Math.atan2(dy, dx);
        angBuf.push(a - 0.0006, a + 0.0006);
      }
    }
    angBuf.sort(function (a, b) { return a - b; });
    polyN = 0;
    var lastA = -99;
    for (i = 0; i < angBuf.length && polyN < 4096; i++) {
      var an = angBuf[i];
      if (an - lastA < 0.0003) continue;
      lastA = an;
      var ddx = Math.cos(an), ddy = Math.sin(an);
      var h = m.castRay(mx, my, ddx, ddy, R);
      var d = h.d;
      if (h.hit) {
        if (h.side === 1 && ddy < 0 && cellAt(h.cx, h.cy + 1) === 1) {
          var depth = cellAt(h.cx, h.cy - 1) === 2 ? T * 1.9 : T * 0.98;
          d += Math.min(depth / -ddy, 110);
        } else d += 7;
      }
      polyX[polyN] = mx + ddx * d; polyY[polyN] = my + ddy * d; polyN++;
    }
  }
  function canSee(mx, my, R, x, y) {
    var dx = x - mx, dy = y - my, d = Math.sqrt(dx * dx + dy * dy);
    if (d > R * 0.95) return false;
    if (d < 1) return true;
    return !M().castRay(mx, my, dx / d, dy / d, d).hit;
  }
  // Darkness. Layer 1 = cached "light" sprite around me (clear centre, fog toward R) + solid fog
  // rects for the rest of the screen. Layer 2 = the shadow regions inside R that the visibility
  // polygon does not reach, filled with a cached complementary sprite (as a pattern) so the two
  // layers composite to exactly the outside-fog alpha. Sprites are half-res (smooth gradients).
  var fogSpr = { key: '', a: null, b: null };
  var FOG_IN = 0.7;
  function fogSprites(Rd, f, rgb) {
    var key = Rd + '|' + f;
    if (fogSpr.key === key) return fogSpr;
    var D = Math.max(4, Math.ceil(Rd)), r = D / 2;
    var a = mk(D, D), ac = a.getContext('2d');
    var g = ac.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(' + rgb + '0)'); g.addColorStop(FOG_IN, 'rgba(' + rgb + '0)'); g.addColorStop(1, 'rgba(' + rgb + f + ')');
    ac.fillStyle = g; ac.fillRect(0, 0, D, D);
    var b = mk(D, D), bc = b.getContext('2d');
    var g2 = bc.createRadialGradient(r, r, 0, r, r, r);
    g2.addColorStop(0, 'rgba(' + rgb + f + ')');
    for (var s = 0; s <= 8; s++) {
      var u = s / 8, gv = f * u, a2 = (f - gv) / (1 - gv);
      g2.addColorStop(FOG_IN + (1 - FOG_IN) * u, 'rgba(' + rgb + a2.toFixed(4) + ')');
    }
    bc.fillStyle = g2; bc.fillRect(0, 0, D, D);
    fogSpr = { key: key, a: a, b: b, D: D };
    return fogSpr;
  }
  function drawFog(view, me, R, k, ox, oy) {
    var f = view.lights ? 0.9 : 0.8, rgb = view.lights ? '4,6,16,' : '5,8,20,';
    var fogCol = 'rgba(' + rgb + f + ')';
    var Rd = Math.round(R * k);                       // radius in device px
    var spr = fogSprites(Rd, f, rgb);                 // sprite is (Rd) px wide = half-res of 2*Rd
    var mx = me.x * k + ox, my = me.y * k + oy;
    var x0 = Math.round(mx - Rd), y0 = Math.round(my - Rd), x1 = x0 + 2 * Rd, y1 = y0 + 2 * Rd;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = fogCol;
    if (y0 > 0) ctx.fillRect(0, 0, devW, y0);
    if (y1 < devH) ctx.fillRect(0, y1, devW, devH - y1);
    var ya = Math.max(0, y0), yb = Math.min(devH, y1);
    if (yb > ya) {
      if (x0 > 0) ctx.fillRect(0, ya, x0, yb - ya);
      if (x1 < devW) ctx.fillRect(x1, ya, devW - x1, yb - ya);
    }
    // light sprite minus its fully transparent centre square (4 strips)
    var D = spr.D, q = Math.floor(D * (0.5 - FOG_IN * 0.69 / 2)), sc0 = 2 * Rd / D;
    if (q < 2) ctx.drawImage(spr.a, x0, y0, 2 * Rd, 2 * Rd);
    else {
      ctx.drawImage(spr.a, 0, 0, D, q, x0, y0, D * sc0, q * sc0);
      ctx.drawImage(spr.a, 0, D - q, D, q, x0, y0 + (D - q) * sc0, D * sc0, q * sc0);
      ctx.drawImage(spr.a, 0, q, q, D - 2 * q, x0, y0 + q * sc0, q * sc0, (D - 2 * q) * sc0);
      ctx.drawImage(spr.a, D - q, q, q, D - 2 * q, x0 + (D - q) * sc0, y0 + q * sc0, q * sc0, (D - 2 * q) * sc0);
    }
    if (polyN < 3) return;
    var pat = ctx.createPattern(spr.b, 'no-repeat');
    var sc = 2 * Rd / spr.D;
    if (pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix([sc, 0, 0, sc, x0, y0]));
    ctx.beginPath();
    ctx.rect(Math.max(0, x0), Math.max(0, y0), Math.min(devW, x1) - Math.max(0, x0), Math.min(devH, y1) - Math.max(0, y0));
    for (var i = 0; i < polyN; i++) {
      var px = polyX[i] * k + ox, py = polyY[i] * k + oy;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = pat;
    ctx.fill('evenodd');
  }

  // ------------------------------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------------------------------
  function quantScale(k) { return Math.max(0.5, Math.min(3, Math.round(k * 20) / 20)); }
  function checkAssets() {
    var sig = '';
    if (IS.assets && IS.assets.has) {
      ['floor_room', 'floor_hall', 'floor_tech', 'wall', 'prop_table', 'prop_crate', 'prop_console', 'prop_bed', 'prop_engine',
        'prop_reactor', 'prop_plant', 'prop_chair', 'prop_screen', 'prop_barrel', 'vent', 'button', 'stars'].forEach(function (k) { sig += img(k) ? '1' : '0'; });
    }
    try { if (document.fonts && document.fonts.check) sig += document.fonts.check('20px ' + fontD()) ? 'F' : 'f'; } catch (e) { /* ignore */ }
    sig += '|' + ((M() && M().id) || '') + ':' + ((M() && M().version) || 0);
    if (sig !== assetSig) {
      assetSig = sig;
      chunks.clear(); sprites.clear(); outlines.clear(); starTile = null; mini.key = ''; emptyChunk = null;
      applyTheme();
    }
  }
  function resize() {
    var w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    // cap the backing store: DPR <= 2 and ~3.7 MP total (fill-rate bound on phones / 4K screens)
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var budget = 3.7e6;
    if (w * h * dpr * dpr > budget) dpr = Math.max(1, Math.sqrt(budget / (w * h)));
    cssW = w; cssH = h;
    var dw = Math.round(w * dpr), dh = Math.round(h * dpr);
    if (canvas.width !== dw || canvas.height !== dh) { canvas.width = dw; canvas.height = dh; }
    devW = canvas.width; devH = canvas.height;
  }

  function defaultZoom(w, h) {
    w = w || cssW || window.innerWidth; h = h || cssH || window.innerHeight;
    var big = Math.max(w, h), small = Math.min(w, h);
    var phone = small < 560;
    var tl = phone ? 13 : 20, ts = phone ? 9.5 : 11.5;
    return Math.min(big / (tl * T), small / (ts * T));
  }

  function near(a, x, y, d) { return Math.abs(a.x - x) <= d && Math.abs(a.y - y) <= d; }
  function findPropAt(x, y, type) {
    var m = M(), best = null, bd = 1e9;
    for (var i = 0; i < m.props.length; i++) {
      var p = m.props[i];
      if (type === 'button' && p.key !== 'emergency') continue;
      if (type === 'vent' && p.vent === undefined) continue;
      if (!p.use) continue;
      var d = Math.abs(p.use.x - x) + Math.abs(p.use.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return bd <= 24 ? best : null;
  }

  var ents = [];
  function frame(view) {
    if (!ctx || !M()) return;
    view = view || {};
    resize();
    var mv = (M() && M().version) || 0;
    if ((frameNo++ % 30) === 0 || mv !== lastMapVer) { lastMapVer = mv; checkAssets(); }
    var m = M();
    var me = view.me || null;
    var zoom = view.zoom || defaultZoom(cssW, cssH);
    var cam = view.cam || (me ? { x: me.x, y: me.y - 24 } : { x: m.button.x, y: m.button.y });
    var t = view.time !== undefined ? view.time : performance.now() / 1000;
    lastCam = { x: cam.x, y: cam.y }; lastZoom = zoom;
    var k = zoom * dpr;
    var S = quantScale(k);
    // static layers are rendered at exactly the device scale (1:1 blits); a zoom change is applied
    // after it has been stable for a few frames so zoom animations don't thrash the caches.
    if (S !== chunkScale) {
      if (S === pendingS) pendingN++; else { pendingS = S; pendingN = 0; }
      if (!chunkScale || pendingN > 12) { chunkScale = S; chunks.clear(); sprites.clear(); outlines.clear(); }
    }
    S = chunkScale;
    var ox = Math.round(devW / 2 - cam.x * k), oy = Math.round(devH / 2 - cam.y * k);
    var wx0 = -ox / k, wy0 = -oy / k, wx1 = (devW - ox) / k, wy1 = (devH - oy) / k;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    var DBG = IS.render._dbg || {};
    var cx0 = Math.floor(wx0 / CHUNK), cx1 = Math.floor(wx1 / CHUNK), cy0 = Math.floor(wy0 / CHUNK), cy1 = Math.floor(wy1 / CHUNK);
    // space background only where a chunk can show it (saves a full-screen layer)
    ctx.beginPath();
    var needSky = false;
    for (var qy = cy0; qy <= cy1; qy++) for (var qx = cx0; qx <= cx1; qx++) {
      if (chunkOpaque(qx, qy) && !DBG.noChunks) continue;
      var qsx = Math.round(ox + qx * CHUNK * k), qsy = Math.round(oy + qy * CHUNK * k);
      ctx.rect(qsx, qsy, Math.round(ox + (qx + 1) * CHUNK * k) - qsx, Math.round(oy + (qy + 1) * CHUNK * k) - qsy);
      needSky = true;
    }
    if (needSky) {
      ctx.save(); ctx.clip();
      ctx.fillStyle = VOID; ctx.fillRect(0, 0, devW, devH);
      if (!DBG.noStars) drawStars(cam, k);
      ctx.restore();
    }

    // static chunks (integer device rects → no seams)
    chunkCap = Math.max(16, (cx1 - cx0 + 2) * (cy1 - cy0 + 2) + 6);
    for (var cy = cy0; cy <= cy1; cy++) for (var cx = cx0; cx <= cx1; cx++) {
      if (!chunkHasContent(cx, cy) || DBG.noChunks) continue;
      var ch = getChunk(cx, cy, S);
      var sx = Math.round(ox + cx * CHUNK * k), sy = Math.round(oy + cy * CHUNK * k);
      var ex = Math.round(ox + (cx + 1) * CHUNK * k), ey = Math.round(oy + (cy + 1) * CHUNK * k);
      ctx.drawImage(ch, sx, sy, ex - sx, ey - sy);
    }

    ctx.setTransform(k, 0, 0, k, ox, oy);
    var R = view.vision === undefined ? Infinity : view.vision;
    var fullVis = !me || !isFinite(R);
    if (!fullVis) computeVision(me.x, me.y, R);

    // outlines: highlight > sabotage > tasks
    var marks = new Map();
    var hl = view.highlight || null;
    var pulse = 0.55 + 0.45 * Math.sin(t * 5);
    (view.taskTargets || []).forEach(function (tt) { var p = findPropAt(tt.x, tt.y); if (p) marks.set(p, ['#ffd23f', 0.5 + 0.3 * pulse]); });
    (view.sabotageTargets || []).forEach(function (tt) { var p = findPropAt(tt.x, tt.y); if (p) marks.set(p, ['#ff3b4a', 0.6 + 0.4 * pulse]); });
    var hlBody = null;
    if (hl) {
      if (hl.type === 'body') hlBody = hl;
      else if (hl.type !== 'player') { var hp = findPropAt(hl.x, hl.y, hl.type); if (hp) marks.set(hp, ['#ffe94a', 1]); }
    }
    marks.forEach(function (v, p) {
      if (!(p.flat || p.wall)) return;
      if (p.x > wx1 + 50 || p.y > wy1 + 50 || p.x + p.w < wx0 - 50 || p.y + p.h < wy0 - 50) return;
      drawOutlined(ctx, p, S, v[0], v[1]);
    });

    // y-sorted entities
    ents.length = 0;
    var i, p;
    for (i = 0; i < m.props.length; i++) {
      p = m.props[i];
      if (p.flat || p.wall) continue;
      if (p.x > wx1 + 60 || p.y - 110 > wy1 || p.x + p.w < wx0 - 60 || p.y + p.h < wy0 - 20) continue;
      ents.push({ y: p.y + p.h - (p.round ? p.h * 0.3 : 0), p: p });
    }
    var visPlayers = [];
    (view.bodies || []).forEach(function (b) {
      if (!fullVis && !canSee(me.x, me.y, R, b.x, b.y)) return;
      if (b.x < wx0 - 60 || b.x > wx1 + 60 || b.y < wy0 - 20 || b.y > wy1 + 80) return;
      ents.push({ y: b.y - 1, b: b });
    });
    var meAlive = me ? me.alive !== false : false;
    (view.players || []).forEach(function (pl) {
      if (pl.inVent) return;
      if (pl.ghost && meAlive && !pl.isMe) return;
      if (!pl.isMe && !fullVis && !canSee(me.x, me.y, R, pl.x, pl.y)) return;
      if (pl.x < wx0 - 60 || pl.x > wx1 + 60 || pl.y < wy0 - 20 || pl.y > wy1 + 90) return;
      ents.push({ y: pl.y, pl: pl });
      visPlayers.push(pl);
    });
    ents.sort(function (a, b) { return a.y - b.y; });
    if (DBG.noEnts) ents.length = 0;
    for (i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (e.p) {
        var mk2 = marks.get(e.p);
        if (mk2) drawOutlined(ctx, e.p, S, mk2[0], mk2[1]); else drawPropSprite(ctx, e.p, S);
      } else if (e.b) {
        var glow = hlBody && Math.abs(hlBody.x - e.b.x) < 30 && Math.abs(hlBody.y - e.b.y) < 30;
        blitCrew(ctx, e.b.x, e.b.y, e.b.color, { dead: true, facing: e.b.f || 1, outline: glow ? '#ffe94a' : null }, S);
      } else {
        var pl2 = e.pl;
        var tgt = hl && hl.type === 'player' && !pl2.isMe && Math.abs(hl.x - pl2.x) < 24 && Math.abs(hl.y - pl2.y) < 24;
        blitCrew(ctx, pl2.x, pl2.y, pl2.color, {
          facing: pl2.f, ghost: !!pl2.ghost || pl2.alive === false,
          walk: pl2.m ? (typeof pl2.walk === 'number' ? ((pl2.walk % 1) + 1) % 1 : ((t * 2.3 + (pl2.slot || 0) * 0.37) % 1)) : undefined,
          time: t + (pl2.slot || 0), outline: tgt ? '#ff3b4a' : null, hat: pl2.hat
        }, S);
      }
    }

    if (!fullVis && !DBG.noFog) drawFog(view, me, R, k, ox, oy);
    ctx.setTransform(k, 0, 0, k, ox, oy);

    // highlight ring when nothing to outline (e.g. fix point without prop)
    if (hl && hl.type !== 'body' && hl.type !== 'player' && !findPropAt(hl.x, hl.y, hl.type)) {
      ell(ctx, hl.x, hl.y, 26 + pulse * 4, 12 + pulse * 2);
      ctx.strokeStyle = 'rgba(255,233,74,0.9)'; ctx.lineWidth = 3; ctx.stroke();
    }

    // names
    if (view.showNames !== false) {
      var fsz = Math.max(12, Math.min(19, 9 * zoom)) / zoom;
      ctx.font = '600 ' + fsz.toFixed(1) + 'px ' + fontB();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      visPlayers.forEach(function (pl) {
        var yy = nameY(pl);
        if (!pl.name) { if (pl.speaking) drawSpeaking(ctx, pl.x, yy - fsz * 0.35, fsz, t); return; }
        ctx.lineWidth = 3.5 / zoom * 1.6;
        ctx.strokeStyle = 'rgba(8,10,20,0.85)';
        ctx.strokeText(pl.name, pl.x, yy);
        ctx.fillStyle = pl.role === 1 ? '#ff3b4a' : (pl.ghost || pl.alive === false) ? 'rgba(232,236,255,0.65)' : '#ffffff';
        ctx.fillText(pl.name, pl.x, yy);
        if (pl.speaking) drawSpeaking(ctx, pl.x + ctx.measureText(pl.name).width / 2 + fsz * 0.85, yy - fsz * 0.35, fsz, t);
      });
    } else {
      visPlayers.forEach(function (pl) { if (pl.speaking) drawSpeaking(ctx, pl.x, nameY(pl) - 8, 14, t); });
    }

    // markers & edge arrows
    var arrows = [];
    (view.taskTargets || []).forEach(function (tt) { arrows.push([tt.x, tt.y, '#ffd23f', false]); });
    (view.sabotageTargets || []).forEach(function (tt) { arrows.push([tt.x, tt.y, '#ff3b4a', true]); });
    var margin = 34 * dpr;
    arrows.forEach(function (a) {
      var sx2 = ox + a[0] * k, sy2 = oy + (a[1] - 20) * k;
      var e2 = 6 * dpr;
      var on = sx2 > e2 && sx2 < devW - e2 && sy2 > e2 && sy2 < devH - e2;
      if (on) {
        if (a[3]) {
          ctx.setTransform(k, 0, 0, k, ox, oy);
          var rp = 22 + ((t * 1.6) % 1) * 26;
          ell(ctx, a[0], a[1], rp, rp * 0.5);
          ctx.strokeStyle = 'rgba(255,59,74,' + (1 - ((t * 1.6) % 1)).toFixed(2) + ')'; ctx.lineWidth = 4; ctx.stroke();
          drawArrowHead(sx2, sy2 - 20 * k - Math.abs(Math.sin(t * 4)) * 8 * dpr, Math.PI / 2, a[2], dpr);
        }
        return;
      }
      var cxs = devW / 2, cys = devH / 2, dx = sx2 - cxs, dy = sy2 - cys;
      var sc = Math.min((cxs - margin) / Math.abs(dx || 1e-6), (cys - margin) / Math.abs(dy || 1e-6));
      var ax = cxs + dx * sc, ay = cys + dy * sc;
      var ang = Math.atan2(dy, dx);
      var bounce = Math.sin(t * 6) * 3 * dpr;
      drawArrowHead(ax - Math.cos(ang) * bounce, ay - Math.sin(ang) * bounce, ang, a[2], dpr * (a[3] ? 1.15 + 0.15 * pulse : 1));
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }
  // name tag baseline for a world player: above the head, and above a tall hat
  function nameY(pl) {
    var ghost = pl.ghost || pl.alive === false;
    var top = Math.min(-58, hatTop(hatIdx(pl.hat)));
    return pl.y + Math.min(-66, top - 7) - (ghost ? 8 : 0);
  }
  // little animated speaker + sound waves, centred at (x, y), sized to the name font
  function drawSpeaking(c, x, y, sz, t) {
    var s = sz / 16;
    c.save();
    c.translate(x, y); c.scale(s, s);
    c.lineJoin = 'round'; c.lineCap = 'round';
    ell(c, 2, 0, 12.5, 11); c.fillStyle = 'rgba(8,10,20,0.78)'; c.fill();
    c.strokeStyle = '#3ee07a'; c.lineWidth = 2; c.stroke();
    c.beginPath();
    c.moveTo(-6, -3); c.lineTo(-3, -3); c.lineTo(1.5, -7); c.lineTo(1.5, 7); c.lineTo(-3, 3); c.lineTo(-6, 3); c.closePath();
    c.fillStyle = '#ffffff'; c.fill();
    for (var i = 0; i < 2; i++) {
      var a = 0.45 + 0.55 * Math.max(0, Math.sin(t * 9 - i * 1.1));
      c.beginPath(); c.arc(1.5, 0, 4.5 + i * 3.6, -0.75, 0.75);
      c.strokeStyle = 'rgba(62,224,122,' + a.toFixed(2) + ')'; c.lineWidth = 1.9; c.stroke();
    }
    c.restore();
  }
  function drawArrowHead(x, y, ang, color, s) {
    ctx.setTransform(s, 0, 0, s, x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-10, -12); ctx.lineTo(-5, 0); ctx.lineTo(-10, 12); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ------------------------------------------------------------------------------------------
  // Minimap
  // ------------------------------------------------------------------------------------------
  function roomPoly(c, r, s) {
    var ch = r.ch || {}, tl = ch.tl || 0, tr = ch.tr || 0, bl = ch.bl || 0, br = ch.br || 0;
    var x = r.x * T * s, y = r.y * T * s, w = r.w * T * s, h = r.h * T * s, u = T * s;
    c.beginPath();
    c.moveTo(x + tl * u, y); c.lineTo(x + w - tr * u, y); c.lineTo(x + w, y + tr * u);
    c.lineTo(x + w, y + h - br * u); c.lineTo(x + w - br * u, y + h); c.lineTo(x + bl * u, y + h);
    c.lineTo(x, y + h - bl * u); c.lineTo(x, y + tl * u); c.closePath();
  }
  function minimapGeom(w, h) {
    var m = M(), x0 = m.W, y0 = m.H, x1 = 0, y1 = 0;
    for (var y = 0; y < m.H; y++) for (var x = 0; x < m.W; x++) if (m.grid[y * m.W + x] === 1) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    var pad = Math.max(10, Math.min(w, h) * 0.04);
    var bw = (x1 - x0 + 1) * T, bh = (y1 - y0 + 1) * T;
    var s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
    return { s: s, ox: (w - bw * s) / 2 - x0 * T * s, oy: (h - bh * s) / 2 - y0 * T * s };
  }
  function drawMinimap(c, w, h, view) {
    var m = M();
    if (!m || !c) return;
    view = view || {};
    var t = view.time !== undefined ? view.time : performance.now() / 1000;
    var tf = c.getTransform ? c.getTransform() : { a: 1 };
    var ps = Math.max(1, Math.abs(tf.a) || 1);
    var key = w + 'x' + h + '@' + ps + assetSig;
    var g = minimapGeom(w, h);
    if (mini.key !== key) {
      var cv = mk(w * ps, h * ps), b = cv.getContext('2d');
      b.scale(ps, ps);
      rr(b, 0, 0, w, h, Math.min(16, w * 0.03));
      b.fillStyle = 'rgba(11,16,32,0.96)'; b.fill();
      b.save(); b.translate(g.ox, g.oy);
      var s = g.s, lw = Math.max(2.5, T * s * 0.42);
      b.lineJoin = 'round';
      b.strokeStyle = '#cfd8f7'; b.lineWidth = lw;
      m.corridors.forEach(function (r) { b.strokeRect(r.x * T * s, r.y * T * s, r.w * T * s, r.h * T * s); });
      m.rooms.forEach(function (r) { roomPoly(b, r, s); b.stroke(); });
      b.fillStyle = '#26345f';
      m.corridors.forEach(function (r) { b.fillRect(r.x * T * s, r.y * T * s, r.w * T * s, r.h * T * s); });
      m.rooms.forEach(function (r) { roomPoly(b, r, s); b.fillStyle = '#34477e'; b.fill(); });
      // subtle inner tone for rooms
      m.rooms.forEach(function (r) { roomPoly(b, r, s); b.strokeStyle = 'rgba(255,255,255,0.08)'; b.lineWidth = 2; b.stroke(); });
      var fsz = Math.max(9, Math.min(22, T * s * 1.05));
      b.font = fsz.toFixed(1) + 'px ' + fontD();
      b.textAlign = 'center'; b.textBaseline = 'middle';
      m.rooms.forEach(function (r) {
        var cx = (r.x + r.w / 2) * T * s, cy = (r.y + r.h / 2) * T * s, mw = r.w * T * s * 0.94;
        var nm = r.name.toUpperCase();
        if (r.id === 'communications' && b.measureText(nm).width > mw) nm = 'COMMS';
        b.lineWidth = 3; b.strokeStyle = 'rgba(8,10,24,0.8)'; b.strokeText(nm, cx, cy, mw);
        b.fillStyle = '#e8ecff'; b.fillText(nm, cx, cy, mw);
      });
      b.restore();
      mini.key = key; mini.c = cv;
    }
    c.drawImage(mini.c, 0, 0, w, h);
    c.save();
    c.translate(g.ox, g.oy);
    var s2 = g.s, pr = Math.max(6, Math.min(12, T * s2 * 0.5));
    (view.taskTargets || []).forEach(function (tt) {
      c.beginPath(); c.arc(tt.x * s2, tt.y * s2, pr, 0, TAU);
      c.fillStyle = '#ffd23f'; c.fill(); c.strokeStyle = OL; c.lineWidth = 2; c.stroke();
      c.fillStyle = OL; c.font = 'bold ' + (pr * 1.5).toFixed(1) + 'px ' + fontB(); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('!', tt.x * s2, tt.y * s2 + pr * 0.08);
    });
    (view.sabotageTargets || []).forEach(function (tt) {
      var ph = (t * 1.5) % 1;
      c.beginPath(); c.arc(tt.x * s2, tt.y * s2, pr * (1.2 + ph * 2.2), 0, TAU);
      c.strokeStyle = 'rgba(255,59,74,' + (1 - ph).toFixed(2) + ')'; c.lineWidth = 3; c.stroke();
      c.beginPath(); c.arc(tt.x * s2, tt.y * s2, pr * 1.15, 0, TAU);
      c.fillStyle = '#ff3b4a'; c.fill(); c.strokeStyle = OL; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#fff'; c.font = 'bold ' + (pr * 1.6).toFixed(1) + 'px ' + fontB(); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('!', tt.x * s2, tt.y * s2 + pr * 0.08);
    });
    if (view.me) {
      var sc = Math.max(0.35, Math.min(0.9, T * s2 * 2.2 / 60));
      var bobm = Math.sin(t * 4) * 1.5;
      drawCrewmate(c, view.me.x * s2, view.me.y * s2 + 14 * sc + bobm, view.me.color || 0,
        { scale: sc, facing: 1, ghost: view.me.alive === false, time: t });
    }
    c.restore();
  }

  // ------------------------------------------------------------------------------------------
  function init(cv) {
    canvas = cv;
    ctx = cv.getContext('2d', { alpha: false }) || cv.getContext('2d');
    resize();
  }
  function screenToWorld(sx, sy) {
    return { x: lastCam.x + (sx - cssW / 2) / lastZoom, y: lastCam.y + (sy - cssH / 2) / lastZoom };
  }
  function worldToScreen(wx, wy) {
    return { x: (wx - lastCam.x) * lastZoom + cssW / 2, y: (wy - lastCam.y) * lastZoom + cssH / 2 };
  }
  // Prepare all static chunks for the current scale ahead of time (optional, e.g. during role reveal)
  function warm() {
    if (!ctx || !M()) return;
    var m = M(), nx = Math.ceil(m.W * T / CHUNK), ny = Math.ceil(m.H * T / CHUNK);
    var S = chunkScale || quantScale(defaultZoom() * dpr);
    chunkScale = S;
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) if (chunkHasContent(i, j) && chunks.size < 40) getChunk(i, j, S);
  }

  // Maps can add their own vector props: draw(c, w, h, ext, p) paints a w×h footprint at the
  // origin, raised by ext px (drawn above the footprint). Sprites are cached per key/size/tint.
  function registerProp(key, draw, ext) {
    DRAW[key] = draw;
    if (ext) EXT[key] = ext;
    sprites.clear(); outlines.clear(); chunks.clear();
  }

  IS.render = {
    registerProp: registerProp,
    kit: { box: box, cylinder: cylinder, screen: screen, hazard: hazard, rr: rr, ell: ell, fillStroke: fillStroke,
      shade: shade, hash: hash, OL: OL, SCREEN: SCREEN, TAU: TAU },
    init: init,
    frame: frame,
    drawCrewmate: drawCrewmate,
    drawMinimap: drawMinimap,
    screenToWorld: screenToWorld,
    worldToScreen: worldToScreen,
    defaultZoom: defaultZoom,
    warm: warm
  };
})();
