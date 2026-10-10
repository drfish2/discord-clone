# Builds the foliage card atlas (RGBA) from ambientCG CC0 leaf / grass scans.
import random, math, sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
A = 'dl/acg/'
random.seed(7)
def load(n):
    c = Image.open(f'{A}{n}/{n}_1K-JPG_Color.jpg').convert('RGB')
    o = Image.open(f'{A}{n}/{n}_1K-JPG_Opacity.jpg').convert('L')
    c.putalpha(o)
    return c
def cells(img, cols, rows):
    w, h = img.size
    out = []
    for j in range(rows):
        for i in range(cols):
            c = img.crop((i * w // cols, j * h // rows, (i + 1) * w // cols, (j + 1) * h // rows))
            bb = c.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
            if bb: out.append(c.crop(bb))
    return out
def tint(im, r, g, b, k=1.0):
    rgb = im.convert('RGB'); a = im.getchannel('A')
    px = Image.new('RGB', im.size, (r, g, b))
    rgb = Image.blend(rgb, Image.composite(px, rgb, Image.new('L', im.size, 255)), 0)  # no-op keep
    R, G, B = rgb.split()
    R = R.point(lambda v: min(255, int(v * r / 128 * k))); G = G.point(lambda v: min(255, int(v * g / 128 * k))); B = B.point(lambda v: min(255, int(v * b / 128 * k)))
    o = Image.merge('RGB', (R, G, B)); o.putalpha(a); return o
S = 1024  # work at 2x, downsample to 512 per cell
def paste_rot(canvas, leaf, x, y, ang, scale, anchor_bottom=True):
    l = leaf.resize((max(1, int(leaf.width * scale)), max(1, int(leaf.height * scale))), Image.LANCZOS)
    # leaf images point up; rotate around their stem (bottom centre)
    pad = Image.new('RGBA', (l.width, l.height * 2), (0, 0, 0, 0)); pad.paste(l, (0, 0))
    r = pad.rotate(-ang, resample=Image.BICUBIC, expand=True)
    canvas.alpha_composite(r, (int(x - r.width / 2), int(y - r.height / 2)))
def shade(im, k):
    a = im.getchannel('A'); o = ImageEnhance.Brightness(im.convert('RGB')).enhance(k); o.putalpha(a); return o

# A: broadleaf cluster
leaves = cells(load('LeafSet024'), 3, 3)
A_ = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(A_)
cx, cy = S / 2, S / 2
twigs = []
for k in range(14):
    a = k / 14 * 2 * math.pi + random.uniform(-0.15, 0.15)
    L = random.uniform(330, 440)
    x1, y1 = cx + math.cos(a) * L, cy + math.sin(a) * L
    d.line([(cx, cy), (x1, y1)], fill=(70, 52, 36, 255), width=7)
    twigs.append((cx, cy, x1, y1))
for n in range(560):
    x0, y0, x1, y1 = random.choice(twigs)
    t = random.uniform(0.15, 1.0) ** 0.7
    x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
    ang = math.degrees(math.atan2(x1 - x0, -(y1 - y0))) + random.uniform(-70, 70)
    lf = shade(random.choice(leaves), random.uniform(0.55, 1.1))
    paste_rot(A_, lf, min(S - 70, max(70, x + random.uniform(-60, 60))), min(S - 70, max(70, y + random.uniform(-60, 60))), ang, random.uniform(0.19, 0.26))
# B: conifer branch (needles drawn procedurally)
B_ = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(B_)
def needles(x0, y0, x1, y1, ln, wd):
    L = math.hypot(x1 - x0, y1 - y0); ux, uy = (x1 - x0) / L, (y1 - y0) / L
    for i in range(int(L / 5)):
        t = i * 5 / L
        px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        taper = 1 - t * 0.55
        for side in (-1, 1):
            a = math.atan2(uy, ux) + side * random.uniform(0.6, 1.0)
            l = ln * taper * random.uniform(0.75, 1.1)
            g = random.randint(55, 95)
            d.line([(px, py), (px + math.cos(a) * l, py + math.sin(a) * l)], fill=(int(g * 0.45), g, int(g * 0.4), 255), width=wd)
    d.line([(x0, y0), (x1, y1)], fill=(80, 56, 38, 255), width=8)
needles(30, S * 0.5, S - 30, S * 0.5, 120, 4)
for k in range(7):
    t = 0.15 + k * 0.11
    x = 30 + (S - 60) * t
    for side in (-1, 1):
        needles(x, S * 0.5, x + 200 * (1 - t * 0.6), S * 0.5 + side * 260 * (1 - t * 0.5), 70, 3)
# C: green grass / reed tuft
blades = cells(load('Foliage001'), 9, 1)
heads = cells(load('Foliage002'), 4, 1)
C_ = Image.new('RGBA', (S, S), (0, 0, 0, 0))
for n in range(26):
    b = random.choice(blades)
    h = random.uniform(0.75, 1.0)
    sc = (S * h) / b.height
    paste_rot(C_, shade(b, random.uniform(0.75, 1.1)), S / 2 + random.uniform(-120, 120), S - (b.height * sc) / 2 * 0 - 0, random.uniform(-22, 22), sc)
for n in range(5):
    b = random.choice(heads); sc = S * random.uniform(0.85, 1.0) / b.height
    paste_rot(C_, b, S / 2 + random.uniform(-150, 150), S, random.uniform(-15, 15), sc)
# D: dry / dune grass tuft
thin = cells(load('Foliage004'), 6, 2) + cells(load('Foliage007'), 3, 3)
D_ = Image.new('RGBA', (S, S), (0, 0, 0, 0))
for n in range(60):
    b = random.choice(thin); sc = S * random.uniform(0.6, 1.0) / b.height
    b = tint(b, 170, 160, 110, random.uniform(0.9, 1.3))
    paste_rot(D_, b, S / 2 + random.uniform(-110, 110), S, random.uniform(-22, 22), sc)
atlas = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
for (img, x, y) in ((A_, 0, 0), (B_, 512, 0), (C_, 0, 512), (D_, 512, 512)):
    atlas.alpha_composite(img.resize((512, 512), Image.LANCZOS), (x, y))
# bleed colour into transparent texels so mip levels don't fringe dark
rgb = atlas.convert('RGB'); a = atlas.getchannel('A')
blur = rgb.filter(ImageFilter.GaussianBlur(6))
filled = Image.composite(rgb, blur, a.point(lambda v: 255 if v > 8 else 0))
filled.putalpha(a)
filled.save('out/foliage_atlas.webp', quality=88, method=6)
filled.save('out/foliage_atlas_preview.png')
bg = Image.new('RGBA', filled.size, (120, 150, 200, 255)); bg.alpha_composite(filled); bg.convert('RGB').save('out/atlas_view.png')
