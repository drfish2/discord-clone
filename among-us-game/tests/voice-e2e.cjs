// End-to-end: the self-hosted build (public/among-us/index.html) over a REAL LiveKit server.
// 4 players in SEPARATE browser contexts (so BroadcastChannel cannot carry anything) create/join/
// start a game over LiveKit, publish fake microphones and check the proximity voice mix.
//
//   livekit-server --dev --bind 127.0.0.1 --node-ip 127.0.0.1      # ws://localhost:7880, devkey/secret
//   node tools/build.mjs --selfhost
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/voice-e2e.cjs
// Env: LIVEKIT_URL (default ws://localhost:7880), LIVEKIT_API_KEY/SECRET (default devkey/secret),
//      LIVEKIT_BIN (optional: path of a livekit-server binary to start in --dev mode).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8791;
const root = path.join(__dirname, '..');
const shots = path.join(__dirname, 'voice-shots');
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failures++; }
async function waitFor(page, fn, arg, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, arg)) return true;
    await sleep(150);
  }
  return false;
}

(async () => {
  const procs = [];
  if (process.env.LIVEKIT_BIN) {
    procs.push(spawn(process.env.LIVEKIT_BIN, ['--dev', '--bind', '127.0.0.1', '--node-ip', '127.0.0.1'], { stdio: 'ignore' }));
    await sleep(2000);
  }
  const env = {
    ...process.env,
    LIVEKIT_URL: process.env.LIVEKIT_URL || 'ws://localhost:7880',
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY || 'devkey',
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET || 'secret'
  };
  const server = spawn(process.execPath, [path.join(root, 'tools', 'voice-dev-server.mjs'), `--port=${PORT}`, '--host=127.0.0.1'], { env, stdio: 'ignore' });
  procs.push(server);
  await sleep(800);

  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
  });
  const N = 4;
  const names = ['Hosty', 'Bea', 'Cid', 'Dot'];
  const pages = [], errors = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, permissions: ['microphone'] });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`[${i}] ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${i}] console: ${m.text()}`); });
    await p.goto(`http://localhost:${PORT}/among-us`);
    pages.push(p);
  }
  for (let i = 0; i < N; i++) {
    check(await waitFor(pages[i], () => window.IS && IS.net && IS.net.mode === 'livekit'), `tab ${i} uses the LiveKit transport`);
  }
  const peers = [];
  for (let i = 0; i < N; i++) peers.push(await pages[i].evaluate(() => IS.net.myPeer));
  check(await pages[0].evaluate(() => !!window.LivekitClient && !!window.SS_LIVEKIT), 'self-hosted build has livekit-client + SS_LIVEKIT');

  // ---------------------------------------------------------------- create / list / join
  await pages[0].fill('#ui-name', names[0]);
  await pages[0].click('text=Host Game');
  check(await waitFor(pages[0], () => IS.client.state() && IS.client.state().code), 'host created a game');
  const code = await pages[0].evaluate(() => IS.client.state().code);
  console.log('code', code);
  check(await waitFor(pages[1], () => document.body.innerText.includes('Hosty')), 'game listed on another browser (LiveKit lobby room)');
  for (let i = 1; i < N; i++) {
    await pages[i].fill('#ui-name', names[i]);
    await pages[i].fill('input[aria-label="Game code"]', code);
    await pages[i].click('button:has-text("Join")');
  }
  check(await waitFor(pages[0], (n) => IS.client.state().players.length === n, N, 20000), `host sees ${N} players in the lobby`);
  for (let i = 0; i < N; i++) {
    check(await waitFor(pages[i], () => { const d = document.querySelector('.vc-dock'); return d && !d.hidden; }), `tab ${i} shows the voice widget`);
  }
  await pages[1].screenshot({ path: path.join(shots, '01-lobby.png') });

  // ---------------------------------------------------------------- mic + subscriptions
  for (let i = 0; i < N; i++) await pages[i].click('.vc-mic');
  for (let i = 0; i < N; i++) {
    check(await waitFor(pages[i], () => IS.voice.micOn()), `tab ${i} mic published`);
  }
  const subOk = [];
  for (let i = 0; i < N; i++) {
    subOk.push(await waitFor(pages[i], (n) => {
      const d = IS.voice._debug();
      return Object.keys(d.remotes).length === n - 1 && Object.values(d.remotes).every((r) => r.webaudio) && d.ctx === 'running';
    }, N, 20000));
    check(subOk[i], `tab ${i} subscribed to ${N - 1} remote voices through WebAudio`);
  }
  check(await pages[0].evaluate(() => document.querySelectorAll('audio').length === 0), 'no LiveKit <audio> elements attached to the page');
  await sleep(600);
  const lobbyGains = await pages[0].evaluate(() => IS.voice._debug().remotes);
  check(Object.values(lobbyGains).every((r) => r.target === 1 && r.gain > 0.9), 'lobby: everyone at full volume ' + JSON.stringify(Object.values(lobbyGains).map((r) => +r.gain.toFixed(2))));
  const probe = await pages[0].evaluate((p) => IS.voice._probe(p, 2500), peers[1]);
  check(probe && probe.pre > 0.01 && probe.post > 0.01, 'real audio from tab 1 reaches tab 0 WebAudio graph ' + JSON.stringify(probe));
  check(await waitFor(pages[0], (p) => IS.voice.isSpeaking(p), peers[1], 15000), 'isSpeaking(tab 1) turns on (fake mic beeps)');
  await pages[0].screenshot({ path: path.join(shots, '02-lobby-voice.png') });
  // mute tab 1 -> it stops speaking
  await pages[1].click('.vc-mic');
  check(await waitFor(pages[1], () => !IS.voice.micOn()), 'tab 1 muted');
  check(await waitFor(pages[0], (p) => {
    // speaking must stay off for 2.5 s
    window.__sp = window.__sp || { since: Date.now() };
    if (IS.voice.isSpeaking(p)) window.__sp.since = Date.now();
    return Date.now() - window.__sp.since > 2500;
  }, peers[1], 15000), 'isSpeaking(tab 1) turns off after muting');
  await pages[1].click('.vc-mic');
  check(await waitFor(pages[1], () => IS.voice.micOn()), 'tab 1 unmuted');
  // push-to-talk on tab 3: T held -> mic on, released -> off
  await pages[3].click('.vc-mode');
  check(await waitFor(pages[3], () => !IS.voice.micOn()), 'PTT mode: mic off while T is not held');
  await pages[3].keyboard.down('KeyT');
  check(await waitFor(pages[3], () => IS.voice.micOn()), 'PTT: holding T opens the mic');
  await pages[3].keyboard.up('KeyT');
  check(await waitFor(pages[3], () => !IS.voice.micOn()), 'PTT: releasing T closes the mic');
  await pages[3].click('.vc-mode');
  await pages[3].click('.vc-mic');
  check(await waitFor(pages[3], () => IS.voice.micOn()), 'back to open mic on tab 3');

  // ---------------------------------------------------------------- start the game
  await pages[0].evaluate(() => IS.client.act('set', Object.assign({}, IS.client.state().hs.st, { dis: 0, vot: 30, kcd: 10, nt: 3, map: 0, emg: 3 })));
  await sleep(500);
  await pages[0].click('button.start-btn');
  for (let i = 0; i < N; i++) check(await waitFor(pages[i], () => IS.client.state().phase === 'play', null, 15000), `tab ${i} in play`);
  const info = [];
  for (let i = 0; i < N; i++) info.push(await pages[i].evaluate(() => ({ slot: IS.client.state().mySlot, role: IS.client.state().myRole })));
  const imp = info.findIndex((x) => x.role === 1);
  const crew = [0, 1, 2, 3].filter((i) => i !== imp);
  check(imp >= 0, 'one impostor: tab ' + imp);
  const [L, nearI, farI] = crew; // listener, near speaker, far speaker

  // find a spot pair: two walkable points ~90px apart with a wall between them
  const spots = await pages[L].evaluate(() => {
    const T = IS.CONFIG.TILE, out = {};
    const free = (x, y) => IS.map.isWalkable(x, y);
    for (let ty = 1; ty < IS.map.H - 1 && !out.wall; ty++) {
      for (let tx = 1; tx < IS.map.W - 4 && !out.wall; tx++) {
        const x = tx * T + T / 2, y = ty * T + T / 2;
        if (!free(x, y)) continue;
        for (const [dx, dy] of [[2, 0], [3, 0], [0, 2], [0, 3]]) {
          const x2 = x + dx * T, y2 = y + dy * T;
          if (free(x2, y2) && !IS.map.lineOfSight(x, y - 20, x2, y2 - 20)) { out.wall = { a: { x, y }, b: { x: x2, y: y2 } }; break; }
        }
      }
    }
    const b = IS.map.button;
    out.open = { a: { x: b.x - 60, y: b.y + 60 }, near: { x: b.x + 10, y: b.y + 60 }, far: { x: b.x - 60 + 200, y: b.y + 60 } };
    return out;
  });
  check(!!spots.wall, 'found two close spots separated by a wall');
  const place = (i, pt) => pages[i].evaluate((q) => { IS.main._me.x = q.x; IS.main._me.y = q.y; }, pt);
  const gainOf = (i, peer) => pages[i].evaluate((p) => { const r = IS.voice._debug().remotes[p]; return r ? r.gain : -1; }, peer);
  const settle = async () => { await sleep(1200); };

  // near vs far vs out of range
  await place(L, spots.open.a); await place(nearI, spots.open.near); await place(farI, spots.open.far);
  await place(imp, { x: spots.open.a.x + 4000, y: spots.open.a.y });
  await settle();
  const losFar = await pages[L].evaluate((s) => IS.map.lineOfSight(s.a.x, s.a.y - 20, s.far.x, s.far.y - 20), spots.open);
  const gNear = await gainOf(L, peers[nearI]), gFar = await gainOf(L, peers[farI]), gOut = await gainOf(L, peers[imp]);
  console.log('   gains near/far/out', gNear.toFixed(3), gFar.toFixed(3), gOut.toFixed(3), 'los far', losFar);
  check(gNear > 0.95, 'play: player next to me at full volume');
  check(losFar ? gFar > 0.01 && gFar < 0.6 : gFar === 0, 'play: farther player attenuated');
  check(gOut < 0.01, 'play: player across the map is silent');
  const pr = await pages[L].evaluate((p) => IS.voice._probe(p, 2000), peers[nearI]);
  const pf = await pages[L].evaluate((p) => IS.voice._probe(p, 2000), peers[imp]);
  check(pr && pr.post > 0.01, 'near voice audible after the gain node ' + JSON.stringify(pr));
  check(pf && pf.pre > 0.01 && pf.post < 0.002, 'far voice arrives but is silenced by the gain node ' + JSON.stringify(pf));
  const pans = await pages[L].evaluate(() => IS.voice._debug().remotes);
  check(pans[peers[farI]].pan > 0, 'stereo: player to my right pans right');
  await pages[L].screenshot({ path: path.join(shots, '03-play.png') });

  // behind a wall
  await place(L, spots.wall.a); await place(nearI, spots.wall.b);
  await settle();
  const gWall = await gainOf(L, peers[nearI]);
  check(gWall < 0.01, 'play: close player behind a wall is silent (' + gWall.toFixed(3) + ')');

  // impostor in a vent is silent
  await place(L, spots.open.a); await place(imp, spots.open.near);
  await settle();
  check((await gainOf(L, peers[imp])) > 0.95, 'impostor next to me is audible');
  await pages[imp].evaluate(() => { IS.main._me.vt = 1; });
  check(await waitFor(pages[L], (p) => IS.voice._debug().remotes[p].gain < 0.01, peers[imp], 5000), 'impostor in a vent is muted');
  await pages[imp].evaluate(() => { IS.main._me.vt = 0; });

  // ---------------------------------------------------------------- ghosts
  // impostor kills the far crewmate
  const victim = farI;
  check(await waitFor(pages[imp], () => (IS.client.state().hs.kc[IS.client.state().mySlot] || 0) <= IS.client.now(), null, 20000), 'kill cooldown elapsed');
  await place(victim, spots.open.far);
  await place(imp, { x: spots.open.far.x + 20, y: spots.open.far.y });
  await sleep(700);
  await pages[imp].evaluate(() => IS.main._debug.doKill());
  check(await waitFor(pages[victim], () => !IS.client.state().alive, null, 8000), 'victim is a ghost');
  await place(victim, spots.open.near);
  await place(L, spots.open.a);
  await settle();
  check((await gainOf(L, peers[victim])) < 0.01, 'play: the living do not hear a ghost standing next to them');
  check((await gainOf(victim, peers[L])) > 0.95, 'play: ghosts hear the living');
  check((await gainOf(victim, peers[imp])) > 0.95, 'play: ghosts hear everyone, even far away');
  await pages[victim].screenshot({ path: path.join(shots, '04-ghost.png') });
  check(await waitFor(pages[L], (p) => { // a ghost talking must not show as speaking to the living
    window.__g = window.__g || { since: Date.now() };
    if (IS.voice.isSpeaking(p)) window.__g.since = Date.now();
    return Date.now() - window.__g.since > 2500;
  }, peers[victim], 10000), 'living players never see a ghost as speaking');

  // ---------------------------------------------------------------- meeting
  await place(L, spots.open.a); await place(nearI, { x: spots.open.a.x + 3000, y: spots.open.a.y });
  await pages[L].evaluate(() => IS.client.act('emg'));
  for (let i = 0; i < N; i++) check(await waitFor(pages[i], () => IS.client.state().phase === 'meeting', null, 8000), `tab ${i} in meeting`);
  await settle();
  check((await gainOf(L, peers[nearI])) > 0.95, 'meeting: far-away living player at full volume');
  check((await gainOf(L, peers[imp])) > 0.95, 'meeting: everyone alive hears everyone alive');
  check((await gainOf(L, peers[victim])) < 0.01, 'meeting: the living cannot hear ghosts');
  check((await gainOf(victim, peers[L])) > 0.95, 'meeting: ghosts hear the living');
  check(await waitFor(pages[L], (p) => IS.voice.isSpeaking(p), peers[nearI], 15000), 'meeting: speaking indicator for a living player');
  await pages[L].screenshot({ path: path.join(shots, '05-meeting.png') });

  // vote out the impostor -> game over -> everyone hears everyone
  for (const i of [0, 1, 2, 3]) if (i !== victim) await pages[i].evaluate((t) => IS.client.act('vote', t), info[imp].slot);
  check(await waitFor(pages[0], () => IS.client.state().phase === 'over', null, 20000), 'game over');
  await settle();
  check((await gainOf(L, peers[victim])) > 0.95, 'over: the living hear the ghost again');
  await pages[L].screenshot({ path: path.join(shots, '06-over.png') });

  // ---------------------------------------------------------------- leaving cleans up
  await pages[nearI].evaluate(() => IS.client.leave());
  check(await waitFor(pages[nearI], () => { const d = document.querySelector('.vc-dock'); return !IS.voice.active() && (!d || d.hidden); }), 'leaving the game hides the widget and stops voice');
  check(await waitFor(pages[L], (p) => !IS.voice._debug().remotes[p], peers[nearI], 8000), 'others drop the leaver\'s audio');

  console.log(errors.length ? 'page errors:\n  ' + errors.join('\n  ') : 'no page errors');
  if (errors.length) failures++;
  console.log(failures ? `${failures} FAILURES` : 'ALL PASSED');
  await browser.close();
  for (const p of procs) p.kill();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
