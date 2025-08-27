# Bastyon Video Downloader (bvd)

Download Bastyon/PeerTube videos from the command line.

Supports:
- Bastyon post URLs like `https://bastyon.com/post?s=<post-hash>` (auto-resolves to PeerTube)
- `peertube://host/uuid` (Bastyon internal link format)
- Standard PeerTube URLs, e.g.:
  - `https://peertube.example/videos/watch/UUID`
  - `https://peertube.example/w/UUID`
  - `https://peertube.example/api/v1/videos/UUID`

Requires Node.js >= 18 (uses the built-in `fetch`).

## Install

This is intended for local/workspace use. No publish required.

- Run directly via Node:

```bash
node ./bastyon-video-downloader/bin/cli.js --help
```

Optionally, you can add an npm script in your root package.json to simplify running.

## Usage

```bash
bvd <bastyon-post-url|peertube-url|peertube://host/uuid> [options]

Options:
  -o, --output <path>     Output file path (default: derived from title)
  -q, --quality <number>  Preferred max resolution height (e.g., 1080, 720). Default: best available
  --audio-only            Prefer audio-only download if available
  -h, --help              Show help
```

Examples:

```bash
# From a Bastyon post URL (resolves to PeerTube automatically)
node ./bastyon-video-downloader/bin/cli.js "https://bastyon.com/post?s=<HASH>"

# From Bastyon link format
node ./bastyon-video-downloader/bin/cli.js "peertube://videos.pocketnet.app/UUID"

# From a PeerTube watch URL
node ./bastyon-video-downloader/bin/cli.js "https://videos.example/videos/watch/UUID" -q 720

# Audio-only
node ./bastyon-video-downloader/bin/cli.js "https://videos.example/w/UUID" --audio-only -o ./track.m4a
```

The downloader:
- Resolves metadata from `GET /api/v1/videos/:id`.
- Selects the best HTTPS MP4 by default (or audio-only when requested).
- Streams to `<title>.mp4` (or `.m4a`) with a temporary `.part` file and progress display.

## Library API

You can also use it programmatically:

```js
import { resolveInput, resolveBastyonPost, fetchVideoMeta, selectFile, downloadFile, deriveOutputName } from './bastyon-video-downloader/lib/index.js';

// 1) Direct PeerTube or peertube:// link
const { host, id } = await resolveInput('peertube://videos.pocketnet.app/UUID');
const meta = await fetchVideoMeta(host, id);
const chosen = selectFile(meta, { quality: 1080, audioOnly: false });
const out = deriveOutputName(meta, chosen);
await downloadFile(chosen.fileUrl, out);

// 2) Bastyon post URL -> resolve to PeerTube
const { host: h2, id: id2 } = await resolveInput('https://bastyon.com/post?s=<HASH>');
const meta2 = await fetchVideoMeta(h2, id2);
```
```

## Notes

- Many PeerTube servers expose multiple files/playlists; this tool prefers HTTPS MP4s and highest resolution under the chosen quality.
- Resume is not implemented yet; partial `.part` files are removed on error.
- If a server only provides HLS (m3u8) and no direct file URLs, this tool will likely not find a downloadable candidate.
- Bastyon post resolution uses the public RPC at `https://5.pocketnet.app:8899/rpc/` by default.
