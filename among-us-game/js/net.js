/* Starship Sus — transport. See SPEC.md §3 and §7.
 * IS.net normalises the claude.ai artifact `room` capability (presence only), LiveKit rooms
 * (self-hosted build only: window.SS_LIVEKIT + IS.lkTransport, mode 'livekit') and a
 * BroadcastChannel emulation with the same semantics (several tabs of one browser).
 * Without BroadcastChannel the mode is 'offline': rooms only contain yourself (freeplay).
 */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});

  var NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
  var KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
  var LIMIT = 4096;
  var HEARTBEAT = 1000, TIMEOUT = 4000, THROTTLE = 50, USE_TIMEOUT = 11000; // claude.use() answers within 10 s
  var CHANNEL_PREFIX = 'starship-sus/';
  var EMPTY = Object.freeze([]);

  function noop() {}
  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function utf8Len(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;
  }
  function rid(n) {
    var abc = 'abcdefghijklmnopqrstuvwxyz0123456789', out = '', buf = null;
    try { buf = crypto.getRandomValues(new Uint8Array(n)); } catch (e) { buf = null; }
    for (var i = 0; i < n; i++) out += abc[(buf ? buf[i] : Math.floor(Math.random() * 256)) % abc.length];
    return out;
  }
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
  // rAF-or-timeout scheduler: runs fn at most once per animation frame (and still runs in
  // background tabs where rAF is paused).
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

  var net = {
    mode: null,
    lobby: null,
    myPeer: null,
    ready: null,
    init: init,
    join: join,
    LIMIT: LIMIT
  };
  IS.net = net;
  var resolveReady;
  net.ready = new Promise(function (r) { resolveReady = r; });
  function learnPeer(id) {
    if (!net.myPeer && typeof id === 'string' && id) { net.myPeer = id; resolveReady(id); }
  }

  // ======================================================================= local emulation
  var localRooms = Object.create(null);

  function LocalRoom(name, useChannel) {
    var me = net.myPeer;
    var ch = null;
    if (useChannel && typeof BroadcastChannel === 'function') {
      try { ch = new BroadcastChannel(CHANNEL_PREFIX + name); } catch (e) { ch = null; }
    }
    var closed = false;
    var mine = {}, mineJson = '{}';
    var entries = new Map(); // peer -> {obj, json, heard}
    entries.set(me, { obj: makePeer(me, true, deepFreeze({}), Date.now()), json: '{}', heard: Infinity });
    var snapshot = EMPTY, dirty = true;
    var listeners = [];
    var pj = new Map(), pl = new Map(), pu = new Map(); // pending joined / left / updated
    var lastSent = 0, sendTimer = null;

    function noteJoin(o) {
      if (pl.has(o.peer)) { pl.delete(o.peer); pu.set(o.peer, o); } else pj.set(o.peer, o);
    }
    function noteUpdate(o) {
      if (pj.has(o.peer)) pj.set(o.peer, o); else pu.set(o.peer, o);
    }
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
    function post(msg) {
      if (!ch || closed) return;
      try { ch.postMessage(msg); } catch (e) { /* ignore */ }
    }
    function sendNow(t) {
      if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
      lastSent = Date.now();
      post({ t: t || 'p', peer: me, p: mineJson });
    }
    function queueSend() {
      if (sendTimer || !ch) return;
      var wait = Math.max(0, lastSent + THROTTLE - Date.now());
      sendTimer = setTimeout(function () { sendTimer = null; sendNow(); }, wait);
    }
    function remove(peer) {
      var e = entries.get(peer);
      if (!e || peer === me) return;
      entries.delete(peer);
      dirty = true;
      noteLeft(e.obj);
      schedule();
    }
    function onMessage(ev) {
      var d = ev && ev.data;
      if (closed || !d || typeof d !== 'object' || typeof d.peer !== 'string') return;
      if (!d.peer || d.peer === me || d.peer.length > 64) return;
      if (d.t === 'bye') { remove(d.peer); return; }
      if (d.t !== 'p' && d.t !== 'hi') return;
      if (d.t === 'hi') sendNow();
      if (typeof d.p !== 'string' || d.p.length > LIMIT * 4 || utf8Len(d.p) > LIMIT) return;
      var pres;
      try { pres = JSON.parse(d.p); } catch (e) { return; }
      if (!isPlainObj(pres)) return;
      var now = Date.now(), e = entries.get(d.peer);
      if (!e) {
        e = { obj: makePeer(d.peer, false, deepFreeze(pres), now), json: d.p, heard: now };
        entries.set(d.peer, e);
        dirty = true;
        noteJoin(e.obj);
        schedule();
      } else {
        e.heard = now;
        if (e.json !== d.p) {
          e.json = d.p;
          e.obj = makePeer(d.peer, false, deepFreeze(pres), now);
          dirty = true;
          noteUpdate(e.obj);
          schedule();
        }
      }
    }
    if (ch) ch.onmessage = onMessage;
    var hb = ch ? setInterval(function () {
      if (closed) return;
      sendNow();
      var now = Date.now();
      entries.forEach(function (e, peer) { if (peer !== me && now - e.heard > TIMEOUT) remove(peer); });
    }, HEARTBEAT) : null;
    if (ch) sendNow('hi');

    var room = {
      name: name,
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
        var L = { fn: fn, fresh: true, dead: closed };
        listeners.push(L);
        if (!closed) Promise.resolve().then(schedule);
        return function () { L.dead = true; listeners = listeners.filter(function (x) { return x !== L; }); };
      },
      connected: function () { return !closed; },
      onConnection: function (fn) {
        var dead = false;
        Promise.resolve().then(function () { if (!dead) fn(!closed); });
        return function () { dead = true; };
      },
      emit: function () { return Promise.resolve(); },
      on: function () { return noop; },
      leave: function () {
        if (closed) return Promise.resolve();
        post({ t: 'bye', peer: me });
        closed = true;
        listeners = [];
        if (hb) clearInterval(hb);
        if (sendTimer) clearTimeout(sendTimer);
        try { if (ch) ch.close(); } catch (e) { /* ignore */ }
        if (localRooms[name] === room) delete localRooms[name];
        return Promise.resolve();
      },
      _bye: function () { post({ t: 'bye', peer: me }); }
    };
    return room;
  }

  function localJoin(name) {
    var r = localRooms[name];
    if (!r) r = localRooms[name] = LocalRoom(name, net.mode === 'local');
    return r;
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', function () {
      for (var k in localRooms) localRooms[k]._bye();
    });
  }

  // ======================================================================= claude room wrapper
  var wrapped = Object.create(null);

  function filterAgents(arr) {
    if (!arr || !arr.length) return EMPTY;
    var any = false;
    for (var i = 0; i < arr.length; i++) if (!arr[i] || arr[i].kind === 'agent') any = true;
    if (!any) return arr;
    return Object.freeze(Array.prototype.filter.call(arr, function (p) { return p && p.kind !== 'agent'; }));
  }

  function wrapRoom(raw, isLobby) {
    var lastRaw = null, lastOut = EMPTY;
    function peers() {
      var r;
      try { r = raw.peers(); } catch (e) { r = EMPTY; }
      if (r !== lastRaw) {
        lastRaw = r;
        lastOut = filterAgents(r);
        if (!net.myPeer) for (var i = 0; i < lastOut.length; i++) if (lastOut[i].sameTab) learnPeer(lastOut[i].peer);
      }
      return lastOut;
    }
    var room = {
      name: isLobby ? '' : raw.name,
      presence: function (patch) {
        try { return Promise.resolve(raw.presence(patch)); } catch (e) { return Promise.reject(e); }
      },
      peers: peers,
      onPeers: function (fn, onError) {
        return raw.onPeers(function (c) {
          var ps = peers();
          fn({ peers: ps, joined: filterAgents(c && c.joined), left: filterAgents(c && c.left), updated: filterAgents(c && c.updated) });
        }, onError);
      },
      connected: function () { try { return !!raw.connected(); } catch (e) { return false; } },
      onConnection: function (fn, onError) {
        try { return raw.onConnection(fn, onError); } catch (e) { return noop; }
      },
      emit: function (t, d) { try { return Promise.resolve(raw.emit(t, d)); } catch (e) { return Promise.reject(e); } },
      on: function (t, h, e) { try { return raw.on(t, h, e); } catch (x) { return noop; } },
      leave: function () {
        if (isLobby) return Promise.resolve();
        if (wrapped[raw.name] === room) delete wrapped[raw.name];
        try { return Promise.resolve(raw.leave()); } catch (e) { return Promise.resolve(); }
      }
    };
    return room;
  }

  // ======================================================================= public
  var rawRoom = null, initP = null;

  function tryRoom() {
    return new Promise(function (resolve) {
      var c = window.claude;
      if (!c || typeof c.use !== 'function') { resolve(null); return; }
      var t = setTimeout(function () { resolve(null); }, USE_TIMEOUT);
      var ok = function (r) {
        clearTimeout(t);
        resolve(r && typeof r.presence === 'function' && typeof r.peers === 'function' && typeof r.onPeers === 'function' ? r : null);
      };
      var bad = function () { clearTimeout(t); resolve(null); };
      try { Promise.resolve(c.use('room')).then(ok, bad); } catch (e) { bad(); }
    });
  }

  var LK_LOBBY = 'ss-lobby';
  function lkUsable() {
    return !!(window.SS_LIVEKIT && IS.lkTransport && typeof IS.lkTransport.available === 'function' && IS.lkTransport.available());
  }
  function useLocal() {
    net.mode = typeof BroadcastChannel === 'function' ? 'local' : 'offline';
    learnPeer(rid(12));
    net.lobby = localJoin('__lobby__');
  }

  function init() {
    if (initP) return initP;
    initP = tryRoom().then(function (r) {
      if (r) {
        rawRoom = r;
        net.mode = 'room';
        net.lobby = wrapRoom(r, true);
        try { net.lobby.onPeers(function () { net.lobby.peers(); }); } catch (e) { /* ignore */ }
        net.lobby.peers();
      } else if (lkUsable()) {
        // Self-hosted build: LiveKit rooms; the BroadcastChannel emulation is the fallback when
        // the LiveKit server (or the token endpoint) can't be reached.
        learnPeer(rid(12));
        return IS.lkTransport.join(LK_LOBBY, net.myPeer, { lobby: true }).then(function (lobby) {
          net.mode = 'livekit';
          net.lobby = lobby;
          return { mode: net.mode };
        }, function (e) {
          if (typeof console !== 'undefined') console.warn('LiveKit unavailable, falling back to local play:', e && e.message);
          useLocal();
          return { mode: net.mode };
        });
      } else {
        useLocal();
      }
      return { mode: net.mode };
    });
    return initP;
  }

  function join(name) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) return Promise.reject(err('invalid_argument', 'bad room name'));
    return init().then(function () {
      if (net.mode === 'livekit') return IS.lkTransport.join(name, net.myPeer);
      if (net.mode !== 'room') return localJoin(name);
      if (wrapped[name]) return wrapped[name];
      if (typeof rawRoom.join !== 'function') throw err('not_permitted', 'named rooms unavailable');
      return Promise.resolve(rawRoom.join(name)).then(function (nr) {
        if (wrapped[name]) return wrapped[name];
        var w = wrapRoom(nr, false);
        wrapped[name] = w;
        try { w.onPeers(function () { w.peers(); }); } catch (e) { /* ignore */ }
        return w;
      });
    });
  }
})();
