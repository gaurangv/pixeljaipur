/** The user's sound on/off choice, remembered in localStorage. Never touched in shot mode. */

export const SOUND_PREF_KEY = 'pj-sound';

/** Minimal Storage shape so tests can pass a fake. */
export type PrefStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Sound is OFF unless the user turned it on before. Storage errors (private mode) read as off. */
export function loadSoundOn(store: PrefStore | null | undefined): boolean {
  try {
    return store?.getItem(SOUND_PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveSoundOn(store: PrefStore | null | undefined, on: boolean): void {
  try {
    store?.setItem(SOUND_PREF_KEY, on ? 'on' : 'off');
  } catch {
    // storage full / blocked: the choice just won't be remembered
  }
}

/** localStorage if it is reachable (it throws in some sandboxed iframes). */
export function browserStore(): PrefStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
