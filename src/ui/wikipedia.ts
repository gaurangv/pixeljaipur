/**
 * Live Wikipedia summaries for info cards, fetched only when a card opens.
 * REST endpoint (CORS-enabled, no key): /api/rest_v1/page/summary/{title}
 * Text is CC BY-SA 4.0; the card must show attribution and a link.
 */
export interface WikiSummary {
  title: string;
  /** Plain-text lead paragraph(s). Rendered with textContent, never as HTML. */
  extract: string;
  /** Article URL. */
  url: string;
  thumbnail?: { src: string; width: number; height: number };
  /** Wikimedia Commons file page for the image (for credit/licence). */
  imagePage?: string;
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

const memory = new Map<string, WikiSummary>();
const API = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

export const articleUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

/** Commons file page from an upload.wikimedia.org image URL (original or thumb). */
export function commonsPage(src: string): string | undefined {
  const m = /(?:upload|thumb)\.wikimedia\.org\/wikipedia\/(?:commons|en)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(src);
  return m ? `https://commons.wikimedia.org/wiki/File:${m[1]}` : undefined;
}

export function parseSummary(json: any, fallbackTitle: string): WikiSummary {
  const title: string = json?.title ?? fallbackTitle;
  const s: WikiSummary = {
    title,
    extract: typeof json?.extract === 'string' ? json.extract : '',
    url: json?.content_urls?.desktop?.page ?? articleUrl(title),
  };
  const t = json?.thumbnail;
  if (t?.source) {
    s.thumbnail = { src: t.source, width: t.width, height: t.height };
    s.imagePage = commonsPage(json?.originalimage?.source ?? t.source);
  }
  return s;
}

export async function fetchSummary(title: string, opts: FetchOptions = {}): Promise<WikiSummary> {
  const key = `pj:wiki:${title}`;
  const hit = memory.get(title);
  if (hit) return hit;
  const storage = opts.storage === undefined ? safeSession() : opts.storage;
  const stored = storage?.getItem(key);
  if (stored) {
    const s = JSON.parse(stored) as WikiSummary;
    memory.set(title, s);
    return s;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(API + encodeURIComponent(title.replace(/ /g, '_')), {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
    const s = parseSummary(await res.json(), title);
    if (!s.extract) throw new Error('Wikipedia: empty extract');
    memory.set(title, s);
    try {
      storage?.setItem(key, JSON.stringify(s));
    } catch {
      /* storage full or blocked: memory cache is enough */
    }
    return s;
  } finally {
    clearTimeout(timer);
  }
}

/** Test hook. */
export function clearWikiCache(): void {
  memory.clear();
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
