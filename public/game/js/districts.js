// District identities: what each neighbourhood is built from. Pure data, read by terrain.js
// (building generation, lamps, fences, street trees, props), world.js (paving, roads, lamps,
// night light) and ground.js (ground tint). See tools-tests/art/ART_BIBLE.md.
//
// Facade types match terrain.js FAC (the world.js shader draws them):
//   0 brick, 1 plaster, 2 office, 3 glass, 4 house, 5 hospital, 6 shed, 7 civic, 8 plain,
//   9 deco, 10 adobe, 11 industrial brick, 12 clapboard, 13 chalet, 14 villa,
//   15 tenement (brick), 16 mission, 17 tenement (stucco)
// Ground floors match GF: 0 home, 1 shop, 2 lobby, 3 garage.

const BRICK_RED = [0xa4553c, 0x8e4a35, 0xb06a4c, 0x7d4434, 0x9b5b45, 0xb5876a];
const STONE = [0xcfc8bb, 0xb8b2a6, 0xd9d2c3, 0x9ea4a8, 0xc2b59b, 0x8c8f93];
const GLASS_T = [0x8fa3b8, 0x6f8499, 0x5d7085, 0x7b8fa6, 0x9fb6c9, 0x4f6478, 0x3c5a6e, 0xa9b5bf];
const TERRACOTTA = [0xb5562f, 0xa84c2a, 0xc0663a, 0x9e4a2c, 0xb86040];
const SLATE = [0x3d4652, 0x4a4e54, 0x353b42, 0x50555c];

// fac: [[type, weight], ...]; pal: palette per facade type (or one list for all)
// blk.h: target height range (m) for town blocks; roof: pitched roofs on blocks/houses
//   {type: 'hip'|'gable', pal, pitch, p (probability)}
// lamp: 'kk' (KayKit cobra head), 'iron' (lantern post), 'wood' (timber pole), light: night colour
// pave: pavement material key in world.js; road: asphalt tint; tint: ground colour multiplier
export const STYLES = [
  {
    key: 'downtown', ground: 'paved', name: 'Downtown',
    tower: { fac: [[3, 0.6], [2, 0.4]], pal: { 3: GLASS_T, 2: STONE }, hMul: 1.7 },
    blk: { fac: [[2, 0.45], [3, 0.35], [1, 0.2]], pal: { 2: STONE, 3: GLASS_T, 1: STONE }, h: [14, 34], shop: 0.55, lobby: 0.4, units: 1, clutter: 'plant' },
    house: { fac: [[1, 1]], pal: STONE, floors: [3, 3] },
    fence: ['hedge', 'brick'], lamp: 'kk', light: 0xdfe9ff, tree: 'round', pave: 'granite', road: 0x6a6a6e, tint: [0.92, 0.93, 0.95],
    awn: [0x1f3f66, 0x3c3c3c, 0x2c2c34], billboards: 1,
  },
  {
    key: 'brownstone', ground: 'paved', name: 'Kingsbay',
    tower: { fac: [[2, 1]], pal: { 2: [0xb8a48a, 0xa89478, 0xc9b79c, 0x9a8a78] }, hMul: 1.2 },
    blk: { fac: [[0, 0.62], [1, 0.38]], pal: { 0: [0x8e3b2a, 0x7d3a2c, 0x9b4a35, 0x6e3b2e, 0xa85a40, 0x5e3a30], 1: [0x6e4a3a, 0x7a5442, 0x5f4033, 0x8a6a55] }, h: [10, 21], shop: 0.85, clutter: 'tanks' },
    house: { fac: [[0, 1]], pal: [0x8e3b2a, 0x7d3a2c, 0x9b4a35], floors: [3, 3] },
    fence: ['brick', 'privacy'], lamp: 'iron', light: 0xffd79a, tree: 'round', pave: 'brick', road: 0x7c7c80, tint: [0.95, 0.92, 0.9],
    awn: [0x1e3b2a, 0x2a2a2a, 0x5a1e1e, 0x1f3f66],
  },
  {
    key: 'harbour', ground: 'paved', name: 'Old Harbour',
    tower: { fac: [[11, 1]], pal: { 11: BRICK_RED }, hMul: 0.8 },
    blk: { fac: [[11, 0.7], [6, 0.3]], pal: { 11: BRICK_RED, 6: [0x5b6b73, 0x6d7f6a, 0x8a5a3c, 0x46606e] }, h: [8, 17], shop: 0.2, garage: 0.6, units: 1 },
    house: { fac: [[11, 1]], pal: BRICK_RED, floors: [2, 3] },
    fence: ['chain', 'brick'], lamp: 'kk', light: 0xffa04a, tree: 'none', pave: 'dark', road: 0x6c6a68, tint: [0.88, 0.86, 0.84],
    awn: [0x3c3c3c, 0x5a3a2a], dumpsters: 0.35,
  },
  {
    key: 'kingz', ground: 'paved', name: 'Kingz Turf',
    tower: { fac: [[15, 1]], pal: { 15: [0x6e6a66, 0x7d4434] }, hMul: 0.9 },
    blk: { fac: [[15, 1]], pal: { 15: [0x7d4434, 0x6b3d33, 0x8a6a5a, 0x6a6662, 0x77706a, 0x5e4a44] }, h: [12, 21], shop: 0.6 },
    house: { fac: [[15, 1]], pal: [0x7d4434, 0x6a6662], floors: [2, 3] },
    fence: ['chain'], lamp: 'kk', light: 0xff9a40, tree: 'none', pave: 'dark', road: 0x66666a, tint: [0.84, 0.83, 0.82],
    awn: [0x6a2a9a, 0x4a1d70, 0x7b3fb8], dumpsters: 0.5, lampSkip: 0.4,
  },
  {
    key: 'suburb', ground: 'lawn', name: 'Northside',
    tower: { fac: [[2, 1]], pal: { 2: STONE }, hMul: 0.6 },
    blk: { fac: [[1, 0.6], [12, 0.4]], pal: { 1: [0xece6d6, 0xdcd3c0, 0xe8c872, 0xd8cfa8], 12: [0xf4f1e8, 0xf1e3b3, 0xc9dbe6, 0xbfd1b8] }, h: [6.5, 9], shop: 0.7, roof: { type: 'gable', pal: SLATE, pitch: 0.45, p: 0.35 } },
    house: { fac: [[12, 1]], pal: [0xf4f1e8, 0xf1e3b3, 0xc9dbe6, 0xbfd1b8, 0xe8d5c8, 0xd9e2ea, 0xf0e6d0, 0xb7c8d8], roof: { type: 'gable', pal: [0x4a4e54, 0x5a5650, 0x3d4652, 0x6b5a4c, 0x7a4b2a], pitch: 0.55, p: 0.65, alt: 'hip' } },
    fence: ['picket', 'picket', 'hedge', 'privacy'], lamp: 'kk', light: 0xffd590, tree: 'round', pave: 'conc', road: 0x7a7a7e, tint: [0.96, 1.06, 0.92],
    awn: [0x2f5d3a, 0x8c2f2f, 0x1f3f66], mailbox: 1,
  },
  {
    key: 'fishing', ground: 'lawn', name: 'North Isle',
    tower: { fac: [[12, 1]], pal: { 12: [0xeeeeea] }, hMul: 0.4 },
    blk: { fac: [[12, 1]], pal: [0xeeeeea, 0x9aa7ad, 0x8e3b32, 0x5d7488, 0xe5dcc5], h: [6, 8.5], shop: 0.5, roof: { type: 'gable', pal: [0x2f3338, 0x3b3f44, 0x4b3f38], pitch: 0.8, p: 0.9 } },
    house: { fac: [[12, 1]], pal: [0xeeeeea, 0x9aa7ad, 0x8e3b32, 0x5d7488, 0xe5dcc5, 0x7f8c7a], roof: { type: 'gable', pal: [0x2f3338, 0x3b3f44, 0x4b3f38], pitch: 0.85, p: 1 } },
    fence: ['rail', 'picket'], lamp: 'iron', light: 0xffd79a, tree: 'none', pave: 'conc', road: 0x7a7a7e, tint: [0.95, 1.0, 0.95],
    awn: [0x1f3f66, 0x8c2f2f],
  },
  {
    key: 'alpine', ground: 'forest', name: 'Mt. Ember',
    tower: { fac: [[13, 1]], pal: { 13: [0x6b4a32, 0x5a3d28] }, hMul: 0.5 },
    blk: { fac: [[13, 1]], pal: [0x6b4a32, 0x5a3d28, 0x7a5638, 0x4e3626, 0x8a6a48], h: [9, 16], shop: 0.6, roof: { type: 'gable', pal: [0x3a3f45, 0x5a3a2a, 0x2e3b33, 0x44403c], pitch: 0.75, p: 0.95 } },
    house: { fac: [[13, 1]], pal: [0x6b4a32, 0x5a3d28, 0x7a5638, 0x4e3626], roof: { type: 'gable', pal: [0x3a3f45, 0x5a3a2a, 0x2e3b33], pitch: 0.85, p: 1 } },
    fence: ['stone', 'rail'], lamp: 'iron', light: 0xffcf8a, tree: 'pine', pave: 'conc', road: 0x76767a, tint: [0.93, 0.98, 0.97],
    awn: [0x7a1e1e, 0x2f5d3a, 0x3c3c3c],
  },
  {
    key: 'eastgate', ground: 'paved', name: 'Eastgate',
    tower: { fac: [[2, 0.6], [3, 0.4]], pal: { 2: [0xa8a8a0, 0x8f9196, 0xc0bcb2], 3: GLASS_T }, hMul: 1.2 },
    blk: { fac: [[1, 0.6], [2, 0.4]], pal: { 1: [0x2fa69a, 0xe76f51, 0xf4d35e, 0xf2f2ee, 0x4d9de0, 0xe9c46a, 0xd1495b, 0x7fc8a9], 2: [0xa8a8a0, 0x8f9196, 0xc0bcb2, 0xb5a99a] }, h: [14, 30], shop: 1, clutter: 'ac' },
    house: { fac: [[1, 1]], pal: [0x2fa69a, 0xe76f51, 0xf4d35e, 0xf2f2ee], floors: [3, 3] },
    fence: ['chain', 'privacy'], lamp: 'kk', light: 0xe6dcff, tree: 'round', pave: 'conc', road: 0x707074, tint: [0.9, 0.9, 0.92],
    awn: [0xd1495b, 0x2fa69a, 0xf4d35e, 0x4d9de0, 0x9b5de5], neon: 0.55, billboards: 1, roofBill: 0.12,
  },
  {
    key: 'port', ground: 'paved', name: 'Port Vale',
    tower: { fac: [[2, 1]], pal: { 2: [0xa8a8a0, 0x8f9196] }, hMul: 0.9 },
    blk: { fac: [[6, 0.75], [11, 0.25]], pal: { 6: [0x3f6e8c, 0x8a9499, 0x5a7d5a, 0x9c5a3c, 0xb7b29e, 0x4d5a66], 11: BRICK_RED }, h: [8, 14], shop: 0.08, garage: 0.85, units: 1 },
    house: { fac: [[6, 1]], pal: [0x8a9499, 0x5a7d5a, 0x3f6e8c], floors: [2, 3] },
    fence: ['chain'], lamp: 'kk', light: 0xffa04a, tree: 'none', pave: 'conc', road: 0x6e6e70, tint: [0.86, 0.86, 0.86],
    awn: [0x3c3c3c], dumpsters: 0.3,
  },
  {
    key: 'vipers', ground: 'dirt', name: 'Viper Blocks',
    tower: { fac: [[17, 1]], pal: { 17: [0xd8c3a0, 0xc9b08a] }, hMul: 0.7 },
    blk: { fac: [[17, 1]], pal: [0xd8c3a0, 0xc9b08a, 0xb79c7f, 0xe0d2b8, 0xc7a98c, 0xa9b0a0, 0xd9a58c], h: [6.5, 11], shop: 0.65 },
    house: { fac: [[17, 1]], pal: [0xd8c3a0, 0xc9b08a, 0xe0d2b8], floors: [1, 2] },
    fence: ['chain'], lamp: 'kk', light: 0xff9a40, tree: 'palm', pave: 'dark', road: 0x6a6a6c, tint: [0.9, 0.86, 0.8],
    awn: [0xb71c1c, 0x8e1a1a, 0xd32f2f], dumpsters: 0.4, lampSkip: 0.35,
  },
  {
    key: 'hills', ground: 'lawn', name: 'Pinewood Hills',
    tower: { fac: [[14, 1]], pal: { 14: [0xf4f1ea, 0xece4d4] }, hMul: 0.5 },
    blk: { fac: [[14, 0.7], [16, 0.3]], pal: { 14: [0xf4f1ea, 0xece4d4, 0xe6dccb, 0xf7f5f0, 0xd9cdb8], 16: [0xf5efe3, 0xf0e4cc, 0xeadbc0] }, h: [6.5, 11], shop: 0.45, roofFac: { 16: { type: 'hip', pal: TERRACOTTA, pitch: 0.32, p: 1 } } },
    house: { fac: [[14, 0.6], [16, 0.4]], pal: { 14: [0xf4f1ea, 0xece4d4, 0xf7f5f0, 0xe2d8c4], 16: [0xf5efe3, 0xf0e4cc, 0xeadbc0] }, floors: [2, 3], roofFac: { 16: { type: 'hip', pal: TERRACOTTA, pitch: 0.32, p: 1 } } },
    fence: ['hedge', 'privacy', 'brick'], lamp: 'iron', light: 0xffe2b0, tree: 'palm', pave: 'granite', road: 0x7e7e82, tint: [0.97, 1.02, 0.93],
    awn: [0xf2f2ee, 0x1f3f66, 0x2f5d3a],
  },
  {
    key: 'lakeside', ground: 'lawn', name: 'Lakeside',
    tower: { fac: [[2, 1]], pal: { 2: STONE }, hMul: 0.8 },
    blk: { fac: [[0, 0.5], [1, 0.5]], pal: { 0: [0xa4553c, 0x9b4a35, 0xb06a4c, 0x8e4a35], 1: [0xefe6d2, 0xe8dcc0, 0xf2ece0, 0xdcd0b8] }, h: [9.5, 15], shop: 0.55 },
    house: { fac: [[0, 0.5], [1, 0.5]], pal: { 0: [0xa4553c, 0x9b4a35, 0xb06a4c], 1: [0xefe6d2, 0xe8dcc0, 0xf2ece0] }, roof: { type: 'hip', pal: SLATE, pitch: 0.5, p: 1 } },
    fence: ['hedge', 'brick', 'hedge'], lamp: 'iron', light: 0xffdca0, tree: 'round', pave: 'granite', road: 0x7c7c80, tint: [0.97, 1.04, 0.94],
    awn: [0x1e3b2a, 0x1f3f66, 0x5a1e1e],
  },
  {
    key: 'strip', ground: 'mixed', name: 'Westwood',
    tower: { fac: [[1, 1]], pal: { 1: [0xe8d8b0] }, hMul: 0.5 },
    blk: { fac: [[1, 1]], pal: [0xe8d8b0, 0xd9c49a, 0xbfd8c8, 0xf0e2c0, 0xe0b890, 0xc8d0d8, 0xf2c9a0, 0xa8d0c8], h: [4.9, 8], shop: 0.95, units: 1 },
    house: { fac: [[1, 1]], pal: [0xf0e2c0, 0xe8d8b0, 0xd8e4d8, 0xf2d8b8, 0xdcd4c4], floors: [1, 1], roof: { type: 'hip', pal: [0x8a7a68, 0x6e6458, 0x9a8a70, 0x5a5650], pitch: 0.28, p: 1 } },
    fence: ['privacy', 'chain', 'hedge'], lamp: 'kk', light: 0xffd08a, tree: 'palm', pave: 'conc', road: 0x7a7876, tint: [1.0, 0.98, 0.9],
    awn: [0xd96c3b, 0x2aa37a, 0xf2b630, 0x2f6fd0], billboards: 1.5,
  },
  {
    key: 'mission', ground: 'sand', name: 'Southport',
    tower: { fac: [[16, 1]], pal: { 16: [0xf5efe3, 0xf0e4cc] }, hMul: 0.8 },
    blk: { fac: [[16, 1]], pal: [0xf5efe3, 0xf0e4cc, 0xeadbc0, 0xf7f2ea, 0xe8d2b0, 0xf2dcc0], h: [7, 15], shop: 0.75, roof: { type: 'hip', pal: TERRACOTTA, pitch: 0.3, p: 0.7 } },
    house: { fac: [[16, 1]], pal: [0xf5efe3, 0xf0e4cc, 0xeadbc0, 0xf7f2ea, 0xe8d2b0], roof: { type: 'hip', pal: TERRACOTTA, pitch: 0.32, p: 1 } },
    fence: ['brick', 'hedge'], lamp: 'iron', light: 0xffd090, tree: 'palm', pave: 'terra', road: 0x7e7a76, tint: [1.02, 0.97, 0.88],
    awn: [0x7a2a1a, 0x2f5d3a, 0xb08a2e, 0x1f3f66],
  },
  {
    key: 'deco', ground: 'sand', name: 'Coral Bay',
    tower: { fac: [[9, 1]], pal: { 9: [0xf7f3e8, 0xf4b6c2, 0xa8e6cf, 0x9ad7e8] }, hMul: 1.1 },
    blk: { fac: [[9, 1]], pal: [0xf4b6c2, 0xa8e6cf, 0x9ad7e8, 0xfdf1a6, 0xd6c1ef, 0xffcfa8, 0xf7f3e8, 0xb9e4f2], h: [8, 17], shop: 0.85 },
    house: { fac: [[9, 1]], pal: [0xf4b6c2, 0xa8e6cf, 0x9ad7e8, 0xfdf1a6, 0xf7f3e8], floors: [2, 2] },
    fence: ['hedge', 'privacy'], lamp: 'kk', light: 0xffd6ee, tree: 'palm', pave: 'pink', road: 0x7e7c7e, tint: [1.02, 1.0, 0.94],
    awn: [0x2ab0b0, 0xe86fa8, 0xf2f2ee, 0xf2b630], neon: 0.4,
  },
  {
    key: 'desert', ground: 'dirt', name: 'Red Dust Flats',
    tower: { fac: [[10, 1]], pal: { 10: [0xc98b5a] }, hMul: 0.3 },
    blk: { fac: [[10, 1]], pal: [0xc98b5a, 0xd4a373, 0xb97a52, 0xe0b88a, 0xc4956c, 0xd9b48a], h: [4.5, 8], shop: 0.5, units: 1 },
    house: { fac: [[10, 1]], pal: [0xc98b5a, 0xd4a373, 0xb97a52, 0xe0b88a], floors: [1, 1] },
    fence: ['adobe', 'chain'], lamp: 'wood', light: 0xffa04a, tree: 'none', pave: 'dust', road: 0x9a9088, tint: [1.08, 0.98, 0.86],
    awn: [0x8a5a3c, 0x2a7a7a, 0xb08a2e], lampSkip: 0.3,
  },
  {
    key: 'marsh', ground: 'mixed', name: 'Saltmarsh',
    tower: { fac: [[12, 1]], pal: { 12: [0x8d8a80] }, hMul: 0.3 },
    blk: { fac: [[12, 1]], pal: [0x8d8a80, 0x7a7466, 0x9e9888, 0x6c7a74, 0xa39a86], h: [4.5, 7], shop: 0.4, roof: { type: 'gable', pal: [0x8a5a3a, 0x6e6a62, 0x7b4a32, 0x5e6a6e], pitch: 0.5, p: 1 } },
    house: { fac: [[12, 1]], pal: [0x8d8a80, 0x7a7466, 0x9e9888, 0x6c7a74, 0xa39a86], floors: [1, 1], roof: { type: 'gable', pal: [0x8a5a3a, 0x6e6a62, 0x7b4a32, 0x5e6a6e], pitch: 0.5, p: 1 } },
    fence: ['rail'], lamp: 'wood', light: 0xffb060, tree: 'none', pave: 'conc', road: 0x787672, tint: [0.92, 0.96, 0.88],
    awn: [0x5a3a2a, 0x3c3c3c],
  },
  {
    key: 'beachtown', ground: 'sand', name: 'The Spit',
    tower: { fac: [[12, 1]], pal: { 12: [0xf4f4f0] }, hMul: 0.4 },
    blk: { fac: [[12, 1]], pal: [0x4fc3c9, 0xf28c6b, 0xf6d55c, 0x8fd18f, 0xf4f4f0, 0x6fa8dc, 0xe57fa8], h: [5, 8], shop: 0.6, roof: { type: 'gable', pal: [0xf0f0ea, 0x9aa4a8, 0xd06a4a], pitch: 0.35, p: 0.8 } },
    house: { fac: [[12, 1]], pal: [0x4fc3c9, 0xf28c6b, 0xf6d55c, 0x8fd18f, 0xf4f4f0, 0x6fa8dc, 0xe57fa8], floors: [1, 2], roof: { type: 'gable', pal: [0xf0f0ea, 0x9aa4a8, 0xd06a4a], pitch: 0.4, p: 1 } },
    fence: ['rail', 'picket'], lamp: 'kk', light: 0xffe0b0, tree: 'palm', pave: 'conc', road: 0x86847e, tint: [1.02, 1.0, 0.92],
    awn: [0x2ab0b0, 0xe86fa8, 0xf2b630],
  },
  {
    key: 'farm', ground: 'lawn', name: 'Countryside',
    tower: { fac: [[1, 1]], pal: { 1: [0xf2f0e8] }, hMul: 0.4 },
    blk: { fac: [[12, 1]], pal: [0xf2f0e8, 0xe8dcc0, 0x8e3b32], h: [5, 8], shop: 0.3, roof: { type: 'gable', pal: [0x4a4e54, 0x8b3a2b], pitch: 0.6, p: 0.8 } },
    house: { fac: [[12, 1]], pal: [0xf2f0e8, 0xf0ead8, 0xe8dcc0, 0xdcd8cc], roof: { type: 'gable', pal: [0x4a4e54, 0x8b3a2b, 0x5a5650], pitch: 0.6, p: 1 } },
    fence: ['rail', 'picket', 'hedge'], lamp: 'wood', light: 0xffc070, tree: 'round', pave: 'conc', road: 0x7c7c7e, tint: [1, 1.02, 0.96],
    awn: [0x8c2f2f, 0x2f5d3a], barns: 0.35,
  },
];
export const STYLE = Object.fromEntries(STYLES.map((s, i) => [s.key, i]));

// zone name (terrain.js zoneName / world.json) -> style key
export const ZONE_STYLE = {
  'Downtown': 'downtown', 'Kingsbay': 'brownstone', 'Old Harbour': 'harbour', 'Northside': 'suburb',
  'Port Vale': 'port', 'Eastgate': 'eastgate', 'Southport': 'mission', 'Coral Bay': 'deco',
  'Lakeside': 'lakeside', 'Westwood': 'strip', 'The Spit': 'beachtown', 'North Isle': 'fishing',
  'Mt. Ember': 'alpine', 'Pinewood Hills': 'hills', 'Red Dust Flats': 'desert', 'Mirror Lake': 'lakeside',
  'Saltmarsh': 'marsh', kingz: 'kingz', vipers: 'vipers',
};

// weighted pick with a 0..1 random number
export function wpick(list, r) {
  let t = 0;
  for (const [, w] of list) t += w;
  let a = r * t;
  for (const [v, w] of list) { a -= w; if (a <= 0) return v; }
  return list[list.length - 1][0];
}
