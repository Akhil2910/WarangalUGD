"""Pick junction manholes as control points and render review sheets (imagery + network + 10 m grid).

Each tile is 60 m x 60 m (0.25 m imagery shown at 480 px), centred on a junction manhole. The 5 m grid is labelled in
metres from the manhole (east +, north +). Reviewers read the road-junction centre on the imagery; the
offset (road centre - manhole) is entered into control_points.csv.
Usage: python pipeline/alignment_sheets.py <project_root> [n_points]
"""
import json
import math
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer

ROOT = Path(sys.argv[1])
N = int(sys.argv[2]) if len(sys.argv) > 2 else 60
IMG = ROOT / 'inputs' / 'GWMC_SATELLITE' / 'GWMC.jp2'
OUT = ROOT / 'work' / 'alignment'
OUT.mkdir(parents=True, exist_ok=True)
to_utm = Transformer.from_crs(4326, 32644, always_xy=True).transform

pipes = json.load(open(ROOT / 'work' / 'network' / 'pipes.geojson', encoding='utf8'))['features']
wards = {f['properties']['ward']: f['properties'] for f in json.load(open(ROOT / 'work' / 'network' / 'wards.geojson', encoding='utf8'))['features']}
segs, node_pipes = [], defaultdict(list)
for f in pipes:
    xy = [to_utm(*c) for c in f['geometry']['coordinates']]
    p = f['properties']
    segs.append((xy, p['dia_mm']))
    node_pipes[p['from_mh']].append((xy[0], xy[1], p))
    node_pipes[p['to_mh']].append((xy[-1], xy[-2], p))


def bearing(a, b):
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 360


cands = []
for mh, inc in node_pipes.items():
    if len(inc) < 3 or any(p['length_m'] < 20 for _, _, p in inc):
        continue
    bs = sorted(bearing(a, b) for a, b, _ in inc)
    gaps = [(bs[(i + 1) % len(bs)] - bs[i]) % 360 for i in range(len(bs))]
    if min(gaps) < 50:          # want clear crossings/tees, not near-parallel lines
        continue
    p = inc[0][2]
    if wards[p['ward']]['density_class'] in ('V High', 'High', 'Medium') or p['sewer_zone'] in ('6', '7'):
        cands.append((mh, inc[0][0], p['sewer_zone'], p['ward']))
random.seed(42)
by_zone = defaultdict(list)
for c in cands:
    by_zone[c[2]].append(c)
picked = []
zones = sorted(by_zone)
while len(picked) < N and any(by_zone.values()):
    for z in zones:
        if by_zone[z] and len(picked) < N:
            c = by_zone[z].pop(random.randrange(len(by_zone[z])))
            if all(math.dist(c[1], q[1]) > 500 for q in picked):   # spread out
                picked.append(c)
print(f'{len(cands)} candidate junctions; picked {len(picked)} across zones', {z: sum(1 for p in picked if p[2] == z) for z in zones})

ds = rasterio.open(IMG)
font = ImageFont.load_default()
HALF, PX = 30.0, 480


def tile(cx, cy, label):
    col, row = ~ds.transform * (cx - HALF, cy + HALF)
    arr = ds.read([1, 2, 3], window=Window(col, row, 2 * HALF / 0.25, 2 * HALF / 0.25), boundless=True, fill_value=0, out_shape=(3, PX, PX))
    im = Image.fromarray(np.moveaxis(arr, 0, -1)).convert('RGB')
    dr = ImageDraw.Draw(im)
    tp = lambda x, y: ((x - (cx - HALF)) * PX / (2 * HALF), ((cy + HALF) - y) * PX / (2 * HALF))
    for m in range(-25, 30, 5):
        x, _ = tp(cx + m, cy)
        _, y = tp(cx, cy + m)
        dr.line([(x, 0), (x, PX)], fill=(255, 255, 255) if m else (255, 255, 0), width=1)
        dr.line([(0, y), (PX, y)], fill=(255, 255, 255) if m else (255, 255, 0), width=1)
        dr.text((x + 2, 2), str(m), fill=(255, 255, 0), font=font)
        dr.text((2, y + 2), str(m), fill=(255, 255, 0), font=font)
    for xy, d in segs:
        if min(math.dist(p, (cx, cy)) for p in (xy[0], xy[-1])) > 200:
            continue
        dr.line([tp(*p) for p in xy], fill=(255, 40, 200), width=1)
    x, y = tp(cx, cy)
    dr.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(0, 255, 255), width=2)
    dr.rectangle([PX - 60, PX - 18, PX, PX], fill=(0, 0, 0))
    dr.text((PX - 56, PX - 15), label, fill=(255, 255, 255), font=font)
    return im


meta = []
for s in range(0, len(picked), 4):
    sheet = Image.new('RGB', (2 * PX + 10, 2 * PX + 10), (0, 0, 0))
    for k, (mh, (cx, cy), z, w) in enumerate(picked[s:s + 4]):
        label = f'CP{s + k + 1:02d}'
        sheet.paste(tile(cx, cy, label), ((k % 2) * (PX + 10), (k // 2) * (PX + 10)))
        meta.append(dict(cp=label, mh_code=mh, sewer_zone=z, ward=w, mh_e=round(cx, 2), mh_n=round(cy, 2), sheet=f'cp_sheet_{s // 4 + 1:02d}.jpg'))
    sheet.save(OUT / f'cp_sheet_{s // 4 + 1:02d}.jpg', quality=92)
json.dump(meta, open(OUT / 'control_points_meta.json', 'w'), indent=1)
print('sheets written to', OUT)
