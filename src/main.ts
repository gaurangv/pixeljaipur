import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { cameraBasis, createCamera, normalizeRot, updateCamera } from './render/camera';
import { palette, skyFor } from './render/palette';
import { PixelPass } from './render/pixelPass';
import { loadFootprints } from './world/footprints';
import sliceUrl from '../data/build/slice1.geojson?url';

/**
 * URL params (all optional), so screenshots and shared links are deterministic:
 *   mpp   metres per render-target pixel (0.33 | 0.5 | 1)   default 0.5
 *   zoom  integer upscale factor                              default 3
 *   rot   snap rotation 0..3                                  default 0
 *   x, y  camera target in local metres (east, north)         default: between Badi Chaupar and Hawa Mahal
 *   shot  1 = render once, then set window.__pjReady          (for scripts/shots.ts)
 */
const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) ? v : fallback;
};

const state = {
  mpp: num('mpp', 0.5),
  zoom: Math.max(1, Math.round(num('zoom', 3))),
  rot: normalizeRot(num('rot', 0)),
  // three.js world: +x east, -z north
  target: new Vector3(num('x', 0), 0, -num('y', 80)),
};
const shotMode = params.get('shot') === '1';

declare global {
  interface Window {
    __pjReady?: boolean;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: shotMode });
const pixel = new PixelPass(renderer);
const camera = createCamera();

const scene = new Scene();
scene.background = new Color(skyFor.noon);
document.body.style.background = new Color(skyFor.noon).getStyle();

const ground = new Mesh(new PlaneGeometry(4000, 4000), new MeshBasicMaterial({ color: palette.ground }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

function resize() {
  pixel.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, state.zoom);
}

function frame() {
  const rt = pixel.renderSize;
  const snap = updateCamera(camera, state.target, state.rot, state.mpp, rt.x, rt.y);
  pixel.render(scene, camera, snap.remainderPx);
}

let dirty = true;
function loop() {
  if (dirty) {
    frame();
    dirty = false;
  }
  requestAnimationFrame(loop);
}
const invalidate = () => (dirty = true);

// --- Controls: drag to pan, wheel for integer zoom, Q/E to rotate ---
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dpr = window.devicePixelRatio || 1;
  const metresPerCss = (dpr / state.zoom) * state.mpp;
  const { right, up } = cameraBasis(state.rot);
  const dx = (e.clientX - drag.x) * metresPerCss;
  const dy = (e.clientY - drag.y) * metresPerCss;
  // Move along the ground: screen-up maps to ground distance / sin(elevation) = 2x.
  const groundUp = new Vector3(up.x, 0, up.z).normalize();
  state.target.addScaledVector(right, -dx).addScaledVector(groundUp, dy * 2);
  state.target.y = 0;
  drag = { x: e.clientX, y: e.clientY };
  invalidate();
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    state.zoom = Math.min(8, Math.max(1, state.zoom + (e.deltaY < 0 ? 1 : -1)));
    resize();
    invalidate();
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  if (e.key === 'q' || e.key === 'Q') state.rot = normalizeRot(state.rot + 1);
  else if (e.key === 'e' || e.key === 'E') state.rot = normalizeRot(state.rot - 1);
  else return;
  invalidate();
});
window.addEventListener('resize', () => {
  resize();
  invalidate();
});

async function start() {
  resize();
  try {
    scene.add(await loadFootprints(sliceUrl));
  } catch (err) {
    console.error('[pixeljaipur] footprints failed to load', err);
  }
  if (shotMode) {
    frame();
    window.__pjReady = true;
  } else {
    loop();
  }
}

start();
