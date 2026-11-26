/**
 * Screenshot the scene for every pixel scale and rotation.
 *   npm run shots                 -> tests/shots/mpp{0.33,0.5,1}-rot{0..3}.png
 *   npm run shots -- --mpp 0.5    -> only that scale
 *   npm run shots -- --mpp 0.5 --rot 2 --q "zoom=6&x=10&y=20"  -> one close-up
 * Uses a Vite dev server and headless Chrome (installed Chrome first, then Playwright's Chromium) with SwiftShader WebGL.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const only = args.includes('--mpp') ? [Number(args[args.indexOf('--mpp') + 1])] : null;
const scales = only ?? [0.33, 0.5, 1];
/** Extra query string, e.g. --q "zoom=6&x=20&y=40"; adds a suffix to file names. */
const extra = args.includes('--q') ? args[args.indexOf('--q') + 1] : '';
const rotsArg = args.includes('--rot') ? [Number(args[args.indexOf('--rot') + 1])] : null;
const tag = extra ? '-' + extra.replace(/[^a-z0-9.=-]+/gi, '_') : '';
const rots = rotsArg ?? [0, 1, 2, 3];
const outDir = resolve('tests/shots');
mkdirSync(outDir, { recursive: true });

/** Draw-call budget per frame (scene pass + shadow pass + upscale). */
const MAX_DRAW_CALLS = 150;
const failures: string[] = [];

const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'chrome', args: launchArgs });
  } catch {
    return await chromium.launch({ args: launchArgs });
  }
}

const server = await createServer({ server: { port: 5174, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5174/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));

try {
  for (const mpp of scales) {
    for (const rot of rots) {
      await page.goto(`${base}?shot=1&mpp=${mpp}&rot=${rot}${extra ? '&' + extra : ''}`);
      await page.waitForFunction(() => window.__pjReady === true, null, { timeout: 30_000 });
      const file = resolve(outDir, `mpp${mpp}-rot${rot}${tag}.png`);
      await page.screenshot({ path: file });
      const st = await page.evaluate(() => window.__pjStats);
      console.log('saved', file, st ? `calls=${st.calls} tris=${st.triangles} ms=${st.ms.toFixed(1)}` : '');
      if (st && st.calls > MAX_DRAW_CALLS) failures.push(`${file}: ${st.calls} draw calls > ${MAX_DRAW_CALLS}`);
    }
  }

  if (!only && !extra) {
    // Phone check: default view (Hawa Mahal) on a 390x844 touch screen at 3x DPR.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await phone.goto(`${base}?shot=1`);
    await phone.waitForFunction(() => window.__pjReady === true, null, { timeout: 30_000 });
    const file = resolve(outDir, 'phone-default.png');
    await phone.screenshot({ path: file });
    console.log('saved', file);
    // Info card as a bottom sheet (blurb only: no network in shot mode).
    await phone.goto(`${base}?shot=1&card=hawa-mahal`);
    await phone.waitForFunction(() => window.__pjReady === true, null, { timeout: 30_000 });
    await phone.screenshot({ path: resolve(outDir, 'phone-card.png') });
    console.log('saved', resolve(outDir, 'phone-card.png'));
    // Desktop card + pins.
    await page.goto(`${base}?shot=1&card=hawa-mahal`);
    await page.waitForFunction(() => window.__pjReady === true, null, { timeout: 30_000 });
    await page.screenshot({ path: resolve(outDir, 'desktop-card.png') });
    console.log('saved', resolve(outDir, 'desktop-card.png'));
    await phone.close();
  }
  if (failures.length) {
    console.error('BUDGET FAILURES:');
    for (const f of failures) console.error('  ' + f);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await server.close();
}
