import type { PickablePlace } from '../world/picking';

/** One info-card place, as written by scripts/build_slice.py to data/build/<slice>.places.json. */
export interface Place extends PickablePlace {
  name: string;
  nameHi?: string | null;
  /** English Wikipedia title, or null when there is no article (the card uses `blurb`). */
  wiki: string | null;
  qid?: string | null;
  blurb: string;
  review?: boolean;
  /** Pin position, data coords (x east, y north), metres. */
  anchor: [number, number];
  /** WGS84 [lon, lat] of the anchor, for the OpenStreetMap link. */
  lonlat?: [number, number];
}
