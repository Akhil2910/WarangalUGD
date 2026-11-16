"""Turn the 'Stage-wise Checklist' sheet of UGD_Compliance_Stagewise.xlsx into app/server/seed/compliance_items.json,
the starting compliance list (version 1 of each item). The Commissioner edits the list in the app afterwards.
Usage: python pipeline/compliance_seed.py <project_root>"""
import json, re, sys
from pathlib import Path
import openpyxl

ROOT = Path(sys.argv[1])
ws = openpyxl.load_workbook(ROOT / 'inputs' / 'UGD_Compliance_Stagewise.xlsx', read_only=True, data_only=True)['Stage-wise Checklist']
STAGE_KEY = {1: 'before_cutting', 2: 'trench_open', 3: 'pipe_laying', 4: 'after_pipe_laying', 5: 'before_backfill',
             6: 'after_backfill', 7: 'before_restoration', 8: 'after_restoration', 9: 'at_completion'}
ROAD = {'CC (cement concrete)': 'cc'}
items = []
for r in ws.iter_rows(min_row=5, max_row=40, values_only=True):
    if not r or not isinstance(r[0], int):
        continue
    (stage_no, _stage, _due, _guards, sl, key, name, desc, cat, roads, other, per, _ev, photo, doc, date, ref,
     value_label, unit, rule, repeat, mandatory, severity, gate, _gd, grace, recorded_by, _ver) = r[:28]
    per_key = 'stretch' if per.startswith('Whole') else 'reach' if 'reach' in per else 'manhole'
    rule_s = str(rule or '')
    pass_rule = None
    if m := re.match(r'At least ([\d.]+)', rule_s):
        pass_rule = {'op': '>=', 'value': float(m.group(1))}
    elif m := re.match(r'Within .([\d.]+) m of the design', rule_s):
        pass_rule = {'op': 'design_within', 'value': float(m.group(1))}
    applies = {}
    if roads != 'All road types':
        applies['road_types'] = [ROAD[x.strip()] for x in str(roads).split(',')]
    if other and 'depth' in str(other):
        applies['min_depth_m'] = 1.5
    if per_key != 'stretch':
        applies['unit_min_dia_mm'] = 250  # reaches/manholes on 250 mm+ one by one; smaller ones together
    evidence = [k for k, v in (('photo', photo), ('document', doc), ('date', date), ('reference', ref)) if v == 'Yes']
    if value_label and value_label not in ('—', '–') and len(str(value_label)) > 2:
        evidence.append('value')
    automatic = str(recorded_by).startswith('Automatic')
    items.append(dict(
        key=key, sort=sl, name=name, description=desc, category=cat, due_at=STAGE_KEY[stage_no], applies=applies,
        per=per_key, evidence=evidence or ['reference', 'document'] if automatic else evidence or ['photo'],
        value_label=value_label if 'value' in evidence else None, unit=unit if 'value' in evidence else None,
        pass_rule=pass_rule, recurring_days=int(repeat) if isinstance(repeat, (int, float)) else None,
        mandatory=mandatory == 'Yes', severity=severity.lower(), gate=gate.lower(), grace_days=int(grace),
    ))
out = ROOT / 'app' / 'server' / 'seed' / 'compliance_items.json'
json.dump(dict(source='UGD_Compliance_Stagewise.xlsx, sheet Stage-wise Checklist', items=items), open(out, 'w', encoding='utf8'), indent=1, ensure_ascii=False)
print(len(items), 'items ->', out)
for i in items:
    print(i['sort'], i['key'], i['due_at'], i['per'], i['evidence'], i['pass_rule'], i['recurring_days'], i['gate'], i['applies'])
