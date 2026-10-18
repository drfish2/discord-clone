/* Starship Sus — asset loader (images) + sound engine (WebAudio with HTMLAudio fallback).
 * See SPEC.md §4.2. Art and sounds are Kenney CC0 packs — see assets/CREDITS.md.
 * Always resolve asset paths through IS.ASSET_URLS (the release build maps every path to a data: URI). */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});

  // ------------------------------------------------------------------------------------ manifest
  var MANIFEST = (IS.ASSET_MANIFEST = {
    images: {
      floor_room: 'assets/img/floor_room.png',
      floor_hall: 'assets/img/floor_hall.png',
      floor_tech: 'assets/img/floor_tech.png',
      wall: 'assets/img/wall.png',
      prop_table: 'assets/img/prop_table.png',
      prop_crate: 'assets/img/prop_crate.png',
      prop_console: 'assets/img/prop_console.png',
      prop_bed: 'assets/img/prop_bed.png',
      prop_engine: 'assets/img/prop_engine.png',
      prop_reactor: 'assets/img/prop_reactor.png',
      prop_plant: 'assets/img/prop_plant.png',
      prop_chair: 'assets/img/prop_chair.png',
      prop_screen: 'assets/img/prop_screen.png',
      prop_barrel: 'assets/img/prop_barrel.png',
      vent: 'assets/img/vent.png',
      button: 'assets/img/button.png',
      stars: 'assets/img/stars.png'
    },
    sounds: {
      click: 'assets/sfx/click.mp3',
      hover: 'assets/sfx/hover.mp3',
      kill: 'assets/sfx/kill.mp3',
      body: 'assets/sfx/body.mp3',
      alarm: 'assets/sfx/alarm.mp3',
      vote: 'assets/sfx/vote.mp3',
      eject: 'assets/sfx/eject.mp3',
      task: 'assets/sfx/task.mp3',
      task_step: 'assets/sfx/task_step.mp3',
      vent: 'assets/sfx/vent.mp3',
      sabotage: 'assets/sfx/sabotage.mp3',
      sab_alarm: 'assets/sfx/sab_alarm.wav',
      emergency: 'assets/sfx/emergency.mp3',
      role_imp: 'assets/sfx/role_imp.mp3',
      win: 'assets/sfx/win.mp3',
      lose: 'assets/sfx/lose.mp3',
      step: 'assets/sfx/step.mp3',
      role: 'assets/sfx/role.mp3',
      door: 'assets/sfx/door.mp3',
      ambient: 'assets/sfx/ambient.wav'
    }
  });

  // Default per-key volume (0..1) and minimum re-trigger interval (ms).
  var VOLUME = { hover: 0.35, step: 0.3, task_step: 0.6, ambient: 0.32, alarm: 0.55, door: 0.7, eject: 0.9, sab_alarm: 0.6, emergency: 0.85 };
  var MIN_GAP = { step: 140, hover: 70, click: 40, task_step: 50, alarm: 400, sabotage: 400, sab_alarm: 400, emergency: 400, body: 300, kill: 200 };
  var DEFAULT_GAP = 60;
  var LOAD_TIMEOUT = 8000;

  function resolve(path) {
    return (IS.ASSET_URLS && IS.ASSET_URLS[path]) || path;
  }
  function noop() {}

  // ------------------------------------------------------------------------------------ images
  var imgs = {}; // key -> HTMLImageElement
  var ready = {}; // key -> true once loaded with naturalWidth > 0
  var loadPromise = null;
  var progressFns = [];

  function report(done, total) {
    for (var i = 0; i < progressFns.length; i++) {
      try { progressFns[i](total ? done / total : 1, done, total); } catch (e) { /* ignore */ }
    }
  }

  function loadImage(key, path) {
    return new Promise(function (res) {
      var im;
      try {
        im = new Image();
        im.decoding = 'async';
      } catch (e) { res(); return; }
      var finished = false;
      function finish(ok) {
        if (finished) return;
        finished = true;
        if (ok && im.naturalWidth > 0) { imgs[key] = im; ready[key] = true; }
        res();
      }
      im.onload = function () { finish(true); };
      im.onerror = function () { finish(false); };
      try { im.src = resolve(path); } catch (e2) { finish(false); }
      if (im.complete && im.naturalWidth > 0) finish(true);
    });
  }

  function load(onProgress) {
    if (typeof onProgress === 'function') progressFns.push(onProgress);
    if (loadPromise) return loadPromise;
    var imgKeys = Object.keys(MANIFEST.images);
    var sndKeys = Object.keys(MANIFEST.sounds);
    var total = imgKeys.length + sndKeys.length;
    var done = 0;
    function tick() { done++; report(done, total); }
    report(0, total);
    var jobs = [];
    imgKeys.forEach(function (k) { jobs.push(loadImage(k, MANIFEST.images[k]).then(tick, tick)); });
    // Sounds: fetch bytes now (and decode as soon as an AudioContext exists) so first play is instant.
    sndKeys.forEach(function (k) { jobs.push(audio._prefetch(k).then(tick, tick)); });
    var all = Promise.all(jobs).then(noop, noop);
    var timeout = new Promise(function (res) { setTimeout(res, LOAD_TIMEOUT); });
    loadPromise = Promise.race([all, timeout]).then(function () { report(total, total); }, noop);
    return loadPromise;
  }

  IS.assets = {
    load: load,
    img: function (key) { return ready[key] ? imgs[key] : null; },
    has: function (key) { return !!ready[key]; },
    url: function (path) { return resolve(path); },
    FONT_DISPLAY: '"Russo One", system-ui, sans-serif',
    FONT_BODY: '"Rubik", system-ui, sans-serif'
  };

  // ------------------------------------------------------------------------------------ audio
  var LS_KEY = 'starship-sus:muted';
  var muted = false;
  try { muted = window.localStorage.getItem(LS_KEY) === '1'; } catch (e) { /* storage blocked */ }

  var ctx = null; // AudioContext
  var master = null; // GainNode
  var unlocked = false; // a user gesture has happened
  var bytes = {}; // key -> Promise<ArrayBuffer|null>
  var buffers = {}; // key -> AudioBuffer
  var decoding = {}; // key -> Promise
  var htmlOnly = {}; // key -> true when WebAudio decode failed / unavailable
  var lastPlay = {}; // key -> ms
  var wantLoops = {}; // key -> volume (loops requested)
  var loops = {}; // key -> {src, gain} | {el}
  var htmlEls = []; // active HTMLAudioElements (for mute)

  var AC = window.AudioContext || window.webkitAudioContext;

  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function getCtx() {
    if (ctx || !AC) return ctx;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null; master = null;
    }
    return ctx;
  }

  function dataUriToBuffer(uri) {
    var comma = uri.indexOf(',');
    if (comma < 0 || !/;base64$/i.test(uri.slice(0, comma))) return null;
    var bin = atob(uri.slice(comma + 1));
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  function fetchBytes(key) {
    if (bytes[key]) return bytes[key];
    var path = MANIFEST.sounds[key];
    if (!path) return (bytes[key] = Promise.resolve(null));
    var url = resolve(path);
    bytes[key] = new Promise(function (res) {
      try {
        if (/^data:/i.test(url)) {
          var b = dataUriToBuffer(url);
          if (b) { res(b); return; }
        }
        if (!window.fetch) { res(null); return; }
        fetch(url).then(function (r) { return r.ok || r.status === 0 ? r.arrayBuffer() : null; })
          .then(function (ab) { res(ab || null); }, function () { res(null); });
      } catch (e) { res(null); }
    });
    return bytes[key];
  }

  function decode(key) {
    if (buffers[key]) return Promise.resolve(buffers[key]);
    if (decoding[key]) return decoding[key];
    var c = getCtx();
    if (!c) { htmlOnly[key] = true; return Promise.resolve(null); }
    decoding[key] = fetchBytes(key).then(function (ab) {
      if (!ab) { htmlOnly[key] = true; return null; }
      return new Promise(function (res) {
        var settled = false;
        function ok(buf) { if (settled) return; settled = true; if (buf) buffers[key] = buf; else htmlOnly[key] = true; res(buf || null); }
        function fail() { if (settled) return; settled = true; htmlOnly[key] = true; res(null); }
        try {
          // slice(0): decodeAudioData detaches the buffer; keep the original intact.
          var p = c.decodeAudioData(ab.slice(0), ok, fail);
          if (p && p.then) p.then(ok, fail);
        } catch (e) { fail(); }
      });
    }).then(function (buf) {
      if (buf && wantLoops[key] != null) startLoop(key);
      return buf;
    });
    return decoding[key];
  }

  function prefetch(key) {
    // Fetch bytes always; decode now if WebAudio exists (a suspended context can still decode).
    return fetchBytes(key).then(function () { return AC ? decode(key) : null; }).then(noop, noop);
  }

  function resumeCtx() {
    if (!ctx) return;
    try {
      if (ctx.state !== 'running' && ctx.resume) {
        var p = ctx.resume();
        if (p && p.then) p.then(startWantedLoops, noop);
      }
    } catch (e) { /* ignore */ }
  }

  function unlock() {
    try {
      unlocked = true;
      var c = getCtx();
      if (c) {
        resumeCtx();
        // iOS: play a 1-sample silent buffer inside the gesture to fully unlock output.
        try {
          var b = c.createBuffer(1, 1, 22050);
          var s = c.createBufferSource();
          s.buffer = b; s.connect(c.destination); s.start(0);
        } catch (e) { /* ignore */ }
        Object.keys(MANIFEST.sounds).forEach(function (k) { decode(k); });
      }
      startWantedLoops();
    } catch (e) { /* never throw */ }
  }

  function canUseCtx() {
    return ctx && ctx.state === 'running';
  }

  function htmlPlay(key, vol, loop) {
    var path = MANIFEST.sounds[key];
    if (!path || !unlocked) return null;
    try {
      var el = new Audio(resolve(path));
      el.volume = Math.max(0, Math.min(1, vol));
      el.loop = !!loop;
      el.muted = muted;
      var p = el.play();
      if (p && p.catch) p.catch(noop);
      htmlEls.push(el);
      el.addEventListener('ended', function () {
        var i = htmlEls.indexOf(el);
        if (i >= 0) htmlEls.splice(i, 1);
      });
      return el;
    } catch (e) { return null; }
  }

  function play(key, opts) {
    try {
      if (!MANIFEST.sounds[key]) return;
      var t = nowMs();
      var gap = MIN_GAP[key] != null ? MIN_GAP[key] : DEFAULT_GAP;
      if (lastPlay[key] && t - lastPlay[key] < gap) return;
      if (muted) return;
      var vol = opts && typeof opts.volume === 'number' ? opts.volume : (VOLUME[key] != null ? VOLUME[key] : 1);
      if (!(vol > 0)) return;
      var rate = opts && typeof opts.rate === 'number' ? opts.rate : (key === 'step' ? 0.9 + Math.random() * 0.2 : 1);
      if (ctx && buffers[key]) {
        if (ctx.state !== 'running') { resumeCtx(); if (ctx.state !== 'running') return; }
        var src = ctx.createBufferSource();
        src.buffer = buffers[key];
        src.playbackRate.value = rate;
        var g = ctx.createGain();
        g.gain.value = vol;
        src.connect(g); g.connect(master);
        src.start(0);
        lastPlay[key] = t;
        return;
      }
      if (htmlOnly[key] || !AC) { if (htmlPlay(key, vol, false)) lastPlay[key] = t; return; }
      // Not decoded yet: kick decoding; this one play is skipped (sfx are not worth a late play).
      decode(key);
    } catch (e) { /* never throw */ }
  }

  function startLoop(key) {
    try {
      if (loops[key] || wantLoops[key] == null) return;
      var vol = wantLoops[key];
      if (canUseCtx() && buffers[key]) {
        var src = ctx.createBufferSource();
        src.buffer = buffers[key];
        src.loop = true;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.4);
        src.connect(g); g.connect(master);
        src.start(0);
        loops[key] = { src: src, gain: g };
        return;
      }
      if ((htmlOnly[key] || !AC) && unlocked) {
        var el = htmlPlay(key, vol, true);
        if (el) loops[key] = { el: el };
        return;
      }
      if (AC) decode(key); // will call startLoop when ready
    } catch (e) { /* ignore */ }
  }

  function startWantedLoops() {
    Object.keys(wantLoops).forEach(startLoop);
  }

  function loop(key, opts) {
    try {
      if (!MANIFEST.sounds[key]) return;
      var vol = opts && typeof opts.volume === 'number' ? opts.volume : (VOLUME[key] != null ? VOLUME[key] : 0.5);
      wantLoops[key] = vol;
      startLoop(key);
    } catch (e) { /* ignore */ }
  }

  function stopLoop(key) {
    try {
      delete wantLoops[key];
      var l = loops[key];
      if (!l) return;
      delete loops[key];
      if (l.src) {
        var t = ctx.currentTime;
        try {
          l.gain.gain.cancelScheduledValues(t);
          l.gain.gain.setValueAtTime(l.gain.gain.value, t);
          l.gain.gain.linearRampToValueAtTime(0, t + 0.25);
          l.src.stop(t + 0.3);
        } catch (e) { try { l.src.stop(); } catch (e2) { /* ignore */ } }
      } else if (l.el) {
        l.el.pause();
        var i = htmlEls.indexOf(l.el);
        if (i >= 0) htmlEls.splice(i, 1);
      }
    } catch (e) { /* ignore */ }
  }

  function setMuted(m) {
    muted = !!m;
    try { window.localStorage.setItem(LS_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
    try {
      if (master && ctx) {
        var t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(muted ? 0 : 1, t + 0.08);
      }
      htmlEls.forEach(function (el) { el.muted = muted; });
    } catch (e) { /* ignore */ }
  }

  var audio = {
    unlock: unlock,
    play: play,
    loop: loop,
    stopLoop: stopLoop,
    setMuted: setMuted,
    isLoaded: function (key) { return !!buffers[key]; },
    _prefetch: prefetch
  };
  Object.defineProperty(audio, 'muted', {
    enumerable: true,
    get: function () { return muted; },
    set: function (v) { setMuted(v); }
  });
  IS.audio = audio;
})();
