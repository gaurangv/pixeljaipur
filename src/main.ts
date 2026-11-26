import { Color, Mesh, PCFShadowMap, PlaneGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import landmarks from '../data/build/slice1.landmarks.json';
import sliceUrl from '../data/build/slice1.geojson?url';
import { buildHawaMahal, type HawaMahalPlacement } from './landmarks/hawaMahal';
import { cameraBasis, createCamera, normalizeRot, updateCamera } from './render/camera';
import { toon } from './render/materials';
import { skyFor } from './render/palette';
import { PixelPass } from './render/pixelPass';
import { addLighting } from './sky/light';
import { hashWriter, parseHash } from './ui/urlState';
import { buildDressing } from './world/dressing';
import { buildFootprints, loadSlice } from './world/footprints';
import { buildShopHouses } from './world/shopHouse';

/**
 * View state comes from (highest first): query params, the #z/x/y/rot hash, then the default
 * view on Hawa Mahal. Query params keep screenshots deterministic:
 *   mpp     metres per render-target pixel (0.33 | 0.5 | 1)   default 0.5
 *   zoom    integer upscale factor (device px per texel)        default 3 x devicePixelRatio
 *   rot     snap rotation 0..3                                  default 0
 *   x, y    camera target in local metres (east, north)         default: in front of Hawa Mahal
 *   seed    world seed for procedural generation                default 1
 *   outline 0 = disable the 1 px depth outline
 *   shot    1 = render once, then set window.__pjReady          (for scripts/shots.ts)
 */
const params = new URLSearchParams(location.search);
const num = (key: string) => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) ? v : undefined;
};

/** Zoom = device pixels per texel; default to ~3 CSS px per texel on any screen. */
const MAX_ZOOM = 16;
const defaultZoom = Math.min(MAX_ZOOM, Math.max(1, Math.round(3 * (window.devicePixelRatio || 1))));

const hawa = landmarks.landmarks.find((l) => l.id === 'hawaMahal') as unknown as HawaMahalPlacement | undefined;
const defaultView = (() => {
  if (!hawa) return { zoom: defaultZoom, x: 0, y: 80, rot: 0 };
  // Stand in the street, 12 m in front of the facade; rot 0 looks north-west at it.
  const th = (hawa.facingDeg * Math.PI) / 180;
  return { zoom: defaultZoom, x: hawa.anchor[0] + 12 * Math.cos(th), y: hawa.anchor[1] + 12 * Math.sin(th), rot: 0 };
})();
const fromHash = parseHash(location.hash) ?? {};
const view = { ...defaultView, ...fromHash };

const state = {
  mpp: num('mpp') ?? 0.5,
  zoom: Math.min(MAX_ZOOM, Math.max(1, Math.round(num('zoom') ?? view.zoom))),
  rot: normalizeRot(num('rot') ?? view.rot),
  // three.js world: +x east, -z north
  target: new Vector3(num('x') ?? view.x, 0, -(num('y') ?? view.y)),
};
const shotMode = params.get('shot') === '1';
const outline = params.get('outline') !== '0';
const seed = Math.round(num('seed') ?? 1);

declare global {
  interface Window {
    __pjReady?: boolean;
    /** Render stats for the last frame (scripts/shots.ts reads these). */
    __pjStats?: { calls: number; triangles: number; ms: number; geometries: number };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: shotMode });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.info.autoReset = false;
const pixel = new PixelPass(renderer);
const camera = createCamera();
// Ground one texel further up-screen is mpp / tan(30°) ≈ 1.73·mpp deeper; edges must jump more than that.
pixel.setOutline(outline, Math.max(1.0, 3 * state.mpp));

const scene = new Scene();
scene.background = new Color(skyFor.noon);
document.body.style.background = new Color(skyFor.noon).getStyle();

const ground = new Mesh(new PlaneGeometry(4000, 4000), toon('ground'));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const sun = addLighting(scene);
// The scene is static in Phase 1: render the shadow map once, not every frame.
renderer.shadowMap.autoUpdate = false;

const writeHash = hashWriter();
const saveView = () => {
  if (shotMode) return;
  writeHash({ zoom: state.zoom, x: state.target.x, y: -state.target.z, rot: state.rot });
};

function resize() {
  pixel.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, state.zoom);
}

function frame() {
  const t0 = performance.now();
  renderer.info.reset();
  const rt = pixel.renderSize;
  const snap = updateCamera(camera, state.target, state.rot, state.mpp, rt.x, rt.y);
  pixel.render(scene, camera, snap.remainderPx);
  window.__pjStats = {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    ms: performance.now() - t0,
  };
}

let dirty = true;
function loop() {
  if (dirty) {
    frame();
    dirty = false;
  }
  requestAnimationFrame(loop);
}
const invalidate = () => {
  dirty = true;
  saveView();
};

function setZoom(z: number) {
  const next = Math.min(MAX_ZOOM, Math.max(1, Math.round(z)));
  if (next === state.zoom) return;
  state.zoom = next;
  resize();
  invalidate();
}

// --- Controls: drag to pan, wheel / pinch for integer zoom, Q/E to rotate ---
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart: { dist: number; zoom: number } | null = null;
const pinchDist = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};

canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (pointers.size === 2) pinchStart = { dist: pinchDist(), zoom: state.zoom };
});
const endPointer = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinchStart && pointers.size === 2) {
    // Zoom in whole steps: every 35% change in finger distance is one step.
    const steps = Math.round(Math.log(pinchDist() / pinchStart.dist) / Math.log(1.35));
    setZoom(pinchStart.zoom + steps);
    return;
  }
  if (pointers.size !== 1) return;
  const dpr = window.devicePixelRatio || 1;
  const metresPerCss = (dpr / state.zoom) * state.mpp;
  const { right, up } = cameraBasis(state.rot);
  const dx = (e.clientX - prev.x) * metresPerCss;
  const dy = (e.clientY - prev.y) * metresPerCss;
  // Move along the ground: screen-up maps to ground distance / sin(elevation) = 2x.
  const groundUp = new Vector3(up.x, 0, up.z).normalize();
  state.target.addScaledVector(right, -dx).addScaledVector(groundUp, dy * 2);
  state.target.y = 0;
  invalidate();
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    setZoom(state.zoom + (e.deltaY < 0 ? 1 : -1));
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
  dirty = true;
});
window.addEventListener('hashchange', () => {
  const v = parseHash(location.hash);
  if (!v) return;
  if (v.zoom !== undefined) state.zoom = v.zoom;
  if (v.rot !== undefined) state.rot = normalizeRot(v.rot);
  if (v.x !== undefined && v.y !== undefined) state.target.set(v.x, 0, -v.y);
  resize();
  dirty = true;
});

async function start() {
  resize();
  try {
    const slice = await loadSlice(sliceUrl);
    scene.add(buildFootprints(slice, { skip: ['building'] }));
    const houses = buildShopHouses(slice, seed);
    scene.add(houses.group);
    scene.add(buildDressing(houses.specs, slice, seed));
    if (hawa) scene.add(buildHawaMahal(hawa));
  } catch (err) {
    console.error('[pixeljaipur] slice failed to load', err);
  }
  sun.shadow.needsUpdate = true;
  renderer.shadowMap.needsUpdate = true;
  if (shotMode) {
    frame();
    window.__pjReady = true;
  } else {
    loop();
  }
}

start();
