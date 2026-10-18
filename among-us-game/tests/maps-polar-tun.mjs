// scratch: locate tunnelling/stuck results for the polar map
import fs from 'node:fs'; import vm from 'node:vm';
const ctx = { window: {}, Math, console }; ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of ['js/config.js', 'js/map.js', 'js/maps/polar.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
const M = ctx.window.IS.map; M.select('polar'); const T = 48, R = 16;
let rs = 7; const rnd = () => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const bad = {};
for (let k = 0; k < 3000; k++) {
  let p = M.spawn(k % 10, 10);
  for (let s = 0; s < 6; s++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 900;
    const q = M.moveCircle(p.x, p.y, Math.cos(a) * d, Math.sin(a) * d, R);
    if (!M.canStand(q.x, q.y, R - 0.5)) { const key = (q.x / T).toFixed(1) + ',' + (q.y / T).toFixed(1); bad[key] = (bad[key] || 0) + 1; break; }
    p = q;
  }
}
console.log(bad);
{
const STEP = 8, GW = Math.ceil(M.W * T / STEP), GH = Math.ceil(M.H * T / STEP);
const ok = new Uint8Array(GW * GH), reach = new Uint8Array(GW * GH);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (M.canStand(i * STEP + 4, j * STEP + 4, R)) ok[j * GW + i] = 1;
const st = M.spawn(0, 10); const q = [Math.floor(st.y / STEP) * GW + Math.floor(st.x / STEP)]; reach[q[0]] = 1;
while (q.length) { const k = q.pop(), i = k % GW, j = (k / GW) | 0; for (const [a, b] of [[1,0],[-1,0],[0,1],[0,-1]]) { const n = (j + b) * GW + i + a; if (ok[n] && !reach[n]) { reach[n] = 1; q.push(n); } } }
const near = (x, y) => { let best = 1e9; for (let j = Math.floor((y - 100) / STEP); j <= Math.floor((y + 100) / STEP); j++) for (let i = Math.floor((x - 100) / STEP); i <= Math.floor((x + 100) / STEP); i++) { if (i < 0 || j < 0 || i >= GW || j >= GH || !reach[j * GW + i]) continue; best = Math.min(best, Math.hypot(i * STEP + 4 - x, j * STEP + 4 - y)); } return best; };
rs = 7; const b2 = {};
for (let k = 0; k < 3000; k++) { let p = M.spawn(k % 10, 10); for (let s = 0; s < 6; s++) { const a = rnd() * Math.PI * 2, d = rnd() * 900; p = M.moveCircle(p.x, p.y, Math.cos(a) * d, Math.sin(a) * d, R); if (near(p.x, p.y) > 12) { const key = (p.x / T).toFixed(2) + ',' + (p.y / T).toFixed(2); b2[key] = (b2[key] || 0) + 1; break; } } }
console.log('unreach', b2);
}
