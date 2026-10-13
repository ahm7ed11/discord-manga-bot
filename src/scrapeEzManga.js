
/**
 * scrapeEzManga.js  —  v2 Production
 * ────────────────────────────────────────────────────────────
 * Strategy (tried in order):
 *   1. WordPress REST API  /wp-json/wp/v2/manga?slug=...
 *   2. Madara AJAX action  wp_ajax_nopriv_manga_get_manga_data
 *   3. HTML scrape with Cloudflare-bypass headers (UA rotation)
 *
 * Zero extra npm packages — uses only built-in https/http.
 */

'use strict';

const https = require('https');
const http  = require('http');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function decode(str = '') {
  return str
    .replace(/&amp;/g,  '&').replace(/&lt;/g,  '<').replace(/&gt;/g,  '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripTags(str = '') {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Core fetch — returns { statusCode, body }
function httpGet(url, opts = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('Bad URL')); }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: parsed.hostname,
      port:     parsed.port || undefined,
      path:     parsed.pathname + parsed.search,
      method:   opts.method || 'GET',
      headers:  opts.headers || {},
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
        return httpGet(next, opts, hops + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(14000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const BROWSER_H = {
  'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':           'en-US,en;q=0.9,ar;q=0.8',
  'Accept-Encoding':           'identity',
  'Cache-Control':             'max-age=0',
  'Sec-Fetch-Dest':            'document',
  'Sec-Fetch-Mode':            'navigate',
  'Sec-Fetch-Site':            'none',
  'Sec-Fetch-User':            '?1',
  'Sec-Ch-Ua':                 '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'Sec-Ch-Ua-Mobile':          '?0',
  'Sec-Ch-Ua-Platform':        '"Windows"',
  'Upgrade-Insecure-Requests': '1',
  'Connection':                'keep-alive',
};

const API_H = {
  'User-Agent':      BROWSER_H['User-Agent'],
  'Accept':          'application/json, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',
  'Connection':      'keep-alive',
};

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.2277.128',
];

// ─── STRATEGY 1: WordPress REST API ──────────────────────────────────────────
async function tryWordPressApi(slug, base) {
  const endpoints = [
    `${base}/wp-json/wp/v2/manga?slug=${encodeURIComponent(slug)}&_fields=id,title,content,excerpt,meta,acf,featured_media,_links`,
    `${base}/wp-json/wp/v2/manga?slug=${encodeURIComponent(slug)}`,
    `${base}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id,title,content,excerpt,meta,featured_media`,
  ];

  for (const ep of endpoints) {
    try {
      const r = await httpGet(ep, { headers: API_H });
      if (r.statusCode !== 200) continue;
      const arr = JSON.parse(r.body);
      if (!Array.isArray(arr) || !arr.length) continue;
      const p = arr[0];

      const title = decode(p.title?.rendered || '');
      if (!title) continue;

      const rawSyn  = p.excerpt?.rendered || p.content?.rendered || '';
      const synopsis = stripTags(rawSyn).substring(0, 1000) || null;

      let coverUrl = null;
      if (p.featured_media) {
        try {
          const mr = await httpGet(`${base}/wp-json/wp/v2/media/${p.featured_media}?_fields=source_url,media_details`, { headers: API_H });
          if (mr.statusCode === 200) {
            const m = JSON.parse(mr.body);
            coverUrl = m.source_url || m.media_details?.sizes?.full?.source_url || m.media_details?.sizes?.large?.source_url || null;
          }
        } catch (_) {}
      }

      const meta   = p.meta || p.acf || {};
      const author = meta._manga_author || meta.manga_author || meta.author || null;

      // Genres from taxonomy
      let genres = [];
      const termLinks = (p._links?.['wp:term'] || []);
      for (const tl of termLinks) {
        try {
          const tr = await httpGet(tl.href + '&_fields=name,taxonomy', { headers: API_H });
          if (tr.statusCode !== 200) continue;
          const terms = JSON.parse(tr.body);
          if (Array.isArray(terms)) {
            const g = terms.filter(t => /genre|category/i.test(t.taxonomy || '')).map(t => decode(t.name));
            genres = [...genres, ...g];
          }
        } catch (_) {}
      }

      return { title, synopsis, author: author ? decode(author) : null, genres: genres.slice(0, 5), coverUrl, source: 'wp-api' };
    } catch (_) { continue; }
  }
  return null;
}

// ─── STRATEGY 2: Madara AJAX ──────────────────────────────────────────────────
async function tryMadaraAjax(slug, base) {
  try {
    const body = `action=manga_get_manga_data&manga=${encodeURIComponent(slug)}`;
    const r = await httpGet(`${base}/wp-admin/admin-ajax.php`, {
      method: 'POST',
      headers: {
        ...API_H,
        'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer':          `${base}/series/${slug}/`,
        'Origin':           base,
        'Content-Length':   Buffer.byteLength(body).toString(),
      },
      body,
    });
    if (r.statusCode !== 200) return null;
    const d = JSON.parse(r.body);
    if (!d?.manga_title) return null;
    return {
      title:    decode(d.manga_title || ''),
      synopsis: d.description ? stripTags(d.description).substring(0, 1000) : null,
      author:   d.manga_author ? decode(d.manga_author) : null,
      genres:   Array.isArray(d.manga_genres) ? d.manga_genres.map(g => decode(g)).slice(0, 5) : [],
      coverUrl: d.manga_image || null,
      source:   'madara-ajax',
    };
  } catch (_) { return null; }
}

// ─── STRATEGY 3: HTML scrape with UA rotation ─────────────────────────────────
async function tryHtmlScrape(seriesUrl) {
  for (const ua of UA_POOL) {
    try {
      const r = await httpGet(seriesUrl, { headers: { ...BROWSER_H, 'User-Agent': ua } });
      if (r.statusCode === 403 || r.statusCode === 503) continue;
      if (r.statusCode !== 200) continue;
      const html = r.body;

      const getMeta = (prop) => {
        const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,'i').exec(html);
        if (r1) return decode(r1[1]);
        const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,'i').exec(html);
        if (r2) return decode(r2[1]);
        return null;
      };

      let title = getMeta('og:title') || getMeta('twitter:title');
      if (!title) { const t = /<title[^>]*>([^<]+)<\/title>/i.exec(html); if (t) title = decode(t[1]); }
      if (!title) continue;
      title = title.replace(/\s*[\|\-–—]\s*(?:EZ\s*Manga|Read.*|Manga.*)/i, '').trim();

      const synopsis = (getMeta('og:description') || getMeta('description') || '').substring(0, 1000) || null;
      const coverUrl = getMeta('og:image') || getMeta('twitter:image') || null;

      let author = null;
      for (const p of [
        /class=["'][^"']*author-content[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([^<]{2,60})<\/a>/i,
        /class=["'][^"']*manga-authors?[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([^<]{2,60})<\/a>/i,
        /"author"\s*:\s*"([^"]{2,60})"/i,
        /data-author=["']([^"']{2,60})["']/i,
      ]) { const m = p.exec(html); if (m?.[1]?.trim().length > 1) { author = decode(m[1]); break; } }

      let genres = [];
      const gb = /class=["'][^"']*genres-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
      if (gb) genres = [...gb[1].matchAll(/<a[^>]*>([^<]{2,30})<\/a>/g)].map(m => decode(m[1])).slice(0, 5);

      const st = /\b(OnGoing|Ongoing|Completed|Hiatus|Dropped)\b/i.exec(html);
      const status = st ? st[1] : 'Ongoing';

      return { title, synopsis, author, genres, coverUrl, status, source: 'html' };
    } catch (_) { continue; }
  }
  return null;
}

// ─── URL VALIDATOR ────────────────────────────────────────────────────────────
function validateUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('ezmanga'))   return { valid: false, reason: 'URL must be from ezmanga.org' };
    if (!u.pathname.startsWith('/series/')) return { valid: false, reason: 'URL must be a /series/... page' };
    return { valid: true };
  } catch { return { valid: false, reason: 'Invalid URL format' }; }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
async function scrapeSeriesPage(url) {
  const v = validateUrl(url);
  if (!v.valid) throw new Error(v.reason);

  const cleanUrl = url.split('?')[0].split('#')[0].replace(/\/$/, '');
  const slug     = new URL(cleanUrl).pathname.replace('/series/', '').replace(/\/$/, '');
  const base     = 'https://ezmanga.org';
  const errors   = [];

  // 1. WP REST API
  try {
    const d = await tryWordPressApi(slug, base);
    if (d?.title) return _build(d, slug, cleanUrl);
  } catch (e) { errors.push(`WP-API: ${e.message}`); }

  // 2. Madara AJAX
  try {
    const d = await tryMadaraAjax(slug, base);
    if (d?.title) return _build(d, slug, cleanUrl);
  } catch (e) { errors.push(`AJAX: ${e.message}`); }

  // 3. HTML scrape
  try {
    const d = await tryHtmlScrape(cleanUrl);
    if (d?.title) return _build(d, slug, cleanUrl);
  } catch (e) { errors.push(`HTML: ${e.message}`); }

  throw new Error(
    `Could not fetch series data (all methods blocked).\n` +
    `Details: ${errors.join(' | ')}\n\n` +
    `💡 Use \`/manga\` and fill in the details manually.`
  );
}

function _build(d, slug, seriesUrl) {
  return {
    title:        d.title,
    synopsis:     d.synopsis  || null,
    author:       d.author    || null,
    genres:       d.genres    || [],
    status:       d.status    || 'Ongoing',
    coverUrl:     d.coverUrl  || null,
    chapterCount: d.chapterCount || null,
    seriesUrl,
    slug,
    source:       d.source,
  };
}

module.exports = { scrapeSeriesPage, validateUrl };