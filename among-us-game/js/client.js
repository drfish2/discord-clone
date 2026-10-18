/* Starship Sus — client state, host loop, actions, chat. See SPEC.md §3, §4.7.
 * Extras beyond the spec (all optional for consumers):
 *   state() also carries: isHost, mode, settings, bodies [{slot,x,y,color}], meeting (hs.mt),
 *   eject (hs.ej), sabotage (hs.sb), winner (hs.wn), phaseEnd (hs.pe), gn, myTasks [{id,done}]
 *   (via IS.map.assignTasks), myColor, roleKnown per player. players[].role is MASKED to 0
 *   unless it is me, an impostor teammate (when I am impostor) or the game is over.
 *   create({name, color, free, role}) — role 1 makes the freeplay host an impostor (st.fr).
 *   IS.client.votes() -> IS.host.votes(hs) (voters per target, for meeting results).
 */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});

  var HOST_TICK = 125, HEARTBEAT = 1000, SELF_MIN = 50, JOIN_WAIT = 10000, READY_WAIT = 14000;
  var CODE_RE = /^[A-HJ-NP-Z]{4}$/;
  var BAD_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff\\ufff0-\\uffff\\ue000-\\uf8ff]', 'g');

  function CFG() { return IS.CONFIG; }
  function fin(v) { return typeof v === 'number' && isFinite(v); }
  function isInt(v) { return fin(v) && Math.floor(v) === v; }
  function cleanText(t, n) {
    return typeof t === 'string' ? t.replace(BAD_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, n) : '';
  }
  function cleanName(n) { return cleanText(n, 14); }
  function clampColor(c) { return isInt(c) && c >= 0 && c < CFG().COLORS.length ? c : 0; }
  function rid(n) {
    var abc = 'abcdefghijklmnopqrstuvwxyz0123456789', s = '';
    for (var i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }
  function genCode(avoid) {
    var A = CFG().CODE_ALPHABET, c;
    do {
      c = '';
      for (var i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
    } while (avoid && avoid[c]);
    return c;
  }
  function roomName(code) { return CFG().ROOM_PREFIX + code.toLowerCase(); }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var listeners = { state: [], phase: [], chat: [], kicked: [] };
  var gameListeners = [];
  function emit(evt, data) {
    var ls = listeners[evt] ? listeners[evt].slice() : [];
    for (var i = 0; i < ls.length; i++) {
      try { ls[i](data); } catch (e) { setTimeout(function () { throw e; }); }
    }
  }

  // ------------------------------------------------------------------ module state
  var S = {
    mode: null, booted: null, lobby: null, games: [], gamesKey: '',
    lobbyPres: { v: 1, n: '', g: null }, lobbyKey: '',
    room: null, code: null, unsubRoom: null, gen: 0,
    name: '', color: 0, j: 0,
    pres: null,           // mirror of my game-room presence (what we sent)
    selfPending: null, selfTimer: null, selfLast: 0,
    seq: 0, acts: [], chSeq: 0, chs: [],
    hs: null, hsRaw: null, hostPeer: null, amHost: false,
    hostTimer: null, tickTimer: null, lastTick: 0, lastKey: '', lastPub: 0,
    offSamples: [], offset: 0,
    names: Object.create(null), lastPos: Object.create(null),
    seenChat: Object.create(null),
    view: null, lastPhase: null, tasksKey: '', tasks: null,
    cachedPeersRaw: null, cachedPeersVer: -1, cachedPeers: null, presVer: 0
  };

  function myPeer() { return IS.net && IS.net.myPeer; }

  function safePresence(room, patch, retry) {
    if (!room) return;
    try {
      var p = room.presence(patch);
      if (p && typeof p.catch === 'function') {
        p.catch(function (e) {
          if (retry || !e || e.code !== 'invalid_argument' || room !== S.room) return;
          // Too big: shed chat history, then actions, and try again.
          S.chs = S.chs.slice(-1); S.acts = S.acts.slice(-4);
          S.pres.ch = S.chs.slice(); S.pres.a = S.acts.slice();
          var q = {};
          for (var k in patch) q[k] = patch[k];
          q.ch = S.pres.ch; q.a = S.pres.a;
          safePresence(room, q, true);
        });
      }
    } catch (e) { /* ignore */ }
  }

  function setPres(patch) {
    if (!S.room || !S.pres) return;
    for (var k in patch) { if (patch[k] === null) delete S.pres[k]; else S.pres[k] = patch[k]; }
    S.presVer++;
    safePresence(S.room, patch);
  }

  // Peers of the game room with my own entry replaced by my local mirror (so the host sees its
  // own fresh actions/position without waiting for the transport echo).
  function currentPeers() {
    if (!S.room) return [];
    var raw = S.room.peers();
    if (raw === S.cachedPeersRaw && S.presVer === S.cachedPeersVer) return S.cachedPeers;
    var me = myPeer(), out = [], found = false;
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i];
      if (!p || p.kind === 'agent') continue;
      if (p.peer === me || p.sameTab) {
        if (found) continue;
        found = true;
        out.push({ peer: me, isMe: true, sameTab: true, kind: 'viewer', presence: S.pres || {}, updatedAt: p.updatedAt });
      } else out.push(p);
    }
    if (!found && me && S.pres) out.push({ peer: me, isMe: true, sameTab: true, kind: 'viewer', presence: S.pres, updatedAt: Date.now() });
    S.cachedPeersRaw = raw; S.cachedPeersVer = S.presVer; S.cachedPeers = out;
    return out;
  }

  // ------------------------------------------------------------------ lobby / game list
  function updateLobbyPresence() {
    if (!S.lobby) return;
    var hosting = S.amHost && S.hs && S.code && !S.hs.st.free;
    var p = {
      v: 1, n: S.name || '', g: hosting ? S.code : null,
      gc: hosting ? S.hs.pl.length : null, gp: hosting ? S.hs.ph : null,
      gm: hosting ? CFG().MAX_PLAYERS : null
    };
    var key = JSON.stringify(p);
    if (key === S.lobbyKey) return;
    S.lobbyKey = key;
    safePresence(S.lobby, p);
  }

  function onLobbyPeers() {
    if (!S.lobby) return;
    var ps = S.lobby.peers(), list = [], seen = Object.create(null);
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], pr = p && p.presence;
      if (!p || p.kind === 'agent' || !pr || pr.v !== 1 || typeof pr.g !== 'string' || !CODE_RE.test(pr.g)) continue;
      if (seen[pr.g]) continue;
      seen[pr.g] = 1;
      list.push({
        code: pr.g,
        host: cleanName(pr.n) || 'Host',
        count: isInt(pr.gc) ? Math.max(0, Math.min(pr.gc, 99)) : 0,
        max: isInt(pr.gm) ? Math.max(1, Math.min(pr.gm, 99)) : CFG().MAX_PLAYERS,
        phase: typeof pr.gp === 'string' ? pr.gp.slice(0, 8) : 'lobby',
        isMe: !!p.sameTab
      });
    }
    list.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    var key = JSON.stringify(list);
    if (key === S.gamesKey) return;
    S.gamesKey = key;
    S.games = list;
    for (i = 0; i < gameListeners.length; i++) {
      try { gameListeners[i](list.slice()); } catch (e) { /* ignore */ }
    }
  }

  function boot() {
    if (S.booted) return S.booted;
    S.booted = IS.net.init().then(function (r) {
      S.mode = r.mode;
      S.lobby = IS.net.lobby;
      updateLobbyPresence();
      S.lobby.onPeers(onLobbyPeers);
      return { mode: r.mode };
    });
    return S.booted;
  }

  function waitReady() {
    return Promise.race([IS.net.ready, delay(READY_WAIT)]).then(function () {
      if (!myPeer()) throw new Error('offline');
    });
  }

  // ------------------------------------------------------------------ joining
  function attachRoom(room, code, name, color) {
    S.gen++;
    S.room = room; S.code = code; S.name = name; S.color = color;
    S.hs = null; S.hsRaw = null; S.hostPeer = null; S.amHost = false;
    S.offSamples = []; S.offset = 0; S.lastKey = ''; S.lastPub = 0;
    S.lastPhase = null; S.view = null; S.tasksKey = ''; S.tasks = null;
    S.acts = []; S.chs = [];
    S.seenChat = Object.create(null);
    S.cachedPeersRaw = null;
    var gen = S.gen;
    S.unsubRoom = room.onPeers(function () { if (gen === S.gen) evaluate(); }, function (e) {
      if (gen !== S.gen) return;
      var reason = (e && e.code) || 'error';
      leave();
      emit('kicked', { reason: reason });
    });
  }

  function fullPresence() {
    S.pres = { v: 1, n: S.name, c: S.color, ht: S.hat | 0, j: S.j, x: 0, y: 0, f: 1, m: 0, vt: 0, fx: '', a: [], ch: [] };
    S.presVer++;
    safePresence(S.room, S.pres);
  }

  function findHs(peers) {
    var best = null;
    for (var i = 0; i < peers.length; i++) {
      var p = peers[i], pr = p && p.presence;
      if (!p || p.sameTab || p.kind === 'agent' || !pr || pr.v !== 1 || !pr.hs) continue;
      var h = IS.host.sanitize(pr.hs);
      if (h && (!best || (fin(pr.j) ? pr.j : Infinity) < best.j)) best = { hs: h, j: fin(pr.j) ? pr.j : Infinity };
    }
    return best;
  }

  function create(opts) {
    opts = opts || {};
    return boot().then(waitReady).then(function () {
      if (S.room) leave();
      var name = cleanName(opts.name) || 'Player', color = clampColor(opts.color);
      S.hat = clampHat(opts.hat);
      var avoid = Object.create(null);
      for (var i = 0; i < S.games.length; i++) avoid[S.games[i].code] = 1;
      var code = genCode(avoid);
      return IS.net.join(roomName(code)).then(function (room) {
        attachRoom(room, code, name, color);
        S.j = Date.now();
        var st = {};
        var D = CFG().DEFAULT_SETTINGS;
        for (var k in D) st[k] = D[k];
        st.free = opts.free ? 1 : 0;
        st.fr = opts.role === 1 ? 1 : 0;
        S.hs = IS.host.initial(rid(6), st);
        fullPresence();
        evaluate();
        return code;
      });
    });
  }

  function join(opts) {
    opts = opts || {};
    var code = typeof opts.code === 'string' ? opts.code.trim().toUpperCase() : '';
    if (!CODE_RE.test(code)) return Promise.reject(new Error('not_found'));
    return boot().then(waitReady).then(function () {
      if (S.room) leave();
      return IS.net.join(roomName(code)).catch(function () { throw new Error('not_found'); });
    }).then(function (room) {
      return new Promise(function (resolve, reject) {
        var done = false, unsub = null;
        function check() {
          if (done) return;
          var f = findHs(room.peers());
          if (!f) return;
          done = true;
          if (unsub) unsub();
          clearTimeout(t);
          resolve({ room: room, found: f });
        }
        var t = setTimeout(function () {
          if (done) return;
          done = true;
          if (unsub) unsub();
          room.leave();
          reject(new Error('not_found'));
        }, JOIN_WAIT);
        unsub = room.onPeers(check);
        check();
      });
    }).then(function (r) {
      var f = r.found;
      if (f.hs.ph === 'lobby' && f.hs.pl.length >= CFG().MAX_PLAYERS) {
        r.room.leave();
        throw new Error('full');
      }
      var name = cleanName(opts.name) || 'Player', color = clampColor(opts.color);
      S.hat = clampHat(opts.hat);
      attachRoom(r.room, code, name, color);
      var maxJ = 0, ps = r.room.peers();
      for (var i = 0; i < ps.length; i++) {
        var pr = ps[i] && ps[i].presence;
        if (pr && fin(pr.j) && pr.j > maxJ && !ps[i].sameTab) maxJ = pr.j;
      }
      S.j = Math.max(Date.now(), Math.floor(maxJ) + 1);
      S.hs = f.hs;
      fullPresence();
      evaluate();
    });
  }

  function leave() {
    if (!S.room) return;
    stopHost(true);
    if (S.unsubRoom) { try { S.unsubRoom(); } catch (e) { /* ignore */ } }
    S.unsubRoom = null;
    if (S.selfTimer) { clearTimeout(S.selfTimer); S.selfTimer = null; }
    S.selfPending = null;
    var room = S.room;
    S.gen++;
    S.room = null; S.code = null; S.hs = null; S.hsRaw = null; S.pres = null;
    S.hostPeer = null; S.view = null; S.lastPhase = null;
    try { room.leave(); } catch (e) { /* ignore */ }
    updateLobbyPresence();
    emit('state', state());
  }

  // ------------------------------------------------------------------ host election & loop
  function evaluate() {
    if (!S.room) return;
    var peers = currentPeers();
    var hp = IS.host.elect(peers), me = myPeer();
    if (hp !== S.hostPeer) {
      S.hostPeer = hp;
      S.offSamples = [];
    }
    if (hp && hp === me) {
      if (!S.amHost) becomeHost();
      else scheduleTick();
    } else {
      if (S.amHost) stopHost(false);
      readHostHs(peers, hp);
    }
    processChat(peers);
    refresh();
  }

  function readHostHs(peers, hp) {
    if (!hp) return;
    for (var i = 0; i < peers.length; i++) {
      var p = peers[i];
      if (p.peer !== hp) continue;
      var raw = p.presence && p.presence.hs;
      if (!raw || raw === S.hsRaw) return;
      S.hsRaw = raw;
      var h = IS.host.sanitize(raw);
      if (!h) return;
      if (h.now > 0) {
        S.offSamples.push(h.now - Date.now());
        if (S.offSamples.length > 10) S.offSamples.shift();
        S.offset = Math.max.apply(null, S.offSamples);
      }
      S.hs = h;
      syncSeq();
      return;
    }
  }

  function becomeHost() {
    S.amHost = true;
    var base = S.hs;
    if (base && base.now > 0 && S.offset) base = IS.host.shiftTime(base, -S.offset) || base;
    S.hs = base || IS.host.initial(rid(6), CFG().DEFAULT_SETTINGS);
    S.offset = 0; S.offSamples = [];
    S.lastKey = ''; S.lastPub = 0;
    if (S.hostTimer) clearInterval(S.hostTimer);
    S.hostTimer = setInterval(hostTick, HOST_TICK);
    hostTick();
  }

  function stopHost(leaving) {
    if (S.hostTimer) clearInterval(S.hostTimer);
    if (S.tickTimer) clearTimeout(S.tickTimer);
    S.hostTimer = null; S.tickTimer = null;
    if (!S.amHost) return;
    S.amHost = false;
    if (!leaving && S.pres && S.pres.hs) setPres({ hs: null });
    updateLobbyPresence();
  }

  function scheduleTick() {
    if (!S.amHost || S.tickTimer) return;
    var wait = Math.max(0, S.lastTick + 30 - Date.now());
    S.tickTimer = setTimeout(function () { S.tickTimer = null; hostTick(); }, wait);
  }

  function stableKey(h) {
    var n = h.now, q = h.sq;
    h.now = 0; h.sq = 0;
    var k = JSON.stringify(h);
    h.now = n; h.sq = q;
    return k;
  }

  function hostTick() {
    if (!S.amHost || !S.room || !S.hs) return;
    var t = Date.now();
    S.lastTick = t;
    var prevSq = S.hs.sq | 0;
    var next = IS.host.step(S.hs, currentPeers(), t);
    if (!next || next === S.hs) return;
    var key = stableKey(next);
    var changed = key !== S.lastKey;
    if (changed || t - S.lastPub >= HEARTBEAT) {
      next.sq = prevSq + 1;
      next.now = t;
      S.lastKey = key;
      S.lastPub = t;
      S.hs = next;
      setPres({ hs: next });
      updateLobbyPresence();
    } else {
      next.sq = prevSq;
      S.hs = next;
    }
    if (changed) { syncSeq(); refresh(); }
  }

  // ------------------------------------------------------------------ actions / chat / self
  function mySlot() {
    var me = myPeer();
    if (!S.hs || !me) return -1;
    for (var i = 0; i < S.hs.pl.length; i++) if (S.hs.pl[i][0] === me) return i;
    return -1;
  }

  function syncSeq() {
    var s = mySlot();
    if (s >= 0 && S.hs.ls[s] > S.seq) S.seq = S.hs.ls[s];
  }

  function cleanArg(v) {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return typeof v === 'string' ? v.slice(0, 16) : v;
    if (fin(v)) return v;
    if (v && typeof v === 'object') {
      try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
    }
    return null;
  }

  // cosmetic hat index (IS.HATS); lives only in presence, the host never sees it
  function clampHat(h) { return isInt(h) && h >= 0 && h < 64 ? h : 0; }
  function setHat(h) {
    S.hat = clampHat(h);
    if (S.room && S.pres) setPres({ ht: S.hat });
  }

  function act(type) {
    if (!S.room || typeof type !== 'string' || !S.pres) return 0;
    syncSeq();
    var a = [++S.seq, type.slice(0, 8)];
    for (var i = 1; i < arguments.length && i < 4; i++) a.push(cleanArg(arguments[i]));
    S.acts.push(a);
    if (S.acts.length > 10) S.acts = S.acts.slice(-10);
    var patch = { a: S.acts.slice() };
    if (type === 'col' && isInt(arguments[1])) { S.color = clampColor(arguments[1]); patch.c = S.color; }
    setPres(patch);
    if (S.amHost) scheduleTick();
    return a[0];
  }

  function chat(text) {
    var t = cleanText(text, 70);
    if (!t || !S.room || !S.pres) return;
    S.chSeq++;
    S.chs.push([S.chSeq, t]);
    if (S.chs.length > 4) S.chs = S.chs.slice(-4);
    setPres({ ch: S.chs.slice() });
    var me = myPeer();
    S.seenChat[me + ':' + S.chSeq] = 1;
    var slot = mySlot(), pl = slot >= 0 ? S.hs.pl[slot] : null;
    emit('chat', {
      peer: me, name: S.name, color: pl ? pl[1] : S.color, text: t,
      dead: pl ? !pl[2] : false, isMe: true, slot: slot
    });
  }

  function processChat(peers) {
    var me = myPeer(), hs = S.hs;
    var inMeeting = hs && hs.ph === 'meeting';
    var slotOf = Object.create(null);
    if (hs) for (var i = 0; i < hs.pl.length; i++) slotOf[hs.pl[i][0]] = i;
    var my = me in slotOf ? hs.pl[slotOf[me]] : null;
    var iAmAlive = !!(my && my[2]);
    for (i = 0; i < peers.length; i++) {
      var p = peers[i], pr = p.presence;
      if (!pr || pr.v !== 1 || p.peer === me || !Array.isArray(pr.ch)) continue;
      if (typeof pr.n === 'string') S.names[p.peer] = cleanName(pr.n);
      for (var k = 0; k < pr.ch.length && k < 8; k++) {
        var e = pr.ch[k];
        if (!Array.isArray(e) || !isInt(e[0]) || typeof e[1] !== 'string') continue;
        var key = p.peer + ':' + e[0];
        if (S.seenChat[key]) continue;
        S.seenChat[key] = 1;
        if (!inMeeting) continue;
        var text = cleanText(e[1], 70);
        if (!text) continue;
        var slot = p.peer in slotOf ? slotOf[p.peer] : -1;
        var pl = slot >= 0 ? hs.pl[slot] : null;
        var dead = pl ? !pl[2] : true;
        if (dead && iAmAlive) continue;
        emit('chat', {
          peer: p.peer, name: cleanName(pr.n) || 'Player', color: pl ? pl[1] : clampColor(pr.c),
          text: text, dead: dead, isMe: false, slot: slot
        });
      }
    }
  }

  function setSelf(o) {
    if (!S.room || !S.pres || !o) return;
    var cur = {};
    for (var k in S.pres) cur[k] = S.pres[k];
    if (S.selfPending) for (k in S.selfPending) cur[k] = S.selfPending[k];
    var patch = null;
    function put(key, v) { if (cur[key] !== v) { patch = patch || {}; patch[key] = v; } }
    if (fin(o.x)) put('x', Math.round(o.x));
    if (fin(o.y)) put('y', Math.round(o.y));
    if (o.f !== undefined) put('f', o.f < 0 ? -1 : 1);
    if (o.m !== undefined) put('m', o.m ? 1 : 0);
    if (o.vt !== undefined) put('vt', o.vt ? 1 : 0);
    if (o.fx !== undefined) put('fx', typeof o.fx === 'string' ? o.fx.slice(0, 8) : '');
    if (!patch) return;
    S.selfPending = S.selfPending || {};
    for (k in patch) S.selfPending[k] = patch[k];
    var wait = S.selfLast + SELF_MIN - Date.now();
    if (wait <= 0) flushSelf();
    else if (!S.selfTimer) S.selfTimer = setTimeout(flushSelf, wait);
  }

  function flushSelf() {
    if (S.selfTimer) { clearTimeout(S.selfTimer); S.selfTimer = null; }
    if (!S.selfPending || !S.room) return;
    var p = S.selfPending;
    S.selfPending = null;
    S.selfLast = Date.now();
    setPres(p);
    if (S.amHost && 'fx' in p) scheduleTick();
  }

  // ------------------------------------------------------------------ derived view
  function presMap() {
    var m = Object.create(null);
    if (!S.room) return m;
    var ps = S.room.peers(), me = myPeer();
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (!p || p.kind === 'agent' || !p.presence || p.presence.v !== 1) continue;
      m[p.peer] = p.presence;
    }
    if (me && S.pres) {
      var mine = {};
      for (var k in S.pres) mine[k] = S.pres[k];
      if (S.selfPending) for (k in S.selfPending) mine[k] = S.selfPending[k];
      m[me] = mine;
    }
    return m;
  }

  function emptyState() {
    return {
      code: null, phase: null, hs: null, mySlot: -1, myRole: -1, alive: false, players: [],
      spectators: [], hostPeer: null, isHost: false, mode: S.mode, settings: null, bodies: [],
      meeting: null, eject: null, sabotage: null, winner: null, phaseEnd: 0, gn: 0, myTasks: [], myColor: S.color
    };
  }

  function computeView() {
    var hs = S.hs;
    if (!S.room || !hs) return emptyState();
    // everyone plays on the map the host picked (settings.map is an index into IS.map.list())
    if (IS.map && IS.map.select && hs.st) IS.map.select(hs.st.map | 0);
    var me = myPeer(), pm = presMap(), slot = mySlot();
    var myE = slot >= 0 ? hs.pl[slot] : null;
    var myRole = myE ? myE[3] : -1;
    var players = [], inPl = Object.create(null);
    for (var i = 0; i < hs.pl.length; i++) {
      var e = hs.pl[i], pr = pm[e[0]], isMe = e[0] === me;
      inPl[e[0]] = 1;
      if (pr && typeof pr.n === 'string' && cleanName(pr.n)) S.names[e[0]] = cleanName(pr.n);
      var lp = S.lastPos[e[0]] || { x: 0, y: 0, f: 1 };
      if (pr && fin(pr.x) && fin(pr.y)) { lp = { x: pr.x, y: pr.y, f: pr.f === -1 ? -1 : 1 }; S.lastPos[e[0]] = lp; }
      var known = isMe || hs.ph === 'over' || (myRole === 1 && e[3] === 1);
      players.push({
        slot: i, peer: e[0], name: S.names[e[0]] || 'Player', color: e[1], alive: !!e[2],
        role: known ? e[3] : 0, roleKnown: known, conn: e[6], x: lp.x, y: lp.y, f: lp.f,
        m: pr && pr.m === 1 ? 1 : 0, vt: pr && pr.vt === 1 ? 1 : 0, fx: pr && typeof pr.fx === 'string' ? pr.fx.slice(0, 8) : '',
        isMe: isMe, isHost: e[0] === S.hostPeer, hat: pr && isInt(pr.ht) ? clampHat(pr.ht) : (isMe ? S.hat | 0 : 0),
        done: IS.host.popcount(e[4] & ((1 << e[5]) - 1)), total: e[5], present: !!pr
      });
    }
    var specs = [];
    for (var pid in pm) {
      if (!inPl[pid]) specs.push({ peer: pid, name: cleanName(pm[pid].n) || 'Player', isMe: pid === me });
    }
    var bodies = hs.bd.map(function (b) { return { slot: b[0], x: b[1], y: b[2], color: hs.pl[b[0]] ? hs.pl[b[0]][1] : 0 }; });
    var myTasks = [];
    if (myE && hs.ph !== 'lobby' && IS.map && typeof IS.map.assignTasks === 'function') {
      var tk = hs.sd + ':' + slot + ':' + myE[5] + ':' + (IS.map.id || '');
      if (tk !== S.tasksKey) {
        S.tasksKey = tk;
        try { S.tasks = IS.map.assignTasks(hs.sd, slot, myE[5]) || []; } catch (x) { S.tasks = []; }
      }
      for (i = 0; i < S.tasks.length; i++) myTasks.push({ id: S.tasks[i], index: i, done: !!(myE[4] & (1 << i)) });
    }
    return {
      code: S.code, phase: hs.ph, hs: hs, mySlot: slot, myRole: myRole, alive: !!(myE && myE[2]),
      players: players, spectators: specs, hostPeer: S.hostPeer, isHost: S.amHost, mode: S.mode,
      settings: hs.st, bodies: bodies, meeting: hs.mt, eject: hs.ej, sabotage: hs.sb, winner: hs.wn,
      phaseEnd: hs.pe, gn: hs.gn, myTasks: myTasks, myColor: myE ? myE[1] : S.color
    };
  }

  function refresh() {
    S.view = computeView();
    var ph = S.view.phase;
    if (ph !== S.lastPhase) {
      var from = S.lastPhase;
      S.lastPhase = ph;
      emit('phase', { from: from, to: ph, gn: S.view.gn });
    }
    emit('state', S.view);
  }

  function state() { return S.view || computeView(); }

  // ------------------------------------------------------------------ public
  IS.client = {
    boot: boot,
    onGames: function (fn) {
      if (typeof fn !== 'function') return function () {};
      gameListeners.push(fn);
      try { fn(S.games.slice()); } catch (e) { /* ignore */ }
      return function () { gameListeners = gameListeners.filter(function (f) { return f !== fn; }); };
    },
    games: function () { return S.games.slice(); },
    create: create,
    join: join,
    leave: leave,
    me: myPeer,
    isHost: function () { return S.amHost; },
    state: state,
    now: function () { return Date.now() + (S.amHost ? 0 : S.offset); },
    setSelf: setSelf,
    setHat: setHat,
    hat: function () { return S.hat | 0; },
    act: act,
    chat: chat,
    votes: function () { return IS.host.votes(S.hs); },
    on: function (evt, fn) {
      if (!listeners[evt] || typeof fn !== 'function') return function () {};
      listeners[evt].push(fn);
      return function () { listeners[evt] = listeners[evt].filter(function (f) { return f !== fn; }); };
    },
    _debug: S
  };
})();
