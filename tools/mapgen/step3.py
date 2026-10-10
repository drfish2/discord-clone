# clean the raw graph: cluster junctions, prune spurs, merge degree-2 chains, measure width/brightness, flag bridges
import numpy as np, json, math
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
import os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build') + '/'
G = json.load(open(D + 'graph_raw.json'))
land = np.load(D + 'land.npy'); road = np.load(D + 'road.npy')
a = np.asarray(Image.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference-map.png')).convert('RGB').resize((1650, 1650), Image.BICUBIC)).astype(float); lum = a.mean(axis=2)
dist = ndi.distance_transform_edt(road)
nodes = [list(p) for p in G['nodes']]
edges = [[e[0], e[1], e[2]] for e in G['edges'] if e[0] != e[1] or len(e[2]) > 12]
def plen(p): return sum(math.dist(p[i], p[i+1]) for i in range(len(p)-1))

# 1. cluster nodes closer than 3 px (union-find)
par = list(range(len(nodes)))
def f(i):
    while par[i] != i: par[i] = par[par[i]]; i = par[i]
    return i
for a_, b_, p in edges:
    if a_ != b_ and plen(p) < 3.2: par[f(a_)] = f(b_)
groups = {}
for i in range(len(nodes)): groups.setdefault(f(i), []).append(i)
newid = {}; N2 = []
for root, mem in groups.items():
    for m in mem: newid[m] = len(N2)
    N2.append([sum(nodes[m][0] for m in mem) / len(mem), sum(nodes[m][1] for m in mem) / len(mem)])
E2 = []
for a_, b_, p in edges:
    A, B = newid[a_], newid[b_]
    if A == B and plen(p) < 12: continue
    p = [N2[A]] + p[1:-1] + [N2[B]]
    E2.append([A, B, p])
nodes, edges = N2, E2

def degrees():
    d = [0] * len(nodes)
    for a_, b_, p in edges: d[a_] += 1; d[b_] += 1
    return d
# 2. prune short spurs
for it in range(4):
    d = degrees()
    edges = [e for e in edges if not ((d[e[0]] == 1 or d[e[1]] == 1) and plen(e[2]) < 7)]
# 3. merge degree-2 chains
def merge():
    global edges
    changed = True
    while changed:
        changed = False
        d = degrees(); inc = {}
        for k, e in enumerate(edges):
            inc.setdefault(e[0], []).append(k); inc.setdefault(e[1], []).append(k)
        dead = set()
        for n, ks in inc.items():
            if d[n] != 2 or len(ks) != 2: continue
            k1, k2 = ks
            if k1 in dead or k2 in dead or k1 == k2: continue
            e1, e2 = edges[k1], edges[k2]
            p1 = e1[2] if e1[1] == n else e1[2][::-1]
            a1 = e1[0] if e1[1] == n else e1[1]
            p2 = e2[2] if e2[0] == n else e2[2][::-1]
            b2 = e2[1] if e2[0] == n else e2[0]
            if a1 == n or b2 == n: continue
            edges[k1] = [a1, b2, p1 + p2[1:]]
            dead.add(k2); changed = True
        edges = [e for k, e in enumerate(edges) if k not in dead]
merge()
# remove tiny components
adj = {}
for e in edges: adj.setdefault(e[0], set()).add(e[1]); adj.setdefault(e[1], set()).add(e[0])
comp = {}; cid = 0
for s in adj:
    if s in comp: continue
    st = [s]; comp[s] = cid
    while st:
        u = st.pop()
        for v in adj[u]:
            if v not in comp: comp[v] = cid; st.append(v)
    cid += 1
size = {}
for e in edges: size[comp[e[0]]] = size.get(comp[e[0]], 0) + plen(e[2])
edges = [e for e in edges if size[comp[e[0]]] > 25]
# 4. measure each edge
out = []
for a_, b_, p in edges:
    xs = np.clip(np.round([q[0] * 2 for q in p]).astype(int), 0, 1649); ys = np.clip(np.round([q[1] * 2 for q in p]).astype(int), 0, 1649)
    w = float(np.mean(dist[ys, xs])) / 2; L = float(np.mean(lum[ys, xs]))
    wat = [0 if land[y, x] else 1 for x, y in zip(xs, ys)]
    out.append({'a': a_, 'b': b_, 'p': p, 'w': w, 'lum': L, 'water': wat, 'len': plen(p)})
used = sorted({e['a'] for e in out} | {e['b'] for e in out})
remap = {o: i for i, o in enumerate(used)}
for e in out: e['a'] = remap[e['a']]; e['b'] = remap[e['b']]
nodes = [nodes[o] for o in used]
print('nodes', len(nodes), 'edges', len(out), 'total km', sum(e['len'] for e in out) * 10 / 1000)
ws = np.array([e['w'] for e in out]); ls = np.array([e['lum'] for e in out])
print('w pct', np.percentile(ws, [10, 50, 90, 98]), 'lum pct', np.percentile(ls, [10, 50, 90, 98]))
json.dump({'nodes': nodes, 'edges': out}, open(D + 'graph.json', 'w'))
# preview
img = Image.new('RGB', (825 * 2, 825 * 2), (30, 30, 30)); dr = ImageDraw.Draw(img)
lm = Image.fromarray((land * 60).astype(np.uint8)); img.paste(Image.merge('RGB', (lm, lm, lm)))
for e in out:
    col = (255, 220, 0) if e['lum'] > 150 else (200, 200, 200)
    if max(e['water']): col = (0, 200, 255)
    dr.line([(q[0] * 2, q[1] * 2) for q in e['p']], fill=col, width=2 if e['lum'] > 150 else 1)
for n in nodes: dr.point((n[0] * 2, n[1] * 2), fill=(255, 0, 0))
img.save(D + 'graph.png')
