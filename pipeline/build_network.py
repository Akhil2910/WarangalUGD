"""Build the DPR sewer network for the app from the original inputs.

Inputs (unchanged, under inputs/):
  UGSS_Files/<zone>/.../Co*.shp + MH*.shp + STP/SPS points   GIS geometry (UTM 44N)
  Design & Estimate of UGD Warangal/Sewer Network Design/*.docx  design tables (authoritative attributes)
  UGSS_Files/Extra Data/Ward_Boundary.shp, Zone_Boundary.shp
  Warangal_KML/Warangal_KML/Zone Boundary.kml, Drainage_Network.kml

Outputs (work/network/, GeoJSON in EPSG:4326 plus CSV reports):
  pipes, manholes, stations, gis_not_in_design, dpr_gis_original, wards, admin_zones, sewer_zones
Run:  python pipeline/build_network.py <project_root>
"""
import csv
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, MultiPolygon, mapping
from shapely.strtree import STRtree
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
from lib_inputs import read_layer, read_design_docx, read_kml, catchment_code, norm_catchment  # noqa: E402

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parents[1])
INP = ROOT / 'inputs'
UG = INP / 'UGSS_Files'
DESIGN_DIR = INP / 'Design & Estimate of UGD Warangal' / 'Sewer Network Design'
KMLDIR = INP / 'Warangal_KML' / 'Warangal_KML'
OUT = ROOT / 'work' / 'network'
OUT.mkdir(parents=True, exist_ok=True)

to_wgs = Transformer.from_crs(32644, 4326, always_xy=True).transform
to_utm = Transformer.from_crs(4326, 32644, always_xy=True).transform
SNAP = 0.1  # m, endpoint key precision

ZONE_FILES = {'Zone-1': 'Zone -1 Design.docx', 'Zone-2': 'Zone -2 Design.docx', 'Zone-3,4': 'Zone -3&4 Design.docx',
              'Zone-5': 'Zone -5 Design.docx', 'Zone-6': 'Zone -6 Design.docx', 'Zone-7': 'Zone -7 Design.docx'}
SEWER_ZONE_NAME = {'Zone-1': '1', 'Zone-2': '2', 'Zone-3,4': '3&4', 'Zone-5': '5', 'Zone-6': '6', 'Zone-7': '7'}


def key(p):
    return (round(p[0] / SNAP), round(p[1] / SNAP))


def material(d):
    return 'DWC' if d <= 300 else 'RCC NP4'


def dia_class(d):
    return 'Lateral (150-200 mm)' if d <= 200 else 'Sub-main (250-450 mm)' if d <= 450 else 'Trunk main (500 mm+)'


def wgs_coords(xy):
    return [tuple(round(v, 7) for v in to_wgs(x, y)) for x, y in xy]


def write_geojson(name, feats):
    with open(OUT / f'{name}.geojson', 'w', encoding='utf8') as fh:
        fh.write('{"type":"FeatureCollection","features":[\n')
        for i, f in enumerate(feats):
            fh.write((',\n' if i else '') + json.dumps(f, ensure_ascii=False, separators=(',', ':')))
        fh.write('\n]}\n')
    print(f'  wrote {name}: {len(feats)} features')


log = []


def note(msg):
    print(msg)
    log.append(msg)


# ------------------------------------------------------------------ 1. GIS lines and manhole points
gis = []          # one per GIS line
mh_at = defaultdict(lambda: defaultdict(set))   # part_id -> endpoint key -> {MH labels}
stations = []
for shp in sorted(UG.rglob('*.shp')):
    zone = shp.relative_to(UG).parts[0]
    if zone not in ZONE_FILES:
        continue
    part_id = str(shp.parent.relative_to(UG)).replace('\\', '/')
    stem = shp.stem.lower()
    if re.fullmatch(r'co(_combined)?', stem):
        for i, (a, g) in enumerate(read_layer(shp)):
            xy = [p for part in g for p in part]
            gis.append(dict(gid=len(gis), zone=zone, part=part_id, idx=i, label=a['LABEL'], gis_dia=int(a['D']), xy=xy,
                            length=LineString(xy).length))
    elif re.fullmatch(r'mh(_combined)?', stem):
        for a, g in read_layer(shp):
            mh_at[part_id][key(g)].add(a['LABEL'].upper())
    else:  # plants, stations, septic tanks, lift stations
        for a, g in read_layer(shp):
            if g is None:
                continue
            pt = g if isinstance(g, tuple) else g[0][0]
            stations.append(dict(label=a['LABEL'], zone=zone, part=part_id, xy=pt))
note(f'GIS: {len(gis)} pipe lines, {sum(len(v) for p in mh_at.values() for v in p.values())} manhole labels, {len(stations)} station points')

# ------------------------------------------------------------------ 2. design tables
design = []
for zone, fn in ZONE_FILES.items():
    for d in read_design_docx(DESIGN_DIR / fn):
        d['zone'] = zone
        d['did'] = len(design)
        d['from_mh'] = d['from_mh'].upper()
        d['to_mh'] = d['to_mh'].upper()
        design.append(d)
note(f'Design tables: {len(design)} reaches, {sum(d["length"] for d in design) / 1000:.2f} km, '
     f'{len({d["catchment"] for d in design})} catchments')

# ------------------------------------------------------------------ 3. match GIS lines to design rows
by_label = defaultdict(list)
for d in design:
    by_label[(d['zone'], d['co'])].append(d)
pairs = []
for g in gis:
    s_labels = mh_at[g['part']].get(key(g['xy'][0]), set())
    e_labels = mh_at[g['part']].get(key(g['xy'][-1]), set())
    for d in by_label.get((g['zone'], g['label']), []):
        fwd = (d['from_mh'] in s_labels) + (d['to_mh'] in e_labels)
        rev = (d['from_mh'] in e_labels) + (d['to_mh'] in s_labels)
        mh_score = max(fwd, rev)
        len_ok = abs(d['length'] - g['length']) <= max(1.0, 0.02 * g['length'])
        score = 2 * mh_score + (2 if len_ok else 0) + (0.5 if d['dia'] == g['gis_dia'] else 0)
        if mh_score >= 1 or len_ok:
            pairs.append((score, -abs(d['length'] - g['length']), g['gid'], d['did'], rev > fwd))
pairs.sort(reverse=True)
g_used, d_used = {}, {}
for score, _, gid, did, reverse in pairs:
    if gid in g_used or did in d_used:
        continue
    g_used[gid] = (did, reverse, score)
    d_used[did] = gid
note(f'Matched {len(d_used)} of {len(design)} design reaches to GIS lines; '
     f'{len(gis) - len(g_used)} GIS lines ({sum(g["length"] for g in gis if g["gid"] not in g_used) / 1000:.1f} km) not in design')
sc = Counter(round(v[2]) for v in g_used.values())
note(f'  match strength (2 per manhole label found at the right end, 2 for length within 2%, 0.5 same diameter): {sorted(sc.items())}')

# ------------------------------------------------------------------ 4. pipes (design attributes, GIS geometry oriented along flow)
pipes = []
mh_obs = defaultdict(list)   # (catchment, MH) -> [(x, y, role, il, gl, depth)]
for d in design:
    gid = d_used.get(d['did'])
    if gid is None:
        continue
    g = gis[gid]
    xy = list(reversed(g['xy'])) if g_used[gid][1] else list(g['xy'])
    p = dict(d, xy=xy, gis_len=g['length'], gis_dia=g['gis_dia'], gis_part=g['part'], gis_label=g['label'], geom_source='GIS line')
    pipes.append(p)
    c = d['catchment']
    mh_obs[(c, d['from_mh'])].append((xy[0], 'up', d['il_up'], d['gl_up'], d['depth_up']))
    mh_obs[(c, d['to_mh'])].append((xy[-1], 'dn', d['il_dn'], d['gl_dn'], d['depth_dn']))

# design reaches without a GIS line: draw between their manholes if both are known
missing = [d for d in design if d['did'] not in d_used]
drawn = 0
for d in missing:
    a, b = mh_obs.get((d['catchment'], d['from_mh'])), mh_obs.get((d['catchment'], d['to_mh']))
    if a and b:
        xy = [a[0][0], b[0][0]]
        pipes.append(dict(d, xy=xy, gis_len=math.dist(*xy), gis_dia=None, gis_part='', gis_label='', geom_source='Straight line between manholes'))
        mh_obs[(d['catchment'], d['from_mh'])].append((xy[0], 'up', d['il_up'], d['gl_up'], d['depth_up']))
        mh_obs[(d['catchment'], d['to_mh'])].append((xy[1], 'dn', d['il_dn'], d['gl_dn'], d['depth_dn']))
        drawn += 1
no_geom = [d for d in missing if not (mh_obs.get((d['catchment'], d['from_mh'])) and mh_obs.get((d['catchment'], d['to_mh'])))]
note(f'Design reaches without GIS line: {len(missing)}; drawn straight between known manholes: {drawn}; still without geometry: {len(no_geom)}')
with open(OUT / 'design_reaches_without_geometry.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['catchment', 'line', 'from', 'to', 'length_m', 'dia_mm'])
    for d in no_geom:
        w.writerow([d['catchment'], d['co'], d['from_mh'], d['to_mh'], d['length'], d['dia']])

# ------------------------------------------------------------------ 5. manholes
STATION_RE = re.compile(r'^(STP|SPS|LIFT|SEPT)')
manholes = {}
pos_conflicts = 0
for (c, mh), obs in mh_obs.items():
    xs = [o[0] for o in obs]
    cx, cy = sum(x for x, _ in xs) / len(xs), sum(y for _, y in xs) / len(xs)
    spread = max(math.dist((cx, cy), x) for x in xs)
    if spread > 1.0:
        pos_conflicts += 1
    ils = [o[2] for o in obs if o[2] is not None]
    gls = [o[3] for o in obs if o[3] is not None]
    deps = [o[4] for o in obs if o[4] is not None]
    manholes[(c, mh)] = dict(catchment=c, label=mh, xy=(cx, cy), il=min(ils) if ils else None, gl=Counter(gls).most_common(1)[0][0] if gls else None,
                             depth=max(deps) if deps else None, n_pipes=len(obs), position_spread_m=round(spread, 2),
                             is_terminal=bool(STATION_RE.match(mh)))
note(f'Manholes (distinct catchment+number, incl. plant/station inlets): {len(manholes)}; '
     f'with positions disagreeing by >1 m: {pos_conflicts}')

# ------------------------------------------------------------------ 6. boundaries
wards = []
for a, g in read_layer(UG / 'Extra Data' / 'Ward_Boundary.shp'):
    poly = unary_union([Polygon(r).buffer(0) for r in g])
    wards.append(dict(ward=int(a['WARD_NO']), corporator=a['Corporator'], pop2011=int(a['Pop_2011'] or 0), density_class=a['Zone'], geom=poly))
admin = []
for a, gs in read_kml(KMLDIR / 'Zone Boundary.kml'):
    polys = [Polygon([to_utm(*p) for p in pts]).buffer(0) for t, pts in gs if t == 'Polygon']
    admin.append(dict(zone_id=a['ZONE_ID'], name=a['ZONE_NAME'], no=int(a['ZONE_NO']), geom=unary_union(polys)))
for w in wards:
    best = max(admin, key=lambda z: z['geom'].intersection(w['geom']).area)
    w['admin_zone'] = best['zone_id']
    w['admin_zone_share'] = round(best['geom'].intersection(w['geom']).area / w['geom'].area, 3)
note('Ward -> GWMC admin zone (by largest overlap); wards split across zones (<95% in one): '
     + str([(w['ward'], w['admin_zone'], w['admin_zone_share']) for w in wards if w['admin_zone_share'] < 0.95]))
sewer_zones = []
for a, g in read_layer(UG / 'Extra Data' / 'Zone_Boundary.shp'):
    sewer_zones.append(dict(name=a['Name'], geom=unary_union([Polygon(r).buffer(0) for r in g])))

wtree = STRtree([w['geom'] for w in wards])


def ward_of(pt):
    P = Point(pt)
    hits = [i for i in wtree.query(P) if wards[i]['geom'].covers(P)]
    if hits:
        return wards[hits[0]], 0.0
    i = wtree.nearest(P)
    return wards[i], wards[i]['geom'].distance(P)


# road names from the GWMC drains layer
drains, dnames = [], []
for a, gs in read_kml(KMLDIR / 'Drainage_Network.kml'):
    for t, pts in gs:
        if t == 'LineString' and len(pts) > 1 and a.get('RD_NAME'):
            drains.append(LineString([to_utm(*p) for p in pts]))
            dnames.append(a['RD_NAME'])
dtree = STRtree(drains)


def road_name(line):
    mid = line.interpolate(0.5, normalized=True)
    best, bd = None, 15.0
    for i in dtree.query(mid.buffer(15)):
        dd = drains[i].distance(mid)
        if dd < bd:
            best, bd = dnames[i], dd
    return best or ''


# ------------------------------------------------------------------ 7. features
feats, totals = [], defaultdict(lambda: defaultdict(float))
mh_code = {k: f"{catchment_code(k[0])}/{k[1]}" for k in manholes}
for i, p in enumerate(sorted(pipes, key=lambda p: (p['zone'], p['catchment'], int(p['co'][3:])))):
    line = LineString(p['xy'])
    w, dist = ward_of(line.interpolate(0.5, normalized=True))
    p['ward'], p['outside'] = w['ward'], dist
    fr, to = mh_code[(p['catchment'], p['from_mh'])], mh_code[(p['catchment'], p['to_mh'])]
    props = dict(pipe_id=f'P{i + 1:06d}', catchment=p['catchment'], sewer_zone=SEWER_ZONE_NAME[p['zone']], line_no=p['co'],
                 from_mh=fr, to_mh=to, dia_mm=p['dia'], dia_class=dia_class(p['dia']), material=material(p['dia']),
                 length_m=round(p['length'], 2), drawn_length_m=round(p['gis_len'], 2), slope_1_in=p['slope_1_in'], flow_lps=p['flow_lps'],
                 il_up=p['il_up'], il_dn=p['il_dn'], gl_up=p['gl_up'], gl_dn=p['gl_dn'], depth_up=p['depth_up'], depth_dn=p['depth_dn'],
                 ward=w['ward'], admin_zone=w['admin_zone'], outside_ward_m=round(dist, 1), road_name=road_name(line),
                 gis_dia_mm=p['gis_dia'], dia_changed_from_gis=bool(p['gis_dia'] and p['gis_dia'] != p['dia']),
                 geom_source=p['geom_source'], gis_file=p['gis_part'])
    feats.append(dict(type='Feature', properties=props, geometry=dict(type='LineString', coordinates=wgs_coords(p['xy']))))
    for k in ('all', f"dia:{p['dia']}", f"class:{dia_class(p['dia'])}", f"catch:{p['catchment']}", f"szone:{SEWER_ZONE_NAME[p['zone']]}",
              f"ward:{w['ward']}", f"azone:{w['admin_zone']}"):
        totals[k]['km'] += p['length'] / 1000
        totals[k]['reaches'] += 1
write_geojson('pipes', feats)

mh_feats = []
for k, m in sorted(manholes.items(), key=lambda kv: mh_code[kv[0]]):
    w, dist = ward_of(m['xy'])
    mh_feats.append(dict(type='Feature', geometry=dict(type='Point', coordinates=wgs_coords([m['xy']])[0]),
                         properties=dict(mh_code=mh_code[k], dpr_label=m['label'], catchment=m['catchment'], number_generated=False,
                                         gl=m['gl'], il=m['il'], depth=m['depth'], pipes=m['n_pipes'], is_station_inlet=m['is_terminal'],
                                         ward=w['ward'], admin_zone=w['admin_zone'], outside_ward_m=round(dist, 1),
                                         position_spread_m=m['position_spread_m'])))
    if not m['is_terminal']:
        totals['all']['manholes'] += 1
        totals[f"ward:{w['ward']}"]['manholes'] += 1
        totals[f"catch:{m['catchment']}"]['manholes'] += 1
write_geojson('manholes', mh_feats)

st_feats = []
seen = set()
for s in stations:
    lab = re.sub(r'\s+', ' ', s['label'].strip().upper()).replace('SEPTIK', 'SEPTIC')
    kind = 'STP' if lab.startswith('STP') else 'Lift station' if lab.startswith('LIFT') else 'Septic tank' if lab.startswith('SEPTIC') else 'SPS'
    k = (lab, round(s['xy'][0]), round(s['xy'][1]))
    if k in seen:
        continue
    seen.add(k)
    w, dist = ward_of(s['xy'])
    st_feats.append(dict(type='Feature', geometry=dict(type='Point', coordinates=wgs_coords([s['xy']])[0]),
                         properties=dict(label=lab, kind=kind, sewer_zone=SEWER_ZONE_NAME[s['zone']], ward=w['ward'], admin_zone=w['admin_zone'])))
write_geojson('stations', st_feats)

orig, dropped = [], []
for g in gis:
    props = dict(gis_file=g['part'], label=g['label'], gis_dia_mm=g['gis_dia'], drawn_length_m=round(g['length'], 2),
                 in_final_design=g['gid'] in g_used)
    f = dict(type='Feature', properties=props, geometry=dict(type='LineString', coordinates=wgs_coords(g['xy'])))
    orig.append(f)
    if g['gid'] not in g_used:
        dropped.append(f)
write_geojson('dpr_gis_original', orig)
write_geojson('gis_not_in_design', dropped)


def poly_feat(geom, props):
    return dict(type='Feature', properties=props, geometry=json.loads(json.dumps(mapping(
        __import__('shapely.ops', fromlist=['transform']).transform(lambda x, y, z=None: to_wgs(x, y), geom)))))


write_geojson('wards', [poly_feat(w['geom'], dict(ward=w['ward'], name=f"Ward {w['ward']}", corporator=w['corporator'], pop2011=w['pop2011'],
                                                  density_class=w['density_class'], admin_zone=w['admin_zone'])) for w in wards])
write_geojson('admin_zones', [poly_feat(z['geom'], dict(zone_id=z['zone_id'], name=z['name'])) for z in admin])
write_geojson('sewer_zones', [poly_feat(z['geom'], dict(name=z['name'].replace('ZONE_', 'Sewer zone '))) for z in sewer_zones])

# ------------------------------------------------------------------ 8. totals
with open(OUT / 'plan_totals.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['group', 'value', 'reaches', 'km', 'manholes'])
    for k in sorted(totals, key=lambda s: (s.split(':')[0], (int(s.split(':')[1]) if s.split(':')[-1].isdigit() else 0), s)):
        g, _, v = k.partition(':')
        w.writerow([g, v, int(totals[k]['reaches']), round(totals[k]['km'], 3), int(totals[k]['manholes'])])
with open(OUT / 'ward_admin_zone.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['ward', 'admin_zone', 'share_in_zone', 'corporator', 'pop2011'])
    for x in sorted(wards, key=lambda x: x['ward']):
        w.writerow([x['ward'], x['admin_zone'], x['admin_zone_share'], x['corporator'], x['pop2011']])
note(f"Plan: {totals['all']['reaches']:.0f} reaches, {totals['all']['km']:.2f} km, {totals['all']['manholes']:.0f} manholes; "
     f"outside ward outlines: {sum(1 for p in pipes if p['outside'] > 0)} pipes")
(OUT / 'build_log.txt').write_text('\n'.join(log), encoding='utf8')
