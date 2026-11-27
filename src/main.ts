import { Group, type Mesh, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import landmarks from '../data/build/slice1.landmarks.json';
import placesData from '../data/build/slice1.places.json';
import sliceUrl from '../data/build/slice1.geojson?url';
import { Clock, parseIST, SHOT_DEFAULT, todayAtIST } from './core/clock';
import { EventBus } from './core/events';
import { registerSystems } from './core/register';
import { Systems, type WorldContext } from './core/systems';
import { buildHawaMahal, type HawaMahalPlacement } from './landmarks/hawaMahal';
import { cameraBasis, createCamera, normalizeRot, screenToRay, updateCamera, type ScreenView } from './render/camera';
import { setDitherCell, toonDither } from './render/materials';
import { clampLevel, cssPerTexel as cssPerTexelFor, DEFAULT_LEVEL, levelFromHashZoom, mppForLevel, upscaleFor } from './render/zoomLevels';
import { PixelPass } from './render/pixelPass';
import { addLighting } from './sky/light';
import { InfoCard } from './ui/infoCard';
import { Pins } from './ui/pins';
import { Search, type SearchEntry } from './ui/search';
import { Minimap, type MinimapData } from './ui/minimap';
import type { Place } from './ui/places';
import { applyTheme } from './ui/theme';
import { hashWriter, parseHash } from './ui/urlState';
import { bounds, buildBase } from './world/base';
import { buildDressing } from './world/dressing';
import type { Pt } from './world/geometry';
import { buildFootprints, loadSlice } from './world/footprints';
import { ChunkManager, type CityIndex } from './world/chunks';
import { withPoolSink } from './world/instancing';
import { InstancePools } from './world/pools';
import { pickPlace } from './world/picking';
import { buildRoofs } from './world/roofs';
import { buildTrees, placeTrees } from './world/trees';
import { buildShopHouses, type ShopHouseSpec } from './world/shopHouse';
import type { FootprintCollection } from './world/footprints';

/**
 * View state comes from (highest first): query params, the #z/x/y/rot hash, then the default
 * view on Hawa Mahal. Query params keep screenshots deterministic:
 *   level   detail zoom level 0..6 (mpp 1.0 .. 0.11)           default 3 (0.33 m/texel)
 *   mpp     FIXED mode: metres per texel (used with zoom by scripts/shots.ts)
 *   zoom    FIXED mode: integer upscale (device px per texel)
 *   rot     snap rotation 0..3                                  default 0
 *   x, y    camera target in local metres (east, north)         default: in front of Hawa Mahal
 *   seed    world seed for procedural generation                default 1
 *   outline 0 = disable the 1 px depth outline
 *   card    open this place's info card (e.g. hawa-mahal); also #z/x/y/rot/<place>
 *   t       freeze world time, IST, e.g. 2026-01-14T18:45     default: today 08:00 (screenshots: 2026-01-14T07:50)
 *   shot    1 = render once, then set window.__pjReady          (for scripts/shots.ts)
 */
const params = new URLSearchParams(location.search);
const num = (key: string) => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) ? v : undefined;
};

/*
 * Detail zoom (src/render/zoomLevels.ts): the wheel/pinch steps through levels that change
 * metres-per-texel, while each texel keeps a constant size on screen. `?mpp=`/`?zoom=` switch to
 * the old FIXED mode (integer upscale of a fixed mpp), which screenshots and tests rely on.
 */
const MAX_ZOOM = 16;
const fixedMode = (params.has('mpp') || params.has('zoom')) && !params.has('level');
const crisp = (() => {
  try {
    return localStorage.getItem('pj-crisp') === '1';
  } catch {
    return false;
  }
})();
const upscaleNow = () => upscaleFor(cssPerTexelFor(window.innerWidth, crisp), window.devicePixelRatio || 1);
const defaultZoom = DEFAULT_LEVEL; // hash `z` is now the level

// --- Whole-city mode (Phase 3): data/build/walled/ streamed in 256 m chunks. `?slice=slice1` = old single slice.
const cityIndex = (Object.values(import.meta.glob('../data/build/walled/index.json', { import: 'default', eager: true }))[0] ?? null) as CityIndex | null;
const cityPlaces = Object.values(import.meta.glob('../data/build/walled/places.json', { import: 'default', eager: true }))[0] as { places: unknown[] } | undefined;
const cityLandmarks = Object.values(import.meta.glob('../data/build/walled/landmarks.json', { import: 'default', eager: true }))[0] as typeof landmarks | undefined;
const chunkUrls: Record<string, string> = {};
for (const [path, url] of Object.entries(import.meta.glob('../data/build/walled/chunks/*.json', { query: '?url', import: 'default', eager: true }) as Record<string, string>)) {
  chunkUrls[path.slice(path.lastIndexOf('/') + 1, -5)] = url;
}
const cityMode = !!cityIndex && params.get('slice') !== 'slice1';
const minimapData = Object.values(import.meta.glob('../data/build/walled/minimap.json', { import: 'default', eager: true }))[0] as MinimapData | undefined;
let minimap: Minimap | null = null;

const hawa = ((cityMode && cityLandmarks) || landmarks).landmarks.find((l) => l.id === 'hawaMahal') as unknown as HawaMahalPlacement | undefined;
const defaultView = (() => {
  if (!hawa) return { zoom: defaultZoom, x: 0, y: 80, rot: 0 };
  // Stand in the street, 12 m in front of the facade; rot 0 looks north-west at it.
  const th = (hawa.facingDeg * Math.PI) / 180;
  return { zoom: defaultZoom, x: hawa.anchor[0] + 12 * Math.cos(th), y: hawa.anchor[1] + 12 * Math.sin(th), rot: 0 };
})();
const fromHash = parseHash(location.hash) ?? {};
const view = { ...defaultView, ...fromHash };

const initialLevel = clampLevel(num('level') ?? (fromHash.zoom !== undefined ? levelFromHashZoom(fromHash.zoom) : DEFAULT_LEVEL));
const state = {
  level: initialLevel,
  mpp: fixedMode ? (num('mpp') ?? 0.33) : mppForLevel(initialLevel),
  zoom: fixedMode ? Math.min(MAX_ZOOM, Math.max(1, Math.round(num('zoom') ?? upscaleNow()))) : upscaleNow(),
  rot: normalizeRot(num('rot') ?? view.rot),
  // three.js world: +x east, -z north
  target: new Vector3(num('x') ?? view.x, 0, -(num('y') ?? view.y)),
};
const shotMode = params.get('shot') === '1';
const outline = params.get('outline') !== '0';
const seed = Math.round(num('seed') ?? 1);
const places = ((cityMode && cityPlaces) || placesData).places as unknown as Place[];
const placeById = new Map(places.map((p) => [p.id, p]));
const initialPlace = params.get('card') ?? fromHash.place ?? null;

// --- World time + Phase 2 systems (src/core). Time starts frozen at morning golden hour;
// the day-cycle system's UI can switch it to running/live. `?t=` and shot mode stay frozen.
const tParam = params.get('t');
const clock = new Clock((tParam && parseIST(tParam)) || (shotMode ? parseIST(SHOT_DEFAULT)! : todayAtIST(8)), 'fixed');
const events = new EventBus();
const systems = new Systems(registerSystems());
let ctx: WorldContext | null = null;

declare global {
  interface Window {
    __pjReady?: boolean;
    /** City mode: streamed chunk status (scripts/travel.ts reads it). */
    __pjCity?: () => { loaded: number; busy: boolean };
    /** Render stats for the last frame (scripts/shots.ts reads these). */
    __pjStats?: { calls: number; triangles: number; ms: number; geometries: number };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: shotMode });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.info.autoReset = false;
const pixel = new PixelPass(renderer);
const camera = createCamera();
// Ground one texel further up-screen is mpp / tan(30°) ≈ 1.73·mpp deeper; edges must jump more than that.
const applyOutline = () => pixel.setOutline(outline, Math.max(0.6, 3 * state.mpp));
applyOutline();

const scene = new Scene();
// No scene background: empty texels stay transparent and the pixel pass paints the backdrop gradient.
renderer.setClearColor(0x000000, 0);
const soil = toonDither('soil', ['ground', 'groundDark', 'groundLight'], state.mpp);

/** Keep the camera over the diorama (set once the slice boundary is known). */
let panBounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
function clampTarget(v: Vector3) {
  if (!panBounds) return;
  const pad = 20;
  v.x = Math.min(panBounds.x1 + pad, Math.max(panBounds.x0 - pad, v.x));
  const north = Math.min(panBounds.y1 + pad, Math.max(panBounds.y0 - pad, -v.z));
  v.z = -north;
}
const sun = addLighting(scene);
// The sun sits on a rig that follows the camera in 64 m steps, so the (static, refreshed-on-step)
// shadow map always covers the view wherever you are in the city.
const sunRig = new Group();
sunRig.name = 'sunRig';
scene.add(sunRig);
sunRig.add(sun);
sunRig.add(sun.target);
const SHADOW_STEP = 64;
function followShadows(): boolean {
  const cx = Math.round(state.target.x / SHADOW_STEP) * SHADOW_STEP;
  const cz = Math.round(state.target.z / SHADOW_STEP) * SHADOW_STEP;
  if (cx === sunRig.position.x && cz === sunRig.position.z) return false;
  sunRig.position.set(cx, 0, cz);
  sunRig.updateMatrixWorld(true);
  sun.shadow.needsUpdate = true;
  renderer.shadowMap.needsUpdate = true;
  return true;
}
let chunks: ChunkManager | null = null;
// The scene is static in Phase 1: render the shadow map once, not every frame.
renderer.shadowMap.autoUpdate = false;

// --- Overlay UI: pins + info card (HTML over the canvas; no draw calls) ---
applyTheme();
const overlay = document.createElement('div');
overlay.id = 'pj-overlay';
document.body.appendChild(overlay);
const card = new InfoCard(document.body, {
  live: !shotMode, // screenshots stay deterministic: blurb only, no network
  onClose: () => {
    pins.setActive(null);
    saveView();
  },
});
const pins = new Pins(overlay, places, (id, opener) => openPlace(id, opener));

const writeHash = hashWriter();
const saveView = () => {
  if (shotMode) return;
  writeHash({ zoom: fixedMode ? state.zoom : state.level, x: state.target.x, y: -state.target.z, rot: state.rot, place: card.openId ?? undefined });
};

/** Ground points under the four screen corners (data coords), for the minimap footprint. */
function viewCorners(): [number, number][] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return ([[0, 0], [w, 0], [w, h], [0, h]] as const).map(([sx, sy]) => {
    const r = screenToRay(sx, sy, screenView());
    const k = -r.origin.y / r.dir.y;
    return [r.origin.x + r.dir.x * k, -(r.origin.z + r.dir.z * k)] as [number, number];
  });
}

function screenView(): ScreenView {
  return { target: state.target, rot: state.rot, mpp: state.mpp, size: pixel.size, zoom: state.zoom, dpr: window.devicePixelRatio || 1 };
}

/** Smoothly move the camera target (stays texel-snapped every frame, so it stays crisp). */
let ease: { from: Vector3; to: Vector3; t0: number; ms: number } | null = null;
function flyTo(x: number, y: number, ms = 400) {
  const to = new Vector3(x, 0, -y);
  clampTarget(to);
  if (shotMode || ms <= 0) {
    state.target.copy(to);
    invalidate();
    return;
  }
  ease = { from: state.target.clone(), to, t0: performance.now(), ms };
}

function openPlace(id: string, opener: HTMLElement | null = null, move = true) {
  const p = placeById.get(id);
  if (!p) return;
  card.open(p, opener ?? pins.button(id) ?? null);
  pins.setActive(id);
  if (move) flyTo(p.anchor[0], p.anchor[1]);
  saveView();
}

function resize() {
  pixel.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, state.zoom);
}

function frame() {
  const t0 = performance.now();
  renderer.info.reset();
  if (chunks) chunks.setView(screenView());
  followShadows();
  const rt = pixel.renderSize;
  const snap = updateCamera(camera, state.target, state.rot, state.mpp, rt.x, rt.y);
  pixel.render(scene, camera, snap.remainderPx);
  pins.update(screenView());
  if (minimap) minimap.update(viewCorners(), places.map((p) => p.anchor));
  window.__pjStats = {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    ms: performance.now() - t0,
  };
}

let dirty = true;
let lastT = 0;
function loop(t = 0) {
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
  lastT = t;
  if (ctx) {
    clock.tick(dt);
    systems.update(dt, clock.now(), ctx);
    if (clock.running || systems.animating()) dirty = true;
  }
  if (ease) {
    const k = Math.min(1, (performance.now() - ease.t0) / ease.ms);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // easeInOutQuad
    state.target.lerpVectors(ease.from, ease.to, e);
    if (k >= 1) {
      ease = null;
      saveView();
    }
    dirty = true;
  }
  if (chunks && chunks.tick(1)) dirty = true; // build at most one streamed chunk per frame
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

/** Ground point (data coords) under a CSS position on the canvas, or null. */
function groundAt(cssX: number, cssY: number): Vector3 | null {
  const ray = screenToRay(cssX, cssY, screenView());
  if (ray.dir.y >= 0) return null;
  return ray.origin.clone().addScaledVector(ray.dir, -ray.origin.y / ray.dir.y);
}

/**
 * Zoom by `steps`. Detail mode moves through levels (mpp changes, texel size on screen doesn't);
 * fixed mode changes the integer upscale. The world point under (anchorX, anchorY) stays put.
 */
function zoomBy(steps: number, anchorX = window.innerWidth / 2, anchorY = window.innerHeight / 2) {
  const before = groundAt(anchorX, anchorY);
  if (fixedMode) {
    const next = Math.min(MAX_ZOOM, Math.max(1, Math.round(state.zoom + steps)));
    if (next === state.zoom) return;
    state.zoom = next;
  } else {
    const next = clampLevel(state.level + steps);
    if (next === state.level) return;
    setLevel(next);
  }
  resize();
  const after = groundAt(anchorX, anchorY);
  if (before && after) {
    state.target.add(before.sub(after));
    state.target.y = 0;
    clampTarget(state.target);
  }
  invalidate();
}

function setLevel(level: number) {
  state.level = clampLevel(level);
  state.mpp = mppForLevel(state.level);
  state.zoom = upscaleNow();
  applyOutline();
  setDitherCell(state.mpp);
}

function setZoom(z: number) {
  zoomBy(Math.round(z) - (fixedMode ? state.zoom : state.level));
}

// --- Controls: drag to pan, wheel / pinch for integer zoom, Q/E to rotate ---
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart: { dist: number; zoom: number } | null = null;
const pinchDist = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};

let tap: { x: number; y: number; id: number } | null = null; // click vs drag detection
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  ease = null;
  canvas.setPointerCapture(e.pointerId);
  if (pointers.size === 2) pinchStart = { dist: pinchDist(), zoom: fixedMode ? state.zoom : state.level };
});
const endPointer = (e: PointerEvent) => {
  if (e.type === 'pointerup' && tap && tap.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 4) {
    const rect = canvas.getBoundingClientRect();
    const id = pickPlace(screenToRay(e.clientX - rect.left, e.clientY - rect.top, screenView()), places);
    if (id) openPlace(id, null, false);
    else card.close();
    // Let systems react to clicks on the city (e.g. pigeons take off).
    const ray = screenToRay(e.clientX - rect.left, e.clientY - rect.top, screenView());
    if (ray.dir.y < 0) {
      const k = -ray.origin.y / ray.dir.y;
      events.emit('groundClick', { x: ray.origin.x + ray.dir.x * k, y: -(ray.origin.z + ray.dir.z * k) });
    }
  }
  tap = null;
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
  clampTarget(state.target);
  invalidate();
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') return zoomBy(1);
  if (e.key === '-' || e.key === '_') return zoomBy(-1);
  if (e.key === 'q' || e.key === 'Q') state.rot = normalizeRot(state.rot + 1);
  else if (e.key === 'e' || e.key === 'E') state.rot = normalizeRot(state.rot - 1);
  else return;
  invalidate();
});
window.addEventListener('resize', () => {
  if (!fixedMode) state.zoom = upscaleNow();
  resize();
  dirty = true;
});
window.addEventListener('hashchange', () => {
  const v = parseHash(location.hash);
  if (!v) return;
  if (v.zoom !== undefined) {
    if (fixedMode) state.zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
    else setLevel(levelFromHashZoom(v.zoom));
  }
  if (v.rot !== undefined) state.rot = normalizeRot(v.rot);
  if (v.x !== undefined && v.y !== undefined) {
    state.target.set(v.x, 0, -v.y);
    clampTarget(state.target);
  }
  if (v.place && v.place !== card.openId) openPlace(v.place, null, false);
  resize();
  dirty = true;
});

/** Whole-city mode: diorama base + streamed chunks (instanced details go into shared pools). */
async function startCity(index: CityIndex) {
  scene.add(buildBase(index.boundary, soil));
  panBounds = bounds(index.boundary);
  clampTarget(state.target);
  const pools = new InstancePools();
  scene.add(pools.group);
  chunks = new ChunkManager({
    index,
    urlFor: (id) => chunkUrls[id],
    build: (id, data) => {
      data.properties = { ...(data.properties ?? {}), boundary: index.boundary };
      return withPoolSink(
        (batches) => pools.add(id, batches),
        () => {
          const g = new Group();
          g.name = `chunk:${id}`;
          g.add(buildFootprints(data, { skip: ['building'], mpp: state.mpp }));
          const houses = buildShopHouses(data, seed);
          g.add(houses.group);
          g.add(buildRoofs(houses.specs, seed));
          g.add(buildTrees(placeTrees(data, seed), seed));
          g.add(buildDressing(houses.specs, data, seed));
          scene.add(g);
          return { group: g, specs: houses.specs, data };
        },
      );
    },
    dispose: (id, built) => {
      scene.remove(built.group);
      built.group.traverse((o) => (o as Mesh).geometry?.dispose());
      pools.remove(id);
    },
    onLoad: (id, built) => {
      systems.chunk(id, 'load', built);
      sun.shadow.needsUpdate = true;
      renderer.shadowMap.needsUpdate = true;
    },
    onUnload: (id, built) => systems.chunk(id, 'unload', built),
  });
  if (shotMode) await chunks.loadAll(screenView());
  else chunks.setView(screenView());
  if (hawa) scene.add(buildHawaMahal(hawa));
}

async function start() {
  resize();
  let slice: FootprintCollection = { type: 'FeatureCollection', features: [] };
  let specs: ShopHouseSpec[] = [];
  try {
    if (cityMode && cityIndex) {
      await startCity(cityIndex);
      throw 'city'; // skip the single-slice path below
    }
    slice = await loadSlice(sliceUrl);
    const boundary = (slice as unknown as { properties?: { boundary?: Pt[] } }).properties?.boundary;
    if (boundary) {
      scene.add(buildBase(boundary, soil));
      panBounds = bounds(boundary);
      clampTarget(state.target);
    }
    scene.add(buildFootprints(slice, { skip: ['building'], mpp: state.mpp }));
    const houses = buildShopHouses(slice, seed);
    specs = houses.specs;
    scene.add(houses.group);
    scene.add(buildRoofs(houses.specs, seed));
    scene.add(buildTrees(placeTrees(slice, seed), seed));
    scene.add(buildDressing(houses.specs, slice, seed));
    if (hawa) scene.add(buildHawaMahal(hawa));
  } catch (err) {
    if (err !== 'city') console.error('[pixeljaipur] slice failed to load', err);
  }
  window.__pjCity = cityMode ? () => ({ loaded: chunks?.loadedIds.length ?? 0, busy: chunks?.busy ?? false }) : undefined;
  if (!shotMode) {
    const entries: SearchEntry[] = [
      ...places.map((p) => ({ label: p.name, hint: p.nameHi ?? undefined, x: p.anchor[0], y: p.anchor[1], placeId: p.id })),
      ...((cityMode && cityIndex?.names) || []).map((n) => ({ label: n.name, hint: 'Street', x: n.at[0], y: n.at[1] })),
    ];
    new Search(document.body, entries, (e) => (e.placeId ? openPlace(e.placeId) : flyTo(e.x, e.y, 600)));
    if (cityMode && minimapData) minimap = new Minimap(document.body, minimapData, (x, y) => flyTo(x, y, 500));
  }
  if (initialPlace && placeById.has(initialPlace)) {
    // A shared link: open the card; only centre on the place if the link didn't set a view.
    openPlace(initialPlace, null, fromHash.zoom === undefined && !params.has('x'));
  }
  ctx = {
    scene,
    renderer,
    sun,
    slice,
    specs,
    places,
    clock,
    events,
    screenView,
    invalidate: () => (dirty = true),
    refreshShadows: () => {
      sun.shadow.needsUpdate = true;
      renderer.shadowMap.needsUpdate = true;
      dirty = true;
    },
    setBackdrop: (top, bottom) => pixel.setBackdrop(top, bottom),
    overlay,
    params,
    seed,
    shot: shotMode,
  };
  await systems.init(ctx);
  // Chunks built before the systems existed (screenshot mode loads them up front): replay.
  chunks?.forEachLoaded((id, built) => systems.chunk(id, 'load', built));
  systems.update(0, clock.now(), ctx);
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
