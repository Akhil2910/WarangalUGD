"""List places where planned pipes cross streams, canals and drains (GWMC KML layer), and pipes lying along them.
These need special works (or are drawing errors) and are listed for the engineers.
Usage: python pipeline/crossings.py <project_root>
"""
import csv, json, sys
from collections import Counter
from pathlib import Path
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree
sys.path.insert(0, str(Path(__file__).parent))
from lib_inputs import read_kml  # noqa: E402

ROOT = Path(sys.argv[1]); N = ROOT / 'work' / 'network'
to_utm = Transformer.from_crs(4326, 32644, always_xy=True).transform
to_wgs = Transformer.from_crs(32644, 4326, always_xy=True).transform
water, wtype = [], []
for a, gs in read_kml(ROOT / 'inputs' / 'Warangal_KML' / 'Warangal_KML' / 'Streams_Drainage_Canal.kml'):
    t = a.get('SDC_TYPE', '').strip().lower()
    t = 'Canal' if 'canal' in t else 'Drain' if 'drin' in t or 'drain' in t else 'Stream'
    for g, pts in gs:
        if g == 'LineString' and len(pts) > 1:
            water.append(LineString([to_utm(*p) for p in pts])); wtype.append(t)
tree = STRtree(water)
stretch_of = {r['pipe_id']: r['stretch'] for r in csv.DictReader(open(N / 'stretch_pipes.csv'))}
rows = []
for f in json.load(open(N / 'pipes.geojson', encoding='utf8'))['features']:
    p = f['properties']
    line = LineString([to_utm(*c) for c in f['geometry']['coordinates']])
    for i in tree.query(line.buffer(4)):
        w = water[i]
        inter = line.intersection(w)
        along = line.intersection(w.buffer(4)).length
        if not inter.is_empty:
            pt = inter if inter.geom_type == 'Point' else inter.centroid if inter.geom_type != 'MultiPoint' else inter.geoms[0]
            kind = 'crosses'
        elif along >= max(10, 0.5 * line.length):
            pt = line.intersection(w.buffer(4)).centroid
            kind = 'runs along (within 4 m)'
        else:
            continue
        lon, lat = to_wgs(pt.x, pt.y)
        rows.append(dict(pipe_id=p['pipe_id'], stretch=stretch_of[p['pipe_id']], catchment=p['catchment'], line_no=p['line_no'], dia_mm=p['dia_mm'],
                         ward=p['ward'], water=wtype[i], kind=kind, length_along_m=round(along, 1), lat=round(lat, 6), lon=round(lon, 6)))
with open(N / 'crossings_water.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(len(rows), 'rows;', Counter((r['kind'], r['water']) for r in rows).most_common())
print('pipes involved', len({r['pipe_id'] for r in rows}), '; trunk (>=500 mm) crossings', sum(1 for r in rows if r['kind'] == 'crosses' and r['dia_mm'] >= 500))
