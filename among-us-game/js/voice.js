/* Starship Sus — proximity voice chat for the self-hosted build. See SPEC.md §7.
 * Runs on the game room's LiveKit connection (IS.lkTransport.livekitRoom('ss-<code>')):
 *   - a small floating widget (mic toggle + push-to-talk switch; hold T or the mic button to talk);
 *   - every remote audio track goes MediaStreamSource -> Gain -> StereoPanner -> destination,
 *     with gain/pan recomputed every frame from update(view) (distance, line of sight, vents,
 *     ghosts, meetings) and smoothed with setTargetAtTime. LiveKit never attaches its own
 *     <audio> elements (we never call track.attach()), so nothing plays twice;
 *   - isSpeaking(peer) from LiveKit's active-speaker flags, only for players I can hear.
 * Completely inert when window.SS_LIVEKIT is unset (the claude.ai build): no DOM, no listeners.
 */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});

  function noop() {}
  function falsy() { return false; }

  // ------------------------------------------------------------------ pure mixing rules
  // target(view, peer, opts) -> {g: 0..1, p: -1..1}. opts: {near, far, los(x0,y0,x1,y1)->bool}
  function target(view, peer, opts) {
    var OFF = { g: 0, p: 0 };
    if (!view || !view.inGame || !view.me) return OFF;
    var me = view.me, ph = view.phase, sp = null, i;
    var list = view.players || [];
    for (i = 0; i < list.length; i++) if (list[i] && list[i].peer === peer) { sp = list[i]; break; }
    if (sp && sp.isMe) return OFF;
    if (sp && sp.conn === false) return OFF;
    var meGhost = !!(me.spectator || !me.alive);
    var spGhost = !sp || !sp.alive; // peers without a slot (spectators) count as ghosts
    if (ph === 'lobby' || ph === 'over') return { g: 1, p: 0 };
    if (ph === 'meeting' || ph === 'eject') return { g: spGhost && !meGhost ? 0 : 1, p: 0 };
    // play (and the role reveal before it): proximity
    var near = (opts && opts.near) || 96, far = Math.max((opts && opts.far) || 300, near + 1);
    var pan = 0, d = Infinity;
    if (sp && isFinite(sp.x) && isFinite(sp.y) && isFinite(me.x) && isFinite(me.y)) {
      var dx = sp.x - me.x, dy = sp.y - me.y;
      d = Math.sqrt(dx * dx + dy * dy);
      pan = Math.max(-1, Math.min(1, dx / far)) * 0.7;
    }
    if (spGhost) return meGhost ? { g: 1, p: pan } : OFF; // only ghosts hear ghosts
    if (sp.inVent) return OFF;                            // impostors in vents are silent
    if (meGhost) return { g: 1, p: pan };                 // ghosts hear everyone
    if (!(d < far)) return OFF;
    var los = opts && opts.los;
    if (los && !los(me.x, me.y - 20, sp.x, sp.y - 20)) return OFF;
    if (d <= near) return { g: 1, p: pan };
    var t = (d - near) / (far - near);
    return { g: 1 - t * t * (3 - 2 * t), p: pan };
  }

  if (!window.SS_LIVEKIT) {
    IS.voice = { update: noop, isSpeaking: falsy, active: falsy, _target: target };
    return;
  }

  var LS_PTT = 'starship-sus/voice-ptt';
  var SMOOTH = 0.07; // s, gain time constant
  var TALK_LEVEL = 0.02, TALK_HANG = 400; // RMS above which a voice counts as speaking; hold (ms)
  var AUDIO_OPTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  var S = {
    room: null, name: null, handlers: [],
    ctx: null, remotes: new Map(), // identity -> {track, stream, el, src, gain, pan, an, loud, tg, tp}
    local: null, // {mst, src, an, loud} level meter on my own microphone
    micWanted: false, micOn: false, micBusy: false, micErr: false,
    ptt: false, keyHeld: false, ptrHeld: false,
    dock: null, btn: null, mode: null, lastUi: ''
  };
  try { S.ptt = window.localStorage.getItem(LS_PTT) === '1'; } catch (e) { /* ignore */ }

  function LK() { return window.LivekitClient || {}; }
  function ev(n) { var E = LK().RoomEvent; return (E && E[n]) || n.charAt(0).toLowerCase() + n.slice(1); }
  function enabled() { return !!(IS.net && IS.net.mode === 'livekit' && IS.lkTransport && IS.lkTransport.livekitRoom); }
  function toast(t) { if (IS.ui && IS.ui.toast) IS.ui.toast(t); }
  function isTouch() { return !!(document.body && document.body.classList.contains('is-touch')); }

  // ------------------------------------------------------------------ audio graph
  function ensureCtx() {
    if (S.ctx) return S.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { S.ctx = new AC(); } catch (e) { S.ctx = null; }
    return S.ctx;
  }
  function resume() {
    if (!enabled()) return;
    var c = ensureCtx();
    if (c && c.state === 'suspended' && c.resume) c.resume().catch(noop);
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (t) { window.addEventListener(t, resume, true); });

  function addRemote(peer, track) {
    if (!peer || !track || !track.mediaStreamTrack) return;
    var old = S.remotes.get(peer);
    if (old && old.track === track) return;
    if (old) removeRemote(peer);
    var R = { track: track, stream: null, el: null, src: null, gain: null, pan: null, an: null, loud: 0, tg: -1, tp: 0 };
    var c = ensureCtx();
    try {
      R.stream = new MediaStream([track.mediaStreamTrack]);
      if (c) {
        // Chromium only feeds remote WebRTC audio into WebAudio while a media element plays the
        // stream, so keep a muted, detached <audio> for it (it makes no sound itself).
        R.el = document.createElement('audio');
        R.el.muted = true;
        R.el.srcObject = R.stream;
        var pp = R.el.play();
        if (pp && pp.catch) pp.catch(noop);
        R.src = c.createMediaStreamSource(R.stream);
        R.gain = c.createGain();
        R.gain.gain.value = 0;
        R.src.connect(R.gain);
        R.an = meter(c, R.src);
        if (c.createStereoPanner) { R.pan = c.createStereoPanner(); R.gain.connect(R.pan); R.pan.connect(c.destination); }
        else R.gain.connect(c.destination);
      } else {
        // no WebAudio: plain element, volume only
        R.el = document.createElement('audio');
        R.el.autoplay = true;
        R.el.volume = 0;
        R.el.srcObject = R.stream;
        var p2 = R.el.play();
        if (p2 && p2.catch) p2.catch(noop);
      }
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('voice: cannot route audio for', peer, e);
    }
    S.remotes.set(peer, R);
  }
  function removeRemote(peer) {
    var R = S.remotes.get(peer);
    if (!R) return;
    S.remotes.delete(peer);
    try { if (R.src) R.src.disconnect(); } catch (e) { /* ignore */ }
    try { if (R.an) R.an.disconnect(); } catch (e) { /* ignore */ }
    try { if (R.gain) R.gain.disconnect(); } catch (e) { /* ignore */ }
    try { if (R.pan) R.pan.disconnect(); } catch (e) { /* ignore */ }
    try { if (R.el) { R.el.pause(); R.el.srcObject = null; } } catch (e) { /* ignore */ }
  }

  // ---- speaking detection: LiveKit's server-side flag OR a local level meter (faster, and works
  // for voices the server's detector misses)
  var levelBuf = null;
  function meter(c, src) {
    try {
      var an = c.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      return an;
    } catch (e) { return null; }
  }
  function loud(an) {
    if (!an) return false;
    if (!levelBuf || levelBuf.length !== an.fftSize) levelBuf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(levelBuf);
    var sum = 0;
    for (var i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
    return Math.sqrt(sum / levelBuf.length) > TALK_LEVEL;
  }
  function localMicTrack() {
    var lp = S.room && S.room.localParticipant;
    if (!lp || !S.micOn) return null;
    try {
      var src = (LK().Track && LK().Track.Source && LK().Track.Source.Microphone) || 'microphone';
      var pub = lp.getTrackPublication ? lp.getTrackPublication(src) : null;
      return (pub && pub.track && pub.track.mediaStreamTrack) || null;
    } catch (e) { return null; }
  }
  function dropLocal() {
    var L = S.local;
    S.local = null;
    if (!L) return;
    try { L.src.disconnect(); } catch (e) { /* ignore */ }
  }
  function meterLocal(t) {
    var mst = localMicTrack(), c = S.ctx;
    if (!c || !mst) { if (S.local && !mst) dropLocal(); return; }
    if (!S.local || S.local.mst !== mst) {
      dropLocal();
      try {
        var src = c.createMediaStreamSource(new MediaStream([mst]));
        S.local = { mst: mst, src: src, an: meter(c, src), loud: 0 };
      } catch (e) { S.local = null; return; }
    }
    if (loud(S.local.an)) S.local.loud = t;
  }
  function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }

  function settingsFar() {
    var C = IS.CONFIG || {};
    var st = null;
    try { var s = IS.client && IS.client.state && IS.client.state(); st = s && s.hs && s.hs.st; } catch (e) { st = null; }
    var cvis = st && typeof st.cvis === 'number' && st.cvis > 0 ? st.cvis : 1;
    return (C.VISION || 300) * cvis;
  }
  function los(x0, y0, x1, y1) {
    var m = IS.map;
    if (!m || typeof m.lineOfSight !== 'function') return true;
    try { return !!m.lineOfSight(x0, y0, x1, y1); } catch (e) { return true; }
  }

  function mix(view) {
    var near = ((IS.CONFIG && IS.CONFIG.TILE) || 48) * 2;
    var opts = { near: near, far: Math.max(settingsFar(), near + 48), los: los };
    var c = S.ctx, at = c ? c.currentTime : 0, t0 = now();
    meterLocal(t0);
    S.remotes.forEach(function (R, peer) {
      if (R.an && loud(R.an)) R.loud = t0;
      var t = target(view, peer, opts);
      if (Math.abs(t.g - R.tg) > 0.004) {
        if (R.gain) {
          if (R.tg < 0) R.gain.gain.value = t.g; else R.gain.gain.setTargetAtTime(t.g, at, SMOOTH);
        } else if (R.el) R.el.volume = Math.max(0, Math.min(1, t.g));
        R.tg = t.g;
      }
      if (R.pan && Math.abs(t.p - R.tp) > 0.01) { R.pan.pan.setTargetAtTime(t.p, at, SMOOTH); R.tp = t.p; }
    });
  }

  // ------------------------------------------------------------------ room attach / detach
  function on(room, name, fn) {
    var e = ev(name);
    try { room.on(e, fn); S.handlers.push([e, fn]); } catch (x) { /* ignore */ }
  }
  function eachAudioPub(p, fn) {
    var pubs = p && (p.audioTrackPublications || p.trackPublications);
    if (!pubs || typeof pubs.forEach !== 'function') return;
    pubs.forEach(function (pub) { if (pub && pub.kind === 'audio' && pub.track) fn(pub); });
  }
  function attach(room, name) {
    S.room = room; S.name = name; S.micOn = false; S.micBusy = false; S.micErr = false;
    ensureCtx();
    on(room, 'TrackSubscribed', function (track, pub, participant) {
      if (S.room === room && track && track.kind === 'audio' && participant) addRemote(participant.identity, track);
    });
    on(room, 'TrackUnsubscribed', function (track, pub, participant) {
      if (S.room !== room || !participant) return;
      var R = S.remotes.get(participant.identity);
      if (R && R.track === track) removeRemote(participant.identity);
    });
    on(room, 'ParticipantDisconnected', function (participant) {
      if (S.room === room && participant) removeRemote(participant.identity);
    });
    try {
      room.remoteParticipants.forEach(function (p) {
        eachAudioPub(p, function (pub) { addRemote(p.identity, pub.track); });
      });
    } catch (e) { /* ignore */ }
    showDock(true);
    applyMic(); // re-enable the mic if it was on in the previous game
  }
  function detach() {
    var room = S.room;
    if (!room) return;
    for (var i = 0; i < S.handlers.length; i++) { try { room.off(S.handlers[i][0], S.handlers[i][1]); } catch (e) { /* ignore */ } }
    S.handlers = [];
    Array.from(S.remotes.keys()).forEach(removeRemote);
    if (S.micOn) {
      try {
        var lp = room.localParticipant;
        var p = lp && lp.setMicrophoneEnabled(false);
        if (p && p.catch) p.catch(noop);
      } catch (e) { /* ignore */ }
    }
    dropLocal();
    S.room = null; S.name = null; S.micOn = false; S.micBusy = false;
    S.keyHeld = false; S.ptrHeld = false;
    showDock(false);
  }

  // ------------------------------------------------------------------ microphone
  function desiredMic() { return !!S.room && (S.ptt ? (S.keyHeld || S.ptrHeld) : S.micWanted); }
  function micError(e) {
    var n = (e && e.name) || '';
    var msg;
    if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) msg = 'Voice chat needs HTTPS (or localhost) to use your microphone.';
    else if (n === 'NotAllowedError' || n === 'SecurityError' || /permission|denied/i.test((e && e.message) || '')) msg = 'Microphone blocked. Allow mic access for this site in your browser to talk.';
    else if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') msg = 'No microphone found. Plug one in to talk.';
    else if (n === 'NotReadableError' || n === 'TrackStartError') msg = 'Your microphone is busy in another app.';
    else msg = "Couldn't start your microphone.";
    toast(msg);
  }
  function applyMic() {
    renderDock();
    var room = S.room;
    if (!room || S.micBusy) return;
    var want = desiredMic();
    if (want === S.micOn) return;
    var lp = room.localParticipant;
    if (!lp || typeof lp.setMicrophoneEnabled !== 'function') return;
    if (want && !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      micError({ name: 'SecurityError' });
      S.micWanted = false; S.keyHeld = false; S.ptrHeld = false; S.micErr = true;
      renderDock();
      return;
    }
    S.micBusy = true;
    renderDock();
    var p;
    try { p = Promise.resolve(lp.setMicrophoneEnabled(want, AUDIO_OPTS)); } catch (e) { p = Promise.reject(e); }
    p.then(function () {
      if (S.room === room) { S.micOn = want; if (want) S.micErr = false; }
    }, function (e) {
      if (S.room !== room) return;
      if (want) {
        micError(e);
        S.micWanted = false; S.keyHeld = false; S.ptrHeld = false; S.micErr = true;
      }
    }).then(function () {
      if (S.room !== room) return;
      S.micBusy = false;
      applyMic();
    });
  }
  function setPtt(on) {
    S.ptt = !!on;
    try { window.localStorage.setItem(LS_PTT, S.ptt ? '1' : '0'); } catch (e) { /* ignore */ }
    S.keyHeld = false; S.ptrHeld = false;
    if (!S.ptt) S.micWanted = false;
    toast(S.ptt ? (isTouch() ? 'Push-to-talk: hold the mic button to talk' : 'Push-to-talk: hold T (or the mic button) to talk') : 'Open mic: tap the mic button to talk');
    applyMic();
  }

  window.addEventListener('keydown', function (e) {
    if (e.code !== 'KeyT' || !S.room || !S.ptt || e.repeat) return;
    if (IS.ui && IS.ui.isTyping && IS.ui.isTyping()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    S.keyHeld = true; applyMic();
  });
  window.addEventListener('keyup', function (e) {
    if (e.code !== 'KeyT' || !S.keyHeld) return;
    S.keyHeld = false; applyMic();
  });
  window.addEventListener('blur', function () {
    if (S.keyHeld || S.ptrHeld) { S.keyHeld = false; S.ptrHeld = false; applyMic(); }
  });

  // ------------------------------------------------------------------ widget
  var CSS = [
    '.vc-dock{position:fixed;left:calc(env(safe-area-inset-left,0px) + 12px);bottom:calc(env(safe-area-inset-bottom,0px) + 12px);z-index:55;',
    'display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:auto;touch-action:none;-webkit-user-select:none;user-select:none;',
    "font-family:'Russo One',system-ui,sans-serif}",
    'body.is-touch .vc-dock{left:calc(env(safe-area-inset-left,0px) + 68px);bottom:calc(env(safe-area-inset-bottom,0px) + 172px)}',
    '@media (max-height:520px){body.is-touch .vc-dock{left:calc(env(safe-area-inset-left,0px) + 172px);bottom:calc(env(safe-area-inset-bottom,0px) + 20px)}}',
    '.vc-dock[hidden]{display:none}',
    '.vc-mic{position:relative;width:52px;height:52px;border-radius:50%;border:3px solid #050814;cursor:pointer;display:grid;place-items:center;padding:0;',
    'background:radial-gradient(circle at 50% 30%,#3a4468,#151c33 75%);color:#9aa3c7;box-shadow:0 4px 0 #050814,inset 0 -4px 0 rgba(0,0,0,.35);',
    'transition:transform .08s,box-shadow .15s,background .15s;touch-action:none;-webkit-tap-highlight-color:transparent}',
    '.vc-mic svg{width:26px;height:26px;filter:drop-shadow(0 2px 0 rgba(0,0,0,.55))}',
    '.vc-mic:hover{filter:brightness(1.12)}',
    '.vc-mic:active{transform:translateY(3px);box-shadow:0 1px 0 #050814,inset 0 -2px 0 rgba(0,0,0,.35)}',
    '.vc-mic:focus-visible,.vc-mode:focus-visible{outline:3px solid #ffcc33;outline-offset:2px}',
    '.vc-dock.vc-on .vc-mic{background:radial-gradient(circle at 50% 30%,#4af08f,#15924a 80%);color:#04260f}',
    '.vc-dock.vc-ptt .vc-mic{background:radial-gradient(circle at 50% 30%,#ffd95a,#b88a00 80%);color:#2a1b00}',
    '.vc-dock.vc-ptt.vc-on .vc-mic{background:radial-gradient(circle at 50% 30%,#4af08f,#15924a 80%);color:#04260f}',
    '.vc-dock.vc-err .vc-mic{background:radial-gradient(circle at 50% 30%,#ff6b77,#a5121f 80%);color:#2b0005}',
    '.vc-dock.vc-busy .vc-mic{opacity:.7;cursor:progress}',
    '.vc-dock.vc-talk .vc-mic{box-shadow:0 4px 0 #050814,0 0 0 4px rgba(74,240,143,.55),0 0 18px 4px rgba(74,240,143,.55)}',
    '.vc-mode{min-width:52px;height:22px;padding:0 7px;border-radius:999px;border:2px solid #050814;background:#151c33;color:#9aa3c7;cursor:pointer;',
    "font:700 11px/1 'Russo One',system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;box-shadow:0 2px 0 #050814;touch-action:manipulation}",
    '.vc-dock.vc-ptt .vc-mode{background:#ffcc33;color:#2a1b00}',
    '.vc-tip{position:absolute;left:calc(100% + 8px);bottom:14px;white-space:nowrap;padding:4px 8px;border-radius:8px;background:rgba(5,8,20,.85);',
    'color:#e8ecff;font:400 12px/1.2 Rubik,system-ui,sans-serif;pointer-events:none;opacity:0;transition:opacity .15s}',
    '.vc-dock:hover .vc-tip{opacity:1}',
    'body.is-touch .vc-tip{display:none}',
    '.vc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
  ].join('\n');
  var ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  var ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/></svg>';

  function buildDock() {
    if (S.dock) return;
    var st = document.createElement('style');
    st.id = 'vc-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    var d = document.createElement('div');
    d.className = 'vc-dock';
    d.hidden = true;
    d.setAttribute('role', 'group');
    d.setAttribute('aria-label', 'Voice chat');
    d.innerHTML = '<button type="button" class="vc-mode" aria-pressed="false"></button>' +
      '<button type="button" class="vc-mic" aria-pressed="false"></button><span class="vc-tip" aria-hidden="true"></span>' +
      '<span class="vc-sr" aria-live="polite"></span>';
    document.body.appendChild(d);
    S.dock = d;
    S.mode = d.querySelector('.vc-mode');
    S.btn = d.querySelector('.vc-mic');
    S.tip = d.querySelector('.vc-tip');
    S.live = d.querySelector('.vc-sr');
    S.mode.addEventListener('click', function () { setPtt(!S.ptt); });
    S.btn.addEventListener('click', function () {
      if (S.ptt) return;
      S.micWanted = !S.micWanted;
      applyMic();
    });
    S.btn.addEventListener('pointerdown', function (e) {
      resume();
      if (!S.ptt) return;
      e.preventDefault();
      try { S.btn.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      S.ptrHeld = true; applyMic();
    });
    var up = function () { if (S.ptrHeld) { S.ptrHeld = false; applyMic(); } };
    S.btn.addEventListener('pointerup', up);
    S.btn.addEventListener('pointercancel', up);
    S.btn.addEventListener('lostpointercapture', up);
    S.btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // keyboard users: Space/Enter on the focused mic button acts like a hold in PTT mode
    S.btn.addEventListener('keydown', function (e) {
      if (!S.ptt || (e.key !== ' ' && e.key !== 'Enter') || e.repeat) return;
      e.preventDefault(); S.ptrHeld = true; applyMic();
    });
    S.btn.addEventListener('keyup', function (e) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); up(); }
    });
  }
  function showDock(on) {
    if (on) buildDock();
    if (S.dock) S.dock.hidden = !on;
    S.lastUi = '';
    renderDock();
  }
  function renderDock() {
    if (!S.dock || S.dock.hidden) return;
    var talking = S.micOn && localSpeaking();
    var touch = isTouch();
    var key = [S.ptt, S.micOn, S.micBusy, S.micErr, talking, touch].join();
    if (key === S.lastUi) return;
    S.lastUi = key;
    var d = S.dock;
    d.classList.toggle('vc-on', S.micOn);
    d.classList.toggle('vc-ptt', S.ptt);
    d.classList.toggle('vc-busy', S.micBusy);
    d.classList.toggle('vc-err', S.micErr && !S.micOn);
    d.classList.toggle('vc-talk', talking);
    S.btn.innerHTML = S.micOn ? ICON_ON : ICON_OFF;
    var label;
    if (S.ptt) label = S.micOn ? 'Talking…' : (touch ? 'Hold to talk' : 'Hold T to talk');
    else label = S.micOn ? 'Mic on: click to mute' : 'Mic off: click to talk';
    if (S.micBusy && !S.micOn) label = 'Starting microphone…';
    S.btn.setAttribute('aria-label', label);
    S.btn.setAttribute('aria-pressed', S.micOn ? 'true' : 'false');
    S.btn.title = label;
    S.tip.textContent = label;
    S.mode.textContent = S.ptt ? 'PTT' : 'Open';
    S.mode.setAttribute('aria-pressed', S.ptt ? 'true' : 'false');
    S.mode.setAttribute('aria-label', S.ptt ? 'Push-to-talk is on. Switch to open mic' : 'Open mic. Switch to push-to-talk');
    S.mode.title = S.ptt ? 'Push-to-talk (hold T). Click for open mic' : 'Open mic. Click for push-to-talk';
    S.live.textContent = S.micOn ? 'Microphone on' : 'Microphone off';
  }

  // ------------------------------------------------------------------ speaking
  function participant(peer) {
    var r = S.room;
    if (!r || !peer) return null;
    if (r.localParticipant && r.localParticipant.identity === peer) return r.localParticipant;
    var rp = r.remoteParticipants;
    if (!rp) return null;
    if (typeof rp.get === 'function') { var p = rp.get(peer); if (p) return p; }
    var found = null;
    if (typeof rp.forEach === 'function') rp.forEach(function (x) { if (x && x.identity === peer) found = x; });
    return found;
  }
  function localSpeaking() {
    var lp = S.room && S.room.localParticipant;
    if (!lp || !S.micOn) return false;
    return !!lp.isSpeaking || !!(S.local && now() - S.local.loud < TALK_HANG);
  }
  function isSpeaking(peer) {
    if (!S.room || !peer) return false;
    var lp = S.room.localParticipant;
    if (lp && lp.identity === peer) return localSpeaking();
    var R = S.remotes.get(peer);
    if (!R || R.tg <= 0.05) return false; // never reveal voices this player cannot hear
    if (now() - R.loud < TALK_HANG) return true;
    var p = participant(peer);
    return !!(p && p.isSpeaking);
  }

  // ------------------------------------------------------------------ per-frame entry point
  function update(view) {
    var room = null, name = null;
    if (enabled() && view && view.inGame && typeof view.code === 'string' && view.code) {
      name = ((IS.CONFIG && IS.CONFIG.ROOM_PREFIX) || 'ss-') + view.code.toLowerCase();
      room = IS.lkTransport.livekitRoom(name);
    }
    if (room !== S.room) {
      detach();
      if (room) attach(room, name);
    }
    if (!S.room) return;
    mix(view);
    renderDock();
  }

  IS.voice = {
    update: update,
    isSpeaking: isSpeaking,
    active: function () { return !!S.room; },
    micOn: function () { return S.micOn; },
    setMic: function (on) { S.micWanted = !!on; applyMic(); },
    setPushToTalk: setPtt,
    _target: target,
    _debug: function () {
      var out = {};
      S.remotes.forEach(function (R, peer) {
        out[peer] = { target: R.tg, pan: R.tp, gain: R.gain ? R.gain.gain.value : (R.el ? R.el.volume : 0), webaudio: !!R.gain };
      });
      return { room: S.name, ctx: S.ctx ? S.ctx.state : null, micOn: S.micOn, ptt: S.ptt, remotes: out };
    },
    // Diagnostics: peak level (0..1) of a remote voice before and after its gain node over `ms`.
    _probe: function (peer, ms) {
      var R = S.remotes.get(peer), c = S.ctx;
      if (!R || !R.src || !c) return Promise.resolve(null);
      var a = c.createAnalyser(), b = c.createAnalyser();
      a.fftSize = b.fftSize = 2048;
      R.src.connect(a); R.gain.connect(b);
      var buf = new Float32Array(2048), pre = 0, post = 0;
      return new Promise(function (resolve) {
        var t0 = Date.now();
        (function poll() {
          a.getFloatTimeDomainData(buf); for (var i = 0; i < buf.length; i++) pre = Math.max(pre, Math.abs(buf[i]));
          b.getFloatTimeDomainData(buf); for (i = 0; i < buf.length; i++) post = Math.max(post, Math.abs(buf[i]));
          if (Date.now() - t0 < (ms || 1500)) { setTimeout(poll, 20); return; }
          try { R.src.disconnect(a); R.gain.disconnect(b); } catch (e) { /* ignore */ }
          resolve({ pre: pre, post: post });
        })();
      });
    }
  };
})();
