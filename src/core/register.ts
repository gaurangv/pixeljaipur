import type { System } from './systems';

/*
 * The ONE shared file Phase 2 streams edit. Each stream adds exactly one import line
 * in its own block and one entry in its own slot below; nothing else. Keeping the
 * blocks separated by untouched lines lets git merge the branches without conflicts.
 */

// --- p2-daycycle imports ---
import { createDayCycle } from '../sky/daycycle';

// --- p2-traffic imports ---
import { createTraffic } from '../actors/traffic';

// --- p2-sound imports ---
import { soundSystem } from '../audio';

export function registerSystems(): System[] {
  return [
    // --- p2-daycycle system ---
    createDayCycle(),

    // --- p2-traffic system ---
    createTraffic(),

    // --- p2-sound system ---
    soundSystem(),
  ];
}
