// Free web photos for mood boards and mockups. Same pattern as assets.mjs: the SERVER talks to a fixed list of
// keyless, openly licensed image APIs (Openverse, Wikimedia Commons), never to an agent-supplied URL, and the
// bytes are checked by magic number before they are stored as a project reference (store.addReference).
// Unsplash / Pexels / Pixabay stay out: they need API keys.
import { imageInfo, MAX_IMAGE_BYTES } from './images.mjs';

export const OPENVERSE = 'https://api.openverse.org';
export const COMMONS = 'https://commons.wikimedia.org';
const COMMONS_FILES = 'upload.wikimedia.org'; // the only host Commons image bytes may come from
const TIMEOUT_MS = 10_000;
const QUERY_RE = /^[\p{L}\p{N} ._-]{1,60}$/u;
const OPENVERSE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SOURCES = ['openverse', 'commons'];
// Openverse's own licence codes that are safe for brand work: no NC (non-commercial) and no ND (no derivatives).
export const OPENVERSE_LICENSES = 'cc0,pdm,by,by-sa';

export function cleanQuery(q) {
  const s = String(q ?? '').trim();
  if (!QUERY_RE.test(s)) throw new Error('query must be 1-60 characters: letters, digits, spaces, dots, hyphens.');
  return s;
}

// "photo:openverse:<uuid>" style ids are returned by search; `add` takes them back. Anything else is refused.
export function splitId(id) {
  const m = /^(openverse|commons):([A-Za-z0-9-]{1,40})$/.exec(String(id ?? '').trim());
  if (!m) throw new Error(`"${id}" must look like "openverse:<uuid>" or "commons:<page id>" (copy it from a search result).`);
  const [, source, ref] = m;
  if (source === 'openverse' && !OPENVERSE_ID_RE.test(ref)) throw new Error(`"${id}" is not a valid Openverse id.`);
  if (source === 'commons' && !/^\d{1,12}$/.test(ref)) throw new Error(`"${id}" is not a valid Commons page id.`);
  return { source, ref };
}

// Commercial-safe means CC0, public domain, CC BY or CC BY-SA. NC / ND and anything unknown is out.
export function commercialSafe(licenseName) {
  const s = String(licenseName ?? '').toLowerCase().replace(/[-_]/g, ' ').trim();
  if (/\b(nc|nd)\b|non ?commercial|no ?deriv/.test(s)) return false;
  return /^(cc0|public domain|pdm|cc by)\b/.test(s);
}

// Commons returns HTML in some metadata fields ("<a href=...>Jane</a>"); keep the text only.
const plain = (v) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 120);

export function fromOpenverse(r) {
  const license = r.license === 'cc0' ? 'CC0' : r.license === 'pdm' ? 'Public domain' : `CC ${String(r.license).toUpperCase()} ${r.license_version ?? ''}`.trim();
  return {
    id: `openverse:${r.id}`, title: plain(r.title) || 'Untitled', creator: plain(r.creator) || 'Unknown', license,
    license_url: r.license_url ?? null, source_url: r.foreign_landing_url ?? null, width: r.width ?? null, height: r.height ?? null,
  };
}

export function fromCommons(p) {
  const ii = p.imageinfo?.[0];
  if (!ii) return null;
  const x = ii.extmetadata ?? {};
  return {
    id: `commons:${p.pageid}`, title: plain(x.ObjectName?.value) || plain(p.title).replace(/^File:/, '').replace(/\.\w+$/, ''),
    creator: plain(x.Artist?.value) || 'Unknown', license: plain(x.LicenseShortName?.value),
    license_url: x.LicenseUrl?.value ?? null, source_url: ii.descriptionurl ?? null,
    width: ii.thumbwidth ?? ii.width ?? null, height: ii.thumbheight ?? ii.height ?? null,
    _thumb: ii.thumburl ?? ii.url, _mime: ii.mime,
  };
}

// The line a brand guidelines page prints under a photo. CC BY / BY-SA require it; harmless for CC0.
export function creditLine(c) {
  return `"${c.title}" by ${c.creator}, ${c.license}${c.source_url ? ` (${c.source_url})` : ''}`;
}

export class WebImages {
  // fetchImpl is injectable so tests never touch the network.
  constructor(fetchImpl = globalThis.fetch) { this.fetch = fetchImpl; }

  async _get(url, { json = true, maxBytes = 2_000_000 } = {}) {
    let res;
    try {
      res = await this.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'design-canvas/1.0 (local design tool)', Accept: json ? 'application/json' : 'image/*' } });
    } catch (e) {
      throw new Error(`Could not reach ${new URL(url).host} (${e.name === 'TimeoutError' ? 'timed out' : e.message}). Offline?`);
    }
    if (res.status === 429) throw new Error(`${new URL(url).host} rate limit reached; wait a minute and try again.`);
    if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`${new URL(url).host} response is larger than expected; ignored.`);
    return json ? JSON.parse(buf.toString('utf8')) : buf;
  }

  async search(query, { source = 'openverse', limit = 8 } = {}) {
    if (!SOURCES.includes(source)) throw new Error(`source must be one of: ${SOURCES.join(', ')}.`);
    const q = encodeURIComponent(cleanQuery(query));
    const n = Math.min(Math.max(Math.trunc(limit) || 8, 1), 20);
    if (source === 'openverse') {
      const j = await this._get(`${OPENVERSE}/v1/images/?q=${q}&license=${OPENVERSE_LICENSES}&page_size=${n}&mature=false`);
      return (j.results ?? []).map(fromOpenverse).filter((r) => OPENVERSE_ID_RE.test(r.id.slice(10)));
    }
    const j = await this._get(`${COMMONS}/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${Math.min(n * 2, 30)}&gsrsearch=${q}%20filetype:bitmap&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1600`);
    const pages = Object.values(j.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return pages.map(fromCommons).filter((r) => r && commercialSafe(r.license)).slice(0, n).map(({ _thumb, _mime, ...r }) => r); // internal fields stay server-side
  }

  // Re-reads the metadata from the source (so credit can never be forged by the caller) and downloads the picture.
  async download(id) {
    const { source, ref } = splitId(id);
    let meta, url;
    if (source === 'openverse') {
      meta = fromOpenverse(await this._get(`${OPENVERSE}/v1/images/${ref}/`));
      url = `${OPENVERSE}/v1/images/${ref}/thumb/`; // Openverse proxies the picture itself: no third-party host is ever contacted
    } else {
      const j = await this._get(`${COMMONS}/w/api.php?action=query&format=json&pageids=${ref}&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1600`);
      meta = fromCommons(Object.values(j.query?.pages ?? {})[0] ?? {});
      if (!meta) throw new Error(`No Commons image ${ref}.`);
      url = meta._thumb;
      if (new URL(url).protocol !== 'https:' || new URL(url).hostname !== COMMONS_FILES) throw new Error('Unexpected image host from Commons; refused.');
    }
    if (!commercialSafe(meta.license)) throw new Error(`Licence "${meta.license}" is not commercial-safe (CC0, public domain, CC BY, CC BY-SA only).`);
    const buffer = await this._get(url, { json: false, maxBytes: MAX_IMAGE_BYTES });
    if (!imageInfo(buffer)) throw new Error('The download is not a PNG, JPEG, GIF or WebP image.');
    const { _thumb, _mime, ...credit } = meta;
    return { buffer, credit };
  }
}
