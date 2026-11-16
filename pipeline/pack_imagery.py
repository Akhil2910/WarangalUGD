"""Pack a gdal2tiles XYZ folder (z/x/y.webp) into one PMTiles file for HTTP Range serving.
Usage: python pipeline/pack_imagery.py <tiles_dir> <out.pmtiles> [attribution]"""
import sys
from pathlib import Path
from pmtiles.tile import zxy_to_tileid, TileType, Compression
from pmtiles.writer import Writer
from pyproj import Transformer

src, out = Path(sys.argv[1]), Path(sys.argv[2])
attribution = sys.argv[3] if len(sys.argv) > 3 else ''
tiles = []
for zdir in src.iterdir():
    if not zdir.name.isdigit():
        continue
    z = int(zdir.name)
    for xdir in zdir.iterdir():
        x = int(xdir.name)
        for f in xdir.glob('*.webp'):
            tiles.append((zxy_to_tileid(z, x, int(f.stem)), f, z, x, int(f.stem)))
tiles.sort()
zs = sorted({t[2] for t in tiles})
maxz = max(zs)
xs = [t[3] for t in tiles if t[2] == maxz]
ys = [t[4] for t in tiles if t[2] == maxz]
import math
def lon(x, z): return x / 2 ** z * 360 - 180
def lat(y, z): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))
W, E, N, S = lon(min(xs), maxz), lon(max(xs) + 1, maxz), lat(min(ys), maxz), lat(max(ys) + 1, maxz)
tmp = out.with_suffix('.pmtiles.tmp')
with open(tmp, 'wb') as fh:
    w = Writer(fh)
    for i, (tid, f, *_ ) in enumerate(tiles):
        w.write_tile(tid, f.read_bytes())
    w.finalize(
        {
            'tile_type': TileType.WEBP, 'tile_compression': Compression.NONE,
            'min_zoom': min(zs), 'max_zoom': maxz,
            'min_lon_e7': int(W * 1e7), 'min_lat_e7': int(S * 1e7), 'max_lon_e7': int(E * 1e7), 'max_lat_e7': int(N * 1e7),
            'center_zoom': 14, 'center_lon_e7': int((W + E) / 2 * 1e7), 'center_lat_e7': int((N + S) / 2 * 1e7),
        },
        {'name': 'GWMC satellite imagery', 'attribution': attribution, 'type': 'baselayer', 'format': 'webp'},
    )
tmp.replace(out)
print(f'{len(tiles)} tiles, zoom {min(zs)}-{maxz}, {out.stat().st_size / 1e9:.2f} GB -> {out}')
