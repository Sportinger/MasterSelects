import { FAST_SOURCES, ensureFastSource } from '../../fixtures/fastExportSources';
import { assertAudioVideoSync, assertFrameCodes } from '../../assertions/fastExportOracle';
import { ExportDriver } from '../../drivers/ExportDriver';
import {
  arrange,
  attachSummary,
  browserEncodes,
  expect,
  expectedCodes,
  expectedMp4AudioCodec,
  exportFast,
  test,
  withWorkDir,
} from './fastExportScenario';

// Fast (WebCodecs) export: output containers, codecs, range and frame-exactness. Every journey
// exports a short frame-code clip (fixtures/fastExportSources.ts) through the Export panel and
// decodes the whole file outside the browser (assertions/fastExportOracle.ts).

test.describe.configure({ timeout: 180_000 });

test('MP4 · H.264 + AAC exports every source frame once @module:export @smoke @case:export.mp4-h264-aac', async ({ fast }, testInfo) => {
  const source = await ensureFastSource(FAST_SOURCES.h264High);
  await arrange(fast.bridge, source, 30, 3);
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)' });
    await attachSummary(testInfo, result);
    const video = result.metadata.videoTracks[0];
    expect(video.codec).toBe('avc');
    expect([video.width, video.height]).toEqual([640, 360]);
    expect(result.metadata.audioTracks[0]?.codec).toBe(expectedMp4AudioCodec());
    if (expectedMp4AudioCodec() === 'opus') expect(result.audioCodecLabel).toContain('fallback');
    assertFrameCodes(result.read.codes, expectedCodes(source, 30, 3), 'H.264 export frame codes');
    assertAudioVideoSync(result.read, 1 / 30, 2);
  });
});

test('MP4 · H.265 exports where the browser encodes HEVC and is unavailable elsewhere @module:export @case:export.mp4-h265-aac', async ({ fast }, testInfo) => {
  const source = await ensureFastSource(FAST_SOURCES.h264High);
  await arrange(fast.bridge, source, 30, 3);
  const exporter = new ExportDriver(fast.page);
  await exporter.open();
  await exporter.selectContainer('.mp4');
  await exporter.selectFastWebCodecs();
  const option = await exporter.videoCodecOption('H.265 (HEVC)');
  const encodes = await browserEncodes(fast.page, 'hvc1.1.6.L93.B0', 640, 360);
  // Chrome on Linux has no HEVC encoder; on Windows the GPU encoder must be offered and used.
  if (process.platform === 'linux') expect(encodes).toBe(false);
  if (process.platform === 'win32') expect(encodes).toBe(true);
  if (!encodes) {
    await expect(option).toBeDisabled();
    await exporter.closeOpenList();
    await testInfo.attach('fast-export-summary', { contentType: 'application/json', body: JSON.stringify({ hevcEncoder: false, option: 'disabled' }) });
    return;
  }
  await exporter.closeOpenList();
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.265 (HEVC)' });
    await attachSummary(testInfo, result, { hevcEncoder: true });
    expect(result.metadata.videoTracks[0].codec).toBe('hevc');
    expect(result.metadata.audioTracks[0]?.codec).toBe(expectedMp4AudioCodec());
    assertFrameCodes(result.read.codes, expectedCodes(source, 30, 3), 'H.265 export frame codes');
  });
});

test('WebM · VP9 + Opus exports every source frame once @module:export @case:export.webm-vp9-opus', async ({ fast }, testInfo) => {
  const source = await ensureFastSource(FAST_SOURCES.h264High);
  await arrange(fast.bridge, source, 30, 3);
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.webm', videoCodec: 'VP9' });
    await attachSummary(testInfo, result);
    expect(result.metadata.mimeType).toContain('webm');
    expect(result.metadata.videoTracks[0].codec).toBe('vp9');
    expect(result.metadata.audioTracks[0]?.codec).toBe('opus');
    assertFrameCodes(result.read.codes, expectedCodes(source, 30, 3), 'VP9 export frame codes');
    assertAudioVideoSync(result.read, 1 / 30, 2);
  });
});

test('In/Out range exports exactly the frames between the markers @module:export @case:export.range-in-out', async ({ fast }, testInfo) => {
  const source = await ensureFastSource(FAST_SOURCES.h264High);
  await arrange(fast.bridge, source, 30, 3);
  await fast.bridge.toolData('setInOutPoints', { inPoint: 1, outPoint: 2 });
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)', range: 'in-out' });
    await attachSummary(testInfo, result);
    assertFrameCodes(result.read.codes, expectedCodes(source, 30, 1, 1), 'In/Out export frame codes');
    expect(result.metadata.durationSeconds).toBeCloseTo(1, 1);
  });
});

test('1080p60 export keeps size, rate and every frame @module:export @case:export.format-1080p60', async ({ fast }, testInfo) => {
  const source = await ensureFastSource(FAST_SOURCES.h264Hd60);
  await arrange(fast.bridge, source, 60, 2);
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 60, { container: '.mp4', videoCodec: 'H.264 (AVC)' });
    await attachSummary(testInfo, result);
    const video = result.metadata.videoTracks[0];
    expect([video.width, video.height]).toEqual([1920, 1080]);
    expect(video.packetCount).toBe(120);
    expect(video.averagePacketRate).toBeCloseTo(60, 0);
    assertFrameCodes(result.read.codes, expectedCodes(source, 60, 2), '1080p60 export frame codes');
  });
});

test('audio stays within one frame of the picture @module:export @case:export.audio-sync', async ({ fast }, testInfo) => {
  const source = await ensureFastSource(FAST_SOURCES.h264Eight);
  await arrange(fast.bridge, source, 30, 8);
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)' });
    const offsets = assertAudioVideoSync(result.read, 1 / 30, 7);
    await attachSummary(testInfo, result, { avOffsetsMs: offsets.map(offset => Math.round(offset * 1000)) });
    expect(result.metadata.audioTracks[0].channels).toBe(2);
    expect(Math.abs(result.metadata.durationSeconds - 8)).toBeLessThan(1 / 30 + 0.03);
  });
});

test('codec lists offer only what the container and browser can encode @module:export @case:export.unsupported-combo-rejected', async ({ fast }, testInfo) => {
  const source = await ensureFastSource(FAST_SOURCES.h264High);
  await arrange(fast.bridge, source, 30, 3);
  const exporter = new ExportDriver(fast.page);
  await exporter.open();
  await exporter.selectFastWebCodecs();
  const findings: Record<string, string> = {};
  await exporter.selectContainer('.webm');
  await exporter.videoCodecOption('VP9');
  await expect(fast.page.getByRole('option', { name: 'H.264 (AVC)', exact: true })).toHaveCount(0);
  await expect(fast.page.getByRole('option', { name: 'H.265 (HEVC)', exact: true })).toHaveCount(0);
  await exporter.closeOpenList();
  await exporter.selectContainer('.mp4');
  const codecs = [['H.264 (AVC)', 'avc1.640028'], ['H.265 (HEVC)', 'hvc1.1.6.L93.B0'], ['VP9', 'vp09.00.10.08'], ['AV1', 'av01.0.04M.08']] as const;
  for (const [label, codec] of codecs) {
    const encodes = await browserEncodes(fast.page, codec, 640, 360);
    const option = await exporter.videoCodecOption(label);
    if (encodes) await expect(option).toBeEnabled();
    else await expect(option).toBeDisabled();
    findings[label] = encodes ? 'offered' : 'disabled';
    await exporter.closeOpenList();
  }
  await testInfo.attach('fast-export-summary', { contentType: 'application/json', body: JSON.stringify({ mp4: findings, webm: ['VP9', 'AV1'] }) });
});

test('an 8-second export contains every frame exactly once @module:export @case:export.fast.frame-sequence-8s', async ({ fast }, testInfo) => {
  const source = await ensureFastSource(FAST_SOURCES.h264Eight);
  await arrange(fast.bridge, source, 30, 8);
  await withWorkDir(async (workDir) => {
    const result = await exportFast(fast, workDir, 30, { container: '.mp4', videoCodec: 'H.264 (AVC)' });
    await attachSummary(testInfo, result);
    expect(result.read.codes).toHaveLength(240);
    assertFrameCodes(result.read.codes, expectedCodes(source, 30, 8), '8-second export frame codes');
  });
});
