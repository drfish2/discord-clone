/* Starship Sus — game loop and glue between client, map, render, tasks and ui. See SPEC.md §4.8. */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});
  var C = IS.CONFIG;

  var canvas = null;
  var keys = {};
  var me = { x: 0, y: 0, f: 1, m: 0, vt: 0, fx: '' };
  var cam = { x: 0, y: 0 };
  var inGame = false; // inside a game room (lobby or match)
  var spawned = false;
  var lastTime = 0;
  var walkPhase = 0;
  var stepTimer = 0;

  var task = null; // {ctrl, kind, taskIdx, fix:bool, fixKind, part}
  var localDone = {}; // taskIdx -> true, optimistic until host acks (cleared per game)
  var localGame = -1;
  var currentVent = null;
  var mapOpen = false;
  var lastHud = '';
  var lastMeetingKey = '';
  var lastMeeting = null; // cached hs.mt for the result reveal
  var ejectTimer = null;
  var lastSabKind = null;
  var wasAlive = true;
  var votedSoundCount = 0;
  var near = null; // current interactables, recomputed each frame

  // ---------------------------------------------------------------- helpers
  function now() { return IS.client && IS.client.now ? IS.client.now() : Date.now(); }
  function play(k, o) { if (IS.audio && IS.audio.play) IS.audio.play(k, o); }
  function st() { return IS.client && IS.client.state ? IS.client.state() : null; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function colorName(i) { return (C.COLORS[i] || C.COLORS[0])[0]; }
  function playerBySlot(s, slot) {
    if (!s || slot < 0) return null;
    for (var i = 0; i < s.players.length; i++) if (s.players[i].slot === slot) return s.players[i];
    return null;
  }
  function settings(s) { return (s && s.hs && s.hs.st) || C.DEFAULT_SETTINGS; }
  function myPlayer(s) { return s ? playerBySlot(s, s.mySlot) : null; }
  function isImp(s) { var p = myPlayer(s); return !!(p && p.role === 1); }
  function amAlive(s) { var p = myPlayer(s); return !!(p && p.alive); }
  function phase(s) { return (s && s.phase) || (s && s.hs && s.hs.ph) || 'lobby'; }
  function sab(s) { return (s && s.hs && s.hs.sb) || null; }

  function myTasks(s) {
    if (!s || !s.hs || s.mySlot < 0 || !IS.map || !IS.map.assignTasks) return [];
    var row = s.hs.pl && s.hs.pl[s.mySlot];
    if (!row) return [];
    var n = row[5] || 0, mask = row[4] || 0;
    var ids = IS.map.assignTasks(s.hs.sd || 0, s.mySlot, n);
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var t = findTask(ids[i]);
      if (!t) continue;
      var stn = findStation(t.station);
      out.push({
        idx: i, id: ids[i], name: t.name, kind: t.kind || (stn && stn.kind),
        room: stn ? roomName(stn) : '', x: stn ? stn.x : 0, y: stn ? stn.y : 0,
        done: !!((mask >> i) & 1) || !!localDone[i]
      });
    }
    return out;
  }
  function findTask(id) {
    var L = (IS.map && IS.map.TASKS) || [];
    for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    return null;
  }
  function findStation(id) {
    var L = (IS.map && IS.map.STATIONS) || [];
    for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    return null;
  }
  function roomName(stn) {
    if (stn.room && IS.map.rooms) {
      for (var i = 0; i < IS.map.rooms.length; i++) {
        var r = IS.map.rooms[i];
        if (r.id === stn.room) return r.name;
      }
    }
    var r2 = IS.map.roomAt ? IS.map.roomAt(stn.x, stn.y) : null;
    return r2 ? r2.name : (stn.room || '');
  }

  function fixPoints(kind) {
    var F = (IS.map && IS.map.FIX) || {};
    return F[kind] || [];
  }

  function visionFor(s) {
    var ph = phase(s);
    if (!inGame || ph === 'lobby' || ph === 'over') return Infinity;
    var p = myPlayer(s);
    if (!p || !p.alive) return Infinity;
    var set = settings(s);
    if (p.role === 1) return C.VISION * (set.ivis || 1.5);
    var sb = sab(s);
    if (sb && sb.k === 'lights') return C.LIGHTS_OUT_VISION;
    return C.VISION * (set.cvis || 1);
  }

  function canMove(s) {
    var ph = phase(s);
    if (ph !== 'lobby' && ph !== 'play' && ph !== 'over') return !inGame; // menu attract mode handles itself
    if (task) return false;
    if (me.vt) return false;
    if (IS.ui && IS.ui.isTyping && IS.ui.isTyping()) return false;
    return true;
  }

  function placeAtSpawn(s) {
    var n = s && s.hs && s.hs.pl ? s.hs.pl.length : 1;
    var slot = s && s.mySlot >= 0 ? s.mySlot : 0;
    var p = IS.map && IS.map.spawn ? IS.map.spawn(slot, Math.max(1, n)) : { x: 0, y: 0 };
    me.x = p.x; me.y = p.y; me.vt = 0; currentVent = null;
    cam.x = me.x; cam.y = me.y;
  }

  function closeTask() {
    if (task && task.ctrl && task.ctrl.close) {
      var t = task; task = null;
      try { t.ctrl.close(); } catch (e) { /* ignore */ }
    }
    task = null;
    me.fx = '';
  }

  // ---------------------------------------------------------------- interactables
  function computeNear(s) {
    var res = { use: null, report: null, kill: null, vent: null };
    if (!inGame || !s) return res;
    var ph = phase(s);
    var p = myPlayer(s);
    if (ph === 'lobby') return res;
    if (ph !== 'play' || !p) return res;
    var alive = p.alive, imp = p.role === 1;
    var best = Infinity;
    var sb = sab(s);

    function consider(obj, d) { if (d < best) { best = d; res.use = obj; } }

    if (me.vt) {
      res.use = { type: 'vent-next', x: me.x, y: me.y, label: 'NEXT' };
      res.vent = { type: 'vent-exit' };
      return res;
    }

    // tasks (crewmates, alive or ghost)
    if (!imp) {
      var tl = myTasks(s);
      for (var i = 0; i < tl.length; i++) {
        if (tl[i].done) continue;
        var d = dist(me.x, me.y, tl[i].x, tl[i].y);
        if (d <= C.USE_RANGE) consider({ type: 'station', x: tl[i].x, y: tl[i].y, task: tl[i], label: 'USE' }, d);
      }
    }
    // sabotage fixes (alive players only)
    if (sb && alive) {
      var fp = fixPoints(sb.k);
      for (var k = 0; k < fp.length; k++) {
        if (sb.k === 'o2' && sb.fx && sb.fx[fp[k].part]) continue;
        var d2 = dist(me.x, me.y, fp[k].x, fp[k].y);
        if (d2 <= C.USE_RANGE) consider({ type: 'fix', x: fp[k].x, y: fp[k].y, kind: sb.k, part: fp[k].part, label: 'FIX' }, d2);
      }
    }
    // emergency button
    if (alive && IS.map && IS.map.button) {
      var b = IS.map.button;
      var d3 = dist(me.x, me.y, b.x, b.y);
      if (d3 <= C.USE_RANGE + 10) consider({ type: 'button', x: b.x, y: b.y, label: 'CALL' }, d3);
    }
    // vents (alive impostors)
    if (alive && imp && IS.map && IS.map.vents) {
      var vb = Infinity;
      for (var v = 0; v < IS.map.vents.length; v++) {
        var vn = IS.map.vents[v];
        var d4 = dist(me.x, me.y, vn.x, vn.y);
        if (d4 <= C.VENT_RANGE && d4 < vb) { vb = d4; res.vent = { type: 'vent', x: vn.x, y: vn.y, vent: vn }; }
      }
    }
    // bodies
    if (alive && s.hs && s.hs.bd) {
      var rb = Infinity;
      for (var j = 0; j < s.hs.bd.length; j++) {
        var bd = s.hs.bd[j];
        var d5 = dist(me.x, me.y, bd[1], bd[2]);
        if (d5 <= C.REPORT_RANGE && d5 < rb && visible(s, bd[1], bd[2])) { rb = d5; res.report = { type: 'body', slot: bd[0], x: bd[1], y: bd[2] }; }
      }
    }
    // kill target
    if (alive && imp) {
      var range = C.KILL_RANGE[settings(s).kd != null ? settings(s).kd : 1] || 100;
      var kb = Infinity;
      for (var q = 0; q < s.players.length; q++) {
        var o = s.players[q];
        if (o.isMe || !o.alive || o.role === 1 || o.vt || !o.conn && o.conn !== undefined) continue;
        var d6 = dist(me.x, me.y, o.x, o.y);
        if (d6 <= range && d6 < kb) { kb = d6; res.kill = { type: 'player', slot: o.slot, x: o.x, y: o.y }; }
      }
    }
    return res;
  }

  function visible(s, x, y) {
    var v = visionFor(s);
    if (v === Infinity) return true;
    if (dist(me.x, me.y, x, y) > v) return false;
    if (IS.map && IS.map.raycast) {
      var h = IS.map.raycast(me.x, me.y - 20, x, y - 10);
      if (h && dist(h.x, h.y, x, y - 10) > 12) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- actions from UI / keys
  function doUse() {
    var s = st();
    if (!near || !near.use) return;
    var u = near.use;
    if (u.type === 'station') openTaskFor(u.task);
    else if (u.type === 'fix') openFixFor(u.kind, u.part);
    else if (u.type === 'button') {
      var p = myPlayer(s);
      var used = s.hs.em && s.hs.em[s.mySlot] || 0;
      var sb = sab(s);
      if (sb && (sb.k === 'reactor' || sb.k === 'o2')) { toast('Emergency meetings are disabled during a crisis.'); return; }
      if (used >= settings(s).emg) { toast('You have no emergency meetings left.'); return; }
      if (p && p.alive) IS.client.act('emg');
    } else if (u.type === 'vent-next') nextVent();
  }

  function openTaskFor(t) {
    if (!IS.tasks || !IS.tasks.open || task) return;
    play('click');
    var ctrl = IS.tasks.open(t.kind, { title: t.name }, {
      onComplete: function () {
        task = null;
        var s = st();
        localDone[t.idx] = true;
        if (s && s.hs) localGame = s.hs.gn;
        IS.client.act('task', t.idx);
        play('task');
      },
      onClose: function () { task = null; }
    });
    task = { ctrl: ctrl, kind: t.kind, taskIdx: t.idx };
  }

  function openFixFor(kind, part) {
    if (!IS.tasks || !IS.tasks.openFix || task) return;
    play('click');
    var ctrl = IS.tasks.openFix(kind, part, {
      onComplete: function () { task = null; me.fx = ''; IS.client.act('fix', kind, part); play('task'); },
      onHold: function (h) { me.fx = h ? 'r' + part : ''; pushSelf(); },
      onClose: function () { task = null; me.fx = ''; }
    });
    task = { ctrl: ctrl, fix: true, fixKind: kind, part: part };
  }

  function doReport() {
    if (!near || !near.report) return;
    IS.client.act('rep', near.report.slot);
  }

  function doKill() {
    var s = st();
    if (!near || !near.kill || !s || !s.hs) return;
    var cd = ((s.hs.kc && s.hs.kc[s.mySlot]) || 0) - now();
    if (cd > 0) return;
    IS.client.act('kill', near.kill.slot);
    me.x = near.kill.x; me.y = near.kill.y;
    play('kill');
  }

  function doVent() {
    var s = st();
    if (!s || !isImp(s) || !amAlive(s) || phase(s) !== 'play') return;
    if (me.vt) {
      me.vt = 0; currentVent = null; play('vent');
    } else if (near && near.vent && near.vent.vent) {
      closeTask();
      currentVent = near.vent.vent;
      me.x = currentVent.x; me.y = currentVent.y; me.vt = 1; play('vent');
    }
    pushSelf();
  }

  function nextVent() {
    if (!currentVent || !IS.map || !IS.map.vents) return;
    var links = currentVent.links || [];
    if (!links.length) return;
    var idx = (currentVent._cycle || 0) % links.length;
    currentVent._cycle = idx + 1;
    var target = null;
    for (var i = 0; i < IS.map.vents.length; i++) if (IS.map.vents[i].id === links[idx]) target = IS.map.vents[i];
    if (!target) return;
    currentVent = target; me.x = target.x; me.y = target.y; play('vent');
    pushSelf();
  }

  function toast(t) { if (IS.ui && IS.ui.toast) IS.ui.toast(t); }

  function toggleMap(open) {
    mapOpen = open == null ? !mapOpen : !!open;
    if (IS.ui && IS.ui.showMap) IS.ui.showMap(mapOpen);
  }

  var handlers = {
    onCreate: function (o) {
      IS.audio && IS.audio.unlock && IS.audio.unlock();
      IS.client.create({ name: o.name, color: o.color }).then(function () { enterGame(); })
        .catch(function (e) { toast('Could not host: ' + (e && e.message || e)); });
    },
    onJoin: function (o) {
      IS.audio && IS.audio.unlock && IS.audio.unlock();
      IS.client.join({ code: o.code, name: o.name, color: o.color }).then(function () { enterGame(); })
        .catch(function (e) {
          var m = e && e.message || String(e);
          toast(m === 'not_found' ? 'No game with that code.' : m === 'full' ? 'That game is full.' : 'Could not join: ' + m);
        });
    },
    onFreeplay: function (o) {
      IS.audio && IS.audio.unlock && IS.audio.unlock();
      IS.client.create({ name: o.name, color: o.color, free: 1 }).then(function () {
        enterGame();
        setTimeout(function () { IS.client.act('start'); }, 400);
      }).catch(function (e) { toast('Could not start freeplay: ' + (e && e.message || e)); });
    },
    onStart: function () { IS.client.act('start'); },
    onSettings: function (set) { IS.client.act('set', set); },
    onColor: function (i) { IS.client.act('col', i); },
    onLeave: function () { leaveGame(); },
    onAgain: function () { IS.client.act('again'); },
    onUse: doUse,
    onReport: doReport,
    onKill: doKill,
    onSabotage: function (kind) {
      IS.client.act('sab', kind);
      if (IS.ui.showSabotageMenu) IS.ui.showSabotageMenu(false);
    },
    onVent: doVent,
    onMap: function () { toggleMap(); },
    onVote: function (slot) { IS.client.act('vote', slot); play('vote'); },
    onChat: function (text) { IS.client.chat(text); },
    onEmergency: function () { var s = st(); if (s && amAlive(s)) IS.client.act('emg'); },
    onMute: function (m) { if (IS.audio && IS.audio.setMuted) IS.audio.setMuted(m); }
  };

  function enterGame() {
    inGame = true; spawned = false;
    localDone = {}; localGame = -1;
    lastHud = ''; lastMeetingKey = '';
    IS.ui.showScreen('lobby');
    placeAtSpawn(st());
    spawned = true;
    pushSelf();
    if (IS.audio && IS.audio.loop) IS.audio.loop('ambient');
  }

  function leaveGame() {
    closeTask();
    toggleMap(false);
    if (IS.ui.hideOverlays) IS.ui.hideOverlays();
    if (IS.ui.hideMeeting) IS.ui.hideMeeting();
    try { IS.client.leave(); } catch (e) { /* ignore */ }
    inGame = false;
    IS.ui.showScreen('menu');
  }

  // ---------------------------------------------------------------- phase transitions
  function onPhase(ev) {
    var s = st();
    var to = ev && ev.to;
    var from = ev && ev.from;
    if (!inGame || !s) return;
    if (ejectTimer) { clearTimeout(ejectTimer); ejectTimer = null; }
    if (to !== 'play') { closeTask(); me.vt = 0; currentVent = null; }
    if (to !== 'play' && to !== 'lobby') toggleMap(false);

    if (to === 'lobby') {
      IS.ui.hideOverlays && IS.ui.hideOverlays();
      IS.ui.hideMeeting && IS.ui.hideMeeting();
      IS.ui.showScreen('lobby');
      placeAtSpawn(s);
      localDone = {};
    } else if (to === 'roles') {
      localDone = {}; localGame = s.hs.gn;
      IS.ui.hideOverlays && IS.ui.hideOverlays();
      IS.ui.showScreen('game');
      placeAtSpawn(s);
      var p = myPlayer(s);
      var imps = [];
      for (var i = 0; i < s.players.length; i++) {
        var o = s.players[i];
        if (o.role === 1 && (p && p.role === 1)) imps.push({ name: o.name, color: o.color });
      }
      var count = 0;
      if (s.hs && s.hs.pl) for (var k = 0; k < s.hs.pl.length; k++) if (s.hs.pl[k][3] === 1) count++;
      if (p) IS.ui.showRole({ role: p.role === 1 ? 'imp' : 'crew', impostors: imps, count: count });
      play('role');
      wasAlive = true;
    } else if (to === 'play') {
      IS.ui.showScreen('game');
      if (from === 'eject' || from === 'meeting' || from === 'roles') {
        IS.ui.hideOverlays && IS.ui.hideOverlays();
        IS.ui.hideMeeting && IS.ui.hideMeeting();
        placeAtSpawn(s);
      }
    } else if (to === 'meeting') {
      lastMeetingKey = '';
      votedSoundCount = 0;
      play('alarm');
      showMeetingNow(s, true);
    } else if (to === 'eject') {
      // reveal votes briefly, then ejection cinematic
      var mt = lastMeeting;
      if (mt) IS.ui.updateMeeting(meetingView(s, mt, 'result'));
      ejectTimer = setTimeout(function () {
        var s2 = st();
        IS.ui.hideMeeting();
        IS.ui.showEjection(ejectionView(s2 || s));
        play('eject');
      }, 2600);
    } else if (to === 'over') {
      IS.ui.hideMeeting && IS.ui.hideMeeting();
      var w = s.hs.wn || { t: 'crew', r: 'tasks' };
      var mp = myPlayer(s);
      var youWon = !!mp && ((w.t === 'imp') === (mp.role === 1));
      var pls = s.players.map(function (o) { return { name: o.name, color: o.color, role: o.role, alive: o.alive }; });
      IS.ui.showGameOver({ winner: w.t, reason: reasonText(w), youWon: youWon, players: pls, isHost: IS.client.isHost() });
      play(youWon ? 'win' : 'lose');
    }
  }

  function reasonText(w) {
    switch (w.r) {
      case 'tasks': return 'Crewmates completed all their tasks.';
      case 'vote': return w.t === 'crew' ? 'All Impostors were voted out.' : 'The crew voted out one of their own.';
      case 'kills': return 'The Impostors eliminated the crew.';
      case 'sabotage': return 'The Impostors’ sabotage destroyed the ship.';
      case 'disconnect': return w.t === 'crew' ? 'The Impostor left the game.' : 'Too many crewmates left the game.';
      default: return '';
    }
  }

  function meetingView(s, mt, forcePhase) {
    var t = now();
    var by = playerBySlot(s, mt.by);
    var body = mt.bd >= 0 ? playerBySlot(s, mt.bd) : null;
    var mine = s.mySlot >= 0 && mt.vt ? mt.vt[s.mySlot] : -2;
    var p = myPlayer(s);
    var ph = forcePhase || (t < mt.ds ? 'discuss' : 'vote');
    var remain = Math.max(0, Math.ceil(((ph === 'discuss' ? mt.ds : (s.hs.pe || t)) - t) / 1000));
    var players = s.players.map(function (o) {
      var v = mt.vt ? mt.vt[o.slot] : -2;
      return {
        slot: o.slot, name: o.name, color: o.color, alive: !!o.alive && o.conn !== 0, isMe: o.isMe,
        voted: v !== -2 && v !== undefined, canVote: ph === 'vote' && !!(p && p.alive) && mine === -2 && !!o.alive,
        caller: o.slot === mt.by
      };
    });
    var view = {
      by: by ? { name: by.name, color: by.color } : { name: '?', color: 0 },
      body: body ? { name: body.name, color: body.color } : null,
      players: players, phase: ph, remain: remain, myVote: mine,
      canVote: ph === 'vote' && !!(p && p.alive) && mine === -2
    };
    if (ph === 'result') {
      var tallies = {};
      (mt.vt || []).forEach(function (target, voter) {
        if (target === -2 || target === undefined) return;
        var vp = playerBySlot(s, voter);
        var key = String(target);
        (tallies[key] = tallies[key] || []).push(vp ? vp.color : 0);
      });
      view.votes = tallies;
    }
    return view;
  }

  function showMeetingNow(s, first) {
    var mt = s.hs && s.hs.mt;
    if (!mt) return;
    lastMeeting = mt;
    var v = meetingView(s, mt);
    if (first) IS.ui.showMeeting(v); else IS.ui.updateMeeting(v);
  }

  function ejectionView(s) {
    var ej = s && s.hs && s.hs.ej;
    if (!ej) return { name: '', color: -1, text: 'No one was ejected.' };
    if (ej.s < 0) return { name: '', color: -1, text: ej.tie ? 'No one was ejected. (Tie)' : 'No one was ejected. (Skipped)' };
    var p = playerBySlot(s, ej.s);
    var name = p ? p.name : 'Someone';
    var text;
    if (settings(s).conf) {
      text = name + (ej.imp ? ' was An Impostor.' : ' was not An Impostor.');
      if (ej.left != null) text += '\n' + ej.left + ' Impostor' + (ej.left === 1 ? '' : 's') + ' remain' + (ej.left === 1 ? 's' : '') + '.';
    } else text = name + ' was ejected.';
    return { name: name, color: p ? p.color : 0, text: text };
  }

  // ---------------------------------------------------------------- per-frame
  function pushSelf() {
    if (!inGame || !IS.client || !IS.client.setSelf) return;
    IS.client.setSelf({ x: Math.round(me.x), y: Math.round(me.y), f: me.f, m: me.m, vt: me.vt, fx: me.fx });
  }

  function inputVector() {
    var x = 0, y = 0;
    if (!(IS.ui && IS.ui.isTyping && IS.ui.isTyping())) {
      if (keys.ArrowLeft || keys.KeyA) x -= 1;
      if (keys.ArrowRight || keys.KeyD) x += 1;
      if (keys.ArrowUp || keys.KeyW) y -= 1;
      if (keys.ArrowDown || keys.KeyS) y += 1;
    }
    var stick = IS.ui && IS.ui.getStick ? IS.ui.getStick() : { x: 0, y: 0 };
    if (stick && (stick.x || stick.y)) { x += stick.x; y += stick.y; }
    var l = Math.sqrt(x * x + y * y);
    if (l > 1) { x /= l; y /= l; }
    return { x: x, y: y };
  }

  function move(s, dt) {
    var v = inputVector();
    var moving = (v.x !== 0 || v.y !== 0) && canMove(s);
    me.m = moving ? 1 : 0;
    if (!moving) return;
    if (v.x > 0.1) me.f = 1; else if (v.x < -0.1) me.f = -1;
    var speed = C.SPEED * (settings(s).spd || 1);
    var dx = v.x * speed * dt, dy = v.y * speed * dt;
    var p = myPlayer(s);
    var ghost = inGame && phase(s) !== 'lobby' && (!p || !p.alive);
    if (ghost) {
      // ghosts float through walls, clamped to the map
      var W = (IS.map.W || 90) * C.TILE, H = (IS.map.H || 56) * C.TILE;
      me.x = Math.max(C.TILE, Math.min(W - C.TILE, me.x + dx));
      me.y = Math.max(C.TILE, Math.min(H - C.TILE, me.y + dy));
    } else if (IS.map && IS.map.moveCircle) {
      var r = IS.map.moveCircle(me.x, me.y, dx, dy, C.PLAYER_RADIUS);
      me.x = r.x; me.y = r.y;
    } else { me.x += dx; me.y += dy; }
    walkPhase = (walkPhase + dt * 4) % 1;
    stepTimer -= dt;
    if (stepTimer <= 0 && !ghost) { play('step', { volume: 0.25 }); stepTimer = 0.32; }
  }

  function hudState(s) {
    var p = myPlayer(s);
    var imp = !!(p && p.role === 1);
    var alive = !!(p && p.alive);
    var sb = sab(s);
    var ph = phase(s);
    var tasks = myTasks(s).map(function (t) { return { name: t.name, room: t.room, done: t.done }; });
    // overall crew progress
    var done = 0, total = 0;
    if (s.hs && s.hs.pl) s.hs.pl.forEach(function (row) {
      if (row[3] === 1) return;
      total += row[5] || 0;
      var m = row[4] || 0;
      for (var i = 0; i < (row[5] || 0); i++) if ((m >> i) & 1) done++;
    });
    var kcd = Math.max(0, Math.ceil((((s.hs.kc && s.hs.kc[s.mySlot]) || 0) - now()) / 1000));
    var sabCd = Math.max(0, Math.ceil(((s.hs.sc || 0) - now()) / 1000));
    var playing = ph === 'play';
    var sabInfo = null;
    if (sb) sabInfo = { k: sb.k, remain: sb.end ? Math.max(0, Math.ceil((sb.end - now()) / 1000)) : null };
    return {
      role: imp ? 'imp' : 'crew', alive: alive || !p, spectator: !p,
      tasks: tasks, progress: total ? done / total : 0,
      hidden: !!(sb && sb.k === 'comms' && !imp),
      freeplay: !!settings(s).free,
      buttons: {
        use: { on: playing && !!(near && near.use), label: near && near.use ? near.use.label : 'USE' },
        report: { on: playing && alive && !!(near && near.report) },
        kill: { on: playing && alive && imp && !!(near && near.kill) && kcd === 0, cd: kcd, show: imp && alive },
        sabotage: { on: playing && imp && !sb && sabCd === 0, cd: sabCd, show: imp },
        vent: { on: playing && imp && alive && !!(near && near.vent), show: imp && alive },
        map: { on: true }
      },
      sabotage: sabInfo
    };
  }

  function lobbyState(s) {
    var players = s.players.map(function (o) {
      return { slot: o.slot, name: o.name, color: o.color, isMe: o.isMe, isHost: o.isHost };
    });
    var n = s.players.filter(function (o) { return o.conn !== 0; }).length;
    return {
      code: s.code, isHost: IS.client.isHost(), players: players, settings: settings(s),
      canStart: n >= C.MIN_PLAYERS || !!settings(s).free, mode: IS.net && IS.net.mode
    };
  }

  function renderView(s, t) {
    var players = [], bodies = [];
    var p = s ? myPlayer(s) : null;
    var myAlive = !inGame || phase(s) === 'lobby' || !!(p && p.alive);
    var imp = !!(p && p.role === 1);
    if (inGame && s) {
      for (var i = 0; i < s.players.length; i++) {
        var o = s.players[i];
        if (o.conn === 0) continue;
        var isMe = o.isMe;
        var ghost = phase(s) !== 'lobby' && !o.alive;
        if (ghost && myAlive && !isMe) continue; // living players can't see ghosts
        players.push({
          slot: o.slot, peer: o.peer, x: isMe ? me.x : o.x, y: isMe ? me.y : o.y,
          f: isMe ? me.f : o.f, m: isMe ? me.m : o.m, walk: isMe ? walkPhase : undefined,
          color: o.color, alive: !!o.alive || phase(s) === 'lobby', name: o.name,
          role: (imp || isMe) ? o.role : undefined, ghost: ghost, inVent: isMe ? !!me.vt : !!o.vt, isMe: isMe
        });
      }
      if (s.hs && s.hs.bd && phase(s) === 'play') {
        s.hs.bd.forEach(function (b) {
          var bp = playerBySlot(s, b[0]);
          bodies.push({ slot: b[0], x: b[1], y: b[2], color: bp ? bp.color : 0 });
        });
      }
    }
    var tt = [], sbt = [];
    if (inGame && s && phase(s) === 'play') {
      var sb = sab(s);
      if (!(sb && sb.k === 'comms' && !imp) && !imp) {
        myTasks(s).forEach(function (tk) { if (!tk.done) tt.push({ x: tk.x, y: tk.y }); });
      }
      if (sb) fixPoints(sb.k).forEach(function (f) {
        if (sb.k === 'o2' && sb.fx && sb.fx[f.part]) return;
        sbt.push({ x: f.x, y: f.y });
      });
    }
    var hl = null;
    if (near) {
      var h = near.use || near.kill || near.report || (near.vent && near.vent.vent ? near.vent : null);
      if (h && h.type !== 'vent-next') hl = { type: h.type, x: h.x, y: h.y };
    }
    return {
      me: { x: me.x, y: me.y, slot: s ? s.mySlot : -1, alive: myAlive, role: p ? p.role : 0, color: p ? p.color : 0 },
      cam: { x: cam.x, y: cam.y },
      zoom: IS.render.defaultZoom ? IS.render.defaultZoom(window.innerWidth, window.innerHeight) : 1,
      players: players, bodies: bodies,
      vision: inGame ? visionFor(s) : Infinity,
      lights: !!(s && sab(s) && sab(s).k === 'lights'),
      highlight: hl, taskTargets: tt, sabotageTargets: sbt,
      showNames: true, time: t / 1000, phase: inGame ? phase(s) : 'menu'
    };
  }

  // attract mode: slow camera drift around the station behind the menu
  function attract(t) {
    var W = (IS.map && IS.map.W || 90) * C.TILE, H = (IS.map && IS.map.H || 56) * C.TILE;
    cam.x = W / 2 + Math.cos(t / 9000) * W * 0.3;
    cam.y = H / 2 + Math.sin(t / 7000) * H * 0.25;
    me.x = cam.x; me.y = cam.y;
  }

  function frame(t) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (t - (lastTime || t)) / 1000);
    lastTime = t;
    var s = inGame ? st() : null;

    if (!inGame) {
      attract(t);
    } else if (s) {
      var ph = phase(s);
      // reset optimistic task completions when a new game starts
      if (s.hs && localGame !== s.hs.gn) { localDone = {}; localGame = s.hs.gn; }
      move(s, dt);
      // follow camera
      var k = 1 - Math.pow(0.0001, dt);
      cam.x += (me.x - cam.x) * k; cam.y += (me.y - cam.y) * k;

      near = computeNear(s);
      pushSelf();

      // death detection
      var p = myPlayer(s);
      if (p && ph === 'play') {
        if (wasAlive && !p.alive) {
          closeTask(); me.vt = 0;
          play('kill');
          toast('You were killed! You are now a ghost.');
        }
        wasAlive = !!p.alive;
      }

      // sabotage start / end
      var sb = sab(s);
      var sk = sb ? sb.k : null;
      if (sk !== lastSabKind) {
        if (sk) play('sabotage');
        if (!sk && task && task.fix) closeTask();
        if (IS.audio) {
          if (sk === 'reactor' || sk === 'o2') IS.audio.loop && IS.audio.loop('alarm');
          else IS.audio.stopLoop && IS.audio.stopLoop('alarm');
        }
        lastSabKind = sk;
      }
      if (task && task.fix && task.fixKind === 'reactor' && task.ctrl && task.ctrl.setStatus) {
        var holders = s.players.filter(function (o) { return !o.isMe && o.fx && o.fx.charAt(0) === 'r'; }).length;
        task.ctrl.setStatus(me.fx ? (holders ? 'Holding…' : 'Waiting for a second user…') : 'Hold your hand on the scanner');
      }

      if (ph === 'lobby') {
        IS.ui.updateLobby(lobbyState(s));
      } else if (ph === 'play') {
        var hud = hudState(s);
        var key = JSON.stringify(hud);
        if (key !== lastHud) { IS.ui.updateHud(hud); lastHud = key; }
      } else if (ph === 'meeting' && s.hs.mt) {
        var mv = meetingView(s, s.hs.mt);
        var mk = JSON.stringify(mv);
        if (mk !== lastMeetingKey) {
          var votes = mv.players.filter(function (o) { return o.voted; }).length;
          if (votes > votedSoundCount) { play('vote'); votedSoundCount = votes; }
          lastMeeting = s.hs.mt;
          IS.ui.updateMeeting(mv); lastMeetingKey = mk;
        }
      }
    }

    if (IS.render && IS.render.frame) {
      var view = renderView(s, t);
      try { IS.render.frame(view); } catch (e) { if (!frame._err) { frame._err = 1; console.error(e); } }
      if (mapOpen && IS.ui.setMapView) IS.ui.setMapView(view);
    }
  }

  // ---------------------------------------------------------------- input
  function onKeyDown(e) {
    if (IS.ui && IS.ui.isTyping && IS.ui.isTyping()) return;
    keys[e.code] = true;
    var s = st();
    if (!inGame) return;
    var ph = phase(s);
    switch (e.code) {
      case 'KeyE': case 'Space': case 'Enter':
        if (e.code === 'Enter' && ph !== 'play') break;
        if (ph === 'play' && !task) { doUse(); e.preventDefault(); }
        break;
      case 'KeyQ': if (ph === 'play') doKill(); break;
      case 'KeyR': if (ph === 'play') doReport(); break;
      case 'KeyV': if (ph === 'play') doVent(); break;
      case 'Tab': e.preventDefault(); if (ph === 'play' || ph === 'lobby') toggleMap(); break;
      case 'Escape': if (mapOpen) toggleMap(false); break;
    }
    if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault();
  }
  function onKeyUp(e) { keys[e.code] = false; }

  function boot() {
    canvas = document.getElementById('game-canvas');
    if (IS.render && IS.render.init) IS.render.init(canvas);
    IS.ui.init(handlers);
    IS.ui.showScreen('menu');
    if (IS.assets && IS.assets.load) IS.assets.load();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () { keys = {}; });
    var unlock = function () { if (IS.audio && IS.audio.unlock) IS.audio.unlock(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    IS.client.on('phase', onPhase);
    IS.client.on('chat', function (m) {
      var s = st();
      var p = myPlayer(s);
      var iAmDead = !!(p && !p.alive);
      if (m.dead && !iAmDead) return; // only ghosts hear ghosts
      IS.ui.addChat({ name: m.name, color: m.color, text: m.text, dead: !!m.dead, isMe: !!m.isMe });
    });
    if (IS.client.onGames) IS.client.onGames(function (list) { IS.ui.setGameList(list); });
    IS.client.boot().then(function (r) {
      if (IS.ui.setMode) IS.ui.setMode(r && r.mode || 'offline');
    }).catch(function () { if (IS.ui.setMode) IS.ui.setMode('offline'); });

    requestAnimationFrame(frame);
  }

  IS.main = { _me: me, _near: function () { return near; }, _debug: { doUse: doUse, doKill: doKill, doReport: doReport, doVent: doVent } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
