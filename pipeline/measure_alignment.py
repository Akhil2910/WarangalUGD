"""Measure how far the DPR pipes sit from the road centre on the imagery.

Method (per straight pipe reach, 35 m or longer):
  * sample the imagery on lines perpendicular to the reach, every 0.5 m along it, from -15 m to +15 m across
  * average those cross-profiles -> one profile across the road (noise and cars average out)
  * the road shows as a band with matching edges on both sides: find the offset c where the profile
    is most symmetric about c (correlation of profile(c+t) with profile(c-t), t = 1.5..9 m)
  * keep measurements with a clear symmetry peak
Each measurement gives the offset of the road centre from the pipe along the reach's normal.
A least-squares fit over all reaches (with robust weights) gives the systematic shift (east, north) for the
whole network and per sewer zone; the remaining scatter is the residual error of the overlay.
Usage: python pipeline/measure_alignment.py <project_root> [n_reaches]
"""
import csv
import json
import math
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from scipy.ndimage import map_coordinates
from pyproj import Transformer

ROOT = Path(sys.argv[1])
NREACH = int(sys.argv[2]) if len(sys.argv) > 2 else 700
OUT = ROOT / 'work' / 'alignment'
OUT.mkdir(parents=True, exist_ok=True)
to_utm = Transformer.from_crs(4326, 32644, always_xy=True).transform
ds = rasterio.open(ROOT / 'inputs' / 'GWMC_SATELLITE' / 'GWMC.jp2')
T = ds.transform

feats = json.load(open(ROOT / 'work' / 'network' / 'pipes.geojson', encoding='utf8'))['features']
density = {f['properties']['ward']: f['properties']['density_class'] for f in json.load(open(ROOT / 'work' / 'network' / 'wards.geojson', encoding='utf8'))['features']}
AREA = lambda w: 'built-up' if density[w] in ('V High', 'High', 'Medium') else 'outer'
cands = []
for f in feats:
    c = f['geometry']['coordinates']
    p = f['properties']
    if p['geom_source'] != 'GIS line':
        continue
    xy = [to_utm(*q) for q in c]
    L = math.dist(xy[0], xy[-1])
    if L < 35:
        continue
    # straightness: every vertex within 0.5 m of the chord
    ux, uy = (xy[-1][0] - xy[0][0]) / L, (xy[-1][1] - xy[0][1]) / L
    if any(abs((x - xy[0][0]) * uy - (y - xy[0][1]) * ux) > 0.5 for x, y in xy):
        continue
    cands.append((p['pipe_id'], p['sewer_zone'], p['ward'], xy[0], xy[-1]))
random.seed(1)
by_zone = defaultdict(list)
for c in cands:
    by_zone[c[1]].append(c)
per_zone = max(1, NREACH // len(by_zone))
sample = [c for z in sorted(by_zone) for c in random.sample(by_zone[z], min(per_zone, len(by_zone[z])))]
print(f'{len(cands)} straight reaches >= 35 m; measuring {len(sample)}', {z: min(per_zone, len(v)) for z, v in by_zone.items()})

TS = np.arange(-15, 15.01, 0.25)      # across-road offsets (m)
LAG = np.arange(1.5, 9.01, 0.25)


def measure(a, b):
    L = math.dist(a, b)
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    nx, ny = -uy, ux                                  # left normal
    along = np.arange(3, L - 3, 0.5)
    X = a[0] + np.outer(along, np.ones_like(TS)) * ux + np.outer(np.ones_like(along), TS) * nx
    Y = a[1] + np.outer(along, np.ones_like(TS)) * uy + np.outer(np.ones_like(along), TS) * ny
    col, row = ~T * (X, Y)
    c0, r0 = int(col.min()) - 2, int(row.min()) - 2
    w = Window(c0, r0, int(col.max()) - c0 + 4, int(row.max()) - r0 + 4)
    img = ds.read([1, 2, 3], window=w, boundless=True, fill_value=0).astype(np.float32)
    if (img.sum(0) == 0).mean() > 0.05:
        return None
    prof = np.zeros(len(TS))
    for band in img:
        s = map_coordinates(band, [row - r0, col - c0], order=1)
        prof += s.mean(0)
    prof /= 3
    best = []
    for c in np.arange(-7, 7.01, 0.25):
        left = np.interp(c - LAG, TS, prof)
        right = np.interp(c + LAG, TS, prof)
        if left.std() < 1 or right.std() < 1:
            best.append(-1)
            continue
        best.append(np.corrcoef(left, right)[0, 1])
    best = np.array(best)
    cs = np.arange(-7, 7.01, 0.25)
    i = int(best.argmax())
    # prominence: best vs best value at least 3 m away
    far = best[np.abs(cs - cs[i]) >= 3]
    prom = best[i] - (far.max() if far.size else -1)
    # contrast across the road: a real road has edges, a uniform field does not
    contrast = float(np.percentile(prof, 90) - np.percentile(prof, 10))
    centre = np.interp(cs[i] + np.arange(-1.5, 1.6, 0.25), TS, prof)
    sides = np.concatenate([np.interp(cs[i] - LAG[LAG >= 5], TS, prof), np.interp(cs[i] + LAG[LAG >= 5], TS, prof)])
    band = float(abs(centre.mean() - sides.mean()))
    return dict(offset=float(cs[i]), score=float(best[i]), prominence=float(prom), contrast=round(contrast, 1), band=round(band, 1),
                nx=nx, ny=ny, length=L)


rows = []
for k, (pid, z, ward, a, b) in enumerate(sample):
    m = measure(a, b)
    if m:
        rows.append(dict(pipe_id=pid, sewer_zone=z, ward=ward, area=AREA(ward), e=round((a[0] + b[0]) / 2, 1), n=round((a[1] + b[1]) / 2, 1), **m))
    if k % 100 == 0:
        print(' ', k, flush=True)
good = [r for r in rows if r['score'] >= 0.8 and r['prominence'] >= 0.15 and r['contrast'] >= 12 and r['band'] >= 6]
print(f'measured {len(rows)}, clear road found in {len(good)}')


def fit(rs):
    A = np.array([[r['nx'], r['ny']] for r in rs])
    d = np.array([r['offset'] for r in rs])
    w = np.ones(len(rs))
    for _ in range(10):                                  # iteratively reweighted (Huber, k = 1.5 m)
        s, *_ = np.linalg.lstsq(A * w[:, None], d * w, rcond=None)
        res = d - A @ s
        w = np.sqrt(np.where(np.abs(res) <= 1.5, 1, 1.5 / np.abs(res)))
    res = d - A @ s
    return s, res


summary = {}
s, res = fit(good)
summary['all'] = dict(n=len(good), shift_e=round(float(s[0]), 2), shift_n=round(float(s[1]), 2),
                      raw_median_abs=round(float(np.median(np.abs([r['offset'] for r in good]))), 2),
                      resid_rms=round(float(np.sqrt(np.mean(res ** 2))), 2), resid_median_abs=round(float(np.median(np.abs(res))), 2),
                      resid_p90_abs=round(float(np.percentile(np.abs(res), 90)), 2))
for r, e in zip(good, res):
    r['residual_after_global'] = round(float(e), 2)
groups = [(f'zone {z}', 'sewer_zone', z) for z in sorted({r['sewer_zone'] for r in good})] + [(a, 'area', a) for a in ('built-up', 'outer')]
for name, fld, z in groups:
    g = [r for r in good if r[fld] == z]
    if len(g) < 8:
        continue
    sz, rz = fit(g)
    summary[name] = dict(n=len(g), shift_e=round(float(sz[0]), 2), shift_n=round(float(sz[1]), 2),
                                raw_median_abs=round(float(np.median(np.abs([r['offset'] for r in g]))), 2),
                                resid_rms=round(float(np.sqrt(np.mean(rz ** 2))), 2), resid_median_abs=round(float(np.median(np.abs(rz))), 2))
json.dump(summary, open(OUT / 'alignment_summary.json', 'w'), indent=1)
with open(OUT / 'alignment_measurements.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) + ['used', 'residual_after_global'])
    w.writeheader()
    for r in rows:
        w.writerow(dict(r, used=r in good, residual_after_global=r.get('residual_after_global', '')))
print(json.dumps(summary, indent=1))
