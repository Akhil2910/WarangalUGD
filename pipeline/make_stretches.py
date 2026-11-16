"""Split the DPR network into road stretches (the unit of field recording).

Rules:
  1. Chain pipe reaches through manholes where exactly two pipes meet (a continuous road run).
     Break at junctions (3+ pipes), dead ends, plants/stations, ward boundaries and catchment boundaries.
  2. Cap a stretch at 250 m: longer runs are cut into nearly equal pieces at manholes.
  3. Merge short dead-end stubs (< 30 m, ending at a dead end) into the longest stretch they join in the same ward
     (so a stretch can exceed 250 m by up to the length of its merged stubs).
  4. Code W<ward>-NNN, numbered within each ward in flow order (from the outlet upstream: lowest design line number first).
Every design pipe belongs to exactly one stretch.
Usage: python pipeline/make_stretches.py <project_root>
"""
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(sys.argv[1])
N = ROOT / 'work' / 'network'
CAP, STUB = 250.0, 30.0

feats = json.load(open(N / 'pipes.geojson', encoding='utf8'))['features']
P = {f['properties']['pipe_id']: f for f in feats}
inc = defaultdict(list)
for pid, f in P.items():
    p = f['properties']
    inc[p['from_mh']].append(pid)
    inc[p['to_mh']].append(pid)
station = {k for k in inc if '/STP' in k or '/SPS' in k or '/LIFT' in k or '/SEPT' in k}


def other(pid, node):
    p = P[pid]['properties']
    return p['to_mh'] if p['from_mh'] == node else p['from_mh']


def through(node, a, b):
    """Can a run continue through node from pipe a to pipe b?"""
    if len(inc[node]) != 2 or node in station:
        return False
    pa, pb = P[a]['properties'], P[b]['properties']
    return pa['ward'] == pb['ward'] and pa['catchment'] == pb['catchment']


# 1. chains
seen, runs = set(), []
for start in P:
    if start in seen:
        continue
    seen.add(start)
    chain = [start]
    for end_attr in ('from_mh', 'to_mh'):
        node, cur = P[start]['properties'][end_attr], start
        side = []
        while True:
            nxt = [q for q in inc[node] if q != cur]
            if len(nxt) != 1 or nxt[0] in seen or not through(node, cur, nxt[0]):
                break
            cur = nxt[0]
            seen.add(cur)
            side.append(cur)
            node = other(cur, node)
        chain = (list(reversed(side)) + chain) if end_attr == 'from_mh' else (chain + side)
    runs.append(chain)

# 2. cap length
L = lambda pid: P[pid]['properties']['length_m']
capped = []
for ch in runs:
    tot = sum(L(p) for p in ch)
    if tot <= CAP:
        capped.append(ch)
        continue
    k = int(-(-tot // CAP))
    target, cur, acc = tot / k, [], 0.0
    for p in ch:
        if cur and acc + L(p) / 2 > target:
            capped.append(cur)
            cur, acc = [], 0.0
        cur.append(p)
        acc += L(p)
    capped.append(cur)


# 3. stub merge
def ends(ch):
    nodes = Counter()
    for p in ch:
        nodes[P[p]['properties']['from_mh']] += 1
        nodes[P[p]['properties']['to_mh']] += 1
    return [n for n, c in nodes.items() if c == 1]


sid_of = {}
for i, ch in enumerate(capped):
    for p in ch:
        sid_of[p] = i
merged = 0
groups = {i: list(ch) for i, ch in enumerate(capped)}
for i, ch in list(groups.items()):
    if i not in groups or sum(L(p) for p in ch) >= STUB:
        continue
    e = ends(ch)
    dead = [n for n in e if len(inc[n]) == 1 and n not in station]
    joins = [n for n in e if len(inc[n]) >= 3]
    if not dead or not joins:
        continue
    ward = P[ch[0]]['properties']['ward']
    cands = {sid_of[q] for n in joins for q in inc[n] if sid_of[q] != i and P[q]['properties']['ward'] == ward}
    if not cands:
        continue
    tgt = max(cands, key=lambda s: sum(L(p) for p in groups[s]))
    groups[tgt].extend(ch)
    for p in ch:
        sid_of[p] = tgt
    del groups[i]
    merged += 1

# 4. codes and features
by_ward = defaultdict(list)
for sid, ch in groups.items():
    ward = Counter(P[p]['properties']['ward'] for p in ch).most_common(1)[0][0]
    order = min((P[p]['properties']['catchment'], int(P[p]['properties']['line_no'][3:])) for p in ch)
    by_ward[ward].append((order, sid))
out, rows = [], []
for ward in sorted(by_ward):
    lst = sorted(by_ward[ward])
    width = max(3, len(str(len(lst))))
    for n, (_, sid) in enumerate(lst, 1):
        ch = groups[sid]
        props = [P[p]['properties'] for p in ch]
        mhs = {x for q in props for x in (q['from_mh'], q['to_mh']) if x not in station}
        dia = Counter()
        for q in props:
            dia[q['dia_mm']] += q['length_m']
        code = f'W{ward}-{n:0{width}d}'
        rn = Counter(q['road_name'] for q in props if q['road_name']).most_common(1)
        sp = dict(code=code, ward=ward, admin_zone=props[0]['admin_zone'], sewer_zone=props[0]['sewer_zone'], catchment=props[0]['catchment'],
                  road_name=rn[0][0] if rn else '', length_m=round(sum(q['length_m'] for q in props), 2), pipes=len(ch), planned_manholes=len(mhs),
                  dia_m=json.dumps({str(k): round(v, 1) for k, v in sorted(dia.items())}), max_dia_mm=max(dia), max_depth_m=max(max(q['depth_up'] or 0, q['depth_dn'] or 0) for q in props),
                  outside_ward=any(q['outside_ward_m'] > 0 for q in props), stage='Not started')
        out.append(dict(type='Feature', properties=sp, geometry=dict(type='MultiLineString', coordinates=[P[p]['geometry']['coordinates'] for p in ch])))
        rows += [(code, p) for p in ch]
with open(N / 'stretches.geojson', 'w', encoding='utf8') as fh:
    json.dump(dict(type='FeatureCollection', features=out), fh, separators=(',', ':'))


def midpoint(f):
    """One label/badge point per stretch: the middle of its longest pipe."""
    parts = f['geometry']['coordinates']
    seg = max(parts, key=lambda c: sum(((c[i + 1][0] - c[i][0]) ** 2 + (c[i + 1][1] - c[i][1]) ** 2) ** .5 for i in range(len(c) - 1)))
    if len(seg) == 2:
        return [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2]
    return seg[len(seg) // 2]


points = [dict(type='Feature', properties=dict(code=f['properties']['code'], stage=f['properties']['stage']),
               geometry=dict(type='Point', coordinates=[round(v, 7) for v in midpoint(f)])) for f in out]
with open(N / 'stretch_points.geojson', 'w', encoding='utf8') as fh:
    json.dump(dict(type='FeatureCollection', features=points), fh, separators=(',', ':'))
with open(N / 'stretch_pipes.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['stretch', 'pipe_id'])
    w.writerows(rows)
lens = sorted(f['properties']['length_m'] for f in out)
assert len(rows) == len(P) == len(set(p for _, p in rows)), 'every pipe must be in exactly one stretch'
summary = dict(stretches=len(out), runs_before_cap=len(runs), after_cap=len(capped), stubs_merged=merged,
               length_m_p10=lens[len(lens) // 10], length_m_median=lens[len(lens) // 2], length_m_p90=lens[len(lens) * 9 // 10], length_m_max=lens[-1],
               with_road_name=sum(1 for f in out if f['properties']['road_name']), wards=len(by_ward),
               largest_ward=max(((w, len(v)) for w, v in by_ward.items()), key=lambda x: x[1]))
json.dump(summary, open(N / 'stretches_summary.json', 'w'), indent=1)
print(json.dumps(summary, indent=1))
