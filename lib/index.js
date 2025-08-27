import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { basename, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const PEERTUBE_SCHEME = 'peertube://';

function ensureHttps(host) {
  if (!host) return null;
  if (host.startsWith('http://') || host.startsWith('https://')) return host.replace('http://', 'https://');
  return `https://${host}`;
}

export function parseInput(input) {
  if (!input) return { host: null, id: null };

  if (input.startsWith(PEERTUBE_SCHEME)) {
    const rest = input.slice(PEERTUBE_SCHEME.length);
    const [host, id, extra] = rest.split('/');
    return { host: ensureHttps(host), id };
  }

  // Try standard URL formats
  try {
    const u = new URL(input);
    const host = ensureHttps(u.host);
    const parts = u.pathname.split('/').filter(Boolean);

    // Known patterns: /w/:id, /videos/watch/:id, /videos/embed/:id, /api/v1/videos/:id
    let id = null;
    const patterns = [
      ['w'],
      ['videos', 'watch'],
      ['videos', 'embed'],
      ['api', 'v1', 'videos'],
    ];

    for (const p of patterns) {
      const idx = parts.findIndex((seg, i) => p.every((pp, j) => parts[i + j] === pp));
      if (idx !== -1 && parts[idx + p.length]) {
        id = parts[idx + p.length];
        break;
      }
    }

    // Fallback: last segment looks like UUID
    if (!id && parts.length) id = parts[parts.length - 1];

    return { host, id };
  } catch (e) {
    // Not a URL; allow host/id separated by space? Not supported; fail.
    return { host: null, id: null };
  }
}

export async function fetchVideoMeta(host, id) {
  if (!host || !id) throw new Error('Missing host or id');
  const base = ensureHttps(host);
  const url = `${base}/api/v1/videos/${encodeURIComponent(id)}`;

  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`PeerTube API error ${r.status}: ${t || r.statusText}`);
  }
  const meta = await r.json();
  return meta;
}

function sanitizeName(name) {
  const base = (name || '').toString().trim() || 'video';
  // Remove unsafe characters
  return base.replace(/[\/:*?"<>|\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').slice(0, 120).trim();
}

function urlExt(u) {
  try {
    const p = new URL(u).pathname;
    const e = extname(p).toLowerCase();
    return e || '';
  } catch {
    return '';
  }
}

function buildCandidates(meta) {
  const candidates = [];

  const pushFile = (f, kind) => {
    if (!f) return;
    const fileUrl = f.fileUrl || f.url || f.src || null;
    const mimeType = f.mimeType || f.type || '';
    const size = f.size || f.filesize || null;
    const height = (f.resolution && (f.resolution.id || f.resolution.label)) || f.height || null;
    const fps = f.fps || null;

    if (!fileUrl) return;

    candidates.push({ kind, fileUrl, mimeType, size, height: Number(height) || null, fps });
  };

  // 1) Direct files (webtorrent HTTP fallback)
  if (Array.isArray(meta.files)) {
    for (const f of meta.files) pushFile(f, 'video');
  }

  // 2) Streaming playlists with downloadable files
  if (Array.isArray(meta.streamingPlaylists)) {
    for (const pl of meta.streamingPlaylists) {
      if (Array.isArray(pl.files)) for (const f of pl.files) pushFile(f, f.audioOnly ? 'audio' : 'video');
      // Some PeerTube versions expose audioOnly flag on file or resolution === null
      if (Array.isArray(pl.audioFiles)) for (const f of pl.audioFiles) pushFile(f, 'audio');
    }
  }

  // 3) Fallback: preview files field variations
  if (meta.previewFiles && Array.isArray(meta.previewFiles)) {
    for (const f of meta.previewFiles) pushFile(f, 'video');
  }

  // Prefer https and mp4 first by sorting criteria
  const score = (c) => {
    const ext = urlExt(c.fileUrl);
    const isMp4 = ext === '.mp4' || /mp4/.test(c.mimeType || '');
    const isHttps = c.fileUrl.startsWith('https://');
    return (isHttps ? 2 : 0) + (isMp4 ? 3 : 0) + (c.height || 0) / 10000;
  };

  return candidates.sort((a, b) => score(b) - score(a));
}

export function selectFile(meta, opts = {}) {
  const { quality = null, audioOnly = false } = opts;
  const all = buildCandidates(meta).filter((c) => (audioOnly ? c.kind === 'audio' : c.kind === 'video'));
  if (all.length === 0) return null;

  if (audioOnly) {
    // Choose best audio by size or bitrate if available
    return all[0];
  }

  if (quality) {
    const leq = all.filter((c) => c.height && c.height <= quality).sort((a, b) => (b.height || 0) - (a.height || 0));
    if (leq.length) return leq[0];
    const above = all.filter((c) => c.height && c.height > quality).sort((a, b) => (a.height || 0) - (b.height || 0));
    if (above.length) return above[0];
  }

  return all[0];
}

export function deriveOutputName(meta, chosen) {
  const base = sanitizeName(meta.name || meta.title || meta.uuid || 'video');
  const ext = urlExt(chosen.fileUrl) || (chosen.kind === 'audio' ? '.m4a' : '.mp4');
  return `${base}${ext}`;
}

export async function downloadFile(url, outPath) {
  const tmp = `${outPath}.part`;
  try {
    await fs.rm(tmp).catch(() => {});

    const r = await fetch(url, { headers: { Accept: '*/*' } });
    if (!r.ok || !r.body) {
      const t = await r.text().catch(() => '');
      throw new Error(`Download error ${r.status}: ${t || r.statusText}`);
    }

    const totalStr = r.headers.get('content-length');
    const total = totalStr ? Number(totalStr) : null;

    let downloaded = 0;
    const ws = createWriteStream(tmp);

    const report = () => {
      if (!total) return;
      const pct = ((downloaded / total) * 100).toFixed(1);
      process.stdout.write(`\rDownloading: ${pct}% (${downloaded}/${total} bytes)`);
    };

    const readable = r.body;
    const reader = readable.getReader();

    await new Promise(async (resolve, reject) => {
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) return resolve();
          ws.write(value, (err) => {
            if (err) return reject(err);
            downloaded += value.length;
            report();
            pump();
          });
        }).catch(reject);
      }
      ws.on('error', reject);
      pump();
    });

    await new Promise((res, rej) => ws.end(() => res()));

    await fs.rename(tmp, outPath);
    process.stdout.write('\n');
  } catch (e) {
    await fs.rm(tmp).catch(() => {});
    throw e;
  }
}
