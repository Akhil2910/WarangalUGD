"""Assemble the app's map-data folder (app-data/) from the pipeline outputs.
Writes meta.json, search.json, crossings.geojson, control_points.geojson and copies tiles and boundaries.
Usage: python pipeline/publish_app_data.py <project_root>
"""
import csv, json, shutil, sys
from pathlib import Path
from pyproj import Transformer

ROOT = Path(sys.argv[1]); W = ROOT / 'work'; N = W / 'network'; T = W / 'tiles'
OUT = ROOT / 'app-data'; OUT.mkdir(exist_ok=True)
to_wgs = Transformer.from_crs(32644, 4326, always_xy=True).transform
IMAGERY_CREDIT = 'Satellite imagery purchased by GWMC (vendor, date and licence to be confirmed)'


def copy(src, name=None):
    dst = OUT / (name or src.name)
    if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime or dst.stat().st_size != src.stat().st_size:
        shutil.copy2(src, dst)


for f in ('network.pmtiles', 'stretches.pmtiles', 'dpr_original.pmtiles'):
    copy(T / f)
for f in ('wards.geojson', 'admin_zones.geojson', 'sewer_zones.geojson'):
    copy(N / f)
img = W / 'imagery' / 'imagery.pmtiles'
if img.exists():
    copy(img)
# Quick 4 m preview (work/imagery_preview, made from the JP2's built-in overview): shows under the full imagery
# and stands in for it while the full tiles are being made.
prev = W / 'imagery_preview' / 'imagery_preview.pmtiles'
if prev.exists():
    copy(prev)


def bbox_of(geom):
    xs, ys = [], []
    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for x in c: walk(x)
    walk(geom['coordinates'])
    return [round(min(xs), 6), round(min(ys), 6), round(max(xs), 6), round(max(ys), 6)]


def centre(geom):
    b = bbox_of(geom)
    return round((b[0] + b[2]) / 2, 6), round((b[1] + b[3]) / 2, 6)


wards = json.load(open(N / 'wards.geojson', encoding='utf8'))['features']
admin = json.load(open(N / 'admin_zones.geojson', encoding='utf8'))['features']
szones = json.load(open(N / 'sewer_zones.geojson', encoding='utf8'))['features']
stretches = json.load(open(N / 'stretches.geojson', encoding='utf8'))['features']
manholes = json.load(open(N / 'manholes.geojson', encoding='utf8'))['features']
stations = json.load(open(N / 'stations.geojson', encoding='utf8'))['features']
totals = {r['group'] + ':' + r['value']: r for r in csv.DictReader(open(N / 'plan_totals.csv'))}

allb = [bbox_of(w['geometry']) for w in wards]
meta = dict(
    bounds=[min(b[0] for b in allb), min(b[1] for b in allb), max(b[2] for b in allb), max(b[3] for b in allb)],
    imagery_credit=IMAGERY_CREDIT, imagery_available=(OUT / 'imagery.pmtiles').exists(),
    imagery_preview_available=(OUT / 'imagery_preview.pmtiles').exists(),
    admin_zones=sorted([dict(id=z['properties']['zone_id'], name=z['properties']['name'], bbox=bbox_of(z['geometry'])) for z in admin], key=lambda z: z['id']),
    sewer_zones=sorted([dict(name=z['properties']['name'], bbox=bbox_of(z['geometry'])) for z in szones], key=lambda z: z['name']),
    plan=dict(km=round(float(totals['all:']['km']), 1), manholes=int(totals['all:']['manholes']), reaches=int(totals['all:']['reaches']), stretches=len(stretches)),
)
json.dump(meta, open(OUT / 'meta.json', 'w'), indent=1)

# search index: [kind, label, detail, lon, lat]
idx = []
for w in wards:
    p = w['properties']; lon, lat = centre(w['geometry'])
    idx.append(['Ward', f"Ward {p['ward']}", f"{p['admin_zone']} · {p['corporator']}", lon, lat])
for s in stretches:
    p = s['properties']; c = s['geometry']['coordinates'][0]; m = c[len(c) // 2]
    idx.append(['Stretch', p['code'], f"{p['road_name'] or 'unnamed road'} · {p['length_m']} m · {p['catchment']}", m[0], m[1]])
seen_roads = set()
for s in stretches:
    p = s['properties']
    if p['road_name'] and (p['road_name'], p['ward']) not in seen_roads:
        seen_roads.add((p['road_name'], p['ward'])); c = s['geometry']['coordinates'][0]; m = c[len(c) // 2]
        idx.append(['Road', p['road_name'], f"Ward {p['ward']}", m[0], m[1]])
for st in stations:
    p = st['properties']; lon, lat = st['geometry']['coordinates']
    idx.append([p['kind'], p['label'], f"Sewer zone {p['sewer_zone']} · Ward {p['ward']}", lon, lat])
for m in manholes:
    p = m['properties']; lon, lat = m['geometry']['coordinates']
    idx.append(['Manhole', p['mh_code'], f"Ward {p['ward']} · GL {p['gl']} · IL {p['il']}", lon, lat])
json.dump(idx, open(OUT / 'search.json', 'w'), separators=(',', ':'))

# crossings and control points as point layers
feats = []
for r in csv.DictReader(open(N / 'crossings_water.csv')):
    feats.append(dict(type='Feature', geometry=dict(type='Point', coordinates=[float(r['lon']), float(r['lat'])]),
                      properties=dict(pipe_id=r['pipe_id'], code=r['stretch'], dia_mm=int(r['dia_mm']), water=r['water'], kind=r['kind'])))
json.dump(dict(type='FeatureCollection', features=feats), open(OUT / 'crossings.geojson', 'w'))
feats = []
for r in csv.DictReader(open(W / 'alignment' / 'control_points.csv')):
    lon, lat = to_wgs(float(r['mh_e']), float(r['mh_n']))
    feats.append(dict(type='Feature', geometry=dict(type='Point', coordinates=[round(lon, 7), round(lat, 7)]),
                      properties=dict(label=r['cp'], mh_code=r['manhole'], offset_m=r['offset_m'], confidence=r['confidence'], note=r['note'])))
json.dump(dict(type='FeatureCollection', features=feats), open(OUT / 'control_points.geojson', 'w'))
print('app-data:', sorted(p.name for p in OUT.iterdir()), '| search entries', len(idx), '| imagery', meta['imagery_available'])
