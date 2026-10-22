// Docs clip encoding: the value a control clip burns in keeps its sign. ffmpeg draws the label on a white
// frame; the label's dark box is wider while the value is negative (the "-" is drawn) and as wide at -0.5
// as "0.50" plus a minus sign, never "0.50" alone (trunc and mod of a negative value used to drop the sign).
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { sweepLabel } from '../../scripts/docClipVideo.mjs';

const available = (tool: string, args: string[]) => spawnSync(tool, args, { encoding: 'utf8' }).status === 0;
const tools = available('ffmpeg', ['-version']) && available('fc-match', ['--version']);

/** Width in px of the label box at clip time `t`: columns in the bottom band that have a dark pixel. */
function boxWidth(filter: string, t: number) {
  const width = 480, height = 120;
  const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=white:size=${width}x${height}:rate=10:duration=3`,
    '-vf', `${filter},format=gray`, '-ss', String(t), '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  expect(result.status, String(result.stderr)).toBe(0);
  const pixels = result.stdout as Buffer;
  let columns = 0;
  for (let x = 0; x < width; x += 1) {
    for (let y = height / 2; y < height; y += 1) if (pixels[y * width + x] < 200) { columns += 1; break; }
  }
  return columns;
}

describe('docs clip sweep label', () => {
  it.skipIf(!tools)('shows the minus sign of a negative swept value', () => {
    // -1 → 1 → -1 over 3 s: -0.5 at 0.5 s, +0.5 at 1 s.
    const filter = sweepLabel({ sweep: { param: 'gain', label: 'Gain', from: -1, to: 1, decimals: 2 } }, { width: 480, duration: 3 });
    const negative = boxWidth(filter, 0.5), positive = boxWidth(filter, 1);
    expect(positive).toBeGreaterThan(40);
    expect(negative).toBeGreaterThan(positive + 3);
    // Whole numbers keep their sign as before.
    const whole = sweepLabel({ sweep: { param: 'angle', label: 'Angle', from: -90, to: 90 } }, { width: 480, duration: 3 });
    expect(boxWidth(whole, 0.5)).toBeGreaterThan(boxWidth(whole, 1));
  });
});
