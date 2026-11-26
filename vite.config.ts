import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from /pixeljaipur/; the Pages workflow sets PAGES=1.
export default defineConfig({
  base: process.env.PAGES ? '/pixeljaipur/' : '/',
  // Worktrees run side by side: PORT=5174 npm run dev (default 5173).
  server: { port: Number(process.env.PORT) || 5173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'] },
});
