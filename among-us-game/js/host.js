/* Starship Sus — authoritative game rules (host side). See SPEC.md §3.3–3.4.
 *
 * IS.host.step(hs, peers, now) -> newHs is a pure function of its inputs, except for the
 * module-level `absentSince` map (peer -> host time first seen absent) used for the 3 s
 * disconnect grace; after a host migration those timers simply restart.
 *
 * Decisions beyond the spec (documented here so every module agrees):
 *  - Freeplay (st.free = 1): start allowed with >= 1 player, no win checks, a critical sabotage
 *    that times out is simply cleared. Roles: everybody is crewmate, except the HOST, who is
 *    impostor when settings `fr` (freeplay role) === 1. `fr` is an extra setting in [0,1].
 *  - Start: impostors' first kill cooldown and the sabotage cooldown end 10 s after the role
 *    reveal (kc = sc = pe + 10000).
 *  - Disconnect grace (3 s) also applies in the lobby before a slot is removed + compacted.
 *  - A disconnected (conn 0) player who comes back gets conn 1 again but stays dead (ghost).
 *  - Disconnected crewmates' tasks no longer count towards the crew task total.
 *  - A new slot's ls starts at the highest seq already in that player's `a` (stale actions
 *    sent while spectating are never replayed).
 *  - The seed is derived from (ep, gn, now) so step stays deterministic.
 *  - Meeting tally: a tie between top targets, or skip votes >= top count -> nobody (tie = 1
 *    when there was an exact tie, including with skip).
 */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});

  var GRACE = 3000;
  var PHASES = ['lobby', 'roles', 'play', 'meeting', 'eject', 'over'];
  var SAB_KINDS = ['reactor', 'o2', 'lights', 'comms'];
  var CRITICAL = { reactor: 1, o2: 1 };
  var INT_KEYS = { imp: 1, kcd: 1, dis: 1, vot: 1, emg: 1, nt: 1, conf: 1, kd: 1, free: 1, fr: 1 };
  var EXTRA_LIMITS = { fr: [0, 1] };

  var absentSince = Object.create(null);

  function CFG() { return IS.CONFIG; }
  function maxPlayers() { return CFG().MAX_PLAYERS || 10; }
  function nColors() { return (CFG().COLORS || []).length || 12; }
  function fin(v) { return typeof v === 'number' && isFinite(v); }
  function num(v, d) { return fin(v) ? v : d; }
  function int(v, d) { return fin(v) ? Math.round(v) : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
  function zeros(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v === undefined ? 0 : v); return a; }

  // ---------------------------------------------------------------- settings
  function clampSettings(input, base) {
    var D = CFG().DEFAULT_SETTINGS, L = CFG().SETTINGS_LIMITS;
    var src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    var b = base && typeof base === 'object' ? base : D;
    var out = {};
    var keys = Object.keys(D).concat(Object.keys(EXTRA_LIMITS));
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var lim = L[k] || EXTRA_LIMITS[k];
      var def = fin(b[k]) ? b[k] : fin(D[k]) ? D[k] : lim[0];
      var v = fin(src[k]) ? src[k] : def;
      v = clamp(v, lim[0], lim[1]);
      v = INT_KEYS[k] ? Math.round(v) : Math.round(v * 100) / 100;
      out[k] = v;
    }
    return out;
  }

  // ---------------------------------------------------------------- peers (untrusted)
  function cleanActions(a) {
    var out = [];
    if (!Array.isArray(a)) return out;
    for (var i = Math.max(0, a.length - 20); i < a.length; i++) {
      var e = a[i];
      if (!Array.isArray(e) || e.length < 2 || e.length > 6) continue;
      if (!isInt(e[0]) || e[0] < 1 || e[0] > 1e12 || typeof e[1] !== 'string' || e[1].length > 8) continue;
      out.push(e);
    }
    out.sort(function (p, q) { return p[0] - q[0]; });
    return out;
  }

  // Returns valid game-room participants (presence.v === 1, not agents), sorted by election
  // order (smallest j first, ties by peer string).
  function validPeers(peers) {
    var out = [], seen = Object.create(null);
    if (!peers || typeof peers.length !== 'number') return out;
    for (var i = 0; i < peers.length; i++) {
      var p = peers[i];
      if (!p || typeof p !== 'object' || p.kind === 'agent') continue;
      if (typeof p.peer !== 'string' || !p.peer || p.peer.length > 64 || seen[p.peer]) continue;
      var pr = p.presence;
      if (!pr || typeof pr !== 'object' || pr.v !== 1) continue;
      seen[p.peer] = 1;
      out.push({
        peer: p.peer,
        j: fin(pr.j) ? pr.j : Infinity,
        n: str(pr.n, 14),
        c: isInt(pr.c) && pr.c >= 0 && pr.c < nColors() ? pr.c : -1,
        x: fin(pr.x) ? pr.x : NaN,
        y: fin(pr.y) ? pr.y : NaN,
        vt: pr.vt === 1 ? 1 : 0,
        fx: str(pr.fx, 8),
        a: cleanActions(pr.a)
      });
    }
    out.sort(function (p, q) {
      if (p.j !== q.j) return p.j < q.j ? -1 : 1;
      return p.peer < q.peer ? -1 : p.peer > q.peer ? 1 : 0;
    });
    return out;
  }

  function elect(peers) {
    var v = validPeers(peers);
    return v.length ? v[0].peer : null;
  }

  // ---------------------------------------------------------------- hs shape
  function initial(epoch, settings) {
    return {
      v: 1, ep: str(epoch, 16) || 'ep', gn: 0, sq: 0, now: 0, ph: 'lobby', pe: 0,
      st: clampSettings(settings), sd: 0, pl: [], ls: [], lc: [], bd: [],
      mt: null, ej: null, sb: null, sc: 0, em: [], kc: [], wn: null
    };
  }

  function arrN(a, n, lo, hi) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var v = Array.isArray(a) ? a[i] : 0;
      out.push(fin(v) ? clamp(v, lo, hi) : 0);
    }
    return out;
  }

  // Validates/normalises an hs (from the wire or our own). Returns a fresh deep copy or null.
  function sanitize(h) {
    if (!h || typeof h !== 'object' || h.v !== 1) return null;
    if (PHASES.indexOf(h.ph) < 0 || !Array.isArray(h.pl) || h.pl.length > maxPlayers()) return null;
    var pl = [], seen = Object.create(null), nc = nColors();
    for (var i = 0; i < h.pl.length; i++) {
      var e = h.pl[i];
      if (!Array.isArray(e) || typeof e[0] !== 'string' || !e[0] || e[0].length > 64 || seen[e[0]]) return null;
      seen[e[0]] = 1;
      pl.push([
        e[0],
        isInt(e[1]) && e[1] >= 0 && e[1] < nc ? e[1] : 0,
        e[2] ? 1 : 0,
        e[3] === 1 ? 1 : 0,
        isInt(e[4]) && e[4] >= 0 ? e[4] & 0x3ff : 0,
        isInt(e[5]) ? clamp(e[5], 0, 10) : 0,
        e[6] === 0 ? 0 : 1
      ]);
    }
    var n = pl.length;
    var T = 1e15;
    var s = {
      v: 1, ep: str(h.ep, 16) || 'ep', gn: int(h.gn, 0), sq: int(h.sq, 0), now: num(h.now, 0),
      ph: h.ph, pe: num(h.pe, 0), st: clampSettings(h.st), sd: int(h.sd, 0) >>> 0, pl: pl,
      ls: arrN(h.ls, n, 0, 1e12), lc: arrN(h.lc, n, 0, 1e12), bd: [], mt: null, ej: null, sb: null,
      sc: num(h.sc, 0), em: arrN(h.em, n, 0, 99), kc: arrN(h.kc, n, 0, T), wn: null
    };
    if (Array.isArray(h.bd)) {
      for (i = 0; i < h.bd.length && s.bd.length < maxPlayers(); i++) {
        var b = h.bd[i];
        if (Array.isArray(b) && isInt(b[0]) && b[0] >= 0 && b[0] < n && fin(b[1]) && fin(b[2])) {
          s.bd.push([b[0], Math.round(b[1]), Math.round(b[2])]);
        }
      }
    }
    var m = h.mt;
    if (m && typeof m === 'object') {
      var vt = [];
      for (i = 0; i < n; i++) {
        var x = Array.isArray(m.vt) ? m.vt[i] : -2;
        vt.push(isInt(x) && x >= -2 && x < n ? x : -2);
      }
      s.mt = {
        by: isInt(m.by) && m.by >= -1 && m.by < n ? m.by : -1,
        bd: isInt(m.bd) && m.bd >= -1 && m.bd < n ? m.bd : -1,
        ds: num(m.ds, 0), vt: vt
      };
    }
    var j = h.ej;
    if (j && typeof j === 'object') {
      s.ej = {
        s: isInt(j.s) && j.s >= -1 && j.s < n ? j.s : -1, imp: j.imp ? 1 : 0, tie: j.tie ? 1 : 0,
        left: isInt(j.left) ? clamp(j.left, 0, 10) : 0
      };
    }
    var sb = h.sb;
    if (sb && typeof sb === 'object' && SAB_KINDS.indexOf(sb.k) >= 0) {
      var fx = Array.isArray(sb.fx) ? sb.fx : [];
      s.sb = { k: sb.k, end: CRITICAL[sb.k] ? num(sb.end, 0) : 0, fx: [fx[0] ? 1 : 0, fx[1] ? 1 : 0] };
    }
    var w = h.wn;
    if (w && typeof w === 'object' && (w.t === 'crew' || w.t === 'imp')) {
      s.wn = { t: w.t, r: str(w.r, 12) };
    }
    if (s.ph === 'meeting' && !s.mt) return null;
    if (s.ph === 'eject' && !s.ej) return null;
    return s;
  }

  // Shift every host-clock timestamp by `delta` ms (used on host migration across clocks).
  function shiftTime(h, delta) {
    var s = sanitize(h);
    if (!s || !delta) return s;
    function sh(t) { return t > 0 ? t + delta : t; }
    s.now = sh(s.now); s.pe = sh(s.pe); s.sc = sh(s.sc);
    for (var i = 0; i < s.kc.length; i++) s.kc[i] = sh(s.kc[i]);
    if (s.mt) s.mt.ds = sh(s.mt.ds);
    if (s.sb) s.sb.end = sh(s.sb.end);
    return s;
  }

  // ---------------------------------------------------------------- helpers
  function hash32(t) {
    var h = 2166136261;
    for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function impCount(n, imp) {
    return Math.max(1, Math.min(imp, Math.floor((n - 1) / 2)));
  }
  function popcount(m) { var c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }
  function isSlot(s, t) { return isInt(t) && t >= 0 && t < s.pl.length; }

  function removeSlot(s, i) {
    s.pl.splice(i, 1); s.ls.splice(i, 1); s.lc.splice(i, 1); s.em.splice(i, 1); s.kc.splice(i, 1);
  }
  function addSlot(s, p) {
    var taken = Object.create(null);
    for (var i = 0; i < s.pl.length; i++) taken[s.pl[i][1]] = 1;
    var col = p.c >= 0 && !taken[p.c] ? p.c : -1;
    for (i = 0; col < 0 && i < nColors(); i++) if (!taken[i]) col = i;
    if (col < 0) col = 0;
    var maxSeq = 0;
    for (i = 0; i < p.a.length; i++) if (p.a[i][0] > maxSeq) maxSeq = p.a[i][0];
    s.pl.push([p.peer, col, 1, 0, 0, s.st.nt, 1]);
    s.ls.push(maxSeq); s.lc.push(0); s.em.push(0); s.kc.push(0);
  }

  function clearGame(s) {
    s.pe = 0; s.bd = []; s.mt = null; s.ej = null; s.sb = null; s.wn = null; s.sc = 0;
    var n = s.pl.length;
    s.em = zeros(n); s.kc = zeros(n);
  }

  function startGame(s, hostSlot, now) {
    var C = CFG(), n = s.pl.length;
    s.gn += 1;
    s.sd = (hash32(s.ep + ':' + s.gn + ':' + now) & 0x7fffffff) || 1;
    var roles = zeros(n);
    if (s.st.free) {
      if (s.st.fr === 1 && hostSlot >= 0) roles[hostSlot] = 1;
    } else {
      var r = rng(s.sd), order = [];
      for (var i = 0; i < n; i++) order.push(i);
      for (i = n - 1; i > 0; i--) {
        var k = Math.floor(r() * (i + 1)), t = order[i];
        order[i] = order[k]; order[k] = t;
      }
      var ni = impCount(n, s.st.imp);
      for (i = 0; i < ni; i++) roles[order[i]] = 1;
    }
    clearGame(s);
    s.ph = 'roles';
    s.pe = now + (C.ROLE_TIME || 4.5) * 1000;
    for (i = 0; i < n; i++) {
      var e = s.pl[i];
      s.pl[i] = [e[0], e[1], 1, roles[i], 0, s.st.nt, 1];
      s.kc[i] = roles[i] ? s.pe + 10000 : 0;
    }
    s.sc = s.pe + 10000;
  }

  function backToLobby(s) {
    clearGame(s);
    s.ph = 'lobby';
    for (var i = 0; i < s.pl.length; i++) {
      var e = s.pl[i];
      s.pl[i] = [e[0], e[1], 1, 0, 0, s.st.nt, 1];
    }
  }

  function startMeeting(s, by, body, now) {
    s.ph = 'meeting';
    s.mt = { by: by, bd: body, ds: now + s.st.dis * 1000, vt: zeros(s.pl.length, -2) };
    s.pe = s.mt.ds + s.st.vot * 1000;
    s.bd = [];
    if (s.sb && s.sb.end > 0) s.sb = null;
  }

  // Votes per target: {skip: [slots], none: [slots], by: {targetSlot: [voterSlots]}}
  function votes(h) {
    var out = { skip: [], none: [], by: {} };
    if (!h || !h.mt || !Array.isArray(h.mt.vt)) return out;
    for (var i = 0; i < h.mt.vt.length; i++) {
      var e = h.pl[i];
      if (!e || !e[2] || !e[6]) continue;
      var v = h.mt.vt[i];
      if (v === -1) out.skip.push(i);
      else if (v >= 0) (out.by[v] = out.by[v] || []).push(i);
      else out.none.push(i);
    }
    return out;
  }

  function tally(s, now) {
    var vs = votes(s), max = 0, top = -1, tie = false;
    for (var k in vs.by) {
      var c = vs.by[k].length;
      if (c > max) { max = c; top = +k; tie = false; } else if (c === max) tie = true;
    }
    var skip = vs.skip.length, out = -1, tieF = 0;
    if (max > 0) {
      if (tie || skip === max) tieF = 1;
      else if (skip < max) out = top;
    }
    if (out >= 0) s.pl[out][2] = 0;
    var left = 0;
    for (var i = 0; i < s.pl.length; i++) if (s.pl[i][3] === 1 && s.pl[i][2] && s.pl[i][6]) left++;
    s.ej = { s: out, imp: out >= 0 && s.pl[out][3] === 1 ? 1 : 0, tie: tieF, left: left };
    s.ph = 'eject';
    s.pe = now + (CFG().EJECT_TIME || 7) * 1000;
  }

  function counts(s) {
    var c = { imp: 0, crew: 0, done: 0, total: 0 };
    for (var i = 0; i < s.pl.length; i++) {
      var e = s.pl[i];
      if (e[3] === 1) { if (e[2] && e[6]) c.imp++; continue; }
      if (e[2] && e[6]) c.crew++;
      if (!e[6]) continue; // disconnected crew: their tasks leave the total
      c.total += e[5];
      c.done += popcount(e[4] & ((1 << e[5]) - 1));
    }
    return c;
  }

  function win(s, t, r) {
    s.ph = 'over'; s.pe = 0; s.wn = { t: t, r: r };
    s.mt = null; s.sb = null; s.bd = [];
  }

  function checkWin(s, now, viaVote) {
    if (s.st.free) {
      if (s.sb && s.sb.end > 0 && now >= s.sb.end) s.sb = null;
      return false;
    }
    var c = counts(s);
    if (c.imp === 0) { win(s, 'crew', viaVote ? 'vote' : 'disconnect'); return true; }
    if (c.imp >= c.crew) { win(s, 'imp', viaVote ? 'vote' : 'kills'); return true; }
    if (s.ph === 'play' && c.total > 0 && c.done >= c.total) { win(s, 'crew', 'tasks'); return true; }
    if (s.ph === 'play' && s.sb && s.sb.end > 0 && now >= s.sb.end) { win(s, 'imp', 'sabotage'); return true; }
    return false;
  }

  // ---------------------------------------------------------------- actions
  function apply(s, i, a, ctx) {
    var now = ctx.now, me = s.pl[i], p = ctx.byPeer[me[0]], t = a[2];
    var isHost = me[0] === ctx.hostPeer;
    switch (a[1]) {
      case 'col':
        if (s.ph !== 'lobby' || !isInt(t) || t < 0 || t >= nColors()) return;
        for (var k = 0; k < s.pl.length; k++) if (k !== i && s.pl[k][1] === t) return;
        me[1] = t;
        return;
      case 'set':
        if (s.ph !== 'lobby' || !isHost || !t || typeof t !== 'object' || Array.isArray(t)) return;
        s.st = clampSettings(t, s.st);
        return;
      case 'start': {
        if (s.ph !== 'lobby' || !isHost) return;
        var present = 0;
        for (k = 0; k < s.pl.length; k++) if (ctx.byPeer[s.pl[k][0]]) present++;
        if (present < (s.st.free ? 1 : CFG().MIN_PLAYERS || 3)) return;
        startGame(s, i, now);
        return;
      }
      case 'again':
        if (s.ph !== 'over' || !isHost) return;
        backToLobby(s);
        return;
      case 'kill': {
        if (s.ph !== 'play' || !isSlot(s, t) || t === i) return;
        var tg = s.pl[t];
        if (!me[2] || !me[6] || me[3] !== 1 || !tg[2] || !tg[6] || tg[3] !== 0) return;
        if (now < s.kc[i]) return;
        var pt = ctx.byPeer[tg[0]];
        if (!p || !pt || p.vt || !fin(p.x) || !fin(p.y) || !fin(pt.x) || !fin(pt.y)) return;
        var range = (CFG().KILL_RANGE[s.st.kd] || 100) * 1.6;
        var dx = p.x - pt.x, dy = p.y - pt.y;
        if (dx * dx + dy * dy > range * range) return;
        tg[2] = 0;
        s.bd.push([t, Math.round(pt.x), Math.round(pt.y)]);
        s.kc[i] = now + s.st.kcd * 1000;
        return;
      }
      case 'rep': {
        if (s.ph !== 'play' || !me[2] || !me[6] || !isInt(t)) return;
        for (k = 0; k < s.bd.length; k++) {
          if (s.bd[k][0] === t) { startMeeting(s, i, t, now); return; }
        }
        return;
      }
      case 'emg':
        if (s.ph !== 'play' || !me[2] || !me[6] || s.em[i] >= s.st.emg) return;
        if (s.sb && s.sb.end > 0) return;
        s.em[i] += 1;
        startMeeting(s, i, -1, now);
        return;
      case 'vote':
        if (s.ph !== 'meeting' || !s.mt || now < s.mt.ds || !me[2] || !me[6] || s.mt.vt[i] !== -2) return;
        if (t === -1 || (isSlot(s, t) && s.pl[t][2] && s.pl[t][6])) s.mt.vt[i] = t;
        return;
      case 'task':
        if (s.ph !== 'play' || me[3] !== 0 || !isInt(t) || t < 0 || t >= me[5]) return;
        me[4] |= 1 << t;
        return;
      case 'sab':
        if (s.ph !== 'play' || me[3] !== 1 || SAB_KINDS.indexOf(t) < 0 || s.sb || now < s.sc) return;
        s.sb = { k: t, end: CRITICAL[t] ? now + (CFG().SAB_TIME || 40) * 1000 : 0, fx: [0, 0] };
        s.sc = now + (CFG().SAB_COOLDOWN || 30) * 1000;
        return;
      case 'fix': {
        if (s.ph !== 'play' || !s.sb || s.sb.k !== t) return;
        var part = a[3];
        if (t === 'o2') {
          if (part !== 0 && part !== 1) return;
          s.sb.fx[part] = 1;
          if (s.sb.fx[0] && s.sb.fx[1]) s.sb = null;
        } else if (t === 'lights' || t === 'comms') {
          s.sb = null;
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------- step
  function step(hs, peers, now) {
    var s = sanitize(hs);
    if (!s) return hs;
    now = fin(now) ? now : Date.now();
    s.now = now;
    var vp = validPeers(peers), byPeer = Object.create(null);
    for (var i = 0; i < vp.length; i++) byPeer[vp[i].peer] = vp[i];
    var ctx = { now: now, byPeer: byPeer, hostPeer: vp.length ? vp[0].peer : null };

    // presence tracking
    var inPl = Object.create(null);
    for (i = 0; i < s.pl.length; i++) {
      var pid = s.pl[i][0];
      inPl[pid] = 1;
      if (byPeer[pid]) delete absentSince[pid];
      else if (!(pid in absentSince)) absentSince[pid] = now;
    }
    for (var key in absentSince) if (!inPl[key]) delete absentSince[key];
    function gone(peer) { return !byPeer[peer] && now - absentSince[peer] > GRACE; }

    if (s.ph === 'lobby') {
      for (i = s.pl.length - 1; i >= 0; i--) if (gone(s.pl[i][0])) removeSlot(s, i);
      for (i = 0; i < vp.length && s.pl.length < maxPlayers(); i++) {
        var have = false;
        for (var q = 0; q < s.pl.length; q++) if (s.pl[q][0] === vp[i].peer) have = true;
        if (!have) addSlot(s, vp[i]);
      }
      for (i = 0; i < s.pl.length; i++) s.pl[i][6] = 1;
    } else {
      for (i = 0; i < s.pl.length; i++) {
        var e = s.pl[i];
        if (gone(e[0])) { e[6] = 0; e[2] = 0; } else if (byPeer[e[0]] && !e[6]) e[6] = 1;
      }
    }

    // actions, per slot in order
    for (i = 0; i < s.pl.length; i++) {
      var p = byPeer[s.pl[i][0]];
      if (!p) continue;
      var last = s.ls[i], mx = last;
      for (var k = 0; k < p.a.length; k++) {
        var a = p.a[k];
        if (a[0] <= last) continue;
        if (a[0] > mx) mx = a[0];
        if (i < s.pl.length && s.pl[i][0] === p.peer) apply(s, i, a, ctx);
      }
      if (s.pl[i] && s.pl[i][0] === p.peer) s.ls[i] = mx;
    }

    // timed transitions + continuous rules
    if (s.ph === 'roles' && now >= s.pe) { s.ph = 'play'; s.pe = 0; }
    if (s.ph === 'play' && s.sb && s.sb.k === 'reactor') {
      var h0 = 0, h1 = 0;
      for (i = 0; i < s.pl.length; i++) {
        var pp = byPeer[s.pl[i][0]];
        if (!pp || !s.pl[i][6]) continue;
        if (pp.fx === 'r0') h0 = 1; else if (pp.fx === 'r1') h1 = 1;
      }
      if (h0 && h1) s.sb = null; else s.sb.fx = [h0, h1];
    }
    if (s.ph === 'meeting') {
      var all = true;
      for (i = 0; i < s.pl.length; i++) if (s.pl[i][2] && s.pl[i][6] && s.mt.vt[i] === -2) all = false;
      if (now >= s.pe || (all && now >= s.mt.ds)) tally(s, now);
    } else if (s.ph === 'eject' && now >= s.pe) {
      s.mt = null;
      if (!checkWin(s, now, true)) {
        s.ph = 'play'; s.pe = 0; s.ej = null;
        for (i = 0; i < s.pl.length; i++) if (s.pl[i][3] === 1) s.kc[i] = now + s.st.kcd * 1000;
      }
    }
    if (s.ph === 'play' || s.ph === 'meeting') checkWin(s, now, false);
    return s;
  }

  function size(h) { return JSON.stringify(h).length; }

  IS.host = {
    GRACE: GRACE,
    initial: initial,
    step: step,
    sanitize: sanitize,
    shiftTime: shiftTime,
    elect: elect,
    validPeers: validPeers,
    clampSettings: clampSettings,
    impCount: impCount,
    votes: votes,
    popcount: popcount,
    size: size,
    _reset: function () { absentSince = Object.create(null); }
  };
})();
