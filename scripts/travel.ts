/**
 * Phase 3 "done when": travel from Chandpol to Sanganeri Gate without a loading pause.
 *   npm run travel             (headless Chrome, SwiftShader: slower than a real GPU)
 *   npm run travel -- --secs 20 --level 3
 *
 * Pans the camera along the route by updating the URL hash, samples the chunk streamer
 * (window.__pjCity) and frame times, and reports the longest stretch during which chunks
 * needed by the view were still missing. Fails if it exceeds --max-gap ms (default 1500,
 * generous for software rendering; on a real GPU expect far less).
 */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (k: string, d: number) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const SECS = opt('--secs', 20);
const LEVEL = opt('--level', 3);
const MAX_GAP = opt('--max-gap', 1500);

// Local metres (x east, y north) from Badi Chaupar.
const CHANDPOL = [-1709, 433];
const SANGANERI = [-190, -739];

const server = await createServer({ server: { port: 5178, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls!.local[0];
const browser = await (async () => {
  const a = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  try {
    return await chromium.launch({ channel: 'chrome', args: a });
  } catch {
    return await chromium.launch({ args: a });
  }
})();
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}#${LEVEL}/${CHANDPOL[0]}/${CHANDPOL[1]}/0`);
  await page.waitForFunction(() => !!window.__pjCity && !window.__pjCity().busy, null, { timeout: 120_000 });
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[] };
    w.__frames = [];
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const steps = SECS * 10;
  let gapStart = -1;
  let worstGap = 0;
  let maxLoaded = 0;
  const t0 = Date.now();
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const x = CHANDPOL[0] + (SANGANERI[0] - CHANDPOL[0]) * k;
    const y = CHANDPOL[1] + (SANGANERI[1] - CHANDPOL[1]) * k;
    await page.evaluate((h) => (location.hash = h), `#${LEVEL}/${x.toFixed(1)}/${y.toFixed(1)}/0`);
    await page.waitForTimeout(100);
    const st = await page.evaluate(() => window.__pjCity!());
    maxLoaded = Math.max(maxLoaded, st.loaded);
    const now = Date.now() - t0;
    if (st.busy && gapStart < 0) gapStart = now;
    if (!st.busy && gapStart >= 0) {
      worstGap = Math.max(worstGap, now - gapStart);
      gapStart = -1;
    }
  }
  await page.waitForFunction(() => !window.__pjCity!().busy, null, { timeout: 60_000 });
  if (gapStart >= 0) worstGap = Math.max(worstGap, Date.now() - t0 - gapStart);
  const frames = (await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames)).slice(5).sort((a, b) => a - b);
  const pct = (p: number) => frames[Math.min(frames.length - 1, Math.floor(frames.length * p))]?.toFixed(1);
  const stats = await page.evaluate(() => window.__pjStats);
  console.log(`route Chandpol -> Sanganeri Gate (${Math.round(Math.hypot(SANGANERI[0] - CHANDPOL[0], SANGANERI[1] - CHANDPOL[1]))} m) in ${SECS}s at level ${LEVEL}`);
  console.log(`longest wait for chunks in view: ${worstGap} ms (limit ${MAX_GAP}); max chunks loaded: ${maxLoaded}`);
  console.log(`frame ms: median ${pct(0.5)}, p95 ${pct(0.95)}, max ${pct(0.999)}; last frame calls=${stats?.calls} tris=${stats?.triangles}`);
  if (errors.length) console.log('page errors:', errors);
  if (worstGap > MAX_GAP || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
