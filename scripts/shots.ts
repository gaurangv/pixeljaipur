/**
 * Screenshot the scene for every pixel scale and rotation.
 *   npm run shots                 -> tests/shots/mpp{0.33,0.5,1}-rot{0..3}.png
 *   npm run shots -- --mpp 0.5    -> only that scale
 * Uses a Vite dev server and headless Chrome (installed Chrome first, then Playwright's Chromium) with SwiftShader WebGL.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const only = args.includes('--mpp') ? [Number(args[args.indexOf('--mpp') + 1])] : null;
const scales = only ?? [0.33, 0.5, 1];
const rots = [0, 1, 2, 3];
const outDir = resolve('tests/shots');
mkdirSync(outDir, { recursive: true });

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
      await page.goto(`${base}?shot=1&mpp=${mpp}&rot=${rot}`);
      await page.waitForFunction(() => window.__pjReady === true, null, { timeout: 30_000 });
      const file = resolve(outDir, `mpp${mpp}-rot${rot}.png`);
      await page.screenshot({ path: file });
      console.log('saved', file);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
