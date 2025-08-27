# Bastyon Video Downloader

A powerful tool to download videos from Bastyon and PeerTube instances with both command-line and web interfaces.

## Features

- **Multiple URL Formats Supported:**
  - Bastyon post URLs: `https://bastyon.com/post?s=<hash>` or `https://bastyon.com/index?v=<hash>`
  - PeerTube direct links: `peertube://host/uuid`
  - Standard PeerTube URLs: `https://peertube.example/videos/watch/UUID`
  - API endpoints: `https://peertube.example/api/v1/videos/UUID`

- **Dual Interface:**
  - **Command Line Interface (CLI)** - Perfect for automation and scripting
  - **Web Interface** - User-friendly browser-based interface with quality selection

- **Smart Quality Selection:**
  - Automatic best quality detection
  - Manual quality selection (1080p, 720p, etc.)
  - Audio-only downloads supported

- **Robust Download:**
  - Direct file downloads (no streaming required)
  - Progress tracking
  - Resume support with temporary files
  - Automatic filename generation from video titles

## Prerequisites

- **Node.js >= 18** (uses built-in `fetch` API)
- **npm** (for package management)

## Quick Start

### Option 1: Web Interface (Recommended for most users)

```bash
# Start the web server
npm run web
```

Then open your browser to: `http://localhost:5173`

### Alternative Ways to Run the Web Server

```bash
# Using npm start (same as npm run web)
npm start

# Direct node execution
node ./web/server.mjs

# With custom port
PORT=8080 npm run web

# With custom Bastyon RPC endpoint
BASTYON_RPC=https://custom.rpc.endpoint:8899 npm run web
```

## Running the Web Server

The web interface provides a user-friendly way to download videos through your browser.

### Starting the Server

```bash
# Navigate to the project directory
cd bastyon-video-downloader

# Install dependencies (first time only)
npm install

# Start the web server
npm run web
```

### Available npm Scripts

- **`npm run web`** - Start the web server (recommended)
- **`npm start`** - Same as npm run web
- **`node ./web/server.mjs`** - Direct execution

### Server URLs

Once running, access the web interface at:
- **Local access:** `http://localhost:5173`
- **Network access:** `http://0.0.0.0:5173` (accessible from other devices on your network)

### Web Interface Features

- Paste any supported URL format
- Preview video metadata and thumbnail
- Select quality from dropdown menu
- Copy direct download links for external download managers
- Download directly in browser with progress tracking

### Configuration Options

You can customize the server behavior using environment variables:

```bash
# Custom port
PORT=8080 npm run web

# Custom Bastyon RPC endpoint
BASTYON_RPC=https://custom.rpc.endpoint:8899 npm run web

# Both together
PORT=9000 BASTYON_RPC=https://my.rpc.com:8899 npm run web
```

**Features:**
- Paste any supported URL
- See video preview with thumbnail
- Select quality from dropdown
- Copy direct download link for external download managers
- Download directly in browser

### Option 2: Command Line Interface

```bash
# Direct execution
node ./bin/cli.js "https://bastyon.com/post?s=<HASH>"

# Or use the binary
./bin/cli.js "peertube://videos.pocketnet.app/UUID" -q 720
```

## Installation

This tool is designed for local/workspace use. No global installation required.

### Clone and Setup

```bash
git clone <repository-url>
cd bastyon-video-downloader
npm install
```

### Optional: Add to your project's package.json

```json
{
  "scripts": {
    "download": "node ./bastyon-video-downloader/bin/cli.js"
  }
}
```

## Usage Examples

### Web Interface

1. **Start the server:**
   ```bash
   npm run web
   ```

2. **Access the interface:**
   - Local: `http://localhost:5173`
   - Network: `http://[YOUR_IP]:5173` (if configured for network access)

3. **Download process:**
   - Paste a Bastyon or PeerTube URL
   - Click "Resolve" to load video metadata
   - Select your preferred quality
   - Click "Download" or copy the direct link

### Command Line Interface

```bash
# Basic usage - download best quality
node ./bin/cli.js "https://bastyon.com/post?s=<HASH>"

# Download specific quality
node ./bin/cli.js "https://videos.example/videos/watch/UUID" -q 720

# Audio-only download
node ./bin/cli.js "peertube://host/uuid" --audio-only -o "./music/audio.m4a"

# Custom output path
node ./bin/cli.js "https://bastyon.com/index?v=<HASH>" -o "/path/to/save/video.mp4"

# Show help
node ./bin/cli.js --help
```

### CLI Options

```
Usage: bvd <url> [options]

Options:
  -o, --output <path>     Output file path (default: auto-generated from title)
  -q, --quality <number>  Max resolution height (e.g., 1080, 720)
  --audio-only           Download audio-only file
  -h, --help             Show this help message
```

## Supported URL Formats

### Bastyon URLs
- `https://bastyon.com/post?s=<transaction-hash>`
- `https://bastyon.com/index?v=<transaction-hash>&video=1`

### PeerTube URLs
- `peertube://host/uuid` (Bastyon internal format)
- `https://peertube.example/videos/watch/UUID`
- `https://peertube.example/w/UUID`
- `https://peertube.example/api/v1/videos/UUID`

## Technical Details

### How It Works

1. **URL Resolution:**
   - Bastyon URLs are resolved via RPC to find the embedded PeerTube link
   - Direct PeerTube URLs are parsed to extract host and video ID

2. **Metadata Fetching:**
   - Queries PeerTube's `/api/v1/videos/:id` endpoint
   - Extracts available video/audio files and their properties

3. **Quality Selection:**
   - Prefers HTTPS MP4 files over other formats
   - Selects highest resolution under specified quality limit
   - Falls back to audio-only if requested

4. **Download Process:**
   - Streams directly from PeerTube servers
   - Uses temporary `.part` files for resume capability
   - Shows progress with file size information

### Library API

For programmatic use:

```javascript
import {
  resolveInput,
  resolveBastyonPost,
  fetchVideoMeta,
  selectFile,
  downloadFile,
  deriveOutputName
} from './lib/index.js';

// Example: Download from Bastyon URL
const { host, id } = await resolveInput('https://bastyon.com/post?s=<HASH>');
const meta = await fetchVideoMeta(host, id);
const chosen = selectFile(meta, { quality: 1080, audioOnly: false });
const filename = deriveOutputName(meta, chosen);
await downloadFile(chosen.fileUrl, filename);

// Example: Direct PeerTube URL
const { host, id } = await resolveInput('https://videos.example/videos/watch/UUID');
const meta = await fetchVideoMeta(host, id);
const chosen = selectFile(meta);
await downloadFile(chosen.fileUrl, 'video.mp4');
```

## Configuration

### Environment Variables

- `PORT` - Web server port (default: 5173)
- `BASTYON_RPC` - Bastyon RPC endpoint (default: https://5.pocketnet.app:8899)

```bash
# Custom port
PORT=8080 npm run web

# Custom RPC endpoint
BASTYON_RPC=https://custom.rpc.endpoint:8899 npm run web
```

## Network Access

By default, the web interface is accessible at:
- **Local:** `http://localhost:5173`
- **Network:** `http://0.0.0.0:5173` (accessible from your local network)

For internet access, configure your router/firewall for port forwarding.

## Troubleshooting

### Common Issues

1. **"Post not found" error:**
   - Verify the Bastyon URL is correct
   - Check if the post still exists
   - Try using a different Bastyon RPC endpoint

2. **No downloadable files found:**
   - Some PeerTube instances only provide streaming (HLS)
   - Try a different quality or audio-only option
   - The video might be private or restricted

3. **Network errors:**
   - Ensure stable internet connection
   - Some corporate networks block PeerTube servers
   - Try using a VPN if necessary

### Debug Mode

For troubleshooting, you can inspect the network requests in browser dev tools or add logging to the CLI.

## Notes and Limitations

- **Resume Support:** Partial downloads are saved as `.part` files and can be resumed
- **Format Preference:** Prefers MP4 over other video formats when available
- **HTTPS Priority:** Always prefers secure HTTPS downloads over HTTP
- **No Authentication:** Does not support private/protected videos
- **Rate Limiting:** Respect PeerTube server rate limits to avoid being blocked

## Contributing

This is a local tool, but feel free to submit issues or improvements for the codebase.

## License

MIT License - See LICENSE file for details
