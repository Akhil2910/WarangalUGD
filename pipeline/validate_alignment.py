"""Render measured reaches: pipe (magenta) and detected road centre (cyan), for visual checking.
Usage: python pipeline/validate_alignment.py <project_root>"""
import csv, json, math, sys
from pathlib import Path
import numpy as np, rasterio
from rasterio.windows import Window
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer

ROOT = Path(sys.argv[1]); OUT = ROOT / 'work' / 'alignment'
to_utm = Transformer.from_crs(4326, 32644, always_xy=True).transform
ds = rasterio.open(ROOT / 'inputs' / 'GWMC_SATELLITE' / 'GWMC.jp2')
geo = {f['properties']['pipe_id']: [to_utm(*c) for c in f['geometry']['coordinates']]
       for f in json.load(open(ROOT / 'work' / 'network' / 'pipes.geojson', encoding='utf8'))['features']}
rows = [r for r in csv.DictReader(open(OUT / 'alignment_measurements.csv')) if r['used'] == 'True']
rows.sort(key=lambda r: abs(float(r['offset'])))
import random; random.seed(5); pick = random.sample(rows, 6)
PX, HALF = 400, 40.0
font = ImageFont.load_default()
sheet = Image.new('RGB', (3 * PX + 20, 2 * PX + 10))
for k, r in enumerate(pick):
    a, b = geo[r['pipe_id']][0], geo[r['pipe_id']][-1]
    cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    col, row = ~ds.transform * (cx - HALF, cy + HALF)
    win = Window(col, row, 2 * HALF / 0.25, 2 * HALF / 0.25)
    arr = ds.read([1, 2, 3], window=win, boundless=True, out_shape=(3, PX, PX))
    im = Image.fromarray(np.moveaxis(arr, 0, -1)); dr = ImageDraw.Draw(im)
    tp = lambda p: ((p[0] - (cx - HALF)) * PX / (2 * HALF), ((cy + HALF) - p[1]) * PX / (2 * HALF))
    nx, ny, o = float(r['nx']), float(r['ny']), float(r['offset'])
    dr.line([tp(a), tp(b)], fill=(255, 0, 220), width=2)
    dr.line([tp((a[0] + nx * o, a[1] + ny * o)), tp((b[0] + nx * o, b[1] + ny * o))], fill=(0, 255, 255), width=2)
    dr.rectangle([0, PX - 16, PX, PX], fill=(0, 0, 0))
    dr.text((4, PX - 14), f"{r['pipe_id']} zone {r['sewer_zone']}  road centre {o:+.2f} m  sym {float(r['score']):.2f}", fill=(255, 255, 255), font=font)
    sheet.paste(im, ((k % 3) * (PX + 10), (k // 3) * (PX + 10)))
sheet.save(OUT / 'validation_sheet.jpg', quality=90)
print('ok', [(r['pipe_id'], r['offset']) for r in pick])
