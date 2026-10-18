// World agent: map sanity checks. Run: node tests/world-map.test.mjs [--ascii]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {}, Math, console };
ctx.window.window = ctx.window;
vm.createContext(ctx);
const mapFiles = fs.existsSync(path.join(root, 'js/maps')) ? fs.readdirSync(path.join(root, 'js/maps')).filter(f => f.endsWith('.js')).sort().map(f => 'js/maps/' + f) : [];
for (const f of ['js/config.js', 'js/map.js', ...mapFiles]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8').replace(/\bwindow\b/g, 'window'), ctx, { filename: f });
}
const IS = ctx.window.IS;
const M = IS.map, C = IS.CONFIG, T = C.TILE, R = C.PLAYER_RADIUS;
let fails = 0;
const fail = (m) => { fails++; console.log('FAIL', m); };

const only = (process.argv.find(a => a.startsWith('--map=')) || '').slice(6);
for (const info of M.list()) {
if (only && info.id !== only) continue;
M.select(info.id);
console.log(`== map ${info.id} (${info.name}) ${M.W}x${M.H}`);
const before = fails;
if (process.argv.includes('--ascii')) {
  const ch = [' ', '.', '#'];
  const rows = [];
  for (let y = 0; y < M.H; y++) {
    let s = '';
    for (let x = 0; x < M.W; x++) {
      let c = ch[M.grid[y * M.W + x]];
      s += c;
    }
    rows.push(s);
  }
  const put = (px, py, c) => { const x = Math.floor(px / T), y = Math.floor(py / T); rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1); };
  M.props.forEach(p => { if (p.solid) for (let y = p.y; y < p.y + p.h; y += T / 2) for (let x = p.x; x < p.x + p.w; x += T / 2) put(x + 1, y + 1, 'o'); });
  M.STATIONS.forEach(s => put(s.x, s.y, 'S'));
  M.vents.forEach(v => put(v.x, v.y, 'V'));
  Object.values(M.FIX).flat().forEach(f => put(f.x, f.y, 'F'));
  put(M.button.x, M.button.y, 'B');
  for (let i = 0; i < 10; i++) { const s = M.spawn(i, 10); put(s.x, s.y, String(i)); }
  console.log(rows.map((r, i) => String(i).padStart(2) + ' ' + r).join('\n'));
}

// required fixtures
const spawnRoom = M.roomAt(M.button.x, M.button.y)?.id;
if (!spawnRoom) fail('emergency button is not inside a room');
const fixCount = { reactor: 2, o2: 2, lights: 1, comms: 1 };
for (const k in fixCount) if (!M.FIX[k] || M.FIX[k].length !== fixCount[k]) fail(`FIX.${k} needs ${fixCount[k]} points, has ${M.FIX[k] ? M.FIX[k].length : 0}`);
if (M.STATIONS.length < 18) fail('fewer than 18 task stations: ' + M.STATIONS.length);
if (M.vents.length < 6) fail('fewer than 6 vents: ' + M.vents.length);
const kindSet = new Set(M.TASKS.map(t => t.kind));
if (kindSet.size < 10) fail('fewer than 10 distinct task kinds: ' + [...kindSet].join(','));

// --- reachability flood fill over "standable" positions on a fine lattice (8px) ---
const STEP = 8;
const GW = Math.ceil(M.W * T / STEP), GH = Math.ceil(M.H * T / STEP);
const ok = new Uint8Array(GW * GH);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
  const x = i * STEP + STEP / 2, y = j * STEP + STEP / 2;
  if (M.canStand(x, y, R)) ok[j * GW + i] = 1;
}
const start = M.spawn(0, 10);
const reach = new Uint8Array(GW * GH);
const si = Math.floor(start.x / STEP), sj = Math.floor(start.y / STEP);
if (!ok[sj * GW + si]) fail('spawn not standable');
const q = [sj * GW + si]; reach[q[0]] = 1;
while (q.length) {
  const k = q.pop(); const i = k % GW, j = (k / GW) | 0;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
    const nk = nj * GW + ni; if (ok[nk] && !reach[nk]) { reach[nk] = 1; q.push(nk); }
  }
}
// verify the movement code agrees: lattice neighbours must be reachable with moveCircle
let mcBad = 0, mcTot = 0;
for (let k = 0; k < GW * GH && mcTot < 4000; k += 37) {
  if (!reach[k]) continue;
  const i = k % GW, j = (k / GW) | 0, x = i * STEP + 4, y = j * STEP + 4;
  if (reach[k + 1]) { mcTot++; const r = M.moveCircle(x, y, STEP, 0, R); if (Math.abs(r.x - (x + STEP)) > 0.5) mcBad++; }
}
if (mcBad > 0) fail(`moveCircle blocked between standable lattice points: ${mcBad}/${mcTot}`);

const reachAt = (x, y) => { const i = Math.floor(x / STEP), j = Math.floor(y / STEP); return reach[j * GW + i] === 1; };
// a reachable standing point within dist of (x,y)
function nearestReach(x, y) {
  let best = Infinity;
  for (let j = Math.floor((y - 100) / STEP); j <= Math.floor((y + 100) / STEP); j++)
    for (let i = Math.floor((x - 100) / STEP); i <= Math.floor((x + 100) / STEP); i++) {
      if (i < 0 || j < 0 || i >= GW || j >= GH || !reach[j * GW + i]) continue;
      const px = i * STEP + STEP / 2, py = j * STEP + STEP / 2;
      best = Math.min(best, Math.hypot(px - x, py - y));
    }
  return best;
}

// rooms reachable
for (const r of M.rooms) {
  let any = false;
  for (let y = r.y; y < r.y + r.h && !any; y++) for (let x = r.x; x < r.x + r.w && !any; x++) {
    if (reachAt(x * T + T / 2, y * T + T / 2)) any = true;
  }
  if (!any) fail('room unreachable: ' + r.id);
}
// all floor cells reachable (no orphan islands)
let orphan = 0;
for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) {
  if (M.grid[y * M.W + x] !== 1) continue;
  let any = false;
  for (let j = 0; j < T / STEP && !any; j++) for (let i = 0; i < T / STEP; i++) if (reach[(y * T / STEP + j) * GW + x * T / STEP + i]) { any = true; break; }
  if (!any && !M.props.some(p => p.solid && x * T + T / 2 > p.x - R && x * T + T / 2 < p.x + p.w + R && y * T + T / 2 > p.y - R && y * T + T / 2 < p.y + p.h + R)) { orphan++; if (orphan < 10) console.log('  orphan floor cell', x, y); }
}
if (orphan) fail('orphan floor cells: ' + orphan);

const checkPt = (label, x, y, range) => {
  const d = nearestReach(x, y);
  if (!(d <= range - 2)) fail(`${label} at (${x},${y}) nearest reachable stand ${d.toFixed(1)} > ${range}`);
  return d;
};
let maxD = 0;
M.STATIONS.forEach(s => { maxD = Math.max(maxD, checkPt(`station ${s.id} ${s.kind}@${s.room}`, s.x, s.y, C.USE_RANGE)); if (!M.roomAt(s.x, s.y) || M.roomAt(s.x, s.y).name !== s.room) fail(`station ${s.id} room mismatch ${M.roomAt(s.x, s.y) && M.roomAt(s.x, s.y).name} vs ${s.room}`); });
M.vents.forEach(v => { checkPt(`vent ${v.id}`, v.x, v.y, C.VENT_RANGE); if (!M.canStand(v.x, v.y, R)) fail(`vent ${v.id} not standable on centre`); v.links.forEach(l => { if (!M.vents[l].links.includes(v.id)) fail(`vent link not symmetric ${v.id}->${l}`); }); });
for (const k in M.FIX) M.FIX[k].forEach(f => checkPt(`fix ${k}${f.part}`, f.x, f.y, C.USE_RANGE));
checkPt('button', M.button.x, M.button.y, C.USE_RANGE);
for (let n = 1; n <= 10; n++) for (let s = 0; s < n; s++) {
  const p = M.spawn(s, n);
  if (!M.canStand(p.x, p.y, R) || !reachAt(p.x, p.y)) fail(`spawn ${s}/${n} bad`);
  for (let s2 = 0; s2 < s; s2++) { const q2 = M.spawn(s2, n); if (Math.hypot(q2.x - p.x, q2.y - p.y) < 2 * R) fail(`spawn overlap ${s},${s2} of ${n}`); }
  if (M.roomAt(p.x, p.y)?.id !== spawnRoom) fail('spawn not in the button room ' + spawnRoom);
}
// wall props must be on a front face (wall cell with floor south)
M.props.filter(p => p.wall).forEach(p => {
  const cx = Math.floor((p.x + p.w / 2) / T), cy = Math.floor((p.y + p.h / 2) / T);
  if (M.grid[cy * M.W + cx] !== 2 || M.grid[(cy + 1) * M.W + cx] !== 1) fail(`wall prop ${p.key} not on a front face at ${cx},${cy}`);
});
// props inside floor
M.props.filter(p => !p.wall).forEach(p => {
  for (const [x, y] of [[p.x + 1, p.y + 1], [p.x + p.w - 1, p.y + 1], [p.x + 1, p.y + p.h - 1], [p.x + p.w - 1, p.y + p.h - 1]]) {
    if (M.grid[Math.floor(y / T) * M.W + Math.floor(x / T)] !== 1) { fail(`prop ${p.key} corner off-floor at ${x},${y}`); break; }
  }
});

// tasks
const kinds = ['wires', 'swipe', 'download', 'fuel', 'asteroids', 'align', 'calibrate', 'garbage', 'scan', 'divert', 'leaves', 'numbers'];
M.TASKS.forEach(t => { if (!kinds.includes(t.kind)) fail('bad kind ' + t.kind); if (M.STATIONS[t.station].kind !== t.kind) fail('task/station mismatch'); });
const a1 = M.assignTasks(12345, 3, 5), a2 = M.assignTasks(12345, 3, 5), a3 = M.assignTasks(12345, 4, 5);
if (JSON.stringify(a1) !== JSON.stringify(a2)) fail('assignTasks not deterministic');
if (JSON.stringify(a1) === JSON.stringify(a3)) fail('assignTasks same for different slots');
const big = M.assignTasks(99, 0, M.TASKS.length);
if (new Set(big).size !== M.TASKS.length) fail('duplicates while possible');
if (M.assignTasks(1, 2, 30).length !== 30) fail('n > tasks');

// tunnelling: huge moves must never end inside walls
let tun = 0;
let rs = 7; const rnd = () => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let k = 0; k < 3000; k++) {
  let p = M.spawn(k % 10, 10);
  for (let s = 0; s < 6; s++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 900;
    p = M.moveCircle(p.x, p.y, Math.cos(a) * d, Math.sin(a) * d, R);
    if (!M.canStand(p.x, p.y, R - 0.5) || nearestReach(p.x, p.y) > 12) { tun++; break; }
  }
}
if (tun) fail('tunnelling / stuck results: ' + tun);
// sliding along a wall: push diagonally into the cafeteria top wall (station map only)
if (info.id === 'station') {
  const p0 = { x: 2208, y: 2 * T + R + 1 };
  const p1 = M.moveCircle(p0.x, p0.y, 100, -100, R);
  if (!(p1.x > p0.x + 90)) fail('no slide along wall ' + JSON.stringify(p1));
}
// raycast
if (info.id === 'station') {
  const h = M.raycast(2208, 480, 2208, -100);
  if (!h.hit || Math.abs(h.y - 2 * T) > 0.01) fail('raycast to top wall ' + JSON.stringify(h));
}
// timing
{
  const t0 = performance.now(); let n = 0;
  for (let k = 0; k < 20000; k++) { const p = M.moveCircle(2208 + (k % 300), 300, 4, 3, R); n += p.x; }
  const t1 = performance.now();
  for (let k = 0; k < 20000; k++) M.raycast(2208, 480, 2208 + Math.cos(k) * 300, 480 + Math.sin(k) * 300);
  const t2 = performance.now();
  console.log(`moveCircle ${(1000 * (t1 - t0) / 20000).toFixed(2)}us/call, raycast ${(1000 * (t2 - t1) / 20000).toFixed(2)}us/call`);
}

console.log(`rooms ${M.rooms.length}, stations ${M.STATIONS.length}, tasks ${M.TASKS.length}, vents ${M.vents.length}, props ${M.props.length}, max station stand dist ${maxD.toFixed(1)}`);
console.log(fails > before ? `map ${info.id}: ${fails - before} failures` : `map ${info.id}: OK`);
}
console.log(fails ? `${fails} FAILURES` : 'ALL OK');
process.exit(fails ? 1 : 0);
