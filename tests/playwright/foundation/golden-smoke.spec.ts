import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import type { StressTestProjectData } from '../fixtures/test';
import { ExportDriver } from '../drivers/ExportDriver';
import { PreviewDriver } from '../drivers/PreviewDriver';
import { TimelineDriver, type TimelineSnapshot } from '../drivers/TimelineDriver';
import {
  assertGoldenVideoArtifact,
  inspectMediaArtifact,
} from '../assertions/mediaArtifactAssertions';
import { unexpectedConsoleErrors } from '../assertions/consoleAssertions';

interface CapturedFrame {
  capturedAt: number;
  width: number;
  height: number;
  mode: string;
  dataUrl: string;
}

interface AudioDiagnostics {
  timeline: {
    isPlaying: boolean;
    audioClipCount: number;
  };
  mediaSummary: {
    elementCount: number;
    playingElementCount: number;
    audibleElementCount: number;
  };
}

const FIXTURE_DURATION_SECONDS = 2;
const FIXTURE_WIDTH = 320;
const FIXTURE_HEIGHT = 180;
const FIXTURE_FRAME_RATE = 6;

test.describe.configure({ timeout: 180_000 });

test(
  'headed Golden Smoke: preview, Play/Pause/Scrub/Stop and UI export '
    + '@smoke @module:foundation',
  async ({ page, bridge, editorPage, failureEvidence, isolatedProject }, testInfo) => {
    const timeline = new TimelineDriver(page);
    const preview = new PreviewDriver(page);
    const exporter = new ExportDriver(page);
    const readTimeline = () => bridge.toolData<TimelineSnapshot>('getTimelineState');

    let project: StressTestProjectData;
    await test.step('create an isolated nested-composition media fixture', async () => {
      project = await isolatedProject.createStressTestProjectData({
        durationSeconds: FIXTURE_DURATION_SECONDS,
        width: FIXTURE_WIDTH,
        height: FIXTURE_HEIGHT,
        frameRate: FIXTURE_FRAME_RATE,
        timeoutMs: 90_000,
        // The Fast WebCodecs path is currently MP4-backed. Reusing the same
        // tracked real-media MP4 for all three deterministic stress roles keeps
        // nested/mask coverage without routing WebM through the MP4 demuxer.
        primaryMediaOnly: true,
      });
      await editorPage.waitForProjectIdle(30_000);

      expect(project.imported).toHaveLength(3);
      expect(project.compositionSummaries.length).toBeGreaterThanOrEqual(3);
      expect(project.timeline.clipCount).toBeGreaterThanOrEqual(3);
      expect(project.timeline.duration).toBeCloseTo(FIXTURE_DURATION_SECONDS, 2);
      await testInfo.attach('isolated-project-fixture.json', {
        body: Buffer.from(JSON.stringify(project, null, 2)),
        contentType: 'application/json',
      });
    });

    await test.step('prove a visible preview frame', async () => {
      await preview.expectReady();
      const capture = await bridge.toolData<CapturedFrame>('captureFrame', {
        time: 0.25,
        mode: 'auto',
        settleMs: 240,
      }, {
        timeoutMs: 20_000,
        fetchTimeoutMs: 25_000,
      });

      expect(capture.width).toBe(FIXTURE_WIDTH);
      expect(capture.height).toBe(FIXTURE_HEIGHT);
      const frame = parseDataUrl(capture.dataUrl);
      expect(frame.bytes.byteLength).toBeGreaterThan(1_024);
      const pixelEvidence = await analyzeFramePixels(page, capture.dataUrl);
      expect(pixelEvidence.nonTransparentRatio).toBeGreaterThan(0.95);
      expect(pixelEvidence.luminanceRange).toBeGreaterThan(8);
      expect(pixelEvidence.luminanceBuckets).toBeGreaterThan(4);
      await testInfo.attach('golden-preview-frame', {
        body: frame.bytes,
        contentType: frame.contentType,
      });
      await testInfo.attach('golden-preview-pixel-evidence.json', {
        body: Buffer.from(JSON.stringify(pixelEvidence, null, 2)),
        contentType: 'application/json',
      });
    });

    await test.step('drive Play, Pause, Scrub and Stop through visible controls', async () => {
      const beforePlay = await readTimeline();
      await timeline.play();
      await timeline.expectPlayheadAfter(
        readTimeline,
        beforePlay.playheadPosition + 0.08,
      );
      await expect.poll(async () => {
        const diagnostics = await bridge.toolData<AudioDiagnostics>('getAudioDiagnostics', {
          windowMs: 5_000,
          eventLimit: 30,
        });
        return diagnostics.timeline.audioClipCount > 0
          && diagnostics.mediaSummary.playingElementCount > 0;
      }, { message: 'Expected a routed media audio element to become active during playback.' }).toBe(true);

      await timeline.pause();
      await timeline.expectPausedPositionStable(readTimeline);

      const scrubTarget = (await readTimeline()).duration * 0.65;
      await timeline.scrubToFraction(0.65);
      await timeline.expectPlayheadNear(readTimeline, scrubTarget, 0.18);

      await timeline.stop();
      await timeline.expectPlayheadNear(readTimeline, 0, 0.04);
    });

    await test.step('export through the UI and inspect the downloaded media', async () => {
      await exporter.open();
      await exporter.selectFastWebCodecs();
      await exporter.useCompositionSettings();
      await exporter.setFilename('playwright-golden-smoke');

      const artifactPath = testInfo.outputPath('playwright-golden-smoke.mp4');
      const download = await exporter.exportTo(artifactPath);
      expect(download.suggestedFilename()).toBe('playwright-golden-smoke.mp4');

      const metadata = await inspectMediaArtifact(artifactPath);
      assertGoldenVideoArtifact(metadata, {
        width: FIXTURE_WIDTH,
        height: FIXTURE_HEIGHT,
        durationSeconds: FIXTURE_DURATION_SECONDS,
        requireAudio: true,
      });
      const decodedFrameEvidence = await analyzeVideoArtifactPixels(
        page,
        (await readFile(artifactPath)).toString('base64'),
        metadata.mimeType.split(';')[0] || 'video/mp4',
      );
      expect(decodedFrameEvidence.luminanceRange).toBeGreaterThan(8);
      expect(decodedFrameEvidence.luminanceBuckets).toBeGreaterThan(4);
      await testInfo.attach('golden-export-metadata.json', {
        body: Buffer.from(JSON.stringify(metadata, null, 2)),
        contentType: 'application/json',
      });
      await testInfo.attach('golden-export-decoded-frame.json', {
        body: Buffer.from(JSON.stringify(decodedFrameEvidence, null, 2)),
        contentType: 'application/json',
      });
      await testInfo.attach('golden-export.mp4', {
        path: artifactPath,
        contentType: 'video/mp4',
      });
    });

    await test.step('assert no fatal browser errors escaped the journey', async () => {
      expect(failureEvidence.pageErrors, 'Unexpected uncaught page errors.').toEqual([]);
      expect(
        unexpectedConsoleErrors(failureEvidence.consoleEntries),
        'Unexpected browser console errors.',
      ).toEqual([]);
    });
  },
);

function parseDataUrl(dataUrl: string): { contentType: string; bytes: Buffer } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Captured preview frame is not a base64 data URL.');
  }
  return {
    contentType: match[1],
    bytes: Buffer.from(match[2], 'base64'),
  };
}

async function analyzeFramePixels(page: Page, dataUrl: string): Promise<{
  sampledPixels: number;
  nonTransparentRatio: number;
  luminanceRange: number;
  luminanceBuckets: number;
}> {
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create a 2D context for pixel evidence.');
    context.drawImage(image, 0, 0);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const stridePixels = Math.max(1, Math.floor((canvas.width * canvas.height) / 20_000));
    const buckets = new Set<number>();
    let sampledPixels = 0;
    let nonTransparentPixels = 0;
    let minimumLuminance = 255;
    let maximumLuminance = 0;

    for (let pixel = 0; pixel < canvas.width * canvas.height; pixel += stridePixels) {
      const offset = pixel * 4;
      const alpha = pixels[offset + 3];
      const luminance = Math.round(
        pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722,
      );
      sampledPixels += 1;
      if (alpha > 8) nonTransparentPixels += 1;
      minimumLuminance = Math.min(minimumLuminance, luminance);
      maximumLuminance = Math.max(maximumLuminance, luminance);
      buckets.add(Math.floor(luminance / 8));
    }

    return {
      sampledPixels,
      nonTransparentRatio: nonTransparentPixels / Math.max(1, sampledPixels),
      luminanceRange: maximumLuminance - minimumLuminance,
      luminanceBuckets: buckets.size,
    };
  }, dataUrl);
}

async function analyzeVideoArtifactPixels(
  page: Page,
  base64: string,
  contentType: string,
): Promise<{
  decodedWidth: number;
  decodedHeight: number;
  decodedDuration: number;
  luminanceRange: number;
  luminanceBuckets: number;
}> {
  return page.evaluate(async ({ encoded, mimeType }) => {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;

    try {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error(
          video.error?.message || `Browser could not decode exported ${mimeType}.`,
        )), { once: true });
        video.load();
      });

      const sampleTime = Math.min(Math.max(0, video.duration / 2), Math.max(0, video.duration - 0.05));
      if (sampleTime > 0.01) {
        await new Promise<void>((resolve, reject) => {
          video.addEventListener('seeked', () => resolve(), { once: true });
          video.addEventListener('error', () => reject(new Error(
            video.error?.message || 'Browser failed while seeking the exported video.',
          )), { once: true });
          video.currentTime = sampleTime;
        });
      }

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not create a 2D context for decoded export evidence.');
      context.drawImage(video, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const stridePixels = Math.max(1, Math.floor((canvas.width * canvas.height) / 20_000));
      const buckets = new Set<number>();
      let minimumLuminance = 255;
      let maximumLuminance = 0;

      for (let pixel = 0; pixel < canvas.width * canvas.height; pixel += stridePixels) {
        const offset = pixel * 4;
        const luminance = Math.round(
          pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722,
        );
        minimumLuminance = Math.min(minimumLuminance, luminance);
        maximumLuminance = Math.max(maximumLuminance, luminance);
        buckets.add(Math.floor(luminance / 8));
      }

      return {
        decodedWidth: video.videoWidth,
        decodedHeight: video.videoHeight,
        decodedDuration: video.duration,
        luminanceRange: maximumLuminance - minimumLuminance,
        luminanceBuckets: buckets.size,
      };
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  }, { encoded: base64, mimeType: contentType });
}
