"""Write app-data/stretches_seed.json: the starting road stretches the server loads into its database once
(only stretches it does not have yet; recorded work is never touched).
Each stretch carries its pipes (with design diameter, manholes and invert levels) so per-reach and
per-manhole compliance items and the design-invert check work without the GIS files.
Usage: python pipeline/publish_stretch_seed.py <project_root>"""
import csv, json, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(sys.argv[1]); N = ROOT / 'work' / 'network'; OUT = ROOT / 'app-data'
pipes = {f['properties']['pipe_id']: f['properties'] for f in json.load(open(N / 'pipes.geojson', encoding='utf8'))['features']}
by_stretch = defaultdict(list)
for r in csv.DictReader(open(N / 'stretch_pipes.csv')):
    by_stretch[r['stretch']].append(r['pipe_id'])


def rnd(c):
    return [rnd(x) for x in c] if isinstance(c[0], list) else [round(c[0], 6), round(c[1], 6)]


out = []
for f in json.load(open(N / 'stretches.geojson', encoding='utf8'))['features']:
    p = f['properties']
    ps = [pipes[i] for i in by_stretch[p['code']]]
    mh = {}
    for q in ps:  # design invert at each manhole: the lowest pipe invert there
        for code, il in ((q['from_mh'], q['il_up']), (q['to_mh'], q['il_dn'])):
            major = q['dia_mm'] >= 250
            old = mh.get(code)
            il = il if isinstance(il, (int, float)) else None
            if old is None:
                mh[code] = [code, il, major]
            else:
                if il is not None and (old[1] is None or il < old[1]):
                    old[1] = il
                old[2] = old[2] or major
    out.append(dict(
        code=p['code'], ward=p['ward'], admin_zone=p['admin_zone'], sewer_zone=p['sewer_zone'], catchment=p['catchment'],
        road_name=p['road_name'], length_m=p['length_m'], planned_manholes=p['planned_manholes'],
        dia_m=json.loads(p['dia_m']), max_dia_mm=p['max_dia_mm'], max_depth_m=p['max_depth_m'], outside_ward=p['outside_ward'],
        geom=dict(type=f['geometry']['type'], coordinates=rnd(f['geometry']['coordinates'])),
        pipes=[[q['pipe_id'], q['dia_mm'], q['from_mh'], q['to_mh'], q['length_m']] for q in ps],
        manholes=sorted(mh.values()),
    ))
with open(OUT / 'stretches_seed.json', 'w', encoding='utf8') as fh:
    json.dump(dict(version=1, stretches=out), fh, separators=(',', ':'))
print('stretches_seed.json:', len(out), 'stretches,', sum(len(s['pipes']) for s in out), 'pipes,', round((OUT / 'stretches_seed.json').stat().st_size / 1e6, 1), 'MB')
