/* Starship Sus — map: Polar Outpost.
   A research base on a frozen planet: separate buildings (labs, offices, comms, weapons, a
   greenhouse, a seismic lab ...) joined by snowy outdoor trails and plazas. Classic script;
   registers its own vector props (keys prefixed 'pol_') and the map def with IS.map.define. */
(function () {
  'use strict';
  var IS = (window.IS = window.IS || {});
  if (!IS.map || !IS.map.define) return;

  // ==========================================================================================
  // Vector props (browser only; the map itself also loads in node)
  // ==========================================================================================
  var R = IS.render;
  if (R && R.registerProp && R.kit) (function () {
    var K = R.kit, OL = K.OL, ell = K.ell, fs = K.fillStroke, rr = K.rr, box = K.box, TAU = K.TAU;
    function reg(key, ext, fn) { R.registerProp(key, fn, ext); }
    function shadow(c, x, y, rx, ry, a) { ell(c, x, y, rx, ry); c.fillStyle = 'rgba(40,60,100,' + (a || 0.22) + ')'; c.fill(); }
    function lin(c, x0, y0, x1, y1, stops) {
      var g = c.createLinearGradient(x0, y0, x1, y1);
      for (var i = 0; i < stops.length; i++) g.addColorStop(i / (stops.length - 1), stops[i]);
      return g;
    }
    function line(c, pts, color, lw) {
      c.beginPath(); c.moveTo(pts[0], pts[1]);
      for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
      c.strokeStyle = color; c.lineWidth = lw || 2; c.stroke();
    }

    // Snow-capped boulder (round). tint 'b' = flatter variant.
    reg('pol_rock', 26, function (c, w, h, ext, p) {
      var flat = p.tint === 'b', top = h * 0.5 - ext * (flat ? 0.7 : 1);
      shadow(c, w / 2, h * 0.7, w * 0.52, h * 0.24);
      function path() {
        c.beginPath();
        c.moveTo(w * 0.02, h * 0.7);
        c.lineTo(w * 0.07, h * 0.42 - ext * 0.35);
        c.lineTo(w * 0.28, top + 7);
        c.lineTo(w * (flat ? 0.6 : 0.52), top);
        c.lineTo(w * 0.8, top + 9);
        c.lineTo(w * 0.97, h * 0.46 - ext * 0.25);
        c.lineTo(w * 0.99, h * 0.72);
        c.quadraticCurveTo(w * 0.5, h * 0.94, w * 0.02, h * 0.7);
        c.closePath();
      }
      path(); c.fillStyle = '#7f8aa1'; c.fill();
      c.save(); path(); c.clip();
      c.beginPath(); c.moveTo(w * 0.52, top); c.lineTo(w * 0.62, h * 0.5); c.lineTo(w * 0.45, h); c.lineTo(w + 4, h); c.lineTo(w + 4, top - 10); c.closePath();
      c.fillStyle = '#5f6a82'; c.fill();
      // snow cap with a wavy lower edge
      c.beginPath(); c.moveTo(-4, -ext - 12);
      c.lineTo(w + 4, -ext - 12);
      var capY = top + (h * 0.7 - top) * 0.42;
      for (var x = w + 4; x >= -4; x -= 6) c.lineTo(x, capY + Math.sin(x * 0.21) * 4 + (x / w) * 3);
      c.closePath(); c.fillStyle = '#f4f8fd'; c.fill();
      c.fillStyle = 'rgba(150,175,210,0.45)';
      c.fillRect(w * 0.55, top, w * 0.5, capY - top + 4);
      c.restore();
      path(); c.strokeStyle = OL; c.lineWidth = 2.5; c.stroke();
    });

    // Soft snow drift (round).
    reg('pol_snowpile', 22, function (c, w, h, ext) {
      shadow(c, w / 2, h * 0.72, w * 0.5, h * 0.22, 0.18);
      c.beginPath(); c.moveTo(w * 0.01, h * 0.72);
      c.bezierCurveTo(w * 0.04, h * 0.3 - ext * 1.2, w * 0.5, h * 0.2 - ext * 1.4, w * 0.62, h * 0.4 - ext * 0.9);
      c.bezierCurveTo(w * 0.8, h * 0.2 - ext * 0.6, w * 1.0, h * 0.4 - ext * 0.3, w * 0.99, h * 0.72);
      c.quadraticCurveTo(w * 0.5, h * 0.92, w * 0.01, h * 0.72); c.closePath();
      fs(c, lin(c, 0, -ext, 0, h, ['#ffffff', '#e4edf7', '#b9cbe2']), OL, 2.5);
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.fillRect(w * 0.3, h * 0.25 - ext * 0.9, 3, 3); c.fillRect(w * 0.7, h * 0.4 - ext * 0.6, 2.5, 2.5);
    });

    // Cluster of ice crystals (round).
    reg('pol_ice', 70, function (c, w, h, ext) {
      shadow(c, w / 2, h * 0.68, w * 0.5, h * 0.24, 0.2);
      var base = h * 0.66;
      var cr = [[0.26, 0.55, 0.26, -6], [0.74, 0.62, 0.24, 7], [0.5, 1.0, 0.32, 1], [0.35, 0.35, 0.18, -10], [0.64, 0.3, 0.17, 10]];
      cr.forEach(function (k, i) {
        var x = w * k[0], H = ext * k[1] + 6, cw = w * k[2], t = k[3], b = base + (i > 2 ? 4 : 0);
        c.beginPath();
        c.moveTo(x - cw / 2, b); c.lineTo(x - cw / 2 + t, b - H); c.lineTo(x + t, b - H - cw * 0.6);
        c.lineTo(x + cw / 2 + t, b - H); c.lineTo(x + cw / 2, b); c.closePath();
        fs(c, lin(c, x - cw / 2, 0, x + cw / 2, 0, ['#e6f8ff', '#9fdcfb', '#5aaee0']), OL, 2.2);
        c.beginPath(); c.moveTo(x, b); c.lineTo(x + t, b - H); c.lineTo(x + t, b - H - cw * 0.6);
        c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.5; c.stroke();
      });
    });

    // Snowman with a scarf (round).
    reg('pol_snowman', 52, function (c, w, h, ext) {
      var cx = w / 2, by = h * 0.55;
      shadow(c, cx, h * 0.72, w * 0.46, h * 0.2);
      var white = lin(c, 0, -ext, 0, h, ['#ffffff', '#dfe9f5']);
      ell(c, cx, by, w * 0.44, w * 0.38); fs(c, white, OL, 2.5);
      ell(c, cx, by - w * 0.56, w * 0.33, w * 0.3); fs(c, white, OL, 2.5);
      ell(c, cx, by - w * 1.0, w * 0.25, w * 0.23); fs(c, white, OL, 2.5);
      // arms
      line(c, [cx - w * 0.3, by - w * 0.6, cx - w * 0.62, by - w * 0.85, cx - w * 0.7, by - w * 0.8], '#6b4a2a', 2.5);
      line(c, [cx + w * 0.3, by - w * 0.6, cx + w * 0.62, by - w * 0.9], '#6b4a2a', 2.5);
      // scarf
      rr(c, cx - w * 0.28, by - w * 0.82, w * 0.56, 6, 3); fs(c, '#d83a3a', OL, 1.6);
      rr(c, cx + w * 0.06, by - w * 0.8, 6, 14, 2); fs(c, '#d83a3a', OL, 1.6);
      // face
      c.fillStyle = OL;
      c.beginPath(); c.arc(cx - 4, by - w * 1.04, 1.8, 0, TAU); c.arc(cx + 4, by - w * 1.04, 1.8, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(cx, by - w * 0.99); c.lineTo(cx + 10, by - w * 0.96); c.lineTo(cx, by - w * 0.93); c.closePath(); fs(c, '#ff8a2a', OL, 1.2);
      c.fillStyle = '#34405c'; c.beginPath(); c.arc(cx, by - w * 0.5, 1.8, 0, TAU); c.arc(cx, by - w * 0.36, 1.8, 0, TAU); c.fill();
      // hat
      rr(c, cx - w * 0.26, by - w * 1.2, w * 0.52, 5, 2); fs(c, '#2a2f44', OL, 1.6);
      rr(c, cx - w * 0.16, by - w * 1.2 - 12, w * 0.32, 14, 2); fs(c, '#2a2f44', OL, 1.6);
    });

    // Outdoor lamp post with a warm glow (round collider).
    reg('pol_lamp', 96, function (c, w, h, ext) {
      var cx = w / 2, top = -ext + 16;
      var g = c.createRadialGradient(cx, top, 2, cx, top, w * 0.5 + 10);
      g.addColorStop(0, 'rgba(255,220,140,0.75)'); g.addColorStop(1, 'rgba(255,220,140,0)');
      c.fillStyle = g; c.fillRect(-12, top - w * 0.5 - 10, w + 24, w + 20);
      shadow(c, cx, h * 0.6, w * 0.3, h * 0.18, 0.25);
      rr(c, cx - 3, top + 6, 6, h * 0.6 - top - 6, 2); fs(c, '#3a4466', OL, 1.8);
      rr(c, cx - 7, h * 0.6 - 8, 14, 9, 3); fs(c, '#4b567c', OL, 2);
      c.beginPath(); c.moveTo(cx - 10, top + 6); c.lineTo(cx - 6, top - 6); c.lineTo(cx + 6, top - 6); c.lineTo(cx + 10, top + 6); c.closePath();
      fs(c, '#ffe6a6', OL, 2);
      rr(c, cx - 8, top - 11, 16, 6, 2); fs(c, '#3a4466', OL, 1.8);
    });

    // Radio mast with a small dish and a blinking red light.
    reg('pol_antenna', 120, function (c, w, h, ext) {
      var cx = w / 2, top = -ext + 12, bot = h * 0.55;
      shadow(c, cx, h * 0.62, w * 0.45, h * 0.24);
      line(c, [cx - w * 0.32, bot, cx - 3, top, cx + 3, top, cx + w * 0.32, bot], OL, 5);
      line(c, [cx - w * 0.32, bot, cx - 3, top, cx + 3, top, cx + w * 0.32, bot], '#c9d1e3', 2.5);
      for (var i = 1; i < 6; i++) {
        var t = i / 6, y = bot + (top - bot) * t, hw = w * 0.32 * (1 - t) + 3;
        var t2 = (i - 1) / 6, y2 = bot + (top - bot) * t2, hw2 = w * 0.32 * (1 - t2) + 3;
        line(c, [cx - hw, y, cx + hw2, y2], 'rgba(60,70,100,0.8)', 1.4);
        line(c, [cx - hw, y, cx + hw, y], '#9aa4bf', 1.6);
      }
      rr(c, cx - w * 0.4, bot - 4, w * 0.8, h * 0.4, 4); fs(c, '#5d6990', OL, 2.2);
      // dish
      c.save(); c.translate(cx + 9, top + 34); c.rotate(-0.5);
      ell(c, 0, 0, 13, 7); fs(c, '#eef2f8', OL, 2); ell(c, 0, 0, 7, 3.5); c.fillStyle = 'rgba(80,95,130,0.35)'; c.fill();
      c.restore();
      ell(c, cx, top - 3, 4.5, 4.5); fs(c, '#ff4b4b', OL, 1.6);
      ell(c, cx - 1, top - 4, 1.6, 1.6); c.fillStyle = '#ffd0d0'; c.fill();
    });

    // Big satellite dish on a pedestal.
    reg('pol_dish', 84, function (c, w, h, ext) {
      var cx = w / 2;
      shadow(c, cx, h * 0.66, w * 0.48, h * 0.26);
      box(c, cx - w * 0.22, h * 0.3, w * 0.44, h * 0.5, 22, '#7d89aa', '#4e587a', 6);
      rr(c, cx - 6, -ext * 0.45, 12, ext * 0.45 + h * 0.3 - 18, 3); fs(c, '#56628a', OL, 2);
      c.save(); c.translate(cx - 4, -ext * 0.48); c.rotate(-0.45);
      ell(c, 0, 4, w * 0.44, w * 0.22); fs(c, '#9aa6c3', OL, 2.5);
      ell(c, 0, 0, w * 0.44, w * 0.22); fs(c, lin(c, 0, -w * 0.2, 0, w * 0.2, ['#ffffff', '#cfd8ea']), OL, 2.5);
      ell(c, 0, 0, w * 0.28, w * 0.13); c.strokeStyle = 'rgba(80,95,130,0.35)'; c.lineWidth = 2; c.stroke();
      line(c, [-w * 0.3, 2, 0, -w * 0.28, w * 0.3, 2], OL, 3.5);
      line(c, [-w * 0.3, 2, 0, -w * 0.28, w * 0.3, 2], '#c9d1e3', 1.8);
      ell(c, 0, -w * 0.29, 5, 5); fs(c, '#ffc44d', OL, 1.6);
      c.restore();
    });

    // Drilling rig: platform, derrick tower and drill string.
    reg('pol_drill', 128, function (c, w, h, ext) {
      var cx = w * 0.42, top = -ext + 8;
      shadow(c, w / 2, h * 0.72, w * 0.52, h * 0.26);
      // derrick behind the platform
      var bw = w * 0.26, by = h * 0.25;
      line(c, [cx - bw, by, cx - 6, top, cx + 6, top, cx + bw, by], OL, 6);
      line(c, [cx - bw, by, cx - 6, top, cx + 6, top, cx + bw, by], '#f2b632', 3);
      for (var i = 0; i < 6; i++) {
        var t = i / 6, t2 = (i + 1) / 6;
        var y = by + (top - by) * t, y2 = by + (top - by) * t2, hw = bw * (1 - t) + 6 * t, hw2 = bw * (1 - t2) + 6 * t2;
        line(c, [cx - hw, y, cx + hw2, y2, cx - hw2, y2], '#c98a1a', 1.6);
      }
      rr(c, cx - 12, top - 8, 24, 9, 3); fs(c, '#5d6990', OL, 2);
      line(c, [cx, top, cx, h * 0.4], '#3a4466', 3);
      // platform
      box(c, 2, h * 0.32, w - 4, h * 0.6, 30, '#8f9ab6', '#566184', 6);
      K.hazard(c, 8, h * 0.92 - 12, w - 16, 7);
      // engine housing
      box(c, w * 0.66, h * 0.36, w * 0.28, h * 0.36, 30, '#f2b632', '#b07a14', 5);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      for (i = 0; i < 4; i++) c.fillRect(w * 0.69 + i * 7, h * 0.36 - 22, 3, 12);
      // drill head into the hole
      ell(c, cx, h * 0.32 - 22, 14, 6); fs(c, '#2a2f44', OL, 2);
      rr(c, cx - 5, h * 0.32 - 60, 10, 40, 3); fs(c, '#b7c0d6', OL, 2);
      c.fillStyle = 'rgba(0,0,0,0.25)'; for (i = 0; i < 4; i++) c.fillRect(cx - 5, h * 0.32 - 56 + i * 9, 10, 2);
    });

    // Landed dropship (big, solid).
    reg('pol_dropship', 70, function (c, w, h, ext) {
      shadow(c, w / 2, h * 0.86, w * 0.48, h * 0.18, 0.28);
      var x0 = w * 0.1, bw = w * 0.8, y0 = h * 0.12, bh = h * 0.55, H = ext - 6;
      // landing legs
      [[0.2, 0], [0.8, 0]].forEach(function (l) {
        var lx = w * l[0];
        line(c, [lx, y0 + bh - H * 0.2, lx - 8, h * 0.86, lx + 8, h * 0.86], OL, 5);
        line(c, [lx, y0 + bh - H * 0.2, lx - 8, h * 0.86, lx + 8, h * 0.86], '#8f9ab6', 2.5);
      });
      // engines at the rear (left)
      for (var i = 0; i < 2; i++) {
        var ey = y0 + bh * 0.12 + i * bh * 0.42 - H * 0.55;
        rr(c, w * 0.01, ey, w * 0.14, bh * 0.36, 8); fs(c, '#5d6990', OL, 2.5);
        ell(c, w * 0.02, ey + bh * 0.18, 6, bh * 0.14); fs(c, '#232a40', OL, 2);
      }
      // tail fin
      c.beginPath(); c.moveTo(w * 0.14, y0 - H + 8); c.lineTo(w * 0.06, y0 - H - 14); c.lineTo(w * 0.24, y0 - H - 14); c.lineTo(w * 0.34, y0 - H + 8); c.closePath();
      fs(c, '#ef7d2d', OL, 2.5);
      // hull slab
      box(c, x0, y0, bw, bh, H, '#eef2f8', '#aab5cc', 34);
      // nose (right) and cockpit glass
      c.save(); rr(c, x0, y0 - H, bw, bh, 34); c.clip();
      c.fillStyle = 'rgba(120,140,180,0.18)'; c.fillRect(x0 + bw * 0.55, y0 - H, bw * 0.45, bh);
      c.restore();
      rr(c, x0 + bw * 0.74, y0 - H + bh * 0.18, bw * 0.2, bh * 0.64, 18);
      fs(c, lin(c, 0, y0 - H, 0, y0 - H + bh, ['#bff3ff', '#3fb4e0', '#1d5f8e']), OL, 2.5);
      c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(x0 + bw * 0.79, y0 - H + bh * 0.28, 4, bh * 0.3);
      // orange stripe along the front face
      c.fillStyle = '#ef7d2d'; c.fillRect(x0 + 18, y0 + bh - H + 8, bw - 36, 7);
      c.fillStyle = OL; c.fillRect(x0 + 18, y0 + bh - H + 15, bw - 36, 1.5);
      // roof hatch and number
      rr(c, x0 + bw * 0.26, y0 - H + bh * 0.25, bw * 0.3, bh * 0.5, 8); fs(c, '#d8dfec', 'rgba(60,70,100,0.5)', 2);
      c.font = 'bold 16px "Russo One", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(60,70,110,0.55)'; c.fillText('PX-7', x0 + bw * 0.41, y0 - H + bh * 0.5);
      // side door with ramp
      rr(c, x0 + bw * 0.48, y0 + bh - H + 18, bw * 0.16, H - 20, 4); fs(c, '#2a3150', OL, 2);
      c.beginPath(); c.moveTo(x0 + bw * 0.48, y0 + bh - 2); c.lineTo(x0 + bw * 0.64, y0 + bh - 2);
      c.lineTo(x0 + bw * 0.67, h * 0.95); c.lineTo(x0 + bw * 0.45, h * 0.95); c.closePath();
      fs(c, '#8f9ab6', OL, 2.2);
      c.fillStyle = 'rgba(0,0,0,0.25)'; for (i = 1; i < 4; i++) c.fillRect(x0 + bw * 0.47, y0 + bh - 2 + i * (h * 0.95 - y0 - bh) / 4, bw * 0.18, 1.5);
      // marker lights
      ell(c, x0 + 22, y0 + bh - H + 30, 3.5, 3.5); fs(c, '#ff4b4b', OL, 1.2);
      ell(c, x0 + bw - 22, y0 + bh - H + 30, 3.5, 3.5); fs(c, '#5aff8a', OL, 1.2);
    });

    // Telescope on a rotating base.
    reg('pol_telescope', 92, function (c, w, h, ext) {
      var cx = w / 2, by = h * 0.55;
      shadow(c, cx, h * 0.7, w * 0.46, h * 0.24);
      ell(c, cx, by + 6, w * 0.42, h * 0.3); fs(c, '#353f60', OL, 2.5);
      ell(c, cx, by, w * 0.4, h * 0.27); fs(c, '#56628a', OL, 2.5);
      rr(c, cx - 10, by - 44, 20, 44, 5); fs(c, '#6f7a99', OL, 2.2);
      c.save(); c.translate(cx, by - 44); c.rotate(-0.62);
      rr(c, -w * 0.28, -14, w * 0.78, 28, 10); fs(c, lin(c, 0, -14, 0, 14, ['#f2f5fb', '#c7d0e3', '#8e9abb']), OL, 2.5);
      rr(c, w * 0.42, -17, 16, 34, 6); fs(c, '#3e486c', OL, 2.2);
      ell(c, w * 0.58, 0, 4, 13); fs(c, '#5fe3ff', OL, 1.6);
      rr(c, -w * 0.34, -9, 12, 18, 4); fs(c, '#3e486c', OL, 2);
      c.fillStyle = '#ffc44d'; c.fillRect(w * 0.05, -14, 6, 28);
      c.restore();
      ell(c, cx, by - 44, 8, 8); fs(c, '#3e486c', OL, 2);
    });

    // Lab bench with flasks and a microscope.
    reg('pol_labbench', 44, function (c, w, h, ext) {
      var H = ext - 18;
      box(c, 1, 2, w - 2, h - 3, H, '#eef2f8', '#9aa6bf', 5);
      c.fillStyle = 'rgba(60,70,100,0.25)'; c.fillRect(8, h - H + 6, w - 16, 2);
      var ty = -H + h * 0.62;
      // flask
      c.beginPath(); c.moveTo(w * 0.12, ty - 18); c.lineTo(w * 0.12 + 6, ty - 18); c.lineTo(w * 0.12 + 13, ty); c.lineTo(w * 0.12 - 7, ty); c.closePath();
      fs(c, 'rgba(110,255,160,0.85)', OL, 1.8);
      // test tube rack
      rr(c, w * 0.3, ty - 6, 26, 7, 2); fs(c, '#5d6990', OL, 1.6);
      ['#ff6ad5', '#5fe3ff', '#ffd84d'].forEach(function (cc, i) { rr(c, w * 0.3 + 3 + i * 8, ty - 20, 5, 16, 2.5); fs(c, cc, OL, 1.4); });
      // beaker
      rr(c, w * 0.55, ty - 14, 13, 14, 2); fs(c, 'rgba(200,230,255,0.6)', OL, 1.6);
      c.fillStyle = 'rgba(120,180,255,0.8)'; c.fillRect(w * 0.55 + 2, ty - 7, 9, 6);
      // microscope
      var mx = w * 0.82;
      rr(c, mx - 10, ty - 4, 20, 6, 2); fs(c, '#3e486c', OL, 1.6);
      line(c, [mx + 4, ty - 4, mx + 4, ty - 16, mx - 2, ty - 24], OL, 5);
      line(c, [mx + 4, ty - 4, mx + 4, ty - 16, mx - 2, ty - 24], '#c7d0e3', 2.5);
      ell(c, mx - 3, ty - 25, 3.5, 3.5); fs(c, '#3e486c', OL, 1.4);
    });

    // Specimen tank: glass cylinder with a floating creature.
    reg('pol_specimen', 90, function (c, w, h, ext) {
      var x0 = 4, ww = w - 8, ry = Math.min(h / 2, ww * 0.28), base = h - ry - 2, top = -ext + 12;
      shadow(c, w / 2, h - ry, w * 0.5, ry + 2);
      // glass + liquid
      c.save();
      c.beginPath(); c.rect(x0, top, ww, base - top); c.clip();
      c.fillStyle = lin(c, x0, 0, x0 + ww, 0, ['rgba(70,200,150,0.85)', 'rgba(150,255,200,0.75)', 'rgba(50,160,120,0.9)']);
      c.fillRect(x0, top + 8, ww, base - top);
      // creature
      var cx = w / 2, cy = (top + base) / 2 - 2;
      c.fillStyle = 'rgba(70,40,110,0.85)';
      ell(c, cx, cy - 6, ww * 0.24, ww * 0.22); c.fill();
      for (var i = 0; i < 4; i++) {
        c.beginPath(); c.moveTo(cx - ww * 0.18 + i * ww * 0.12, cy);
        c.quadraticCurveTo(cx - ww * 0.26 + i * ww * 0.16, cy + 14, cx - ww * 0.16 + i * ww * 0.1, cy + 24);
        c.strokeStyle = 'rgba(70,40,110,0.85)'; c.lineWidth = 3; c.stroke();
      }
      c.fillStyle = '#fff'; ell(c, cx - 4, cy - 8, 3, 3.5); c.fill(); ell(c, cx + 5, cy - 8, 3, 3.5); c.fill();
      c.fillStyle = OL; ell(c, cx - 4, cy - 7, 1.4, 1.8); c.fill(); ell(c, cx + 5, cy - 7, 1.4, 1.8); c.fill();
      // bubbles + glass shine
      c.fillStyle = 'rgba(255,255,255,0.7)';
      for (i = 0; i < 5; i++) { ell(c, x0 + 6 + K.hash(i, 3) * (ww - 12), top + 12 + K.hash(3, i) * (base - top - 20), 1.8, 1.8); c.fill(); }
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x0 + 5, top, 4, base - top);
      c.restore();
      c.beginPath(); c.moveTo(x0, top); c.lineTo(x0, base); c.moveTo(x0 + ww, top); c.lineTo(x0 + ww, base);
      c.strokeStyle = OL; c.lineWidth = 2.5; c.stroke();
      // base and cap
      K.cylinder(c, x0 - 2, base - ry, ww + 4, ry * 2 + 2, 10, '#6f7a99', '#3e486c', '#8f9ab6');
      ell(c, w / 2, top, ww / 2 + 2, ry * 0.8); fs(c, '#8f9ab6', OL, 2.5);
      rr(c, w / 2 - 5, top - 10, 10, 8, 2); fs(c, '#3e486c', OL, 1.6);
    });

    // Seismic stabilizer: anchored drum with pistons and an orange core (round, big).
    reg('pol_stabilizer', 104, function (c, w, h, ext) {
      var r = w / 2, base = h * 0.62;
      var glow = c.createRadialGradient(r, base - ext * 0.45, 8, r, base - ext * 0.45, w * 0.6);
      glow.addColorStop(0, 'rgba(255,150,60,0.35)'); glow.addColorStop(1, 'rgba(255,150,60,0)');
      c.fillStyle = glow; c.fillRect(-12, -ext - 12, w + 24, h + ext + 24);
      ell(c, r, base + 6, r, h * 0.34); fs(c, '#2f3654', OL, 3);
      ell(c, r, base - 2, r * 0.92, h * 0.3); fs(c, '#59648a', OL, 2.5);
      K.hazard(c, r - r * 0.5, base - 6, r, 8);
      // pistons
      [-1, 1].forEach(function (s) {
        var px = r + s * r * 0.62;
        rr(c, px - 6, base - ext * 0.62, 12, ext * 0.62 - 4, 4); fs(c, '#b7c0d6', OL, 2);
        rr(c, px - 9, base - ext * 0.66, 18, 10, 3); fs(c, '#56628a', OL, 2);
      });
      // drum
      K.cylinder(c, r - w * 0.3, base - 30, w * 0.6, 28, ext - 34, '#8f9ab6', '#4e587a', '#a9b4cf');
      // glowing seismic window
      var wy = base - ext * 0.62;
      rr(c, r - w * 0.18, wy, w * 0.36, 26, 6); fs(c, '#2a1a10', OL, 2);
      c.save(); rr(c, r - w * 0.18, wy, w * 0.36, 26, 6); c.clip();
      c.fillStyle = 'rgba(255,140,50,0.35)'; c.fillRect(r - w * 0.18, wy, w * 0.36, 26);
      c.beginPath(); c.moveTo(r - w * 0.18, wy + 13);
      for (var i = 0; i <= 12; i++) c.lineTo(r - w * 0.18 + i * w * 0.03, wy + 13 + Math.sin(i * 1.9) * (i % 3 === 1 ? 9 : 4));
      c.strokeStyle = '#ffb04a'; c.lineWidth = 2; c.stroke();
      c.restore();
    });

    // Power relay pylon with insulators.
    reg('pol_pylon', 72, function (c, w, h, ext) {
      shadow(c, w / 2, h * 0.7, w * 0.5, h * 0.24);
      box(c, 2, h * 0.15, w - 4, h * 0.7, 26, '#8c94a8', '#5b6380', 5);
      K.hazard(c, 8, h * 0.85 - 12, w - 16, 6);
      [0.25, 0.75].forEach(function (f) {
        var px = w * f, y0 = h * 0.15 - 20;
        rr(c, px - 3, -ext + 8, 6, y0 + ext - 8, 2); fs(c, '#3e486c', OL, 1.6);
        for (var i = 0; i < 3; i++) { ell(c, px, -ext + 14 + i * 8, 7, 3); fs(c, '#b0d8ff', OL, 1.4); }
      });
      c.beginPath(); c.moveTo(w * 0.25, -ext + 12); c.quadraticCurveTo(w / 2, -ext + 26, w * 0.75, -ext + 12);
      c.strokeStyle = OL; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#ffd23f';
      var bx = w / 2, byy = h * 0.15 - 14;
      c.beginPath(); c.moveTo(bx + 2, byy - 9); c.lineTo(bx - 5, byy + 1); c.lineTo(bx, byy + 1); c.lineTo(bx - 2, byy + 9); c.lineTo(bx + 5, byy - 2); c.lineTo(bx, byy - 2); c.closePath();
      fs(c, '#ffd23f', OL, 1.4);
    });

    // Weather station: pole, sensor box and spinning anemometer.
    reg('pol_weather', 92, function (c, w, h, ext) {
      var cx = w / 2, top = -ext + 16;
      shadow(c, cx, h * 0.62, w * 0.4, h * 0.22);
      line(c, [cx - w * 0.3, h * 0.6, cx, h * 0.6 - 24, cx + w * 0.3, h * 0.6], OL, 4);
      line(c, [cx - w * 0.3, h * 0.6, cx, h * 0.6 - 24, cx + w * 0.3, h * 0.6], '#8f9ab6', 2);
      rr(c, cx - 3, top, 6, h * 0.6 - top, 2); fs(c, '#5d6990', OL, 1.6);
      rr(c, cx - w * 0.36, -ext * 0.4, w * 0.72, 26, 4); fs(c, '#eef2f8', OL, 2.2);
      K.screen(c, cx - w * 0.26, -ext * 0.4 + 5, w * 0.52, 12, '#6dff9a');
      line(c, [cx - 16, top, cx + 16, top], OL, 2.5);
      ell(c, cx - 16, top, 4.5, 3.5); fs(c, '#ffc44d', OL, 1.4);
      ell(c, cx + 16, top, 4.5, 3.5); fs(c, '#ffc44d', OL, 1.4);
      ell(c, cx, top - 6, 4.5, 3.5); fs(c, '#ffc44d', OL, 1.4);
      line(c, [cx, top, cx, top - 6], OL, 2);
    });

    // Snow rover (6 wheels).
    reg('pol_rover', 46, function (c, w, h, ext) {
      shadow(c, w / 2, h * 0.8, w * 0.5, h * 0.22, 0.26);
      for (var i = 0; i < 3; i++) { ell(c, w * 0.2 + i * w * 0.3, h * 0.82, 11, 9); fs(c, '#2a2f44', OL, 2.2); ell(c, w * 0.2 + i * w * 0.3, h * 0.82, 4, 3.5); c.fillStyle = '#8f9ab6'; c.fill(); }
      box(c, 4, h * 0.1, w - 8, h * 0.6, ext - 14, '#ef7d2d', '#b04f14', 8);
      rr(c, w * 0.58, h * 0.1 - ext + 18, w * 0.34, h * 0.42, 6);
      fs(c, lin(c, 0, -ext, 0, h * 0.5, ['#bff3ff', '#3fb4e0']), OL, 2);
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(w * 0.62, h * 0.1 - ext + 22, 3, h * 0.25);
      rr(c, w * 0.12, h * 0.1 - ext + 20, w * 0.36, h * 0.3, 4); fs(c, '#d8dfec', 'rgba(60,40,20,0.5)', 1.5);
      ell(c, w - 8, h * 0.7 - ext + 22, 4, 4); fs(c, '#fff6c0', OL, 1.4);
      line(c, [w * 0.2, h * 0.1 - ext + 16, w * 0.15, -ext + 2], OL, 2);
      ell(c, w * 0.15, -ext + 2, 2.5, 2.5); fs(c, '#ff4b4b', OL, 1);
    });

    // Frozen puddle (flat on the floor).
    reg('pol_icepatch', 0, function (c, w, h) {
      ell(c, w / 2, h / 2, w / 2 - 1, h / 2 - 1);
      fs(c, lin(c, 0, 0, w, h, ['#d8f1ff', '#a9d8f2', '#c9eaff']), 'rgba(70,120,170,0.55)', 2);
      ell(c, w / 2, h / 2, w * 0.36, h * 0.3); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 2; c.stroke();
      c.strokeStyle = 'rgba(80,130,180,0.4)'; c.lineWidth = 1.3;
      c.beginPath();
      c.moveTo(w * 0.3, h * 0.35); c.lineTo(w * 0.42, h * 0.5); c.lineTo(w * 0.38, h * 0.68);
      c.moveTo(w * 0.42, h * 0.5); c.lineTo(w * 0.6, h * 0.46); c.lineTo(w * 0.72, h * 0.6);
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.fillRect(w * 0.25, h * 0.28, w * 0.12, 2); c.fillRect(w * 0.62, h * 0.66, w * 0.08, 2);
    });

    // Bookshelf (office / admin).
    reg('pol_shelf', 62, function (c, w, h, ext) {
      box(c, 1, 0, w - 2, h - 2, ext, '#a77b4f', '#7a5534', 4);
      var fy = h - 2 - ext + 2, fh = ext - 6;
      c.fillStyle = '#4a321e'; c.fillRect(6, fy + 2, w - 12, fh);
      var cols = ['#d84a4a', '#4a8bd8', '#e8c040', '#4ab86a', '#9a5ad8', '#e8e8f0'];
      for (var s = 0; s < 2; s++) {
        var sy = fy + 4 + s * fh / 2, bh = fh / 2 - 6;
        for (var x = 8, i = 0; x < w - 12; i++) {
          var bw = 5 + K.hash(i, s + (w | 0)) * 5;
          c.fillStyle = cols[(i + s * 2) % cols.length]; c.fillRect(x, sy + (i % 3) * 1.5, bw, bh - (i % 3) * 1.5);
          x += bw + 1.5;
        }
        c.fillStyle = '#7a5534'; c.fillRect(6, sy + bh, w - 12, 3);
      }
    });

    // Wooden desk with a monitor and papers.
    reg('pol_desk', 46, function (c, w, h, ext) {
      var H = ext - 20;
      box(c, 1, 2, w - 2, h - 3, H, '#b58a5c', '#80603e', 5);
      var ty = -H + h * 0.55;
      rr(c, w * 0.12, ty - 4, w * 0.22, 8, 1); fs(c, '#f4f6fb', 'rgba(60,70,100,0.5)', 1.2);
      rr(c, w * 0.5, ty - 22, w * 0.34, 20, 3); fs(c, '#2a3150', OL, 2);
      K.screen(c, w * 0.5 + 3, ty - 19, w * 0.34 - 6, 13, '#5fe3ff');
      rr(c, w * 0.66 - 3, ty - 2, 6, 5, 1); fs(c, '#2a3150', OL, 1.2);
      ell(c, w * 0.4, ty + 2, 4, 3); fs(c, '#d84a4a', OL, 1.2);
    });

    // Wooden signpost; the text comes from p.tint (sprites are cached per tint).
    reg('pol_sign', 58, function (c, w, h, ext, p) {
      var txt = String(p.tint || '').toUpperCase(), top = -ext + 4, bh = 30;
      shadow(c, w / 2, h * 0.6, w * 0.42, h * 0.3, 0.2);
      [0.16, 0.84].forEach(function (f) { rr(c, w * f - 4, top + 10, 8, h * 0.6 - top - 10, 2); fs(c, '#6b4a2a', OL, 2); });
      rr(c, 2, top, w - 4, bh, 5); fs(c, lin(c, 0, top, 0, top + bh, ['#c9925a', '#a8743f']), OL, 2.5);
      c.fillStyle = 'rgba(70,40,15,0.25)'; c.fillRect(6, top + bh / 2, w - 12, 1.5);
      // snow on the top edge
      rr(c, 4, top - 4, w - 8, 7, 3.5); fs(c, '#f6f9fd', OL, 1.5);
      var font = (IS.assets && IS.assets.FONT_DISPLAY) || '"Russo One", system-ui, sans-serif';
      c.font = '15px ' + font; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(40,20,5,0.45)'; c.fillText(txt, w / 2 + 1, top + bh / 2 + 2.5, w - 14);
      c.fillStyle = '#fff6e6'; c.fillText(txt, w / 2, top + bh / 2 + 1.5, w - 14);
    });

    // Water cooler (office).
    reg('pol_cooler', 54, function (c, w, h, ext) {
      shadow(c, w / 2, h * 0.7, w * 0.45, h * 0.24);
      box(c, 2, 0, w - 4, h - 2, ext - 22, '#eef2f8', '#aab5cc', 4);
      var bx = w / 2, by = -ext + 22 + 2;
      rr(c, bx - w * 0.3, by - 22, w * 0.6, 24, 7); fs(c, 'rgba(120,200,255,0.75)', OL, 2);
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(bx - w * 0.2, by - 18, 3, 16);
      rr(c, bx - 4, by - 26, 8, 5, 2); fs(c, '#4a8bd8', OL, 1.4);
      ell(c, bx - 6, h - ext + 14, 2.5, 2.5); fs(c, '#d84a4a', OL, 1); ell(c, bx + 6, h - ext + 14, 2.5, 2.5); fs(c, '#4a8bd8', OL, 1);
    });

    // Wooden supply crate with a snow-dusted lid (tint 'blue' = metal cargo case).
    reg('pol_crate', 30, function (c, w, h, ext, p) {
      var H = Math.min(ext, h * 0.9), metal = p.tint === 'blue';
      box(c, 1, 0, w - 2, h - 1, H, metal ? '#6f8fc0' : '#c99a5b', metal ? '#41608f' : '#93693a', 4);
      if (metal) {
        c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(6, -H + 6, w - 12, 3);
        c.fillStyle = '#ffd23f'; c.fillRect(w / 2 - 6, h - H + 4, 12, 7);
        c.strokeStyle = OL; c.lineWidth = 1.2; c.strokeRect(w / 2 - 6, h - H + 4, 12, 7);
      } else {
        c.strokeStyle = 'rgba(70,40,15,0.55)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(6, h - H + 3); c.lineTo(w - 6, h - 4); c.moveTo(w - 6, h - H + 3); c.lineTo(6, h - 4); c.stroke();
        c.strokeRect(6, h - H + 3, w - 12, H - 7);
      }
      // snow on the lid
      c.beginPath(); c.moveTo(4, -H + 4);
      for (var x = 4; x <= w - 4; x += 5) c.lineTo(x, -H + 4 + (h - 8) * (0.2 + 0.1 * Math.sin(x * 0.3 + w)));
      c.lineTo(w - 4, -H + 4); c.closePath();
      c.fillStyle = 'rgba(248,251,255,0.92)'; c.fill();
    });

    // Seismograph desk: paper trace, needle and a status lamp.
    reg('pol_seismo', 40, function (c, w, h, ext) {
      var H = ext - 12;
      box(c, 1, 2, w - 2, h - 3, H, '#7d89aa', '#4e587a', 5);
      var px = 8, py = -H + 7, pw = w - 30, ph = h - 16;
      rr(c, px, py, pw, ph, 3); fs(c, '#f6f2e6', OL, 1.8);
      c.beginPath(); c.moveTo(px + 3, py + ph / 2);
      for (var i = 0; i <= 20; i++) c.lineTo(px + 3 + i * (pw - 6) / 20, py + ph / 2 + Math.sin(i * 2.3) * (i % 5 === 2 ? ph * 0.38 : ph * 0.12));
      c.strokeStyle = '#d83a3a'; c.lineWidth = 1.5; c.stroke();
      ell(c, px + pw + 10, py + 6, 5, 5); fs(c, '#ffb04a', OL, 1.5);
      rr(c, px + pw + 5, py + 15, 10, 6, 2); fs(c, '#30374f', OL, 1.2);
      line(c, [px + pw - 2, py + ph / 2, px + pw + 6, py - 8], OL, 2);
    });
  })();

  // ==========================================================================================
  // Map
  // ==========================================================================================
  IS.map.define('polar', {
    name: 'Polar Outpost', short: 'Polar',
    blurb: 'A frozen research base: labs, a seismic lab and a dropship linked by snowy outdoor trails.',
    W: 93, H: 61,
    theme: {
      bg: 'snow', hallFloor: 'snow', hall: ['#e3ebf4', '#dae4ef'], void: '#c9d6e6',
      // snow-capped rock walls: white tops, blue-grey stone faces
      wall: { top: '#e9f0f8', topHi: '#ffffff', faceA: '#8496b0', faceB: '#5f6f8a', base: '#3e4a62' }
    },
    rooms: [
      { id: 'comms', name: 'Comms', x: 3, y: 3, w: 10, h: 8, floor: 'tech', tint: ['#5f6c86', '#596580'], label: [0, 1.6] },
      { id: 'dropship', name: 'Dropship', x: 16, y: 2, w: 18, h: 13, ch: { tl: 2, tr: 3, bl: 3, br: 2 }, floor: 'snow', label: [0, 4.6] },
      { id: 'weapons', name: 'Weapons', x: 38, y: 3, w: 11, h: 10, ch: { tl: 2, tr: 2, bl: 2, br: 2 }, floor: 'tech', tint: ['#5c6780', '#56607a'], label: [0, 2.6] },
      { id: 'o2', name: 'O2 Greenhouse', x: 53, y: 3, w: 14, h: 10, floor: 'grass', tint: ['#5f9a58', '#58904f'], label: [0, 3.3] },
      { id: 'observatory', name: 'Observatory', x: 72, y: 3, w: 15, h: 11, ch: { tr: 3 }, floor: 'tech', tint: ['#4d5675', '#475070'], label: [0, 3.6] },
      { id: 'electrical', name: 'Electrical', x: 3, y: 18, w: 10, h: 9, floor: 'tech', tint: ['#5b6470', '#555e6a'], label: [0, 1.0] },
      { id: 'yard', name: 'Frost Yard', x: 16, y: 18, w: 16, h: 17, ch: { tl: 2, bl: 3, br: 2 }, floor: 'snow', label: [0, 0.5] },
      { id: 'office', name: 'Office', x: 36, y: 18, w: 18, h: 14, ch: { tl: 1, tr: 1 }, floor: 'carpet', tint: ['#7a4f52', '#72494c'], label: [0, 5.2] },
      { id: 'admin', name: 'Admin', x: 57, y: 19, w: 10, h: 9, floor: 'room', tint: ['#8d88a6', '#847f9c'], label: [0, 3.1] },
      { id: 'field', name: 'Ice Field', x: 70, y: 19, w: 21, h: 15, ch: { tr: 3, br: 4, bl: 2 }, floor: 'snow', label: [-2, -4.6] },
      { id: 'seismic', name: 'Seismic Lab', x: 3, y: 38, w: 13, h: 15, ch: { bl: 3 }, floor: 'tech', tint: ['#5a5f72', '#545969'], label: [0, 5.4] },
      { id: 'storage', name: 'Storage', x: 20, y: 40, w: 13, h: 13, floor: 'wood', tint: ['#8a6a48', '#7f6142'], label: [0, 4.0] },
      { id: 'medbay', name: 'MedBay', x: 37, y: 35, w: 10, h: 9, floor: 'room', tint: ['#a7c3cf', '#9db9c6'], label: [0.6, 2.9] },
      { id: 'lab', name: 'Laboratory', x: 50, y: 34, w: 17, h: 12, ch: { bl: 2 }, floor: 'room', tint: ['#c4cdd8', '#bac4d0'], label: [0, 0.9] },
      { id: 'drill', name: 'Drill Site', x: 36, y: 49, w: 23, h: 11, ch: { bl: 3, br: 3 }, floor: 'snow', label: [-5.5, 3.2] },
      { id: 'specimen', name: 'Specimens', x: 74, y: 40, w: 15, h: 13, ch: { br: 3 }, floor: 'tech', tint: ['#4f6b70', '#49646a'], label: [0, 4.6] }
    ],
    corridors: [
      [13, 5, 3, 3],    // comms <-> dropship
      [6, 11, 3, 7],    // comms <-> electrical
      [17, 15, 14, 3],  // dropship <-> frost yard (wide open snowfield)
      [34, 6, 4, 3],    // dropship <-> weapons
      [49, 6, 4, 3],    // weapons <-> o2
      [67, 7, 5, 3],    // o2 <-> observatory
      [42, 13, 3, 5],   // weapons <-> office
      [13, 21, 3, 3],   // electrical <-> frost yard
      [32, 23, 4, 4],   // frost yard <-> office
      [54, 22, 3, 3],   // office <-> admin
      [67, 22, 3, 3],   // admin <-> ice field
      [79, 14, 3, 5],   // observatory <-> ice field
      [6, 27, 3, 11],   // electrical <-> seismic
      [17, 35, 11, 3],  // frost yard -> south-west trail
      [24, 38, 3, 2],   // trail -> storage door
      [16, 38, 2, 3],   // trail -> seismic door
      [16, 45, 4, 3],   // storage <-> seismic
      [40, 32, 3, 3],   // office <-> medbay
      [41, 44, 3, 5],   // medbay <-> drill site
      [33, 50, 3, 3],   // storage <-> drill site
      [60, 28, 3, 6],   // admin <-> laboratory
      [55, 46, 3, 3],   // laboratory <-> drill site
      [59, 55, 22, 4],  // drill site -> east trail
      [65, 54, 8, 6],   // frozen pond on the east trail
      [76, 53, 3, 2],   // east trail -> specimens door
      [80, 34, 3, 6]    // ice field <-> specimens
    ],

    author: function (A) {
      var prop = A.prop, roundProp = A.roundProp, wallProp = A.wallProp,
        addStation = A.addStation, addFix = A.addFix, addVent = A.addVent, setButton = A.setButton;
      function S(key, x, y, w, h, room, o) { o = o || {}; if (o.solid === undefined) o.solid = true; o.room = room; return prop(key, x, y, w, h, o); }
      function rock(x, y, r, room, v) { return roundProp('pol_rock', x, y, r, { room: room, tint: v || '' }); }
      function pile(x, y, r, room) { return roundProp('pol_snowpile', x, y, r, { room: room }); }
      function ice(x, y, r, room) { return roundProp('pol_ice', x, y, r, { room: room }); }
      function lamp(x, y, room) { return roundProp('pol_lamp', x, y, 0.42, { room: room }); }

      // ---- Office (meeting room, emergency button, spawn) ----
      var btn = roundProp('emergency', 45, 24.6, 0.92, { room: 'office' });
      btn.use = { x: 45 * A.T, y: Math.round(24.6 * A.T) };
      setButton(btn);
      addStation('download', 'office', wallProp('wallscreen', 'office', 38));
      wallProp('window', 'office', 40, 1.0);
      wallProp('window', 'office', 46, 1.0);
      S('pol_shelf', 47.5, 18.1, 2.4, 0.8, 'office');
      S('pol_shelf', 50.0, 18.1, 2.4, 0.8, 'office');
      S('pol_desk', 36.3, 28.9, 2.2, 1.0, 'office');
      prop('prop_chair', 37.0, 30.0, 0.8, 0.8, { room: 'office' });
      S('pol_desk', 51.5, 28.9, 2.2, 1.0, 'office');
      prop('prop_chair', 52.2, 30.0, 0.8, 0.8, { room: 'office' });
      S('prop_plant', 36.2, 19.3, 0.7, 0.7, 'office');
      S('prop_plant', 53.1, 22.2, 0.7, 0.7, 'office');
      S('pol_cooler', 36.25, 21.0, 0.8, 0.7, 'office');

      // ---- Admin ----
      S('admintable', 59.6, 22.6, 3.8, 2.2, 'admin');
      addStation('swipe', 'admin', wallProp('cardslot', 'admin', 64));
      addFix('o2', 1, 'admin', wallProp('keypad', 'admin', 59));
      wallProp('prop_screen', 'admin', 61, 1.6);
      S('prop_plant', 57.15, 19.2, 0.7, 0.7, 'admin');
      S('pol_shelf', 63.6, 26.7, 2.4, 0.8, 'admin');

      // ---- Comms ----
      addFix('comms', 0, 'comms', wallProp('commspanel', 'comms', 5, 1.0));
      addStation('download', 'comms', S('prop_console', 8.6, 3.05, 1.7, 1.0, 'comms', { tint: 'green' }), 9.45, 4.55);
      wallProp('prop_screen', 'comms', 11, 1.0);
      prop('prop_chair', 9.0, 4.7, 0.8, 0.8, { room: 'comms' });
      S('secdesk', 3.2, 7.4, 2.6, 1.0, 'comms');
      S('pol_crate', 3.2, 9.2, 1.1, 0.9, 'comms');
      S('pol_desk', 9.8, 7.0, 2.2, 1.0, 'comms');

      // ---- Dropship (outdoor landing site) ----
      var ship = S('pol_dropship', 20.5, 5.0, 8.4, 3.6, 'dropship');
      addStation('fuel', 'dropship', S('fuelport', 18.6, 7.4, 1.0, 0.5, 'dropship'), 19.1, 8.3);
      addStation('align', 'dropship', S('prop_console', 30.0, 9.0, 1.7, 1.0, 'dropship', { tint: 'amber' }), 30.85, 10.5);
      S('prop_barrel', 17.0, 9.6, 0.8, 0.8, 'dropship', { tint: 'fuel' });
      S('prop_barrel', 17.9, 10.0, 0.8, 0.8, 'dropship', { tint: 'fuel' });
      S('pol_crate', 30.4, 4.1, 1.2, 1.0, 'dropship');
      S('pol_crate', 31.7, 4.5, 1.0, 0.9, 'dropship');
      lamp(19.6, 13.2, 'dropship'); lamp(28.6, 13.2, 'dropship');
      rock(32.4, 12.5, 0.6, 'dropship', 'b');
      S('pol_antenna', 17.6, 3.0, 1.3, 1.0, 'dropship');
      void ship;

      // ---- Weapons ----
      addStation('asteroids', 'weapons', S('gunseat', 42.0, 5.4, 2.0, 1.3, 'weapons'), 43.0, 7.1);
      wallProp('window', 'weapons', 42, 1.0);
      wallProp('window', 'weapons', 43, 1.0);
      wallProp('window', 'weapons', 44, 1.0);
      addStation('download', 'weapons', wallProp('wallscreen', 'weapons', 46));
      S('pol_crate', 39.0, 9.8, 1.1, 0.9, 'weapons');
      S('prop_barrel', 47.0, 9.9, 0.8, 0.8, 'weapons');

      // ---- O2 Greenhouse ----
      addStation('leaves', 'o2', wallProp('o2filter', 'o2', 55, 1.0));
      addFix('o2', 0, 'o2', wallProp('keypad', 'o2', 58));
      addStation('garbage', 'o2', wallProp('chute', 'o2', 65, 1.0));
      [55.0, 56.3, 57.6, 61.4, 62.7, 64.0].forEach(function (x, i) {
        S('prop_plant', x, 7.0 + (i % 2) * 0.15, 0.75, 0.75, 'o2');
        S('prop_plant', x + 0.3, 9.6 + (i % 2) * 0.15, 0.75, 0.75, 'o2');
      });
      S('prop_barrel', 53.2, 11.6, 0.8, 0.8, 'o2', { tint: 'o2' });
      S('prop_barrel', 54.1, 11.6, 0.8, 0.8, 'o2', { tint: 'o2' });

      // ---- Observatory ----
      addStation('align', 'observatory', S('pol_telescope', 77.6, 5.6, 3.0, 2.4, 'observatory'), 79.1, 8.75);
      [73, 74, 75, 81, 82].forEach(function (c) { wallProp('window', 'observatory', c, 1.0); });
      S('pol_desk', 72.2, 10.6, 2.2, 1.0, 'observatory');
      prop('prop_chair', 72.9, 11.7, 0.8, 0.8, { room: 'observatory' });
      S('cabinet', 85.0, 8.6, 1.0, 1.5, 'observatory');

      // ---- Electrical ----
      addStation('wires', 'electrical', wallProp('wallpanel', 'electrical', 4));
      addFix('lights', 0, 'electrical', wallProp('breaker', 'electrical', 10, 0.9));
      addStation('divert', 'electrical', wallProp('divert', 'electrical', 12, 0.9));
      S('generator', 3.2, 21.6, 1.6, 1.5, 'electrical');
      S('generator', 10.2, 24.0, 1.6, 1.5, 'electrical');
      S('pol_crate', 11.6, 19.6, 0.9, 0.8, 'electrical');

      // ---- Frost Yard (outdoor) ----
      addStation('wires', 'yard', S('pol_weather', 20.6, 21.4, 0.9, 0.7, 'yard'), 21.05, 22.6);
      S('pol_rover', 25.6, 28.4, 2.8, 1.6, 'yard');
      roundProp('pol_snowman', 28.6, 21.0, 0.42, { room: 'yard' });
      rock(18.6, 31.2, 0.75, 'yard');
      rock(29.6, 32.2, 0.55, 'yard', 'b');
      ice(30.2, 19.6, 0.55, 'yard');
      pile(17.4, 26.6, 0.6, 'yard');
      prop('pol_icepatch', 21.4, 25.2, 3.2, 1.8, { flat: true, room: 'yard' });
      lamp(23.4, 33.4, 'yard'); lamp(30.6, 25.8, 'yard');

      // ---- Ice Field (outdoor) ----
      addStation('divert', 'field', S('pol_pylon', 72.4, 29.0, 1.4, 0.9, 'field'), 73.1, 30.3);
      S('pol_dish', 84.2, 24.2, 2.6, 2.0, 'field');
      prop('pol_icepatch', 75.0, 23.6, 6.4, 3.4, { flat: true, room: 'field' });
      prop('pol_icepatch', 79.6, 27.6, 3.6, 2.0, { flat: true, room: 'field' });
      ice(88.0, 21.4, 0.6, 'field');
      ice(71.4, 20.6, 0.5, 'field');
      rock(87.2, 28.6, 0.8, 'field');
      rock(76.4, 31.6, 0.6, 'field', 'b');
      pile(85.4, 31.2, 0.7, 'field');
      roundProp('pol_snowman', 82.4, 22.0, 0.42, { room: 'field' });
      lamp(78.5, 21.0, 'field'); lamp(83.4, 32.6, 'field');

      // ---- Seismic Lab (reactor) ----
      roundProp('pol_stabilizer', 9.5, 45.4, 1.7, { room: 'seismic' });
      addFix('reactor', 0, 'seismic', wallProp('handscan', 'seismic', 4, 0.9));
      addFix('reactor', 1, 'seismic', S('handstand', 13.6, 51.1, 1.1, 0.8, 'seismic'), 14.15, 50.72);
      addStation('numbers', 'seismic', S('prop_console', 11.2, 38.05, 1.7, 1.0, 'seismic', { tint: 'cyan' }), 12.05, 39.55);
      wallProp('prop_screen', 'seismic', 10, 1.0);
      S('prop_barrel', 15.0, 39.4, 0.8, 0.8, 'seismic');
      S('prop_barrel', 3.2, 44.0, 0.8, 0.8, 'seismic');
      S('pol_crate', 3.2, 46.2, 1.1, 0.9, 'seismic', { tint: 'blue' });
      S('pol_seismo', 3.2, 48.2, 2.2, 1.0, 'seismic');
      S('pol_seismo', 13.2, 42.4, 2.2, 1.0, 'seismic');
      S('pol_crate', 13.6, 47.0, 1.2, 1.0, 'seismic', { tint: 'blue' });

      // ---- Storage ----
      S('pol_crate', 21.0, 42.0, 1.6, 1.3, 'storage', { tint: 'blue' });
      S('pol_crate', 22.7, 42.4, 1.1, 0.9, 'storage');
      S('pol_crate', 25.0, 45.4, 2.4, 1.6, 'storage');
      S('pol_crate', 29.6, 42.0, 1.3, 1.2, 'storage');
      S('pol_crate', 28.6, 48.6, 1.6, 1.3, 'storage', { tint: 'blue' });
      S('pol_crate', 30.4, 49.0, 1.3, 1.1, 'storage');
      S('prop_barrel', 20.4, 48.6, 0.8, 0.85, 'storage');
      addStation('fuel', 'storage', S('prop_barrel', 21.3, 48.6, 0.8, 0.85, 'storage', { tint: 'fuel' }), 21.7, 50.0);
      addStation('garbage', 'storage', wallProp('chute', 'storage', 30, 1.0));
      pile(31.9, 41.0, 0.45, 'storage');

      // ---- MedBay ----
      addStation('scan', 'medbay', S('scanpad', 38.1, 39.2, 1.7, 1.7, 'medbay', { flat: true, solid: false }), 38.95, 40.05);
      S('prop_bed', 44.9, 35.3, 1.6, 2.4, 'medbay');
      S('prop_bed', 44.9, 38.8, 1.6, 2.4, 'medbay');
      S('cabinet', 37.2, 35.2, 1.6, 0.9, 'medbay');
      S('prop_plant', 46.2, 42.9, 0.7, 0.7, 'medbay');

      // ---- Laboratory ----
      addStation('wires', 'lab', wallProp('wallpanel', 'lab', 52));
      addStation('calibrate', 'lab', wallProp('calib', 'lab', 65, 0.9));
      S('pol_labbench', 52.4, 37.6, 2.8, 1.0, 'lab');
      S('pol_labbench', 52.4, 40.8, 2.8, 1.0, 'lab');
      S('pol_labbench', 63.0, 37.6, 2.8, 1.0, 'lab');
      S('pol_labbench', 63.0, 40.8, 2.8, 1.0, 'lab');
      S('pol_specimen', 57.6, 35.0, 1.2, 1.0, 'lab');
      S('cabinet', 64.8, 44.0, 1.6, 0.9, 'lab');
      wallProp('prop_screen', 'lab', 57, 1.0);
      wallProp('prop_screen', 'lab', 58, 1.0);

      // ---- Drill Site (outdoor) ----
      var drill = S('pol_drill', 45.0, 52.0, 3.2, 2.2, 'drill');
      void drill;
      addStation('fuel', 'drill', S('fuelport', 48.4, 54.0, 1.0, 0.5, 'drill'), 48.9, 54.95);
      addStation('calibrate', 'drill', S('prop_console', 42.6, 53.4, 1.6, 1.0, 'drill', { tint: 'amber' }), 43.4, 54.9);
      S('prop_barrel', 50.0, 52.0, 0.8, 0.8, 'drill', { tint: 'fuel' });
      S('prop_barrel', 50.8, 52.4, 0.8, 0.8, 'drill', { tint: 'fuel' });
      S('pol_crate', 37.2, 57.0, 1.2, 1.0, 'drill');
      rock(55.0, 50.6, 0.7, 'drill');
      rock(53.2, 58.4, 0.55, 'drill', 'b');
      ice(39.0, 50.4, 0.6, 'drill');
      pile(57.0, 54.6, 0.6, 'drill');
      lamp(40.6, 58.0, 'drill'); lamp(52.2, 50.4, 'drill');

      // ---- East trail & frozen pond (outdoor hallway) ----
      prop('pol_icepatch', 65.5, 55.3, 6.6, 3.6, { flat: true });
      roundProp('pol_ice', 66.0, 54.6, 0.5, {});
      roundProp('pol_rock', 72.0, 59.0, 0.6, { tint: 'b' });
      roundProp('pol_snowpile', 61.0, 58.2, 0.55, {});
      roundProp('pol_lamp', 62.4, 55.6, 0.42, {});

      // ---- Signposts for the outdoor areas (floor labels are faint on snow) ----
      S('pol_sign', 21.6, 13.1, 2.4, 0.35, 'dropship', { tint: 'Dropship' });
      S('pol_sign', 24.2, 18.7, 2.4, 0.35, 'yard', { tint: 'Frost Yard' });
      S('pol_sign', 71.0, 25.6, 2.4, 0.35, 'field', { tint: 'Ice Field' });
      S('pol_sign', 36.6, 53.6, 2.4, 0.35, 'drill', { tint: 'Drill Site' });

      // ---- Specimens ----
      addStation('swipe', 'specimen', wallProp('cardslot', 'specimen', 76));
      addStation('download', 'specimen', S('prop_console', 84.4, 40.05, 1.7, 1.0, 'specimen', { tint: 'green' }), 85.25, 41.55);
      [[77.0, 44.0], [79.0, 44.0], [84.0, 44.0], [86.0, 44.0], [77.0, 48.4], [86.0, 48.4]].forEach(function (p) {
        S('pol_specimen', p[0], p[1], 1.2, 1.0, 'specimen');
      });
      S('pol_labbench', 80.2, 48.8, 2.8, 1.0, 'specimen');
      wallProp('prop_screen', 'specimen', 78, 1.0);

      // ---- Vents (linked groups) ----
      addVent(11.3, 9.6, 'comms', [1, 2]);            // 0
      addVent(4.3, 25.8, 'electrical', [0, 2]);       // 1
      addVent(4.6, 41.0, 'seismic', [0, 1]);          // 2
      addVent(52.6, 26.4, 'office', [4, 5]);          // 3
      addVent(65.6, 21.0, 'admin', [3, 5]);           // 4
      addVent(40.6, 42.6, 'medbay', [3, 4]);          // 5
      addVent(32.4, 6.0, 'dropship', [7]);            // 6
      addVent(66.0, 11.6, 'o2', [6, 8]);              // 7
      addVent(85.6, 12.0, 'observatory', [7]);        // 8
      addVent(23.0, 51.6, 'storage', [10]);           // 9
      addVent(56.6, 57.6, 'drill', [9, 11]);          // 10
      addVent(60.0, 44.6, 'lab', [10, 12]);           // 11
      addVent(87.4, 50.4, 'specimen', [11, 13]);      // 12
      addVent(88.0, 25.6, 'field', [12]);             // 13
    }
  });
})();
