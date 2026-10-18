// Mixing rules of js/voice.js (SPEC.md §7) via the pure IS.voice._target(view, peer, opts).
// Also checks voice.js is inert without window.SS_LIVEKIT. Run: node tests/voice-mix.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { console, setTimeout, clearTimeout };
ctx.window = ctx;
// no document / addEventListener at all: loading must not touch the DOM without SS_LIVEKIT
vm.createContext(ctx);
for (const f of ['js/config.js', 'js/voice.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const V = ctx.IS.voice;

const wall = { x: 500 }; // a vertical wall at x = 500 blocks line of sight
const opts = { near: 96, far: 300, los: (x0, y0, x1, y1) => (x0 - wall.x) * (x1 - wall.x) > 0 };
function view(phase, meOver = {}, players = []) {
  const me = { peer: 'me', x: 100, y: 100, alive: true, spectator: false, ...meOver };
  return {
    inGame: true, code: 'QXBT', phase, me,
    players: [{ peer: 'me', x: me.x, y: me.y, alive: me.alive, conn: true, inVent: false, isMe: true },
      ...players.map((p) => ({ x: 100, y: 100, alive: true, conn: true, inVent: false, isMe: false, ...p }))]
  };
}
const g = (v, peer) => V._target(v, peer, opts).g;

test('inert without SS_LIVEKIT', () => {
  assert.equal(V.isSpeaking('x'), false);
  assert.equal(V.update({ inGame: true, code: 'ABCD', phase: 'play' }), undefined);
  assert.equal(V.active(), false);
});

test('lobby and game over: everyone hears everyone at full volume', () => {
  for (const ph of ['lobby', 'over']) {
    const v = view(ph, { alive: false }, [{ peer: 'a', x: 5000, y: 5000, alive: false }, { peer: 'b', x: 3000 }]);
    assert.equal(g(v, 'a'), 1, ph);
    assert.equal(g(v, 'b'), 1, ph);
    assert.equal(g(v, 'stranger'), 1, ph + ' spectator');
  }
});

test('meetings: full volume, but the living cannot hear ghosts', () => {
  for (const ph of ['meeting', 'eject']) {
    const v = view(ph, {}, [{ peer: 'alive', x: 4000 }, { peer: 'ghost', alive: false }]);
    assert.equal(g(v, 'alive'), 1);
    assert.equal(g(v, 'ghost'), 0);
    assert.equal(g(v, 'spectator'), 0);
    const vg = view(ph, { alive: false }, [{ peer: 'alive', x: 4000 }, { peer: 'ghost', alive: false }]);
    assert.equal(g(vg, 'alive'), 1, 'ghost hears the living');
    assert.equal(g(vg, 'ghost'), 1, 'ghost hears ghosts');
  }
});

test('play: distance falloff, line of sight, vents', () => {
  const v = view('play', {}, [
    { peer: 'near', x: 150 }, { peer: 'mid', x: 300 }, { peer: 'edge', x: 390 }, { peer: 'far', x: 420 },
    { peer: 'wall', x: 520, y: 100 }, { peer: 'vent', x: 120, inVent: true }, { peer: 'ghost', x: 110, alive: false },
    { peer: 'gone', x: 110, conn: false }
  ]);
  assert.equal(g(v, 'near'), 1, 'within 2 tiles');
  const mid = g(v, 'mid');
  assert.ok(mid > 0.2 && mid < 0.8, 'mid distance attenuated: ' + mid);
  assert.ok(g(v, 'edge') < mid && g(v, 'edge') > 0, 'quieter further away');
  assert.equal(g(v, 'far'), 0, 'silent beyond the vision radius');
  // move the wall test closer so distance alone would be audible
  const vw = view('play', { x: 480 }, [{ peer: 'wall', x: 530 }, { peer: 'same', x: 420 }]);
  assert.equal(g(vw, 'same'), 1);
  assert.equal(g(vw, 'wall'), 0, 'no line of sight -> silent');
  assert.equal(g(v, 'vent'), 0, 'impostor in a vent is muted');
  assert.equal(g(v, 'ghost'), 0, 'the living do not hear ghosts');
  assert.equal(g(v, 'gone'), 0, 'disconnected');
  assert.equal(g(v, 'spectator'), 0, 'spectators count as ghosts');
  // stereo: right of me pans right
  assert.ok(V._target(v, 'mid', opts).p > 0);
  const vl = view('play', {}, [{ peer: 'left', x: 20 }]);
  assert.ok(V._target(vl, 'left', opts).p < 0);
  // roles phase uses the same proximity rules
  assert.equal(g(view('roles', {}, [{ peer: 'far', x: 2000 }]), 'far'), 0);
});

test('play: ghosts hear everyone; only ghosts hear ghosts', () => {
  const v = view('play', { alive: false }, [
    { peer: 'aliveFar', x: 4000 }, { peer: 'behindWall', x: 900 }, { peer: 'ghost', x: 4000, alive: false }
  ]);
  assert.equal(g(v, 'aliveFar'), 1);
  assert.equal(g(v, 'behindWall'), 1);
  assert.equal(g(v, 'ghost'), 1);
  assert.equal(g(v, 'spectator'), 1);
  const spec = view('play', { alive: false, spectator: true }, [{ peer: 'ghost', alive: false }]);
  assert.equal(g(spec, 'ghost'), 1, 'spectators hear ghosts');
});

test('not in a game: silence', () => {
  assert.equal(g({ inGame: false }, 'x'), 0);
  assert.equal(g(null, 'x'), 0);
});
