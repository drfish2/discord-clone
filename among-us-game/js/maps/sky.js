/* Starship Sus — map: Sky Headquarters ('sky').
   A corporate research HQ floating high above the clouds: launchpad + rocket, a long
   decontamination corridor, locker room, a cross-shaped hallway hub with a tree plaza, and
   bright pastel rooms around it. Classic script; registers itself with IS.map.define and adds a
   few vector props of its own via IS.render.registerProp (guarded so it also loads in node). */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});

  // ==========================================================================================
  // Vector props for this map (cartoon style: thick dark outlines, simple two-tone shading)
  // ==========================================================================================
  if (IS.render && IS.render.registerProp && IS.render.kit) (function () {
    var K = IS.render.kit, box = K.box, rr = K.rr, ell = K.ell, fs = K.fillStroke, shade = K.shade,
      hash = K.hash, OL = K.OL, TAU = K.TAU, screen = K.screen, hazard = K.hazard, cylinder = K.cylinder;
    var reg = IS.render.registerProp;
    var PASTEL = { sky: '#bfe0f7', blue: '#8cc6f0', pink: '#f4a7c4', mint: '#93dcc0', yellow: '#f7d774', lilac: '#bba7ec', peach: '#f6b98a' };

    function leaf(c, x, y, r, col) { ell(c, x, y, r, r * 0.92); fs(c, col, OL, 2.2); }
    function bush(c, x, y, s, base) {
      var d = shade(base, -0.25), l = shade(base, 0.25);
      leaf(c, x - 9 * s, y + 2 * s, 9 * s, d); leaf(c, x + 9 * s, y + 2 * s, 9 * s, d);
      leaf(c, x, y - 4 * s, 11 * s, base);
      ell(c, x - 3 * s, y - 8 * s, 4 * s, 2.5 * s); c.fillStyle = l; c.fill();
    }

    // Big white rocket on the launchpad (footprint = fins/base; tall body above)
    reg('rocket', function (c, w, h, ext) {
      var cx = w / 2, base = h - 14, top = -ext + 4, bw = w * 0.42, nose = bw * 1.15;
      ell(c, cx, h - 8, w * 0.48, 12); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
      // nozzle + flame glow
      c.beginPath(); c.moveTo(cx - bw * 0.3, base - 6); c.lineTo(cx + bw * 0.3, base - 6); c.lineTo(cx + bw * 0.42, base + 10); c.lineTo(cx - bw * 0.42, base + 10); c.closePath();
      fs(c, '#4a5274', OL, 2.5);
      // fins
      [-1, 1].forEach(function (s) {
        c.beginPath();
        c.moveTo(cx + s * bw * 0.45, base - 70); c.quadraticCurveTo(cx + s * (bw * 0.5 + 30), base - 30, cx + s * (bw * 0.5 + 26), base + 4);
        c.lineTo(cx + s * bw * 0.45, base - 8); c.closePath();
        fs(c, '#e8424f', OL, 2.5);
      });
      // body
      function bodyPath() {
        c.beginPath();
        c.moveTo(cx - bw / 2, base);
        c.lineTo(cx - bw / 2, top + nose);
        c.bezierCurveTo(cx - bw / 2, top + nose * 0.35, cx - bw * 0.12, top, cx, top);
        c.bezierCurveTo(cx + bw * 0.12, top, cx + bw / 2, top + nose * 0.35, cx + bw / 2, top + nose);
        c.lineTo(cx + bw / 2, base);
        c.quadraticCurveTo(cx, base + 8, cx - bw / 2, base);
        c.closePath();
      }
      var g = c.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#eef2fa'); g.addColorStop(1, '#b9c4dc');
      bodyPath(); c.fillStyle = g; c.fill();
      c.save(); bodyPath(); c.clip();
      c.fillStyle = '#e8424f'; c.fillRect(cx - bw, top - 4, bw * 2, nose * 0.62);
      c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(cx + bw * 0.22, top, bw, base - top + 10);
      c.fillStyle = '#e8424f'; c.fillRect(cx - bw, base - 46, bw * 2, 12);
      c.fillStyle = '#3b6fd8'; c.fillRect(cx - bw, base - 34, bw * 2, 5);
      c.restore();
      bodyPath(); c.strokeStyle = OL; c.lineWidth = 3; c.stroke();
      // porthole
      var py = top + nose + 30;
      ell(c, cx, py, 14, 14); fs(c, '#c9d3e6', OL, 2.5);
      ell(c, cx, py, 9, 9); var gg = c.createRadialGradient(cx - 3, py - 3, 1, cx, py, 10);
      gg.addColorStop(0, '#d8f4ff'); gg.addColorStop(1, '#3d8fd8'); fs(c, gg, OL, 1.5);
      // centre fin
      rr(c, cx - 4, base - 64, 8, 64, 3); fs(c, '#c8303c', OL, 2);
      // label
      c.fillStyle = '#3b6fd8'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center';
      c.save(); c.translate(cx - bw * 0.18, base - 92); c.rotate(-Math.PI / 2); c.fillText('SKY-1', 0, 4); c.restore();
    }, 200);

    // Launch tower next to the rocket: red/white truss with an access arm
    reg('gantry', function (c, w, h, ext) {
      var x0 = 6, x1 = w - 6, top = -ext + 8, bot = h - 6;
      ell(c, w / 2, h - 6, w * 0.5, 9); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
      rr(c, 0, h - 16, w, 14, 3); fs(c, '#7d869c', OL, 2.5);
      c.strokeStyle = OL; c.lineWidth = 6;
      c.beginPath(); c.moveTo(x0, bot - 8); c.lineTo(x0, top); c.moveTo(x1, bot - 8); c.lineTo(x1, top); c.stroke();
      c.strokeStyle = '#e8424f'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(x0, bot - 8); c.lineTo(x0, top); c.moveTo(x1, bot - 8); c.lineTo(x1, top); c.stroke();
      var n = 7, step = (bot - 8 - top) / n;
      for (var i = 0; i < n; i++) {
        var y = top + i * step;
        c.strokeStyle = OL; c.lineWidth = 4;
        c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.moveTo(x0, y); c.lineTo(x1, y + step); c.stroke();
        c.strokeStyle = i & 1 ? '#f4f6fb' : '#e8424f'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.moveTo(x0, y); c.lineTo(x1, y + step); c.stroke();
      }
      // access arm reaching toward the rocket + beacon
      rr(c, x1 - 2, top + step * 1.5, 26, 8, 2); fs(c, '#c9d3e6', OL, 2);
      rr(c, x0 - 4, top - 6, x1 - x0 + 8, 8, 2); fs(c, '#f4f6fb', OL, 2);
      ell(c, w / 2, top - 10, 5, 5); fs(c, '#ffd23f', OL, 1.5);
    }, 150);

    // Launch-pad floor marking (flat)
    reg('padmark', function (c, w, h) {
      var cx = w / 2, cy = h / 2, rx = w / 2 - 4, ry = h / 2 - 4;
      c.save(); ell(c, cx, cy, rx, ry); c.clip();
      hazard(c, 0, 0, w, h);
      c.restore();
      ell(c, cx, cy, rx, ry); c.strokeStyle = OL; c.lineWidth = 3; c.stroke();
      ell(c, cx, cy, rx - 14, ry - 14); fs(c, '#7d869c', OL, 2.5);
      ell(c, cx, cy, rx - 26, ry - 26); c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 3; c.setLineDash([10, 8]); c.stroke(); c.setLineDash([]);
      c.fillStyle = 'rgba(0,0,0,0.18)'; ell(c, cx, cy, rx * 0.35, ry * 0.35); c.fill();
    });

    // Locker (stands against a wall); tint picks the door colour
    reg('locker', function (c, w, h, ext, p) {
      var col = PASTEL[p.tint] || PASTEL.blue;
      box(c, 1, 0, w - 2, h - 2, ext, shade(col, 0.35), col, 4);
      var fy = -ext + h - 2;                      // top of the front face
      c.strokeStyle = 'rgba(16,19,31,0.45)'; c.lineWidth = 2;
      for (var i = 0; i < 3; i++) { c.beginPath(); c.moveTo(8, fy + 8 + i * 5); c.lineTo(w - 8, fy + 8 + i * 5); c.stroke(); }
      rr(c, w - 12, fy + (ext * 0.45), 4, 14, 2); fs(c, '#f2f4fa', OL, 1.5);
      c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(5, fy + 26, 3, ext - 34);
    }, 66);

    // Wooden bench
    reg('bench', function (c, w, h, ext) {
      c.fillStyle = '#5a3f2a';
      [8, w - 14].forEach(function (x) { c.fillRect(x, -ext + h - 6, 6, ext + 2); });
      box(c, 1, 0, w - 2, h - 6, 10, '#d9a86c', '#a8743e', 5);
      c.strokeStyle = 'rgba(80,45,15,0.35)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(6, -10 + (h - 6) / 2); c.lineTo(w - 6, -10 + (h - 6) / 2); c.stroke();
    }, 18);

    // Laboratory bench with flasks and a microscope
    reg('labbench', function (c, w, h, ext) {
      box(c, 1, 0, w - 2, h - 2, ext, '#f4f7fc', '#c3cde0', 6);
      var ty = -ext + 4;
      c.fillStyle = 'rgba(80,95,130,0.25)'; c.fillRect(10, -ext + h - 10, w - 20, 3);
      var cols = ['#5fe3ff', '#ff7ab8', '#9be86a', '#ffd23f'];
      for (var i = 0; i < 3; i++) {
        var fx = 16 + i * 22, fy = ty + 26;
        c.beginPath(); c.moveTo(fx - 3, fy - 22); c.lineTo(fx + 3, fy - 22); c.lineTo(fx + 3, fy - 13); c.lineTo(fx + 9, fy); c.lineTo(fx - 9, fy); c.lineTo(fx - 3, fy - 13); c.closePath();
        fs(c, 'rgba(225,240,255,0.9)', OL, 2);
        c.beginPath(); c.moveTo(fx - 6, fy - 5); c.lineTo(fx + 6, fy - 5); c.lineTo(fx + 8, fy - 1); c.lineTo(fx - 8, fy - 1); c.closePath();
        c.fillStyle = cols[i]; c.fill();
      }
      // microscope
      var mx = w - 34, my = ty + 28;
      ell(c, mx, my, 13, 5); fs(c, '#3e486c', OL, 2);
      c.save(); c.translate(mx, my - 6); c.rotate(-0.35);
      rr(c, -4, -30, 8, 30, 3); fs(c, '#e9edf6', OL, 2);
      rr(c, -6, -36, 12, 8, 3); fs(c, '#3e486c', OL, 2);
      c.restore();
      rr(c, mx - 12, my - 12, 16, 4, 2); fs(c, '#3e486c', OL, 1.5);
      // petri dish
      ell(c, w / 2 + 6, ty + 22, 9, 4.5); fs(c, 'rgba(180,255,190,0.85)', OL, 1.8);
    }, 32);

    // Raised garden bed with leafy plants
    reg('planter', function (c, w, h, ext) {
      box(c, 1, 0, w - 2, h - 2, 22, '#8a5a36', '#a66e44', 6);
      rr(c, 6, -22 + 4, w - 12, h - 12, 5); fs(c, '#5a3a22', null);
      var n = Math.max(2, Math.round(w / 34));
      for (var i = 0; i < n; i++) {
        var x = 18 + i * (w - 36) / (n - 1), y = -22 + h / 2 - 4 + (i & 1) * 4;
        bush(c, x, y, 0.95 + hash(i, w | 0) * 0.3, ['#58b84a', '#6fcf55', '#4aa05c'][i % 3]);
        if (hash(w | 0, i) < 0.5) { ell(c, x + 6, y - 10, 3.5, 3.5); fs(c, ['#ff8fc8', '#ffd84a', '#ff6a5a'][i % 3], OL, 1.2); }
      }
    }, 44);

    // Potted tree (round prop)
    reg('tree', function (c, w, h, ext) {
      var cx = w / 2, cy = h / 2;
      ell(c, cx, cy + 6, w * 0.48, h * 0.32); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
      cylinder(c, cx - w * 0.36, cy - h * 0.28, w * 0.72, h * 0.56, 18, '#e7ecf6', '#aab5cc', '#7a5434');
      c.fillStyle = '#6b4a2b'; c.fillRect(cx - 5, -ext * 0.45, 10, ext * 0.45 + cy - 14);
      c.strokeStyle = OL; c.lineWidth = 2; c.strokeRect(cx - 5, -ext * 0.45, 10, ext * 0.45 + cy - 14);
      var top = -ext + 34, R = Math.min(w * 0.5, 40);
      var blobs = [[-0.55, 0.25, 0.55], [0.55, 0.25, 0.55], [0, 0.45, 0.6], [-0.3, -0.2, 0.6], [0.32, -0.2, 0.6], [0, -0.45, 0.55]];
      blobs.forEach(function (b, i) { leaf(c, cx + b[0] * R, top + b[1] * R, b[2] * R, i < 3 ? '#3f9a46' : '#56b84e'); });
      ell(c, cx - R * 0.2, top - R * 0.5, R * 0.18, R * 0.1); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fill();
    }, 96);

    // Office desk with monitor
    reg('desk', function (c, w, h, ext) {
      box(c, 1, 0, w - 2, h - 2, ext, '#f5f0e6', '#cbbfa6', 5);
      var ty = -ext + 6;
      rr(c, w / 2 - 24, ty - 18, 48, 30, 4); fs(c, '#3e486c', OL, 2.5);
      screen(c, w / 2 - 20, ty - 14, 40, 22, '#5fe3ff');
      c.fillStyle = '#3e486c'; c.fillRect(w / 2 - 3, ty + 12, 6, 6);
      rr(c, w / 2 - 18, ty + 20, 36, 7, 2); fs(c, '#e2e6f0', OL, 1.5);
      rr(c, 10, ty + 8, 16, 12, 2); fs(c, '#ffffff', OL, 1.5); // papers
      ell(c, w - 18, ty + 14, 5, 5); fs(c, '#f2a65a', OL, 1.5);  // mug
    }, 28);

    // Lounge sofa
    reg('sofa', function (c, w, h, ext, p) {
      var col = PASTEL[p.tint] || PASTEL.lilac, dk = shade(col, -0.22);
      box(c, 2, 0, w - 4, h - 2, ext, shade(col, 0.15), dk, 10);            // back + base
      rr(c, 14, -ext + h * 0.45, w - 28, h * 0.55 + 6, 6); fs(c, col, OL, 2);  // seat cushions
      c.strokeStyle = 'rgba(16,19,31,0.35)'; c.lineWidth = 2;
      for (var i = 1; i < 3; i++) { c.beginPath(); c.moveTo(14 + i * (w - 28) / 3, -ext + h * 0.45 + 3); c.lineTo(14 + i * (w - 28) / 3, -ext + h + 4); c.stroke(); }
      [2, w - 16].forEach(function (x) { rr(c, x, -ext + h * 0.25, 14, h * 0.75 + ext * 0.55, 6); fs(c, dk, OL, 2); });
    }, 26);

    // Snack vending machine (stands against a wall)
    reg('vending', function (c, w, h, ext) {
      box(c, 1, 0, w - 2, h - 2, ext, '#ff9fb8', '#e8546f', 5);
      var fy = -ext + h + 2;
      rr(c, 7, fy + 2, w - 26, ext - 18, 3); fs(c, '#cfeaff', OL, 2);
      var snack = ['#ffd23f', '#5fe3ff', '#9be86a', '#ff7a4a', '#bba7ec'];
      for (var r = 0; r < 4; r++) for (var k = 0; k < 3; k++) {
        c.fillStyle = snack[(r * 3 + k) % 5]; c.fillRect(11 + k * (w - 34) / 3, fy + 6 + r * (ext - 26) / 4, (w - 34) / 3 - 3, 7);
      }
      rr(c, w - 16, fy + 6, 9, 12, 2); fs(c, '#3e486c', OL, 1.5);
      rr(c, w - 16, fy + 24, 9, 5, 1); fs(c, '#1b2033', null);
      c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(9, fy + 4, 3, ext - 24);
    }, 78);

    // Balcony railing: posts, glass panel and a hand rail
    reg('railing', function (c, w, h, ext) {
      var y0 = h * 0.4;
      rr(c, 0, y0 - ext + 4, w, ext - 4, 2); c.fillStyle = 'rgba(200,235,255,0.35)'; c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2;
      for (var x = 20; x < w - 10; x += 46) { c.beginPath(); c.moveTo(x, y0 - 6); c.lineTo(x + 14, y0 - ext + 10); c.stroke(); }
      for (x = 2; x <= w - 2; x += (w - 4) / Math.max(1, Math.round(w / 48))) {
        rr(c, x - 3, y0 - ext + 2, 6, ext, 2); fs(c, '#e9edf6', OL, 2);
      }
      rr(c, -2, y0 - ext - 2, w + 4, 8, 4); fs(c, '#f4f6fb', OL, 2.5);
      c.fillStyle = '#9aa6c2'; c.fillRect(0, y0 + 2, w, 4);
    }, 34);

    // Telescope on a tripod (balcony)
    reg('telescope', function (c, w, h, ext) {
      var cx = w / 2, by = h - 10;
      ell(c, cx, by + 2, w * 0.42, 8); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
      c.strokeStyle = OL; c.lineWidth = 5;
      var hy = -ext * 0.25;
      [[-w * 0.36, 0], [w * 0.36, 0], [0, -6]].forEach(function (l) { c.beginPath(); c.moveTo(cx, hy); c.lineTo(cx + l[0], by + l[1]); c.stroke(); });
      c.strokeStyle = '#7a86a6'; c.lineWidth = 2.5;
      [[-w * 0.36, 0], [w * 0.36, 0], [0, -6]].forEach(function (l) { c.beginPath(); c.moveTo(cx, hy); c.lineTo(cx + l[0], by + l[1]); c.stroke(); });
      c.save(); c.translate(cx, hy - 6); c.rotate(-0.6);
      rr(c, -14, -10, 52, 18, 6); fs(c, '#f4f6fb', OL, 2.5);
      rr(c, 30, -12, 12, 22, 4); fs(c, '#3b6fd8', OL, 2.5);
      rr(c, -24, -6, 12, 10, 3); fs(c, '#3e486c', OL, 2);
      c.restore();
      ell(c, cx, hy - 4, 6, 6); fs(c, '#3e486c', OL, 2);
    }, 58);

    // Server rack with blinking LEDs (comms)
    reg('server', function (c, w, h, ext) {
      box(c, 1, 0, w - 2, h - 2, ext, '#5b6790', '#39436a', 4);
      var fy = -ext + h;
      for (var i = 0; i < 5; i++) {
        var y = fy + 4 + i * (ext - 6) / 5;
        rr(c, 6, y, w - 12, (ext - 6) / 5 - 3, 2); fs(c, '#262d47', null);
        for (var k = 0; k < 3; k++) { c.fillStyle = hash(i, k + (w | 0)) < 0.5 ? '#6dff9a' : (hash(k, i) < 0.5 ? '#5fe3ff' : '#ffc44d'); c.fillRect(10 + k * 6, y + 3, 3, 3); }
      }
    }, 64);

    // Wall window looking out onto the sky
    reg('skywindow', function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 7); fs(c, '#f4f6fb', OL, 2.5);
      rr(c, 4, 4, w - 8, h - 10, 5);
      var g = c.createLinearGradient(0, 4, 0, h - 6); g.addColorStop(0, '#6aa8ec'); g.addColorStop(1, '#bfe0ff');
      fs(c, g, OL, 1.5);
      c.save(); rr(c, 4, 4, w - 8, h - 10, 5); c.clip();
      c.fillStyle = '#ffffff';
      var cx = 8 + hash(w | 0, 3) * (w - 16), cy = h - 12;
      ell(c, cx, cy, 9, 5); c.fill(); ell(c, cx + 8, cy - 3, 7, 5); c.fill(); ell(c, cx - 9, cy + 1, 6, 4); c.fill();
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(9, h - 13); c.lineTo(w * 0.45, 8); c.stroke();
    });

    // Decontamination sprayer panel (wall)
    reg('decon', function (c, w, h) {
      rr(c, 0, 0, w, h - 2, 5); fs(c, '#dfe5f0', OL, 2.5);
      c.fillStyle = '#5fe3ff'; c.fillRect(5, 5, w - 10, 4);
      for (var i = 0; i < 3; i++) {
        var x = 9 + i * (w - 18) / 2;
        rr(c, x - 4, 13, 8, 10, 2); fs(c, '#7a86a6', OL, 1.5);
        c.fillStyle = 'rgba(160,230,255,0.75)';
        c.beginPath(); c.moveTo(x - 2, 23); c.lineTo(x + 2, 23); c.lineTo(x + 6, h - 4); c.lineTo(x - 6, h - 4); c.closePath(); c.fill();
      }
    });

    // Decontamination floor grate (flat)
    reg('deconpad', function (c, w, h) {
      rr(c, 2, 2, w - 4, h - 4, 6); fs(c, '#5c6b8a', OL, 2.5);
      c.fillStyle = 'rgba(95,227,255,0.55)';
      for (var y = 8; y < h - 8; y += 8) c.fillRect(8, y, w - 16, 3);
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2; rr(c, 6, 6, w - 12, h - 12, 4); c.stroke();
    });

    // Round hub planter bench (round prop around the plaza tree is the tree itself) — floor rug
    reg('rug', function (c, w, h, ext, p) {
      var col = PASTEL[p.tint] || PASTEL.peach;
      rr(c, 2, 2, w - 4, h - 4, 12); fs(c, col, 'rgba(16,19,31,0.55)', 2.5);
      rr(c, 9, 9, w - 18, h - 18, 8); c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 3; c.setLineDash([8, 6]); c.stroke(); c.setLineDash([]);
    });
  })();

  if (!IS.map || !IS.map.define) return;

  // ==========================================================================================
  // Map: Sky Headquarters
  // ==========================================================================================
  IS.map.define('sky', {
    name: 'Sky Headquarters', short: 'Sky HQ',
    blurb: 'A sunny research HQ floating above the clouds, with a rocket launchpad and a greenhouse.',
    W: 88, H: 59,
    theme: {
      bg: 'sky', void: '#5d8fd0', hall: ['#d3dcec', '#c8d2e5'], hallFloor: 'carpet',
      wall: { top: '#e3e9f4', topHi: '#ffffff', faceA: '#f4f7fc', faceB: '#c4cee2', base: '#8994b3' }
    },
    rooms: [
      { id: 'reactor', name: 'Reactor', x: 5, y: 4, w: 12, h: 11, ch: { tl: 3 }, floor: 'tech', tint: ['#8d8fb6', '#8587ad'], label: [0, 4.4] },
      { id: 'laboratory', name: 'Laboratory', x: 21, y: 5, w: 14, h: 10, floor: 'carpet', tint: ['#dfe9f3', '#d2deec'], label: [0, 3.6] },
      { id: 'greenhouse', name: 'Greenhouse', x: 39, y: 3, w: 17, h: 12, ch: { tl: 2, tr: 2 }, floor: 'grass', tint: ['#86c96e', '#7cc066'], label: [0, 0.6] },
      { id: 'office', name: 'Office', x: 60, y: 4, w: 13, h: 10, floor: 'carpet', tint: ['#93a7d8', '#8a9ed1'], label: [0, 4.0] },
      { id: 'admin', name: 'Admin', x: 76, y: 5, w: 10, h: 9, floor: 'wood', tint: ['#cfa173', '#c4966a'], label: [0, 3.4] },
      { id: 'communications', name: 'Communications', x: 59, y: 18, w: 10, h: 7, floor: 'tech', tint: ['#93a3c6', '#8b9bbf'], label: [0, 1.0] },
      { id: 'launchpad', name: 'Launchpad', x: 2, y: 20, w: 14, h: 16, ch: { tl: 3, bl: 3 }, floor: 'dirt', tint: ['#b4bccb', '#acb4c4'], label: [0, 5.8] },
      { id: 'decon', name: 'Decontamination', x: 19, y: 28, w: 12, h: 4, floor: 'carpet', tint: ['#cbe5f3', '#bcdcee'], label: [0, 0.3] },
      { id: 'lockers', name: 'Locker Room', x: 34, y: 23, w: 9, h: 13, floor: 'wood', tint: ['#dcbb90', '#d2b085'], label: [0, 3.1] },
      { id: 'medbay', name: 'MedBay', x: 34, y: 41, w: 11, h: 9, floor: 'carpet', tint: ['#d2efe9', '#c5e7e0'], label: [0.8, 3.2] },
      { id: 'storage', name: 'Storage', x: 48, y: 47, w: 11, h: 10, floor: 'dirt', tint: ['#c7bca5', '#bfb49d'], label: [0, 3.6] },
      { id: 'cafeteria', name: 'Cafeteria', x: 64, y: 26, w: 19, h: 15, ch: { tl: 3, tr: 3, bl: 3, br: 3 }, floor: 'carpet', tint: ['#f6e4c6', '#eed8b4'], label: [0, 5.4] },
      { id: 'balcony', name: 'Balcony', x: 61, y: 47, w: 24, h: 7, floor: 'wood', tint: ['#c08f60', '#b58456'], label: [0, -1.2] }
    ],
    corridors: [
      [17, 8, 4, 3],    // reactor <-> laboratory
      [35, 8, 4, 3],    // laboratory <-> greenhouse
      [56, 7, 4, 3],    // greenhouse <-> office
      [73, 8, 3, 3],    // office <-> admin
      [9, 15, 3, 5],    // reactor <-> launchpad
      [16, 28, 3, 4],   // launchpad <-> decontamination
      [31, 28, 3, 4],   // decontamination <-> locker room
      [48, 15, 3, 32],  // hub: north-south arm (greenhouse <-> storage)
      [45, 27, 9, 9],   // hub: central plaza
      [43, 30, 3, 3],   // hub: west arm -> locker room
      [53, 30, 11, 3],  // hub: east arm -> cafeteria
      [60, 25, 3, 5],   // east arm -> communications
      [45, 43, 3, 3],   // north-south arm -> medbay
      [77, 14, 3, 12],  // admin <-> cafeteria
      [70, 41, 4, 6],   // cafeteria <-> balcony
      [59, 49, 2, 3]    // storage <-> balcony
    ],

    author: function (A) {
      var prop = A.prop, roundProp = A.roundProp, wallProp = A.wallProp,
        addStation = A.addStation, addFix = A.addFix, addVent = A.addVent, setButton = A.setButton;
      function solid(key, x, y, w, h, room, tint) { return prop(key, x, y, w, h, { solid: true, room: room, tint: tint }); }

      // ---- Cafeteria / lounge (spawn) ----
      var btn = roundProp('emergency', 73.5, 33.2, 0.92, { room: 'cafeteria' });
      btn.use = { x: Math.round(73.5 * A.T), y: Math.round(33.2 * A.T) };
      setButton(btn);
      [[67.6, 29.6], [79.4, 29.6], [67.6, 37.4], [79.4, 37.4]].forEach(function (c) {
        roundProp('prop_table', c[0], c[1], 1.1, { room: 'cafeteria' });
      });
      addStation('garbage', 'cafeteria', wallProp('chute', 'cafeteria', 68, 1.0));
      wallProp('prop_screen', 'cafeteria', 73, 1.6);
      wallProp('skywindow', 'cafeteria', 75, 1.0);
      wallProp('skywindow', 'cafeteria', 71, 1.0);
      solid('vending', 69.5, 26.05, 1.4, 0.9, 'cafeteria');
      solid('sofa', 75.8, 40.05, 3.0, 0.9, 'cafeteria', 'pink');
      prop('prop_plant', 64.2, 31.0, 0.7, 0.7, { solid: true, room: 'cafeteria' });
      prop('prop_plant', 82.1, 31.0, 0.7, 0.7, { solid: true, room: 'cafeteria' });

      // ---- Balcony ----
      for (var i = 0; i < 6; i++) solid('railing', 61 + i * 4, 53.25, 4, 0.75, 'balcony');
      addStation('asteroids', 'balcony', solid('telescope', 77.4, 50.2, 1.2, 1.2, 'balcony'), 78.0, 51.85);
      solid('telescope', 65.0, 50.2, 1.2, 1.2, 'balcony');
      solid('bench', 68.5, 48.0, 3.0, 0.7, 'balcony');
      solid('planter', 79.6, 47.05, 3.0, 1.2, 'balcony');
      solid('planter', 62.0, 47.05, 3.0, 1.2, 'balcony');

      // ---- Admin ----
      prop('admintable', 78.6, 8.2, 4.0, 2.2, { solid: true, room: 'admin' });
      addStation('swipe', 'admin', wallProp('cardslot', 'admin', 83));
      addFix('o2', 1, 'admin', wallProp('keypad', 'admin', 78));
      wallProp('skywindow', 'admin', 80, 1.0);
      prop('prop_plant', 76.2, 12.9, 0.7, 0.7, { solid: true, room: 'admin' });
      prop('prop_chair', 81.2, 11.0, 0.8, 0.8, { room: 'admin' });

      // ---- Office ----
      addStation('download', 'office', solid('desk', 61.6, 6.4, 2.4, 1.2, 'office'), 62.8, 8.15);
      solid('desk', 65.6, 6.4, 2.4, 1.2, 'office');
      solid('desk', 61.6, 10.0, 2.4, 1.2, 'office');
      addStation('divert', 'office', wallProp('divert', 'office', 69, 0.9));
      addStation('garbage', 'office', wallProp('chute', 'office', 71, 1.0));
      wallProp('skywindow', 'office', 62, 1.0);
      wallProp('skywindow', 'office', 66, 1.0);
      prop('prop_chair', 62.4, 7.75, 0.8, 0.8, { room: 'office' });
      prop('prop_chair', 66.4, 7.75, 0.8, 0.8, { room: 'office' });
      prop('prop_chair', 62.4, 11.35, 0.8, 0.8, { room: 'office' });
      solid('sofa', 68.6, 11.8, 3.0, 1.0, 'office', 'blue');
      prop('prop_plant', 60.15, 12.9, 0.7, 0.7, { solid: true, room: 'office' });

      // ---- Communications ----
      addFix('comms', 0, 'communications', wallProp('commspanel', 'communications', 61, 1.0));
      addStation('download', 'communications', prop('prop_console', 64.6, 18.05, 1.7, 1.0, { solid: true, room: 'communications', tint: 'green' }), 65.45, 19.55);
      wallProp('prop_screen', 'communications', 67, 1.0);
      solid('server', 67.8, 21.0, 1.0, 1.0, 'communications');
      solid('server', 67.8, 22.6, 1.0, 1.0, 'communications');
      prop('prop_chair', 65.0, 19.7, 0.8, 0.8, { room: 'communications' });

      // ---- Greenhouse ----
      addStation('leaves', 'greenhouse', wallProp('o2filter', 'greenhouse', 42, 1.0));
      addStation('wires', 'greenhouse', wallProp('wallpanel', 'greenhouse', 45));
      addFix('o2', 0, 'greenhouse', wallProp('keypad', 'greenhouse', 49));
      addStation('leaves', 'greenhouse', wallProp('o2filter', 'greenhouse', 53, 1.0));
      solid('planter', 41.0, 7.4, 3.2, 1.4, 'greenhouse');
      solid('planter', 51.8, 7.4, 3.2, 1.4, 'greenhouse');
      solid('planter', 46.2, 9.8, 3.6, 1.4, 'greenhouse');
      roundProp('tree', 41.6, 12.4, 0.75, { room: 'greenhouse' });
      roundProp('tree', 54.0, 12.2, 0.75, { room: 'greenhouse' });
      prop('prop_plant', 44.0, 13.6, 0.7, 0.7, { solid: true, room: 'greenhouse' });

      // ---- Laboratory ----
      addStation('calibrate', 'laboratory', wallProp('calib', 'laboratory', 23, 0.9));
      addStation('download', 'laboratory', prop('prop_console', 27.6, 5.05, 1.7, 1.0, { solid: true, room: 'laboratory', tint: 'cyan' }), 28.45, 6.55);
      addStation('divert', 'laboratory', wallProp('divert', 'laboratory', 33, 0.9));
      solid('labbench', 22.6, 9.6, 4.4, 1.2, 'laboratory');
      solid('labbench', 28.6, 9.6, 4.4, 1.2, 'laboratory');
      wallProp('skywindow', 'laboratory', 25, 1.0);
      wallProp('skywindow', 'laboratory', 31, 1.0);
      prop('cabinet', 21.2, 13.0, 1.8, 1.0, { solid: true, room: 'laboratory' });

      // ---- Reactor ----
      roundProp('prop_reactor', 11.0, 9.4, 1.6, { room: 'reactor' });
      addFix('reactor', 0, 'reactor', wallProp('handscan', 'reactor', 9, 0.9));
      addFix('reactor', 1, 'reactor', solid('handstand', 14.45, 13.15, 1.1, 0.8, 'reactor'), 15.0, 12.75);
      addStation('numbers', 'reactor', prop('prop_console', 12.4, 4.05, 1.7, 1.0, { solid: true, room: 'reactor', tint: 'cyan' }), 13.25, 5.55);
      addStation('wires', 'reactor', wallProp('wallpanel', 'reactor', 15));
      prop('prop_barrel', 5.3, 9.0, 0.8, 0.8, { solid: true, room: 'reactor' });
      prop('prop_barrel', 5.3, 10.0, 0.8, 0.8, { solid: true, room: 'reactor' });

      // ---- Launchpad ----
      prop('padmark', 5.0, 24.6, 7.0, 6.4, { flat: true, room: 'launchpad' });
      solid('rocket', 6.9, 27.0, 3.2, 1.9, 'launchpad');
      addStation('fuel', 'launchpad', solid('fuelport', 11.0, 29.9, 1.0, 0.5, 'launchpad'), 11.5, 30.8);
      addStation('align', 'launchpad', prop('prop_console', 12.8, 20.05, 1.7, 1.0, { solid: true, room: 'launchpad', tint: 'amber' }), 13.65, 21.55);
      prop('prop_crate', 3.3, 32.0, 1.4, 1.1, { solid: true, room: 'launchpad' });
      prop('prop_crate', 4.9, 32.4, 1.0, 0.8, { solid: true, room: 'launchpad' });
      solid('gantry', 4.7, 27.2, 1.4, 1.4, 'launchpad');
      prop('prop_barrel', 13.9, 33.0, 0.8, 0.8, { solid: true, room: 'launchpad', tint: 'fuel' });
      prop('prop_barrel', 14.9, 33.0, 0.8, 0.8, { solid: true, room: 'launchpad', tint: 'fuel' });

      // ---- Decontamination ----
      [21, 25, 29].forEach(function (c) { wallProp('decon', 'decon', c, 1.0); });
      prop('deconpad', 19.1, 28.1, 1.8, 3.8, { flat: true, room: 'decon' });
      prop('deconpad', 29.1, 28.1, 1.8, 3.8, { flat: true, room: 'decon' });

      // ---- Locker Room ----
      ['blue', 'pink', 'mint', 'yellow', 'lilac'].forEach(function (t, k) {
        solid('locker', 34.1 + k * 1.0, 23.05, 1.0, 0.75, 'lockers', t);
      });
      addStation('wires', 'lockers', wallProp('wallpanel', 'lockers', 40));
      addFix('lights', 0, 'lockers', wallProp('breaker', 'lockers', 42, 0.9));
      solid('bench', 35.0, 33.8, 3.4, 0.7, 'lockers');
      prop('rug', 36.0, 27.0, 4.0, 3.0, { flat: true, room: 'lockers', tint: 'mint' });
      prop('prop_plant', 34.15, 26.6, 0.7, 0.7, { solid: true, room: 'lockers' });

      // ---- MedBay ----
      prop('prop_bed', 34.3, 41.4, 1.6, 2.4, { solid: true, room: 'medbay' });
      prop('prop_bed', 34.3, 44.9, 1.6, 2.4, { solid: true, room: 'medbay' });
      addStation('scan', 'medbay', prop('scanpad', 38.6, 44.6, 1.7, 1.7, { flat: true, room: 'medbay' }), 39.45, 45.45);
      prop('cabinet', 40.6, 41.0, 1.8, 1.0, { solid: true, room: 'medbay' });
      wallProp('skywindow', 'medbay', 38, 1.0);
      prop('prop_plant', 34.2, 48.9, 0.7, 0.7, { solid: true, room: 'medbay' });

      // ---- Storage ----
      prop('prop_crate', 52.0, 48.6, 1.6, 1.3, { solid: true, room: 'storage' });
      prop('prop_crate', 53.7, 49.0, 1.1, 0.9, { solid: true, room: 'storage' });
      prop('prop_crate', 51.8, 52.4, 2.4, 1.6, { solid: true, room: 'storage' });
      prop('prop_crate', 48.4, 54.6, 1.4, 1.2, { solid: true, room: 'storage' });
      prop('prop_crate', 55.8, 52.2, 1.3, 1.1, { solid: true, room: 'storage' });
      addStation('fuel', 'storage', prop('prop_barrel', 57.9, 55.0, 0.8, 0.85, { solid: true, room: 'storage', tint: 'fuel' }), 57.6, 54.55);
      prop('prop_barrel', 56.9, 55.0, 0.8, 0.85, { solid: true, room: 'storage' });
      addStation('wires', 'storage', wallProp('wallpanel', 'storage', 56));

      // ---- Hub plaza ----
      prop('rug', 45.4, 27.4, 8.2, 8.2, { flat: true, tint: 'sky' });
      roundProp('tree', 49.5, 31.4, 0.95);

      // ---- Vents: one big ring, like a single connected duct network ----
      var V = [
        [14.4, 34.4, 'launchpad'], [6.6, 13.3, 'reactor'], [33.4, 13.4, 'laboratory'], [40.6, 10.6, 'greenhouse'],
        [71.4, 9.4, 'office'], [84.4, 12.4, 'admin'], [81.6, 34.4, 'cafeteria'], [83.6, 50.6, 'balcony'],
        [49.6, 49.6, 'storage'], [43.4, 48.6, 'medbay'], [41.6, 34.4, 'lockers'], [46.2, 34.6, 'hall']
      ];
      V.forEach(function (v, k) {
        addVent(v[0], v[1], v[2], [(k + V.length - 1) % V.length, (k + 1) % V.length]);
      });
    }
  });
})();
