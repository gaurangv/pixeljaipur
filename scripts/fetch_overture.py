# /// script
# requires-python = ">=3.11"
# dependencies = ["overturemaps", "shapely>=2"]
# ///
"""Download Overture Maps buildings for a slice's bounding box.

    uv run scripts/fetch_overture.py [--slice slice1] [--refresh]

Reads   data/boundary/<slice>.geojson
Writes  data/raw/<slice>.overture.geojson   (WGS84, committed; never hand-edit)

Overture buildings merge OSM, Microsoft ML, Google Open Buildings and Esri
footprints. Licence: ODbL (see public/assets/LICENSES.md).
"""

from __future__ import annotations

import argparse
import collections
import json
import subprocess
import sys
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", default="slice1")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    boundary = json.loads((ROOT / "data/boundary" / f"{args.slice}.geojson").read_text(encoding="utf-8"))
    geom = boundary["features"][0]["geometry"] if boundary.get("type") == "FeatureCollection" else boundary["geometry"]
    minx, miny, maxx, maxy = shape(geom).bounds
    out = ROOT / "data/raw" / f"{args.slice}.overture.geojson"

    if out.exists() and not args.refresh:
        print(f"Using cached {out.relative_to(ROOT)}")
    else:
        print(f"Downloading Overture buildings for bbox {minx},{miny},{maxx},{maxy} ...")
        subprocess.run(
            [sys.executable, "-m", "overturemaps", "download",
             f"--bbox={minx},{miny},{maxx},{maxy}", "-f", "geojson", "--type=building", "-o", str(out)],
            check=True,
        )

    data = json.loads(out.read_text(encoding="utf-8"))
    feats = data.get("features", [])
    by_source = collections.Counter(
        ((f["properties"].get("sources") or [{}])[0] or {}).get("dataset", "?") for f in feats
    )
    with_height = sum(1 for f in feats if f["properties"].get("height"))
    with_floors = sum(1 for f in feats if f["properties"].get("num_floors"))
    print(f"{len(feats)} buildings  by source {dict(by_source)}  height:{with_height} floors:{with_floors}")


if __name__ == "__main__":
    main()
