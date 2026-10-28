import { FAST_SOURCES, ensureFastSource } from '../../fixtures/fastExportSources';
import { assertAudioVideoSync, assertFrameCodes } from '../../assertions/fastExportOracle';
import { ExportDriver } from '../../drivers/ExportDriver';
import {
  arrange,
  attachSummary,
  expect,
  expectedCodes,
  exportFast,
  placeSource,
  test,
  withWorkDir,
} from './fastExportScenario';

// Fast (WebCodecs) export of different source files: each source must export frame-exactly
// (every output frame shows the source frame that is current at its time) or stop with a named,
// visible message. The output is always MP4/H.264 so only the source side varies.

test.describe.configure({ timeout: 180_000 });

test('H.264 High source with B-frames exports frame-exactly from an In point @module:export @case:export.mode-fast', async ({ fast }, testInfo) => {
  const source = ensureFastSource(FAST_SOURCES.h264High);
  await arrange(fast.bridge, source, 30, 3);
  await fast.bridge.toolData('setInOutPoints', { inPoint: 0.5, outPoint: 2.5 });
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)', range: 'in-out' });
    await attachSummary(testInfo, result);
    assertFrameCodes(result.read.codes, expectedCodes(source, 30, 2, 0.5), 'B-frame source codes');
  });
});

test('H.265 8-bit source exports frame-exactly @module:export @case:export.fast.src-h265-8bit', async ({ fast }, testInfo) => {
  const source = ensureFastSource(FAST_SOURCES.h265);
  await arrange(fast.bridge, source, 30, 3);
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)' });
    await attachSummary(testInfo, result);
    assertFrameCodes(result.read.codes, expectedCodes(source, 30, 3), 'HEVC source codes');
  });
});

test('long-GOP source exports frame-exactly from the middle of a GOP @module:export @case:export.fast.src-long-gop', async ({ fast }, testInfo) => {
  const source = ensureFastSource(FAST_SOURCES.longGop);
  await arrange(fast.bridge, source, 30, 12);
  // Keyframes sit at 0 s and 10 s; the range starts 5 s into the first GOP.
  await fast.bridge.toolData('setInOutPoints', { inPoint: 5, outPoint: 7 });
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)', range: 'in-out' });
    await attachSummary(testInfo, result);
    assertFrameCodes(result.read.codes, expectedCodes(source, 30, 2, 5), 'long-GOP source codes');
  });
});

test('variable-frame-rate source maps every output frame to the nearest source frame @module:export @case:export.fast.src-vfr', async ({ fast }, testInfo) => {
  // The source has gaps and uneven spacing but no output time exactly halfway between two
  // frames; at such a tie the product's pick depends on timestamp rounding.
  const source = ensureFastSource(FAST_SOURCES.vfr);
  await arrange(fast.bridge, source, 30, 3);
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)' });
    await attachSummary(testInfo, result);
    assertFrameCodes(result.read.codes, expectedCodes(source, 30, 3), 'VFR source codes');
  });
});

test('rotated phone MOV exports upright @module:export @case:export.fast.src-mov-rotation', async ({ fast }, testInfo) => {
  const source = ensureFastSource(FAST_SOURCES.movPortrait);
  await arrange(fast.bridge, source, 30, 3);
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)' });
    await attachSummary(testInfo, result);
    const video = result.metadata.videoTracks[0];
    expect([video.width, video.height]).toEqual([360, 640]);
    // The code band is at the top only when the picture is upright.
    assertFrameCodes(result.read.codes, expectedCodes(source, 30, 3), 'rotated MOV codes');
  });
});

test('PNG with alpha shows the layer below through transparent pixels @module:export @case:export.fast.src-png-alpha', async ({ fast }, testInfo) => {
  const video = ensureFastSource(FAST_SOURCES.h264Baseline);
  const still = ensureFastSource(FAST_SOURCES.pngAlpha);
  await arrange(fast.bridge, video, 30, 3);
  await placeSource(fast.bridge, still.path, { newTrack: 'video' });
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)' });
    await attachSummary(testInfo, result, { centre: result.read.frames.slice(0, 3).map(frame => frame.centre) });
    // Transparent top: the video's frame code stays readable; opaque centre: magenta square.
    assertFrameCodes(result.read.codes, expectedCodes(video, 30, 3), 'codes through the transparent PNG');
    for (const frame of result.read.frames) {
      const [red, green, blue] = frame.centre;
      expect(red, 'magenta red').toBeGreaterThan(200);
      expect(green, 'magenta green').toBeLessThan(60);
      expect(blue, 'magenta blue').toBeGreaterThan(200);
    }
  });
});

for (const key of ['mp3Clicks', 'wavClicks'] as const) {
  test(`${key === 'mp3Clicks' ? 'MP3' : 'WAV'} audio source stays in sync with the picture @module:export @case:export.fast.src-audio-mp3-wav`, async ({ fast }, testInfo) => {
    const video = ensureFastSource(FAST_SOURCES.h264Baseline);
    const audio = ensureFastSource(FAST_SOURCES[key]);
    await arrange(fast.bridge, video, 30, 3);
    await placeSource(fast.bridge, audio.path, { newTrack: 'audio' });
    await withWorkDir(async (workDir) => {
      const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)' });
      const offsets = assertAudioVideoSync(result.read, 1 / 30, 2);
      await attachSummary(testInfo, result, { avOffsetsMs: offsets.map(offset => Math.round(offset * 1000)) });
      expect(result.metadata.audioTracks[0]?.channels).toBe(2);
    });
  });
}

test('WebM/VP9 source exports frame-exactly or stops with a named message @module:export @case:export.fast-webm-source', async ({ fast }, testInfo) => {
  const source = ensureFastSource(FAST_SOURCES.webmVp9);
  await arrange(fast.bridge, source, 30, 3);
  await withWorkDir(async (workDir) => {
    let outcome: string;
    try {
      const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)' });
      await attachSummary(testInfo, result);
      assertFrameCodes(result.read.codes, expectedCodes(source, 30, 3), 'WebM source codes');
      outcome = 'exported';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A refusal must name the source and the way out; a parser error is not an answer.
      expect(message).toMatch(/Product export failed before download/);
      expect(message).toMatch(/WebM/);
      expect(message).toMatch(/Precise/i);
      expect(message).not.toMatch(/MP4Box/);
      await expect(new ExportDriver(fast.page).panel.getByRole('alert')).toBeVisible();
      outcome = message;
    }
    await testInfo.attach('fast-export-outcome', { contentType: 'text/plain', body: outcome });
  });
});
