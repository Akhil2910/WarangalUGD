"""Write app-data/utility_drains.geojson: the existing drains from the GWMC base map (Drainage_Network.kml),
shown read-only in the Utilities layers. Usage: python pipeline/publish_utilities.py <project_root>"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from lib_inputs import read_kml

ROOT = Path(sys.argv[1])
src = ROOT / 'inputs' / 'Warangal_KML' / 'Warangal_KML' / 'Drainage_Network.kml'
feats = []
for attrs, geoms in read_kml(src):
    for tag, pts in geoms:
        if tag != 'LineString' or len(pts) < 2:
            continue
        props = {k: v for k, v in attrs.items() if v}
        feats.append({'type': 'Feature', 'properties': props, 'geometry': {'type': 'LineString', 'coordinates': [[round(x, 6), round(y, 6)] for x, y in pts]}})
out = ROOT / 'app-data' / 'utility_drains.geojson'
json.dump({'type': 'FeatureCollection', 'features': feats}, open(out, 'w', encoding='utf8'), separators=(',', ':'))
print('utility_drains.geojson:', len(feats), 'lines,', round(out.stat().st_size / 1e6, 1), 'MB; fields:', sorted({k for f in feats for k in f['properties']})[:12])
