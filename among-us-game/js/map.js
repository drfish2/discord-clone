/* Starship Sus — maps: layout, collision, vents, task stations, vision raycasts.
   See SPEC.md §4.3. Classic script, attaches IS.map.

   Several maps can be registered with IS.map.define(id, def). IS.map.select(id) builds the map
   (once, then cached) and copies its fields onto the IS.map object, so other modules keep
   reading IS.map.grid, IS.map.props, IS.map.moveCircle(...) etc. at call time.
   A map def: { name, blurb, W, H, theme, rooms: [...], corridors: [...], author(A) } where
   author() places props/stations/fixes/vents/button with the helpers in A (tile units). */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});
  var CFG = IS.CONFIG || {};
  var T = CFG.TILE || 48;
  var PR = CFG.PLAYER_RADIUS || 16;

  var TASK_NAMES = {
    wires: 'Fix Wiring', swipe: 'Swipe Card', download: 'Download Data', fuel: 'Fuel Engines',
    asteroids: 'Clear Asteroids', align: 'Align Engine Output', calibrate: 'Calibrate Distributor',
    garbage: 'Empty Garbage', scan: 'Submit Scan', divert: 'Divert Power', leaves: 'Clean O2 Filter',
    numbers: 'Start Reactor'
  };

  // ==========================================================================================
  // Map builder: turns a def into a self-contained map object (its own grid, props, collision)
  // ==========================================================================================
  function build(def) {
    var W = def.W, H = def.H;
    var ROOM_DEFS = def.rooms;
    var CORRIDORS = def.corridors;
    var button = null;

    // ------------------------------------------------------------------------------------------
    // Rasterise
    // ------------------------------------------------------------------------------------------
    var grid = new Uint8Array(W * H);
    var cellRoom = new Int16Array(W * H).fill(-1); // room index per floor cell, -1 corridor/none

    function inChamfer(r, x, y) {
      var c = r.ch;
      if (!c) return false;
      var dx = x - r.x, dy = y - r.y, dxr = r.x + r.w - 1 - x, dyb = r.y + r.h - 1 - y;
      return (dx + dy < (c.tl || 0)) || (dxr + dy < (c.tr || 0)) ||
        (dx + dyb < (c.bl || 0)) || (dxr + dyb < (c.br || 0));
    }

    var rooms = ROOM_DEFS.map(function (r, i) {
      for (var y = r.y; y < r.y + r.h; y++) {
        for (var x = r.x; x < r.x + r.w; x++) {
          if (inChamfer(r, x, y)) continue;
          grid[y * W + x] = 1;
          cellRoom[y * W + x] = i;
        }
      }
      return { id: r.id, name: r.name, x: r.x, y: r.y, w: r.w, h: r.h, ch: r.ch || null, floor: r.floor,
        label: r.label || [0, 0], index: i, tint: r.tint || null };
    });
    CORRIDORS.forEach(function (c) {
      for (var y = c[1]; y < c[1] + c[3]; y++) {
        for (var x = c[0]; x < c[0] + c[2]; x++) {
          if (grid[y * W + x] !== 1) grid[y * W + x] = 1;
        }
      }
    });
    // Walls: every non-floor cell 8-adjacent to floor; top walls are two cells thick
    // (front face + top face) for a 2.5D look.
    (function () {
      var x, y, i;
      var isF = function (x, y) { return x >= 0 && y >= 0 && x < W && y < H && grid[y * W + x] === 1; };
      var mark = [];
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          i = y * W + x;
          if (grid[i] === 1) continue;
          var near = false;
          for (var oy = -1; oy <= 1 && !near; oy++) for (var ox = -1; ox <= 1; ox++) if (isF(x + ox, y + oy)) { near = true; break; }
          if (!near && isF(x, y + 2)) near = true; // thick top wall
          if (!near && (isF(x - 1, y + 2) || isF(x + 1, y + 2))) near = true;
          if (near) mark.push(i);
        }
      }
      for (i = 0; i < mark.length; i++) grid[mark[i]] = 2;
    })();

    function solidCell(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return true;
      return grid[cy * W + cx] !== 1;
    }

    // ------------------------------------------------------------------------------------------
    // Props, stations, fixes, vents (authored in tiles, stored in px)
    // ------------------------------------------------------------------------------------------
    var props = [];
    var STATIONS = [];
    var TASKS = [];
    var FIX = { reactor: [], o2: [], lights: [], comms: [] };
    var vents = [];
    var roomById = {};
    rooms.forEach(function (r) { roomById[r.id] = r; });

    // Generic prop. Tile coords: (tx,ty) top-left, (tw,th) size. opts: {solid, round, wall, flat, ...}
    function prop(key, tx, ty, tw, th, opts) {
      opts = opts || {};
      var p = { key: key, x: Math.round(tx * T), y: Math.round(ty * T), w: Math.round(tw * T), h: Math.round(th * T),
        solid: !!opts.solid };
      if (opts.round) p.round = true;
      if (opts.wall) p.wall = true;   // mounted on a wall front face (drawn into static layer)
      if (opts.flat) p.flat = true;   // flat on the floor (drawn into static layer)
      if (opts.room) p.room = opts.room;
      if (opts.tint) p.tint = opts.tint;
      props.push(p);
      return p;
    }
    // Round solid prop centred at (cx,cy) with radius rr (tiles)
    function roundProp(key, cx, cy, rr, opts) {
      opts = opts || {};
      opts.round = true;
      if (opts.solid === undefined) opts.solid = true;
      return prop(key, cx - rr, cy - rr, rr * 2, rr * 2, opts);
    }
    // Panel on the front face of a room's top wall, centred on column c; use point on the floor below.
    function wallProp(key, roomId, c, tw) {
      var r = roomById[roomId];
      tw = tw || 0.8;
      var p = prop(key, c + 0.5 - tw / 2, r.y - 1 + 0.1, tw, 0.8, { wall: true, room: roomId });
      p.use = { x: Math.round((c + 0.5) * T), y: Math.round((r.y + 0.45) * T) };
      return p;
    }
    function addStation(kind, roomId, p, ux, uy) {
      var id = STATIONS.length;
      var x = ux !== undefined ? Math.round(ux * T) : p.use.x;
      var y = uy !== undefined ? Math.round(uy * T) : p.use.y;
      p.use = { x: x, y: y };
      p.station = id;
      var room = roomById[roomId];
      STATIONS.push({ id: id, kind: kind, room: room.name, roomId: roomId, x: x, y: y });
      TASKS.push({ id: id, name: TASK_NAMES[kind] || kind, station: id, kind: kind, room: room.name, roomId: roomId, x: x, y: y });
      return STATIONS[id];
    }
    function setButton(p) {
      if (!p.use) p.use = { x: Math.round(p.x + p.w / 2), y: Math.round(p.y + p.h / 2) };
      button = { x: p.use.x, y: p.use.y };
      return p;
    }
    function addFix(kind, part, roomId, p, ux, uy) {
      var x = ux !== undefined ? Math.round(ux * T) : p.use.x;
      var y = uy !== undefined ? Math.round(uy * T) : p.use.y;
      p.use = { x: x, y: y };
      p.fix = kind; p.part = part;
      FIX[kind].push({ part: part, x: x, y: y, room: roomById[roomId].name, roomId: roomId });
    }
    function addVent(cx, cy, roomId, links) {
      var id = vents.length;
      var v = { id: id, x: Math.round(cx * T), y: Math.round(cy * T), links: links, room: roomById[roomId] ? roomById[roomId].name : 'Hallway' };
      vents.push(v);
      var p = prop('vent', cx - 0.45, cy - 0.3, 0.9, 0.6, { flat: true, room: roomId });
      p.use = { x: v.x, y: v.y }; p.vent = id;
      return v;
    }

    def.author({
      T: T, rooms: rooms, roomById: roomById,
      prop: prop, roundProp: roundProp, wallProp: wallProp,
      addStation: addStation, addFix: addFix, addVent: addVent, setButton: setButton
    });
    if (!button) throw new Error('map ' + def.id + ' has no emergency button (call A.setButton)');

    // ------------------------------------------------------------------------------------------
    // Solid-prop spatial buckets (per tile)
    // ------------------------------------------------------------------------------------------
    var buckets = new Array(W * H);
    props.forEach(function (p, i) {
      if (!p.solid) return;
      var x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w) / T), y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h) / T);
      for (var y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
        for (var x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
          var k = y * W + x;
          (buckets[k] || (buckets[k] = [])).push(i);
        }
    });
    var stamp = new Uint32Array(props.length), stampN = 0;

    // ------------------------------------------------------------------------------------------
    // Collision
    // ------------------------------------------------------------------------------------------
    // Push circle (x,y,r) out of a solid axis-aligned rect. Returns null if no overlap.
    function pushRect(x, y, r, rx0, ry0, rx1, ry1) {
      var cx = x < rx0 ? rx0 : x > rx1 ? rx1 : x;
      var cy = y < ry0 ? ry0 : y > ry1 ? ry1 : y;
      var dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 >= r * r) return null;
      if (d2 > 1e-9) {
        var d = Math.sqrt(d2), k = (r - d) / d;
        return [dx * k, dy * k];
      }
      // centre inside rect: leave through the nearest side
      var l = x - rx0, rr = rx1 - x, t = y - ry0, b = ry1 - y, m = Math.min(l, rr, t, b);
      if (m === l) return [-(l + r), 0];
      if (m === rr) return [rr + r, 0];
      if (m === t) return [0, -(t + r)];
      return [0, b + r];
    }
    function pushCircle(x, y, r, cx, cy, cr) {
      var dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy, rr = r + cr;
      if (d2 >= rr * rr) return null;
      var d = Math.sqrt(d2);
      if (d < 1e-6) return [0, -rr];
      var k = (rr - d) / d;
      return [dx * k, dy * k];
    }
    // One pass over everything overlapping the circle. Returns accumulated push or null.
    function contacts(x, y, r, out) {
      var x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T), y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r) / T);
      var hit = false, px = 0, py = 0, cx, cy, p;
      // grid: resolve the deepest contact first (avoids snagging on tile seams)
      var best = null, bestD = 0;
      for (cy = y0; cy <= y1; cy++) {
        for (cx = x0; cx <= x1; cx++) {
          if (!solidCell(cx, cy)) continue;
          p = pushRect(x, y, r, cx * T, cy * T, cx * T + T, cy * T + T);
          if (p) {
            var dd = p[0] * p[0] + p[1] * p[1];
            if (!best || dd > bestD) { best = p; bestD = dd; }
          }
        }
      }
      if (best) { px += best[0]; py += best[1]; hit = true; }
      stampN++;
      for (cy = Math.max(0, y0); cy <= Math.min(H - 1, y1); cy++) {
        for (cx = Math.max(0, x0); cx <= Math.min(W - 1, x1); cx++) {
          var bk = buckets[cy * W + cx];
          if (!bk) continue;
          for (var j = 0; j < bk.length; j++) {
            var idx = bk[j];
            if (stamp[idx] === stampN) continue;
            stamp[idx] = stampN;
            var pr = props[idx];
            p = pr.round ? pushCircle(x + px, y + py, r, pr.x + pr.w / 2, pr.y + pr.h / 2, pr.w / 2)
              : pushRect(x + px, y + py, r, pr.x, pr.y, pr.x + pr.w, pr.y + pr.h);
            if (p) { px += p[0]; py += p[1]; hit = true; }
          }
        }
      }
      out[0] = px; out[1] = py;
      return hit;
    }
    var tmp = [0, 0];
    function overlaps(x, y, r) {
      var x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T), y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r) / T);
      var cx, cy;
      for (cy = y0; cy <= y1; cy++) for (cx = x0; cx <= x1; cx++) {
        if (solidCell(cx, cy) && pushRect(x, y, r - 0.01, cx * T, cy * T, cx * T + T, cy * T + T)) return true;
      }
      for (cy = Math.max(0, y0); cy <= Math.min(H - 1, y1); cy++) for (cx = Math.max(0, x0); cx <= Math.min(W - 1, x1); cx++) {
        var bk = buckets[cy * W + cx];
        if (!bk) continue;
        for (var j = 0; j < bk.length; j++) {
          var pr = props[bk[j]];
          if (pr.round ? pushCircle(x, y, r - 0.01, pr.x + pr.w / 2, pr.y + pr.h / 2, pr.w / 2)
            : pushRect(x, y, r - 0.01, pr.x, pr.y, pr.x + pr.w, pr.y + pr.h)) return true;
        }
      }
      return false;
    }
    function resolve(x, y, r) {
      for (var it = 0; it < 6; it++) {
        if (!contacts(x, y, r, tmp)) return { x: x, y: y, ok: true };
        x += tmp[0]; y += tmp[1];
      }
      return { x: x, y: y, ok: !overlaps(x, y, r) };
    }

    function moveCircle(x, y, dx, dy, r) {
      r = r || PR;
      dx = +dx || 0; dy = +dy || 0;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (!isFinite(dist)) return { x: x, y: y };
      var steps = Math.max(1, Math.min(600, Math.ceil(dist / (r * 0.4))));
      var sx = dx / steps, sy = dy / steps;
      // if we start inside geometry (teleport/snap), get out first
      if (overlaps(x, y, r)) {
        var r0 = resolve(x, y, r);
        if (r0.ok) { x = r0.x; y = r0.y; }
      }
      for (var i = 0; i < steps; i++) {
        var res = resolve(x + sx, y + sy, r);
        if (res.ok) { x = res.x; y = res.y; continue; }
        res = resolve(x + sx, y, r);
        if (res.ok) { x = res.x; y = res.y; continue; }
        res = resolve(x, y + sy, r);
        if (res.ok) { x = res.x; y = res.y; continue; }
        break; // fully blocked
      }
      return { x: x, y: y };
    }

    function isWalkable(x, y) {
      var cx = Math.floor(x / T), cy = Math.floor(y / T);
      if (solidCell(cx, cy)) return false;
      var bk = buckets[cy * W + cx];
      if (bk) for (var j = 0; j < bk.length; j++) {
        var p = props[bk[j]];
        if (p.round) {
          var ddx = x - (p.x + p.w / 2), ddy = y - (p.y + p.h / 2);
          if (ddx * ddx + ddy * ddy < (p.w / 2) * (p.w / 2)) return false;
        } else if (x > p.x && x < p.x + p.w && y > p.y && y < p.y + p.h) return false;
      }
      return true;
    }
    // circle of radius r fits here without touching walls / solid props
    function canStand(x, y, r) { return isWalkable(x, y) && !overlaps(x, y, r || PR); }

    // ------------------------------------------------------------------------------------------
    // Raycast (grid DDA; walls and void block, props don't)
    // ------------------------------------------------------------------------------------------
    // dx,dy must be normalised. Returns {x,y,d,hit,cx,cy,side} side 0 = crossed a vertical
    // grid line (hit an east/west face), 1 = horizontal line (north/south face).
    // skipStart: if the origin is inside a wall, ignore walls until the ray reaches open floor.
    function castRay(x0, y0, dx, dy, maxd, skipStart) {
      var cx = Math.floor(x0 / T), cy = Math.floor(y0 / T);
      var inside = solidCell(cx, cy);
      if (inside && !skipStart) return { x: x0, y: y0, d: 0, hit: true, cx: cx, cy: cy, side: -1 };
      var stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
      var tdx = dx !== 0 ? Math.abs(T / dx) : Infinity, tdy = dy !== 0 ? Math.abs(T / dy) : Infinity;
      var tmx = dx > 0 ? ((cx + 1) * T - x0) / dx : dx < 0 ? (cx * T - x0) / dx : Infinity;
      var tmy = dy > 0 ? ((cy + 1) * T - y0) / dy : dy < 0 ? (cy * T - y0) / dy : Infinity;
      var t, side;
      for (var guard = 0; guard < 512; guard++) {
        if (tmx < tmy) { t = tmx; if (t > maxd) break; cx += stepX; tmx += tdx; side = 0; }
        else { t = tmy; if (t > maxd) break; cy += stepY; tmy += tdy; side = 1; }
        if (solidCell(cx, cy)) {
          if (!inside) return { x: x0 + dx * t, y: y0 + dy * t, d: t, hit: true, cx: cx, cy: cy, side: side };
        } else inside = false;
      }
      return { x: x0 + dx * maxd, y: y0 + dy * maxd, d: maxd, hit: false, cx: cx, cy: cy, side: -1 };
    }
    function raycast(x0, y0, x1, y1) {
      var dx = x1 - x0, dy = y1 - y0, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-9) return { x: x0, y: y0, d: 0, hit: false };
      // an origin slightly inside a wall (e.g. eye height next to a top wall) is tolerated
      return castRay(x0, y0, dx / d, dy / d, d, true);
    }
    // true if nothing blocks the straight line between the two points
    function lineOfSight(x0, y0, x1, y1) { return !raycast(x0, y0, x1, y1).hit; }

    // ------------------------------------------------------------------------------------------
    // Rooms, spawn, tasks
    // ------------------------------------------------------------------------------------------
    function roomAt(x, y) {
      var cx = Math.floor(x / T), cy = Math.floor(y / T);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
      var i = cellRoom[cy * W + cx];
      return i >= 0 ? rooms[i] : null;
    }

    function spawn(slot, n) {
      n = Math.max(1, n | 0 || 1);
      slot = slot | 0;
      var a = -Math.PI / 2 + ((slot % n) + 0.5) / n * Math.PI * 2;
      for (var rad = 150; rad < 400; rad += 12) {
        var x = Math.round(button.x + Math.cos(a) * rad), y = Math.round(button.y + Math.sin(a) * rad * 0.9);
        if (canStand(x, y, PR + 2)) return { x: x, y: y };
      }
      return { x: button.x, y: button.y + 130 };
    }

    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function assignTasks(seed, slot, n) {
      var rng = mulberry32(((seed | 0) ^ Math.imul(slot | 0, 2654435761)) >>> 0);
      var out = [];
      n = Math.max(0, n | 0);
      while (out.length < n) {
        var pool = TASKS.map(function (t) { return t.id; });
        for (var i = pool.length - 1; i > 0; i--) {
          var j = Math.floor(rng() * (i + 1));
          var tt = pool[i]; pool[i] = pool[j]; pool[j] = tt;
        }
        for (var k = 0; k < pool.length && out.length < n; k++) out.push(pool[k]);
      }
      return out;
    }

    return {
      id: def.id, name: def.name, blurb: def.blurb || '', theme: def.theme || {},
      W: W, H: H, TILE: T,
      grid: grid,
      cellRoom: cellRoom,
      rooms: rooms,
      corridors: CORRIDORS.map(function (c) { return { x: c[0], y: c[1], w: c[2], h: c[3] }; }),
      props: props,
      button: button,
      vents: vents,
      STATIONS: STATIONS,
      TASKS: TASKS,
      FIX: FIX,
      isWalkable: isWalkable,
      canStand: canStand,
      moveCircle: moveCircle,
      spawn: spawn,
      assignTasks: assignTasks,
      roomAt: roomAt,
      raycast: raycast,
      castRay: castRay,
      lineOfSight: lineOfSight,
      inChamfer: inChamfer,
      solidCell: solidCell
    };
  }

  // ==========================================================================================
  // Registry
  // ==========================================================================================
  var DEFS = [];
  var BUILT = {};
  var REGISTRY = ['define', 'select', 'list', 'indexOf', 'byIndex'];

  function define(id, def) {
    def.id = id;
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) { DEFS[i] = def; delete BUILT[id]; return; }
    DEFS.push(def);
  }
  function list() { return DEFS.map(function (d, i) { return { id: d.id, name: d.name, short: d.short || d.name, blurb: d.blurb || '', index: i }; }); }
  function indexOf(id) { for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) return i; return -1; }
  function byIndex(i) { return DEFS[i] ? DEFS[i].id : DEFS[0] && DEFS[0].id; }
  function select(id) {
    if (typeof id === 'number') id = byIndex(id);
    var d = null;
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) d = DEFS[i];
    if (!d) d = DEFS[0];
    if (!d) return null;
    if (IS.map.id === d.id) return IS.map;
    var m = BUILT[d.id] || (BUILT[d.id] = build(d));
    Object.keys(IS.map).forEach(function (k) { if (REGISTRY.indexOf(k) < 0) delete IS.map[k]; });
    Object.keys(m).forEach(function (k) { IS.map[k] = m[k]; });
    IS.map.version = (IS.map.version || 0) + 1;
    return IS.map;
  }

  IS.map = { define: define, select: select, list: list, indexOf: indexOf, byIndex: byIndex };

  // ==========================================================================================
  // Map 0: The Starship (the original station)
  // ==========================================================================================
  define('station', {
    name: 'The Starship', short: 'Starship',
    blurb: 'A classic spaceship with engines, reactor and a big cafeteria.',
    W: 90, H: 56,
    theme: { bg: 'stars' },
    rooms: [
      { id: 'cafeteria', name: 'Cafeteria', x: 36, y: 2, w: 20, h: 16, ch: { tl: 3, tr: 3, bl: 3, br: 3 }, floor: 'room', label: [0, 6.2] },
      { id: 'weapons', name: 'Weapons', x: 62, y: 3, w: 11, h: 11, ch: { tl: 2, tr: 2, bl: 2, br: 2 }, floor: 'tech', label: [0, 3.2] },
      { id: 'o2', name: 'O2', x: 59, y: 19, w: 8, h: 7, floor: 'room', label: [0, 0.4] },
      { id: 'navigation', name: 'Navigation', x: 77, y: 20, w: 11, h: 13, ch: { tr: 4, br: 4 }, floor: 'room', label: [-1.2, 3.6] },
      { id: 'shields', name: 'Shields', x: 66, y: 38, w: 11, h: 10, ch: { tl: 2, tr: 2, bl: 2, br: 2 }, floor: 'room', label: [-0.5, 3.4] },
      { id: 'communications', name: 'Communications', x: 53, y: 48, w: 11, h: 6, floor: 'tech', label: [0, 1.6] },
      { id: 'storage', name: 'Storage', x: 38, y: 36, w: 13, h: 13, floor: 'tech', label: [0, -2.6] },
      { id: 'admin', name: 'Admin', x: 49, y: 24, w: 9, h: 9, floor: 'room', label: [0, 3.1] },
      { id: 'electrical', name: 'Electrical', x: 26, y: 33, w: 10, h: 8, floor: 'tech', label: [0, 1.4] },
      { id: 'lowerEngine', name: 'Lower Engine', x: 8, y: 38, w: 12, h: 10, ch: { bl: 2 }, floor: 'tech', label: [0, 3.9] },
      { id: 'upperEngine', name: 'Upper Engine', x: 8, y: 5, w: 12, h: 11, ch: { tl: 2 }, floor: 'tech', label: [0, -3.6] },
      { id: 'security', name: 'Security', x: 19, y: 23, w: 8, h: 8, floor: 'tech', label: [0, 2.6] },
      { id: 'reactor', name: 'Reactor', x: 2, y: 19, w: 9, h: 16, ch: { tl: 3, bl: 3 }, floor: 'tech', label: [0, -4.6] },
      { id: 'medbay', name: 'MedBay', x: 25, y: 14, w: 10, h: 8, floor: 'room', label: [-1.0, 0.2] }
    ],

    corridors: [
      [20, 8, 16, 3],   // upper engine <-> cafeteria
      [28, 11, 3, 3],   // upper hall -> medbay
      [13, 16, 3, 22],  // left hall: upper engine <-> lower engine
      [11, 25, 2, 4],   // left hall -> reactor
      [16, 25, 3, 3],   // left hall -> security
      [20, 42, 18, 3],  // lower engine <-> storage
      [29, 41, 3, 1],   // lower hall -> electrical
      [43, 18, 3, 18],  // cafeteria <-> storage
      [46, 27, 3, 3],   // -> admin
      [56, 8, 6, 3],    // cafeteria <-> weapons
      [68, 14, 3, 24],  // right hall: weapons <-> shields
      [67, 21, 1, 3],   // right hall -> o2
      [71, 25, 6, 3],   // right hall -> navigation
      [51, 42, 15, 3],  // storage <-> shields
      [57, 45, 3, 3]    // -> communications
    ],

    author: function (A) {
      var T = A.T, prop = A.prop, roundProp = A.roundProp, wallProp = A.wallProp,
        addStation = A.addStation, addFix = A.addFix, addVent = A.addVent, setButton = A.setButton;
      // ---- Cafeteria ----
      var btn = roundProp('emergency', 46, 10, 0.92, { room: 'cafeteria' });
      btn.use = { x: 46 * T, y: 10 * T };
      setButton(btn);
      [[40.5, 6.3], [51.5, 6.3], [40.5, 13.6], [51.5, 13.6], [46, 4.6]].forEach(function (c) {
        roundProp('prop_table', c[0], c[1], 1.1, { room: 'cafeteria' });
      });
      addStation('wires', 'cafeteria', wallProp('wallpanel', 'cafeteria', 40));
      addStation('garbage', 'cafeteria', wallProp('chute', 'cafeteria', 51, 1.0));
      prop('prop_plant', 36.15, 5.3, 0.7, 0.7, { solid: true, room: 'cafeteria' });
      prop('prop_plant', 55.15, 5.3, 0.7, 0.7, { solid: true, room: 'cafeteria' });
      prop('prop_plant', 36.15, 13.9, 0.7, 0.7, { solid: true, room: 'cafeteria' });
      prop('prop_plant', 55.15, 13.9, 0.7, 0.7, { solid: true, room: 'cafeteria' });
      wallProp('prop_screen', 'cafeteria', 45, 1.6);

      // ---- Upper Engine ----
      prop('prop_engine', 9.0, 8.4, 5.0, 3.6, { solid: true, room: 'upperEngine' });
      addStation('fuel', 'upperEngine', prop('fuelport', 11.0, 12.05, 1.0, 0.5, { solid: true, room: 'upperEngine' }), 11.5, 12.95);
      addStation('align', 'upperEngine', prop('prop_console', 16.0, 5.05, 1.7, 1.0, { solid: true, room: 'upperEngine', tint: 'amber' }), 16.85, 6.55);
      prop('prop_barrel', 17.8, 10.9, 0.8, 0.8, { solid: true, room: 'upperEngine' });
      prop('prop_barrel', 18.7, 11.3, 0.8, 0.8, { solid: true, room: 'upperEngine' });

      // ---- Lower Engine ----
      prop('prop_engine', 9.0, 41.4, 5.0, 3.6, { solid: true, room: 'lowerEngine' });
      addStation('fuel', 'lowerEngine', prop('fuelport', 11.0, 45.05, 1.0, 0.5, { solid: true, room: 'lowerEngine' }), 11.5, 45.95);
      addStation('align', 'lowerEngine', prop('prop_console', 16.6, 38.05, 1.7, 1.0, { solid: true, room: 'lowerEngine', tint: 'amber' }), 17.45, 39.55);
      prop('prop_barrel', 17.9, 45.9, 0.8, 0.8, { solid: true, room: 'lowerEngine' });

      // ---- Reactor ----
      roundProp('prop_reactor', 6.0, 27.0, 1.6, { room: 'reactor' });
      addFix('reactor', 0, 'reactor', wallProp('handscan', 'reactor', 7, 0.9));
      addFix('reactor', 1, 'reactor', prop('handstand', 6.95, 34.1, 1.1, 0.8, { solid: true, room: 'reactor' }), 7.5, 33.72);
      addStation('numbers', 'reactor', prop('prop_console', 8.9, 19.05, 1.7, 1.0, { solid: true, room: 'reactor', tint: 'cyan' }), 9.75, 20.55);
      prop('prop_barrel', 2.3, 23.0, 0.8, 0.8, { solid: true, room: 'reactor' });
      prop('prop_barrel', 2.3, 29.6, 0.8, 0.8, { solid: true, room: 'reactor' });

      // ---- Security ----
      prop('secdesk', 20.6, 23.05, 3.4, 1.1, { solid: true, room: 'security' });
      wallProp('prop_screen', 'security', 21, 1.0);
      wallProp('prop_screen', 'security', 22, 1.0);
      wallProp('prop_screen', 'security', 23, 1.0);
      prop('prop_chair', 21.9, 24.55, 0.8, 0.8, { room: 'security' });
      addStation('wires', 'security', wallProp('wallpanel', 'security', 25));

      // ---- MedBay ----
      prop('prop_bed', 33.25, 14.5, 1.6, 2.4, { solid: true, room: 'medbay' });
      prop('prop_bed', 33.25, 17.9, 1.6, 2.4, { solid: true, room: 'medbay' });
      addStation('scan', 'medbay', prop('scanpad', 26.1, 18.2, 1.7, 1.7, { flat: true, room: 'medbay' }), 26.95, 19.05);
      prop('cabinet', 29.6, 20.95, 1.8, 1.0, { solid: true, room: 'medbay' });
      prop('prop_plant', 34.2, 21.2, 0.7, 0.7, { solid: true, room: 'medbay' });

      // ---- Electrical ----
      addStation('wires', 'electrical', wallProp('wallpanel', 'electrical', 27));
      addFix('lights', 0, 'electrical', wallProp('breaker', 'electrical', 29, 0.9));
      addStation('calibrate', 'electrical', wallProp('calib', 'electrical', 31, 0.9));
      addStation('divert', 'electrical', wallProp('divert', 'electrical', 33, 0.9));
      prop('generator', 26.25, 37.2, 1.6, 1.5, { solid: true, room: 'electrical' });
      prop('generator', 34.1, 37.2, 1.6, 1.5, { solid: true, room: 'electrical' });
      prop('prop_crate', 26.3, 39.6, 1.1, 1.0, { solid: true, room: 'electrical' });

      // ---- Storage ----
      prop('prop_crate', 39.6, 38.4, 1.6, 1.3, { solid: true, room: 'storage' });
      prop('prop_crate', 41.3, 38.9, 1.1, 0.9, { solid: true, room: 'storage' });
      prop('prop_crate', 43.8, 41.0, 2.4, 1.6, { solid: true, room: 'storage' });
      prop('prop_crate', 46.5, 45.0, 1.6, 1.3, { solid: true, room: 'storage' });
      prop('prop_crate', 48.3, 45.4, 1.3, 1.1, { solid: true, room: 'storage' });
      prop('prop_crate', 48.6, 38.6, 1.3, 1.2, { solid: true, room: 'storage' });
      prop('prop_barrel', 38.5, 46.5, 0.8, 0.85, { solid: true, room: 'storage' });
      addStation('fuel', 'storage', prop('prop_barrel', 39.45, 46.5, 0.8, 0.85, { solid: true, room: 'storage', tint: 'fuel' }), 39.85, 46.05);
      addStation('garbage', 'storage', wallProp('chute', 'storage', 47, 1.0));

      // ---- Admin ----
      prop('admintable', 51.6, 27.4, 3.8, 2.2, { solid: true, room: 'admin' });
      addStation('swipe', 'admin', wallProp('cardslot', 'admin', 55));
      addFix('o2', 1, 'admin', wallProp('keypad', 'admin', 52));
      prop('prop_plant', 49.15, 31.9, 0.7, 0.7, { solid: true, room: 'admin' });

      // ---- O2 ----
      addStation('leaves', 'o2', wallProp('o2filter', 'o2', 60, 1.0));
      addFix('o2', 0, 'o2', wallProp('keypad', 'o2', 62));
      addStation('garbage', 'o2', wallProp('chute', 'o2', 65, 1.0));
      prop('prop_plant', 59.2, 24.1, 0.75, 0.75, { solid: true, room: 'o2' });
      prop('prop_plant', 60.2, 24.3, 0.7, 0.7, { solid: true, room: 'o2' });
      prop('prop_barrel', 64.7, 24.05, 0.8, 0.8, { solid: true, room: 'o2', tint: 'o2' });
      prop('prop_barrel', 65.6, 24.05, 0.8, 0.8, { solid: true, room: 'o2', tint: 'o2' });

      // ---- Weapons ----
      addStation('asteroids', 'weapons', prop('gunseat', 66.0, 6.4, 2.0, 1.3, { solid: true, room: 'weapons' }), 67.0, 8.1);
      addStation('download', 'weapons', wallProp('wallscreen', 'weapons', 64));
      wallProp('window', 'weapons', 66, 1.0);
      wallProp('window', 'weapons', 67, 1.0);
      wallProp('window', 'weapons', 68, 1.0);
      prop('prop_crate', 63.0, 11.0, 1.1, 0.9, { solid: true, room: 'weapons' });

      // ---- Navigation ----
      addStation('download', 'navigation', prop('navconsole', 84.0, 24.6, 1.4, 3.8, { solid: true, room: 'navigation' }), 83.45, 26.5);
      wallProp('window', 'navigation', 80, 1.0);
      wallProp('window', 'navigation', 81, 1.0);
      wallProp('window', 'navigation', 82, 1.0);
      prop('prop_chair', 82.2, 26.1, 0.8, 0.8, { room: 'navigation' });

      // ---- Shields ----
      roundProp('shieldgen', 72.5, 43.0, 1.25, { room: 'shields' });
      addStation('divert', 'shields', wallProp('divert', 'shields', 74, 0.9));
      prop('prop_crate', 74.7, 44.7, 1.1, 0.9, { solid: true, room: 'shields' });

      // ---- Communications ----
      addFix('comms', 0, 'communications', wallProp('commspanel', 'communications', 55, 1.0));
      addStation('download', 'communications', prop('prop_console', 60.6, 48.05, 1.7, 1.0, { solid: true, room: 'communications', tint: 'green' }), 61.45, 49.55);
      wallProp('prop_screen', 'communications', 62, 1.0);
      prop('prop_chair', 61.0, 49.7, 0.8, 0.8, { room: 'communications' });
      prop('prop_plant', 53.15, 52.9, 0.7, 0.7, { solid: true, room: 'communications' });
      prop('prop_crate', 53.2, 50.6, 1.1, 0.9, { solid: true, room: 'communications' });

      // ---- Vents (linked groups) ----
      addVent(18.4, 14.4, 'upperEngine', [1]);           // 0
      addVent(3.5, 30.6, 'reactor', [0, 2]);             // 1
      addVent(18.4, 47.3, 'lowerEngine', [1]);           // 2
      addVent(25.9, 14.85, 'medbay', [4, 5]);            // 3
      addVent(25.6, 30.2, 'security', [3, 5]);           // 4
      addVent(34.9, 40.3, 'electrical', [3, 4]);         // 5
      addVent(52.7, 16.4, 'cafeteria', [7, 8]);          // 6
      addVent(56.9, 32.3, 'admin', [6, 8]);              // 7
      addVent(44.5, 31.5, 'hall', [6, 7]);               // 8 (cafeteria-storage hallway)
      addVent(71.0, 5.8, 'weapons', [10]);               // 9
      addVent(78.3, 21.2, 'navigation', [9]);            // 10
      addVent(78.3, 32.3, 'navigation', [12, 13]);       // 11
      addVent(68.4, 46.6, 'shields', [11, 13]);          // 12
      addVent(63.0, 25.35, 'o2', [11, 12]);              // 13

    }
  });

  select('station');
})();
