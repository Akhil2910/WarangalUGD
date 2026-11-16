"""Readers for the Warangal input files (shapefiles without .shx, design .docx tables, KML).

Pure-Python readers so that every input can be read even when an index file (.shx) is missing.
All coordinates are returned as they are stored in the file.
"""
import re
import struct
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
KML = '{http://www.opengis.net/kml/2.2}'


def read_shp(path):
    """Return (shape_type, [geometry]) where geometry is (x, y) for points or [[(x, y), ...] per part]."""
    b = Path(path).read_bytes()
    shape_type = struct.unpack('<i', b[32:36])[0]
    o, out = 100, []
    while o + 8 <= len(b):
        _, clen = struct.unpack('>ii', b[o:o + 8])
        r = b[o + 8:o + 8 + clen * 2]
        o += 8 + clen * 2
        t = struct.unpack('<i', r[:4])[0]
        if t == 0:
            out.append(None)
        elif t in (1, 11, 21):
            out.append(struct.unpack('<dd', r[4:20]))
        else:
            nparts, npts = struct.unpack('<ii', r[36:44])
            s = 44 + 4 * nparts
            parts = list(struct.unpack(f'<{nparts}i', r[44:s])) + [npts]
            pts = struct.unpack(f'<{2 * npts}d', r[s:s + 16 * npts])
            xy = list(zip(pts[0::2], pts[1::2]))
            out.append([xy[parts[k]:parts[k + 1]] for k in range(nparts)])
    return shape_type, out


def read_dbf(path):
    b = Path(path).read_bytes()
    n, hl, rl = struct.unpack('<IHH', b[4:12])
    fields, o = [], 32
    while b[o] != 0x0D:
        fields.append((b[o:o + 11].split(b'\0')[0].decode('latin1'), chr(b[o + 11]), b[o + 16]))
        o += 32
    rows = []
    for i in range(n):
        rec = b[hl + i * rl:hl + (i + 1) * rl]
        if rec[:1] == b'*':
            continue
        pos, d = 1, {}
        for name, typ, ln in fields:
            v = rec[pos:pos + ln].decode('latin1').strip()
            if typ in 'NF':
                try:
                    v = float(v)
                except ValueError:
                    v = None
            d[name] = v
            pos += ln
        rows.append(d)
    return rows


def read_layer(shp_path):
    """Shapefile -> list of (attributes, geometry)."""
    shp_path = Path(shp_path)
    _, geoms = read_shp(shp_path)
    attrs = read_dbf(shp_path.with_suffix('.dbf'))
    return list(zip(attrs, geoms))


DESIGN_COLS = ['catchment', 'co', 'from_mh', 'to_mh', 'length', 'flow_lps', 'dia', 'slope_1_in', 'vf', 'qf', 'va', 'd_by_D',
               'il_up', 'il_dn', 'gl_up', 'gl_dn', 'depth_up', 'depth_dn', 'depth_avg', 'depth_round']


def read_design_docx(path):
    """Yield design rows (dict) from every table of a 'Zone -X Design.docx'."""
    with zipfile.ZipFile(path) as z, z.open('word/document.xml') as fh:
        for ev, el in ET.iterparse(fh, events=('end',)):
            if el.tag != W + 'tr':
                continue
            cells = [''.join(t.text or '' for t in tc.iter(W + 't')).strip() for tc in el.findall(W + 'tc')]
            el.clear()
            if len(cells) >= 20 and cells[1].startswith('CO-'):
                d = dict(zip(DESIGN_COLS, cells[:20]))
                try:
                    for k in ('length', 'flow_lps', 'vf', 'qf', 'va', 'il_up', 'il_dn', 'gl_up', 'gl_dn', 'depth_up', 'depth_dn', 'depth_avg', 'depth_round'):
                        d[k] = float(d[k]) if d[k] not in ('', '(N/A)') else None
                    d['dia'] = int(float(d['dia']))
                except ValueError:
                    continue
                d['catchment'] = norm_catchment(d['catchment'])
                yield d


def norm_catchment(s):
    s = s.strip().upper().replace(' ', '')
    s = s.replace('STP-3&4', 'STP-3&4')
    return s


def catchment_code(c):
    """Short code used in manhole numbers: 'SPS-2/C' -> 'SPS-2C', 'STP-3&4' -> 'STP-34'."""
    return c.replace('/', '').replace('&', '')


def read_kml(path):
    """Yield (attributes, geometry_type, coords) per placemark; coords are lon/lat lists (per part)."""
    for ev, el in ET.iterparse(path, events=('end',)):
        if el.tag != KML + 'Placemark':
            continue
        attrs = {sd.get('name'): (sd.text or '').strip() for sd in el.iter(KML + 'SimpleData')}
        geoms = []
        for tag in ('Point', 'LineString', 'Polygon'):
            for g in el.iter(KML + tag):
                c = g.find(f'{KML}outerBoundaryIs/{KML}LinearRing/{KML}coordinates') if tag == 'Polygon' else g.find(KML + 'coordinates')
                pts = [tuple(map(float, p.split(',')[:2])) for p in c.text.split()]
                geoms.append((tag, pts))
        el.clear()
        yield attrs, geoms
