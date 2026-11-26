import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearWikiCache, commonsPage, fetchSummary, parseSummary } from '../src/ui/wikipedia';

const sample = {
  title: 'Hawa Mahal',
  extract: 'The Hawa Mahal is a palace in Jaipur.',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Hawa_Mahal' } },
  thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/East_facade_Hawa_Mahal_Jaipur.jpg/320px-East_facade_Hawa_Mahal_Jaipur.jpg', width: 320, height: 213 },
  originalimage: { source: 'https://upload.wikimedia.org/wikipedia/commons/4/41/East_facade_Hawa_Mahal_Jaipur.jpg' },
};
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('wikipedia client', () => {
  beforeEach(() => clearWikiCache());

  it('parses a summary and finds the Commons file page', () => {
    const s = parseSummary(sample, 'x');
    expect(s.extract).toContain('palace');
    expect(s.url).toBe('https://en.wikipedia.org/wiki/Hawa_Mahal');
    expect(s.imagePage).toBe('https://commons.wikimedia.org/wiki/File:East_facade_Hawa_Mahal_Jaipur.jpg');
  });

  it('commonsPage handles the thumb.wikimedia.org host and strips tracking params', () => {
    const src =
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/41/East_facade_%28July_2022%29_-_img_01.jpg/330px-East_facade_%28July_2022%29_-_img_01.jpg?utm_source=en.wikipedia.org';
    expect(commonsPage(src)).toBe('https://commons.wikimedia.org/wiki/File:East_facade_%28July_2022%29_-_img_01.jpg');
    expect(commonsPage(src + '&x=1#frag')).not.toContain('utm');
  });

  it('commonsPage also works from a thumb URL', () => {
    expect(commonsPage(sample.thumbnail.source)).toBe('https://commons.wikimedia.org/wiki/File:East_facade_Hawa_Mahal_Jaipur.jpg');
  });

  it('fetches once, then serves from cache', async () => {
    const f = vi.fn(() => ok(sample));
    await fetchSummary('Hawa Mahal', { fetchImpl: f as unknown as typeof fetch, storage: null });
    await fetchSummary('Hawa Mahal', { fetchImpl: f as unknown as typeof fetch, storage: null });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('https://en.wikipedia.org/api/rest_v1/page/summary/Hawa_Mahal');
  });

  it('uses the canonical title the API returns (redirects)', async () => {
    const f = vi.fn(() => ok({ ...sample, title: 'Hawa Mahal' }));
    const s = await fetchSummary('Palace of the Winds', { fetchImpl: f as unknown as typeof fetch, storage: null });
    expect(s.title).toBe('Hawa Mahal');
  });

  it('rejects on HTTP errors and empty extracts, so the card keeps its blurb', async () => {
    const e404 = vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })));
    await expect(fetchSummary('Nope', { fetchImpl: e404 as unknown as typeof fetch, storage: null })).rejects.toThrow();
    const empty = vi.fn(() => ok({ title: 'X', extract: '' }));
    await expect(fetchSummary('X', { fetchImpl: empty as unknown as typeof fetch, storage: null })).rejects.toThrow();
  });

  it('times out', async () => {
    const hang = vi.fn((_u: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    await expect(
      fetchSummary('Slow', { fetchImpl: hang as unknown as typeof fetch, storage: null, timeoutMs: 20 }),
    ).rejects.toThrow('aborted');
  });
});
