// Minimal browser module for resolving Bastyon posts to PeerTube, listing qualities, and downloading.

const PEERTUBE_SCHEME = 'peertube://';

function ensureHttps(host) {
  if (!host) return null;
  if (host.startsWith('http://') || host.startsWith('https://')) return host.replace('http://', 'https://');
  return `https://${host}`;
}

function parseInput(input) {
  if (!input) return { host: null, id: null };
  if (input.startsWith(PEERTUBE_SCHEME)) {
    const rest = input.slice(PEERTUBE_SCHEME.length);
    const [host, id] = rest.split('/');
    return { host: ensureHttps(host), id };
  }
  try {
    const u = new URL(input);
    const host = ensureHttps(u.host);
    const parts = u.pathname.split('/').filter(Boolean);
    let id = null;
    const patterns = [ ['w'], ['videos', 'watch'], ['videos', 'embed'], ['api', 'v1', 'videos'] ];
    for (const p of patterns) {
      const idx = parts.findIndex((seg, i) => p.every((pp, j) => parts[i + j] === pp));
      if (idx !== -1 && parts[idx + p.length]) { id = parts[idx + p.length]; break; }
    }
    if (!id && parts.length) id = parts[parts.length - 1];
    return { host, id };
  } catch {
    return { host: null, id: null };
  }
}

function extractBastyonPostTx(input) {
  try {
    const u = new URL(input);
    const host = (u.host || '').toLowerCase();
    const isBastyon = host.endsWith('bastyon.com') || host.endsWith('pocketnet.app');
    const p = u.pathname.replace(/\/+$/, '');
    const isAllowedPath = p === '/post' || p === '/index';
    if (!isBastyon || !isAllowedPath) return null;
    return u.searchParams.get('s') || u.searchParams.get('v') || u.searchParams.get('i') || null;
  } catch {
    return null;
  }
}

async function bastyonRpcCall(method, parameters, rpcBase = '') {
  const base = rpcBase.endsWith('/') ? rpcBase : rpcBase + '/';
  const url = base + 'rpc/' + method;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-no-compression': '1' },
    body: JSON.stringify({ method, parameters }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Bastyon RPC error ${r.status}: ${t || r.statusText}`);
  }
  const j = await r.json();
  if (j && j.result != null && j.data != null) return j.data;
  if (Array.isArray(j)) return j;
  if (j && j.data != null) return j.data;
  throw new Error('Unexpected Bastyon RPC response');
}

async function resolveBastyonPost(txid, options = {}) {
  if (!txid) throw new Error('Missing Bastyon post txid');
  const { rpcBase } = options;
  const data = await bastyonRpcCall('getrawtransactionwithmessagebyid', [[txid]], rpcBase);
  if (!Array.isArray(data) || !data.length) throw new Error('Post not found');
  const post = data[0] || {};
  const u = post.u ? decodeURIComponent(post.u) : null;
  if (!u) throw new Error('Post has no external video URL');
  const { host, id } = parseInput(u);
  if (!host || !id) throw new Error('Unable to parse video URL from post');
  return { host, id, resolvedFrom: u };
}

async function resolveInput(input, options = {}) {
  const tx = extractBastyonPostTx(input);
  if (tx) {
    const { host, id } = await resolveBastyonPost(tx, options);
    return { host, id };
  }
  return parseInput(input);
}

async function fetchVideoMeta(host, id) {
  if (!host || !id) throw new Error('Missing host or id');
  const base = ensureHttps(host);
  const url = `${base}/api/v1/videos/${encodeURIComponent(id)}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`PeerTube API error ${r.status}: ${t || r.statusText}`);
  }
  return await r.json();
}

function urlExt(u) {
  try {
    const p = new URL(u).pathname;
    const m = p.match(/\.[a-z0-9]+$/i);
    return m ? m[0].toLowerCase() : '';
  } catch { return ''; }
}

function buildCandidates(meta) {
  const candidates = [];
  const pushFile = (f) => {
    if (!f) return;
    const fileUrl = f.fileUrl || f.url || f.src || null;
    const mimeType = f.mimeType || f.type || '';
    const size = f.size || f.filesize || null;
    const height = (f.resolution && (f.resolution.id || f.resolution.label)) || f.height || null;
    const fps = f.fps || null;
    if (!fileUrl) return;
    candidates.push({ fileUrl, mimeType, size, height: Number(height) || null, fps });
  };
  if (Array.isArray(meta.files)) for (const f of meta.files) pushFile(f);
  if (Array.isArray(meta.streamingPlaylists)) {
    for (const pl of meta.streamingPlaylists) {
      if (Array.isArray(pl.files)) for (const f of pl.files) pushFile(f);
    }
  }
  // sort by https+mp4+height
  const score = (c) => {
    const isMp4 = urlExt(c.fileUrl) === '.mp4' || /mp4/.test(c.mimeType || '');
    const isHttps = c.fileUrl.startsWith('https://');
    return (isHttps ? 2 : 0) + (isMp4 ? 3 : 0) + (c.height || 0) / 10000;
  };
  return candidates.sort((a, b) => score(b) - score(a));
}

function humanSize(n) {
  if (!n || !Number(n)) return '';
  const units = ['B','KB','MB','GB'];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function deriveOutputName(meta, chosen) {
  const base = String(meta.name || meta.title || meta.uuid || 'video').replace(/[\/:*?"<>|\u0000-\u001F]/g, ' ').trim().slice(0, 120) || 'video';
  const ext = urlExt(chosen.fileUrl) || '.mp4';
  return `${base}${ext}`;
}

async function downloadWithProgress(url, filename, onProgress) {
  // Use local proxy to avoid CORS
  const r = await fetch(`/proxy?url=${encodeURIComponent(url)}`, { headers: { Accept: '*/*' } });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => '');
    throw new Error(`Download error ${r.status}: ${t || r.statusText}`);
  }
  const total = Number(r.headers.get('content-length')) || null;
  const reader = r.body.getReader();
  const chunks = [];
  let downloaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    if (total && onProgress) onProgress(downloaded, total);
  }
  const blob = new Blob(chunks);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

// UI wiring
const el = (id) => document.getElementById(id);
const $url = el('url');
const $resolve = el('resolve');
const $info = el('info');
const $thumb = el('thumb');
const $title = el('title');
const $desc = el('desc');
const $quality = el('quality');
const $download = el('download');
const $progressWrap = el('progressWrap');
const $progress = el('progress');
const $progressText = el('progressText');
const $error = el('error');

let current = { host: null, id: null, meta: null, candidates: [] };

function setError(msg) {
  $error.textContent = msg || '';
}

function setLoading(state) {
  $resolve.disabled = state;
}

function setDownloading(state) {
  $download.disabled = state;
}

function fillQualities(candidates) {
  $quality.innerHTML = '';
  const opts = [];
  for (const c of candidates) {
    // Only video (has height) for selection. If no height, show as "auto"
    const labelParts = [];
    if (c.height) labelParts.push(`${c.height}p`);
    const isMp4 = urlExt(c.fileUrl) === '.mp4' || /mp4/.test(c.mimeType || '');
    if (isMp4) labelParts.push('MP4');
    if (c.fps) labelParts.push(`${c.fps}fps`);
    if (c.size) labelParts.push(humanSize(c.size));
    const label = labelParts.join(' · ') || 'auto';
    const opt = document.createElement('option');
    opt.value = c.fileUrl;
    opt.textContent = label;
    opts.push({ opt, height: c.height || 0 });
  }
  // Deduplicate by fileUrl, keep first occurrence
  const seen = new Set();
  for (const { opt, height } of opts.sort((a, b) => (b.height - a.height))) {
    if (seen.has(opt.value)) continue;
    seen.add(opt.value);
    $quality.appendChild(opt);
  }
  $quality.disabled = $quality.options.length === 0;
}

$resolve.addEventListener('click', async () => {
  setError('');
  $info.classList.add('hidden');
  $quality.disabled = true;
  $download.disabled = true;
  $progressWrap.classList.add('hidden');
  try {
    setLoading(true);
    const { host, id } = await resolveInput($url.value.trim());
    if (!host || !id) throw new Error('Unable to resolve input. Check the URL.');
    current.host = host; current.id = id;
    const meta = await fetchVideoMeta(host, id);
    current.meta = meta;
    // Info
    $title.textContent = meta.name || meta.title || '';
    $desc.textContent = meta.description ? String(meta.description).slice(0, 200) : '';
    const preview = (meta.previewPath && (host + meta.previewPath)) || (meta.thumbnailPath && (host + meta.thumbnailPath));
    $thumb.src = preview || '';
    $info.classList.remove('hidden');
    // Candidates
    const cand = buildCandidates(meta);
    current.candidates = cand;
    fillQualities(cand);
    $download.disabled = $quality.disabled;
  } catch (e) {
    setError(e && e.message ? e.message : String(e));
  } finally {
    setLoading(false);
  }
});

$download.addEventListener('click', async () => {
  setError('');
  $progressWrap.classList.remove('hidden');
  $progress.value = 0; $progressText.textContent = '0%';
  try {
    const fileUrl = $quality.value;
    if (!fileUrl) throw new Error('Choose a quality first');
    const chosen = current.candidates.find(c => c.fileUrl === fileUrl) || { fileUrl };
    const name = deriveOutputName(current.meta || {}, chosen);
    await downloadWithProgress(fileUrl, name, (done, total) => {
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
      $progress.value = pct;
      $progressText.textContent = `${pct}% (${humanSize(done)}${total ? ' / ' + humanSize(total) : ''})`;
    });
  } catch (e) {
    setError(e && e.message ? e.message : String(e));
  }
});
