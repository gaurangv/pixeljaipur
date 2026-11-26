import { OrthographicCamera, Vector3 } from 'three';

/**
 * 2:1 dimetric projection. A 30° elevation makes ground diagonals step
 * 2 px across for every 1 px up (sin 30° = 0.5). Azimuth is 45° plus 90° per snap rotation.
 * World axes: +x east, +y up, +z south (three.js is right-handed, y-up).
 */
export const ELEVATION_DEG = 30;
const CAMERA_DISTANCE = 1000; // metres back from the target; ortho, so it only affects clipping

export interface Basis {
  /** Unit vector the camera looks along. */
  forward: Vector3;
  /** Unit vector pointing screen-right, in world space. */
  right: Vector3;
  /** Unit vector pointing screen-up, in world space. */
  up: Vector3;
}

export function normalizeRot(rot: number): number {
  return ((Math.round(rot) % 4) + 4) % 4;
}

export function cameraBasis(rot: number): Basis {
  const az = ((45 + 90 * normalizeRot(rot)) * Math.PI) / 180;
  const el = (ELEVATION_DEG * Math.PI) / 180;
  // Camera sits towards +x/+z of the target at rot 0, i.e. it looks north-west.
  const toCamera = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const forward = toCamera.clone().negate();
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  return { forward, right, up };
}

export interface Snap {
  /** Target moved so its screen position lands exactly on a render-target texel. */
  snapped: Vector3;
  /** How far the true target is from the snapped one, in render-target pixels (screen x right, y up). */
  remainderPx: { x: number; y: number };
}

/**
 * Snap a camera target to the texel grid of the low-res render target so static
 * geometry never shimmers while panning. Apply `remainderPx` as a sub-pixel offset
 * in the upscale pass, so the motion still looks smooth.
 */
export function snapToTexel(target: Vector3, rot: number, mpp: number): Snap {
  const { right, up } = cameraBasis(rot);
  const sx = target.dot(right) / mpp;
  const sy = target.dot(up) / mpp;
  const rx = Math.round(sx);
  const ry = Math.round(sy);
  const snapped = target
    .clone()
    .addScaledVector(right, (rx - sx) * mpp)
    .addScaledVector(up, (ry - sy) * mpp);
  return { snapped, remainderPx: { x: sx - rx, y: sy - ry } };
}

/** Screen-space footprint of a world vector, in metres along screen right / up. */
export function projectToScreen(v: Vector3, rot: number): { x: number; y: number } {
  const { right, up } = cameraBasis(rot);
  return { x: v.dot(right), y: v.dot(up) };
}

export function createCamera(): OrthographicCamera {
  return new OrthographicCamera(-1, 1, 1, -1, 1, CAMERA_DISTANCE * 2);
}

/** Size the frustum so one render-target pixel covers exactly `mpp` metres. */
export function updateCamera(
  cam: OrthographicCamera,
  target: Vector3,
  rot: number,
  mpp: number,
  rtWidth: number,
  rtHeight: number,
): Snap {
  const snap = snapToTexel(target, rot, mpp);
  const { forward, up } = cameraBasis(rot);
  cam.position.copy(snap.snapped).addScaledVector(forward, -CAMERA_DISTANCE);
  cam.up.copy(up);
  cam.lookAt(snap.snapped);
  const halfW = (rtWidth * mpp) / 2;
  const halfH = (rtHeight * mpp) / 2;
  cam.left = -halfW;
  cam.right = halfW;
  cam.top = halfH;
  cam.bottom = -halfH;
  cam.updateProjectionMatrix();
  return snap;
}

/** Everything needed to map between world space and CSS pixels on the canvas. */
export interface ScreenView {
  target: Vector3;
  rot: number;
  mpp: number;
  /** Visible render-target size in texels (PixelPass.size, without the margin). */
  size: { x: number; y: number };
  zoom: number;
  dpr: number;
}

/**
 * World point -> CSS pixel position on the canvas (top-left origin).
 * Exact inverse of the pixel pass: the texel-snap remainder cancels out, so this
 * equals the un-snapped projection (to within the 1-texel sampling of the upscale).
 */
export function worldToScreen(p: Vector3, v: ScreenView): { x: number; y: number } {
  const { right, up } = cameraBasis(v.rot);
  const d = p.clone().sub(v.target);
  const k = v.zoom / v.dpr;
  return {
    x: (v.size.x / 2 + d.dot(right) / v.mpp) * k,
    y: (v.size.y / 2 - d.dot(up) / v.mpp) * k,
  };
}

/** CSS pixel -> world ray (origin far behind the screen, unit direction into the scene). */
export function screenToRay(x: number, y: number, v: ScreenView): { origin: Vector3; dir: Vector3 } {
  const { right, up, forward } = cameraBasis(v.rot);
  const k = v.dpr / v.zoom;
  const dr = (x * k - v.size.x / 2) * v.mpp;
  const du = (v.size.y / 2 - y * k) * v.mpp;
  const origin = v.target.clone().addScaledVector(right, dr).addScaledVector(up, du).addScaledVector(forward, -CAMERA_DISTANCE);
  return { origin, dir: forward };
}
