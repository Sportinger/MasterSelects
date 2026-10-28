import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import type { BridgeClient } from '../../fixtures/bridgeClient';
import { openFrameCodeProject, type FrameCodeProject } from '../../fixtures/frameCodeProject';
import { ExportDriver } from '../../drivers/ExportDriver';
import { inspectMediaArtifact, type MediaArtifactMetadata } from '../../assertions/mediaArtifactAssertions';
import { expectedSourceFrames, readFastExport, type FastExportReading } from '../../assertions/fastExportOracle';
import type { FastSource } from '../../fixtures/fastExportSources';

// Shared steps of the Fast (WebCodecs) export journeys. One editor project per worker (the
// frame-code Sammeltest start, fixtures/frameCodeProject.ts); each case opens its own new
// composition, so cases never see each other's clips or In/Out points. Arrangement (composition,
// imported sources, In/Out points) goes through the Dev Bridge; the export itself runs through
// the visible Export panel. Exported files stay in the OS temp folder and are removed afterwards;
// only a JSON summary is attached to the test result.

export const test = base.extend<object, { fast: FrameCodeProject }>({
  fast: [async ({ browser }, provide, workerInfo) => {
    const project = await openFrameCodeProject(browser, workerInfo.project.use.baseURL, { composition: 'Fast export', placeClip: false })
    await provide(project);
    await project.context.close();
  }, { scope: 'worker', timeout: 180_000 }],
});
export { expect };

interface TimelineClip { id: string; name?: string; startTime: number; duration: number; inPoint?: number; outPoint?: number }
interface TimelineTrack { id: string; name?: string; clips: TimelineClip[] }
export interface TimelineState {
  duration: number;
  videoTracks: TimelineTrack[];
  audioTracks: TimelineTrack[];
}

export interface CompositionSpec { width: number; height: number; fps: number; seconds: number }

let compositionCount = 0;

/** Opens a new composition for one case (the case's clean start). */
export async function createComposition(bridge: BridgeClient, spec: CompositionSpec): Promise<void> {
  compositionCount += 1;
  await bridge.toolData('createComposition', {
    name: `Fast export ${compositionCount}`, width: spec.width, height: spec.height, frameRate: spec.fps, duration: spec.seconds, open: true,
  });
  await expect.poll(async () => {
    const state = await bridge.toolData<TimelineState>('getTimelineState');
    return [...state.videoTracks, ...state.audioTracks].reduce((sum, track) => sum + track.clips.length, 0);
  }, { message: 'the new composition is not empty' }).toBe(0);
}

/** Imports a source file and waits until its clip is on the timeline. */
export async function placeSource(
  bridge: BridgeClient,
  filePath: string,
  options: { startTime?: number; newTrack?: 'video' | 'audio' } = {},
): Promise<TimelineState> {
  const countClips = (state: TimelineState) => [...state.videoTracks, ...state.audioTracks].reduce((sum, track) => sum + track.clips.length, 0);
  const before = countClips(await bridge.toolData<TimelineState>('getTimelineState'));
  await bridge.toolData('importLocalFiles', {
    paths: [filePath.replaceAll('\\', '/')],
    addToTimeline: true,
    startTime: options.startTime ?? 0,
    ...(options.newTrack ? { createTrack: true, trackType: options.newTrack } : {}),
  }, { timeoutMs: 120_000 });
  await expect.poll(async () => countClips(await bridge.toolData<TimelineState>('getTimelineState')), { timeout: 60_000 })
    .toBeGreaterThan(before);
  return bridge.toolData<TimelineState>('getTimelineState');
}

export interface FastExportOptions {
  container: '.mp4' | '.webm';
  videoCodec?: string;
  range?: 'full' | 'in-out';
  timeoutMs?: number;
}

export interface FastExportResult {
  file: string;
  metadata: MediaArtifactMetadata;
  read: FastExportReading;
  audioCodecLabel: string;
}

/** Exports through the panel with Fast (WebCodecs), composition size/fps, then decodes the file. */
export async function exportFast(project: FrameCodeProject, workDir: string, fps: number, options: FastExportOptions): Promise<FastExportResult> {
  await project.editor.waitForProjectIdle(30_000);
  const exporter = new ExportDriver(project.page);
  await exporter.open();
  await exporter.selectContainer(options.container);
  await exporter.selectFastWebCodecs();
  await exporter.useCompositionSettings();
  if (options.videoCodec) await exporter.selectVideoCodec(options.videoCodec);
  if (options.range === 'in-out') await exporter.useInOutMarkers();
  else await exporter.useFullTimeline();
  const audioCodecLabel = await exporter.audioCodecText();
  const file = path.join(workDir, `fast-export${options.container}`);
  await exporter.exportTo(file, options.timeoutMs ?? 120_000);
  const metadata = await inspectMediaArtifact(file);
  const read = await readFastExport(file, { fps, hasAudio: metadata.audioTracks.length > 0 });
  return { file, metadata, read, audioCodecLabel };
}

/** Runs a journey with a private temp folder that is always removed. */
export async function withWorkDir<T>(run: (workDir: string) => Promise<T>): Promise<T> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'masterselects-fast-export-'));
  try {
    return await run(workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function attachSummary(testInfo: TestInfo, result: FastExportResult, extra: Record<string, unknown> = {}): Promise<void> {
  const video = result.metadata.videoTracks[0];
  const audio = result.metadata.audioTracks[0];
  await testInfo.attach('fast-export-summary', {
    contentType: 'application/json',
    body: JSON.stringify({
      sizeBytes: result.metadata.sizeBytes,
      mimeType: result.metadata.mimeType,
      durationSeconds: result.metadata.durationSeconds,
      video: video ? { codec: video.codec, width: video.width, height: video.height, packets: video.packetCount } : null,
      audio: audio ? { codec: audio.codec, sampleRate: audio.sampleRate, channels: audio.channels } : null,
      audioCodecLabel: result.audioCodecLabel,
      decodedFrames: result.read.frames.length,
      firstCodes: result.read.codes.slice(0, 12),
      lastCodes: result.read.codes.slice(-6),
      clicks: result.read.clickTimes?.length ?? 0,
      ...extra,
    }, null, 2),
  });
}

/** Expected codec of MP4 audio on this host: Chrome on Linux cannot encode AAC and falls back to Opus. */
export function expectedMp4AudioCodec(): 'aac' | 'opus' {
  return process.platform === 'linux' ? 'opus' : 'aac';
}

export function frameCount(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/** Expected code per output frame: the source frame current at that time (nearest sample). */
export function expectedCodes(source: FastSource, fps: number, seconds: number, sourceStart = 0): number[] {
  return expectedSourceFrames({
    outputFrames: frameCount(seconds, fps), outputFps: fps, sourceStart, sourceTimestamps: source.frameTimestamps,
  }).map(index => source.frameCodes[index]);
}

/** A new composition of the source's size at `fps` with the source on the timeline at 0. */
export async function arrange(bridge: BridgeClient, source: FastSource, fps: number, seconds: number): Promise<TimelineState> {
  await createComposition(bridge, { width: source.width, height: source.height, fps, seconds });
  return placeSource(bridge, source.path);
}

/** Whether this browser can encode a codec string (the panel must agree with it). */
export async function browserEncodes(page: Page, codec: string, width: number, height: number): Promise<boolean> {
  return page.evaluate(async ({ codec, width, height }) => {
    if (typeof VideoEncoder === 'undefined') return false;
    const result = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 5_000_000, framerate: 30 }).catch(() => null);
    return Boolean(result?.supported);
  }, { codec, width, height });
}
