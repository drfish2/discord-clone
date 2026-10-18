/* Starship Sus — task + sabotage-fix minigames (DOM overlay in #task-layer). See SPEC.md §4.5.
 *
 * IS.tasks.open(kind, {title, color?}, {onComplete, onClose}) -> {close(), setStatus(), isOpen()}
 * IS.tasks.openFix(kind, part, {onComplete, onHold, onClose}) -> {close(), setStatus(text), isOpen()}
 * IS.tasks.isOpen()
 * IS.tasks._debug — live internals of the open panel (for automated tests): {kind, state, toClient(x,y)}
 *
 * Every minigame draws onto one 500x440 logical canvas; the whole frame is scaled with a CSS
 * transform to fit the window (desktop and phones). Pointer events only (mouse + touch).
 */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});

  var W = 500, H = 440; // logical canvas size of every minigame
  var KINDS = ['wires', 'swipe', 'download', 'fuel', 'asteroids', 'align', 'calibrate', 'garbage', 'scan', 'divert', 'leaves', 'numbers'];
  var FIX_KINDS = ['reactor', 'o2', 'lights', 'comms'];
  var TITLES = {
    wires: 'Fix Wiring', swipe: 'Swipe Card', download: 'Download Data', fuel: 'Fuel Engines',
    asteroids: 'Clear Asteroids', align: 'Align Engine Output', calibrate: 'Calibrate Distributor',
    garbage: 'Empty Garbage', scan: 'Submit Scan', divert: 'Divert Power', leaves: 'Clean O2 Filter',
    numbers: 'Unlock Manifolds',
    reactor: 'Stop Reactor Meltdown', o2: 'Restore Oxygen', lights: 'Fix Lights', comms: 'Reset Communications'
  };
  var C = {
    navy: '#0b1020', panel: '#151c33', ink: '#e8ecff', amber: '#ffcc33', danger: '#ff3b4a',
    cyan: '#52e0ff', green: '#3ee86b', line: '#05070f', dim: '#8a93b8', metal: '#3a4569', metal2: '#262e4f'
  };

  // ------------------------------------------------------------------------------------------
  // helpers
  function fontD() { return (IS.assets && IS.assets.FONT_DISPLAY) || "'Russo One', system-ui, sans-serif"; }
  function fontB() { return (IS.assets && IS.assets.FONT_BODY) || "'Rubik', system-ui, sans-serif"; }
  function snd(k) { try { if (IS.audio && IS.audio.play) IS.audio.play(k); } catch (e) { /* ignore */ } }
  function call(fn, a) { if (typeof fn === 'function') { try { fn(a); } catch (e) { console.error(e); } } }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function angDiff(a, b) { var d = ((a - b) % 360 + 540) % 360 - 180; return d; } // degrees, (-180,180]
  function inRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function box(c, x, y, w, h, r, fill, lw, stroke) {
    rr(c, x, y, w, h, r);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (lw) { c.lineWidth = lw; c.strokeStyle = stroke || C.line; c.stroke(); }
  }
  function vgrad(c, y0, y1, a, b) { var g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
  function circle(c, x, y, r, fill, lw, stroke) {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (lw) { c.lineWidth = lw; c.strokeStyle = stroke || C.line; c.stroke(); }
  }
  function txt(c, s, x, y, size, color, align, opts) {
    opts = opts || {};
    c.font = (opts.weight || '') + ' ' + size + 'px ' + (opts.font || fontD());
    c.textAlign = align || 'center';
    c.textBaseline = opts.base || 'middle';
    if (opts.outline) { c.lineJoin = 'round'; c.lineWidth = opts.outline; c.strokeStyle = opts.outlineColor || C.line; c.strokeText(s, x, y); }
    c.fillStyle = color || C.ink;
    c.fillText(s, x, y);
  }
  function screw(c, x, y) {
    circle(c, x, y, 6, '#8792b5', 2, C.line);
    c.beginPath(); c.moveTo(x - 3.5, y - 3.5); c.lineTo(x + 3.5, y + 3.5);
    c.lineWidth = 2; c.strokeStyle = '#3a4466'; c.stroke();
  }
  // Brushed metal background filling the canvas, with corner screws.
  function metalBg(c, top, bot) {
    c.fillStyle = vgrad(c, 0, H, top || '#3b4670', bot || '#252d4e');
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.06; c.fillStyle = '#fff';
    for (var i = 0; i < H; i += 6) c.fillRect(0, i, W, 2);
    c.globalAlpha = 1;
    screw(c, 14, 14); screw(c, W - 14, 14); screw(c, 14, H - 14); screw(c, W - 14, H - 14);
  }
  // Recessed dark glass screen.
  function screen(c, x, y, w, h, tint, r) {
    box(c, x - 4, y - 4, w + 8, h + 8, (r || 12) + 4, '#1a2040', 4, C.line);
    box(c, x, y, w, h, r || 12, tint || '#07131c', 3, C.line);
    c.save(); rr(c, x, y, w, h, r || 12); c.clip();
    c.globalAlpha = 0.07; c.fillStyle = '#fff';
    for (var i = y; i < y + h; i += 4) c.fillRect(x, i, w, 1);
    c.globalAlpha = 0.08;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + w * 0.45, y); c.lineTo(x + w * 0.2, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
    c.restore(); c.globalAlpha = 1;
  }
  // Chunky cartoon button. b = {x,y,w,h}
  function button(c, b, label, opts) {
    opts = opts || {};
    var col = opts.color || C.amber, dark = opts.dark || '#b07d00';
    var press = opts.pressed ? 5 : 0;
    if (opts.disabled) { col = '#59617f'; dark = '#3a405a'; }
    box(c, b.x, b.y + 6, b.w, b.h, opts.r || 14, C.line);
    box(c, b.x, b.y + press, b.w, b.h, opts.r || 14, dark, 4, C.line);
    box(c, b.x + 4, b.y + press + 2, b.w - 8, b.h - 10, (opts.r || 14) - 3, col);
    c.globalAlpha = 0.35; box(c, b.x + 10, b.y + press + 6, b.w - 20, 6, 3, '#fff'); c.globalAlpha = 1;
    if (label) txt(c, label, b.x + b.w / 2, b.y + press + b.h / 2 - 2, opts.size || 22, opts.textColor || (opts.disabled ? '#9aa1bd' : '#2a1d00'), 'center');
  }
  function lamp(c, x, y, r, on, col) {
    if (on) { c.save(); c.shadowColor = col; c.shadowBlur = 16; circle(c, x, y, r, col); c.restore(); }
    circle(c, x, y, r, on ? col : '#2a2f45', 3, C.line);
    c.globalAlpha = on ? 0.6 : 0.2; circle(c, x - r * 0.3, y - r * 0.3, r * 0.3, '#fff'); c.globalAlpha = 1;
  }
  function wrapLines(c, s, maxW) {
    var words = String(s).split(/\s+/), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var tryL = line ? line + ' ' + words[i] : words[i];
      if (c.measureText(tryL).width > maxW && line) { lines.push(line); line = words[i]; } else line = tryL;
    }
    if (line) lines.push(line);
    return lines;
  }
  // Crewmate: use the renderer's when present, otherwise a simple bean. (x,y) = feet.
  function crewmate(c, x, y, ci, s) {
    if (IS.render && IS.render.drawCrewmate) {
      try { c.save(); IS.render.drawCrewmate(c, x, y, ci, { scale: s, facing: 1 }); c.restore(); return; } catch (e) { c.restore(); }
    }
    var cols = (IS.CONFIG && IS.CONFIG.COLORS) || [['Red', '#c51111', '#7a0838']];
    var col = cols[(((ci | 0) % cols.length) + cols.length) % cols.length];
    c.save(); c.translate(x, y); c.scale(s, s);
    c.lineJoin = 'round';
    box(c, -24, -44, 12, 26, 5, col[2], 3.5);           // backpack
    box(c, -15, -16, 13, 16, 5, col[2], 3.5);           // back leg
    rr(c, -16, -58, 32, 50, 15); c.fillStyle = col[1]; c.fill(); c.lineWidth = 3.5; c.strokeStyle = C.line; c.stroke();
    box(c, 2, -16, 14, 16, 5, col[1], 3.5);             // front leg
    box(c, -2, -48, 22, 15, 7, '#9fd8ee', 3.5);          // visor
    box(c, 4, -45, 9, 4, 2, '#e9fbff');
    c.restore();
  }

  // ------------------------------------------------------------------------------------------
  // CSS
  var cssDone = false;
  function injectCSS() {
    if (cssDone) return;
    cssDone = true;
    var css = [
      '.tk-overlay{position:fixed;left:0;top:0;right:0;bottom:0;z-index:1000;background:rgba(3,6,16,.62);touch-action:none;',
      '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;animation:tk-fade .16s ease-out;pointer-events:auto}',
      '.tk-frame{position:absolute;left:50%;top:50%;box-sizing:border-box;padding:0 10px 10px;border-radius:24px;',
      'background:linear-gradient(#323d66,#1b2142);border:4px solid #05070f;',
      'box-shadow:inset 0 0 0 3px #4a5788,inset 0 -6px 0 rgba(0,0,0,.3),0 10px 0 #05070f,0 22px 50px rgba(0,0,0,.6);',
      'transform-origin:50% 50%;animation:tk-in .22s cubic-bezier(.2,1.4,.4,1)}',
      '.tk-head{height:58px;display:flex;align-items:center;gap:10px;padding:0 2px 0 8px}',
      '.tk-title{flex:1;min-width:0;font-size:21px;line-height:1;color:#ffcc33;text-transform:uppercase;letter-spacing:.5px;',
      'text-shadow:0 3px 0 #05070f,2px 0 0 #05070f,-2px 0 0 #05070f,0 -2px 0 #05070f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tk-sub{font-size:12px;color:#8a93b8;letter-spacing:1px;text-shadow:none;margin-top:4px;display:block}',
      '.tk-close{flex:0 0 auto;width:44px;height:44px;border-radius:13px;border:4px solid #05070f;background:#ff3b4a;color:#fff;',
      'font-size:22px;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;',
      'box-shadow:0 5px 0 #05070f,inset 0 -5px 0 rgba(0,0,0,.25),inset 0 3px 0 rgba(255,255,255,.3);touch-action:manipulation}',
      '.tk-close:hover{background:#ff5a67}.tk-close:active{transform:translateY(4px);box-shadow:0 1px 0 #05070f,inset 0 -3px 0 rgba(0,0,0,.25)}',
      '.tk-close svg{width:20px;height:20px;display:block}',
      '.tk-body{position:relative;width:500px;height:440px;border:4px solid #05070f;border-radius:16px;overflow:hidden;background:#0b1020;',
      'box-shadow:0 0 0 2px #4a5788}',
      '.tk-body canvas{display:block;width:500px;height:440px;touch-action:none;cursor:pointer}',
      '.tk-done{position:absolute;left:0;top:0;right:0;bottom:0;display:none;align-items:center;justify-content:center;flex-direction:column;',
      'pointer-events:none;background:radial-gradient(circle,rgba(62,232,107,.35),rgba(11,16,32,.55) 70%)}',
      '.tk-done.on{display:flex;animation:tk-fade .2s ease-out}',
      '.tk-done b{font-weight:normal;font-size:44px;max-width:470px;color:#ffcc33;text-transform:uppercase;text-align:center;line-height:1.05;',
      '-webkit-text-stroke:3px #05070f;paint-order:stroke fill;text-shadow:0 6px 0 #05070f;animation:tk-pop .5s cubic-bezier(.2,1.7,.4,1)}',
      '.tk-done i{display:block;width:84px;height:84px;margin-bottom:10px;border-radius:50%;background:#3ee86b;border:5px solid #05070f;',
      'box-shadow:0 6px 0 #05070f;animation:tk-pop .4s cubic-bezier(.2,1.7,.4,1)}',
      '.tk-done i:after{content:"";display:block;width:22px;height:40px;margin:12px 0 0 29px;border:solid #05070f;border-width:0 9px 9px 0;transform:rotate(42deg)}',
      '@keyframes tk-fade{from{opacity:0}to{opacity:1}}',
      '@keyframes tk-in{from{opacity:0;margin-top:30px}to{opacity:1;margin-top:0}}',
      '@keyframes tk-pop{0%{transform:scale(.2) rotate(-8deg);opacity:0}100%{transform:scale(1) rotate(0);opacity:1}}',
      '@keyframes tk-shake{0%,100%{margin-left:0}20%{margin-left:-10px}40%{margin-left:9px}60%{margin-left:-6px}80%{margin-left:4px}}',
      '.tk-shake{animation:tk-shake .35s}'
    ].join('');
    var s = document.createElement('style');
    s.id = 'tk-style';
    s.textContent = css;
    (document.head || document.body).appendChild(s);
  }

  function getLayer() {
    var l = document.getElementById('task-layer');
    if (!l) { l = document.createElement('div'); l.id = 'task-layer'; document.body.appendChild(l); }
    return l;
  }

  // ------------------------------------------------------------------------------------------
  // Panel framework
  var cur = null; // the open panel

  function listen(P, target, type, fn, opts) {
    target.addEventListener(type, fn, opts || false);
    P.unsub.push(function () { target.removeEventListener(type, fn, opts || false); });
  }

  function teardown(P) {
    if (P.closed) return;
    P.closed = true;
    if (P.raf) cancelAnimationFrame(P.raf);
    for (var i = 0; i < P.timers.length; i++) clearTimeout(P.timers[i]);
    P.timers.length = 0;
    for (var j = 0; j < P.unsub.length; j++) { try { P.unsub[j](); } catch (e) { /* ignore */ } }
    P.unsub.length = 0;
    if (P.g && P.g.onTeardown) { try { P.g.onTeardown(); } catch (e) { console.error(e); } }
    if (P.root && P.root.parentNode) P.root.parentNode.removeChild(P.root);
    if (cur === P) cur = null;
    if (IS.tasks && IS.tasks._debug && IS.tasks._debug.panel === P) IS.tasks._debug = { kind: null, state: null, panel: null, toClient: function () { return null; } };
  }

  // Close a panel: completed panels finish with onComplete, all others call onClose.
  function closePanel(P) {
    if (!P || P.closed) return;
    if (P.done) { finish(P); return; }
    teardown(P);
    call(P.cbs.onClose);
  }
  function finish(P) {
    if (P.closed) return;
    teardown(P);
    call(P.cbs.onComplete);
  }

  function computeScale(frame) {
    var vw = window.innerWidth || 800, vh = window.innerHeight || 600;
    var fw = frame.offsetWidth || 528, fh = frame.offsetHeight || 520;
    return Math.max(0.3, Math.min((vw - 12) / fw, (vh - 12) / fh, 1.3));
  }

  function mount(kind, title, sub, cbs, builder, opts) {
    if (cur) closePanel(cur);
    injectCSS();
    cbs = cbs || {};
    opts = opts || {};
    var P = { kind: kind, cbs: cbs, closed: false, done: false, timers: [], unsub: [], raf: 0, active: null };

    var ov = el('div', 'tk-overlay');
    ov.setAttribute('data-kind', kind);
    var fr = el('div', 'tk-frame');
    var head = el('div', 'tk-head');
    var tt = el('div', 'tk-title', title);
    tt.style.fontFamily = fontD();
    if (sub) { var sb = el('span', 'tk-sub', sub); sb.style.fontFamily = fontB(); tt.appendChild(sb); }
    var xb = el('button', 'tk-close');
    xb.type = 'button';
    xb.setAttribute('aria-label', 'Close');
    xb.innerHTML = '<svg viewBox="0 0 20 20"><path d="M4 4L16 16M16 4L4 16" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/></svg>';
    head.appendChild(tt); head.appendChild(xb);
    var body = el('div', 'tk-body');
    var cv = el('canvas');
    body.appendChild(cv);
    var done = el('div', 'tk-done');
    var doneTxt = el('b', null, opts.doneText || 'Task Complete!');
    doneTxt.style.fontFamily = fontD();
    done.appendChild(el('i')); done.appendChild(doneTxt);
    body.appendChild(done);
    fr.appendChild(head); fr.appendChild(body);
    ov.appendChild(fr);
    getLayer().appendChild(ov);
    P.root = ov;

    var c = cv.getContext('2d');
    var scale = 1;
    function layout() {
      scale = computeScale(fr);
      fr.style.transform = 'translate(-50%,-50%) scale(' + scale + ')';
      var k = Math.min(3, (window.devicePixelRatio || 1) * scale);
      cv.width = Math.round(W * k); cv.height = Math.round(H * k);
      c.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
    }
    layout();

    var g = {
      W: W, H: H, c: c, cv: cv, body: body, frame: fr, P: P, dbg: {}, t: 0, done: false, ptr: null,
      opts: opts,
      step: function () { snd('task_step'); },
      sound: snd,
      after: function (ms, fn) { var id = setTimeout(function () { if (!P.closed) fn(); }, ms); P.timers.push(id); return id; },
      shake: function () {
        fr.classList.remove('tk-shake'); void fr.offsetWidth; fr.classList.add('tk-shake');
      },
      complete: function () {
        if (P.done || P.closed) return;
        P.done = g.done = true;
        snd('task');
        done.classList.add('on');
        g.after(opts.doneDelay || 800, function () { finish(P); });
      }
    };
    P.g = g;

    function pt(e) {
      var r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * W / (r.width || W), y: (e.clientY - r.top) * H / (r.height || H), id: e.pointerId };
    }
    listen(P, cv, 'pointerdown', function (e) {
      e.preventDefault();
      if (g.done) return;
      var p = pt(e);
      g.ptr = p;
      if (P.active == null) {
        P.active = e.pointerId;
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      if (g.onDown) g.onDown(p, e);
    });
    listen(P, cv, 'pointermove', function (e) {
      var p = pt(e);
      g.ptr = p;
      if (e.pointerId !== P.active || g.done) return;
      if (g.onMove) g.onMove(p, e);
    });
    function up(e) {
      if (e.pointerId !== P.active) return;
      P.active = null;
      if (g.onUp) g.onUp(pt(e), e, e.type !== 'pointerup');
    }
    listen(P, cv, 'pointerup', up);
    listen(P, cv, 'pointercancel', up);
    listen(P, cv, 'lostpointercapture', up);
    listen(P, cv, 'pointerleave', function (e) { if (e.pointerType === 'mouse' && P.active == null) g.ptr = null; });
    listen(P, cv, 'contextmenu', function (e) { e.preventDefault(); });
    listen(P, ov, 'touchmove', function (e) { e.preventDefault(); }, { passive: false });

    listen(P, xb, 'click', function (e) { e.preventDefault(); e.stopPropagation(); snd('click'); closePanel(P); });
    listen(P, xb, 'pointerdown', function (e) { e.stopPropagation(); });
    listen(P, window, 'keydown', function (e) {
      if (P.closed) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault(); e.stopPropagation();
        closePanel(P);
        return;
      }
      if (g.onKey && !g.done && g.onKey(e)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    listen(P, window, 'resize', layout);

    builder(g);

    var last = now(), t0 = last;
    function frame() {
      if (P.closed) return;
      var tn = now();
      var dt = Math.min(0.05, Math.max(0, (tn - last) / 1000));
      last = tn;
      g.t = (tn - t0) / 1000;
      try {
        if (g.update && !g.done) g.update(dt, g.t);
        c.save();
        g.draw(c, g.t, dt);
        c.restore();
      } catch (err) { console.error(err); }
      P.raf = requestAnimationFrame(frame);
    }
    frame();

    cur = P;
    IS.tasks._debug = {
      kind: kind, panel: P, state: g.dbg, scale: function () { return scale; },
      toClient: function (x, y) {
        var r = cv.getBoundingClientRect();
        return { x: r.left + x * r.width / W, y: r.top + y * r.height / H };
      }
    };
    P.ctrl = {
      kind: kind,
      close: function () { closePanel(P); },
      setStatus: function (s) { if (g.setStatus) g.setStatus(s); },
      isOpen: function () { return !P.closed; }
    };
    return P.ctrl;
  }

  // ------------------------------------------------------------------------------------------
  // Minigames. Each builder(g) sets g.draw(c,t,dt) and optional g.update/onDown/onMove/onUp/onKey.
  var B = {};

  // ---- wires ----------------------------------------------------------------------------------
  B.wires = function (g) {
    var COLS = [['#ff3b3b', '#9a0f1a', '#ffb0a8'], ['#3b7bff', '#11308f', '#b8d0ff'], ['#ffd93b', '#a37a00', '#fff3b0'], ['#ff5ce1', '#97207f', '#ffc6f3']];
    var ys = [92, 180, 268, 356];
    var LX = 92, RX = 408;
    var left = shuffle([0, 1, 2, 3]);
    var right = shuffle([0, 1, 2, 3]);
    var conTo = [-1, -1, -1, -1]; // left slot -> right slot
    var flash = [0, 0, 0, 0];      // right lamp flash timers
    var drag = null;
    g.dbg.pairs = left.map(function (col) { return right.indexOf(col); });
    g.dbg.leftPts = ys.map(function (y) { return { x: LX - 10, y: y }; });
    g.dbg.rightPts = ys.map(function (y) { return { x: RX + 4, y: y }; });
    g.dbg.connected = conTo;

    function wire(c, x1, y1, x2, y2, col) {
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
      c.lineWidth = 20; c.strokeStyle = C.line; c.stroke();
      c.lineWidth = 13; c.strokeStyle = col[0]; c.stroke();
      c.beginPath(); c.moveTo(x1, y1 - 3); c.lineTo(x2, y2 - 3);
      c.lineWidth = 3; c.strokeStyle = col[2]; c.globalAlpha = 0.7; c.stroke(); c.globalAlpha = 1;
    }
    function plug(c, x, y, col, side) {
      // side -1: plug on left rail facing right; 1: socket on right rail facing left
      box(c, x - 16, y - 17, 32, 34, 7, col[0], 4);
      box(c, x - 10, y - 11, 20, 8, 3, col[2]);
      c.globalAlpha = 0.25; box(c, x - 12, y + 4, 24, 8, 3, '#000'); c.globalAlpha = 1;
      if (side < 0) box(c, x + 14, y - 7, 14, 14, 3, '#c9cfdf', 3); // metal tip
    }
    function connectAt(i, p, radius) {
      for (var j = 0; j < 4; j++) {
        if (right[j] !== left[i]) continue;
        if (conTo.indexOf(j) >= 0) continue;
        if (dist(p.x, p.y, RX, ys[j]) < radius) {
          conTo[i] = j; flash[j] = 1; drag = null; g.step();
          if (conTo.every(function (v) { return v >= 0; })) g.after(150, g.complete);
          return true;
        }
      }
      return false;
    }
    g.onDown = function (p) {
      if (drag) return;
      for (var i = 0; i < 4; i++) {
        if (conTo[i] >= 0) continue;
        if (p.x < LX + 40 && Math.abs(p.y - ys[i]) < 32) { drag = { i: i, x: p.x, y: p.y }; g.sound('click'); return; }
      }
    };
    g.onMove = function (p) {
      if (!drag) return;
      drag.x = clamp(p.x, LX, RX + 10); drag.y = clamp(p.y, 20, H - 20);
      connectAt(drag.i, drag, 20);
    };
    g.onUp = function (p) {
      if (!drag) return;
      if (!connectAt(drag.i, { x: clamp(p.x, 0, W), y: p.y }, 46)) drag = null;
    };
    g.update = function (dt) { for (var j = 0; j < 4; j++) flash[j] = Math.max(0, flash[j] - dt * 2); };
    g.draw = function (c, t) {
      metalBg(c, '#2f3860', '#1f2646');
      // inner cavity
      box(c, 70, 24, 360, 392, 16, '#121731', 4);
      c.save(); rr(c, 70, 24, 360, 392, 16); c.clip();
      c.globalAlpha = 0.08; c.strokeStyle = '#8fb0ff'; c.lineWidth = 1;
      for (var gx = 70; gx < 430; gx += 24) { c.beginPath(); c.moveTo(gx, 24); c.lineTo(gx, 416); c.stroke(); }
      for (var gy = 24; gy < 416; gy += 24) { c.beginPath(); c.moveTo(70, gy); c.lineTo(430, gy); c.stroke(); }
      c.globalAlpha = 1; c.restore();
      // rails
      box(c, 10, 40, 56, 360, 10, '#4b5684', 4);
      box(c, W - 66, 40, 56, 360, 10, '#4b5684', 4);
      for (var k = 0; k < 4; k++) {
        var cl = COLS[left[k]], cr = COLS[right[k]];
        // wire stubs out of the walls
        wire(c, -10, ys[k], LX - 14, ys[k], cl);
        wire(c, RX + 14, ys[k], W + 10, ys[k], cr);
      }
      // connected wires
      for (var i = 0; i < 4; i++) if (conTo[i] >= 0) wire(c, LX + 20, ys[i], RX - 14, ys[conTo[i]], COLS[left[i]]);
      if (drag) wire(c, LX + 20, ys[drag.i], drag.x, drag.y, COLS[left[drag.i]]);
      for (var m = 0; m < 4; m++) {
        var lx = LX - 2, isDrag = drag && drag.i === m;
        if (!isDrag && conTo[m] < 0) plug(c, lx, ys[m], COLS[left[m]], -1);
        else plug(c, lx, ys[m], COLS[left[m]], 0);
        plug(c, RX + 2, ys[m], COLS[right[m]], 1);
        var on = conTo.indexOf(m) >= 0;
        box(c, W - 40, ys[m] - 14, 26, 28, 7, '#2a3050', 3);
        lamp(c, W - 27, ys[m], 7, on, '#ffe066');
      }
      if (drag) { circle(c, drag.x, drag.y, 9, '#c9cfdf', 4); }
      // hint
      if (!drag && conTo.every(function (v) { return v < 0; })) {
        c.globalAlpha = 0.55 + 0.35 * Math.sin(t * 4);
        txt(c, 'DRAG WIRES TO MATCHING COLOURS', W / 2, H - 6 - 34, 15, C.ink, 'center', { outline: 4 });
        c.globalAlpha = 1;
      }
    };
  };

  // ---- swipe ----------------------------------------------------------------------------------
  B.swipe = function (g) {
    var CW = 172, CH = 108, START = 44, END = 284, TRACKY = 150;
    var WALLET = { x: 164, y: 316 };
    var card = { x: WALLET.x, y: WALLET.y - 46 };
    var state = 'wallet', msg = 'PLEASE INSERT CARD', msgCol = C.green, msgErr = 0;
    var drag = null, anim = 0, ledG = 0;
    g.dbg = { card: card, CW: CW, CH: CH, START: START, END: END, wallet: { x: WALLET.x + CW / 2, y: WALLET.y + 10 }, state: state, msg: msg };
    function setMsg(m, err) { msg = m; msgCol = err ? '#ff6b6b' : C.green; msgErr = err ? 1 : 0; g.dbg.msg = m; }
    function setState(s) { state = s; g.dbg.state = s; }
    g.onDown = function (p) {
      if (state === 'wallet') {
        if (p.y > 230) { setState('insert'); anim = 0; g.step(); }
        return;
      }
      if (state === 'ready' && inRect(p, { x: card.x - 10, y: card.y - 10, w: CW + 20, h: CH + 40 })) {
        drag = { ox: p.x - card.x, t0: 0 };
        setState('drag');
      }
    };
    g.onMove = function (p) {
      if (state !== 'drag' || !drag) return;
      var nx = clamp(p.x - drag.ox, START, END);
      if (!drag.t0 && nx > START + 3) drag.t0 = now();
      card.x = nx;
      if (nx >= END - 0.5) {
        var dur = drag.t0 ? (now() - drag.t0) / 1000 : 0;
        g.dbg.lastDur = dur;
        drag = null;
        if (dur < 0.4) { setMsg('TOO FAST. TRY AGAIN.', true); setState('return'); g.sound('click'); }
        else if (dur > 1.2) { setMsg('TOO SLOW. TRY AGAIN.', true); setState('return'); g.sound('click'); }
        else { setMsg('ACCEPTED. THANK YOU.'); setState('ok'); ledG = 1; g.complete(); }
      }
    };
    g.onUp = function () {
      if (state !== 'drag') return;
      drag = null;
      if (card.x > START + 12) { setMsg('BAD READ. TRY AGAIN.', true); g.sound('click'); }
      setState('return');
    };
    g.update = function (dt) {
      msgErr = Math.max(0, msgErr - dt);
      if (state === 'insert') {
        anim = Math.min(1, anim + dt / 0.45);
        var e = 1 - Math.pow(1 - anim, 3);
        card.x = lerp(WALLET.x, START, e); card.y = lerp(WALLET.y - 46, TRACKY, e);
        if (anim >= 1) { setState('ready'); setMsg('PLEASE SWIPE CARD'); }
      } else if (state === 'return') {
        card.x = lerp(card.x, START, Math.min(1, dt * 12));
        if (Math.abs(card.x - START) < 1) { card.x = START; setState('ready'); }
      }
    };
    function drawCard(c, x, y) {
      box(c, x, y, CW, CH, 12, '#f2f6ff', 4);
      box(c, x + 4, y + 4, CW - 8, 24, 8, '#52b8e6');
      txt(c, 'CREW  ID', x + CW / 2, y + 17, 15, '#06304a');
      box(c, x + 12, y + 38, 54, 58, 8, '#bfe7f7', 3);
      crewmate(c, x + 37, y + 92, (g.opts.color | 0), 0.75);
      for (var i = 0; i < 9; i++) box(c, x + 78 + i * 9, y + 42, 4 + (i % 3), 30, 1, '#22283e');
      box(c, x + 78, y + 80, 80, 7, 3, '#9aa6c4'); box(c, x + 78, y + 91, 54, 7, 3, '#9aa6c4');
    }
    g.draw = function (c, t) {
      metalBg(c, '#2b3359', '#1b2140');
      // reader
      box(c, 18, 18, W - 36, 238, 20, vgrad(c, 18, 256, '#5a6797', '#39436d'), 4);
      screen(c, 52, 40, 330, 54, '#06150e', 8);
      var flick = msgErr > 0 && Math.floor(msgErr * 10) % 2 === 0;
      if (!flick) txt(c, msg, 217, 68, 21, msgCol, 'center', { font: "'Courier New', monospace", weight: 'bold' });
      lamp(c, 412, 66, 11, state !== 'ok' && (msgCol !== C.green || Math.sin(t * 6) > 0), '#ff3b3b');
      lamp(c, 446, 66, 11, state === 'ok', C.green);
      // slot
      box(c, 30, 124, W - 60, 22, 8, '#0b0e1c', 4);
      if (state !== 'wallet' && state !== 'insert') {
        // swipe direction arrows
        c.globalAlpha = 0.3 + 0.2 * Math.sin(t * 5);
        for (var a = 0; a < 3; a++) txt(c, '›', 330 + a * 36, 200, 64, C.cyan);
        c.globalAlpha = 1;
      }
      var inReader = state !== 'wallet' && state !== 'insert';
      if (inReader) drawCard(c, card.x, card.y);
      // front lip of the reader over the top of the card
      box(c, 22, 112, W - 44, 26, 10, vgrad(c, 112, 138, '#6b79ad', '#4a5584'), 4);
      for (var s = 0; s < 5; s++) box(c, 60 + s * 80, 120, 40, 6, 3, '#39436d');
      // wallet
      if (!inReader) {
        if (state === 'insert') drawCard(c, card.x, card.y);
        else drawCard(c, card.x, card.y);
      }
      box(c, 110, 330, 280, 130, 18, '#7a4a22', 4);
      box(c, 110, 330, 280, 30, 12, '#8f5a2c', 4);
      c.setLineDash([8, 6]); box(c, 122, 342, 256, 120, 10, null, 2, '#c99a60'); c.setLineDash([]);
      if (state === 'wallet') {
        c.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5);
        txt(c, 'TAP THE WALLET', 250, 400, 20, C.amber, 'center', { outline: 5 });
        c.globalAlpha = 1;
      }
    };
  };

  // ---- download -------------------------------------------------------------------------------
  B.download = function (g) {
    var DUR = 5;
    var state = 'idle', prog = 0, pressed = false, files = [], spawn = 0;
    var BTN = { x: 150, y: 336, w: 200, h: 62 };
    var A = { x: 105, y: 128 }, Bp = { x: 395, y: 128 };
    g.dbg = { button: { x: BTN.x + BTN.w / 2, y: BTN.y + BTN.h / 2 }, state: state };
    function fmt(sec) {
      sec = Math.max(0, Math.ceil(sec));
      var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
      if (d) return d + 'd ' + h + 'hr ' + m + 'm ' + s + 's';
      if (h) return h + 'hr ' + m + 'm ' + s + 's';
      if (m) return m + 'm ' + s + 's';
      return s + 's';
    }
    g.onDown = function (p) {
      if (state === 'idle' && inRect(p, BTN)) pressed = true;
    };
    g.onUp = function (p) {
      if (pressed && state === 'idle' && inRect(p, BTN)) { state = 'run'; g.dbg.state = state; g.step(); }
      pressed = false;
    };
    g.update = function (dt) {
      if (state === 'run') {
        prog = Math.min(1, prog + dt / DUR);
        g.dbg.prog = prog;
        spawn -= dt;
        if (spawn <= 0) { spawn = 0.16; files.push({ t: 0, r: rnd(-0.4, 0.4), h: rnd(40, 90), c: ['#ffcc33', '#52e0ff', '#ff8ad8', '#8cff9e'][Math.floor(Math.random() * 4)] }); }
        if (prog >= 1) { state = 'done'; g.dbg.state = state; g.complete(); }
      }
      for (var i = files.length - 1; i >= 0; i--) { files[i].t += dt / 0.9; if (files[i].t >= 1) files.splice(i, 1); }
    };
    function folder(c, x, y, label, open) {
      box(c, x - 52, y - 40, 44, 16, 6, '#d99a1e', 4);
      box(c, x - 56, y - 30, 112, 78, 10, '#f0b52c', 4);
      if (open) { box(c, x - 56, y - 8, 112, 56, 10, '#ffd15c', 4); }
      txt(c, label, x, y + 72, 15, C.ink, 'center', { outline: 4 });
    }
    function server(c, x, y, label, t) {
      box(c, x - 46, y - 46, 92, 100, 10, '#4a5582', 4);
      for (var i = 0; i < 3; i++) {
        box(c, x - 38, y - 38 + i * 30, 76, 24, 6, '#252c4a', 3);
        lamp(c, x + 24, y - 26 + i * 30, 4, state === 'run' ? Math.sin(t * 20 + i * 2) > 0 : true, state === 'run' ? C.green : '#5f7');
        box(c, x - 30, y - 30 + i * 30, 36, 6, 3, '#6b77a8');
      }
      txt(c, label, x, y + 72, 15, C.ink, 'center', { outline: 4 });
    }
    function fileIcon(c, x, y, rot, col) {
      c.save(); c.translate(x, y); c.rotate(rot);
      c.beginPath(); c.moveTo(-12, -16); c.lineTo(5, -16); c.lineTo(12, -9); c.lineTo(12, 16); c.lineTo(-12, 16); c.closePath();
      c.fillStyle = '#f4f7ff'; c.fill(); c.lineWidth = 3; c.strokeStyle = C.line; c.stroke();
      box(c, -7, -6, 14, 3, 1, col); box(c, -7, 1, 14, 3, 1, col); box(c, -7, 8, 9, 3, 1, col);
      c.restore();
    }
    g.draw = function (c, t) {
      metalBg(c, '#2b3359', '#1b2140');
      screen(c, 26, 26, W - 52, 270, '#081426', 14);
      server(c, A.x, A.y, 'STATION DATA', t);
      folder(c, Bp.x, Bp.y, 'MY TABLET', state !== 'idle');
      // dashed path
      c.setLineDash([6, 8]); c.lineDashOffset = -t * 30;
      c.beginPath(); c.moveTo(A.x + 56, A.y - 10); c.quadraticCurveTo(250, 20, Bp.x - 62, Bp.y - 10);
      c.lineWidth = 3; c.strokeStyle = 'rgba(82,224,255,.35)'; c.stroke(); c.setLineDash([]);
      for (var i = 0; i < files.length; i++) {
        var f = files[i], u = f.t;
        var x = lerp(A.x + 40, Bp.x - 30, u), y = lerp(A.y, Bp.y, u) - Math.sin(u * Math.PI) * f.h;
        c.globalAlpha = Math.min(1, (1 - u) * 5, u * 8);
        fileIcon(c, x, y, f.r + u * 2 * f.r, f.c);
        c.globalAlpha = 1;
      }
      // progress bar
      box(c, 50, 228, 400, 34, 10, '#11182e', 4);
      if (prog > 0) {
        c.save(); rr(c, 54, 232, 392, 26, 7); c.clip();
        c.fillStyle = vgrad(c, 232, 258, '#7dff9a', '#22b04a');
        c.fillRect(54, 232, 392 * prog, 26);
        c.globalAlpha = 0.25; c.fillStyle = '#fff';
        for (var s = -40; s < 392 * prog; s += 24) { c.beginPath(); c.moveTo(54 + s + ((t * 40) % 24), 258); c.lineTo(66 + s + ((t * 40) % 24), 232); c.lineTo(78 + s + ((t * 40) % 24), 232); c.lineTo(66 + s + ((t * 40) % 24), 258); c.fill(); }
        c.restore(); c.globalAlpha = 1;
      }
      txt(c, Math.floor(prog * 100) + '%', 250, 245, 18, '#fff', 'center', { outline: 4 });
      var eta;
      if (state === 'idle') eta = 'Ready to download';
      else if (state === 'done') eta = 'Download complete';
      else {
        var rem = DUR * (1 - prog);
        var silly = prog < 0.3 ? Math.pow(1 - prog / 0.3, 3) * 340000 : 0;
        eta = 'Estimated Time: ' + fmt(rem + silly);
      }
      txt(c, eta, 250, 280, 16, C.cyan, 'center', { font: "'Courier New', monospace", weight: 'bold' });
      if (state === 'idle') button(c, BTN, 'DOWNLOAD', { pressed: pressed, size: 24 });
      else button(c, BTN, state === 'done' ? 'DONE' : 'DOWNLOADING…', { disabled: true, size: 18 });
    };
  };

  // ---- fuel -----------------------------------------------------------------------------------
  B.fuel = function (g) {
    var HOLD = 3;
    var level = 0, holding = false, bubbles = [];
    var TANK = { x: 56, y: 40, w: 190, h: 360 };
    var IN = { x: TANK.x + 18, y: TANK.y + 50, w: TANK.w - 36, h: TANK.h - 70 };
    var BTN = { x: 380, y: 300, r: 62 };
    g.dbg = { button: { x: BTN.x, y: BTN.y }, level: 0 };
    g.onDown = function (p) { if (dist(p.x, p.y, BTN.x, BTN.y) < BTN.r + 10) { holding = true; g.sound('click'); } };
    g.onUp = function () { holding = false; };
    g.onTeardown = function () { holding = false; };
    g.update = function (dt) {
      if (holding) {
        level = Math.min(1, level + dt / HOLD);
        g.dbg.level = level;
        if (Math.random() < dt * 30) bubbles.push({ x: rnd(IN.x + 10, IN.x + IN.w - 10), y: IN.y + IN.h - 4, r: rnd(2, 6), v: rnd(40, 90) });
        if (level >= 1) { holding = false; g.complete(); }
      }
      var top = IN.y + IN.h * (1 - level);
      for (var i = bubbles.length - 1; i >= 0; i--) { bubbles[i].y -= bubbles[i].v * dt; if (bubbles[i].y < top + 4) bubbles.splice(i, 1); }
    };
    g.draw = function (c, t) {
      metalBg(c, '#2f3860', '#1c2242');
      // pipe from tank to pump
      box(c, TANK.x + TANK.w - 6, 66, 150, 22, 6, '#6b77a8', 4);
      box(c, 374, 66, 22, 160, 6, '#6b77a8', 4);
      // tank body
      box(c, TANK.x, TANK.y, TANK.w, TANK.h, 34, vgrad(c, TANK.y, TANK.y + TANK.h, '#5d6a9c', '#3a4470'), 4);
      box(c, TANK.x + 30, TANK.y - 14, TANK.w - 60, 22, 8, '#7d89bb', 4);
      box(c, IN.x - 4, IN.y - 4, IN.w + 8, IN.h + 8, 14, '#0c1022', 4);
      c.save(); rr(c, IN.x, IN.y, IN.w, IN.h, 10); c.clip();
      var top = IN.y + IN.h * (1 - level);
      c.fillStyle = vgrad(c, top, IN.y + IN.h, '#ffd84a', '#e46a0c');
      c.beginPath(); c.moveTo(IN.x, IN.y + IN.h);
      for (var x = 0; x <= IN.w; x += 6) c.lineTo(IN.x + x, top + Math.sin(x / 14 + t * (holding ? 9 : 3)) * (level > 0 && level < 1 ? 3 : 0));
      c.lineTo(IN.x + IN.w, IN.y + IN.h); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,.55)';
      for (var i = 0; i < bubbles.length; i++) circle(c, bubbles[i].x, bubbles[i].y, bubbles[i].r, 'rgba(255,255,255,.5)');
      c.globalAlpha = 0.12; c.fillStyle = '#fff'; c.fillRect(IN.x + 10, IN.y, 16, IN.h); c.globalAlpha = 1;
      c.restore();
      // scale marks
      for (var m = 1; m < 4; m++) { var yy = IN.y + IN.h * (1 - m / 4); box(c, IN.x + IN.w - 26, yy - 2, 22, 4, 2, 'rgba(232,236,255,.6)'); }
      // target line
      c.setLineDash([10, 6]); c.beginPath(); c.moveTo(IN.x - 10, IN.y + 2); c.lineTo(IN.x + IN.w + 10, IN.y + 2);
      c.lineWidth = 4; c.strokeStyle = C.green; c.stroke(); c.setLineDash([]);
      txt(c, 'FULL', TANK.x + TANK.w + 24, IN.y + 4, 16, C.green, 'left', { outline: 4 });
      txt(c, Math.floor(level * 100) + '%', TANK.x + TANK.w / 2, TANK.y + 26, 18, '#fff', 'center', { outline: 4 });
      // pump panel
      box(c, 300, 140, 160, 260, 18, '#2b3358', 4);
      lamp(c, 340, 172, 12, level < 1 && !holding, C.danger);
      lamp(c, 380, 172, 12, holding && Math.sin(t * 14) > 0, C.amber);
      lamp(c, 420, 172, 12, level >= 1, C.green);
      txt(c, holding ? 'FILLING…' : level >= 1 ? 'FULL' : 'HOLD BUTTON', 380, 210, 16, holding ? C.amber : C.ink, 'center', { outline: 4 });
      var pr = holding ? 5 : 0;
      circle(c, BTN.x, BTN.y + 8, BTN.r, C.line);
      circle(c, BTN.x, BTN.y + pr, BTN.r, '#a3101a', 4);
      circle(c, BTN.x, BTN.y + pr - 3, BTN.r - 8, holding ? '#ff6670' : '#ff3b4a');
      c.globalAlpha = 0.35; circle(c, BTN.x - 18, BTN.y + pr - 22, 14, '#fff'); c.globalAlpha = 1;
      txt(c, 'HOLD', BTN.x, BTN.y + pr - 2, 22, '#fff', 'center', { outline: 5 });
    };
  };

  // ---- asteroids ------------------------------------------------------------------------------
  B.asteroids = function (g) {
    var GOAL = 15, count = 0, rocks = [], parts = [], lasers = [], nextId = 1, spawn = 0, side = 0;
    var SCR = { x: 14, y: 14, w: W - 28, h: H - 76 };
    g.dbg = { rocks: rocks, count: 0, goal: GOAL };
    function mkRock(x) {
      var r = rnd(22, 34), n = 9, pts = [];
      for (var i = 0; i < n; i++) pts.push(r * rnd(0.75, 1.1));
      var cr = [];
      for (var k = 0; k < 3; k++) cr.push({ a: rnd(0, 6.28), d: rnd(0, r * 0.5), r: rnd(3, r * 0.25) });
      rocks.push({ id: nextId++, x: x != null ? x : SCR.x + SCR.w + r, y: rnd(SCR.y + 40, SCR.y + SCR.h - 40), vx: -rnd(70, 140), vy: rnd(-25, 25),
        r: r, pts: pts, rot: rnd(0, 6), vr: rnd(-2, 2), cr: cr, shade: ['#8a7a6a', '#7d8794', '#9a8466'][Math.floor(Math.random() * 3)] });
    }
    mkRock(320); mkRock(420); mkRock(470);
    g.onDown = function (p) {
      if (!inRect(p, SCR)) return;
      side = 1 - side;
      lasers.push({ x: p.x, y: p.y, sx: side ? SCR.x + 20 : SCR.x + SCR.w - 20, sy: SCR.y + SCR.h, t: 0 });
      var best = null, bd = 1e9;
      for (var i = 0; i < rocks.length; i++) {
        var d = dist(p.x, p.y, rocks[i].x, rocks[i].y);
        if (d < rocks[i].r + 14 && d < bd) { bd = d; best = i; }
      }
      if (best == null) { g.sound('click'); return; }
      var rk = rocks[best];
      rocks.splice(best, 1);
      for (var k = 0; k < 14; k++) { var a = rnd(0, 6.28), s = rnd(60, 220); parts.push({ x: rk.x, y: rk.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, r: rnd(3, 7), c: k % 3 ? rk.shade : '#ffcc33' }); }
      count++; g.dbg.count = count;
      g.step();
      if (count >= GOAL) g.complete();
    };
    g.update = function (dt) {
      spawn -= dt;
      if (spawn <= 0 && rocks.length < 6 && count + rocks.length < GOAL + 3) { mkRock(); spawn = rnd(0.45, 0.9); }
      for (var i = rocks.length - 1; i >= 0; i--) {
        var r = rocks[i];
        r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.vr * dt;
        if (r.y < SCR.y + r.r || r.y > SCR.y + SCR.h - r.r) r.vy = -r.vy;
        if (r.x < SCR.x - r.r - 10) rocks.splice(i, 1);
      }
      for (var j = parts.length - 1; j >= 0; j--) { var p = parts[j]; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; if (p.t > 0.6) parts.splice(j, 1); }
      for (var k = lasers.length - 1; k >= 0; k--) { lasers[k].t += dt; if (lasers[k].t > 0.18) lasers.splice(k, 1); }
    };
    g.draw = function (c, t) {
      metalBg(c, '#2f3860', '#1c2242');
      box(c, SCR.x, SCR.y, SCR.w, SCR.h, 18, '#041a10', 4);
      c.save(); rr(c, SCR.x, SCR.y, SCR.w, SCR.h, 18); c.clip();
      // starfield + grid
      c.fillStyle = 'rgba(180,255,200,.5)';
      for (var s = 0; s < 40; s++) { var sx = (s * 97 + t * (10 + s % 3 * 8)) % SCR.w; c.fillRect(SCR.x + SCR.w - sx, SCR.y + (s * 53) % SCR.h, 2, 2); }
      c.strokeStyle = 'rgba(62,232,107,.18)'; c.lineWidth = 2;
      var cx = SCR.x + SCR.w / 2, cy = SCR.y + SCR.h / 2;
      for (var rr2 = 60; rr2 < 300; rr2 += 60) { c.beginPath(); c.arc(cx, cy, rr2, 0, 6.29); c.stroke(); }
      c.beginPath(); c.moveTo(SCR.x, cy); c.lineTo(SCR.x + SCR.w, cy); c.moveTo(cx, SCR.y); c.lineTo(cx, SCR.y + SCR.h); c.stroke();
      for (var i = 0; i < rocks.length; i++) {
        var r = rocks[i];
        c.save(); c.translate(r.x, r.y); c.rotate(r.rot);
        c.beginPath();
        for (var k = 0; k < r.pts.length; k++) { var a = k / r.pts.length * 6.283; var px = Math.cos(a) * r.pts[k], py = Math.sin(a) * r.pts[k]; if (k) c.lineTo(px, py); else c.moveTo(px, py); }
        c.closePath(); c.fillStyle = r.shade; c.fill(); c.lineWidth = 4; c.strokeStyle = C.line; c.stroke();
        for (var q = 0; q < r.cr.length; q++) { var cr = r.cr[q]; circle(c, Math.cos(cr.a) * cr.d, Math.sin(cr.a) * cr.d, cr.r, 'rgba(0,0,0,.25)'); }
        c.globalAlpha = 0.25; circle(c, -r.r * 0.3, -r.r * 0.35, r.r * 0.3, '#fff'); c.globalAlpha = 1;
        c.restore();
      }
      for (var j = 0; j < parts.length; j++) { var pp = parts[j]; c.globalAlpha = 1 - pp.t / 0.6; circle(c, pp.x, pp.y, pp.r * (1 - pp.t), pp.c, 2); }
      c.globalAlpha = 1;
      for (var l = 0; l < lasers.length; l++) {
        var L = lasers[l];
        c.globalAlpha = 1 - L.t / 0.18;
        c.beginPath(); c.moveTo(L.sx, L.sy); c.lineTo(L.x, L.y); c.lineWidth = 8; c.strokeStyle = 'rgba(62,232,107,.5)'; c.stroke();
        c.lineWidth = 3; c.strokeStyle = '#d6ffe0'; c.stroke();
        circle(c, L.x, L.y, 14 * (1 - L.t / 0.18) + 4, 'rgba(214,255,224,.7)');
      }
      c.globalAlpha = 1;
      if (g.ptr && inRect(g.ptr, SCR)) {
        var X = g.ptr.x, Y = g.ptr.y;
        c.strokeStyle = 'rgba(62,232,107,.35)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(SCR.x, Y); c.lineTo(SCR.x + SCR.w, Y); c.moveTo(X, SCR.y); c.lineTo(X, SCR.y + SCR.h); c.stroke();
        c.strokeStyle = C.green; c.lineWidth = 3;
        c.beginPath(); c.arc(X, Y, 20, 0, 6.29); c.stroke();
        c.beginPath(); c.moveTo(X - 30, Y); c.lineTo(X - 12, Y); c.moveTo(X + 12, Y); c.lineTo(X + 30, Y);
        c.moveTo(X, Y - 30); c.lineTo(X, Y - 12); c.moveTo(X, Y + 12); c.lineTo(X, Y + 30); c.stroke();
      }
      c.restore();
      // counter panel
      box(c, 110, H - 54, 280, 42, 12, '#11182e', 4);
      txt(c, 'DESTROYED: ' + count + ' / ' + GOAL, 250, H - 33, 20, C.green, 'center', { font: "'Courier New', monospace", weight: 'bold' });
    };
  };

  // ---- align ----------------------------------------------------------------------------------
  B.align = function (g) {
    var PX = 104, PY = 214, R = 326, MAXA = 0.52, TOL = 0.045;
    var theta = (Math.random() < 0.5 ? -1 : 1) * rnd(0.22, 0.46);
    var drag = false, ok = false;
    function hp(a) { return { x: PX + Math.cos(a) * R, y: PY + Math.sin(a) * R }; }
    g.dbg = { theta: theta, handle: hp(theta), centre: hp(0) };
    g.onDown = function (p) {
      var h = hp(theta);
      if (dist(p.x, p.y, h.x, h.y) < 50 || (p.x > 330 && Math.abs(Math.atan2(p.y - PY, p.x - PX) - theta) < 0.12)) { drag = true; g.sound('click'); }
    };
    g.onMove = function (p) {
      if (!drag) return;
      theta = clamp(Math.atan2(p.y - PY, p.x - PX), -MAXA, MAXA);
      g.dbg.theta = theta; g.dbg.handle = hp(theta);
    };
    g.onUp = function () {
      if (!drag) return;
      drag = false;
      if (Math.abs(theta) < TOL) { theta = 0; ok = true; g.dbg.theta = 0; g.dbg.handle = hp(0); g.complete(); }
    };
    g.draw = function (c, t) {
      metalBg(c, '#2b3359', '#1b2140');
      screen(c, 24, 24, W - 48, H - 48, '#0a1222', 16);
      c.save(); rr(c, 24, 24, W - 48, H - 48, 16); c.clip();
      // arc scale
      c.beginPath(); c.arc(PX, PY, R, -MAXA - 0.04, MAXA + 0.04);
      c.lineWidth = 30; c.strokeStyle = C.line; c.stroke();
      c.lineWidth = 22; c.strokeStyle = '#2a3354'; c.stroke();
      for (var k = -10; k <= 10; k++) {
        var a = k / 10 * MAXA, big = k % 5 === 0;
        c.beginPath(); c.moveTo(PX + Math.cos(a) * (R - (big ? 34 : 24)), PY + Math.sin(a) * (R - (big ? 34 : 24)));
        c.lineTo(PX + Math.cos(a) * (R - 16), PY + Math.sin(a) * (R - 16));
        c.lineWidth = big ? 4 : 2; c.strokeStyle = k === 0 ? C.green : 'rgba(232,236,255,.55)'; c.stroke();
      }
      // centre guide
      c.setLineDash([12, 10]); c.lineDashOffset = -t * 20;
      c.beginPath(); c.moveTo(PX, PY); c.lineTo(PX + R, PY); c.lineWidth = 3; c.strokeStyle = 'rgba(62,232,107,.6)'; c.stroke(); c.setLineDash([]);
      // engine beam
      var aligned = Math.abs(theta) < TOL;
      var col = aligned ? C.green : C.amber;
      var h = hp(theta);
      c.save(); c.shadowColor = col; c.shadowBlur = 18;
      c.beginPath(); c.moveTo(PX, PY); c.lineTo(h.x, h.y); c.lineWidth = 10; c.strokeStyle = col; c.globalAlpha = 0.5 + 0.2 * Math.sin(t * 12); c.stroke();
      c.restore(); c.globalAlpha = 1;
      c.beginPath(); c.moveTo(PX, PY); c.lineTo(h.x, h.y); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
      c.restore();
      // engine
      c.save(); c.translate(PX - 10, PY); c.rotate(theta);
      box(c, -60, -46, 100, 92, 22, '#5d6a9c', 4);
      box(c, 30, -30, 34, 60, 10, '#7d89bb', 4);
      box(c, 58, -18, 16, 36, 6, col, 4);
      for (var i = 0; i < 3; i++) box(c, -46 + i * 22, -34, 12, 68, 5, '#3a4470', 3);
      c.restore();
      // handle (arrow) on the scale
      c.save(); c.translate(h.x, h.y); c.rotate(theta);
      c.beginPath(); c.moveTo(-22, 0); c.lineTo(8, -24); c.lineTo(26, -24); c.lineTo(26, 24); c.lineTo(8, 24); c.closePath();
      c.fillStyle = drag ? '#ffe17a' : C.amber; c.fill(); c.lineWidth = 4; c.strokeStyle = C.line; c.stroke();
      box(c, 12, -10, 8, 20, 3, '#b07d00');
      c.restore();
      txt(c, aligned ? 'ALIGNED — RELEASE' : 'DRAG THE ARROW TO THE CENTRE', W / 2 + 20, H - 50, 15, aligned ? C.green : C.ink, 'center', { outline: 4 });
    };
  };

  // ---- calibrate ------------------------------------------------------------------------------
  B.calibrate = function (g) {
    var ROWS = [{ col: '#ffd93b', spd: 150 }, { col: '#52e0ff', spd: 200 }, { col: '#5a7dff', spd: 255 }];
    var TOL = 22, TARGET = -90;
    var active = 0, err = 0, pressed = -1;
    var ang = [rnd(0, 360), rnd(0, 360), rnd(0, 360)], locked = [false, false, false], fill = [0, 0, 0];
    var ys = [78, 220, 362];
    var btns = ys.map(function (y) { return { x: 330, y: y - 32, w: 140, h: 60 }; });
    g.dbg = { active: 0, angles: ang, target: TARGET, tol: TOL, buttons: btns.map(function (b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }) };
    g.onDown = function (p) {
      for (var i = 0; i < 3; i++) {
        if (!inRect(p, btns[i])) continue;
        pressed = i;
        if (i !== active) return;
        if (Math.abs(angDiff(ang[i], TARGET)) <= TOL) {
          locked[i] = true; ang[i] = TARGET; active++; g.dbg.active = active; g.step();
          if (active >= 3) g.complete();
        } else {
          err = 0.6; locked = [false, false, false]; active = 0; g.dbg.active = 0; g.sound('click'); g.shake();
        }
        return;
      }
    };
    g.onUp = function () { pressed = -1; };
    g.update = function (dt) {
      err = Math.max(0, err - dt);
      for (var i = 0; i < 3; i++) {
        if (!locked[i]) ang[i] = (ang[i] + ROWS[i].spd * dt) % 360;
        fill[i] = lerp(fill[i], locked[i] ? 1 : 0, Math.min(1, dt * 8));
      }
    };
    g.draw = function (c, t) {
      metalBg(c, '#2f3860', '#1c2242');
      for (var i = 0; i < 3; i++) {
        var y = ys[i], row = ROWS[i], on = i === active;
        box(c, 20, y - 62, W - 40, 124, 16, on ? '#323d68' : '#232a4a', 4);
        if (on) { c.globalAlpha = 0.5 + 0.4 * Math.sin(t * 6); box(c, 20, y - 62, W - 40, 124, 16, null, 4, row.col); c.globalAlpha = 1; }
        // dial
        var dx = 96;
        circle(c, dx, y, 52, '#0c1022', 4);
        for (var k = 0; k < 12; k++) {
          var a = k / 12 * 6.283;
          c.beginPath(); c.moveTo(dx + Math.cos(a) * 40, y + Math.sin(a) * 40); c.lineTo(dx + Math.cos(a) * 47, y + Math.sin(a) * 47);
          c.lineWidth = 2; c.strokeStyle = 'rgba(232,236,255,.35)'; c.stroke();
        }
        // target zone at top
        var tz = TARGET * Math.PI / 180, tol = TOL * Math.PI / 180;
        c.beginPath(); c.moveTo(dx, y); c.arc(dx, y, 46, tz - tol, tz + tol); c.closePath();
        c.fillStyle = 'rgba(62,232,107,.28)'; c.fill();
        // spinner wedge
        var a0 = ang[i] * Math.PI / 180;
        c.beginPath(); c.moveTo(dx, y); c.arc(dx, y, 44, a0 - 0.28, a0 + 0.28); c.closePath();
        c.fillStyle = locked[i] ? C.green : row.col; c.fill(); c.lineWidth = 3; c.strokeStyle = C.line; c.stroke();
        circle(c, dx, y, 12, '#5d6a9c', 3);
        // marker triangle
        c.beginPath(); c.moveTo(dx - 11, y - 66); c.lineTo(dx + 11, y - 66); c.lineTo(dx, y - 50); c.closePath();
        c.fillStyle = C.amber; c.fill(); c.lineWidth = 3; c.strokeStyle = C.line; c.stroke();
        // gauge
        box(c, 172, y - 16, 136, 32, 10, '#0c1022', 4);
        if (fill[i] > 0.01) box(c, 176, y - 12, 128 * fill[i], 24, 7, locked[i] ? C.green : row.col);
        txt(c, locked[i] ? 'CALIBRATED' : on ? 'READY' : 'LOCKED', 240, y - 38, 15, locked[i] ? C.green : on ? row.col : C.dim, 'center', { outline: 3 });
        button(c, btns[i], 'CALIBRATE', { size: 17, pressed: pressed === i, disabled: !on, color: row.col, dark: '#4a5280' });
      }
      if (err > 0) { c.globalAlpha = err; c.fillStyle = 'rgba(255,59,74,.35)'; c.fillRect(0, 0, W, H); txt(c, 'MISS! RESTARTING', W / 2, H / 2, 32, '#fff', 'center', { outline: 6 }); c.globalAlpha = 1; }
    };
  };

  // ---- garbage --------------------------------------------------------------------------------
  B.garbage = function (g) {
    var DUR = 2, prog = 0, lever = 0, drag = null;
    var WIN = { x: 30, y: 30, w: 290, h: 340 };
    var TR = { x: 412, y0: 110, y1: 330 };
    var junk = [];
    for (var i = 0; i < 64; i++) {
      junk.push({ x: rnd(WIN.x + 22, WIN.x + WIN.w - 22), y: WIN.y + WIN.h - 14 - Math.pow(Math.random(), 1.3) * 230, r: rnd(12, 24), rot: rnd(0, 6.28),
        kind: i % 4, c: ['#7bc043', '#e36b4b', '#c8b57a', '#6aa0d8', '#b06ad8', '#d8d06a'][i % 6], fall: rnd(0, 0.6), sp: rnd(0.8, 1.2) });
    }
    junk.sort(function (a, b) { return b.y - a.y; });
    function knobY() { return lerp(TR.y0, TR.y1, lever); }
    g.dbg = { knob: { x: TR.x, y: TR.y0 }, bottom: { x: TR.x, y: TR.y1 + 30 }, prog: 0 };
    g.onDown = function (p) { if (dist(p.x, p.y, TR.x, knobY()) < 50) { drag = { oy: p.y - knobY() }; g.sound('click'); } };
    g.onMove = function (p) { if (drag) lever = clamp((p.y - drag.oy - TR.y0) / (TR.y1 - TR.y0), 0, 1); };
    g.onUp = function () { drag = null; };
    g.update = function (dt) {
      if (!drag) lever = Math.max(0, lever - dt * 4);
      g.dbg.knob = { x: TR.x, y: knobY() };
      if (lever >= 0.9) {
        prog = Math.min(1, prog + dt / DUR); g.dbg.prog = prog;
        if (prog >= 1) g.complete();
      }
    };
    g.draw = function (c, t) {
      metalBg(c, '#3a3f58', '#24283c');
      var open = lever >= 0.9;
      // chute
      box(c, WIN.x - 8, WIN.y - 8, WIN.w + 16, WIN.h + 50, 18, '#5b6386', 4);
      box(c, WIN.x, WIN.y, WIN.w, WIN.h, 12, '#141a2c', 4);
      box(c, WIN.x - 8, WIN.y + WIN.h + 4, WIN.w + 16, 38, 10, '#2a2f45', 4);
      if (open) box(c, WIN.x + 10, WIN.y + WIN.h + 10, WIN.w - 20, 26, 6, '#05070f');
      c.save(); c.beginPath(); c.rect(WIN.x + 2, WIN.y + 2, WIN.w - 4, WIN.h - 2); if (open) c.rect(WIN.x + 10, WIN.y + WIN.h, WIN.w - 20, 36); c.clip();
      var shake = open && prog < 1 ? Math.sin(t * 50) * 2 : 0;
      for (var i = 0; i < junk.length; i++) {
        var j = junk[i];
        var local = clamp((prog * 1.6 - j.fall) * j.sp, 0, 1);
        var y = j.y + local * local * 340, x = j.x + shake;
        c.save(); c.translate(x, y); c.rotate(j.rot + local * 3);
        if (j.kind === 0) circle(c, 0, 0, j.r * 0.8, j.c, 3);
        else if (j.kind === 1) box(c, -j.r, -j.r * 0.6, j.r * 2, j.r * 1.2, 4, j.c, 3);
        else if (j.kind === 2) { box(c, -j.r * 0.45, -j.r, j.r * 0.9, j.r * 2, 6, j.c, 3); box(c, -j.r * 0.3, -j.r - 6, j.r * 0.6, 8, 2, '#ddd', 3); }
        else { c.beginPath(); c.moveTo(-j.r, j.r * 0.7); c.lineTo(0, -j.r); c.lineTo(j.r, j.r * 0.7); c.closePath(); c.fillStyle = j.c; c.fill(); c.lineWidth = 3; c.strokeStyle = C.line; c.stroke(); }
        c.restore();
      }
      c.restore();
      // glass reflection
      c.globalAlpha = 0.08; c.fillStyle = '#fff';
      c.beginPath(); c.moveTo(WIN.x + 20, WIN.y); c.lineTo(WIN.x + 90, WIN.y); c.lineTo(WIN.x + 30, WIN.y + WIN.h); c.lineTo(WIN.x, WIN.y + WIN.h); c.closePath(); c.fill(); c.globalAlpha = 1;
      // hatch
      if (!open) {
        box(c, WIN.x - 8, WIN.y + WIN.h + 4, WIN.w + 16, 38, 10, '#2a2f45', 4);
        for (var s = 0; s < 6; s++) box(c, WIN.x + 6 + s * 48, WIN.y + WIN.h + 12, 36, 22, 4, s % 2 ? '#ffcc33' : '#1a1a1a', 2);
      }
      // lever
      box(c, TR.x - 40, 60, 80, 330, 20, '#2a3050', 4);
      box(c, TR.x - 9, TR.y0 - 10, 18, TR.y1 - TR.y0 + 20, 9, '#0c1022', 3);
      var ky = knobY();
      box(c, TR.x - 6, TR.y0 - 30, 12, ky - TR.y0 + 30, 6, '#9aa6c4', 3);
      circle(c, TR.x, ky, 30, '#ff3b4a', 4);
      c.globalAlpha = 0.4; circle(c, TR.x - 9, ky - 10, 9, '#fff'); c.globalAlpha = 1;
      // arrow hint
      if (!open && prog < 1) {
        c.globalAlpha = 0.5 + 0.4 * Math.sin(t * 6);
        txt(c, '▼', TR.x, TR.y1 + 46, 26, C.amber, 'center', { outline: 4 });
        c.globalAlpha = 1;
      }
      box(c, 348, 20, 128, 30, 8, '#11182e', 3);
      txt(c, prog >= 1 ? 'EMPTY' : open ? 'EJECTING ' + Math.floor(prog * 100) + '%' : 'PULL & HOLD', 412, 35, 13, open ? C.green : C.amber, 'center', { font: "'Courier New', monospace", weight: 'bold' });
    };
  };

  // ---- scan -----------------------------------------------------------------------------------
  B.scan = function (g) {
    var DUR = 10, prog = 0, state = 'idle', pressed = false;
    var BTN = { x: 290, y: 344, w: 180, h: 60 };
    var ci = g.opts.color != null ? g.opts.color : 0;
    var cols = (IS.CONFIG && IS.CONFIG.COLORS) || [['Red']];
    var id = 'CM-' + Math.floor(rnd(1000, 9999));
    var LINES = [
      ['ID', id], ['COLOR', (cols[ci] || cols[0])[0].toUpperCase()], ['HT', "3' 6\""], ['WT', '92 lb'], ['BT', ['O-', 'A+', 'B+', 'AB-'][ci % 4]], ['STATUS', 'HEALTHY']
    ];
    g.dbg = { button: { x: BTN.x + BTN.w / 2, y: BTN.y + BTN.h / 2 }, state: state, dur: DUR };
    g.onDown = function (p) { if (state === 'idle' && inRect(p, BTN)) pressed = true; };
    g.onUp = function (p) {
      if (pressed && state === 'idle' && inRect(p, BTN)) { state = 'run'; g.dbg.state = state; g.step(); }
      pressed = false;
    };
    var shown = 0;
    g.update = function (dt) {
      if (state !== 'run') return;
      prog = Math.min(1, prog + dt / DUR); g.dbg.prog = prog;
      var n = Math.floor(prog * LINES.length + 0.001);
      if (n > shown) { shown = n; g.sound('task_step'); }
      if (prog >= 1) { state = 'done'; g.dbg.state = state; g.complete(); }
    };
    g.draw = function (c, t) {
      metalBg(c, '#203a4a', '#14212e');
      // scanner bay
      var cx = 140, fy = 330;
      box(c, 24, 24, 236, 392, 18, '#0d1c26', 4);
      c.save(); rr(c, 24, 24, 236, 392, 18); c.clip();
      // pad
      c.beginPath(); c.ellipse(cx, fy + 8, 96, 30, 0, 0, 6.29); c.fillStyle = '#3a5568'; c.fill(); c.lineWidth = 4; c.strokeStyle = C.line; c.stroke();
      c.beginPath(); c.ellipse(cx, fy + 2, 80, 22, 0, 0, 6.29); c.fillStyle = state === 'run' ? '#3ee8a0' : '#5b7d94'; c.fill(); c.lineWidth = 3; c.stroke();
      crewmate(c, cx, fy + 6, ci, 3.3);
      if (state === 'run') {
        // rising beam
        c.globalAlpha = 0.18; c.fillStyle = '#3ee8a0'; c.fillRect(cx - 80, 40, 160, fy - 38); c.globalAlpha = 1;
        var u = (Math.sin(t * 2.2) + 1) / 2, sy = lerp(fy, 110, u);
        c.save(); c.shadowColor = '#3ee8a0'; c.shadowBlur = 20;
        c.beginPath(); c.ellipse(cx, sy, 82, 18, 0, 0, 6.29); c.lineWidth = 6; c.strokeStyle = 'rgba(62,232,160,.9)'; c.stroke();
        c.restore();
        c.beginPath(); c.ellipse(cx, sy, 82, 18, 0, 0, 6.29); c.lineWidth = 2; c.strokeStyle = '#e0fff0'; c.stroke();
      }
      c.restore();
      // readout
      screen(c, 282, 28, 196, 296, '#04161a', 12);
      txt(c, 'MEDBAY SCAN', 380, 50, 16, '#3ee8a0', 'center', { font: "'Courier New', monospace", weight: 'bold' });
      c.fillStyle = 'rgba(62,232,160,.4)'; c.fillRect(296, 64, 168, 2);
      var n = state === 'idle' ? 0 : Math.floor(prog * LINES.length + 0.001);
      for (var i = 0; i < LINES.length; i++) {
        var yy = 88 + i * 30;
        if (i < n) {
          txt(c, LINES[i][0] + ':', 298, yy, 15, '#7fd8c0', 'left', { font: "'Courier New', monospace", weight: 'bold' });
          txt(c, LINES[i][1], 464, yy, 15, '#e8fff7', 'right', { font: "'Courier New', monospace", weight: 'bold' });
        } else if (i === n && state === 'run') {
          txt(c, LINES[i][0] + ':' + (Math.floor(t * 3) % 2 ? ' _' : ''), 298, yy, 15, '#7fd8c0', 'left', { font: "'Courier New', monospace", weight: 'bold' });
        }
      }
      box(c, 296, 274, 168, 22, 7, '#0a2a26', 3);
      if (prog > 0) box(c, 299, 277, 162 * prog, 16, 5, '#3ee8a0');
      txt(c, state === 'idle' ? 'STAND STILL' : state === 'run' ? 'SCANNING… ' + Math.floor(prog * 100) + '%' : 'SCAN COMPLETE', 380, 308, 14, state === 'idle' ? C.amber : '#3ee8a0', 'center', { font: "'Courier New', monospace", weight: 'bold' });
      if (state === 'idle') button(c, BTN, 'START SCAN', { pressed: pressed, size: 20, color: '#3ee8a0', dark: '#1d8a5a' });
      else button(c, BTN, state === 'run' ? 'SCANNING…' : 'DONE', { disabled: true, size: 18 });
    };
  };

  // ---- divert ---------------------------------------------------------------------------------
  B.divert = function (g) {
    var LABELS = ['SEC', 'WPN', 'O2', 'ENG', 'SHLD', 'NAV', 'COMM', 'LIFE'];
    var target = Math.floor(Math.random() * 8);
    var vals = LABELS.map(function () { return rnd(0.05, 0.2); });
    vals[target] = 0;
    var TOP = 110, BOT = 330, drag = null;
    function sx(i) { return 48 + i * 58; }
    function hy(i) { return lerp(BOT, TOP, vals[i]); }
    g.dbg = { target: target, handle: { x: sx(target), y: hy(target) }, top: { x: sx(target), y: TOP - 20 } };
    g.onDown = function (p) {
      if (Math.abs(p.x - sx(target)) < 30 && Math.abs(p.y - hy(target)) < 44) { drag = { oy: p.y - hy(target) }; g.sound('click'); }
    };
    g.onMove = function (p) {
      if (!drag) return;
      vals[target] = clamp((BOT - (p.y - drag.oy)) / (BOT - TOP), 0, 1);
      g.dbg.handle = { x: sx(target), y: hy(target) };
      if (vals[target] >= 0.97) { vals[target] = 1; drag = null; g.complete(); }
    };
    g.onUp = function () { drag = null; };
    g.draw = function (c, t) {
      metalBg(c, '#2f3860', '#1c2242');
      box(c, 20, 20, W - 40, 56, 12, '#11182e', 4);
      txt(c, 'DIVERT POWER TO ' + ({ SEC: 'SECURITY', WPN: 'WEAPONS', O2: 'O2', ENG: 'ENGINES', SHLD: 'SHIELDS', NAV: 'NAVIGATION', COMM: 'COMMS', LIFE: 'LIFE SUPPORT' })[LABELS[target]], W / 2, 48, 18, C.amber, 'center');
      // main bus
      box(c, 26, 368, W - 52, 18, 6, '#4b5684', 3);
      for (var i = 0; i < 8; i++) {
        var x = sx(i), isT = i === target;
        // power bar beside the track
        var bh = (BOT - TOP) * vals[i];
        box(c, x - 18, TOP - 12, 36, BOT - TOP + 24, 12, isT ? '#2c3870' : '#1d2342', 3);
        if (bh > 2) {
          c.save(); rr(c, x - 14, BOT + 8 - bh - 4, 28, bh + 4, 8); c.clip();
          c.fillStyle = vgrad(c, TOP, BOT, isT ? '#fff3a0' : '#7a8ab8', isT ? '#ffb200' : '#3a4470'); c.fillRect(x - 14, BOT + 8 - bh - 4, 28, bh + 4); c.restore();
        }
        box(c, x - 4, TOP, 8, BOT - TOP, 4, '#05070f');
        // wire to bus
        box(c, x - 3, BOT + 12, 6, 368 - BOT - 12, 2, isT ? C.amber : '#4b5684');
        if (isT && vals[i] < 1) {
          // sparks
          for (var s = 0; s < 3; s++) {
            var sy2 = lerp(368, BOT + 14, ((t * 2 + s / 3) % 1));
            circle(c, x + Math.sin(t * 30 + s) * 4, sy2, 3, '#fff6b0');
          }
        }
        var y = hy(i);
        if (isT) { c.save(); c.shadowColor = C.amber; c.shadowBlur = 10 + 8 * Math.sin(t * 8); box(c, x - 22, y - 13, 44, 26, 8, C.amber, 4); c.restore(); box(c, x - 22, y - 13, 44, 26, 8, null, 4); box(c, x - 14, y - 2, 28, 4, 2, '#b07d00'); }
        else box(c, x - 20, y - 11, 40, 22, 7, '#59617f', 4);
        txt(c, LABELS[i], x, 410, 14, isT ? C.amber : C.dim, 'center', { outline: 3 });
      }
      if (vals[target] < 0.2) {
        c.globalAlpha = 0.5 + 0.4 * Math.sin(t * 6);
        txt(c, '▲', sx(target), TOP - 24 > 82 ? TOP - 24 : 92, 22, C.amber, 'center', { outline: 4 });
        c.globalAlpha = 1;
      }
    };
  };

  // ---- leaves ---------------------------------------------------------------------------------
  B.leaves = function (g) {
    var N = 6, gone = 0, nextId = 1, drag = null;
    var VENT = { x: 22, y: 80, w: 66, h: 280 };
    var leaves = [];
    for (var i = 0; i < N; i++) {
      leaves.push({ id: nextId++, x: 200 + (i % 3) * 112 + rnd(-22, 22), y: 110 + Math.floor(i / 3) * 190 + rnd(-30, 30), bx: 0, by: 0, rot: rnd(0, 6.28), s: rnd(0.9, 1.25), ph: rnd(0, 6.28),
        c: ['#4caf50', '#7cb342', '#c0a030', '#d27b2c', '#3d8b40', '#a5c23a'][i % 6], suck: 0 });
    }
    g.dbg = { leaves: leaves, vent: { x: VENT.x + VENT.w / 2, y: VENT.y + VENT.h / 2 } };
    function suck(l) { if (l.suck) return; l.suck = 0.001; gone++; g.step(); if (drag && drag.l === l) drag = null; if (gone >= N) g.after(300, g.complete); }
    g.onDown = function (p) {
      for (var i = leaves.length - 1; i >= 0; i--) {
        var l = leaves[i];
        if (!l.suck && dist(p.x, p.y, l.x, l.y) < 38 * l.s) {
          drag = { l: l, ox: p.x - l.x, oy: p.y - l.y };
          leaves.splice(i, 1); leaves.push(l); // bring to front
          return;
        }
      }
    };
    g.onMove = function (p) {
      if (!drag) return;
      var l = drag.l;
      l.x = clamp(p.x - drag.ox, 10, W - 10); l.y = clamp(p.y - drag.oy, 10, H - 10);
      if (l.x < VENT.x + VENT.w + 6 && l.y > VENT.y - 30 && l.y < VENT.y + VENT.h + 30) suck(l);
    };
    g.onUp = function () {
      if (!drag) return;
      var l = drag.l; drag = null;
      if (l.x < VENT.x + VENT.w + 50) suck(l);
    };
    g.update = function (dt, t) {
      for (var i = leaves.length - 1; i >= 0; i--) {
        var l = leaves[i];
        if (l.suck) {
          l.suck += dt / 0.35;
          l.x = lerp(l.x, VENT.x + 10, Math.min(1, dt * 10)); l.y = lerp(l.y, clamp(l.y, VENT.y + 30, VENT.y + VENT.h - 30), Math.min(1, dt * 10));
          l.rot += dt * 14;
          if (l.suck >= 1) leaves.splice(i, 1);
        } else if (!drag || drag.l !== l) {
          l.x += Math.sin(t * 0.9 + l.ph) * dt * 10 - dt * 3;
          l.y += Math.cos(t * 0.7 + l.ph) * dt * 8;
          l.rot += Math.sin(t + l.ph) * dt * 0.5;
          l.x = clamp(l.x, VENT.x + VENT.w + 60, W - 30); l.y = clamp(l.y, 40, H - 40);
        }
      }
    };
    function leaf(c, l) {
      var s = l.s * (l.suck ? Math.max(0, 1 - l.suck) : 1);
      if (s <= 0.02) return;
      c.save(); c.translate(l.x, l.y); c.rotate(l.rot); c.scale(s, s);
      c.beginPath(); c.moveTo(-30, 0); c.bezierCurveTo(-14, -24, 14, -22, 30, 0); c.bezierCurveTo(14, 22, -14, 24, -30, 0); c.closePath();
      c.fillStyle = l.c; c.fill(); c.lineWidth = 4; c.strokeStyle = C.line; c.stroke();
      c.beginPath(); c.moveTo(-36, 0); c.lineTo(24, 0);
      for (var k = -1; k <= 1; k++) { c.moveTo(-10 + k * 12, 0); c.lineTo(-2 + k * 12, -10); c.moveTo(-10 + k * 12, 0); c.lineTo(-2 + k * 12, 10); }
      c.lineWidth = 2.5; c.strokeStyle = 'rgba(5,7,15,.55)'; c.stroke();
      c.restore();
    }
    g.draw = function (c, t) {
      metalBg(c, '#2b4a52', '#1a2c33');
      box(c, 14, 14, W - 28, H - 28, 18, '#163038', 4);
      // filter mesh
      c.save(); rr(c, 14, 14, W - 28, H - 28, 18); c.clip();
      c.strokeStyle = 'rgba(160,230,240,.13)'; c.lineWidth = 2;
      for (var d = -H; d < W; d += 26) { c.beginPath(); c.moveTo(d, 0); c.lineTo(d + H, H); c.moveTo(d + H, 0); c.lineTo(d, H); c.stroke(); }
      c.restore();
      // vent
      box(c, VENT.x - 6, VENT.y - 6, VENT.w + 12, VENT.h + 12, 12, '#4f6a74', 4);
      box(c, VENT.x, VENT.y, VENT.w, VENT.h, 8, '#05070f', 3);
      for (var s = 0; s < 9; s++) box(c, VENT.x + 4, VENT.y + 12 + s * 30, VENT.w - 8, 10, 4, '#2c3f46');
      // suction streaks
      c.save(); rr(c, VENT.x + VENT.w, VENT.y, 140, VENT.h, 0); c.clip();
      c.strokeStyle = 'rgba(200,245,255,.25)'; c.lineWidth = 3; c.lineCap = 'round';
      for (var k = 0; k < 7; k++) {
        var off = (t * 120 + k * 47) % 140, yy = VENT.y + 24 + k * 38;
        c.beginPath(); c.moveTo(VENT.x + VENT.w + 140 - off, yy); c.lineTo(VENT.x + VENT.w + 140 - off - 28, yy); c.stroke();
      }
      c.restore();
      txt(c, '◀ VENT', VENT.x + VENT.w + 14, VENT.y - 24, 14, '#c8f5ff', 'left', { outline: 4 });
      for (var i = 0; i < leaves.length; i++) leaf(c, leaves[i]);
      box(c, W - 150, H - 52, 130, 30, 8, '#0d1d22', 3);
      txt(c, 'LEAVES: ' + (N - gone), W - 85, H - 37, 15, '#c8f5ff', 'center', { font: "'Courier New', monospace", weight: 'bold' });
    };
  };

  // ---- numbers --------------------------------------------------------------------------------
  B.numbers = function (g) {
    var order = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    var next = 1, err = 0, pressed = -1;
    var TS = 82, GAP = 12, X0 = (W - (5 * TS + 4 * GAP)) / 2, Y0 = 150;
    var tiles = order.map(function (n, i) { return { n: n, x: X0 + (i % 5) * (TS + GAP), y: Y0 + Math.floor(i / 5) * (TS + GAP) }; });
    g.dbg = { tiles: tiles.map(function (tl) { return { n: tl.n, x: tl.x + TS / 2, y: tl.y + TS / 2 }; }) };
    g.onDown = function (p) {
      if (err > 0) return;
      for (var i = 0; i < tiles.length; i++) {
        var tl = tiles[i];
        if (!inRect(p, { x: tl.x, y: tl.y, w: TS, h: TS })) continue;
        pressed = i;
        if (tl.n < next) return;
        if (tl.n === next) {
          next++; g.step();
          if (next > 10) g.complete();
        } else { err = 0.6; next = 1; g.sound('click'); g.shake(); }
        return;
      }
    };
    g.onUp = function () { pressed = -1; };
    g.update = function (dt) { err = Math.max(0, err - dt); };
    g.draw = function (c, t) {
      metalBg(c, '#2f3860', '#1c2242');
      screen(c, 40, 34, W - 80, 70, '#081426', 12);
      txt(c, err > 0 ? 'WRONG ORDER — RESET' : next > 10 ? 'MANIFOLDS UNLOCKED' : 'PRESS 1 TO 10 IN ORDER', W / 2, 59, 18, err > 0 ? '#ff6b6b' : C.cyan, 'center');
      txt(c, 'NEXT: ' + Math.min(next, 10), W / 2, 85, 14, C.dim, 'center', { font: "'Courier New', monospace", weight: 'bold' });
      box(c, X0 - 18, Y0 - 18, 5 * TS + 4 * GAP + 36, 2 * TS + GAP + 36, 18, '#151b35', 4);
      for (var i = 0; i < tiles.length; i++) {
        var tl = tiles[i], lit = tl.n < next, pr = pressed === i ? 4 : 0;
        var face = err > 0 ? '#c43040' : lit ? '#3b7bff' : '#d9deef';
        box(c, tl.x, tl.y + 5, TS, TS, 14, C.line);
        box(c, tl.x, tl.y + pr, TS, TS, 14, face, 4);
        c.globalAlpha = 0.3; box(c, tl.x + 8, tl.y + pr + 6, TS - 16, 8, 4, '#fff'); c.globalAlpha = 1;
        txt(c, String(tl.n), tl.x + TS / 2, tl.y + pr + TS / 2 + 2, 36, lit || err > 0 ? '#fff' : '#1b2140', 'center', lit || err > 0 ? { outline: 5 } : {});
      }
      // progress lamps
      for (var k = 1; k <= 10; k++) lamp(c, 70 + (k - 1) * 40, 380, 9, k < next, C.cyan);
    };
  };

  // ------------------------------------------------------------------------------------------
  // Sabotage fixes
  var F = {};

  F.reactor = function (g) {
    var held = false, status = 'Hold to stop meltdown — waiting for second user', glow = 0;
    var PAD = { x: 130, y: 40, w: 240, h: 290 };
    var onHold = g.P.cbs.onHold;
    g.dbg = { pad: { x: PAD.x + PAD.w / 2, y: PAD.y + PAD.h / 2 }, held: false, status: status };
    function setHeld(v) {
      if (held === v) return;
      held = v; g.dbg.held = v;
      if (v) g.sound('task_step');
      call(onHold, v);
    }
    g.setStatus = function (s) { status = String(s == null ? '' : s); g.dbg.status = status; };
    g.onDown = function (p) { if (inRect(p, { x: PAD.x - 10, y: PAD.y - 10, w: PAD.w + 20, h: PAD.h + 20 })) setHeld(true); };
    g.onUp = function () { setHeld(false); };
    g.onTeardown = function () { setHeld(false); };
    g.update = function (dt) { glow = lerp(glow, held ? 1 : 0, Math.min(1, dt * 8)); };
    function hand(c, cx, cy) {
      var fingers = [[-40, -6, -0.22, 64], [-15, -12, -0.07, 82], [10, -12, 0.05, 88], [34, -6, 0.18, 72]];
      function shapes(fn) {
        rr(c, -52, -14, 104, 112, 40); fn();
        for (var i = 0; i < fingers.length; i++) {
          var f = fingers[i];
          c.save(); c.translate(f[0], f[1]); c.rotate(f[2]); rr(c, -11, -f[3], 22, f[3] + 16, 11); fn(); c.restore();
        }
        c.save(); c.translate(42, 58); c.rotate(0.95); rr(c, -11, -66, 22, 72, 11); fn(); c.restore();
      }
      c.save(); c.translate(cx, cy);
      c.lineWidth = 10; c.strokeStyle = held ? '#c9f6ff' : '#52e0ff';
      shapes(function () { c.stroke(); });
      c.fillStyle = 'rgb(' + Math.round(lerp(16, 58, glow)) + ',' + Math.round(lerp(48, 160, glow)) + ',' + Math.round(lerp(62, 192, glow)) + ')';
      shapes(function () { c.fill(); });
      c.restore();
    }
    g.draw = function (c, t) {
      metalBg(c, '#4a2a36', '#24151e');
      // warning stripes
      c.save(); c.beginPath(); c.rect(0, H - 30, W, 30); c.clip();
      for (var s = -40; s < W + 40; s += 40) { c.beginPath(); c.moveTo(s, H); c.lineTo(s + 20, H - 30); c.lineTo(s + 40, H - 30); c.lineTo(s + 20, H); c.closePath(); c.fillStyle = '#ffcc33'; c.fill(); }
      c.restore();
      var pulse = 0.5 + 0.5 * Math.sin(t * 6);
      lamp(c, 60, 60, 16, pulse > 0.5, C.danger); lamp(c, W - 60, 60, 16, pulse <= 0.5, C.danger);
      box(c, PAD.x - 14, PAD.y - 14, PAD.w + 28, PAD.h + 28, 26, '#3a4470', 4);
      box(c, PAD.x, PAD.y, PAD.w, PAD.h, 18, held ? '#0b3a4a' : '#0a1626', 4);
      c.save(); rr(c, PAD.x, PAD.y, PAD.w, PAD.h, 18); c.clip();
      c.strokeStyle = 'rgba(82,224,255,.12)'; c.lineWidth = 1;
      for (var gx = PAD.x; gx < PAD.x + PAD.w; gx += 16) { c.beginPath(); c.moveTo(gx, PAD.y); c.lineTo(gx, PAD.y + PAD.h); c.stroke(); }
      for (var gy = PAD.y; gy < PAD.y + PAD.h; gy += 16) { c.beginPath(); c.moveTo(PAD.x, gy); c.lineTo(PAD.x + PAD.w, gy); c.stroke(); }
      hand(c, PAD.x + PAD.w / 2 - 6, PAD.y + PAD.h / 2 + 10);
      if (held) {
        var sy = PAD.y + ((t * 220) % (PAD.h + 40)) - 20;
        c.save(); c.shadowColor = C.cyan; c.shadowBlur = 20;
        box(c, PAD.x, sy, PAD.w, 6, 3, '#c9f6ff'); c.restore();
        c.globalAlpha = 0.25; c.fillStyle = C.cyan; c.fillRect(PAD.x, sy - 40, PAD.w, 40); c.globalAlpha = 1;
      }
      c.restore();
      // status
      box(c, 34, 344, W - 68, 56, 12, '#11182e', 4);
      c.font = '16px ' + fontD();
      var lines = wrapLines(c, status, W - 96).slice(0, 2);
      for (var i = 0; i < lines.length; i++) txt(c, lines[i], W / 2, 372 + (i - (lines.length - 1) / 2) * 20, 16, held ? C.cyan : C.amber, 'center');
    };
  };

  F.o2 = function (g) {
    var code = '';
    for (var i = 0; i < 5; i++) code += Math.floor(Math.random() * 10);
    var entry = '', err = 0, ok = false, pressed = null;
    var KX = 216, KY = 112, KW = 78, KH = 66, KG = 9;
    var keys = [];
    var labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'ok'];
    for (var k = 0; k < 12; k++) keys.push({ k: labels[k], x: KX + (k % 3) * (KW + KG), y: KY + Math.floor(k / 3) * (KH + KG) });
    var dk = {};
    keys.forEach(function (kk) { dk[kk.k] = { x: kk.x + KW / 2, y: kk.y + KH / 2 }; });
    g.dbg = { code: code, keys: dk, entry: '' };
    function press(k) {
      if (ok) return;
      if (k === 'clr') { entry = ''; g.sound('click'); }
      else if (k === 'ok') {
        if (entry === code) { ok = true; g.step(); g.complete(); }
        else { err = 0.7; entry = ''; g.sound('click'); g.shake(); }
      } else if (entry.length < 5) { entry += k; g.sound('click'); }
      g.dbg.entry = entry;
    }
    g.onDown = function (p) {
      for (var i = 0; i < keys.length; i++) if (inRect(p, { x: keys[i].x, y: keys[i].y, w: KW, h: KH })) { pressed = keys[i].k; press(keys[i].k); return; }
    };
    g.onUp = function () { pressed = null; };
    g.onKey = function (e) {
      if (/^[0-9]$/.test(e.key)) { press(e.key); return true; }
      if (e.key === 'Enter') { press('ok'); return true; }
      if (e.key === 'Backspace') { entry = entry.slice(0, -1); g.dbg.entry = entry; return true; }
      return false;
    };
    g.update = function (dt) { err = Math.max(0, err - dt); };
    g.draw = function (c, t) {
      metalBg(c, '#2f3860', '#1c2242');
      // sticky note
      c.save(); c.translate(108, 170); c.rotate(-0.07);
      box(c, -88, -96, 176, 190, 4, '#05070f');
      c.fillStyle = '#ffe66b'; c.fillRect(-84, -92, 168, 182);
      c.fillStyle = '#f5d54a'; c.fillRect(-84, -92, 168, 26);
      box(c, -22, -102, 44, 18, 3, 'rgba(220,230,255,.65)');
      txt(c, "TODAY'S CODE", 0, -48, 16, '#6a4b00', 'center', { font: "'Comic Sans MS', 'Chalkboard SE', 'Marker Felt', " + fontB(), weight: 'bold' });
      txt(c, code, 0, 6, 40, '#1d2fb0', 'center', { font: "'Comic Sans MS', 'Chalkboard SE', 'Marker Felt', " + fontB(), weight: 'bold' });
      c.beginPath(); c.moveTo(-60, 34); c.lineTo(60, 30); c.lineWidth = 3; c.strokeStyle = '#1d2fb0'; c.stroke();
      txt(c, '- O2 Dept.', 20, 62, 14, '#6a4b00', 'center', { font: "'Comic Sans MS', 'Chalkboard SE', 'Marker Felt', " + fontB() });
      c.restore();
      // display
      screen(c, KX, 28, 3 * KW + 2 * KG, 62, err > 0 ? '#3a0a10' : ok ? '#06301a' : '#081426', 10);
      var shown = '';
      for (var i = 0; i < 5; i++) shown += (i < entry.length ? entry[i] : '_') + (i < 4 ? ' ' : '');
      txt(c, err > 0 ? 'WRONG' : ok ? 'ACCEPTED' : shown, KX + (3 * KW + 2 * KG) / 2, 60, 30, err > 0 ? '#ff6b6b' : ok ? C.green : C.cyan, 'center', { font: "'Courier New', monospace", weight: 'bold' });
      for (var k = 0; k < keys.length; k++) {
        var kk = keys[k];
        var col = kk.k === 'ok' ? C.green : kk.k === 'clr' ? C.danger : '#d9deef';
        var dark = kk.k === 'ok' ? '#1d8a3a' : kk.k === 'clr' ? '#8a1020' : '#7a84a8';
        var lab = kk.k === 'ok' ? '✓' : kk.k === 'clr' ? '✕' : kk.k;
        button(c, { x: kk.x, y: kk.y, w: KW, h: KH - 6 }, lab, { color: col, dark: dark, pressed: pressed === kk.k, size: 28, textColor: kk.k.length > 1 ? '#fff' : '#1b2140', r: 12 });
      }
      txt(c, 'Enter the code from the note', 108, 300, 14, C.dim, 'center', { font: fontB() });
    };
  };

  F.lights = function (g) {
    var N = 5, st = [], pos = [], pressed = -1;
    do { st = []; for (var i = 0; i < N; i++) st.push(Math.random() < 0.5); } while (st.every(Boolean));
    pos = st.map(function (v) { return v ? 1 : 0; });
    function sx(i) { return 70 + i * 90; }
    var SY = 230;
    g.dbg = { states: st, switches: st.map(function (v, i) { return { x: sx(i), y: SY }; }) };
    g.onDown = function (p) {
      for (var i = 0; i < N; i++) {
        if (Math.abs(p.x - sx(i)) < 40 && Math.abs(p.y - SY) < 80) {
          st[i] = !st[i]; pressed = i; g.sound('click');
          if (st.every(Boolean)) { g.step(); g.after(200, g.complete); }
          return;
        }
      }
    };
    g.onUp = function () { pressed = -1; };
    g.update = function (dt) { for (var i = 0; i < N; i++) pos[i] = lerp(pos[i], st[i] ? 1 : 0, Math.min(1, dt * 18)); };
    g.draw = function (c, t) {
      metalBg(c, '#3a3f58', '#24283c');
      // hazard frame
      c.save(); rr(c, 16, 16, W - 32, H - 32, 18); c.clip();
      for (var s = -H; s < W + H; s += 34) { c.beginPath(); c.moveTo(s, 0); c.lineTo(s + 17, 0); c.lineTo(s + 17 - H, H); c.lineTo(s - H, H); c.closePath(); c.fillStyle = '#ffcc33'; c.fill(); }
      c.restore();
      box(c, 16, 16, W - 32, H - 32, 18, null, 4);
      box(c, 34, 34, W - 68, H - 68, 12, '#232a44', 4);
      txt(c, 'ELECTRICAL', W / 2, 66, 22, C.amber, 'center', { outline: 5 });
      var onN = st.filter(Boolean).length;
      box(c, 120, 88, 260, 22, 8, '#0c1022', 3);
      box(c, 123, 91, 254 * onN / N, 16, 5, onN === N ? C.green : C.amber);
      for (var i = 0; i < N; i++) {
        var x = sx(i);
        lamp(c, x, SY - 92, 11, st[i], C.green);
        box(c, x - 30, SY - 70, 60, 140, 12, '#11182e', 4);
        txt(c, 'ON', x, SY - 55, 13, C.dim, 'center');
        txt(c, 'OFF', x, SY + 56, 13, C.dim, 'center');
        box(c, x - 8, SY - 40, 16, 80, 6, '#05070f');
        var ky = lerp(SY + 26, SY - 26, pos[i]);
        box(c, x - 22, ky - 16 + (pressed === i ? 2 : 0), 44, 32, 9, st[i] ? '#e8ecff' : '#8a93b8', 4);
        box(c, x - 14, ky - 4, 28, 4, 2, '#59617f');
      }
      txt(c, 'Flip every switch up', W / 2, H - 58, 15, C.ink, 'center', { font: fontB() });
    };
  };

  F.comms = function (g) {
    var KX = 250, KY = 316, KR = 74, TOL = 7, HOLD = 0.5;
    var target = rnd(0, 360);
    var angle = (target + (Math.random() < 0.5 ? -1 : 1) * rnd(80, 160) + 360) % 360;
    var drag = null, lockT = 0;
    g.dbg = { angle: angle, target: target, tol: TOL, knob: { x: KX, y: KY, r: KR } };
    function pa(p) { return Math.atan2(p.y - KY, p.x - KX) * 180 / Math.PI; }
    g.onDown = function (p) { if (dist(p.x, p.y, KX, KY) < KR + 30) { drag = { a: pa(p) }; } };
    g.onMove = function (p) {
      if (!drag) return;
      var a = pa(p), d = angDiff(a, drag.a);
      drag.a = a;
      angle = ((angle + d) % 360 + 360) % 360;
      g.dbg.angle = angle;
    };
    g.onUp = function () { drag = null; };
    g.update = function (dt) {
      if (Math.abs(angDiff(angle, target)) <= TOL) {
        if (lockT === 0) g.sound('task_step');
        lockT += dt;
        if (lockT >= HOLD) g.complete();
      } else lockT = 0;
      g.dbg.lockT = lockT;
    };
    g.draw = function (c, t) {
      metalBg(c, '#2f3860', '#1c2242');
      var SC = { x: 30, y: 26, w: W - 60, h: 176 };
      screen(c, SC.x, SC.y, SC.w, SC.h, '#04140c', 12);
      var off = Math.abs(angDiff(angle, target));
      var noise = clamp(off / 90, 0, 1), locked = off <= TOL;
      c.save(); rr(c, SC.x, SC.y, SC.w, SC.h, 12); c.clip();
      c.strokeStyle = 'rgba(62,232,107,.15)'; c.lineWidth = 1;
      for (var gx = SC.x; gx < SC.x + SC.w; gx += 22) { c.beginPath(); c.moveTo(gx, SC.y); c.lineTo(gx, SC.y + SC.h); c.stroke(); }
      for (var gy = SC.y; gy < SC.y + SC.h; gy += 22) { c.beginPath(); c.moveTo(SC.x, gy); c.lineTo(SC.x + SC.w, gy); c.stroke(); }
      var mid = SC.y + SC.h / 2, col = locked ? C.green : noise < 0.3 ? C.amber : '#ff6b6b';
      c.beginPath();
      for (var x = 0; x <= SC.w; x += 3) {
        var y = Math.sin(x / 26 + t * 6) * 36 * (1 - noise * 0.6) + (Math.random() - 0.5) * 90 * noise + Math.sin(x / 7 + t * 23) * 14 * noise;
        if (x) c.lineTo(SC.x + x, mid + y); else c.moveTo(SC.x + x, mid + y);
      }
      c.save(); c.shadowColor = col; c.shadowBlur = 10; c.lineWidth = 3; c.strokeStyle = col; c.stroke(); c.restore();
      c.restore();
      var mhz = (88 + angle / 360 * 20).toFixed(1);
      box(c, SC.x + SC.w - 140, SC.y + 10, 128, 28, 7, 'rgba(0,0,0,.6)');
      txt(c, mhz + ' MHz', SC.x + SC.w - 76, SC.y + 24, 15, col, 'center', { font: "'Courier New', monospace", weight: 'bold' });
      box(c, SC.x + 10, SC.y + 10, 156, 28, 7, 'rgba(0,0,0,.6)');
      lamp(c, SC.x + 26, SC.y + 24, 8, locked, C.green);
      txt(c, locked ? 'SIGNAL LOCKED' : 'NO SIGNAL', SC.x + 42, SC.y + 25, 14, locked ? C.green : '#ff6b6b', 'left', { font: "'Courier New', monospace", weight: 'bold' });
      // knob
      circle(c, KX, KY, KR + 26, '#232a48', 4);
      for (var k = 0; k < 36; k++) {
        var a = k / 36 * 6.283, big = k % 3 === 0;
        c.beginPath(); c.moveTo(KX + Math.cos(a) * (KR + 8), KY + Math.sin(a) * (KR + 8)); c.lineTo(KX + Math.cos(a) * (KR + (big ? 20 : 14)), KY + Math.sin(a) * (KR + (big ? 20 : 14)));
        c.lineWidth = big ? 3 : 2; c.strokeStyle = 'rgba(232,236,255,.45)'; c.stroke();
      }
      c.save(); c.translate(KX, KY); c.rotate(angle * Math.PI / 180);
      circle(c, 0, 0, KR, '#7d89bb', 4);
      for (var n = 0; n < 16; n++) { c.save(); c.rotate(n / 16 * 6.283); box(c, KR - 12, -4, 10, 8, 3, '#5d6a9c'); c.restore(); }
      circle(c, 0, 0, KR - 18, vgrad(c, -KR, KR, '#9aa6d4', '#5d6a9c'), 3);
      box(c, 8, -7, KR - 24, 14, 6, locked ? C.green : C.amber, 3);
      c.restore();
      circle(c, KX, KY, 10, '#3a4470', 3);
      txt(c, 'ROTATE', 70, KY, 16, C.dim, 'center');
      txt(c, 'THE DIAL', 70, KY + 20, 16, C.dim, 'center');
      // lock progress
      txt(c, 'LOCK', W - 74, KY - 30, 15, C.dim, 'center');
      box(c, W - 118, KY - 14, 88, 28, 8, '#0c1022', 3);
      if (lockT > 0) box(c, W - 115, KY - 11, 82 * clamp(lockT / HOLD, 0, 1), 22, 6, C.green);
    };
  };

  // ------------------------------------------------------------------------------------------
  // Public API
  IS.tasks = {
    KINDS: KINDS.slice(),
    FIX_KINDS: FIX_KINDS.slice(),
    _debug: { kind: null, state: null, panel: null, toClient: function () { return null; } },

    open: function (kind, opts, cbs) {
      if (KINDS.indexOf(kind) < 0) kind = 'download';
      opts = opts || {};
      var title = opts.title || TITLES[kind];
      var sub = opts.title && opts.title !== TITLES[kind] ? TITLES[kind] : opts.room || null;
      return mount(kind, title, sub, cbs, B[kind], { color: opts.color });
    },

    openFix: function (kind, part, cbs) {
      if (FIX_KINDS.indexOf(kind) < 0) kind = 'lights';
      var sub = kind === 'reactor' ? 'Hand scanner ' + ((part | 0) + 1) + ' of 2' : kind === 'o2' ? 'Panel ' + ((part | 0) + 1) + ' of 2' : 'Sabotage';
      return mount(kind, TITLES[kind], sub, cbs, F[kind], { doneText: 'Sabotage Fixed!' });
    },

    isOpen: function () { return !!(cur && !cur.closed); },

    close: function () { if (cur) closePanel(cur); }
  };
})();
