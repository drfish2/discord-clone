// Unit tests for js/host.js (pure rules). Run: node tests/host.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { console, Date, Math, JSON };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/config.js', 'js/host.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const IS = ctx.IS;
const H = IS.host;
const C = IS.CONFIG;
const EJECT_MS = C.EJECT_TIME * 1000;
// Objects from the vm realm: compare structurally via JSON.
const J = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ scenario helpers
function game(n, settings = {}, idLen = 2) {
  H._reset();
  const g = { t: 1_000_000, hs: H.initial('ep1', Object.assign({}, C.DEFAULT_SETTINGS, settings)), peers: [] };
  for (let i = 0; i < n; i++) addPeer(g, i, idLen);
  tick(g);
  return g;
}
function addPeer(g, i, idLen = 2, c = i % 12) {
  const id = ('p' + i).padEnd(idLen, 'x');
  g.peers.push({ peer: id, seq: 0, presence: { v: 1, n: 'P' + i, c, j: 100 + i, x: 0, y: 0, f: 1, m: 0, vt: 0, fx: '', a: [] } });
  return id;
}
function peersOf(g) {
  return g.peers.map((p) => ({ peer: p.peer, isMe: false, sameTab: false, kind: 'viewer', presence: p.presence, updatedAt: 0 }));
}
function tick(g, dt = 0) {
  g.t += dt;
  g.hs = H.step(g.hs, peersOf(g), g.t);
  return g.hs;
}
function P(g, id) { return g.peers.find((p) => p.peer === id); }
function slotOf(g, id) { return g.hs.pl.findIndex((e) => e[0] === id); }
function act(g, id, type, ...args) {
  const p = P(g, id);
  p.seq += 1;
  p.presence = { ...p.presence, a: [...p.presence.a, [p.seq, type, ...args]].slice(-10) };
}
function pos(g, id, x, y, extra = {}) { const p = P(g, id); p.presence = { ...p.presence, x, y, ...extra }; }
function drop(g, id) { g.peers = g.peers.filter((p) => p.peer !== id); }
function start(g, hostId = g.peers[0].peer) {
  act(g, hostId, 'start');
  tick(g);
  assert.equal(g.hs.ph, 'roles');
  tick(g, C.ROLE_TIME * 1000);
  assert.equal(g.hs.ph, 'play');
}
const imps = (g) => g.hs.pl.map((e, i) => (e[3] === 1 ? i : -1)).filter((i) => i >= 0);
const crew = (g) => g.hs.pl.map((e, i) => (e[3] === 0 ? i : -1)).filter((i) => i >= 0);
const peerAt = (g, s) => g.hs.pl[s][0];
function readyToKill(g) { tick(g, 11_000); } // initial kill cooldown is 10s after roles

// ------------------------------------------------------------------ lobby
test('lobby: join, colours, leave with grace and compaction, max 10', () => {
  const g = game(3);
  assert.equal(g.hs.ph, 'lobby');
  assert.deepEqual(J(g.hs.pl.map((e) => e[0])), ['p0', 'p1', 'p2']);
  assert.deepEqual(J(g.hs.pl.map((e) => e[1])), [0, 1, 2]);
  // a new player preferring a taken colour gets the first free one
  addPeer(g, 3, 2, 1);
  tick(g);
  assert.equal(g.hs.pl[3][1], 3);
  // colour change: taken rejected, free accepted
  act(g, 'p3', 'col', 0); tick(g);
  assert.equal(g.hs.pl[3][1], 3);
  act(g, 'p3', 'col', 7); tick(g);
  assert.equal(g.hs.pl[3][1], 7);
  act(g, 'p3', 'col', 99); tick(g);
  assert.equal(g.hs.pl[3][1], 7);
  // leave: slot kept during 3s grace, then removed and compacted (ls aligned)
  const lsP3 = g.hs.ls[3];
  drop(g, 'p1');
  tick(g, 125);
  tick(g, 2800);
  assert.equal(g.hs.pl.length, 4);
  tick(g, 300);
  assert.equal(g.hs.pl.length, 3);
  assert.deepEqual(J(g.hs.pl.map((e) => e[0])), ['p0', 'p2', 'p3']);
  assert.equal(g.hs.ls[2], lsP3);
  assert.equal(g.hs.ls.length, 3); assert.equal(g.hs.kc.length, 3); assert.equal(g.hs.em.length, 3);
  // max 10 slots, extra ones are spectators
  for (let i = 4; i < 13; i++) addPeer(g, i);
  tick(g);
  assert.equal(g.hs.pl.length, 10);
  assert.equal(new Set(g.hs.pl.map((e) => e[1])).size, 10, 'colours unique');
});

test('lobby: settings clamp, host-only set/start, min players', () => {
  const g = game(2);
  act(g, 'p1', 'set', { imp: 3 }); tick(g);
  assert.equal(g.hs.st.imp, 1, 'non-host set ignored');
  act(g, 'p0', 'set', { imp: 9, kcd: 1, spd: 1.2345, nt: 'x', vot: 30 }); tick(g);
  assert.equal(g.hs.st.imp, 3); assert.equal(g.hs.st.kcd, 10); assert.equal(g.hs.st.spd, 1.23);
  assert.equal(g.hs.st.nt, 5); assert.equal(g.hs.st.vot, 30);
  act(g, 'p0', 'start'); tick(g);
  assert.equal(g.hs.ph, 'lobby', '2 players cannot start');
  addPeer(g, 2); tick(g);
  act(g, 'p1', 'start'); tick(g);
  assert.equal(g.hs.ph, 'lobby', 'non-host cannot start');
  act(g, 'p0', 'start'); tick(g);
  assert.equal(g.hs.ph, 'roles');
});

test('start with 3 / 4 / 10 players: impostor counts, tasks, determinism', () => {
  for (const [n, imp, want] of [[3, 3, 1], [4, 1, 1], [4, 2, 1], [5, 2, 2], [10, 3, 3], [10, 1, 1]]) {
    const g = game(n, { imp });
    start(g);
    assert.equal(imps(g).length, want, `n=${n} imp=${imp}`);
    assert.ok(g.hs.pl.every((e) => e[5] === 5 && e[2] === 1 && e[6] === 1 && e[4] === 0));
    assert.equal(g.hs.gn, 1);
    assert.ok(g.hs.sd > 0);
    assert.equal(H.impCount(n, imp), want);
  }
  // seeded: same inputs -> same roles
  const a = game(6, { imp: 2 }), b = game(6, { imp: 2 });
  start(a); start(b);
  assert.deepEqual(J(a.hs.pl), J(b.hs.pl));
});

// ------------------------------------------------------------------ kills
test('kills: valid, range, cooldown, crew cannot, vent', () => {
  const g = game(5, { imp: 1, kcd: 20, kd: 1 });
  start(g);
  const [is] = imps(g), cs = crew(g);
  const I = peerAt(g, is), A = peerAt(g, cs[0]), B = peerAt(g, cs[1]), Cc = peerAt(g, cs[2]);
  // initial cooldown
  pos(g, I, 100, 100); pos(g, A, 120, 100);
  act(g, I, 'kill', cs[0]); tick(g);
  assert.equal(g.hs.pl[cs[0]][2], 1, 'kill during initial cooldown rejected');
  readyToKill(g);
  // out of range (range = 100 * 1.6 = 160)
  pos(g, A, 100 + 161, 100);
  act(g, I, 'kill', cs[0]); tick(g);
  assert.equal(g.hs.pl[cs[0]][2], 1, 'out of range rejected');
  // in vent
  pos(g, A, 150, 100); pos(g, I, 100, 100, { vt: 1 });
  act(g, I, 'kill', cs[0]); tick(g);
  assert.equal(g.hs.pl[cs[0]][2], 1, 'kill from vent rejected');
  pos(g, I, 100, 100, { vt: 0 });
  // crew cannot kill
  pos(g, B, 100, 110);
  act(g, B, 'kill', cs[0]); tick(g);
  assert.equal(g.hs.pl[cs[0]][2], 1);
  // valid
  act(g, I, 'kill', cs[0]); tick(g);
  assert.equal(g.hs.pl[cs[0]][2], 0);
  assert.deepEqual(J(g.hs.bd), [[cs[0], 150, 100]]);
  assert.equal(g.hs.kc[is], g.t + 20_000);
  // cooldown
  pos(g, Cc, 110, 100);
  act(g, I, 'kill', cs[2]); tick(g, 1000);
  assert.equal(g.hs.pl[cs[2]][2], 1, 'cooldown');
  // dead target / self
  act(g, I, 'kill', cs[0]); act(g, I, 'kill', is); tick(g, 20_000);
  assert.equal(g.hs.bd.length, 1);
  act(g, I, 'kill', cs[2]); tick(g);
  assert.equal(g.hs.pl[cs[2]][2], 0, 'after cooldown ok');
  assert.equal(g.hs.ph, 'play');
});

// ------------------------------------------------------------------ meetings
function killOne(g, imp, target) {
  const I = peerAt(g, imp), T = peerAt(g, target);
  pos(g, I, 500, 500); pos(g, T, 510, 500);
  act(g, I, 'kill', target); tick(g);
  assert.equal(g.hs.pl[target][2], 0);
}

test('report -> meeting -> votes -> eject -> crew win by vote', () => {
  const g = game(4, { dis: 10, vot: 30 });
  start(g); readyToKill(g);
  const [is] = imps(g), cs = crew(g);
  killOne(g, is, cs[0]);
  // dead player cannot report
  act(g, peerAt(g, cs[0]), 'rep', cs[0]); tick(g);
  assert.equal(g.hs.ph, 'play');
  act(g, peerAt(g, cs[1]), 'rep', 7); tick(g);
  assert.equal(g.hs.ph, 'play', 'no such body');
  act(g, peerAt(g, cs[1]), 'rep', cs[0]); tick(g);
  assert.equal(g.hs.ph, 'meeting');
  assert.deepEqual(J(g.hs.mt), { by: cs[1], bd: cs[0], ds: g.t + 10_000, vt: [-2, -2, -2, -2] });
  assert.equal(g.hs.pe, g.t + 40_000);
  assert.equal(g.hs.bd.length, 0);
  // vote before discussion end rejected
  act(g, peerAt(g, cs[1]), 'vote', is); tick(g);
  assert.equal(g.hs.mt.vt[cs[1]], -2);
  tick(g, 10_000);
  act(g, peerAt(g, cs[1]), 'vote', is); act(g, peerAt(g, cs[2]), 'vote', is);
  act(g, peerAt(g, cs[0]), 'vote', is); // dead: ignored
  tick(g);
  assert.equal(g.hs.mt.vt[cs[0]], -2);
  assert.equal(g.hs.ph, 'meeting');
  // double vote ignored
  act(g, peerAt(g, cs[1]), 'vote', -1); tick(g);
  assert.equal(g.hs.mt.vt[cs[1]], is);
  act(g, peerAt(g, is), 'vote', cs[1]); tick(g);
  assert.equal(g.hs.ph, 'eject');
  assert.deepEqual(J(g.hs.ej), { s: is, imp: 1, tie: 0, left: 0 });
  assert.equal(g.hs.pl[is][2], 0);
  tick(g, EJECT_MS - 1);
  assert.equal(g.hs.ph, 'eject');
  tick(g, 1);
  assert.equal(g.hs.ph, 'over');
  assert.deepEqual(J(g.hs.wn), { t: 'crew', r: 'vote' });
});

test('meeting: tie and skip-majority eject nobody; timeout tallies; kill cooldown reset', () => {
  const g = game(6, { dis: 0, vot: 20, kcd: 30 });
  start(g);
  const [is] = imps(g), cs = crew(g);
  act(g, peerAt(g, cs[0]), 'emg'); tick(g);
  assert.equal(g.hs.ph, 'meeting');
  // tie: 2 vs 2, 2 skip -> nobody
  act(g, peerAt(g, cs[0]), 'vote', cs[1]); act(g, peerAt(g, cs[1]), 'vote', cs[1]);
  act(g, peerAt(g, cs[2]), 'vote', cs[2]); act(g, peerAt(g, cs[3]), 'vote', cs[2]);
  act(g, peerAt(g, cs[4]), 'vote', -1); act(g, peerAt(g, is), 'vote', -1);
  tick(g);
  assert.equal(g.hs.ph, 'eject');
  assert.equal(g.hs.ej.s, -1); assert.equal(g.hs.ej.tie, 1);
  tick(g, EJECT_MS);
  assert.equal(g.hs.ph, 'play');
  assert.equal(g.hs.kc[is], g.t + 30_000);
  assert.equal(g.hs.mt, null); assert.equal(g.hs.ej, null);
  // skip majority (emergency limit is 1 per player -> another caller)
  act(g, peerAt(g, cs[1]), 'emg'); tick(g);
  assert.equal(g.hs.ph, 'meeting');
  act(g, peerAt(g, cs[0]), 'vote', -1); act(g, peerAt(g, cs[1]), 'vote', -1);
  act(g, peerAt(g, cs[2]), 'vote', -1); act(g, peerAt(g, cs[3]), 'vote', is);
  tick(g);
  assert.equal(g.hs.ph, 'meeting', 'not everyone voted yet');
  tick(g, 20_000); // timeout
  assert.equal(g.hs.ph, 'eject');
  assert.equal(g.hs.ej.s, -1); assert.equal(g.hs.ej.tie, 0);
  tick(g, EJECT_MS);
  // ejecting a crewmate
  act(g, peerAt(g, cs[2]), 'emg'); tick(g);
  for (const s of [cs[0], cs[1], cs[2], is]) act(g, peerAt(g, s), 'vote', cs[4]);
  act(g, peerAt(g, cs[3]), 'vote', -1); act(g, peerAt(g, cs[4]), 'vote', is);
  tick(g);
  assert.deepEqual(J(g.hs.ej), { s: cs[4], imp: 0, tie: 0, left: 1 });
  tick(g, EJECT_MS);
  assert.equal(g.hs.ph, 'play');
});

test('emergency: per-player limit, dead cannot, blocked by critical sabotage', () => {
  const g = game(5, { emg: 1, dis: 0, vot: 15 });
  start(g);
  const [is] = imps(g), cs = crew(g);
  const A = peerAt(g, cs[0]);
  act(g, A, 'emg'); tick(g);
  assert.equal(g.hs.ph, 'meeting'); assert.equal(g.hs.em[cs[0]], 1);
  tick(g, 15_000); tick(g, EJECT_MS);
  assert.equal(g.hs.ph, 'play');
  act(g, A, 'emg'); tick(g);
  assert.equal(g.hs.ph, 'play', 'limit reached');
  // critical sabotage blocks emergency
  act(g, peerAt(g, is), 'sab', 'reactor'); tick(g);
  assert.equal(g.hs.sb.k, 'reactor');
  act(g, peerAt(g, cs[1]), 'emg'); tick(g);
  assert.equal(g.hs.ph, 'play');
  // dead cannot call
  pos(g, peerAt(g, cs[1]), 0, 0, { fx: 'r0' }); pos(g, peerAt(g, cs[2]), 0, 0, { fx: 'r1' }); tick(g);
  assert.equal(g.hs.sb, null);
  tick(g, C.DEFAULT_SETTINGS.kcd * 1000); // kill cooldown restarted after the meeting
  pos(g, peerAt(g, is), 0, 0); pos(g, peerAt(g, cs[3]), 10, 0);
  act(g, peerAt(g, is), 'kill', cs[3]); tick(g);
  assert.equal(g.hs.pl[cs[3]][2], 0);
  act(g, peerAt(g, cs[3]), 'emg'); tick(g);
  assert.equal(g.hs.ph, 'play');
  // emergency clears bodies and lights stay
  act(g, peerAt(g, cs[1]), 'emg'); tick(g);
  assert.equal(g.hs.ph, 'meeting'); assert.equal(g.hs.bd.length, 0);
});

// ------------------------------------------------------------------ tasks
test('tasks: bits, validation, ghost crew tasks count, crew wins by tasks', () => {
  const g = game(4, { nt: 3 });
  start(g); readyToKill(g);
  const [is] = imps(g), cs = crew(g);
  act(g, peerAt(g, is), 'task', 0); tick(g);
  assert.equal(g.hs.pl[is][4], 0, 'impostor tasks ignored');
  act(g, peerAt(g, cs[0]), 'task', 3); act(g, peerAt(g, cs[0]), 'task', -1); act(g, peerAt(g, cs[0]), 'task', 1.5);
  tick(g);
  assert.equal(g.hs.pl[cs[0]][4], 0);
  killOne(g, is, cs[0]);
  for (const s of cs) for (let k = 0; k < 3; k++) {
    if (s === cs[2] && k === 2) continue;
    act(g, peerAt(g, s), 'task', k);
  }
  tick(g);
  assert.equal(g.hs.pl[cs[0]][4], 7, 'ghost crew can do tasks');
  assert.equal(g.hs.ph, 'play');
  act(g, peerAt(g, cs[2]), 'task', 2); tick(g);
  assert.equal(g.hs.ph, 'over');
  assert.deepEqual(J(g.hs.wn), { t: 'crew', r: 'tasks' });
});

// ------------------------------------------------------------------ sabotage
test('sabotage: o2 two parts, lights, comms, reactor via presence, cooldown, timeout -> imp win', () => {
  const g = game(5, { imp: 1 });
  start(g);
  const [is] = imps(g), cs = crew(g);
  const I = peerAt(g, is);
  act(g, I, 'sab', 'o2'); tick(g);
  assert.equal(g.hs.sb, null, 'initial sabotage cooldown');
  tick(g, 10_000);
  act(g, peerAt(g, cs[0]), 'sab', 'o2'); tick(g);
  assert.equal(g.hs.sb, null, 'crew cannot sabotage');
  act(g, I, 'sab', 'nope'); tick(g);
  assert.equal(g.hs.sb, null);
  act(g, I, 'sab', 'o2'); tick(g);
  assert.deepEqual(J(g.hs.sb), { k: 'o2', end: g.t + C.SAB_TIME * 1000, fx: [0, 0] });
  act(g, I, 'sab', 'lights'); tick(g);
  assert.equal(g.hs.sb.k, 'o2', 'one at a time');
  act(g, peerAt(g, cs[0]), 'fix', 'o2', 0); act(g, peerAt(g, cs[1]), 'fix', 'o2', 0); tick(g);
  assert.deepEqual(J(g.hs.sb.fx), [1, 0]);
  act(g, peerAt(g, cs[1]), 'fix', 'lights', 0); tick(g);
  assert.ok(g.hs.sb);
  act(g, peerAt(g, cs[1]), 'fix', 'o2', 1); tick(g);
  assert.equal(g.hs.sb, null);
  // cooldown
  act(g, I, 'sab', 'lights'); tick(g, 1000);
  assert.equal(g.hs.sb, null);
  tick(g, C.SAB_COOLDOWN * 1000);
  act(g, I, 'sab', 'lights'); tick(g);
  assert.deepEqual(J(g.hs.sb), { k: 'lights', end: 0, fx: [0, 0] });
  // lights persist through a meeting
  act(g, peerAt(g, cs[0]), 'emg'); tick(g);
  assert.equal(g.hs.sb.k, 'lights');
  tick(g, 200_000); tick(g, EJECT_MS);
  assert.equal(g.hs.ph, 'play');
  act(g, peerAt(g, cs[2]), 'fix', 'lights', 0); tick(g);
  assert.equal(g.hs.sb, null);
  tick(g, C.SAB_COOLDOWN * 1000);
  act(g, I, 'sab', 'comms'); tick(g);
  act(g, peerAt(g, cs[3]), 'fix', 'comms', 0); tick(g);
  assert.equal(g.hs.sb, null);
  // reactor: one hand is not enough, the same hand twice is not enough, two different players fix it
  tick(g, C.SAB_COOLDOWN * 1000);
  act(g, I, 'sab', 'reactor'); tick(g);
  pos(g, peerAt(g, cs[0]), 0, 0, { fx: 'r0' }); pos(g, peerAt(g, cs[1]), 0, 0, { fx: 'r0' }); tick(g);
  assert.deepEqual(J(g.hs.sb.fx), [1, 0]);
  pos(g, peerAt(g, cs[0]), 0, 0, { fx: '' }); tick(g);
  pos(g, peerAt(g, cs[0]), 0, 0, { fx: 'r1' }); tick(g);
  assert.equal(g.hs.sb, null, 'reactor fixed');
  pos(g, peerAt(g, cs[0]), 0, 0, { fx: '' }); pos(g, peerAt(g, cs[1]), 0, 0, { fx: '' });
  // critical sabotage meeting clears it
  tick(g, C.SAB_COOLDOWN * 1000);
  act(g, I, 'sab', 'reactor'); tick(g);
  act(g, peerAt(g, cs[1]), 'emg'); tick(g);
  assert.equal(g.hs.ph, 'play', 'emergency blocked during reactor');
  // timeout -> impostors win
  tick(g, C.SAB_TIME * 1000);
  assert.equal(g.hs.ph, 'over');
  assert.deepEqual(J(g.hs.wn), { t: 'imp', r: 'sabotage' });
});

test('critical sabotage is cleared by a report meeting', () => {
  const g = game(5);
  start(g); readyToKill(g);
  const [is] = imps(g), cs = crew(g);
  killOne(g, is, cs[0]);
  act(g, peerAt(g, is), 'sab', 'o2'); tick(g);
  assert.equal(g.hs.sb.k, 'o2');
  act(g, peerAt(g, cs[1]), 'rep', cs[0]); tick(g);
  assert.equal(g.hs.ph, 'meeting'); assert.equal(g.hs.sb, null);
});

test('impostors win by kills (parity)', () => {
  const g = game(4);
  start(g); readyToKill(g);
  const [is] = imps(g), cs = crew(g);
  killOne(g, is, cs[0]);
  assert.equal(g.hs.ph, 'play');
  tick(g, C.DEFAULT_SETTINGS.kcd * 1000);
  killOne(g, is, cs[1]);
  assert.equal(g.hs.ph, 'over');
  assert.deepEqual(J(g.hs.wn), { t: 'imp', r: 'kills' });
  // again -> lobby keeps slots
  act(g, peerAt(g, cs[1]), 'again'); tick(g);
  assert.equal(g.hs.ph, 'over', 'non-host again ignored');
  act(g, 'p0', 'again'); tick(g);
  assert.equal(g.hs.ph, 'lobby');
  assert.equal(g.hs.pl.length, 4);
  assert.ok(g.hs.pl.every((e) => e[2] === 1 && e[3] === 0 && e[4] === 0));
  assert.equal(g.hs.wn, null); assert.equal(g.hs.bd.length, 0);
  start(g);
  assert.equal(g.hs.gn, 2);
});

// ------------------------------------------------------------------ disconnects
test('disconnect: crew -> conn 0 after 3s; impostor leaving -> crew win', () => {
  const g = game(5);
  start(g);
  const [is] = imps(g), cs = crew(g);
  const A = peerAt(g, cs[0]);
  const keep = P(g, A);
  drop(g, A);
  tick(g, 125);
  tick(g, 2000);
  assert.equal(g.hs.pl[cs[0]][6], 1, 'grace');
  tick(g, 1500);
  assert.equal(g.hs.pl[cs[0]][6], 0); assert.equal(g.hs.pl[cs[0]][2], 0);
  assert.equal(g.hs.pl.length, 5, 'no compaction during games');
  // comes back as a ghost
  g.peers.push(keep); tick(g);
  assert.equal(g.hs.pl[cs[0]][6], 1); assert.equal(g.hs.pl[cs[0]][2], 0);
  drop(g, peerAt(g, is));
  tick(g, 125); tick(g, 3100);
  assert.equal(g.hs.ph, 'over');
  assert.deepEqual(J(g.hs.wn), { t: 'crew', r: 'disconnect' });
});

test('spectators: players joining mid-game get no slot; added back in lobby', () => {
  const g = game(3);
  start(g);
  addPeer(g, 7); tick(g);
  assert.equal(g.hs.pl.length, 3);
  assert.equal(slotOf(g, 'p7'), -1);
});

// ------------------------------------------------------------------ host migration
test('host migration: adopted hs (over the wire) never replays processed actions', () => {
  const g = game(5, { emg: 2, dis: 0, vot: 15 });
  start(g);
  const cs = crew(g).filter((s) => s !== 0);
  const A = peerAt(g, cs[0]);
  act(g, A, 'emg'); tick(g);
  assert.equal(g.hs.em[cs[0]], 1);
  tick(g, 15_000); tick(g, EJECT_MS);
  assert.equal(g.hs.ph, 'play');
  // host p0 leaves; p1 becomes host with the last hs it saw (JSON round trip) and fresh timers
  const wire = JSON.parse(JSON.stringify(g.hs));
  drop(g, 'p0');
  H._reset();
  assert.equal(H.elect(peersOf(g)), 'p1');
  g.hs = wire;
  tick(g, 100); tick(g, 100);
  assert.equal(g.hs.ph, 'play', 'old emg action not replayed');
  assert.equal(g.hs.em[cs[0]], 1);
  // new actions still work
  act(g, A, 'emg'); tick(g);
  assert.equal(g.hs.ph, 'meeting'); assert.equal(g.hs.em[cs[0]], 2);
  // the old host's slot times out under the new host after 3s
  tick(g, 3100);
  assert.equal(g.hs.pl[0][6], 0);
});

test('election: smallest j, tie by peer, ignores agents / garbage', () => {
  const ps = [
    { peer: 'zz', presence: { v: 1, j: 5 } },
    { peer: 'aa', presence: { v: 1, j: 5 } },
    { peer: 'ag', kind: 'agent', presence: { v: 1, j: 1 } },
    { peer: 'old', presence: { v: 2, j: 1 } },
    { peer: 'nj', presence: { v: 1 } },
    null, 7, { peer: 5, presence: { v: 1, j: 0 } }
  ];
  assert.equal(H.elect(ps), 'aa');
  assert.equal(H.elect([]), null);
  assert.equal(H.elect(null), null);
});

test('shiftTime moves host-clock fields', () => {
  const g = game(4);
  act(g, 'p0', 'start'); tick(g);
  const s = H.shiftTime(g.hs, -500);
  assert.equal(s.pe, g.hs.pe - 500);
  assert.equal(s.sc, g.hs.sc - 500);
  assert.equal(s.kc[imps(g)[0]], g.hs.kc[imps(g)[0]] - 500);
});

// ------------------------------------------------------------------ robustness + size
test('malformed presence and hs are ignored', () => {
  const g = game(4);
  const junk = [
    { peer: 'j1', presence: 'x' }, { peer: 'j2', presence: { v: 1, j: 'a', a: 'nope', x: 'bad', c: 99, n: { a: 1 } } },
    { peer: 'j3', presence: { v: 1, j: 3, a: [[1, 'start'], ['x', 'kill'], null, [2, 5], [3, 'kill', { deep: 1 }]] } },
    { peer: 'x'.repeat(200), presence: { v: 1, j: 1 } }
  ];
  const ps = peersOf(g).concat(junk);
  let hs = g.hs;
  for (let k = 0; k < 3; k++) hs = H.step(hs, ps, g.t + k);
  assert.equal(hs.ph, 'lobby');
  assert.ok(hs.pl.length <= 7);
  assert.ok(hs.pl.every((e) => e[0].length <= 64));
  assert.equal(H.sanitize(null), null);
  assert.equal(H.sanitize({ v: 1, ph: 'hacked', pl: [] }), null);
  assert.equal(H.sanitize({ v: 1, ph: 'lobby', pl: [['a'], ['a']] }), null, 'duplicate peers');
  assert.equal(H.sanitize({ v: 1, ph: 'meeting', pl: [] }), null);
  const s = H.sanitize({ v: 1, ph: 'lobby', pl: [['a', 99, 5, 7, -1, 99, 'x']], st: { imp: 50 } });
  assert.deepEqual(J(s.pl), [['a', 0, 1, 0, 0, 10, 1]]);
  assert.equal(s.st.imp, 3);
  // step with bad input returns input
  assert.equal(H.step('garbage', [], 1), 'garbage');
});

test('hs JSON stays < 3.5KB with 10 players (worst case-ish)', () => {
  const g = game(10, { imp: 3, nt: 10, emg: 3, dis: 0 }, 16);
  start(g); readyToKill(g);
  const is = imps(g), cs = crew(g);
  for (let k = 0; k < 3; k++) killOne(g, is[k], cs[k]);
  for (const s of crew(g)) for (let k = 0; k < 9; k++) act(g, peerAt(g, s), 'task', k);
  act(g, peerAt(g, is[0]), 'sab', 'lights');
  tick(g);
  act(g, peerAt(g, cs[4]), 'rep', cs[0]);
  tick(g);
  for (let s = 0; s < 10; s++) act(g, peerAt(g, s), 'vote', cs[5]);
  tick(g);
  g.hs.sq = 999999; g.hs.now = Date.now();
  const size = JSON.stringify(g.hs).length;
  assert.ok(g.hs.mt && g.hs.ej && g.hs.sb, 'meeting + eject + sabotage present');
  assert.ok(size < 3500, 'size ' + size);
  // bodies at max
  const g2 = game(10, { imp: 3, kcd: 10 }, 16);
  start(g2); readyToKill(g2);
  const i2 = imps(g2), c2 = crew(g2);
  for (let k = 0; k < 3; k++) killOne(g2, i2[k], c2[k]);
  assert.ok(JSON.stringify(g2.hs).length < 3500);
  console.log('# hs size (10 players, meeting+eject+sabotage):', size, 'bytes');
});

test('freeplay: solo start, role choice via fr, no win checks', () => {
  const g = game(1, { free: 1 });
  start(g);
  assert.equal(g.hs.pl[0][3], 0, 'crewmate by default');
  for (let k = 0; k < 5; k++) act(g, 'p0', 'task', k);
  tick(g);
  assert.equal(g.hs.ph, 'play', 'no task win in freeplay');
  const g2 = game(1, { free: 1, fr: 1 });
  start(g2);
  assert.equal(g2.hs.pl[0][3], 1, 'impostor with fr=1');
  tick(g2, 10_000);
  act(g2, 'p0', 'sab', 'reactor'); tick(g2);
  assert.equal(g2.hs.sb.k, 'reactor');
  tick(g2, C.SAB_TIME * 1000 + 1);
  assert.equal(g2.hs.ph, 'play'); assert.equal(g2.hs.sb, null, 'critical timeout just clears');
});
