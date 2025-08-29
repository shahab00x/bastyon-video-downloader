import http from 'node:http';
import { readFile, stat as statCb } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = __dirname; // serve files from web/

const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;
const RPC_TARGET = process.env.BASTYON_RPC || 'https://5.pocketnet.app:8899';

function contentType(p) {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
}

const server = http.createServer(async (req, res) => {
  try {
    setCors(res);

    // Preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Proxy Bastyon RPC: /rpc/* -> RPC_TARGET + /rpc/*
    if (req.url && req.url.startsWith('/rpc/')) {
      const targetUrl = RPC_TARGET.replace(/\/$/, '') + req.url;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const r = await fetch(targetUrl, {
        method: req.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-no-compression': '1',
        },
        body: req.method === 'GET' ? undefined : body,
      });
      const text = await r.text();
      res.statusCode = r.status;
      res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
      res.end(text);
      return;
    }

    // Generic proxy for cross-origin downloads: /proxy?url=ENCODED[&filename=NAME]
    if (req.url && req.url.startsWith('/proxy')) {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      const target = u.searchParams.get('url');
      const filename = u.searchParams.get('filename');
      if (!target) {
        res.writeHead(400);
        res.end('Missing url');
        return;
      }
      const upstream = await fetch(target, { headers: { Accept: '*/*' } });
      const ct = upstream.headers.get('content-type') || 'application/octet-stream';
      const cl = upstream.headers.get('content-length');
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', ct);
      if (cl) res.setHeader('Content-Length', cl);
      if (filename) {
        // Instruct browser to download with suggested filename
        // Sanitize filename to avoid CRLF/header injection
        const safe = String(filename).replace(/[\r\n]/g, ' ').trim();
        res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
      }
      const body = upstream.body;
      if (body) {
        const nodeReadable = Readable.fromWeb(body);
        await pipeline(nodeReadable, res);
      } else {
        const text = await upstream.text().catch(() => '');
        res.end(text);
      }
      return;
    }

    // Serve screenshots directory: /screenshots/*
    if (req.url && req.url.startsWith('/screenshots/')) {
      const reqPath = req.url.replace(/^\/screenshots\//, '');
      const baseDir = path.join(__dirname, '..', 'screenshots');
      const fsPath = path.join(baseDir, reqPath);
      if (!fsPath.startsWith(baseDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const st = await fsp.stat(fsPath).catch(() => null);
      if (!st || !st.isFile()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(fsPath) });
      const data = await fsp.readFile(fsPath);
      res.end(data);
      return;
    }

    // Static files
    let reqPath = req.url || '/';
    if (reqPath === '/') reqPath = '/index.html';
    // Prevent path traversal
    reqPath = path.posix.normalize(reqPath).replace(/^\/+/, '/');
    const fsPath = path.join(webRoot, '.' + reqPath);

    // Ensure within webRoot
    if (!fsPath.startsWith(webRoot)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const st = await fsp.stat(fsPath).catch(() => null);
    if (!st || !st.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType(fsPath) });
    const data = await fsp.readFile(fsPath);
    res.end(data);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e && e.message ? e.message : e));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web UI: http://localhost:${PORT}`);
  console.log(`Web UI: http://0.0.0.0:${PORT} (accessible from network)`);
  console.log(`Proxying Bastyon RPC at /rpc/ -> ${RPC_TARGET}`);
});
