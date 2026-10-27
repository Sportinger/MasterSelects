import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { ExportDriver } from '../../drivers/ExportDriver';
import { inspectMediaArtifact } from '../../assertions/mediaArtifactAssertions';

// FAST (WebCodecs) export from a source larger than Chromium reads into one ArrayBuffer:
// Blob.arrayBuffer() of a 4.48 GB phone recording failed with NotReadableError and the export
// stopped with "Could not load file data". FAST export now parses only the moov and reads sample
// bytes on demand (src/engine/webcodecs/fileSampleData.ts). The journey drops the file onto the
// timeline as a disk-backed File (as from the OS), trims the clip to the end of the source and
// exports from there, so the samples also sit beyond 32-bit file offsets (co64).
// The source is a high-bitrate testsrc2 segment with audio, generated once and concatenated
// without re-encoding; MASTERSELECTS_LARGE_VIDEO_FIXTURE uses a real file instead. It stays in
// the OS temp folder, the export is deleted after the checks; a JSON summary and three exported
// frames are attached.

// Above 2^32 bytes the moov needs 64-bit chunk offsets (co64); the generated source adds margin.
const OVER_32_BIT_OFFSETS = 2 ** 32;
const MIN_SOURCE_BYTES = 4.3 * 1024 ** 3;
const TRIMMED_SECONDS = 8;
const RANGE = { inPoint: 1, outPoint: 7 };

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message}`);
  return `${result.stdout}${result.stderr}`;
}

function ffmpeg(args: string[]): string {
  return run('ffmpeg', ['-hide_banner', '-y', ...args]);
}

function largeVideoFixture(): string {
  const own = process.env.MASTERSELECTS_LARGE_VIDEO_FIXTURE?.trim();
  if (own) return path.resolve(own);
  const directory = path.join(os.tmpdir(), 'masterselects-e2e-fixtures');
  const file = path.join(directory, 'large-source-over-4gib.mp4');
  if (existsSync(file) && statSync(file).size >= MIN_SOURCE_BYTES) return file;
  mkdirSync(directory, { recursive: true });
  const segment = path.join(directory, 'large-source-segment.mp4');
  ffmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '1', '-g', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', segment]);
  const copies = Math.ceil(MIN_SOURCE_BYTES / statSync(segment).size) + 1;
  const list = path.join(directory, 'large-source-segments.txt');
  writeFileSync(list, Array.from({ length: copies }, () => `file '${segment.replaceAll("'", "'\\''")}'`).join('\n'));
  ffmpeg(['-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', file]);
  return file;
}

interface TimelineClip { id: string; startTime: number; duration: number; inPoint?: number; outPoint?: number }
interface TimelineState {
  duration: number;
  zoom: number;
  videoTracks: Array<{ id: string; clips: TimelineClip[] }>;
  audioTracks: Array<{ id: string; clips: TimelineClip[] }>;
}

/** Drops the file at time 0 of the first video track as a File backed by the disk, not by memory. */
async function dropOntoTimeline(page: Page, state: TimelineState, file: string): Promise<void> {
  const ruler = await page.locator('[data-ai-id="timeline-ruler"]').boundingBox();
  const row = await page.locator(`[data-track-id="${state.videoTracks[0].id}"]`).first().boundingBox();
  if (!ruler || !row) throw new Error('timeline ruler or track row not visible');
  await page.evaluate(() => {
    const input = Object.assign(document.createElement('input'), { type: 'file', id: 'large-source-input', hidden: true });
    document.body.append(input);
  });
  await page.setInputFiles('#large-source-input', file);
  await page.evaluate(({ x, y }) => {
    const input = document.getElementById('large-source-input') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(input.files![0]);
    input.remove();
    const target = document.elementFromPoint(x, y);
    if (!target) throw new Error(`nothing at ${x},${y}`);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: transfer }));
    }
  }, { x: ruler.x + 2, y: row.y + row.height / 2 });
}

test.describe.configure({ timeout: 900_000 });

test('FAST export reads a source above 4 GiB on demand and exports from its end @module:export', async ({ page, bridge }, testInfo) => {
  const source = largeVideoFixture();
  const sourceBytes = statSync(source).size;
  expect(sourceBytes).toBeGreaterThan(OVER_32_BIT_OFFSETS);
  const exportDir = await mkdtemp(path.join(os.tmpdir(), 'masterselects-large-source-'));
  const timeline = () => bridge.toolData<TimelineState>('getTimelineState');
  try {
    let sourceSeconds = 0;
    await test.step('drop the large source onto the timeline and trim it to its last seconds', async () => {
      await dropOntoTimeline(page, await timeline(), source);
      const placedClip = async () => (await timeline()).videoTracks[0]?.clips[0];
      // A source whose size differs from the composition asks how to place it (Fit/Stretch/Keep).
      const fit = page.getByRole('button', { name: 'Fit', exact: true });
      await expect.poll(async () => await fit.isVisible() || Boolean(await placedClip()), { timeout: 180_000, message: 'the drop neither placed a clip nor asked how to' })
        .toBe(true);
      if (await fit.isVisible()) await fit.click();
      await expect.poll(async () => (await placedClip())?.duration ?? 0, { timeout: 180_000, message: 'the dropped clip never got its duration' })
        .toBeGreaterThan(TRIMMED_SECONDS * 2);
      const clip = (await placedClip())!;
      sourceSeconds = clip.outPoint ?? clip.duration;
      await bridge.toolData('trimClip', { clipId: clip.id, inPoint: sourceSeconds - TRIMMED_SECONDS, outPoint: sourceSeconds });
      await bridge.toolData('setInOutPoints', RANGE);
    });

    const exporter = new ExportDriver(page);
    const destination = path.join(exportDir, 'large-source.mp4');
    await test.step('export the In/Out range with FAST WebCodecs', async () => {
      await exporter.open();
      await exporter.selectFastWebCodecs();
      await exporter.selectContainer('.mp4');
      await exporter.useInOutMarkers();
      await exporter.exportTo(destination, 600_000);
    });

    await test.step('the file holds the range as picture and sound', async () => {
      const seconds = RANGE.outPoint - RANGE.inPoint;
      const artifact = await inspectMediaArtifact(destination);
      const frames = path.join(exportDir, 'frames.png');
      ffmpeg(['-v', 'error', '-i', destination, '-vf', "select='eq(n\\,15)+eq(n\\,90)+eq(n\\,170)',scale=480:-2,tile=3x1", '-frames:v', '1', frames]);
      await testInfo.attach('export-frames', { path: frames, contentType: 'image/png' });
      const luma = [...ffmpeg(['-i', destination, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'])
        .matchAll(/YAVG=([\d.]+)/g)].map((match) => Number(match[1]));
      await testInfo.attach('export-summary', { contentType: 'application/json', body: JSON.stringify({
        sourceBytes, sourceSeconds, durationSeconds: artifact.durationSeconds, video: artifact.videoTracks[0],
        audioTracks: artifact.audioTracks.length, sizeBytes: artifact.sizeBytes,
        lumaMin: Math.min(...luma), lumaMax: Math.max(...luma), frames: luma.length,
      }, null, 2) });
      expect(artifact.videoTracks.length).toBe(1);
      expect(artifact.audioTracks.length).toBe(1);
      expect(artifact.durationSeconds).toBeGreaterThan(seconds - 0.2);
      expect(artifact.durationSeconds).toBeLessThan(seconds + 0.2);
      expect(luma.length).toBeGreaterThan(0);
      expect(Math.min(...luma), 'an exported frame is black: the source picture did not reach the export').toBeGreaterThan(2);
    });
  } finally {
    await rm(exportDir, { recursive: true, force: true });
  }
});
