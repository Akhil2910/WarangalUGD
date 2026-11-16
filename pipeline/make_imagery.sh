#!/usr/bin/env bash
# Satellite imagery -> Web Mercator WebP tiles (zoom 10-19) -> one PMTiles file for the app.
# Takes about 3.5 hours for the 27 x 27 km, 0.25 m GWMC mosaic on a 6-core laptop; run it in the background.
# Usage (Git Bash, from the project root):  . pipeline/env.sh && bash pipeline/make_imagery.sh [path/to/new.jp2]
#
# Note on the GWMC.jp2 delivery: the file carries two georeferences. The internal GML box is shifted
# one image height (27.36 km) north; the world file (.j2w) is correct. GDAL 3.13 picks the correct one;
# GDAL_GEOREF_SOURCES below makes that explicit for other versions.
set -euo pipefail
SRC="${1:-inputs/GWMC_SATELLITE/GWMC.jp2}"
OUT=work/imagery
mkdir -p "$OUT"
export GDAL_GEOREF_SOURCES=WORLDFILE,PAM,INTERNAL
export GDAL_NUM_THREADS=2 GDAL_CACHEMAX=512
gdalinfo "$SRC" | grep -E "Origin|Pixel Size|Size is"
gdal2tiles --xyz --processes=11 --tiledriver=WEBP --webp-quality=85 -r average -z 10-19 -w none --exclude "$SRC" "$OUT/tiles"
python pipeline/pack_imagery.py "$OUT/tiles" "$OUT/imagery.pmtiles" \
  "Satellite imagery purchased by GWMC (vendor, date and licence to be confirmed)"
