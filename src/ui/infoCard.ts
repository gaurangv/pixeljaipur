import type { Place } from './places';
import { articleUrl, fetchSummary, type WikiSummary } from './wikipedia';

/**
 * Landmark info card: a non-modal dialog (the map stays usable behind it).
 * Right-hand panel on wide screens, bottom sheet on phones (CSS).
 * All remote text goes in via textContent, never innerHTML.
 */
export class InfoCard {
  readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly hiEl: HTMLElement;
  private readonly figure: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly imgCredit: HTMLAnchorElement;
  private readonly body: HTMLElement;
  private readonly status: HTMLElement;
  private readonly links: HTMLElement;
  private readonly credit: HTMLElement;
  private current: string | null = null;
  private opener: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    private readonly opts: { live: boolean; onClose: () => void },
  ) {
    const el = (this.el = h('aside', 'pj-card'));
    el.id = 'pj-card';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'pj-card-title');
    el.hidden = true;

    const close = h('button', 'pj-card__close') as HTMLButtonElement;
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());

    this.titleEl = h('h2', 'pj-card__title');
    this.titleEl.id = 'pj-card-title';
    this.hiEl = h('p', 'pj-card__hi');
    this.hiEl.lang = 'hi';

    this.figure = h('figure', 'pj-card__figure');
    this.img = document.createElement('img');
    this.img.decoding = 'async';
    this.imgCredit = link('#', 'Image: Wikimedia Commons');
    this.imgCredit.className = 'pj-card__imgcredit';
    this.figure.append(this.img, this.imgCredit);

    this.body = h('p', 'pj-card__body');
    this.status = h('p', 'pj-card__status');
    this.status.setAttribute('aria-live', 'polite');
    this.links = h('p', 'pj-card__links');
    this.credit = h('p', 'pj-card__credit');

    el.append(close, this.titleEl, this.hiEl, this.figure, this.body, this.status, this.links, this.credit);
    parent.appendChild(el);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
  }

  get openId(): string | null {
    return this.current;
  }

  open(place: Place, opener: HTMLElement | null = null): void {
    this.current = place.id;
    this.opener = opener;
    this.titleEl.textContent = place.name;
    this.hiEl.textContent = place.nameHi ?? '';
    this.hiEl.hidden = !place.nameHi;
    this.figure.hidden = true;
    this.body.textContent = place.blurb;
    this.renderLinks(place, null);
    this.credit.textContent = '';
    this.el.hidden = false;

    if (place.wiki && this.opts.live) {
      this.status.textContent = 'Loading from Wikipedia…';
      const id = place.id;
      fetchSummary(place.wiki)
        .then((s) => {
          if (this.current === id) this.showSummary(place, s);
        })
        .catch(() => {
          if (this.current === id) this.status.textContent = 'Could not reach Wikipedia; showing a short description.';
        });
    } else {
      this.status.textContent = place.wiki ? '' : 'No Wikipedia article yet.';
    }
    this.titleEl.tabIndex = -1;
    this.titleEl.focus({ preventScroll: true });
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.current = null;
    this.opts.onClose();
    this.opener?.focus({ preventScroll: true });
    this.opener = null;
  }

  private showSummary(place: Place, s: WikiSummary): void {
    this.body.textContent = s.extract;
    this.status.textContent = '';
    if (s.thumbnail) {
      this.img.src = s.thumbnail.src;
      this.img.width = s.thumbnail.width;
      this.img.height = s.thumbnail.height;
      this.img.alt = place.name;
      this.imgCredit.href = s.imagePage ?? s.url;
      this.figure.hidden = false;
    }
    this.renderLinks(place, s);
    this.credit.replaceChildren(
      'Text from ',
      link(s.url, 'Wikipedia'),
      ', ',
      link('https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0'),
      '.',
    );
  }

  private renderLinks(place: Place, s: WikiSummary | null): void {
    const items: (Node | string)[] = [];
    if (place.wiki) items.push(link(s?.url ?? articleUrl(place.wiki), 'Read more on Wikipedia →'));
    if (place.lonlat) {
      const [lon, lat] = place.lonlat;
      if (items.length) items.push(' · ');
      items.push(link(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=19/${lat}/${lon}`, 'OpenStreetMap'));
    }
    this.links.replaceChildren(...items);
  }
}

function h(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}
