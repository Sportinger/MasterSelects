#!/usr/bin/env node
// Renders the installable-app icons in public/icons/ from the MasterSelects
// "MS" logo. The committed public/favicon.png is only 64 px; its 2048 px
// original lives in git history (commit 99583ca19), which is the default
// source. The output PNGs are committed, so this only runs when the logo changes.
//
//   app-icon-{192,512}.png           purpose "any": rounded logo, transparent corners
//   app-icon-maskable-{192,512}.png  purpose "maskable": logo inside the 80 % safe
//                                    zone on the editor background colour
//   apple-touch-icon.png             180 px, opaque (iOS adds its own rounding)
//
// Usage: node scripts/generate-pwa-icons.mjs [--source path/to/2048.png] [--out public/icons]
// Requires ffmpeg on PATH.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SOURCE_COMMIT = '99583ca19';
const SOURCE_SIZE = 2048;
// The logo's rounded frame: 2 px inset, 352 px corner radius (measured on the source).
const FRAME_INSET = 2;
const FRAME_RADIUS = 352;
// A generator watermark sits in the bottom-right corner, outside the frame.
const WATERMARK_BOX = { x: 1878, y: 1878, w: 120, h: 120 };
// --bg-primary (src/styles/tokens.css), also the manifest background_color.
const BACKGROUND = '0x0f0f0f';
// Maskable icons are cropped to a circle of 80 % diameter; the frame's corners may be clipped, the letters not.
const MASKABLE_SCALE = 0.8;

function parseArgs(argv) {
  const options = { source: null, out: 'public/icons' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--source' && value) { options.source = value; index += 1; continue; }
    if (name === '--out' && value) { options.out = value; index += 1; continue; }
    throw new Error(`Unknown or incomplete argument: ${name}`);
  }
  return options;
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
}

function roundedFrameAlpha() {
  const lo = FRAME_INSET + FRAME_RADIUS;
  const hi = SOURCE_SIZE - 1 - FRAME_INSET - FRAME_RADIUS;
  const dx = `max(max(${lo}-X\\,X-${hi})\\,0)`;
  const dy = `max(max(${lo}-Y\\,Y-${hi})\\,0)`;
  // Two-pixel anti-aliased edge.
  return `255*clip((${FRAME_RADIUS}-hypot(${dx}\\,${dy}))/2+0.5\\,0\\,1)`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const work = mkdtempSync(path.join(os.tmpdir(), 'ms-pwa-icons-'));
  try {
    let source = options.source;
    if (!source) {
      source = path.join(work, 'source.png');
      writeFileSync(source, execFileSync('git', ['show', `${SOURCE_COMMIT}:public/favicon.png`], { maxBuffer: 64 * 1024 * 1024 }));
    }
    mkdirSync(options.out, { recursive: true });
    const master = path.join(work, 'master.png');
    const { x, y, w, h } = WATERMARK_BOX;
    ffmpeg([
      '-i', source,
      '-vf', [
        `scale=${SOURCE_SIZE}:${SOURCE_SIZE}:flags=lanczos`,
        `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${BACKGROUND}:t=fill`,
        'format=rgba',
        `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${roundedFrameAlpha()}'`,
      ].join(','),
      master,
    ]);

    for (const size of [192, 512]) {
      ffmpeg(['-i', master, '-vf', `scale=${size}:${size}:flags=lanczos,format=rgba`, path.join(options.out, `app-icon-${size}.png`)]);
      const inner = Math.round(size * MASKABLE_SCALE);
      ffmpeg([
        '-f', 'lavfi', '-i', `color=c=${BACKGROUND}:s=${size}x${size},format=rgba`,
        '-i', master,
        '-filter_complex', `[1:v]scale=${inner}:${inner}:flags=lanczos[logo];[0:v][logo]overlay=(W-w)/2:(H-h)/2:format=auto,format=rgb24`,
        '-frames:v', '1',
        path.join(options.out, `app-icon-maskable-${size}.png`),
      ]);
    }
    ffmpeg([
      '-f', 'lavfi', '-i', `color=c=${BACKGROUND}:s=180x180,format=rgba`,
      '-i', master,
      '-filter_complex', '[1:v]scale=180:180:flags=lanczos[logo];[0:v][logo]overlay=0:0:format=auto,format=rgb24',
      '-frames:v', '1',
      path.join(options.out, 'apple-touch-icon.png'),
    ]);
    console.log(`PWA icons written to ${options.out}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
