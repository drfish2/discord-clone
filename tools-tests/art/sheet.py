# sheet.py: side-by-side contact sheets of before/after screenshots.
# usage: python sheet.py <tagA> <tagB> <suffix> <out-prefix>   (suffix: day | night | air)
import sys, os, glob
from PIL import Image, ImageDraw
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
a, b, suf, out = sys.argv[1:5]
names = sorted(os.path.basename(p)[len(a) + 1:] for p in glob.glob(os.path.join(d, f'{a}_*{suf}*.png')))
names = [n for n in names if os.path.exists(os.path.join(d, f'{b}_{n}'))]
per = 4
for k in range(0, len(names), per):
    chunk = names[k:k + per]
    W, H = 640, 400
    sheet = Image.new('RGB', (W * 2 // 2, H * len(chunk) // 2), 'black')
    sheet = Image.new('RGB', (W, H * len(chunk) // 2))
    dr = ImageDraw.Draw(sheet)
    for i, n in enumerate(chunk):
        for j, t in enumerate((a, b)):
            im = Image.open(os.path.join(d, f'{t}_{n}')).convert('RGB').resize((W // 2, H // 2))
            sheet.paste(im, (j * W // 2, i * H // 2))
        dr.text((4, i * H // 2 + 2), n, fill=(255, 255, 0))
    sheet.save(os.path.join(d, f'{out}_{k // per}.png'))
    print('sheet', f'{out}_{k // per}.png', chunk)
