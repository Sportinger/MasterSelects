// Generates a HAP Alpha (Hap5) sample movie with our own encoder:
// 10 seconds, 1920x1080@30, transparent background, rotating orange bar.
// Output: %USERPROFILE%\Desktop\hap-alpha-rotating-bar.mov
//
// Run: npx esbuild tools/hap-probe/generateHapSample.ts --bundle --platform=node \
//        --format=esm --packages=external --outfile=tools/hap-probe/.build/generateHapSample.mjs
//      node tools/hap-probe/.build/generateHapSample.mjs

import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encodeTextureCpu } from '../../src/services/hap/dxtEncodeCpu';
import { HAP_FORMAT_RGBA_DXT5, buildHapFrame } from '../../src/services/hap/hapFrame';
import { HapMovWriter } from '../../src/services/hap/hapMovMuxer';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION_SECONDS = 10;
const ROTATIONS = 4;
const BAR_COLOR = { r: 255, g: 140, b: 0 };
const BAR_HALF_LENGTH = Math.min(WIDTH, HEIGHT) * 0.42;
const BAR_HALF_WIDTH = 56;
const EDGE_AA = 2;

function renderFrame(rgba: Uint8Array, timeSeconds: number): void {
  const angle = 2 * Math.PI * ROTATIONS * (timeSeconds / DURATION_SECONDS);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const reach = BAR_HALF_LENGTH + BAR_HALF_WIDTH + EDGE_AA + 1;
  const reachSq = reach * reach;
  const outer = BAR_HALF_WIDTH + EDGE_AA;

  for (let y = 0; y < HEIGHT; y++) {
    const py = y - cy;
    for (let x = 0; x < WIDTH; x++) {
      const px = x - cx;
      const i = (y * WIDTH + x) * 4;
      // Straight alpha: keep the bar color everywhere so BC color blocks stay
      // flat and only the alpha ramp shapes the bar.
      rgba[i] = BAR_COLOR.r;
      rgba[i + 1] = BAR_COLOR.g;
      rgba[i + 2] = BAR_COLOR.b;

      if (px * px + py * py > reachSq) {
        rgba[i + 3] = 0;
        continue;
      }
      // Rotate into bar space: u along the bar, v across it.
      const u = px * dirX + py * dirY;
      const v = -px * dirY + py * dirX;
      const du = Math.max(0, Math.abs(u) - BAR_HALF_LENGTH);
      const distance = Math.sqrt(du * du + v * v);
      if (distance >= outer) {
        rgba[i + 3] = 0;
      } else if (distance <= BAR_HALF_WIDTH) {
        rgba[i + 3] = 255;
      } else {
        rgba[i + 3] = Math.round(255 * (1 - (distance - BAR_HALF_WIDTH) / EDGE_AA));
      }
    }
  }
}

async function main(): Promise<void> {
  const totalFrames = DURATION_SECONDS * FPS;
  const writer = new HapMovWriter({
    videoFourCC: 'Hap5',
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    depth: 32,
  });

  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  const startedAt = Date.now();
  for (let frame = 0; frame < totalFrames; frame++) {
    renderFrame(rgba, frame / FPS);
    const blocks = encodeTextureCpu('bc3', rgba, WIDTH, HEIGHT);
    writer.addVideoSample(buildHapFrame({
      formatNibble: HAP_FORMAT_RGBA_DXT5,
      texture: blocks,
      chunkCount: 4,
    }));
    if ((frame + 1) % 30 === 0) {
      console.log(`${frame + 1}/${totalFrames} frames (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
    }
  }

  const blob = writer.finalize();
  const outPath = join(homedir(), 'Desktop', 'hap-alpha-rotating-bar.mov');
  writeFileSync(outPath, new Uint8Array(await blob.arrayBuffer()));
  console.log(`Wrote ${outPath} (${(blob.size / 1e6).toFixed(1)} MB, ${totalFrames} frames)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
