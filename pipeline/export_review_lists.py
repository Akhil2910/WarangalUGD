"""Write the map-phase review lists and copy the control-point sheets into docs/map-phase/.
Usage: python pipeline/export_review_lists.py <project_root>"""
import csv, json, shutil, sys
from pathlib import Path

ROOT = Path(sys.argv[1]); N = ROOT / 'work' / 'network'; A = ROOT / 'work' / 'alignment'
OUT = ROOT / 'docs' / 'map-phase'; (OUT / 'control-points').mkdir(parents=True, exist_ok=True)
stretch_of = {r['pipe_id']: r['stretch'] for r in csv.DictReader(open(N / 'stretch_pipes.csv'))}
pipes = [f for f in json.load(open(N / 'pipes.geojson', encoding='utf8'))['features']]


def mid(f):
    c = f['geometry']['coordinates']
    return round(c[len(c) // 2][1], 6), round(c[len(c) // 2][0], 6)


def write(name, header, rows):
    with open(OUT / name, 'w', newline='', encoding='utf8') as fh:
        w = csv.writer(fh); w.writerow(header); w.writerows(rows)
    print(f'{name}: {len(rows)} rows')


shutil.copy2(N / 'crossings_water.csv', OUT / 'crossings_water.csv')
# SPS-2/A review: manholes with spread positions, reaches with length mismatch
mh = [f['properties'] for f in json.load(open(N / 'manholes.geojson', encoding='utf8'))['features'] if f['properties']['position_spread_m'] > 1]
rows = [['manhole', m['mh_code'], m['catchment'], m['ward'], f"pipe ends {m['position_spread_m']} m apart", '', ''] for m in mh]
for f in pipes:
    p = f['properties']
    if abs(p['length_m'] - p['drawn_length_m']) > max(1, 0.02 * p['length_m']):
        lat, lon = mid(f)
        rows.append(['pipe', p['pipe_id'], p['catchment'], p['ward'], f"{p['line_no']}: design {p['length_m']} m, drawn {p['drawn_length_m']} m", lat, lon])
write('review_length_and_position.csv', ['type', 'id', 'catchment', 'ward', 'issue', 'lat', 'lon'], rows)
write('design_vs_gis_diameter.csv', ['pipe_id', 'stretch', 'catchment', 'line_no', 'gis_dia_mm', 'design_dia_mm', 'ward', 'lat', 'lon'],
      [[p['pipe_id'], stretch_of[p['pipe_id']], p['catchment'], p['line_no'], p['gis_dia_mm'], p['dia_mm'], p['ward'], *mid(f)]
       for f in pipes for p in [f['properties']] if p['dia_changed_from_gis']])
write('outside_wards.csv', ['pipe_id', 'stretch', 'catchment', 'line_no', 'assigned_ward', 'metres_outside', 'lat', 'lon'],
      [[p['pipe_id'], stretch_of[p['pipe_id']], p['catchment'], p['line_no'], p['ward'], p['outside_ward_m'], *mid(f)]
       for f in pipes for p in [f['properties']] if p['outside_ward_m'] > 0])
nd = json.load(open(N / 'gis_not_in_design.geojson', encoding='utf8'))['features']
write('gis_not_in_design.csv', ['gis_file', 'label', 'gis_dia_mm', 'drawn_length_m', 'lat', 'lon'],
      [[f['properties']['gis_file'], f['properties']['label'], f['properties']['gis_dia_mm'], f['properties']['drawn_length_m'], *mid(f)] for f in nd])
for f in A.glob('cp_sheet_*.jpg'):
    shutil.copy2(f, OUT / 'control-points' / f.name)
shutil.copy2(A / 'control_points.csv', OUT / 'control-points' / 'control_points.csv')
shutil.copy2(A / 'control_points_summary.json', OUT / 'control-points' / 'control_points_summary.json')
for f in ('plan_totals.csv', 'ward_admin_zone.csv', 'stretches_summary.json'):
    shutil.copy2(N / f, OUT / f)
