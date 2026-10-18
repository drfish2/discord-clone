// Tests for js/net-livekit.js (IS.lkTransport) and the LiveKit path of js/net.js, against a fake
// livekit-client (the subset net-livekit.js uses) and a fake token endpoint.
// Run: node tests/voice-transport.test.mjs
// The vm contexts get NO BroadcastChannel, so everything that reaches another "browser" went
// through the fake LiveKit server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ fake LiveKit
const RoomEvent = {
  DataReceived: 'dataReceived', ParticipantConnected: 'participantConnected', ParticipantDisconnected: 'participantDisconnected',
  Disconnected: 'disconnected', Reconnected: 'reconnected', TrackSubscribed: 'trackSubscribed', TrackUnsubscribed: 'trackUnsubscribed'
};

function fakeServer() {
  const rooms = new Map(); // name -> Map(identity -> FakeRoom)
  const srv = { rooms, dropLossy: false, delay: 3, sent: { lossy: 0, reliable: 0 }, tokens: [], failTokens: false, failConnect: false };
  class Room {
    constructor(opts) {
      this.opts = opts; this.handlers = new Map(); this.state = 'disconnected';
      this.remoteParticipants = new Map(); this.localParticipant = null; this.name = null;
    }
    on(e, fn) { if (!this.handlers.has(e)) this.handlers.set(e, []); this.handlers.get(e).push(fn); return this; }
    off(e, fn) { const l = this.handlers.get(e); if (l) this.handlers.set(e, l.filter((x) => x !== fn)); return this; }
    emit(e, ...a) { for (const fn of (this.handlers.get(e) || []).slice()) fn(...a); }
    async connect(url, token, opts) {
      assert.equal(url, 'ws://fake-livekit');
      if (srv.failConnect) throw new Error('could not establish signal connection');
      const { room, identity } = JSON.parse(Buffer.from(token, 'base64').toString());
      await sleep(2);
      this.name = room; this.connectOpts = opts;
      const me = this;
      this.localParticipant = {
        identity,
        async publishData(data, o) {
          assert.ok(data instanceof Uint8Array || (data && data.constructor && data.constructor.name === 'Uint8Array'), 'Uint8Array payload');
          assert.ok(data.byteLength <= 64000);
          srv.sent[o.reliable ? 'reliable' : 'lossy']++;
          if (!o.reliable && srv.dropLossy) return;
          const peers = rooms.get(room);
          if (!peers || me.state !== 'connected') return;
          const copy = new Uint8Array(data);
          for (const [id, r] of peers) {
            if (r === me) continue;
            setTimeout(() => { if (r.state === 'connected') r.emit(RoomEvent.DataReceived, copy, r.remoteParticipants.get(identity), o.reliable ? 0 : 1, o.topic); }, srv.delay);
          }
        }
      };
      if (!rooms.has(room)) rooms.set(room, new Map());
      const peers = rooms.get(room);
      const old = peers.get(identity);
      if (old) old._drop();
      this.state = 'connected';
      for (const [id, r] of peers) {
        this.remoteParticipants.set(id, { identity: id });
        r.remoteParticipants.set(identity, { identity });
        r.emit(RoomEvent.ParticipantConnected, { identity });
      }
      peers.set(identity, this);
    }
    _leaveServer() {
      const peers = rooms.get(this.name);
      if (!peers || peers.get(this.localParticipant.identity) !== this) return;
      peers.delete(this.localParticipant.identity);
      for (const [, r] of peers) {
        const p = r.remoteParticipants.get(this.localParticipant.identity);
        r.remoteParticipants.delete(this.localParticipant.identity);
        r.emit(RoomEvent.ParticipantDisconnected, p);
      }
    }
    _drop() { // server-side kick / connection lost for good
      if (this.state !== 'connected') return;
      this._leaveServer();
      this.state = 'disconnected';
      this.emit(RoomEvent.Disconnected, 'server');
    }
    async disconnect() {
      if (this.state !== 'connected') { this.state = 'disconnected'; return; }
      this._leaveServer();
      this.state = 'disconnected';
      this.emit(RoomEvent.Disconnected, 'client');
    }
  }
  srv.LivekitClient = { Room, RoomEvent };
  srv.fetch = async (url) => {
    const u = new URL(url, 'http://game.local');
    assert.equal(u.pathname, '/api/among-us/token');
    const room = u.searchParams.get('room'), identity = u.searchParams.get('identity');
    srv.tokens.push({ room, identity });
    const json = (status, body) => ({ ok: status === 200, status, json: async () => body });
    if (srv.failTokens) return json(500, { error: 'Server misconfigured' });
    if (!/^ss-[a-z0-9-]{1,40}$/.test(room) || !/^[A-Za-z0-9_-]{4,40}$/.test(identity)) return json(400, { error: 'bad' });
    return json(200, { token: Buffer.from(JSON.stringify({ room, identity })).toString('base64'), url: 'ws://fake-livekit' });
  };
  return srv;
}

function browser(srv, extra = {}) {
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, crypto, Uint8Array,
    SS_LIVEKIT: { tokenUrl: '/api/among-us/token' }, LivekitClient: srv.LivekitClient, fetch: srv.fetch,
    ...extra
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/config.js', 'js/net-livekit.js', 'js/net.js']) vm.runInContext(src(f), ctx, { filename: f });
  return ctx;
}
const ids = (room) => room.peers().map((p) => p.peer).sort().join();

test('init uses LiveKit when SS_LIVEKIT is set: lobby = ss-lobby, identity = myPeer', async () => {
  const srv = fakeServer();
  const A = browser(srv);
  assert.equal((await A.IS.net.init()).mode, 'livekit');
  assert.equal(A.IS.net.mode, 'livekit');
  assert.match(A.IS.net.myPeer, /^[a-z0-9]{12}$/);
  assert.equal(await A.IS.net.ready, A.IS.net.myPeer);
  assert.deepEqual(srv.tokens[0], { room: 'ss-lobby', identity: A.IS.net.myPeer });
  const lk = A.IS.lkTransport.livekitRoom('ss-lobby');
  assert.ok(lk && lk.state === 'connected');
  assert.equal(lk.localParticipant.identity, A.IS.net.myPeer);
  assert.equal(lk.connectOpts.autoSubscribe, false, 'lobby does not subscribe to media');
  assert.equal(A.IS.net.lobby.connected(), true);
  await A.IS.net.lobby.leave();
  assert.equal(A.IS.lkTransport.livekitRoom('ss-lobby'), null);
});

test('presence semantics match the local transport: merge, null removal, 4 KiB limit, frozen stable peers', async () => {
  const srv = fakeServer();
  const A = browser(srv);
  await A.IS.net.init();
  const ra = await A.IS.net.join('ss-test');
  assert.equal(await A.IS.net.join('ss-test'), ra, 'same object on re-join');
  await assert.rejects(A.IS.net.join('Bad Name'));
  assert.equal(A.IS.lkTransport.livekitRoom('ss-test').connectOpts.autoSubscribe, true, 'game rooms subscribe to audio');
  try {
    await ra.presence({ v: 1, n: 'A', x: 1 });
    await ra.presence({ x: 2, y: 3 });
    await ra.presence({ y: null });
    const me = ra.peers().find((p) => p.sameTab);
    assert.equal(JSON.stringify(me.presence), '{"v":1,"n":"A","x":2}');
    assert.ok(me.isMe && me.peer === A.IS.net.myPeer && typeof me.updatedAt === 'number');
    assert.ok(Object.isFrozen(me) && Object.isFrozen(me.presence) && Object.isFrozen(ra.peers()));
    await assert.rejects(ra.presence({ big: 'x'.repeat(4100) }), (e) => e.code === 'invalid_argument');
    assert.equal(ra.peers().find((p) => p.sameTab).presence.big, undefined);
    await assert.rejects(ra.presence({ 'bad key': 1 }), (e) => e.code === 'invalid_argument');
    await assert.rejects(ra.presence([1]), (e) => e.code === 'invalid_argument');
    // a presence close to the limit still travels (data packets allow 64 KB)
    await ra.presence({ pad: 'y'.repeat(3900) });
    const snap = ra.peers();
    assert.equal(ra.peers(), snap, 'stable identity while nothing changes');
  } finally { await ra.leave(); await A.IS.net.lobby.leave(); }
});

test('two browsers: join/update/coalesce/leave over LiveKit data packets', async () => {
  const srv = fakeServer();
  const A = browser(srv), B = browser(srv);
  await A.IS.net.init(); await B.IS.net.init();
  const ra = await A.IS.net.join('ss-abcd');
  const changesA = [];
  ra.onPeers((c) => changesA.push(c));
  await ra.presence({ v: 1, n: 'A' });
  const rb = await B.IS.net.join('ss-abcd');
  const changesB = [];
  rb.onPeers((c) => changesB.push(c));
  await rb.presence({ v: 1, n: 'B' });
  try {
    await sleep(200);
    assert.equal(ids(ra), [A.IS.net.myPeer, B.IS.net.myPeer].sort().join());
    assert.equal(ids(rb), ids(ra));
    const bOnA = ra.peers().find((p) => !p.sameTab);
    assert.equal(bOnA.peer, B.IS.net.myPeer);
    assert.equal(bOnA.isMe, false);
    assert.equal(bOnA.sameTab, false);
    assert.equal(bOnA.presence.n, 'B');
    assert.ok(Object.isFrozen(bOnA.presence));
    assert.equal(rb.peers().find((p) => !p.sameTab).presence.n, 'A', 'B got A presence (snapshot on connect)');
    assert.ok(changesA[0].joined.some((p) => p.sameTab), 'first delivery = room so far as joined');
    assert.ok(changesA.some((c) => c.joined.some((p) => p.peer === B.IS.net.myPeer)));
    // heartbeats (reliable snapshots) do not change snapshot identity
    const snap = ra.peers();
    const hb0 = srv.sent.reliable;
    await sleep(1150);
    assert.ok(srv.sent.reliable > hb0, 'reliable heartbeat snapshots are sent');
    assert.equal(ra.peers(), snap, 'snapshot identity stable across heartbeats');
    // coalescing: several updates in one frame -> at most a couple of updated entries
    const n0 = changesA.length, lossy0 = srv.sent.lossy;
    await rb.presence({ x: 1 }); await rb.presence({ x: 2 }); await rb.presence({ x: 3 });
    await sleep(200);
    const ups = changesA.slice(n0).flatMap((c) => c.updated.filter((p) => p.peer === B.IS.net.myPeer));
    assert.ok(ups.length >= 1 && ups.length <= 2, 'coalesced updates: ' + ups.length);
    assert.ok(srv.sent.lossy - lossy0 <= 2, 'lossy sends throttled: ' + (srv.sent.lossy - lossy0));
    assert.equal(ra.peers().find((p) => !p.sameTab).presence.x, 3);
    // every change arrives with lossy packets dropped, via the 1s reliable snapshot
    srv.dropLossy = true;
    await rb.presence({ x: 42 });
    await sleep(1300);
    assert.equal(ra.peers().find((p) => !p.sameTab).presence.x, 42, 'reliable snapshot repairs lost lossy updates');
    srv.dropLossy = false;
    // leave -> others see left right away (ParticipantDisconnected)
    const n1 = changesA.length;
    await rb.leave();
    await sleep(100);
    assert.equal(ra.peers().length, 1);
    assert.ok(changesA.slice(n1).some((c) => c.left.some((p) => p.peer === B.IS.net.myPeer)));
    assert.equal(B.IS.lkTransport.livekitRoom('ss-abcd'), null);
    // the lobby is a LiveKit room too: A sees B there
    await A.IS.net.lobby.presence({ v: 1, n: 'A', g: null });
    await B.IS.net.lobby.presence({ v: 1, n: 'B', g: 'QXBT' });
    await sleep(150);
    assert.equal(A.IS.net.lobby.peers().find((p) => !p.sameTab).presence.g, 'QXBT');
  } finally {
    await ra.leave(); await rb.leave(); await A.IS.net.lobby.leave(); await B.IS.net.lobby.leave();
  }
});

test('stale (reordered) snapshots never override newer updates; junk packets are ignored', async () => {
  const srv = fakeServer();
  const A = browser(srv);
  await A.IS.net.init();
  const ra = await A.IS.net.join('ss-order');
  const lk = A.IS.lkTransport.livekitRoom('ss-order');
  const enc = (s) => new TextEncoder().encode(s);
  const P = { identity: 'remote01' };
  try {
    lk.emit(RoomEvent.DataReceived, enc('p20|{"x":2}'), P, 1, 'ss');
    lk.emit(RoomEvent.DataReceived, enc('P10|{"x":1}'), P, 0, 'ss'); // older snapshot arrives late
    await sleep(80);
    assert.equal(ra.peers().find((p) => p.peer === 'remote01').presence.x, 2);
    lk.emit(RoomEvent.DataReceived, enc('p21|{"x":3}'), P, 1, 'ss');
    // junk
    lk.emit(RoomEvent.DataReceived, enc('p22|[1,2]'), P, 1, 'ss');
    lk.emit(RoomEvent.DataReceived, enc('p23|{bad'), P, 1, 'ss');
    lk.emit(RoomEvent.DataReceived, enc('hello'), P, 1, 'ss');
    lk.emit(RoomEvent.DataReceived, enc('p24|{"x":9}'), P, 1, 'other-topic');
    lk.emit(RoomEvent.DataReceived, enc('p25|{"x":9}'), undefined, 1, 'ss'); // server-sent
    lk.emit(RoomEvent.DataReceived, enc('p26|' + JSON.stringify({ big: 'z'.repeat(4100) })), P, 1, 'ss');
    lk.emit(RoomEvent.DataReceived, enc('p27|{"x":1}'), { identity: A.IS.net.myPeer }, 1, 'ss'); // spoofed self
    await sleep(80);
    assert.equal(JSON.stringify(ra.peers().find((p) => p.peer === 'remote01').presence), '{"x":3}');
    assert.equal(ra.peers().length, 2);
    assert.equal(JSON.stringify(ra.peers().find((p) => p.isMe).presence), '{}');
  } finally { await ra.leave(); await A.IS.net.lobby.leave(); }
});

test('silent peers time out after 4s once LiveKit no longer lists them', async () => {
  const srv = fakeServer();
  const A = browser(srv);
  await A.IS.net.init();
  const ra = await A.IS.net.join('ss-tmo');
  const lk = A.IS.lkTransport.livekitRoom('ss-tmo');
  try {
    lk.emit(RoomEvent.DataReceived, new TextEncoder().encode('P5|{"v":1}'), { identity: 'ghostpeer123' }, 0, 'ss');
    await sleep(100);
    assert.equal(ra.peers().length, 2);
    await sleep(5200);
    assert.equal(ra.peers().length, 1, 'timed out');
  } finally { await ra.leave(); await A.IS.net.lobby.leave(); }
});

test('a game room lost for good reports an error to onPeers; the lobby reconnects by itself', async () => {
  const srv = fakeServer();
  const A = browser(srv), B = browser(srv);
  await A.IS.net.init(); await B.IS.net.init();
  A.IS.lkTransport._timing.RETRY = 100;
  const ra = await A.IS.net.join('ss-drop');
  const rb = await B.IS.net.join('ss-drop');
  await ra.presence({ v: 1 }); await rb.presence({ v: 1 });
  let errA = null;
  ra.onPeers(() => {}, (e) => { errA = e; });
  try {
    await sleep(100);
    assert.equal(rb.peers().length, 2);
    A.IS.lkTransport.livekitRoom('ss-drop')._drop();
    await sleep(50);
    assert.ok(errA && errA.code === 'disconnected', 'error handler called');
    assert.equal(ra.connected(), false);
    assert.equal(rb.peers().length, 1, 'B saw A leave');
    // lobby: dropped, comes back with a fresh token and connection
    const before = srv.tokens.length;
    A.IS.lkTransport.livekitRoom('ss-lobby')._drop();
    await sleep(400);
    assert.ok(srv.tokens.length > before, 'new token requested');
    assert.equal(A.IS.net.lobby.connected(), true);
    assert.equal(A.IS.lkTransport.livekitRoom('ss-lobby').state, 'connected');
  } finally { await ra.leave(); await rb.leave(); await A.IS.net.lobby.leave(); await B.IS.net.lobby.leave(); }
});

test('token / connect failures: init falls back to local play, join rejects', async () => {
  const srv = fakeServer();
  srv.failTokens = true;
  const A = browser(srv);
  assert.equal((await A.IS.net.init()).mode, 'offline', 'no BroadcastChannel in this context -> offline');
  const B = browser(srv, { BroadcastChannel });
  assert.equal((await B.IS.net.init()).mode, 'local');
  await B.IS.net.lobby.leave();

  const srv2 = fakeServer();
  const C = browser(srv2);
  assert.equal((await C.IS.net.init()).mode, 'livekit');
  srv2.failConnect = true;
  await assert.rejects(C.IS.net.join('ss-fail'));
  assert.equal(C.IS.lkTransport.livekitRoom('ss-fail'), null);
  srv2.failConnect = false;
  const r = await C.IS.net.join('ss-fail');
  assert.equal(r.connected(), true, 'a later join works');
  await r.leave(); await C.IS.net.lobby.leave();
});

test('without SS_LIVEKIT the transport is inert and net.js keeps its old behaviour', async () => {
  const srv = fakeServer();
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, crypto, BroadcastChannel, LivekitClient: srv.LivekitClient, fetch: srv.fetch };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/config.js', 'js/net-livekit.js', 'js/net.js']) vm.runInContext(src(f), ctx, { filename: f });
  assert.equal(ctx.IS.lkTransport.available(), false);
  assert.equal((await ctx.IS.net.init()).mode, 'local');
  assert.equal(srv.tokens.length, 0, 'no token requests');
  await ctx.IS.net.lobby.leave();
});
