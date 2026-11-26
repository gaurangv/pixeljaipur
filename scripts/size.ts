/** Fails if the gzipped production bundle (dist/) exceeds the budget. Run after `npm run build`. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_MB = 2;
let raw = 0;
let gz = 0;
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const b = readFileSync(p);
      raw += b.length;
      gz += gzipSync(b, { level: 9 }).length;
    }
  }
};
walk('dist');
const mb = (n: number) => (n / 1e6).toFixed(2);
console.log(`dist: ${mb(raw)} MB raw, ${mb(gz)} MB gzip (budget ${BUDGET_MB} MB)`);
if (gz / 1e6 > BUDGET_MB) {
  console.error('Bundle over budget');
  process.exit(1);
}
