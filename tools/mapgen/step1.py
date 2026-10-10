import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize, remove_small_objects
import os
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build') + '/'
os.makedirs(D, exist_ok=True)
SC = 2
a = np.asarray(Image.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference-map.png')).convert('RGB').resize((825 * SC, 825 * SC), Image.BICUBIC)).astype(float)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
lum = (r + g + b) / 3
med = ndi.median_filter(lum, size=15)
bmed = ndi.median_filter(b - r, size=15)
line = (lum - med) > 24
water = (bmed > 8.5) & (med < 110)
water = ndi.binary_opening(water, iterations=2)
land = ~water
land = remove_small_objects(land, 24)
water = ~land
# lines on land are roads; lines over water must be long thin (bridges), filtered later by graph
road = line & ndi.binary_dilation(land, iterations=2) | (line & water)
road = remove_small_objects(road, 30)
sk = skeletonize(road)
np.save(D + 'land.npy', land); np.save(D + 'road.npy', road); np.save(D + 'sk.npy', sk)
img = np.zeros(a.shape, np.uint8); img[...] = (40, 40, 40); img[water] = (40, 90, 160); img[road] = (150, 150, 150); img[sk] = (255, 255, 0)
Image.fromarray(img).save(D + 'cls2.png')
print('land', land.mean(), 'road', road.mean(), 'sk px', sk.sum())
