/* Starship Sus — cosmetic hats. See SPEC.md §6.
   IS.HATS = [{id, name}] (index 0 = no hat; indices are stored in presence `ht`, so never reorder).
   IS.hats.draw(ctx, idx, opts) paints hat idx in crewmate-local coordinates (the space
   IS.render.drawCrewmate uses: feet at 0,0, facing right, head dome top at about y = -54.5 with
   its outline reaching y = -58). opts {facing, ghost, dead, time, walk, color, dark}.
   Pure canvas, no DOM access: loads fine in node. */
(function (root) {
  'use strict';
  var IS = (root.IS = root.IS || {});

  var OL = '#10131f';
  var TAU = Math.PI * 2;
  var LW = 5.5;               // outline underlay width (≈2.75px visible, like the crewmate)
  // hat origin = top of the head dome (crew coords)
  var OX = 1, OY = -54;

  // ------------------------------------------------------------------------------------ kit
  function ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, TAU); }
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  // outline + flat fill of the path that fn builds
  function part(c, fn, fill, lw) {
    fn(c);
    c.strokeStyle = OL; c.lineWidth = lw || LW; c.stroke();
    if (fill) { c.fillStyle = fill; c.fill(); }
  }
  // outline + two-tone fill (shadow on the back/bottom side, like the crewmate body)
  function shaded(c, fn, main, dark, dx, dy, lw) {
    fn(c);
    c.strokeStyle = OL; c.lineWidth = lw || LW; c.stroke();
    c.fillStyle = dark; c.fill();
    c.save(); c.clip();
    c.translate(dx == null ? 3 : dx, dy == null ? -2.5 : dy);
    fn(c); c.fillStyle = main; c.fill();
    c.restore();
  }
  function shine(c, x, y, rx, ry, rot, a) { ell(c, x, y, rx, ry, rot); c.fillStyle = 'rgba(255,255,255,' + (a == null ? 0.38 : a) + ')'; c.fill(); }
  function line(c, pts, color, lw) {
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.strokeStyle = color || OL; c.lineWidth = lw || 2; c.stroke();
  }
  // a cap that hugs the dome: bottom edge at local y=b, from x=-l to x=r, top at about -top
  function capPath(l, r, b, top) {
    var hc = (b * 0.25 + top) / 0.75;   // control-point height giving the requested top
    return function (c) {
      c.beginPath();
      c.moveTo(-l, b);
      c.bezierCurveTo(-l, -hc, r, -hc, r, b);
      c.quadraticCurveTo(0, b + 2.5, -l, b);
      c.closePath();
    };
  }
  function star(c, x, y, r1, r2, n, rot) {
    c.beginPath();
    for (var i = 0; i < n * 2; i++) {
      var a = (rot || -Math.PI / 2) + i * Math.PI / n, r = i % 2 ? r2 : r1;
      c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    c.closePath();
  }

  // ------------------------------------------------------------------------------------ hats
  // Each entry: id, name, top (crew-space y of the highest painted pixel, used for framing and
  // name tags), tilt (radians, negative leans back), anim (needs per-frame redraw), draw(c, o).
  var DEFS = [
    { id: 'none', name: 'No hat', top: -58, draw: null },

    { id: 'tophat', name: 'Top Hat', top: -90, tilt: -0.1, draw: function (c) {
      shaded(c, function (c) {
        c.beginPath();
        c.moveTo(-11, 0); c.lineTo(-12.5, -27); c.quadraticCurveTo(0, -30, 12.5, -27); c.lineTo(11, 0); c.closePath();
      }, '#3a3f52', '#1f2230', 3, -1);
      ell(c, 0, -27.5, 12.5, 2.8); c.fillStyle = '#4b5168'; c.fill(); c.strokeStyle = OL; c.lineWidth = 2; c.stroke();
      // band
      c.save();
      c.beginPath(); c.moveTo(-11.3, -4); c.lineTo(-11.8, -11); c.quadraticCurveTo(0, -13, 11.8, -11); c.lineTo(11.3, -4); c.quadraticCurveTo(0, -2, -11.3, -4); c.closePath();
      c.fillStyle = '#d42a3c'; c.fill(); c.strokeStyle = OL; c.lineWidth = 2; c.stroke();
      c.restore();
      // brim
      shaded(c, function (c) { rr(c, -18, -2.5, 37, 6, 3); }, '#3a3f52', '#1f2230', 2, -1.5);
      shine(c, 6, -20, 2, 5, 0.05, 0.22);
    } },

    { id: 'party', name: 'Party Hat', top: -91, tilt: -0.18, draw: function (c) {
      var cone = function (c) { c.beginPath(); c.moveTo(-11.5, 2); c.lineTo(-1, -30); c.lineTo(12, 2); c.quadraticCurveTo(0, 5, -11.5, 2); c.closePath(); };
      shaded(c, cone, '#ff5fb4', '#c42d86', 3, -1);
      c.save(); cone(c); c.clip();
      c.fillStyle = '#ffe14d';
      for (var i = 0; i < 3; i++) {
        var y = -4 - i * 9;
        c.beginPath(); c.moveTo(-14, y + 3); c.lineTo(14, y - 3); c.lineTo(14, y - 7.5); c.lineTo(-14, y - 1.5); c.closePath(); c.fill();
      }
      c.fillStyle = '#4fe3ff';
      [[-5, -6], [5, -15], [-1, -21], [6, -2]].forEach(function (p) { ell(c, p[0], p[1], 1.6, 1.6); c.fill(); });
      c.restore();
      cone(c); c.strokeStyle = OL; c.lineWidth = 2.2; c.stroke();
      // pom-pom
      part(c, function (c) { ell(c, -1, -31, 4.6, 4.6); }, '#ffffff');
      shine(c, -2.5, -32.5, 1.6, 1.2, 0, 0.9);
      ell(c, 0.6, -29.6, 2.3, 1.8); c.fillStyle = 'rgba(160,170,200,0.55)'; c.fill();
    } },

    { id: 'crown', name: 'Crown', top: -76, tilt: -0.08, draw: function (c) {
      var crown = function (c) {
        c.beginPath();
        c.moveTo(-12, 1.5);
        c.lineTo(-13, -14); c.lineTo(-7, -7.5); c.lineTo(-1, -17); c.lineTo(5, -7.5); c.lineTo(12, -14);
        c.lineTo(11.5, 1.5); c.quadraticCurveTo(0, 4, -12, 1.5); c.closePath();
      };
      shaded(c, crown, '#ffd23f', '#c98c08', 3, -1.5);
      // rim band
      c.beginPath(); c.moveTo(-12.2, -2.5); c.quadraticCurveTo(0, 0, 11.7, -2.5); c.strokeStyle = 'rgba(120,70,0,0.45)'; c.lineWidth = 1.6; c.stroke();
      part(c, function (c) { ell(c, -13, -14.5, 2.4, 2.4); }, '#ffe680', 3);
      part(c, function (c) { ell(c, -1, -17.5, 2.6, 2.6); }, '#ffe680', 3);
      part(c, function (c) { ell(c, 12, -14.5, 2.4, 2.4); }, '#ffe680', 3);
      part(c, function (c) { c.beginPath(); c.moveTo(-1, -9.5); c.lineTo(2.8, -5.5); c.lineTo(-1, -1.5); c.lineTo(-4.8, -5.5); c.closePath(); }, '#ff3b5c', 2.4);
      part(c, function (c) { ell(c, -8, -4, 1.9, 1.9); }, '#3fb0ff', 2);
      part(c, function (c) { ell(c, 6.5, -4, 1.9, 1.9); }, '#3ee07a', 2);
      shine(c, -2.2, -6.5, 0.9, 1.3, 0, 0.8);
      shine(c, 7, -11, 1.2, 3, 0.3, 0.45);
    } },

    { id: 'chef', name: 'Chef Hat', top: -87, tilt: -0.1, draw: function (c) {
      var puff = function (c) {
        c.beginPath();
        c.moveTo(-10, -6);
        c.bezierCurveTo(-19, -9, -18, -22, -9, -21);
        c.bezierCurveTo(-8, -31, 6, -32, 7, -23);
        c.bezierCurveTo(16, -24, 18, -10, 10, -6);
        c.closePath();
      };
      shaded(c, puff, '#ffffff', '#c9d2e6', 3, -2);
      c.beginPath(); c.moveTo(-4, -8); c.quadraticCurveTo(-5, -15, -2, -19); c.moveTo(4, -8); c.quadraticCurveTo(5, -14, 3, -19);
      c.strokeStyle = 'rgba(120,135,170,0.6)'; c.lineWidth = 1.6; c.stroke();
      shaded(c, function (c) { c.beginPath(); c.moveTo(-11.5, 2.5); c.lineTo(-11, -7.5); c.quadraticCurveTo(0, -9.5, 11, -7.5); c.lineTo(12, 2.5); c.quadraticCurveTo(0, 4.5, -11.5, 2.5); c.closePath(); }, '#f4f7fd', '#c3cce0', 2.5, -1);
      shine(c, 6, -25, 2.5, 1.6, -0.3, 0.9);
    } },

    { id: 'cowboy', name: 'Cowboy Hat', top: -78, tilt: -0.06, draw: function (c) {
      var crown = function (c) {
        c.beginPath();
        c.moveTo(-12, 0);
        c.bezierCurveTo(-13, -10, -12, -17, -8, -18);
        c.quadraticCurveTo(-3, -18, 0, -15);
        c.quadraticCurveTo(3, -18, 8, -18);
        c.bezierCurveTo(12, -17, 13, -10, 12, 0);
        c.closePath();
      };
      shaded(c, crown, '#c27a3a', '#87501f', 3, -1.5);
      c.beginPath(); c.moveTo(-12, -5); c.quadraticCurveTo(0, -3, 12, -5); c.lineTo(12.3, -1); c.quadraticCurveTo(0, 1, -12.3, -1); c.closePath();
      c.fillStyle = '#4a2a12'; c.fill(); c.strokeStyle = OL; c.lineWidth = 1.8; c.stroke();
      var brim = function (c) {
        c.beginPath();
        c.moveTo(-26, -7);
        c.quadraticCurveTo(-22, 2, 0, 2.5);
        c.quadraticCurveTo(22, 2, 27, -7);
        c.quadraticCurveTo(25, 6.5, 0, 6.5);
        c.quadraticCurveTo(-24, 6.5, -26, -7);
        c.closePath();
      };
      shaded(c, brim, '#c27a3a', '#87501f', 0, -2);
      shine(c, 6, -13, 1.6, 3.4, 0.2, 0.25);
    } },

    { id: 'beanie', name: 'Beanie', top: -79, tilt: -0.05, draw: function (c) {
      var cap = capPath(15, 16, 4, 12.5);
      shaded(c, cap, '#ff4d5e', '#b81d33', 3, -2);
      c.save(); cap(c); c.clip();
      c.strokeStyle = 'rgba(110,10,30,0.3)'; c.lineWidth = 1.5;
      for (var i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * 5.8, 4); c.quadraticCurveTo(i * 4.8, -5, i * 2.4, -12); c.stroke(); }
      c.restore();
      // folded, ribbed cuff (same yarn, a shade darker)
      var cuff = function (c) { c.beginPath(); c.moveTo(-15.6, 7); c.lineTo(-15.2, 0.8); c.quadraticCurveTo(0.5, -2.2, 16.2, 0.8); c.lineTo(16.6, 7); c.quadraticCurveTo(0.5, 9.5, -15.6, 7); c.closePath(); };
      shaded(c, cuff, '#e8364a', '#a3162a', 2, -1, 5);
      c.strokeStyle = 'rgba(90,0,20,0.35)'; c.lineWidth = 1.3;
      for (var j = -12; j <= 13; j += 3.5) { var k = 1 - Math.abs(j) / 16; c.beginPath(); c.moveTo(j, 1.5 - k * 2); c.lineTo(j + 0.2, 6.5 + k * 1.6); c.stroke(); }
      // pom-pom
      part(c, function (c) { ell(c, -1, -14.5, 5.5, 5); }, '#ffffff');
      ell(c, 0.5, -13, 3, 2.2); c.fillStyle = 'rgba(160,170,200,0.5)'; c.fill();
      shine(c, -2.5, -16, 1.8, 1.3, 0, 0.9);
      shine(c, 8, -6, 2.6, 1.4, 0.5, 0.25);
    } },

    { id: 'halo', name: 'Halo', top: -77, anim: true, draw: function (c, o) {
      var t = o.time || 0, y = -11 + Math.sin(t * 2.4) * 1.5;
      var g = c.createRadialGradient(0, y, 2, 0, y, 18);
      g.addColorStop(0, 'rgba(255,240,150,0.45)'); g.addColorStop(1, 'rgba(255,240,150,0)');
      c.fillStyle = g; ell(c, 0, y, 18, 9); c.fill();
      ell(c, 0, y, 12, 3.6); c.strokeStyle = OL; c.lineWidth = 7.5; c.stroke();
      ell(c, 0, y, 12, 3.6); c.strokeStyle = '#ffd84a'; c.lineWidth = 3.4; c.stroke();
      c.beginPath(); c.ellipse(0, y, 12, 3.6, 0, Math.PI * 1.05, Math.PI * 1.6); c.strokeStyle = '#fff6c4'; c.lineWidth = 1.5; c.stroke();
    } },

    { id: 'horns', name: 'Devil Horns', top: -76, draw: function (c) {
      // s = 1 curls toward the face, s = -1 toward the back (mirror images)
      var horn = function (bx, by, s) {
        return function (c) {
          c.beginPath();
          c.moveTo(bx - 5.5 * s, by + 1);
          c.bezierCurveTo(bx - 8 * s, by - 7, bx - 4 * s, by - 13, bx + 4 * s, by - 18);
          c.bezierCurveTo(bx + 1 * s, by - 12, bx + 2 * s, by - 6, bx + 5.5 * s, by);
          c.quadraticCurveTo(bx, by + 2.5, bx - 5.5 * s, by + 1);
          c.closePath();
        };
      };
      shaded(c, horn(-7.5, 1.5, -1), '#e8273a', '#9e0f22', 2, -1.5);
      shaded(c, horn(8.5, 1.5, 1), '#ff3346', '#b0122a', 2, -1.5);
      shine(c, 6.5, -6, 1.1, 3.6, -0.35, 0.45);
      shine(c, -9.5, -6, 1, 3.2, 0.35, 0.3);
    } },

    { id: 'flower', name: 'Flower', top: -91, tilt: 0.06, draw: function (c) {
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-2.5, -10, 1, -19);
      c.strokeStyle = OL; c.lineWidth = 6; c.stroke();
      c.strokeStyle = '#3cbf55'; c.lineWidth = 2.6; c.stroke();
      part(c, function (c) { c.beginPath(); c.moveTo(-0.8, -8); c.quadraticCurveTo(-10, -13, -12, -7); c.quadraticCurveTo(-6, -3, -0.8, -8); c.closePath(); }, '#3cbf55', 4.5);
      var petals = function (c) {
        c.beginPath();
        for (var i = 0; i < 6; i++) {
          var a = i * TAU / 6 - Math.PI / 2;
          c.moveTo(1 + Math.cos(a) * 3, -25 + Math.sin(a) * 3);
          c.ellipse(1 + Math.cos(a) * 6.5, -25 + Math.sin(a) * 6.5, 5, 3.6, a, 0, TAU);
        }
      };
      petals(c); c.strokeStyle = OL; c.lineWidth = LW; c.stroke();
      petals(c); c.fillStyle = '#ff8fd0'; c.fill();
      c.save(); c.translate(1, -25); c.rotate(0.5); c.translate(-1, 25);
      for (var i = 0; i < 6; i++) { var a = i * TAU / 6 - Math.PI / 2; ell(c, 1 + Math.cos(a) * 7.5, -25 + Math.sin(a) * 7.5, 2, 1.4, a); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fill(); }
      c.restore();
      part(c, function (c) { ell(c, 1, -25, 4, 4); }, '#ffd23f', 3);
      shine(c, -0.2, -26.2, 1.3, 1, 0, 0.8);
    } },

    { id: 'cap', name: 'Baseball Cap', top: -66, tilt: -0.04, draw: function (c) {
      var bill = function (c) { c.beginPath(); c.moveTo(4, 0.5); c.quadraticCurveTo(18, -2.5, 29, 3); c.quadraticCurveTo(28, 6.5, 22, 6.5); c.quadraticCurveTo(14, 5, 4, 6); c.closePath(); };
      shaded(c, bill, '#2f6fe0', '#163f97', 0, -2);
      var cap = capPath(14.5, 15.5, 4.5, 8.5);
      shaded(c, cap, '#3d82ff', '#1e4fb8', 3, -2);
      c.beginPath(); c.moveTo(0.5, -8); c.quadraticCurveTo(6, -2, 6.5, 5.5); c.moveTo(0.5, -8); c.quadraticCurveTo(-7, -3, -8, 5.5);
      c.strokeStyle = 'rgba(10,30,90,0.45)'; c.lineWidth = 1.5; c.stroke();
      part(c, function (c) { ell(c, 0.5, -8.6, 2.2, 1.4); }, '#3d82ff', 2.6);
      part(c, function (c) { rr(c, 2.5, -4, 7, 5.5, 1.6); }, '#ffffff', 2.4);
      c.fillStyle = '#e8273a'; c.fillRect(4.2, -2.8, 3.6, 3.1);
      shine(c, 8, -5, 2.5, 1.4, 0.4, 0.28);
    } },

    { id: 'viking', name: 'Viking Helmet', top: -78, draw: function (c) {
      var horn = function (s) {
        return function (c) {
          c.beginPath();
          c.moveTo(13 * s, -1);
          c.quadraticCurveTo(24 * s, -2, 23 * s, -19);
          c.quadraticCurveTo(19 * s, -9, 11 * s, -7.5);
          c.closePath();
        };
      };
      shaded(c, horn(-1), '#f5ecd2', '#c2b48c', 1, -1.5);
      shaded(c, horn(1), '#f5ecd2', '#c2b48c', 1, -1.5);
      c.strokeStyle = 'rgba(120,100,60,0.5)'; c.lineWidth = 1.3;
      [[-1, 0.45], [1, 0.45], [-1, 0.75], [1, 0.75]].forEach(function (h) {
        var s = h[0], k = h[1]; c.beginPath(); c.moveTo(s * (13 + 8 * k), -2 - 9 * k); c.lineTo(s * (12 + 6 * k), -6 - 8 * k); c.stroke();
      });
      var dome = capPath(15, 16, 4.5, 11);
      shaded(c, dome, '#b9c3d6', '#77829c', 3, -2);
      // band + ridge
      c.beginPath(); c.moveTo(0.5, -10.5); c.lineTo(0.5, 5); c.strokeStyle = OL; c.lineWidth = 5; c.stroke(); c.strokeStyle = '#d9b44a'; c.lineWidth = 2.4; c.stroke();
      var band = function (c) { c.beginPath(); c.moveTo(-15.5, 6); c.lineTo(-15.3, 0.5); c.quadraticCurveTo(0.5, -2.5, 16.3, 0.5); c.lineTo(16.5, 6); c.quadraticCurveTo(0.5, 9, -15.5, 6); c.closePath(); };
      shaded(c, band, '#e2bd52', '#a4801f', 2, -1, 4.5);
      c.fillStyle = '#fff4c8';
      [-10, -4, 5, 11].forEach(function (x) { ell(c, x, 3.4, 1.1, 1.1); c.fill(); });
      shine(c, 7, -6, 3.2, 1.7, 0.45, 0.4);
    } },

    { id: 'wizard', name: 'Wizard Hat', top: -96, tilt: -0.08, draw: function (c) {
      var cone = function (c) {
        c.beginPath();
        c.moveTo(-11, 1);
        c.bezierCurveTo(-8, -12, -6, -26, -9, -33);
        c.quadraticCurveTo(-13, -38, -21, -33);
        c.quadraticCurveTo(-11, -29, 3, -18);
        c.bezierCurveTo(7, -12, 10, -5, 12, 1);
        c.closePath();
      };
      shaded(c, cone, '#7b4be0', '#4a2496', 3, -1);
      c.fillStyle = '#ffd84a';
      star(c, 2.5, -9, 3.6, 1.6, 5); c.fill(); c.strokeStyle = OL; c.lineWidth = 1.3; c.stroke();
      star(c, -6, -20, 2.4, 1.1, 5, -1.2); c.fill(); c.stroke();
      ell(c, 6, -2.5, 1, 1); c.fill();
      ell(c, -4, -4, 0.9, 0.9); c.fill();
      var brim = function (c) { ell(c, 0.5, 1.5, 20, 4.3); };
      shaded(c, brim, '#7b4be0', '#4a2496', 0, -1.6);
      c.beginPath(); c.ellipse(0.5, 1.5, 20, 4.3, 0, Math.PI * 1.1, Math.PI * 1.9); c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1.2; c.stroke();
    } },

    { id: 'headphones', name: 'Headphones', top: -69, draw: function (c) {
      c.beginPath(); c.moveTo(-14, 6); c.bezierCurveTo(-16, -15, 12, -16, 14.5, 1.5);
      c.strokeStyle = OL; c.lineWidth = 8.5; c.stroke();
      c.strokeStyle = '#3d4459'; c.lineWidth = 4; c.stroke();
      c.beginPath(); c.moveTo(-10, -3); c.bezierCurveTo(-8, -10, 5, -12, 9, -6); c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1.4; c.stroke();
      // band end on the far side
      part(c, function (c) { rr(c, 11.5, -0.5, 5.5, 5, 2.2); }, '#2b3045', 4.5);
      // ear cup on the near side of the head (behind the visor)
      shaded(c, function (c) { rr(c, -19.5, 3, 9.5, 14.5, 4.5); }, '#5fd8ff', '#1a8cbf', 2, -1.5);
      part(c, function (c) { rr(c, -17, 6.5, 4.6, 8, 2.3); }, '#2b3045', 2);
      shine(c, -12.4, 5.6, 1.1, 2, 0.2, 0.6);
    } },

    { id: 'sprout', name: 'Sprout', top: -79, anim: true, draw: function (c, o) {
      var sway = Math.sin((o.time || 0) * 2.1) * 0.12;
      c.save(); c.translate(0, -1); c.rotate(sway);
      c.beginPath(); c.moveTo(0, 2); c.quadraticCurveTo(1.5, -6, 0, -12);
      c.strokeStyle = OL; c.lineWidth = 6; c.stroke();
      c.strokeStyle = '#46c05a'; c.lineWidth = 2.6; c.stroke();
      var leaf = function (s) {
        return function (c) {
          c.beginPath(); c.moveTo(0, -11);
          c.bezierCurveTo(s * 4, -20, s * 13, -21, s * 15, -16);
          c.bezierCurveTo(s * 12, -10, s * 4, -9, 0, -11);
          c.closePath();
        };
      };
      shaded(c, leaf(-1), '#5fdc6e', '#2f9a45', 1.5, -1.5);
      shaded(c, leaf(1), '#5fdc6e', '#2f9a45', 1.5, -1.5);
      c.beginPath(); c.moveTo(1.5, -12); c.quadraticCurveTo(7, -16, 12, -16); c.moveTo(-1.5, -12); c.quadraticCurveTo(-7, -16, -12, -16);
      c.strokeStyle = 'rgba(20,90,40,0.55)'; c.lineWidth = 1.3; c.stroke();
      c.restore();
    } },

    { id: 'santa', name: 'Santa Hat', top: -77, tilt: -0.04, draw: function (c) {
      shaded(c, function (c) {
        c.beginPath();
        c.moveTo(15, 2);
        c.bezierCurveTo(14, -10, 8, -19, -2, -18);
        c.bezierCurveTo(-12, -17, -18, -9, -21, -1);
        c.quadraticCurveTo(-16, -5, -12.5, -5.5);
        c.quadraticCurveTo(-14.5, -2, -14.5, 2);
        c.closePath();
      }, '#e8273a', '#a3101f', 3, -2);
      shine(c, 6, -12, 3, 1.5, 0.5, 0.25);
      // fur trim
      var fur = function (c) { c.beginPath(); c.moveTo(-16, 7.5); c.bezierCurveTo(-17, 1, -15, -1, -10, -1.5); c.quadraticCurveTo(1, -4, 12, -1.5); c.bezierCurveTo(17, -1, 18, 3, 17, 7.5); c.quadraticCurveTo(0.5, 10.5, -16, 7.5); c.closePath(); };
      shaded(c, fur, '#ffffff', '#cfd6e6', 1.5, -1.5);
      // pom-pom hanging behind
      part(c, function (c) { ell(c, -22, 0, 5, 5); }, '#ffffff');
      ell(c, -21, 1.5, 3, 2.2); c.fillStyle = 'rgba(160,170,200,0.5)'; c.fill();
      shine(c, -23.5, -1.5, 1.6, 1.2, 0, 0.9);
    } },

    { id: 'grad', name: 'Graduation Cap', top: -73, tilt: -0.08, draw: function (c) {
      shaded(c, capPath(13.5, 14.5, 4, 3), '#2b2f3f', '#171a24', 2, -1.5);
      var board = function (c) { c.beginPath(); c.moveTo(-21, -6); c.lineTo(1, -14); c.lineTo(22, -6); c.lineTo(1, 1); c.closePath(); };
      shaded(c, board, '#3a3f54', '#22263a', 0, -1.4);
      c.beginPath(); c.moveTo(-21, -6); c.lineTo(1, 1); c.lineTo(22, -6); c.lineTo(22, -3.5); c.lineTo(1, 3.5); c.lineTo(-21, -3.5); c.closePath();
      c.fillStyle = '#171a24'; c.fill(); c.strokeStyle = OL; c.lineWidth = 2; c.stroke();
      // tassel
      c.beginPath(); c.moveTo(1, -7); c.quadraticCurveTo(-10, -9, -15, -4); c.lineTo(-16, 5);
      c.strokeStyle = OL; c.lineWidth = 4.5; c.stroke(); c.strokeStyle = '#ffcc33'; c.lineWidth = 2; c.stroke();
      part(c, function (c) { c.beginPath(); c.moveTo(-18.5, 4); c.lineTo(-13.5, 4); c.lineTo(-13, 11); c.lineTo(-19, 11); c.closePath(); }, '#ffcc33', 3);
      part(c, function (c) { ell(c, 1, -7, 2.3, 1.4); }, '#ffcc33', 2.5);
      shine(c, 8, -8, 5, 1.3, -0.33, 0.18);
    } },

    { id: 'police', name: 'Police Cap', top: -71, tilt: -0.05, draw: function (c) {
      var crown = function (c) {
        c.beginPath();
        c.moveTo(-13, 3);
        c.lineTo(-17, -9);
        c.quadraticCurveTo(-2, -16, 17, -10);
        c.lineTo(14, 3);
        c.closePath();
      };
      shaded(c, crown, '#2c3f86', '#18245a', 2.5, -2);
      shine(c, 3, -11, 8, 1.4, -0.12, 0.2);
      var band = function (c) { c.beginPath(); c.moveTo(-13, 7); c.lineTo(-13.3, 2.2); c.quadraticCurveTo(0, 0.4, 14.3, 2.2); c.lineTo(14, 7); c.quadraticCurveTo(0, 9, -13, 7); c.closePath(); };
      part(c, band, '#141a33', 4.5);
      var bill = function (c) { c.beginPath(); c.moveTo(6, 5); c.quadraticCurveTo(18, 3.5, 25, 7); c.quadraticCurveTo(22, 10.5, 14, 9.5); c.quadraticCurveTo(9, 9, 5, 9); c.closePath(); };
      shaded(c, bill, '#1d2235', '#0c0e18', 0, -1.6);
      shine(c, 17, 5.6, 4, 0.8, 0.05, 0.35);
      c.fillStyle = '#ffd23f';
      star(c, 5, -5.5, 4.4, 2.4, 6, 0); c.fill(); c.strokeStyle = OL; c.lineWidth = 1.8; c.stroke();
      ell(c, 5, -5.5, 1.4, 1.4); c.fillStyle = '#c98c08'; c.fill();
    } },

    { id: 'antenna', name: 'Antenna', top: -91, anim: true, draw: function (c, o) {
      var t = o.time || 0;
      var wob = Math.sin(t * 3.1) * 2.2 + (typeof o.walk === 'number' ? Math.sin(o.walk * TAU) * 1.4 : 0);
      var tx = -2 + wob, ty = -28;
      part(c, function (c) { rr(c, -5.5, -3.5, 10, 6, 2.5); }, '#9aa6c3', 4.5);
      c.beginPath(); c.moveTo(-0.5, -3); c.quadraticCurveTo(-1, -16, tx, ty);
      c.strokeStyle = OL; c.lineWidth = 5; c.stroke();
      c.strokeStyle = '#c6cde0'; c.lineWidth = 2; c.stroke();
      var on = (Math.sin(t * 4) > -0.2);
      if (on) { var g = c.createRadialGradient(tx, ty, 1, tx, ty, 11); g.addColorStop(0, 'rgba(255,80,90,0.55)'); g.addColorStop(1, 'rgba(255,80,90,0)'); c.fillStyle = g; ell(c, tx, ty, 11, 11); c.fill(); }
      part(c, function (c) { ell(c, tx, ty, 4.6, 4.6); }, on ? '#ff3b4a' : '#a3202c', 5);
      shine(c, tx - 1.4, ty - 1.6, 1.5, 1.1, 0, 0.85);
    } },

    { id: 'egg', name: 'Fried Egg', top: -66, tilt: -0.05, draw: function (c) {
      var white = function (c) {
        c.beginPath();
        c.moveTo(-15, 4);
        c.bezierCurveTo(-19, -1, -12, -5, -8, -6);
        c.bezierCurveTo(-4, -11, 4, -8, 7, -8);
        c.bezierCurveTo(13, -9, 19, -4, 16, 1);
        c.bezierCurveTo(20, 4, 13, 7, 9, 5);
        c.bezierCurveTo(4, 8, -4, 4, -8, 6);
        c.bezierCurveTo(-11, 8, -15, 7, -15, 4);
        c.closePath();
      };
      shaded(c, white, '#ffffff', '#d2d9e8', 1.5, -1.5);
      part(c, function (c) { ell(c, 1.5, -4.5, 6, 5); }, '#ffb21e', 3.4);
      ell(c, 2.5, -3.5, 4.4, 3.6); c.fillStyle = '#ffc93f'; c.fill();
      shine(c, -0.5, -6.8, 1.9, 1.2, -0.3, 0.9);
    } },

    { id: 'fez', name: 'Fez', top: -77, tilt: -0.12, draw: function (c, o) {
      var cone = function (c) { c.beginPath(); c.moveTo(-10.5, 2); c.lineTo(-7.5, -17); c.quadraticCurveTo(1, -19, 8.5, -17); c.lineTo(11.5, 2); c.quadraticCurveTo(0.5, 4.5, -10.5, 2); c.closePath(); };
      shaded(c, cone, '#d8283a', '#8f0f20', 3, -1);
      ell(c, 0.5, -17.3, 8, 2.1); c.fillStyle = '#ef4656'; c.fill(); c.strokeStyle = OL; c.lineWidth = 2; c.stroke();
      // tassel swinging at the back
      var sw = typeof o.walk === 'number' ? Math.sin(o.walk * TAU) * 1.5 : 0;
      c.beginPath(); c.moveTo(0.5, -17.5); c.quadraticCurveTo(-8, -17, -10.5 + sw, -8);
      c.strokeStyle = OL; c.lineWidth = 4.2; c.stroke(); c.strokeStyle = '#1d2030'; c.lineWidth = 1.8; c.stroke();
      part(c, function (c) { c.beginPath(); c.moveTo(-12.5 + sw, -9); c.lineTo(-8.5 + sw, -9); c.lineTo(-8 + sw, -2); c.lineTo(-13 + sw, -2); c.closePath(); }, '#1d2030', 3);
      part(c, function (c) { ell(c, 0.5, -17.6, 1.6, 1); }, '#1d2030', 2);
      shine(c, 6, -9, 1.2, 4.5, 0.12, 0.25);
    } },

    { id: 'bandana', name: 'Ninja Band', top: -64, anim: true, draw: function (c, o) {
      var t = o.time || 0, f1 = Math.sin(t * 5) * 2, f2 = Math.sin(t * 5 + 1.3) * 2;
      // knot tails fluttering behind
      part(c, function (c) { c.beginPath(); c.moveTo(-14, 1); c.quadraticCurveTo(-20, -1 + f1, -26, -4 + f1); c.lineTo(-24, 1.5 + f1); c.quadraticCurveTo(-19, 2, -14, 4.5); c.closePath(); }, '#e8273a', 4.5);
      part(c, function (c) { c.beginPath(); c.moveTo(-14, 3); c.quadraticCurveTo(-19, 6 + f2, -24, 9 + f2); c.lineTo(-20, 11 + f2); c.quadraticCurveTo(-17, 8, -13, 6); c.closePath(); }, '#c41a2c', 4.5);
      var band = function (c) { c.beginPath(); c.moveTo(-14.6, 6); c.lineTo(-13.7, -0.5); c.quadraticCurveTo(0.5, -4.5, 15.6, -0.5); c.lineTo(16.6, 5.5); c.quadraticCurveTo(0.5, 2, -14.6, 6); c.closePath(); };
      shaded(c, band, '#ff3b4a', '#b0121f', 1.5, -1.2);
      part(c, function (c) { ell(c, -14.5, 2.5, 3, 3.4); }, '#e8273a', 3.5);
      c.beginPath(); c.moveTo(-8, -0.8); c.quadraticCurveTo(0.5, -3, 10, -1); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.2; c.stroke();
    } },

    { id: 'pirate', name: 'Pirate Hat', top: -76, tilt: -0.04, draw: function (c) {
      var hat = function (c) {
        c.beginPath();
        c.moveTo(-22, 2);
        c.quadraticCurveTo(-24, -10, -16, -14);
        c.quadraticCurveTo(-9, -9, 1, -18);
        c.quadraticCurveTo(10, -9, 18, -14);
        c.quadraticCurveTo(25, -10, 23, 2);
        c.quadraticCurveTo(0.5, 6, -22, 2);
        c.closePath();
      };
      shaded(c, hat, '#2a2d3d', '#14161f', 2.5, -1.5);
      c.beginPath(); c.moveTo(-21.5, -1.5); c.quadraticCurveTo(0.5, 2.5, 22.5, -1.5);
      c.strokeStyle = OL; c.lineWidth = 4.5; c.stroke(); c.strokeStyle = '#ffcc33'; c.lineWidth = 2; c.stroke();
      // skull and crossbones
      c.strokeStyle = '#f4f1ea'; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-3.5, -1); c.lineTo(5.5, -9); c.moveTo(5.5, -1); c.lineTo(-3.5, -9); c.stroke();
      c.fillStyle = '#f4f1ea';
      ell(c, 1, -8.5, 3.6, 3.3); c.fill();
      c.fillRect(-0.8, -6.5, 3.6, 3);
      c.fillStyle = '#14161f';
      ell(c, -0.3, -8.3, 1, 1.1); c.fill(); ell(c, 2.3, -8.3, 1, 1.1); c.fill();
      shine(c, 10, -10, 3, 1.1, 0.5, 0.2);
    } },

    { id: 'cat', name: 'Cat Ears', top: -76, draw: function (c, o) {
      var main = o.color || '#a7b0c8', dark = o.dark || '#6d7794';
      var ear = function (bx, tipx) {
        return function (c) {
          c.beginPath();
          c.moveTo(bx - 6.5, 3.5);
          c.quadraticCurveTo(bx - 4, -8, tipx, -16);
          c.quadraticCurveTo(bx + 5, -8, bx + 7, 2);
          c.quadraticCurveTo(bx, 4.5, bx - 6.5, 3.5);
          c.closePath();
        };
      };
      shaded(c, ear(-7, -10), main, dark, 2.5, -1);
      shaded(c, ear(8, 10.5), main, dark, 2.5, -1);
      var inner = function (bx, tipx) { c.beginPath(); c.moveTo(bx - 3, 1); c.quadraticCurveTo(bx - 1.6, -6, tipx, -11); c.quadraticCurveTo(bx + 2.5, -5, bx + 3.8, 0.8); c.closePath(); c.fillStyle = '#ffa3c7'; c.fill(); };
      inner(-7, -9); inner(8, 9.5);
    } },

    { id: 'cone', name: 'Traffic Cone', top: -92, tilt: -0.1, draw: function (c) {
      var cone = function (c) { c.beginPath(); c.moveTo(-10.5, 0); c.lineTo(-3, -31); c.quadraticCurveTo(1, -33, 5, -31); c.lineTo(12.5, 0); c.closePath(); };
      shaded(c, cone, '#ff8a1f', '#c9510a', 3, -1);
      c.save(); cone(c); c.clip();
      c.fillStyle = '#ffffff';
      c.beginPath(); c.moveTo(-14, -9); c.quadraticCurveTo(1, -6, 16, -9); c.lineTo(16, -15); c.quadraticCurveTo(1, -12, -14, -15); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(-14, -21); c.quadraticCurveTo(1, -18.5, 16, -21); c.lineTo(16, -25); c.quadraticCurveTo(1, -22.5, -14, -25); c.closePath(); c.fill();
      c.fillStyle = 'rgba(80,90,120,0.35)'; c.fillRect(-14, -15, 9, 30); c.fillRect(-14, -25, 12, 4);
      c.restore();
      cone(c); c.strokeStyle = OL; c.lineWidth = 2; c.stroke();
      shaded(c, function (c) { rr(c, -16, -1.5, 33, 6.5, 2.2); }, '#ff8a1f', '#b8470a', 0, -1.6);
      shine(c, 5.5, -18, 0.9, 7, -0.24, 0.3);
    } },

    { id: 'propeller', name: 'Propeller Cap', top: -79, anim: true, draw: function (c, o) {
      var t = o.time || 0;
      var cap = capPath(14.5, 15.5, 4.5, 8.5);
      shaded(c, cap, '#ffd23f', '#c98c08', 3, -2);
      c.save(); cap(c); c.clip();
      c.fillStyle = '#e8273a'; c.beginPath(); c.moveTo(-0.5, -9); c.lineTo(-16, 6); c.lineTo(-6, 7); c.closePath(); c.fill();
      c.fillStyle = '#3d82ff'; c.beginPath(); c.moveTo(1.5, -9); c.lineTo(8, 7); c.lineTo(17, 6); c.closePath(); c.fill();
      c.restore();
      cap(c); c.strokeStyle = OL; c.lineWidth = 2; c.stroke();
      // bill
      part(c, function (c) { c.beginPath(); c.moveTo(9, 2); c.quadraticCurveTo(18, 1, 24, 5); c.quadraticCurveTo(18, 7.5, 10, 6.5); c.closePath(); }, '#3ee07a', 4);
      // mast + spinning propeller (side view: blades swing across)
      c.beginPath(); c.moveTo(0.5, -8); c.lineTo(0.5, -14); c.strokeStyle = OL; c.lineWidth = 4.5; c.stroke(); c.strokeStyle = '#9aa6c3'; c.lineWidth = 1.8; c.stroke();
      var a = t * 14, w = Math.cos(a) * 13, w2 = Math.cos(a + Math.PI) * 13;
      part(c, function (c) { ell(c, 0.5 + w / 2, -15, Math.abs(w) / 2 + 1.2, 2.2); }, '#e8273a', 3.4);
      part(c, function (c) { ell(c, 0.5 + w2 / 2, -15, Math.abs(w2) / 2 + 1.2, 2.2); }, '#3d82ff', 3.4);
      part(c, function (c) { ell(c, 0.5, -15, 2.2, 2.2); }, '#3ee07a', 3);
      shine(c, 7, -4, 2.6, 1.4, 0.45, 0.35);
    } }
  ];

  var HATS = DEFS.map(function (d, i) { return { id: d.id, name: d.name, index: i }; });

  function count() { return DEFS.length; }
  function valid(idx) { idx = idx | 0; return idx > 0 && idx < DEFS.length ? idx : 0; }
  function def(idx) { return DEFS[valid(idx)]; }

  // Paint hat idx (crewmate-local coordinates; the caller has already applied facing/scale/bob).
  function draw(c, idx, opts) {
    if (!c) return;
    var d = DEFS[valid(idx)];
    if (!d.draw) return;
    opts = opts || {};
    if (opts.dead) return;                       // the head is gone
    c.save();
    try {
      c.lineJoin = 'round'; c.lineCap = 'round';
      // tiny lag bounce on the walk cycle (the body already bobs)
      var lift = typeof opts.walk === 'number' && !opts.ghost ? -Math.max(0, Math.sin(opts.walk * TAU * 2 + 0.9)) * 0.9 : 0;
      c.translate(OX, OY + lift);
      if (d.tilt) { c.translate(0, 4); c.rotate(d.tilt); c.translate(0, -4); }
      d.draw(c, opts);
    } finally { c.restore(); }
  }

  IS.HATS = HATS;
  IS.hats = {
    draw: draw,
    count: count,
    valid: valid,
    name: function (idx) { return DEFS[valid(idx)].name; },
    // crew-space y of the highest painted point (≤ -58), for framing and name tags
    top: function (idx) { return Math.min(-58, def(idx).top || -58); },
    maxTop: function () { var m = -58; for (var i = 0; i < DEFS.length; i++) m = Math.min(m, DEFS[i].top || -58); return m; },
    // true when the hat moves over time (renderers must not freeze it in a sprite)
    animated: function (idx) { return !!def(idx).anim; }
  };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
