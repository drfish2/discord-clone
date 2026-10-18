/* Starship Sus — LiveKit transport for the self-hosted build. See SPEC.md §3 and §7.
 * IS.lkTransport emulates the Room-like presence API of §3 on top of livekit-client rooms:
 *   - one LiveKit Room per room name ("ss-lobby" for the lobby, "ss-<code>" for game rooms);
 *   - LiveKit identity = IS.net.myPeer;
 *   - my presence is sent as a data packet (topic "ss"): lossy, throttled to 20/s, on change,
 *     plus a reliable full snapshot every 1s and as soon as another participant connects;
 *   - peers() = me + the participants that have sent presence; a peer is removed when it
 *     disconnects (or after 4s of silence once LiveKit no longer lists it, 30s otherwise).
 * Inert unless window.SS_LIVEKIT and window.LivekitClient exist (the claude.ai build has neither).
 *
 * Wire format (UTF-8 text): "<kind><seq>|<presence JSON>" — kind "p" lossy update, "P" reliable
 * snapshot. seq grows with every change of my presence, so a late snapshot never overrides a
 * newer lossy update.
 */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});

  var KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
  var NAME_RE = /^ss-[a-z0-9-]{1,40}$/;
  var LIMIT = 4096;
  var TOPIC = 'ss';
  var T = { HEARTBEAT: 1000, TIMEOUT: 4000, CONNECTED_TIMEOUT: 30000, THROTTLE: 50, CONNECT_TIMEOUT: 12000, RETRY: 3000 };
  var EMPTY = Object.freeze([]);

  function noop() {}
  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  function utf8Len(s) { return enc ? enc.encode(s).length : unescape(encodeURIComponent(s)).length; }
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (var k in o) deepFreeze(o[k]);
    }
    return o;
  }
  function isPlainObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function makePeer(peer, isMe, presence, updatedAt) {
    return Object.freeze({
      peer: peer, by: null, isMe: isMe, sameTab: isMe, kind: 'viewer', guest: false,
      presence: presence, updatedAt: updatedAt
    });
  }
  function frameScheduler(fn) {
    var pending = false;
    return function () {
      if (pending) return;
      pending = true;
      var done = false;
      function run() { if (done) return; done = true; pending = false; fn(); }
      if (typeof requestAnimationFrame === 'function') { try { requestAnimationFrame(run); } catch (e) { /* ignore */ } }
      setTimeout(run, 40);
    };
  }
  function cfg() { return window.SS_LIVEKIT || null; }
  function lib() { return window.LivekitClient || null; }
  function ev(name) { var L = lib(); return (L && L.RoomEvent && L.RoomEvent[name]) || name.charAt(0).toLowerCase() + name.slice(1); }

  function fetchToken(name, peer) {
    var c = cfg();
    var base = (c && c.tokenUrl) || '/api/among-us/token';
    var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'room=' + encodeURIComponent(name) + '&identity=' + encodeURIComponent(peer);
    return fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j || typeof j.token !== 'string' || !j.token) throw err('token', (j && j.error) || ('token request failed (' + r.status + ')'));
        var u = j.url || (c && c.url);
        if (typeof u !== 'string' || !u) throw err('token', 'token response has no LiveKit url');
        return { token: j.token, url: u };
      });
    });
  }

  function withTimeout(p, ms, what) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(err('timeout', what + ' timed out')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  // ======================================================================= one room
  var rooms = Object.create(null); // name -> {room, ready: Promise, lk()}

  function LkRoom(name, me, opts) {
    var LK = lib();
    var isLobby = !!(opts && opts.lobby);
    var closed = false;
    var lk = null;          // current livekit Room
    var gen = 0;            // connection generation (lobby reconnects)
    var live = false;       // connected and able to send
    var everConnected = false;
    var mine = {}, mineJson = '{}', mySeq = 0;
    var entries = new Map(); // peer -> {obj, json, seq, heard}
    entries.set(me, { obj: makePeer(me, true, deepFreeze({}), Date.now()), json: '{}', seq: 0, heard: Infinity });
    var snapshot = EMPTY, dirty = true;
    var listeners = [];
    var pj = new Map(), pl = new Map(), pu = new Map();
    var lastSent = 0, sendTimer = null, hb = null, retryTimer = null;

    function noteJoin(o) { if (pl.has(o.peer)) { pl.delete(o.peer); pu.set(o.peer, o); } else pj.set(o.peer, o); }
    function noteUpdate(o) { if (pj.has(o.peer)) pj.set(o.peer, o); else pu.set(o.peer, o); }
    function noteLeft(o) {
      if (pj.has(o.peer)) { pj.delete(o.peer); return; }
      pu.delete(o.peer); pl.set(o.peer, o);
    }
    function peers() {
      if (dirty) {
        var arr = [];
        entries.forEach(function (e) { arr.push(e.obj); });
        snapshot = Object.freeze(arr);
        dirty = false;
      }
      return snapshot;
    }
    var schedule = frameScheduler(flush);
    function flush() {
      if (closed) return;
      var ps = peers();
      var j = Array.from(pj.values()), l = Array.from(pl.values()), u = Array.from(pu.values());
      pj.clear(); pl.clear(); pu.clear();
      var diff = j.length || l.length || u.length;
      var change = Object.freeze({ peers: ps, joined: Object.freeze(j), left: Object.freeze(l), updated: Object.freeze(u) });
      var ls = listeners.slice();
      for (var i = 0; i < ls.length; i++) {
        var L = ls[i];
        if (L.dead) continue;
        var c = change;
        if (!L.fresh && !diff) continue;
        if (L.fresh) {
          L.fresh = false;
          c = Object.freeze({ peers: ps, joined: ps, left: EMPTY, updated: EMPTY });
        }
        try { L.fn(c); } catch (e) { setTimeout(function () { throw e; }); }
      }
    }

    // ---- sending
    function packet(kind) { var s = kind + mySeq + '|' + mineJson; return enc ? enc.encode(s) : s; }
    function publish(kind, reliable) {
      if (!live || closed || !lk || !lk.localParticipant) return;
      try {
        var p = lk.localParticipant.publishData(packet(kind), { reliable: reliable, topic: TOPIC });
        if (p && typeof p.catch === 'function') p.catch(noop);
      } catch (e) { /* ignore */ }
    }
    function sendSnapshot() { publish('P', true); }
    function sendNow() {
      if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
      lastSent = Date.now();
      publish('p', false);
    }
    function queueSend() {
      if (sendTimer || !live) return;
      var wait = Math.max(0, lastSent + T.THROTTLE - Date.now());
      sendTimer = setTimeout(function () { sendTimer = null; sendNow(); }, wait);
    }

    // ---- receiving
    function remove(peer) {
      var e = entries.get(peer);
      if (!e || peer === me) return;
      entries.delete(peer);
      dirty = true;
      noteLeft(e.obj);
      schedule();
    }
    function removeAllRemote() { entries.forEach(function (e, peer) { if (peer !== me) remove(peer); }); }
    function onData(payload, participant, kind, topic) {
      if (closed || !participant || typeof participant.identity !== 'string') return;
      if (topic !== undefined && topic !== null && topic !== TOPIC) return;
      var peer = participant.identity;
      if (!peer || peer === me || peer.length > 64) return;
      var s;
      try { s = typeof payload === 'string' ? payload : dec ? dec.decode(payload) : String.fromCharCode.apply(null, payload); } catch (e) { return; }
      if (typeof s !== 'string' || s.length > LIMIT * 4 + 32) return;
      var k = s.charAt(0), bar = s.indexOf('|');
      if ((k !== 'p' && k !== 'P') || bar < 2 || bar > 20) return;
      var seq = Number(s.slice(1, bar)), json = s.slice(bar + 1);
      if (!isFinite(seq) || seq < 0 || utf8Len(json) > LIMIT) return;
      var now = Date.now(), e = entries.get(peer);
      if (e && seq < e.seq) { e.heard = now; return; } // stale (reordered snapshot)
      if (e && e.json === json) { e.heard = now; e.seq = seq; return; }
      var pres;
      try { pres = JSON.parse(json); } catch (x) { return; }
      if (!isPlainObj(pres)) return;
      if (!e) {
        e = { obj: makePeer(peer, false, deepFreeze(pres), now), json: json, seq: seq, heard: now };
        entries.set(peer, e);
        dirty = true;
        noteJoin(e.obj);
        schedule();
      } else {
        e.heard = now; e.seq = seq; e.json = json;
        e.obj = makePeer(peer, false, deepFreeze(pres), now);
        dirty = true;
        noteUpdate(e.obj);
        schedule();
      }
    }
    function lkHas(peer) {
      try {
        var rp = lk && lk.remoteParticipants;
        if (rp && typeof rp.forEach === 'function') {
          var found = false;
          rp.forEach(function (p) { if (p && p.identity === peer) found = true; });
          return found;
        }
      } catch (e) { /* ignore */ }
      return false;
    }
    function tick() {
      if (closed) return;
      sendSnapshot();
      var now = Date.now();
      entries.forEach(function (e, peer) {
        if (peer === me) return;
        var limit = live && lkHas(peer) ? T.CONNECTED_TIMEOUT : T.TIMEOUT;
        if (now - e.heard > limit) remove(peer);
      });
    }

    function failAll(code) {
      var e = err(code || 'disconnected', 'LiveKit room disconnected');
      var ls = listeners.slice();
      for (var i = 0; i < ls.length; i++) if (!ls[i].dead && ls[i].onError) { try { ls[i].onError(e); } catch (x) { /* ignore */ } }
    }

    // ---- connection
    function connect() {
      var my = ++gen;
      var r;
      try {
        r = new LK.Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
      } catch (e) { return Promise.reject(e); }
      lk = r;
      var E = function (n, fn) { r.on(ev(n), function () { if (my === gen && !closed) fn.apply(null, arguments); }); };
      E('DataReceived', onData);
      E('ParticipantConnected', function () { sendSnapshot(); });
      E('ParticipantDisconnected', function (p) { if (p && p.identity) remove(p.identity); });
      E('Reconnected', function () { live = true; sendSnapshot(); });
      E('Disconnected', function () {
        gen++; // ignore anything else from this connection
        live = false;
        removeAllRemote();
        if (isLobby) retryLater(); else failAll('disconnected');
      });
      return fetchToken(name, me).then(function (t) {
        if (closed || my !== gen) throw err('closed', 'room left');
        return r.connect(t.url, t.token, { autoSubscribe: !isLobby });
      }).then(function () {
        if (closed || my !== gen) { try { r.disconnect(); } catch (e) { /* ignore */ } throw err('closed', 'room left'); }
        live = true; everConnected = true;
        sendNow();
        sendSnapshot();
        return room;
      }, function (e) {
        var cur = my === gen;
        if (cur) { gen++; live = false; }
        try { r.disconnect(); } catch (x) { /* ignore */ }
        if (cur && isLobby && everConnected) retryLater();
        throw e;
      });
    }
    // The lobby reconnects by itself after a successful first connection (game rooms report the
    // disconnect to onPeers' error handlers instead; LiveKit already retried by then).
    function retryLater() {
      if (closed || retryTimer) return;
      retryTimer = setTimeout(function () { retryTimer = null; if (!closed) connect().catch(noop); }, T.RETRY);
    }

    var room = {
      name: isLobby ? '' : name,
      presence: function (patch) {
        if (closed) return Promise.reject(err('invalid_argument', 'room left'));
        if (!isPlainObj(patch)) return Promise.reject(err('invalid_argument', 'patch must be an object'));
        var next = {}, k;
        for (k in mine) next[k] = mine[k];
        for (k in patch) {
          if (!KEY_RE.test(k) || k === 'prototype' || k in Object.prototype) {
            return Promise.reject(err('invalid_argument', 'bad presence key ' + k));
          }
          if (patch[k] === null) delete next[k]; else if (patch[k] !== undefined) next[k] = patch[k];
        }
        var json;
        try { json = JSON.stringify(next); } catch (e) { return Promise.reject(err('invalid_argument', 'not JSON')); }
        var bytes = utf8Len(json);
        if (bytes > LIMIT) {
          return Promise.reject(err('invalid_argument', 'presence is ' + bytes + ' bytes; the limit is ' + LIMIT));
        }
        if (json !== mineJson) {
          mine = JSON.parse(json);
          mineJson = json;
          mySeq = Math.max(mySeq + 1, Date.now());
          var e = entries.get(me);
          e.json = json;
          e.obj = makePeer(me, true, deepFreeze(JSON.parse(json)), Date.now());
          dirty = true;
          noteUpdate(e.obj);
          schedule();
          queueSend();
        }
        return Promise.resolve();
      },
      peers: peers,
      onPeers: function (fn, onError) {
        if (typeof fn !== 'function') throw new TypeError('handler must be a function');
        var L = { fn: fn, onError: typeof onError === 'function' ? onError : null, fresh: true, dead: closed };
        listeners.push(L);
        if (!closed) Promise.resolve().then(schedule);
        return function () { L.dead = true; listeners = listeners.filter(function (x) { return x !== L; }); };
      },
      connected: function () { return !closed && live; },
      onConnection: function (fn) {
        var dead = false;
        Promise.resolve().then(function () { if (!dead) fn(!closed && live); });
        return function () { dead = true; };
      },
      emit: function () { return Promise.resolve(); },
      on: function () { return noop; },
      leave: function () {
        if (closed) return Promise.resolve();
        closed = true; live = false;
        listeners = [];
        if (hb) clearInterval(hb);
        if (sendTimer) clearTimeout(sendTimer);
        if (retryTimer) clearTimeout(retryTimer);
        var r = lk;
        if (rooms[name] && rooms[name].room === room) delete rooms[name];
        var p;
        try { p = r && r.disconnect(); } catch (e) { p = null; }
        return Promise.resolve(p).catch(noop).then(noop);
      },
      // extras
      livekit: function () { return closed ? null : lk; },
      isLobby: isLobby
    };
    hb = setInterval(tick, T.HEARTBEAT);
    var ready = connect().catch(function (e) { room.leave(); throw e; });
    return { room: room, ready: ready };
  }

  function available() {
    var L = lib();
    return !!(cfg() && L && typeof L.Room === 'function' && typeof fetch === 'function');
  }

  // join(name, myPeer, {lobby}) -> Promise<Room-like>; one live room object per name.
  function join(name, me, opts) {
    if (!available()) return Promise.reject(err('unavailable', 'LiveKit is not available'));
    if (typeof name !== 'string' || !NAME_RE.test(name)) return Promise.reject(err('invalid_argument', 'bad room name'));
    if (typeof me !== 'string' || !/^[A-Za-z0-9_-]{4,40}$/.test(me)) return Promise.reject(err('invalid_argument', 'bad identity'));
    var cur = rooms[name];
    if (cur) return cur.ready;
    var r = LkRoom(name, me, opts);
    rooms[name] = r;
    r.ready.catch(noop);
    return withTimeout(r.ready, T.CONNECT_TIMEOUT, 'LiveKit connect').catch(function (e) { r.room.leave(); throw e; });
  }

  // The underlying livekit-client Room for a joined room name (for voice.js), or null.
  function livekitRoom(name) {
    var r = rooms[name];
    return r ? r.room.livekit() : null;
  }

  IS.lkTransport = {
    available: available,
    join: join,
    livekitRoom: livekitRoom,
    room: function (name) { var r = rooms[name]; return r ? r.room : null; },
    TOPIC: TOPIC,
    _timing: T
  };
})();
