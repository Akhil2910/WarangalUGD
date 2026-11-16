"""Combine control-point readings with their manhole positions; fit shift and similarity; report residuals.
Usage: python pipeline/alignment_stats.py <project_root>"""
import csv, json, sys
from pathlib import Path
import numpy as np

ROOT = Path(sys.argv[1]); A = ROOT / 'work' / 'alignment'
meta = {m['cp']: m for m in json.load(open(A / 'control_points_meta.json'))}
rows = []
for r in csv.DictReader(open(A / 'control_point_readings.csv')):
    m = meta[r['cp']]
    rows.append(dict(m, **r))
use = [r for r in rows if r['confidence'] != 'rejected']
src = np.array([[r['mh_e'], r['mh_n']] for r in use], float)
d = np.array([[float(r['road_centre_dx_m']), float(r['road_centre_dy_m'])] for r in use])
dst = src + d
mag = np.hypot(d[:, 0], d[:, 1])
out = dict(points_read=len(rows), points_used=len(use), rejected=len(rows) - len(use),
           by_confidence={c: sum(r['confidence'] == c for r in use) for c in ('high', 'medium', 'low')},
           untransformed=dict(mean_dx=round(d[:, 0].mean(), 2), mean_dy=round(d[:, 1].mean(), 2), rms_m=round(float(np.sqrt((mag ** 2).mean())), 2),
                              median_m=round(float(np.median(mag)), 2), max_m=round(float(mag.max()), 2), within_3m=int((mag <= 3).sum())))
# best translation
t = d.mean(0)
r_t = np.hypot(*(d - t).T)
out['translation_fit'] = dict(shift_e=round(t[0], 2), shift_n=round(t[1], 2), rms_m=round(float(np.sqrt((r_t ** 2).mean())), 2))
# similarity (scale + rotation + translation), least squares
c = src.mean(0); s0 = src - c; d0 = dst - c
Aw = np.zeros((2 * len(use), 4)); b = d0.reshape(-1)
Aw[0::2] = np.c_[s0[:, 0], -s0[:, 1], np.ones(len(use)), np.zeros(len(use))]
Aw[1::2] = np.c_[s0[:, 1], s0[:, 0], np.zeros(len(use)), np.ones(len(use))]
p, *_ = np.linalg.lstsq(Aw, b, rcond=None)
res = (Aw @ p - b).reshape(-1, 2)
r_s = np.hypot(*res.T)
out['similarity_fit'] = dict(scale=round(float(np.hypot(p[0], p[1])), 6), rotation_deg=round(float(np.degrees(np.arctan2(p[1], p[0]))), 4),
                             shift_e=round(float(p[2]), 2), shift_n=round(float(p[3]), 2), rms_m=round(float(np.sqrt((r_s ** 2).mean())), 2))
# excluding points where the pipe is on one side of a wide road by design
side = [i for i, r in enumerate(use) if 'side' in r['note'] or 'edge' in r['note']]
keep = [i for i in range(len(use)) if i not in side]
out['excluding_road_side_pipes'] = dict(points=len(keep), rms_m=round(float(np.sqrt((mag[keep] ** 2).mean())), 2),
                                        median_m=round(float(np.median(mag[keep])), 2), max_m=round(float(mag[keep].max()), 2))
for zz in sorted({r['sewer_zone'] for r in use}):
    idx = [i for i, r in enumerate(use) if r['sewer_zone'] == zz]
    out.setdefault('by_zone', {})[zz] = dict(points=len(idx), mean_dx=round(d[idx, 0].mean(), 2), mean_dy=round(d[idx, 1].mean(), 2),
                                             rms_m=round(float(np.sqrt((mag[idx] ** 2).mean())), 2))
json.dump(out, open(A / 'control_points_summary.json', 'w'), indent=1)
with open(A / 'control_points.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['cp', 'sewer_zone', 'ward', 'manhole', 'mh_e', 'mh_n', 'road_centre_e', 'road_centre_n', 'offset_m', 'confidence', 'note', 'sheet'])
    for r in rows:
        if r['confidence'] == 'rejected':
            w.writerow([r['cp'], r['sewer_zone'], r['ward'], r['mh_code'], r['mh_e'], r['mh_n'], '', '', '', 'rejected', r['note'], r['sheet']])
        else:
            dx, dy = float(r['road_centre_dx_m']), float(r['road_centre_dy_m'])
            w.writerow([r['cp'], r['sewer_zone'], r['ward'], r['mh_code'], r['mh_e'], r['mh_n'], round(r['mh_e'] + dx, 2), round(r['mh_n'] + dy, 2),
                        round((dx * dx + dy * dy) ** .5, 2), r['confidence'], r['note'], r['sheet']])
print(json.dumps(out, indent=1))
