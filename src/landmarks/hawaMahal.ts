import { ConeGeometry, CylinderGeometry, Group, Matrix4, Quaternion, Vector3 } from 'three';
import { at, Batch, buildPooled, unitBox } from '../world/instancing';

/*
 * Hawa Mahal (1799): a five-storey screen of small jharokha bays stacked into a
 * stepped pyramid, on a sandstone plinth, facing the street.
 *
 * Built from ONE reusable jharokha module, instanced. Every proportion below is a
 * first guess to be tuned against docs/refs/hawa-mahal-*.jpg. Change constants, not code.
 *
 * Local frame: x along the facade, y up, +z out of the facade towards the street.
 */

export const HAWA = {
  plinthH: 2.4,
  storeyH: 3.2,
  /** How far each storey's facade steps back from the one below (the real screen is near-vertical). */
  stepBack: 0.25,
  /** Facade width of each of the 5 storeys (bottom to top), metres. */
  tierWidths: [50, 46, 34, 22, 12],
  /** Depth of each storey's mass behind the facade (the top three are one room deep). */
  tierDepths: [14, 12, 4, 3.5, 3],
  /** Target width of one jharokha bay. */
  bayW: 1.7,
  /** How far a bay projects from the wall. */
  bayOut: 0.9,
  /** Small window openings per bay (rows x cols) — to nod at the famous 953 windows. */
  windowRows: 3,
  windowCols: 3,
  /** Domed finials along the top of each tier: one every N bays. */
  finialEvery: 3,
} as const;

export interface HawaMahalPlacement {
  /** Facade centre at street level, data coords (x east, y north), metres. */
  anchor: [number, number];
  /** Direction the facade faces, degrees CCW from +x (east), data coords. */
  facingDeg: number;
}

export interface HawaMahalLayout {
  bays: { x: number; y: number; z: number; tier: number }[];
  windows: number;
}

/** Pure layout: bay centres per tier, and the total window count. */
export function layoutHawaMahal(h = HAWA): HawaMahalLayout {
  const bays: HawaMahalLayout['bays'] = [];
  h.tierWidths.forEach((w, tier) => {
    const n = Math.max(1, Math.round(w / h.bayW));
    const step = w / n;
    const y = h.plinthH + tier * h.storeyH;
    // each tier's facade sits on the front of its mass; upper tiers step back slightly
    const z = -tier * h.stepBack;
    for (let i = 0; i < n; i++) bays.push({ x: -w / 2 + (i + 0.5) * step, y, z, tier });
  });
  return { bays, windows: bays.length * h.windowRows * h.windowCols };
}

export function buildHawaMahal(p: HawaMahalPlacement, h = HAWA): Group {
  const { bays } = layoutHawaMahal(h);
  const dome = new ConeGeometry(0.5, 1, 8, 1);
  const finialGeo = new CylinderGeometry(0.06, 0.5, 1, 8, 1);

  const b = {
    plinth: new Batch('hm:plinth', unitBox, 'sandstone'),
    plinthStep: new Batch('hm:plinthStep', unitBox, 'sandstoneShade'),
    mass: new Batch('hm:mass', unitBox, 'terracottaShade'),
    bay: new Batch('hm:bay', unitBox, 'terracotta'),
    bayTrim: new Batch('hm:bayTrim', unitBox, 'limeWhite'),
    window: new Batch('hm:window', unitBox, 'terracottaDeep', false),
    cap: new Batch('hm:cap', dome, 'terracotta'),
    ledge: new Batch('hm:ledge', unitBox, 'limeWhiteShade'),
    finial: new Batch('hm:finial', finialGeo, 'limeWhiteShade'),
    gate: new Batch('hm:gate', unitBox, 'terracottaDeep'),
  };

  // Plinth with a front step, and a dark arched entrance in the middle.
  const W0 = h.tierWidths[0];
  b.plinth.add(at(0, h.plinthH / 2, -h.tierDepths[0] / 2, W0 + 2, h.plinthH, h.tierDepths[0] + 2));
  b.plinthStep.add(at(0, 0.3, 1.4, W0 + 2, 0.6, 1.2));
  b.gate.add(at(0, 1.1, 1.02, 3.2, 2.2, 0.1));

  // Storey masses (the wall each tier of bays is attached to) and a lime-white ledge on each.
  h.tierWidths.forEach((w, tier) => {
    const y = h.plinthH + tier * h.storeyH;
    const d = h.tierDepths[tier];
    const z = -tier * h.stepBack;
    b.mass.add(at(0, y + h.storeyH / 2, z - d / 2, w, h.storeyH, d));
    b.ledge.add(at(0, y + h.storeyH - 0.06, z + 0.3, w + 0.2, 0.12, 0.6));
  });

  // The reusable jharokha module: body, white frame, window grid, domed cap.
  const bodyW = h.bayW * 0.8;
  const bodyH = h.storeyH * 0.72;
  for (const [i, bay] of bays.entries()) {
    const y0 = bay.y + 0.25;
    const zc = bay.z + h.bayOut / 2;
    b.bay.add(at(bay.x, y0 + bodyH / 2, zc, bodyW, bodyH, h.bayOut));
    b.bayTrim.add(at(bay.x, y0 - 0.06, zc + 0.05, bodyW + 0.2, 0.12, h.bayOut + 0.1)); // sill
    const cw = bodyW / h.windowCols;
    const rh = (bodyH * 0.8) / h.windowRows;
    for (let r = 0; r < h.windowRows; r++) {
      for (let c = 0; c < h.windowCols; c++) {
        b.window.add(
          at(bay.x - bodyW / 2 + (c + 0.5) * cw, y0 + bodyH * 0.12 + (r + 0.5) * rh, bay.z + h.bayOut + 0.01, cw * 0.55, rh * 0.6, 0.05),
        );
      }
    }
    b.cap.add(at(bay.x, y0 + bodyH + 0.45, zc, bodyW * 0.95, 0.7, h.bayOut * 0.95));
    // Finials crown the roof line of every tier (and every bay on the top tier).
    const top = bay.tier === h.tierWidths.length - 1;
    if (top || i % h.finialEvery === 0) {
      const yTop = h.plinthH + (bay.tier + 1) * h.storeyH;
      b.finial.add(at(bay.x, yTop + 0.5, bay.z - 0.3, 0.5, 1.0, 0.5));
    }
  }
  // A crowning finial on the very top.
  const yCrown = h.plinthH + h.tierWidths.length * h.storeyH;
  b.finial.add(at(0, yCrown + 1.2, -(h.tierWidths.length - 1) * h.stepBack - 0.3, 1.2, 2.4, 1.2));

  const group = new Group();
  group.name = 'hawaMahal';
  for (const m of buildPooled(Object.values(b), 'hawaMahal')) group.add(m);

  // Place: local +z must point along `facingDeg` (data coords), world = (x, 0, -y).
  const th = (p.facingDeg * Math.PI) / 180;
  const phi = Math.atan2(Math.cos(th), -Math.sin(th));
  group.applyMatrix4(
    new Matrix4().compose(
      new Vector3(p.anchor[0], 0, -p.anchor[1]),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), phi),
      new Vector3(1, 1, 1),
    ),
  );
  return group;
}
