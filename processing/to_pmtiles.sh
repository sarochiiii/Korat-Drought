#!/usr/bin/env bash
# Extension (optional): GeoJSON -> PMTiles (cloud-native vector tiles)
# Requires Docker (available in the default Codespaces image).
# GDAL >= 3.8 is needed for the PMTiles driver; the image tag is pinned.
set -euo pipefail
IN=${1:-docs/data/korat_drought_districts.geojson}
OUT=${2:-docs/data/korat_drought_districts.pmtiles}
IMAGE=ghcr.io/osgeo/gdal:ubuntu-small-3.9.2

docker run --rm -v "$PWD":/w -w /w "$IMAGE" \
  ogr2ogr -f PMTiles "$OUT" "$IN" \
  -dsco MINZOOM=6 -dsco MAXZOOM=12

docker run --rm -v "$PWD":/w -w /w "$IMAGE" ogrinfo -so "$OUT" -al | head -20
echo "Done -> $OUT"
