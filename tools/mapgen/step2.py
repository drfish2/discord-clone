# skeleton -> road graph
import numpy as np, json
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
import os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build') + '/'
sk = np.load(D + 'sk.npy'); road = np.load(D + 'road.npy'); land = np.load(D + 'land.npy')
Hh, Ww = sk.shape
OFF = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
def nbrs(y, x):
    for dy, dx in OFF:
        yy, xx = y+dy, x+dx
        if 0 <= yy < Hh and 0 <= xx < Ww and sk[yy, xx]: yield yy, xx
deg = ndi.convolve(sk.astype(int), np.ones((3,3),int), mode='constant') - 1
deg[~sk] = 0
nodepx = sk & (deg != 2)
lab, nn = ndi.label(nodepx, structure=np.ones((3,3)))
cent = ndi.center_of_mass(nodepx, lab, range(1, nn+1))
nodes = [(c[1] / 2, c[0] / 2) for c in cent]  # x,y in original pixels
edges = []
visited = set()
def nid(y, x): return lab[y, x] - 1
for y, x in zip(*np.nonzero(nodepx)):
    for ny, nx in nbrs(y, x):
        if nodepx[ny, nx]: continue
        if (y, x, ny, nx) in visited: continue
        path = [(x / 2, y / 2), (nx / 2, ny / 2)]
        py, px, cy, cx = y, x, ny, nx
        ok = False
        while True:
            visited.add((py, px, cy, cx))
            nxt = [p for p in nbrs(cy, cx) if p != (py, px)]
            ends = [p for p in nxt if nodepx[p]]
            if ends:
                e = ends[0]; path.append((e[1] / 2, e[0] / 2)); ok = True
                visited.add((e[0], e[1], cy, cx))
                break
            nxt = [p for p in nxt if (cy, cx, p[0], p[1]) not in visited]
            if not nxt: break
            # prefer 4-neighbours to avoid diagonal shortcuts
            nxt.sort(key=lambda p: abs(p[0]-cy) + abs(p[1]-cx))
            py, px, (cy, cx) = cy, cx, nxt[0]
            path.append((cx / 2, cy / 2))
            if len(path) > 5000: break
        if ok:
            a_, b_ = nid(y, x), nid(e[0], e[1])
            edges.append([a_, b_, path])
# dedupe (each edge traced from both ends)
seen = set(); E = []
for a_, b_, p in edges:
    k = (min(a_, b_), max(a_, b_), round(sum(q[0] for q in p) / len(p), 1))
    if k in seen: continue
    seen.add(k); E.append([a_, b_, p])
print('nodes', len(nodes), 'edges', len(E))
json.dump({'nodes': nodes, 'edges': [[int(a_), int(b_), [[float(q[0]), float(q[1])] for q in p]] for a_, b_, p in E]}, open(D + 'graph_raw.json', 'w'))
