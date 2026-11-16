"""Make the white margin around the purchased satellite image see-through, so the map's surroundings show.

The vendor filled everything outside the purchased area with solid white. This finds the purchased area
(the non-white part at zoom 12, holes filled, shrunk by 2 pixels) and, in every tile, turns near-white
pixels OUTSIDE that area transparent. Real image pixels are never changed; tiles fully inside are copied as they are.

Usage: python pipeline/clear_imagery_margin.py <in.pmtiles> <out.pmtiles>
"""
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import zxy_to_tileid
from pmtiles.writer import Writer
from scipy import ndimage

src, out = Path(sys.argv[1]), Path(sys.argv[2])
REF_Z = 12
WHITE = 240  # all three channels at or above this = white margin

with open(src, 'rb') as fh:
    reader = Reader(MmapSource(fh))
    header, meta = reader.header(), reader.metadata()
    get = MmapSource(fh)

    # 1) the purchased area at zoom 12
    ref = {(x, y): d for (z, x, y), d in all_tiles(get) if z == REF_Z}
    xs, ys = [k[0] for k in ref], [k[1] for k in ref]
    X0, Y0 = min(xs), min(ys)
    W, H = (max(xs) - X0 + 1) * 256, (max(ys) - Y0 + 1) * 256
    rgb = np.full((H, W, 4), 0, np.uint8)
    for (x, y), d in ref.items():
        rgb[(y - Y0) * 256:(y - Y0 + 1) * 256, (x - X0) * 256:(x - X0 + 1) * 256] = np.asarray(Image.open(io.BytesIO(d)).convert('RGBA'))
    real = (rgb[..., 3] > 0) & (rgb[..., :3].min(axis=2) < WHITE)
    real = ndimage.binary_closing(real, iterations=3)
    real = ndimage.binary_fill_holes(real)
    # keep the big piece(s) only
    lab, n = ndimage.label(real)
    sizes = ndimage.sum(real, lab, range(1, n + 1))
    real = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 2000])
    inside = ndimage.binary_erosion(real, iterations=2)
    print(f'purchased area: {inside.sum() * (38.2 ** 2) / 1e6:.0f} sq km (approx), grid {W}x{H} at zoom {REF_Z}')

    def footprint(z, x, y):
        """Inside-mask for one tile, 256 x 256, from the zoom-12 grid."""
        k = 2 ** (REF_Z - z)  # zoom-12 pixels per tile pixel (may be < 1 above zoom 12)
        gx = (x * 256 + np.arange(256) + 0.5) * k - X0 * 256
        gy = (y * 256 + np.arange(256) + 0.5) * k - Y0 * 256
        ix, iy = np.floor(gx).astype(int), np.floor(gy).astype(int)
        okx, oky = (ix >= 0) & (ix < W), (iy >= 0) & (iy < H)
        m = np.zeros((256, 256), bool)
        m[np.ix_(oky, okx)] = inside[np.ix_(iy[oky], ix[okx])]
        return m

    # 2) every tile
    tmp = out.with_suffix('.pmtiles.tmp')
    changed = kept = 0
    items = sorted(((zxy_to_tileid(z, x, y), z, x, y, d) for (z, x, y), d in all_tiles(get)), key=lambda t: t[0])
    with open(tmp, 'wb') as oh:
        w = Writer(oh)
        for tid, z, x, y, d in items:
            m = footprint(z, x, y)
            if m.all():
                w.write_tile(tid, d); kept += 1; continue
            a = np.asarray(Image.open(io.BytesIO(d)).convert('RGBA')).copy()
            clear = (~m) & (a[..., :3].min(axis=2) >= WHITE)
            if not clear.any():
                w.write_tile(tid, d); kept += 1; continue
            a[clear, 3] = 0
            b = io.BytesIO()
            Image.fromarray(a, 'RGBA').save(b, 'WEBP', quality=85, method=4, exact=False)
            w.write_tile(tid, b.getvalue()); changed += 1
        w.finalize(header, meta)
tmp.replace(out)
print(f'{changed} tiles made see-through at the margin, {kept} unchanged -> {out} ({out.stat().st_size / 1e6:.0f} MB)')
