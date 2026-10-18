// End-to-end multi-tab test of net.js + host.js + client.js over the BroadcastChannel transport.
// Run: NODE_PATH=/opt/node22/lib/node_modules node tests/net-e2e.mjs
// (starts `npx http-server <game dir> -p 8092 -s` itself unless something already listens there)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8092;
const URL = `http://127.0.0.1:${PORT}/tests/net-harness.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = () => new Promise((res) => {
  http.get(URL, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false));
});
async function waitFor(desc, fn, timeout = 15000, every = 100) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error('timeout waiting for ' + desc + ' (last: ' + (last && last.message ? last.message : JSON.stringify(last)) + ')');
}
const step = (s) => console.log('• ' + s);

let server = null;
if (!(await up())) {
  server = spawn('npx', ['http-server', root, '-p', String(PORT), '-s', '-c-1'], { stdio: 'ignore', detached: true });
  await waitFor('http-server', up, 20000, 200);
}

const browser = await chromium.launch();
let failed = false;
try {
  const context = await browser.newContext();
  const pages = [];
  for (let i = 0; i < 4; i++) {
    const p = await context.newPage();
    p.on('pageerror', (e) => { console.log(`[page${i}] pageerror:`, e.message); failed = true; });
    p.on('console', (m) => { if (m.type() === 'error') console.log(`[page${i}] console.error:`, m.text()); });
    await p.goto(URL);
    const r = await p.evaluate(() => window.BOOT);
    assert.equal(r.mode, 'local');
    pages.push(p);
  }
  const S = (p) => p.evaluate(() => {
    const s = IS.client.state();
    return { phase: s.phase, mySlot: s.mySlot, myRole: s.myRole, alive: s.alive, hostPeer: s.hostPeer, isHost: s.isHost,
      players: s.players.map((q) => ({ slot: q.slot, peer: q.peer, name: q.name, color: q.color, alive: q.alive, conn: q.conn, role: q.role, x: q.x, y: q.y })),
      hs: s.hs, me: IS.client.me() };
  });
  const all = (fn) => Promise.all(pages.map(fn));

  step('create game on page 0');
  const code = await pages[0].evaluate(() => IS.client.create({ name: 'Alice', color: 2 }));
  assert.match(code, /^[A-HJ-NP-Z]{4}$/);
  assert.equal(await pages[0].evaluate(() => IS.client.isHost()), true);

  step(`game list shows ${code} on other tabs`);
  await waitFor('public game list', () => pages[1].evaluate((c) => LOG.games.some((g) => g.code === c && g.count === 1), code));

  step('join from pages 1-3 (all prefer colour 2)');
  await pages[1].evaluate((c) => IS.client.join({ code: c, name: 'Bob', color: 2 }), code);
  await pages[2].evaluate((c) => IS.client.join({ code: c, name: 'Cara', color: 2 }), code);
  await pages[3].evaluate((c) => IS.client.join({ code: c, name: 'Dan', color: 5 }), code);
  const bad = await pages[3].evaluate(() => IS.client.join({ code: 'ZZZZ', name: 'x' }).then(() => 'ok', (e) => e.message));
  assert.equal(bad, 'not_found');
  await pages[3].evaluate((c) => IS.client.join({ code: c, name: 'Dan', color: 5 }), code);

  await waitFor('4 players in lobby everywhere', async () => (await all(S)).every((s) => s.phase === 'lobby' && s.players.length === 4 && s.mySlot >= 0));
  let st = await S(pages[1]);
  const colours = st.players.map((q) => q.color);
  console.log('  lobby:', st.players.map((q) => `${q.slot}:${q.name}/c${q.color}`).join(' '));
  assert.equal(new Set(colours).size, 4, 'unique colours');
  assert.equal(st.players[0].color, 2, 'creator keeps preferred colour');
  assert.equal(st.players.find((q) => q.name === 'Dan').color, 5);
  const peers = await all((p) => p.evaluate(() => IS.client.me()));
  assert.ok((await all(S)).every((s) => s.hostPeer === peers[0]), 'everyone agrees on host');
  await waitFor('lobby list count 4', () => pages[1].evaluate((c) => LOG.games.some((g) => g.code === c && g.count === 4), code));

  step('host sets settings (dis 0, vot 15) and starts');
  await pages[0].evaluate(() => IS.client.act('set', { dis: 0, vot: 15, kcd: 10 }));
  await waitFor('settings applied', async () => (await S(pages[2])).hs.st.vot === 15);
  await pages[0].evaluate(() => IS.client.act('start'));
  await waitFor('roles phase everywhere', async () => (await all(S)).every((s) => s.phase === 'roles' || s.phase === 'play'));
  await waitFor('play phase everywhere', async () => (await all(S)).every((s) => s.phase === 'play'), 10000);
  const phasesSeen = await all((p) => p.evaluate(() => LOG.phases.join('>')));
  console.log('  phase events:', phasesSeen[1]);
  assert.ok(phasesSeen.every((x) => /lobby>roles>play$/.test(x)));
  let states = await all(S);
  const roles = states.map((s) => s.myRole);
  const hsRoles = JSON.stringify(states[0].hs.pl.map((e) => e[3]));
  assert.ok(states.every((s) => JSON.stringify(s.hs.pl.map((e) => e[3])) === hsRoles), 'consistent roles');
  assert.deepEqual(roles, states.map((s) => s.hs.pl[s.mySlot][3]));
  assert.equal(roles.filter((r) => r === 1).length, 1, 'exactly one impostor');
  // crew must not see the impostor's role
  const crewView = states.find((s) => s.myRole === 0);
  assert.ok(crewView.players.every((q) => q.role === 0 || q.peer === crewView.me));
  const impIdx = roles.indexOf(1);
  console.log('  roles by page:', roles.join(','), '— host is', roles[0] ? 'impostor' : 'crew');
  const chats = await all((p) => p.evaluate(() => IS.client.state().myTasks.length));
  assert.ok(chats.every((n, i) => (roles[i] === 0 ? n === 5 : true)), 'myTasks from IS.map.assignTasks');

  // Victim: the host if the host is crew (so the game can continue after the host leaves).
  const victimIdx = roles[0] === 0 ? 0 : roles.findIndex((r) => r === 0);
  const victimSlot = states[victimIdx].mySlot;
  const impSlot = states[impIdx].mySlot;

  step(`impostor (page ${impIdx}) kills page ${victimIdx}`);
  await pages[impIdx].evaluate(() => IS.client.setSelf({ x: 500, y: 500, f: 1, m: 0, vt: 0, fx: '' }));
  await pages[victimIdx].evaluate(() => IS.client.setSelf({ x: 520, y: 505, f: -1, m: 1, vt: 0, fx: '' }));
  await waitFor('positions propagate', async () => {
    const s = await S(pages[1]);
    return s.players[victimSlot].x === 520 && s.players[impSlot].x === 500;
  });
  // too early (initial cooldown) -> ignored
  await pages[impIdx].evaluate((t) => IS.client.act('kill', t), victimSlot);
  await sleep(400);
  assert.equal((await S(pages[0])).hs.pl[victimSlot][2], 1, 'kill during cooldown ignored');
  await waitFor('kill cooldown over', () => pages[impIdx].evaluate((s) => IS.client.now() >= IS.client.state().hs.kc[s] + 50, impSlot), 15000, 200);
  await pages[impIdx].evaluate((t) => IS.client.act('kill', t), victimSlot);
  await waitFor('victim dead everywhere', async () => (await all(S)).every((s) => s.hs.pl[victimSlot][2] === 0 && s.hs.bd.length === 1));
  assert.equal((await S(pages[victimIdx])).alive, false);
  assert.deepEqual((await S(pages[2])).hs.bd[0], [victimSlot, 520, 505]);

  step('a living crewmate reports, chat, everyone votes skip');
  const reporterIdx = roles.findIndex((r, i) => r === 0 && i !== victimIdx);
  await pages[reporterIdx].evaluate((b) => IS.client.act('rep', b), victimSlot);
  await waitFor('meeting everywhere', async () => (await all(S)).every((s) => s.phase === 'meeting'));
  await pages[reporterIdx].evaluate(() => IS.client.chat('it was​ red!'));
  await pages[victimIdx].evaluate(() => IS.client.chat('ghost talk'));
  const otherAlive = pages.findIndex((p, i) => i !== reporterIdx && i !== victimIdx);
  await waitFor('chat received', () => pages[otherAlive].evaluate(() => LOG.chats.some((c) => c.text === 'it was red!')));
  await sleep(300);
  const aliveChats = await pages[otherAlive].evaluate(() => LOG.chats.map((c) => c.text));
  assert.ok(!aliveChats.includes('ghost talk'), 'alive players do not see ghost chat');
  await waitFor('ghost sees alive chat', () => pages[victimIdx].evaluate(() => LOG.chats.some((c) => c.text === 'it was red!' && !c.dead)));
  // dead players cannot vote; alive ones skip
  for (let i = 0; i < 4; i++) await pages[i].evaluate(() => IS.client.act('vote', -1));
  await waitFor('eject phase', async () => (await all(S)).every((s) => s.phase === 'eject'));
  st = await S(pages[1]);
  assert.equal(st.hs.ej.s, -1);
  await waitFor('back to play after ejection', async () => (await all(S)).every((s) => s.phase === 'play'), 12000);

  step('close the host page; a new host must take over');
  const before = await S(pages[1]);
  const prevSq = before.hs.sq;
  await pages[0].close();
  pages.shift();
  const remainingRoles = roles.slice(1);
  await waitFor('new host elected = page 1 (Bob)', async () => (await all(S)).every((s) => s.hostPeer === peers[1]), 8000);
  assert.equal(await pages[0].evaluate(() => IS.client.isHost()), true);
  await waitFor('new host publishes', async () => (await S(pages[2])).hs.sq > prevSq, 5000);
  await waitFor('old host marked disconnected', async () => (await all(S)).every((s) => s.hs.pl[0][6] === 0), 8000);
  states = await all(S);
  console.log('  after migration: phase', states[0].phase, 'winner', JSON.stringify(states[0].hs.wn));

  if (roles[0] === 0) {
    // the old host was the (dead) victim -> game continues: emergency meeting via the new host
    const caller = remainingRoles.findIndex((r) => r === 0);
    assert.equal(states[0].phase, 'play');
    await pages[caller].evaluate(() => IS.client.act('emg'));
    await waitFor('meeting under new host', async () => (await all(S)).every((s) => s.phase === 'meeting'));
    // vote out the impostor -> crew wins
    const imp = (await S(pages[0])).hs.pl.findIndex((e) => e[3] === 1);
    for (let i = 0; i < 3; i++) await pages[i].evaluate((t) => IS.client.act('vote', t), imp);
    await waitFor('crew wins by vote', async () => (await all(S)).every((s) => s.phase === 'over' && s.hs.wn.t === 'crew' && s.hs.wn.r === 'vote'), 12000);
  } else {
    // the old host was the impostor -> crew wins by disconnect, new host can play again
    await waitFor('crew wins by disconnect', async () => (await all(S)).every((s) => s.phase === 'over' && s.hs.wn.r === 'disconnect'));
  }
  step('new host: again -> lobby with the 3 remaining players');
  await pages[0].evaluate(() => IS.client.act('again'));
  await waitFor('lobby with 3', async () => (await all(S)).every((s) => s.phase === 'lobby' && s.players.length === 3), 8000);
  await pages[0].evaluate(() => IS.client.act('start'));
  await waitFor('second game starts', async () => (await all(S)).every((s) => s.phase === 'roles' && s.hs.gn === 2), 8000);
  const offs = await all((p) => p.evaluate(() => IS.client.now() - Date.now()));
  console.log('  clock offsets (ms):', offs.join(', '));
  assert.ok(offs.every((o) => Math.abs(o) < 200));
  const kicked = await all((p) => p.evaluate(() => LOG.kicked.length));
  assert.ok(kicked.every((k) => k === 0));
  if (failed) throw new Error('page errors occurred');
  console.log('\nE2E PASS');
} catch (e) {
  console.error('\nE2E FAIL:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (server) { try { process.kill(-server.pid); } catch (e) { /* ignore */ } }
}
