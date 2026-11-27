/**
 * Search box (Phase 3): find places (info-card landmarks) and named streets, then fly there.
 * Plain DOM, keyboard accessible (arrows + Enter, Esc clears), pixel styled via CSS variables.
 */

export interface SearchEntry {
  label: string;
  /** small grey hint, e.g. "Street" or the Hindi name */
  hint?: string;
  x: number;
  y: number;
  /** opens this info card when picked */
  placeId?: string;
}

/** Case/diacritic-insensitive ranking: prefix matches first, then word-starts, then substrings. */
export function searchEntries(entries: SearchEntry[], query: string, limit = 8): SearchEntry[] {
  const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const q = norm(query.trim());
  if (!q) return [];
  const scored: { e: SearchEntry; score: number }[] = [];
  for (const e of entries) {
    const l = norm(e.label);
    const h = norm(e.hint ?? '');
    let score = -1;
    if (l.startsWith(q)) score = 0;
    else if (l.split(/[\s,-]+/).some((w) => w.startsWith(q))) score = 1;
    else if (l.includes(q)) score = 2;
    else if (h.includes(q)) score = 3;
    if (score >= 0) scored.push({ e, score: score * 1000 + l.length + (e.placeId ? -500 : 0) });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.e);
}

export class Search {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private results: SearchEntry[] = [];
  private active = -1;

  constructor(
    parent: HTMLElement,
    private readonly entries: SearchEntry[],
    private readonly onPick: (e: SearchEntry) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pj-search';
    this.el.setAttribute('role', 'search');
    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.placeholder = 'Search places & streets';
    this.input.setAttribute('aria-label', 'Search places and streets');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-controls', 'pj-search-results');
    this.list = document.createElement('ul');
    this.list.id = 'pj-search-results';
    this.list.setAttribute('role', 'listbox');
    this.list.hidden = true;
    this.el.append(this.input, this.list);
    parent.appendChild(this.el);

    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.results.length) return;
        this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.results.length) % this.results.length;
        this.render();
      } else if (e.key === 'Enter') {
        const pick = this.results[Math.max(0, this.active)];
        if (pick) this.pick(pick);
      } else if (e.key === 'Escape') {
        this.input.value = '';
        this.update();
        this.input.blur();
      }
      e.stopPropagation(); // don't trigger map keys (Q/E/+/-) while typing
    });
  }

  private update(): void {
    this.results = searchEntries(this.entries, this.input.value);
    this.active = this.results.length ? 0 : -1;
    this.render();
  }

  private render(): void {
    this.list.replaceChildren(
      ...this.results.map((r, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === this.active));
        li.className = i === this.active ? 'is-active' : '';
        const name = document.createElement('span');
        name.textContent = r.label;
        li.append(name);
        if (r.hint) {
          const hint = document.createElement('small');
          hint.textContent = r.hint;
          li.append(hint);
        }
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.pick(r);
        });
        return li;
      }),
    );
    this.list.hidden = !this.results.length;
  }

  private pick(r: SearchEntry): void {
    this.input.value = r.label;
    this.results = [];
    this.render();
    this.input.blur();
    this.onPick(r);
  }
}
