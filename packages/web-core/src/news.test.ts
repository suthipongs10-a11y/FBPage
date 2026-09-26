import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalNewsUrl, fetchFeed, normalizeTitle, parseFeed, politeFetchText, stripHtml, tavilySearch } from './news';
import { startMockWeb } from './mock-web';

describe('news parsing (no network)', () => {
  it('parses RSS 2.0: escaped HTML, CDATA, skips items without http link', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>ข่าว A</title>
      <item><title><![CDATA[หัวข้อ &amp; ข่าว]]></title><link>https://a.example/x</link><description>&lt;p&gt;เกริ่น &lt;b&gt;สั้น&lt;/b&gt;&lt;/p&gt;</description><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate></item>
      <item><title>ไม่มีลิงก์</title><link>javascript:alert(1)</link></item>
      <item><title>guid เป็นลิงก์</title><guid isPermaLink="true">https://a.example/g</guid><dc:date>bad-date</dc:date></item>
    </channel></rss>`;
    const f = parseFeed(xml);
    expect(f.title).toBe('ข่าว A');
    expect(f.entries).toHaveLength(2);
    expect(f.entries[0]).toMatchObject({ title: 'หัวข้อ & ข่าว', url: 'https://a.example/x', snippet: 'เกริ่น สั้น', sourceName: 'ข่าว A' });
    expect(f.entries[0]!.publishedAt?.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(f.entries[1]).toMatchObject({ url: 'https://a.example/g', publishedAt: null });
  });
  it('parses Atom alternate links and respects the limit', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>${Array.from({ length: 5 }, (_, i) => `<entry><title>E${i}</title><link rel="self" href="https://s.example/${i}.xml"/><link rel="alternate" href="https://s.example/${i}"/><summary>s${i}</summary><published>2026-09-0${i + 1}T00:00:00Z</published></entry>`).join('')}</feed>`;
    const f = parseFeed(xml, 3);
    expect(f.entries.map(e => e.url)).toEqual(['https://s.example/0', 'https://s.example/1', 'https://s.example/2']);
  });
  it('strips scripts and tags', () => { expect(stripHtml('<p>a<script>evil()</script> <i>b</i></p>')).toBe('a b'); });
  it('canonical URL drops tracking params, www, fragment and trailing slash', () => {
    expect(canonicalNewsUrl('https://WWW.News.example.com/a/elephant/?utm_source=rss&b=2&a=1#top')).toBe('https://news.example.com/a/elephant?a=1&b=2');
    expect(canonicalNewsUrl('https://news.example.com/a/elephant?utm_source=rss')).toBe(canonicalNewsUrl('https://www.news.example.com/a/elephant/'));
  });
  it('normalizes Thai titles ignoring spaces and punctuation', () => { expect(normalizeTitle('ทีมกู้ภัย ช่วยลูกช้าง!!')).toBe(normalizeTitle('ทีมกู้ภัยช่วยลูกช้าง')); });
});

describe('news fetching (mock server)', () => {
  let mock: Awaited<ReturnType<typeof startMockWeb>>;
  beforeAll(async () => { mock = await startMockWeb(); });
  afterAll(() => mock.server.close());

  it('fetches an RSS feed through a redirect', async () => {
    const f = await fetchFeed(`${mock.url}/news/redirect`, { allowPrivate: true });
    expect(f.title).toBe('ข่าวจำลอง'); expect(f.entries).toHaveLength(2);
    expect(f.entries[0]!.snippet).toBe('เจ้าหน้าที่ใช้เวลา 3 ชั่วโมงช่วยลูกช้างออกจากบ่อน้ำ');
  });
  it('parses Atom from the mock', async () => {
    const f = await fetchFeed(`${mock.url}/news/atom.xml`, { allowPrivate: true });
    expect(f.entries[0]).toMatchObject({ title: 'Mars & Moon', url: 'https://atom.example.com/mars' });
  });
  it('blocks private targets (SSRF), robots-disallowed paths, non-feeds and oversized bodies', async () => {
    await expect(fetchFeed(`${mock.url}/news/rss.xml`)).rejects.toThrow(/ภายใน/);
    await expect(fetchFeed('file:///etc/passwd', { allowPrivate: true })).rejects.toThrow(/http/);
    await expect(fetchFeed(`${mock.url}/admin/feed.xml`, { allowPrivate: true })).rejects.toThrow(/robots/);
    await expect(fetchFeed(`${mock.url}/news/not-a-feed`, { allowPrivate: true })).rejects.toThrow(/ไม่ใช่ RSS/);
    await expect(politeFetchText(`${mock.url}/news/rss.xml`, { allowPrivate: true, maxBytes: 100 })).rejects.toThrow(/ใหญ่เกิน/);
  });
  it('re-checks the SSRF guard on every redirect hop', async () => {
    const hop: typeof fetch = async (input) => String(input).startsWith('https://public.example')
      ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } })
      : new Response('secret');
    await expect(politeFetchText('https://public.example/feed', { fetchImpl: hop })).rejects.toThrow(/ภายใน/);
  });
  it('searches Tavily news with a bearer key; bad key is a clear error', async () => {
    const r = await tavilySearch('TAVILY_OK', 'ข่าวแปลก', { baseUrl: `${mock.url}/tavily` });
    expect(r.map(x => x.sourceName)).toEqual(['science.example.org', 'news.example.com']);
    expect(mock.state.news.tavilyQueries.at(-1)).toBe('ข่าวแปลก');
    await expect(tavilySearch('WRONG', 'x', { baseUrl: `${mock.url}/tavily` })).rejects.toThrow(/API key/);
  });
});
