// Transport tests for js/net.js. Run: node tests/net-transport.test.mjs
// Local mode: two vm contexts ("tabs") talk through Node's BroadcastChannel.
// Room mode: a fake window.claude.use('room').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tab(extra = {}) {
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, crypto, BroadcastChannel,
    ...extra
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/config.js', 'js/net.js']) vm.runInContext(src(f), ctx, { filename: f });
  return ctx;
}

test('local mode: presence merge, null removal, 4 KiB limit, stable frozen peers, diffs, leave', async () => {
  const A = tab(), B = tab();
  assert.equal((await A.IS.net.init()).mode, 'local');
  await B.IS.net.init();
  assert.equal(await A.IS.net.ready, A.IS.net.myPeer);
  assert.match(A.IS.net.myPeer, /^[a-z0-9]{12}$/);
  const ra = await A.IS.net.join('ss-test');
  assert.equal(await A.IS.net.join('ss-test'), ra, 'same object on re-join');
  await assert.rejects(A.IS.net.join('Bad Name'));
  let rb = null;
  try {
  const changesA = [];
  ra.onPeers((c) => changesA.push(c));
  await ra.presence({ v: 1, n: 'A', x: 1 });
  await ra.presence({ x: 2, y: 3 });
  await ra.presence({ y: null });
  const meA = ra.peers().find((p) => p.sameTab);
  assert.equal(JSON.stringify(meA.presence), '{"v":1,"n":"A","x":2}');
  assert.ok(meA.isMe && Object.isFrozen(meA) && Object.isFrozen(meA.presence) && Object.isFrozen(ra.peers()));
  // 4 KiB limit rejects and does not apply
  await assert.rejects(ra.presence({ big: 'x'.repeat(4100) }), (e) => e.code === 'invalid_argument');
  assert.equal(ra.peers().find((p) => p.sameTab).presence.big, undefined);
  await assert.rejects(ra.presence({ 'bad key': 1 }));

  rb = await B.IS.net.join('ss-test');
  const changesB = [];
  rb.onPeers((c) => changesB.push(c));
  await rb.presence({ v: 1, n: 'B' });
  await sleep(250);
  assert.equal(ra.peers().length, 2);
  assert.equal(rb.peers().length, 2);
  const bOnA = ra.peers().find((p) => !p.sameTab);
  assert.equal(bOnA.peer, B.IS.net.myPeer);
  assert.equal(bOnA.isMe, false);
  assert.equal(bOnA.presence.n, 'B');
  assert.equal(changesA[0].joined.length >= 1, true, 'first delivery = room so far as joined');
  assert.ok(changesA.some((c) => c.joined.some((p) => p.peer === B.IS.net.myPeer)));
  assert.ok(changesB[0].joined.some((p) => p.sameTab), 'first delivery includes me');
  // identity stable while nothing changes (heartbeats do not bump)
  const snap = ra.peers();
  await sleep(1200);
  assert.equal(ra.peers(), snap, 'snapshot identity stable across heartbeats');
  // coalescing: several updates within a frame -> one updated entry
  const n0 = changesA.length;
  await rb.presence({ x: 1 }); await rb.presence({ x: 2 }); await rb.presence({ x: 3 });
  await sleep(200);
  const ups = changesA.slice(n0).flatMap((c) => c.updated.filter((p) => p.peer === B.IS.net.myPeer));
  assert.ok(ups.length >= 1 && ups.length <= 2, 'coalesced updates: ' + ups.length);
  assert.equal(ra.peers().find((p) => !p.sameTab).presence.x, 3);
  assert.notEqual(ra.peers(), snap);
  // leave -> others see left
  const n1 = changesA.length;
  await rb.leave();
  await sleep(150);
  assert.equal(ra.peers().length, 1);
  assert.ok(changesA.slice(n1).some((c) => c.left.some((p) => p.peer === B.IS.net.myPeer)));
  // lobby is a room too
  assert.equal(typeof A.IS.net.lobby.presence, 'function');
  } finally {
    await ra.leave(); if (rb) await rb.leave(); await A.IS.net.lobby.leave(); await B.IS.net.lobby.leave();
  }
});

test('local mode: silent peer times out after 4s', async () => {
  const A = tab();
  await A.IS.net.init();
  const ra = await A.IS.net.join('ss-tmo');
  const ch = new BroadcastChannel('starship-sus/ss-tmo');
  try {
  ch.postMessage({ t: 'p', peer: 'ghostpeer123', p: '{"v":1}' });
  ch.postMessage({ t: 'p', peer: 'garbage', p: '[1,2]' });
  ch.postMessage({ t: 'p', peer: 'garbage2', p: '{bad json' });
  ch.postMessage('nonsense');
  await sleep(150);
  assert.equal(JSON.stringify(ra.peers().map((p) => p.peer).sort()), JSON.stringify([A.IS.net.myPeer, 'ghostpeer123'].sort()));
  await sleep(5200);
  assert.equal(ra.peers().length, 1, 'timed out');
  } finally {
    ch.close();
    await ra.leave(); await A.IS.net.lobby.leave();
  }
});

function fakeRoom(myId) {
  const mk = (peer, kind, extra = {}) => Object.freeze({ peer, by: null, isMe: peer === myId, sameTab: peer === myId, kind, guest: false, presence: Object.freeze({}), updatedAt: 1, ...extra });
  let snap = Object.freeze([]);
  const handlers = [];
  const named = (name) => ({ name, presence: async () => {}, peers: () => snap, onPeers: (fn) => { handlers.push(fn); return () => {}; },
    connected: () => true, onConnection: () => () => {}, leave: async () => {} });
  const room = {
    presence: async () => {}, peers: () => snap,
    onPeers: (fn) => { handlers.push(fn); return () => {}; },
    connected: () => true, onConnection: () => () => {}, emit: async () => {}, on: () => () => {},
    join: async (name) => named(name),
    _answer() {
      snap = Object.freeze([mk('agent1', 'agent'), mk(myId, 'viewer'), mk('other', 'viewer')]);
      handlers.forEach((h) => h({ peers: snap, joined: snap, left: [], updated: [] }));
    }
  };
  return room;
}

test('room mode: wrapper filters agents, learns myPeer from sameTab, ready resolves later', async () => {
  const fr = fakeRoom('me12345');
  const A = tab({ claude: { use: async (n) => (n === 'room' ? fr : null) } });
  assert.equal((await A.IS.net.init()).mode, 'room');
  assert.equal(A.IS.net.myPeer, null);
  assert.equal(A.IS.net.lobby.peers().length, 0);
  let got = null;
  A.IS.net.lobby.onPeers((c) => { got = c; });
  setTimeout(() => fr._answer(), 20);
  assert.equal(await A.IS.net.ready, 'me12345');
  assert.equal(A.IS.net.myPeer, 'me12345');
  assert.equal(A.IS.net.lobby.peers().map((p) => p.peer).join(), 'me12345,other');
  assert.equal(A.IS.net.lobby.peers(), A.IS.net.lobby.peers(), 'stable identity');
  assert.ok(got && got.joined.every((p) => p.kind !== 'agent'));
  const nr = await A.IS.net.join('ss-abcd');
  assert.equal(nr.name, 'ss-abcd');
  assert.equal(await A.IS.net.join('ss-abcd'), nr);
});

test('room mode: claude.use resolving null / throwing / hanging falls back to local', async () => {
  const N = tab({ claude: { use: async () => null } });
  assert.equal((await N.IS.net.init()).mode, 'local');
  await N.IS.net.lobby.leave();
  const T = tab({ claude: { use: () => { throw new Error('x'); } } });
  assert.equal((await T.IS.net.init()).mode, 'local');
  await T.IS.net.lobby.leave();
  const O = tab({ claude: {} });
  assert.equal((await O.IS.net.init()).mode, 'local');
  await O.IS.net.lobby.leave();
  const t0 = Date.now();
  const Hh = tab({ claude: { use: () => new Promise(() => {}) } });
  assert.equal((await Hh.IS.net.init()).mode, 'local');
  const dt = Date.now() - t0;
  assert.ok(dt >= 3900 && dt < 5000, 'timeout ~4s, took ' + dt);
  await Hh.IS.net.lobby.leave();
  const Off = tab({ BroadcastChannel: undefined });
  assert.equal((await Off.IS.net.init()).mode, 'offline');
  const r = await Off.IS.net.join('ss-solo');
  await r.presence({ v: 1 });
  assert.equal(r.peers().length, 1);
  await r.leave();
});
