/**
 * Fails if the gzipped initial download (dist/) exceeds the budget. Run after `npm run build`.
 * Streamed city chunks (assets/<cx>_<cy>-<hash>.json, fetched only around the view) and the
 * old single-slice data (only for ?slice=slice1) are reported separately, not budgeted.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_MB = 2;
const streamed = (name: string) => /^-?\d+_-?\d+-[\w-]+\.json$/.test(name) || /^slice1-[\w-]+\.geojson$/.test(name);
const t = { initial: [0, 0], streamed: [0, 0] };
let chunks = 0;
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const b = readFileSync(p);
      const k = streamed(f) ? 'streamed' : 'initial';
      if (k === 'streamed') chunks++;
      t[k][0] += b.length;
      t[k][1] += gzipSync(b, { level: 9 }).length;
    }
  }
};
walk('dist');
const mb = (n: number) => (n / 1e6).toFixed(2);
console.log(`initial: ${mb(t.initial[0])} MB raw, ${mb(t.initial[1])} MB gzip (budget ${BUDGET_MB} MB)`);
console.log(`streamed on demand: ${chunks} files, ${mb(t.streamed[0])} MB raw, ${mb(t.streamed[1])} MB gzip`);
if (t.initial[1] / 1e6 > BUDGET_MB) {
  console.error('Initial download over budget');
  process.exit(1);
}
