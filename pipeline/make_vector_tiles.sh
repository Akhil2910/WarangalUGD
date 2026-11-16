#!/usr/bin/env bash
# Pack the network layers into PMTiles vector tiles for the app.
# Usage (Git Bash, from the project root):  . pipeline/env.sh && bash pipeline/make_vector_tiles.sh
set -euo pipefail
N=work/network
T=work/tiles
mkdir -p "$T"

# Main network: trunk + sub-mains visible from zoom 10; all pipes from 13; manholes from 15.
rm -f "$T/network.gpkg" "$T/network.pmtiles"
ogr2ogr -f GPKG "$T/network.gpkg" "$N/pipes.geojson" -nln pipes_major -where "dia_mm >= 250"
ogr2ogr -update -f GPKG "$T/network.gpkg" "$N/pipes.geojson" -nln pipes
ogr2ogr -update -f GPKG "$T/network.gpkg" "$N/manholes.geojson" -nln manholes
ogr2ogr -update -f GPKG "$T/network.gpkg" "$N/stations.geojson" -nln stations
CONF='{"pipes_major":{"minzoom":10,"maxzoom":16},"pipes":{"minzoom":13,"maxzoom":16},"manholes":{"minzoom":15,"maxzoom":16},"stations":{"minzoom":10,"maxzoom":16}}'
ogr2ogr -f PMTiles "$T/network.pmtiles" "$T/network.gpkg" -dsco MINZOOM=10 -dsco MAXZOOM=16 -dsco "CONF=$CONF" \
  -dsco MAX_SIZE=1000000 -dsco MAX_FEATURES=400000 -dsco SIMPLIFICATION=0.5 -dsco SIMPLIFICATION_MAX_ZOOM=1

# Reference: the GIS network exactly as delivered, and the branches not in the final design.
rm -f "$T/dpr_original.pmtiles" "$T/dpr_original.gpkg"
ogr2ogr -f GPKG "$T/dpr_original.gpkg" "$N/dpr_gis_original.geojson" -nln dpr_original
ogr2ogr -update -f GPKG "$T/dpr_original.gpkg" "$N/gis_not_in_design.geojson" -nln not_in_design
ogr2ogr -f PMTiles "$T/dpr_original.pmtiles" "$T/dpr_original.gpkg" -dsco MINZOOM=12 -dsco MAXZOOM=16 \
  -dsco 'CONF={"dpr_original":{"minzoom":13,"maxzoom":16},"not_in_design":{"minzoom":12,"maxzoom":16}}' -dsco MAX_SIZE=1000000

# Road stretches (lines) and one label point per stretch.
rm -f "$T/stretches.gpkg" "$T/stretches.pmtiles"
ogr2ogr -f GPKG "$T/stretches.gpkg" "$N/stretches.geojson" -nln stretches
ogr2ogr -update -f GPKG "$T/stretches.gpkg" "$N/stretch_points.geojson" -nln stretch_points
ogr2ogr -f PMTiles "$T/stretches.pmtiles" "$T/stretches.gpkg" -dsco MINZOOM=11 -dsco MAXZOOM=16 \
  -dsco 'CONF={"stretches":{"minzoom":11,"maxzoom":16},"stretch_points":{"minzoom":14,"maxzoom":16}}' -dsco MAX_SIZE=1000000 -dsco MAX_FEATURES=400000

# Boundaries stay GeoJSON (small): copied to the app data folder by the app build step.
cp "$N/wards.geojson" "$N/admin_zones.geojson" "$N/sewer_zones.geojson" "$N/stations.geojson" "$T/"
ls -la "$T"
