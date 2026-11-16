"""Write app-data/dpr_network_seed.json: every DPR pipe (manhole to manhole) with what the server needs to build
work stretches from DPR pipes: end manholes, diameter, length, ward, zone, invert levels, depths and the line.
Not downloadable by users (names containing _seed are refused by /data).
Usage: python pipeline/publish_dpr_network.py <project_root>"""
import json, sys
from pathlib import Path

ROOT = Path(sys.argv[1]); N = ROOT / 'work' / 'network'; OUT = ROOT / 'app-data'


def num(v):
    return round(v, 3) if isinstance(v, (int, float)) else None


pipes = {}
for f in json.load(open(N / 'pipes.geojson', encoding='utf8'))['features']:
    p = f['properties']
    g = f['geometry']
    coords = g['coordinates'] if g['type'] == 'LineString' else [c for part in g['coordinates'] for c in part]
    pipes[p['pipe_id']] = [p['from_mh'], p['to_mh'], p['dia_mm'], round(p['length_m'], 2), p['ward'], p['admin_zone'],
                           num(p.get('il_up')), num(p.get('il_dn')), num(p.get('depth_up')), num(p.get('depth_dn')),
                           [[round(c[0], 7), round(c[1], 7)] for c in coords], p.get('material') or '', p.get('catchment') or '', str(p.get('sewer_zone') or '')]
mh = {}
for f in json.load(open(N / 'manholes.geojson', encoding='utf8'))['features']:
    p = f['properties']
    c = f['geometry']['coordinates']
    mh[p['mh_code']] = [round(c[0], 7), round(c[1], 7)]
with open(OUT / 'dpr_network_seed.json', 'w', encoding='utf8') as fh:
    json.dump(dict(version=1, fields=['from_mh', 'to_mh', 'dia_mm', 'length_m', 'ward', 'admin_zone', 'il_up', 'il_dn', 'depth_up', 'depth_dn', 'coords', 'material', 'catchment', 'sewer_zone'],
                   pipes=pipes, manholes=mh), fh, separators=(',', ':'))
print('dpr_network_seed.json:', len(pipes), 'pipes,', len(mh), 'manholes,', round((OUT / 'dpr_network_seed.json').stat().st_size / 1e6, 1), 'MB')
