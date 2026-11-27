"""Shared slice configuration for the data scripts.

A "slice" is an area of the city with a boundary in data/boundary/<slice>.geojson.
`slice1` is the original Hawa Mahal block; `walled` is the whole walled city.
The boundary feature may set properties.buffer_m to grow the outline (the walled city
uses ~60 m so the wall and its gates fit inside).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import Polygon, shape

ROOT = Path(__file__).resolve().parent.parent
_FWD = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
_INV = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True)


def _to_utm(c: np.ndarray) -> np.ndarray:
    x, y = _FWD.transform(c[:, 0], c[:, 1])
    return np.column_stack([x, y])


def _to_wgs(c: np.ndarray) -> np.ndarray:
    x, y = _INV.transform(c[:, 0], c[:, 1])
    return np.column_stack([x, y])


def boundary_feature(slice_name: str) -> dict:
    b = json.loads((ROOT / "data/boundary" / f"{slice_name}.geojson").read_text(encoding="utf-8"))
    return b["features"][0] if b.get("type") == "FeatureCollection" else b


def load_boundary(slice_name: str) -> Polygon:
    """WGS84 boundary polygon for a slice, grown by properties.buffer_m if set."""
    feat = boundary_feature(slice_name)
    poly = shape(feat["geometry"])
    buf = float((feat.get("properties") or {}).get("buffer_m") or 0)
    if buf:
        utm = shapely.transform(poly, _to_utm)
        poly = shapely.transform(utm.buffer(buf, join_style="mitre"), _to_wgs)
    return poly


def tiles(poly: Polygon, tile_m: float = 800.0) -> list[tuple[float, float, float, float]]:
    """Split the polygon's bbox into ~tile_m square WGS84 bboxes (south, west, north, east)
    that touch the polygon. A small slice gives a single tile."""
    minx, miny, maxx, maxy = poly.bounds
    mid = (miny + maxy) / 2
    dlat = tile_m / 110_574
    dlon = tile_m / (111_320 * math.cos(math.radians(mid)))
    out = []
    y = miny
    while y < maxy:
        x = minx
        while x < maxx:
            box = (y, x, min(y + dlat, maxy), min(x + dlon, maxx))
            if shapely.box(box[1], box[0], box[3], box[2]).intersects(poly):
                out.append(box)
            x += dlon
        y += dlat
    return out
