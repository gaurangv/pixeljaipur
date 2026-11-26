import { DirectionalLight, HemisphereLight, Object3D, Vector3 } from 'three';
import { palette } from '../render/palette';

/**
 * Sun + sky fill. The light starts at a fixed morning sun; the day-cycle system
 * (src/sky/daycycle.ts) then moves and colours it from suncalc, in 10-minute steps.
 */
export const SUN = { azimuthDeg: 105, altitudeDeg: 30 }; // azimuth clockwise from north

/** Name of the hemisphere fill light, so the day cycle can find it under the root. */
export const SKY_LIGHT_NAME = 'pj:skyLight';
/** Distance of the key light from the target (its shadow camera looks back at the origin). */
export const SUN_DISTANCE = 600;

/** Unit vector pointing from the ground towards the sun (world: +x east, -z north). */
export function sunDirection(azimuthDeg = SUN.azimuthDeg, altitudeDeg = SUN.altitudeDeg): Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  return new Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
}

/** Adds sun + sky fill to `root`. `extent` is the half-size (m) of the area that casts shadows. */
export function addLighting(root: Object3D, extent = 360): DirectionalLight {
  const sky = new HemisphereLight(palette.skyDay, palette.shadowWarm, 2.1);
  sky.name = SKY_LIGHT_NAME;
  root.add(sky);

  const sun = new DirectionalLight(palette.sunWarm, 2.3);
  sun.name = 'pj:sun';
  sun.position.copy(sunDirection()).multiplyScalar(SUN_DISTANCE);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const cam = sun.shadow.camera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = 1;
  cam.far = 1400;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.25;
  root.add(sun, sun.target);
  return sun;
}

/** The hemisphere fill added by addLighting (null if absent). */
export function findSkyLight(root: Object3D): HemisphereLight | null {
  const o = root.getObjectByName(SKY_LIGHT_NAME);
  return o instanceof HemisphereLight ? o : null;
}
