# Map compiler

Turns `reference-map.png` (a stylised island map) into `public/game/assets/map/world.json`,
which the game loads at start-up.

The compiler does the following:
1. Classifies the image into land, water and roads, using local contrast so thin bridges over water are kept.
2. Skeletonizes the roads into a graph: junctions and polylines.
3. Cleans the graph: merges junction clusters, prunes spurs, joins chains and drops tiny fragments.
4. Builds the world (`compile.py`):
   - heights: a coastal plain, hills away from roads and mountains in the large road-free interiors, flattened in towns;
   - road classes and smoothed geometry, plus height profiles limited to 8% gradient (11% on rural roads);
   - bridges over water, and terrain carved under the roads;
   - five airports with flattened airfields;
   - street-facing building lots from a 2.5 m occupancy raster;
   - biomes, districts, gang turf and landmarks.

Scale: 15 m per reference pixel, so the 825 px map is a 12.4 km square.

```sh
python3 -m venv venv && venv/bin/pip install numpy scipy scikit-image pillow
venv/bin/python step1.py && venv/bin/python step2.py && venv/bin/python step3.py && venv/bin/python compile.py
```

Hand-placed data (airport runways, downtown centres, district names, gang turf and the landmark streets) is in
`compile.py` in reference-map pixel coordinates.
