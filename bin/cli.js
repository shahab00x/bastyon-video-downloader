#!/usr/bin/env node
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInput, fetchVideoMeta, selectFile, downloadFile, deriveOutputName } from '../lib/index.js';

function printHelp() {
  console.log(`bastyon-video-downloader (bvd)

Usage:
  bvd <url|peertube://host/uuid> [options]

Options:
  -o, --output <path>     Output file path (default: derived from title)
  -q, --quality <number>  Preferred max resolution height (e.g., 1080, 720). Default: best
  --audio-only            Download audio-only file if available
  -h, --help              Show this help
`);
}

async function main() {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }

  let inputUrl = null;
  let output = null;
  let quality = null;
  let audioOnly = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!inputUrl && !a.startsWith('-')) {
      inputUrl = a;
      continue;
    }
    if (a === '-o' || a === '--output') {
      output = args[++i];
      continue;
    }
    if (a === '-q' || a === '--quality') {
      quality = Number(args[++i]) || null;
      continue;
    }
    if (a === '--audio-only') {
      audioOnly = true;
      continue;
    }
    if (a === '-h' || a === '--help') {
      printHelp();
      return;
    }
  }

  if (!inputUrl) {
    console.error('Error: missing input URL');
    printHelp();
    exit(2);
  }

  try {
    const { host, id } = parseInput(inputUrl);
    if (!host || !id) {
      throw new Error('Unable to parse input. Expect peertube://host/uuid or PeerTube URL');
    }

    const meta = await fetchVideoMeta(host, id);
    const chosen = selectFile(meta, { quality, audioOnly });
    if (!chosen) {
      throw new Error('No suitable downloadable file found. Try without --audio-only or different quality');
    }

    const outPath = resolve(process.cwd(), output || deriveOutputName(meta, chosen));
    await downloadFile(chosen.fileUrl, outPath);

    console.log(`\nSaved to: ${outPath}`);
  } catch (e) {
    console.error('Download failed:', e && e.message ? e.message : e);
    exit(1);
  }
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  exit(1);
});
