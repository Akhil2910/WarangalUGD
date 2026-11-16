"""Overlay images per GWMC zone: imagery (from the XYZ tile pyramid) + DPR pipes + ward/zone lines.
Also builds a simple water mask (dark, bluish pixels) per zone and lists pipes running through water.
Usage: python pipeline/zone_overlays.py <project_root> [zoom]"""
import csv, json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import LineString, shape

ROOT = Path(sys.argv[1]); Z = int(sys.argv[2]) if len(sys.argv) > 2 else 15
TILES = ROOT / 'work' / 'imagery' / 'tiles'; N = ROOT / 'work' / 'network'
OUT = ROOT / 'docs' / 'map-phase' / 'zone-overlays'; OUT.mkdir(parents=True, exist_ok=True)
CLS = {'Lateral (150-200 mm)': ((244, 63, 94), 1), 'Sub-main (250-450 mm)': ((245, 158, 11), 2), 'Trunk main (500 mm+)': ((168, 85, 247), 3)}


def px(lon, lat, z):
    n = 2 ** z * 256
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def mosaic(b, z):
    x0, y1 = px(b[0], b[1], z); x1, y0 = px(b[2], b[3], z)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    im = Image.new('RGB', ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256), (20, 24, 35))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            f = TILES / str(z) / str(tx) / f'{ty}.webp'
            if f.exists():
                im.paste(Image.open(f).convert('RGB'), ((tx - tx0) * 256, (ty - ty0) * 256))
    return im, tx0 * 256, ty0 * 256


pipes = json.load(open(N / 'pipes.geojson', encoding='utf8'))['features']
wards = json.load(open(N / 'wards.geojson', encoding='utf8'))['features']
zones = json.load(open(N / 'admin_zones.geojson', encoding='utf8'))['features']
font = ImageFont.load_default()
water_rows = []
for zf in sorted(zones, key=lambda f: f['properties']['zone_id']):
    zid = zf['properties']['zone_id']; zg = shape(zf['geometry'])
    b = zg.bounds
    im, ox, oy = mosaic(b, Z)
    arr = np.asarray(im).astype(np.int16)
    r, g, bl = arr[..., 0], arr[..., 1], arr[..., 2]
    water = (r + g + bl < 210) & (bl >= r) & (g >= r) & (np.asarray(im).sum(2) > 15)
    dr = ImageDraw.Draw(im)
    tp = lambda c: (px(c[0], c[1], Z)[0] - ox, px(c[0], c[1], Z)[1] - oy)
    for w in wards:
        for poly in (w['geometry']['coordinates'] if w['geometry']['type'] == 'MultiPolygon' else [w['geometry']['coordinates']]):
            dr.line([tp(c) for c in poly[0]], fill=(253, 224, 71), width=1)
    for poly in (zf['geometry']['coordinates'] if zf['geometry']['type'] == 'MultiPolygon' else [zf['geometry']['coordinates']]):
        dr.line([tp(c) for c in poly[0]], fill=(251, 146, 60), width=3)
    for f in pipes:
        p = f['properties']
        if p['admin_zone'] != zid:
            continue
        pts = [tp(c) for c in f['geometry']['coordinates']]
        col, wd = CLS[p['dia_class']]
        dr.line(pts, fill=col, width=wd)
        # water check: share of the pipe's sampled pixels on water
        line = LineString(pts)
        n = max(2, int(line.length))
        hits = 0
        for i in range(n):
            q = line.interpolate(i / (n - 1), normalized=True)
            xi, yi = int(q.x), int(q.y)
            if 0 <= yi < water.shape[0] and 0 <= xi < water.shape[1] and water[yi, xi]:
                hits += 1
        mpp = 156543.03 * math.cos(math.radians(f['geometry']['coordinates'][0][1])) / 2 ** Z
        if hits * mpp >= 15:
            c = f['geometry']['coordinates'][len(f['geometry']['coordinates']) // 2]
            water_rows.append(dict(pipe_id=p['pipe_id'], catchment=p['catchment'], line_no=p['line_no'], dia_mm=p['dia_mm'], ward=p['ward'],
                                   admin_zone=zid, metres_on_water=round(hits * mpp, 1), share=round(hits / n, 2), lon=round(c[0], 6), lat=round(c[1], 6)))
    dr.rectangle([0, 0, 360, 22], fill=(0, 0, 0))
    dr.text((6, 5), f'{zf["properties"]["name"]} - DPR pipes on imagery (zoom {Z}, about {mpp:.1f} m/pixel)', fill=(255, 255, 255), font=font)
    im.save(OUT / f'{zid}.jpg', quality=85)
    print(zid, im.size, flush=True)
with open(OUT.parent / 'pipes_through_water.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(water_rows[0].keys()) if water_rows else ['pipe_id']); w.writeheader(); w.writerows(water_rows)
print('pipes with 15 m or more over water-looking pixels:', len(water_rows))
