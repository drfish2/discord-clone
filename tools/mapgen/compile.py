# Compile the reference map image into game world data (heights, roads, bridges, buildings, POIs).
# Input: ref.png (user map), land.npy/road.npy (2x masks from step1), graph.json (from step3), runways.
# Output: world.json for the game + preview images.
import numpy as np, json, math, base64, random
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

import os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build') + '/'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'game', 'assets', 'map', 'world.json')
rng = random.Random(7)
np.random.seed(7)

PX = 825                 # reference image size (px)
S = 15.0                 # metres per reference pixel
HALF = PX * S / 2        # world spans -HALF..HALF
N = PX + 1               # height grid nodes per side (15 m spacing)
UP = 2                   # masks are at 2x resolution (7.5 m per cell)

def w2p(x, z):  # world -> reference pixel coords
    return (x + HALF) / S, (z + HALF) / S
def p2w(px, py):
    return px * S - HALF, py * S - HALF

land2 = np.load(D + 'land.npy')            # 1650x1650 bool
road2 = np.load(D + 'road.npy')
G = json.load(open(D + 'graph.json'))

# ---------------------------------------------------------------- road graph in world space
nodes = [p2w(*n) for n in G['nodes']]
edges = []
for e in G['edges']:
    pts = [p2w(*q) for q in e['p']]
    edges.append({'a': e['a'], 'b': e['b'], 'pts': pts, 'lum': e['lum'], 'wpx': e['w'], 'water': e['water']})

def plen(p): return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))

# simplify then resample polylines (RDP + smoothing) so roads curve smoothly
def rdp(p, eps):
    if len(p) < 3: return p
    a, b = np.array(p[0]), np.array(p[-1]); ab = b - a; L = np.linalg.norm(ab)
    best, bi = 0, 0
    for i in range(1, len(p) - 1):
        q = np.array(p[i])
        d = abs(ab[0] * (q - a)[1] - ab[1] * (q - a)[0]) / L if L > 1e-9 else np.linalg.norm(q - a)
        if d > best: best, bi = d, i
    if best > eps: return rdp(p[:bi + 1], eps)[:-1] + rdp(p[bi:], eps)
    return [p[0], p[-1]]
def chaikin(p, it=2):
    for _ in range(it):
        if len(p) < 3: return p
        q = [p[0]]
        for i in range(len(p) - 1):
            a, b = p[i], p[i + 1]
            q.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            q.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        q.append(p[-1]); p = q
    return p
def resample(p, step):
    L = plen(p)
    n = max(1, int(round(L / step)))
    cum = [0]
    for i in range(len(p) - 1): cum.append(cum[-1] + math.dist(p[i], p[i + 1]))
    out = []; k = 0
    for s in range(n + 1):
        t = L * s / n
        while k < len(p) - 2 and cum[k + 1] < t: k += 1
        seg = cum[k + 1] - cum[k]
        f = 0 if seg < 1e-9 else (t - cum[k]) / seg
        out.append((p[k][0] + (p[k + 1][0] - p[k][0]) * f, p[k][1] + (p[k + 1][1] - p[k][1]) * f))
    return out

# ---------------------------------------------------------------- masks in world grid
yy, xx = np.mgrid[0:N, 0:N]
gx = xx * S - HALF; gz = yy * S - HALF     # node world coords
def sample2(mask, x, z):  # nearest sample of a 2x mask at world coords (arrays ok)
    i = np.clip(((x + HALF) / S * UP).astype(int), 0, PX * UP - 1)
    j = np.clip(((z + HALF) / S * UP).astype(int), 0, PX * UP - 1)
    return mask[j, i]
land = sample2(land2, gx, gz)
# distances (m) at 2x then sampled
coast2 = ndi.distance_transform_edt(land2) * (S / UP)
sea2 = ndi.distance_transform_edt(~land2) * (S / UP)
coast = sample2(coast2, gx, gz); sea = sample2(sea2, gx, gz)

# urban density from road skeleton density
sk = ndi.binary_dilation(road2, iterations=1) & land2
dens2 = ndi.gaussian_filter(sk.astype(float), 16)
dens2 /= np.percentile(dens2[land2], 97)
urban2 = np.clip((dens2 - 0.42) / 0.3, 0, 1)
urban = sample2(urban2, gx, gz)

# road distance field (m), from the drawn roads
rd2 = ndi.distance_transform_edt(~road2) * (S / UP)
rdist = sample2(rd2, gx, gz)

# ---------------------------------------------------------------- base heights
def fbm(x, z, oct=5, f=1 / 900, seed=0):
    tot = np.zeros_like(x); amp = 1; norm = 0
    for o in range(oct):
        # value noise via random lattice + bicubic-ish smoothing
        rs = np.random.RandomState(seed + o)
        g = rs.rand(64, 64)
        u = (x * f * (2 ** o)) % 63; v = (z * f * (2 ** o)) % 63
        i = u.astype(int); j = v.astype(int); fu = u - i; fv = v - j
        fu = fu * fu * (3 - 2 * fu); fv = fv * fv * (3 - 2 * fv)
        a = g[j, i]; b = g[j, i + 1]; c = g[j + 1, i]; d = g[j + 1, i + 1]
        tot += amp * (a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv)
        norm += amp; amp *= 0.5
    return tot / norm
n1 = fbm(gx + 20000, gz + 20000, 5, 1 / 1100, 11)
ridge = 1 - np.abs(fbm(gx + 5000, gz - 7000, 5, 1 / 1500, 31) * 2 - 1)
# mountains rise where large areas are free of roads (the map's empty interiors)
far = ndi.gaussian_filter(np.minimum(np.minimum(rdist, 900), coast * 0.8), 8)
massif = np.clip((far - 60) / 260, 0, 1.6)
hill = np.clip((rdist - 25) / 220, 0, 1) * np.clip(coast / 250, 0, 1)
h = 1.8 + np.clip(coast, 0, 500) * 0.03
h += (70 * n1 + 120 * ridge ** 2) * hill * (1 - urban)
h += 430 * massif ** 1.5 * (0.5 + 0.5 * ridge) * np.clip((coast - 60) / 500, 0, 1)
# towns and cities: gentle, flattened ground
hs = ndi.gaussian_filter(h, 6)
h = h * (1 - urban) + np.minimum(hs, 1.8 + np.clip(coast, 0, 300) * 0.02 + 12 * n1) * urban
# sea and lakes
h = np.where(land, np.maximum(h, 1.2), -1.0 - np.minimum(sea * 0.06, 28))
# soften the shoreline
h = np.where(land & (coast < 25), np.minimum(h, 1.2 + coast * 0.08), h)
H = h.astype(np.float32)

def bil(H, x, z):
    fx = (x + HALF) / S; fz = (z + HALF) / S
    i = min(max(int(fx), 0), N - 2); j = min(max(int(fz), 0), N - 2)
    tx = fx - i; tz = fz - j
    return (H[j, i] * (1 - tx) * (1 - tz) + H[j, i + 1] * tx * (1 - tz) + H[j + 1, i] * (1 - tx) * tz + H[j + 1, i + 1] * tx * tz)
def onland(x, z):
    return bool(sample2(land2, np.array([x]), np.array([z]))[0])
def urb(x, z):
    return float(sample2(urban2, np.array([x]), np.array([z]))[0])

# ---------------------------------------------------------------- road classes, dead-end stitching
deg = [0] * len(nodes)
for e in edges: deg[e['a']] += 1; deg[e['b']] += 1
for e in edges:
    L = plen(e['pts']); e['len'] = L
    mid = e['pts'][len(e['pts']) // 2]
    u = urb(*mid)
    over = sum(e['water']) / max(1, len(e['water']))
    if e['lum'] > 152 and L > 150: e['cls'] = 'main'
    elif u < 0.25: e['cls'] = 'rural'
    else: e['cls'] = 'street'
    e['bridge_frac'] = over
W = {'main': 15.0, 'street': 10.5, 'rural': 8.5}

# connect dead ends to a nearby road ahead (map gaps)
from scipy.spatial import cKDTree
allpts = []; owner = []
for k, e in enumerate(edges):
    for q in e['pts']: allpts.append(q); owner.append(k)
tree = cKDTree(np.array(allpts))
added = 0
for n in range(len(nodes)):
    if deg[n] != 1: continue
    e = next(e for e in edges if e['a'] == n or e['b'] == n)
    p = e['pts'] if e['a'] == n else e['pts'][::-1]
    if len(p) < 2: continue
    q0, q1 = np.array(p[0]), np.array(p[min(3, len(p) - 1)])
    d = q0 - q1; d /= (np.linalg.norm(d) + 1e-9)
    best = None
    for idx in tree.query_ball_point(q0, 60):
        if owner[idx] == edges.index(e): continue
        v = np.array(allpts[idx]) - q0; L = np.linalg.norm(v)
        if L < 4: continue
        if np.dot(v / L, d) < 0.8: continue
        if best is None or L < best[0]: best = (L, idx)
    if best:
        tgt = allpts[best[1]]
        # snap to nearest existing node if close, else to the closest node of that edge
        oe = edges[owner[best[1]]]
        cand = [(math.dist(nodes[oe['a']], tgt), oe['a']), (math.dist(nodes[oe['b']], tgt), oe['b'])]
        dn, nn = min(cand)
        if dn < 45 and nn != n:
            edges.append({'a': n, 'b': nn, 'pts': [nodes[n], nodes[nn]], 'cls': e['cls'], 'water': [0, 0], 'lum': e['lum'], 'len': math.dist(nodes[n], nodes[nn]), 'bridge_frac': 0})
            deg[n] += 1; deg[nn] += 1; added += 1
print('stitched dead ends', added)

# smooth geometry
for e in edges:
    p = e['pts']
    p = rdp(p, 4.0 if e['cls'] != 'rural' else 3.0)
    p = chaikin(p, 2)
    p = [nodes[e['a']]] + p[1:-1] + [nodes[e['b']]]
    e['pts'] = resample(p, 12.0 if e['cls'] != 'main' else 15.0)
    e['len'] = plen(e['pts'])

# ---------------------------------------------------------------- road height profiles, bridges, terrain carving
node_h = {}
for n, (x, z) in enumerate(nodes):
    node_h[n] = max(bil(H, x, z), 2.0)
for e in edges:
    pts = e['pts']
    wat = [not onland(x, z) for x, z in pts]
    e['wat'] = wat
    hs = [max(bil(H, x, z), 2.0) for x, z in pts]
    # over water: deck height ramps up to clearance
    span = sum(wat)
    if span:
        idx = [i for i, w in enumerate(wat) if w]
        i0, i1 = idx[0], idx[-1]
        L = (i1 - i0 + 1) * (e['len'] / max(1, len(pts) - 1))
        deck = 8 + min(L * 0.025, 22)
        for i in range(len(hs)):
            # distance (in samples) to the water span
            dd = 0 if i0 <= i <= i1 else (i0 - i if i < i0 else i - i1)
            ramp = max(0.0, 1 - dd * 12 / 120)  # 120 m ramps
            hs[i] = max(hs[i], hs[i] * (1 - ramp) + deck * ramp) if not (i0 <= i <= i1) else deck
    hs[0] = node_h[e['a']]; hs[-1] = node_h[e['b']]
    # smooth + grade limit (8%)
    step = e['len'] / max(1, len(pts) - 1)
    for it in range(30):
        o = hs[:]
        for i in range(1, len(hs) - 1):
            hs[i] = (o[i - 1] + 2 * o[i] + o[i + 1]) / 4 if not (span and wat[i]) else o[i]
        g = 0.08 * step if e['cls'] != 'rural' else 0.11 * step
        for i in range(1, len(hs)):
            hs[i] = min(max(hs[i], hs[i - 1] - g), hs[i - 1] + g)
        for i in range(len(hs) - 2, -1, -1):
            hs[i] = min(max(hs[i], hs[i + 1] - g), hs[i + 1] + g)
        hs[0] = node_h[e['a']]; hs[-1] = node_h[e['b']]
    e['h'] = hs
    e['w'] = W[e['cls']]

# carve terrain to roads: rasterize road samples
carve_h = np.full(H.shape, np.nan, np.float32); carve_w = np.zeros(H.shape, np.float32)
for e in edges:
    pts, hs, w = e['pts'], e['h'], e['w']
    for i in range(len(pts) - 1):
        (x0, z0), (x1, z1) = pts[i], pts[i + 1]
        n = max(1, int(math.dist(pts[i], pts[i + 1]) / 5))
        for k in range(n + 1):
            t = k / n
            x = x0 + (x1 - x0) * t; z = z0 + (z1 - z0) * t; hh = hs[i] + (hs[i + 1] - hs[i]) * t
            if e['wat'][i] and e['wat'][i + 1]: continue  # bridge deck: leave water alone
            if hh - bil(H, x, z) > 9: continue  # high bridge approach: keep ground
            fx, fz = (x + HALF) / S, (z + HALF) / S
            R = int(math.ceil((w / 2 + 45) / S))
            i0, j0 = int(fx), int(fz)
            for j in range(j0 - R, j0 + R + 2):
                for ii in range(i0 - R, i0 + R + 2):
                    if not (0 <= ii < N and 0 <= j < N): continue
                    d = math.hypot(ii - fx, j - fz) * S
                    inner = w / 2 + 3.5
                    if d < inner:
                        wgt = 1.0
                    else:
                        blend = min(60, 18 + abs(H[j, ii] - hh) * 1.2)
                        if d > inner + blend: continue
                        tt = (d - inner) / blend; wgt = 1 - tt * tt * (3 - 2 * tt)
                    if wgt > carve_w[j, ii]:
                        carve_w[j, ii] = wgt; carve_h[j, ii] = hh - 0.3
m = carve_w > 0
H = np.where(m, H * (1 - carve_w) + np.nan_to_num(carve_h) * carve_w, H).astype(np.float32)

# ---------------------------------------------------------------- airports
RUNWAYS = [
    # name, list of runways (px endpoints)
    ('Crimson Intl. Airport', 'east', [((476, 483), (527, 482)), ((472, 504), (519, 502))]),
    ('Northpoint Airfield', 'north', [((491.4, 74), (490.6, 108))]),
    ('Westmoor Airstrip', 'west', [((190, 498.3), (225, 494.3))]),
    ('Kingsbay Airport', 'nw', [((149.5, 128.5), (147.0, 155.5)), ((157.0, 128.0), (155.0, 155.0))]),
    ('Ember Valley Strip', 'mid', [((355, 424.2), (407, 423.2))]),
]
airports = []
for name, key, rws in RUNWAYS:
    R2 = []
    for (a, b) in rws:
        ax, az = p2w(*a); bx, bz = p2w(*b)
        L = math.dist((ax, az), (bx, bz))
        # make runways at least 900 m long so planes can take off
        ext = max(0, (900 - L) / 2)
        dx, dz = (bx - ax) / L, (bz - az) / L
        ax -= dx * ext; az -= dz * ext; bx += dx * ext; bz += dz * ext
        R2.append({'x0': ax, 'z0': az, 'x1': bx, 'z1': bz, 'w': 45})
    xs = [r[k] for r in R2 for k in ('x0', 'x1')]; zs = [r[k] for r in R2 for k in ('z0', 'z1')]
    cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
    # flatten: the airfield sits at the mean ground height of the runway area
    hh = []
    for r in R2:
        for t in np.linspace(0, 1, 20): hh.append(bil(H, r['x0'] + (r['x1'] - r['x0']) * t, r['z0'] + (r['z1'] - r['z0']) * t))
    elev = max(2.5, float(np.median(hh)))
    ap = {'name': name, 'key': key, 'x': cx, 'z': cz, 'h': elev, 'runways': R2}
    airports.append(ap)
    # flatten terrain in a rounded rectangle around each runway
    for r in R2:
        L = math.dist((r['x0'], r['z0']), (r['x1'], r['z1'])); dx, dz = (r['x1'] - r['x0']) / L, (r['z1'] - r['z0']) / L
        lat = gz * 0  # placeholders
        px_, pz_ = gx - r['x0'], gz - r['z0']
        along = px_ * dx + pz_ * dz; side = -px_ * dz + pz_ * dx
        da = np.maximum(np.maximum(-along, along - L), 0); ds = np.maximum(np.abs(side) - 120, 0)
        dd = np.hypot(da, ds)
        wgt = np.clip(1 - (dd - 30) / 160, 0, 1)
        wgt = wgt * wgt * (3 - 2 * wgt)
        wgt = np.where(H > 0, wgt, wgt * 0)  # never fill the sea
        H = (H * (1 - wgt) + elev * wgt).astype(np.float32)
print('H pct', np.percentile(H[H > 0], [50, 90, 99, 100]))
print('airports', [(a['name'], round(a['h'], 1)) for a in airports])

# ---------------------------------------------------------------- road raster (2.5 m) for building placement
RES = 2.5
RN = int(PX * S / RES)
roadimg = Image.new('L', (RN, RN), 0); dr = ImageDraw.Draw(roadimg)
def tor(x, z): return ((x + HALF) / RES, (z + HALF) / RES)
for e in edges:
    dr.line([tor(*q) for q in e['pts']], fill=255, width=max(1, int(round((e['w'] + 7) / RES))))
for ap in airports:
    for r in ap['runways']:
        dr.line([tor(r['x0'], r['z0']), tor(r['x1'], r['z1'])], fill=255, width=int(160 / RES))
roadR = np.asarray(roadimg) > 0
occ = roadR.copy()
landR = np.asarray(Image.fromarray(land2.astype(np.uint8) * 255).resize((RN, RN), Image.NEAREST)) > 0
urbR = np.asarray(Image.fromarray((urban2 * 255).astype(np.uint8)).resize((RN, RN), Image.BILINEAR)) / 255.0

# downtown centres (densest urban spots) get towers
dpk = ndi.maximum_filter(dens2, size=120) == dens2
cands = [(dens2[j, i], i, j) for j, i in zip(*np.nonzero(dpk & (dens2 > 0.75) & land2))]
cands.sort(reverse=True)
# downtown cores: the big grid districts of the map (reference pixels)
centres = [p2w(*q) for q in [(290, 235), (600, 430), (215, 625), (690, 560), (165, 185)]]
CORE_R = [1000, 650, 600, 550, 500]
print('downtowns', [(round(x), round(z)) for x, z in centres])

buildings = []
def try_building(cx, cz, ux, uz, hx, hz, h, style):
    # ux,uz: building "forward" (towards the street) unit vector
    ca = abs(ux) * hz + abs(uz) * hx; cb = abs(uz) * hz + abs(ux) * hx
    # rotated footprint cells
    ex = abs(uz) * hx + abs(ux) * hz; ez = abs(ux) * hx + abs(uz) * hz
    i0, i1 = int((cx - ex + HALF) / RES), int((cx + ex + HALF) / RES) + 1
    j0, j1 = int((cz - ez + HALF) / RES), int((cz + ez + HALF) / RES) + 1
    if i0 < 0 or j0 < 0 or i1 >= RN or j1 >= RN: return False
    ys, xs = np.mgrid[j0:j1, i0:i1]
    wx = xs * RES - HALF + RES / 2 - cx; wz = ys * RES - HALF + RES / 2 - cz
    lf = wx * ux + wz * uz; ls = -wx * uz + wz * ux
    inside = (np.abs(lf) <= hz + 1.0) & (np.abs(ls) <= hx + 1.0)
    if not inside.any(): return False
    if (occ[j0:j1, i0:i1] & inside).any(): return False
    if not (landR[j0:j1, i0:i1] | ~inside).all(): return False
    g = [bil(H, cx + ox, cz + oz) for ox, oz in ((ex, ez), (-ex, ez), (ex, -ez), (-ex, -ez))]
    if min(g) < 1.0 or max(g) - min(g) > 5: return False
    occ[j0:j1, i0:i1] |= inside
    rot = math.atan2(ux, uz)
    buildings.append([round(cx, 1), round(cz, 1), round(hx, 1), round(hz, 1), round(rot, 3), round(h, 1), style])
    return True

for e in sorted(edges, key=lambda e: -e['w']):
    pts = e['pts']
    if e['cls'] == 'rural' and rng.random() < 0.85: continue
    cum = [0]
    for i in range(len(pts) - 1): cum.append(cum[-1] + math.dist(pts[i], pts[i + 1]))
    L = cum[-1]
    for side in (-1, 1):
        s = rng.uniform(4, 12)
        while s < L - 6:
            k = max(0, min(len(pts) - 2, next((i for i in range(len(cum) - 1) if cum[i + 1] >= s), len(pts) - 2)))
            seg = cum[k + 1] - cum[k]; f = (s - cum[k]) / seg if seg > 1e-6 else 0
            px = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f; pz = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f
            tx = (pts[k + 1][0] - pts[k][0]) / max(seg, 1e-6); tz = (pts[k + 1][1] - pts[k][1]) / max(seg, 1e-6)
            nx, nz = -tz * side, tx * side   # normal pointing away from the road on this side
            u = urb(px, pz)
            down = max([max(0.0, 1 - math.dist((px, pz), c) / r) for c, r in zip(centres, CORE_R)])
            if e['cls'] == 'rural':
                kind = 'house'; w = rng.uniform(9, 14); d = rng.uniform(8, 13); h = rng.uniform(4.5, 7)
                style = 2
            elif down > 0.25 and rng.random() < 0.85:
                w = rng.uniform(22, 38); d = rng.uniform(22, 36)
                h = 30 + rng.random() * rng.random() * 230 * down + rng.random() * 20; style = 0
            elif u > 0.55 or down > 0.05:
                w = rng.uniform(14, 26); d = rng.uniform(14, 26); h = rng.uniform(10, 30); style = 1
            else:
                w = rng.uniform(10, 16); d = rng.uniform(9, 15); h = rng.uniform(5, 9); style = 2
            setback = e['w'] / 2 + 3.5 + (rng.uniform(1, 5) if style == 2 else 0.6)
            cx, cz = px + nx * (setback + d / 2), pz + nz * (setback + d / 2)
            ok = try_building(cx, cz, -nx, -nz, w / 2, d / 2, h, style)
            if not ok and style != 2:
                # smaller fallback
                w2, d2 = w * 0.6, d * 0.6
                cx, cz = px + nx * (setback + d2 / 2), pz + nz * (setback + d2 / 2)
                ok = try_building(cx, cz, -nx, -nz, w2 / 2, d2 / 2, min(h, 14), 1 if style == 0 else style)
                if ok: w = w2
            s += (w if ok else 6) + rng.uniform(1.5, 4) if style != 2 else (w if ok else 6) + rng.uniform(5, 12)
print('buildings', len(buildings), 'by style', [sum(1 for b in buildings if b[6] == k) for k in range(3)])

# ---------------------------------------------------------------- biome grid (30 m): 0 grass,1 forest,2 desert,3 rock/alpine,4 wetland,5 beach,6 urban
BN = PX // 2 + 1
bx = np.linspace(-HALF, HALF, BN); bzz = np.linspace(-HALF, HALF, BN)
BX, BZ = np.meshgrid(bx, bzz)
Hb = np.array([[bil(H, x, z) for x in bx] for z in bzz])
landb = sample2(land2, BX, BZ); urbb = sample2(urban2, BX, BZ); coastb = sample2(coast2, BX, BZ)
nb = fbm(BX + 3000, BZ - 9000, 4, 1 / 700, 77)
bio = np.zeros((BN, BN), np.uint8)
bio[(nb > 0.47)] = 1
# desert: west-central basin around Westmoor
pxb, pyb = (BX + HALF) / S, (BZ + HALF) / S
des = ((pxb - 245) / 75) ** 2 + ((pyb - 520) / 55) ** 2 < 1
bio[des] = 2
# wetland: southern ponds
wet = ((pxb - 300) / 55) ** 2 + ((pyb - 690) / 40) ** 2 < 1
bio[wet] = 4
bio[Hb > 230] = 3
bio[landb & (coastb < 40) & (Hb < 6)] = 5
bio[urbb > 0.45] = 6
bio[~landb] = 0

# ---------------------------------------------------------------- places, specials, gangs
def nearest_node(x, z, cls=None):
    best = None
    for k, (nx_, nz_) in enumerate(nodes):
        d = math.dist((x, z), (nx_, nz_))
        if best is None or d < best[0]: best = (d, k)
    return best[1]
districts = [
    {'name': 'Downtown', 'px': (230, 300)}, {'name': 'Kingsbay', 'px': (160, 190)}, {'name': 'Old Harbour', 'px': (110, 260)},
    {'name': 'Northside', 'px': (380, 120)}, {'name': 'Port Vale', 'px': (690, 520)}, {'name': 'Eastgate', 'px': (640, 360)},
    {'name': 'Southport', 'px': (230, 640)}, {'name': 'Coral Bay', 'px': (460, 610)}, {'name': 'Lakeside', 'px': (420, 360)},
    {'name': 'Westwood', 'px': (130, 410)}, {'name': 'The Spit', 'px': (480, 715)}, {'name': 'North Isle', 'px': (520, 100)},
]
for d in districts: d['x'], d['z'] = p2w(*d['px']); del d['px']
regions = [
    {'name': 'Mt. Ember', 'px': (580, 260), 'r': 120}, {'name': 'Pinewood Hills', 'px': (360, 520), 'r': 110},
    {'name': 'Red Dust Flats', 'px': (245, 520), 'r': 70}, {'name': 'Mirror Lake', 'px': (470, 350), 'r': 70},
    {'name': 'Saltmarsh', 'px': (300, 690), 'r': 50},
]
for d in regions: d['x'], d['z'] = p2w(*d['px']); d['r'] *= S; del d['px']
gangs = [
    {'id': 'kingz', 'name': 'Purple Kingz', 'color': 0x7b3fc4, 'css': '#9b5de5', 'px': (140, 230), 'r': 30},
    {'id': 'vipers', 'name': 'Red Vipers', 'color': 0xc62828, 'css': '#e53935', 'px': (680, 600), 'r': 30},
]
for g in gangs: g['x'], g['z'] = p2w(*g['px']); g['r'] *= S; del g['px']

def lot_near(px_, py_, need=40):
    # free spot next to a street near a reference-pixel location
    x, z = p2w(px_, py_)
    best = None
    for e in edges:
        if e['cls'] == 'rural' or any(e['wat']): continue
        for i, q in enumerate(e['pts']):
            d = math.dist(q, (x, z))
            if d < 400 and (best is None or d < best[0]): best = (d, e, i)
    d, e, i = best
    p, q = e['pts'][i], e['pts'][min(i + 1, len(e['pts']) - 1)]
    if p == q: q = e['pts'][i - 1]; p, q = q, p
    L = math.dist(p, q); tx, tz = (q[0] - p[0]) / L, (q[1] - p[1]) / L
    return {'x': p[0], 'z': p[1], 'tx': tx, 'tz': tz, 'w': e['w'], 'h': e['h'][i]}
specials = {'police': lot_near(250, 290), 'hospital': lot_near(215, 330), 'spray': lot_near(285, 260), 'start': lot_near(238, 312)}

# ---------------------------------------------------------------- export
def b64(a): return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
Hq = np.clip(np.round((H + 50) * 20), 0, 65535).astype(np.uint16)  # 5 cm steps, -50 m offset
roads = []
for e in edges:
    flat = []
    for (x, z), hh in zip(e['pts'], e['h']): flat += [round(x, 1), round(z, 1), round(hh, 2)]
    roads.append({'a': e['a'], 'b': e['b'], 'c': e['cls'], 'w': e['w'], 'p': flat, 'br': [1 if w else 0 for w in e['wat']]})
world = {
    'v': 1, 'S': S, 'HALF': HALF, 'N': N,
    'heights': b64(Hq), 'biomeN': BN, 'biome': b64(bio),
    'urbanN': BN, 'urban': b64((np.clip(urbb, 0, 1) * 255).astype(np.uint8)),
    'nodes': [[round(x, 1), round(z, 1), round(node_h[k], 2)] for k, (x, z) in enumerate(nodes)],
    'roads': roads,
    'buildings': buildings,
    'airports': airports, 'districts': districts, 'regions': regions, 'gangs': gangs, 'specials': specials, 'downtowns': centres,
}
json.dump(world, open(OUT, 'w'), separators=(',', ':'), default=lambda o: round(float(o), 2))
import os
print('world.json', os.path.getsize(OUT) // 1024, 'KB', 'roads', len(roads), 'nodes', len(nodes))

# ---------------------------------------------------------------- previews
pv = np.zeros((N, N, 3), np.uint8)
hv = np.clip(H / 400, 0, 1)
pv[...] = np.stack([60 + 150 * hv, 110 + 120 * hv, 60 + 120 * hv], -1).astype(np.uint8)
pv[H < 0] = (30, 70, 120)
img = Image.fromarray(pv).resize((1650, 1650))
dr = ImageDraw.Draw(img)
def tp(x, z): return ((x + HALF) / S * 2, (z + HALF) / S * 2)
for b in buildings:
    cx, cz, hx, hz, rot = b[:5]
    c, s_ = math.cos(rot), math.sin(rot)
    poly = []
    for ox, oz in ((-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)):
        poly.append(tp(cx + ox * c + oz * s_, cz - ox * s_ + oz * c))
    dr.polygon(poly, fill=((230, 120, 120) if b[6] == 0 else (220, 200, 160) if b[6] == 1 else (200, 200, 200)))
for e in edges:
    col = (255, 210, 60) if e['cls'] == 'main' else (240, 240, 240) if e['cls'] == 'street' else (200, 180, 140)
    dr.line([tp(*q) for q in e['pts']], fill=col, width=2 if e['cls'] == 'main' else 1)
    for i in range(len(e['pts']) - 1):
        if e['wat'][i] and e['wat'][i + 1]: dr.line([tp(*e['pts'][i]), tp(*e['pts'][i + 1])], fill=(0, 255, 255), width=3)
for ap in airports:
    for r in ap['runways']: dr.line([tp(r['x0'], r['z0']), tp(r['x1'], r['z1'])], fill=(40, 40, 40), width=6)
for k, v in specials.items(): dr.ellipse([tp(v['x'], v['z'])[0] - 6, tp(v['x'], v['z'])[1] - 6, tp(v['x'], v['z'])[0] + 6, tp(v['x'], v['z'])[1] + 6], fill=(255, 0, 255))
img.save(D + 'world_preview.png')
img.crop((300, 400, 900, 1000)).save(D + 'world_crop.png')
