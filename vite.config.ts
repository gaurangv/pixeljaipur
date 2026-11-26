import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from /pixeljaipur/; the Pages workflow sets PAGES=1.
export default defineConfig({
  base: process.env.PAGES ? '/pixeljaipur/' : '/',
  server: { port: 5173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'] },
});
