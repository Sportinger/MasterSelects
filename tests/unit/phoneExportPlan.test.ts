import { describe, expect, it } from 'vitest';

import {
  buildPhoneExportPlan,
  findEditedContentEnd,
  formatPhoneExportDuration,
  resolvePhoneExportRange,
  resolvePhoneExportSize,
  type PhoneExportCapabilities,
  type PhoneExportPlanInput,
  type PhoneExportPlanReady,
} from '../../src/components/mobileSkin/export/phoneExportPlan';

const allSupported: PhoneExportCapabilities = {
  exporterSupported: true,
  h264: true,
  audioCodec: 'aac',
};

const tracks = [
  { id: 'v1', type: 'video', visible: true, muted: false },
  { id: 'a1', type: 'audio', visible: true, muted: false },
];

function input(overrides: Partial<PhoneExportPlanInput> = {}): PhoneExportPlanInput {
  return {
    composition: { width: 1080, height: 1920, frameRate: 30 },
    clips: [{ trackId: 'v1', startTime: 0, duration: 12 }],
    tracks,
    inPoint: null,
    outPoint: null,
    capabilities: allSupported,
    ...overrides,
  };
}

function ready(overrides: Partial<PhoneExportPlanInput> = {}): PhoneExportPlanReady {
  const plan = buildPhoneExportPlan(input(overrides));
  if (!plan.supported) throw new Error(`expected a ready plan, got: ${plan.reason}`);
  return plan;
}

describe('resolvePhoneExportSize', () => {
  it('keeps a portrait 1080x1920 composition', () => {
    expect(resolvePhoneExportSize({ width: 1080, height: 1920, frameRate: 30 })).toEqual({
      width: 1080, height: 1920, scaledDown: false,
    });
  });

  it('keeps a landscape 1920x1080 composition', () => {
    expect(resolvePhoneExportSize({ width: 1920, height: 1080, frameRate: 30 })).toMatchObject({
      width: 1920, height: 1080, scaledDown: false,
    });
  });

  it('scales a larger composition down to a 1080 short side', () => {
    expect(resolvePhoneExportSize({ width: 2160, height: 3840, frameRate: 30 })).toEqual({
      width: 1080, height: 1920, scaledDown: true,
    });
    expect(resolvePhoneExportSize({ width: 3840, height: 2160, frameRate: 30 })).toMatchObject({
      width: 1920, height: 1080, scaledDown: true,
    });
  });

  it('never upscales a composition below 1080 on the short side', () => {
    expect(resolvePhoneExportSize({ width: 720, height: 1280, frameRate: 30 })).toEqual({
      width: 720, height: 1280, scaledDown: false,
    });
  });

  it('rounds odd sizes to even numbers', () => {
    expect(resolvePhoneExportSize({ width: 719, height: 1279, frameRate: 30 })).toMatchObject({
      width: 720, height: 1280,
    });
    const scaled = resolvePhoneExportSize({ width: 1081, height: 1921, frameRate: 30 });
    expect(scaled.width % 2).toBe(0);
    expect(scaled.height % 2).toBe(0);
    expect(Math.min(scaled.width, scaled.height)).toBe(1080);
  });
});

describe('edited content range', () => {
  it('ends at the last clip and ignores the 60 s padded duration', () => {
    const plan = ready({
      clips: [
        { trackId: 'v1', startTime: 0, duration: 5 },
        { trackId: 'v1', startTime: 5, duration: 7.5 },
      ],
    });
    expect(plan.startTime).toBe(0);
    expect(plan.endTime).toBe(12.5);
    expect(plan.durationSec).toBe(12.5);
    expect(plan.rangeSource).toBe('content');
  });

  it('skips clips on hidden video tracks and muted audio tracks', () => {
    const end = findEditedContentEnd(
      [
        { trackId: 'v1', startTime: 0, duration: 4 },
        { trackId: 'v2', startTime: 0, duration: 30 },
        { trackId: 'a2', startTime: 0, duration: 40 },
      ],
      [
        ...tracks,
        { id: 'v2', type: 'video', visible: false, muted: false },
        { id: 'a2', type: 'audio', visible: true, muted: true },
      ],
    );
    expect(end).toBe(4);
  });

  it('respects an explicit in/out range', () => {
    expect(resolvePhoneExportRange(12, 2, 8)).toEqual({ startTime: 2, endTime: 8, source: 'in-out' });
    expect(resolvePhoneExportRange(12, null, 6)).toEqual({ startTime: 0, endTime: 6, source: 'in-out' });
    expect(resolvePhoneExportRange(12, 3, null)).toEqual({ startTime: 3, endTime: 12, source: 'in-out' });
    const plan = ready({ inPoint: 2, outPoint: 8 });
    expect(plan.durationSec).toBe(6);
    expect(plan.notice).toContain('in/out');
  });
});

describe('buildPhoneExportPlan', () => {
  it('plans MP4/H.264 with AAC and a readable summary', () => {
    const plan = ready();
    expect(plan).toMatchObject({
      width: 1080, height: 1920, fps: 30, videoCodec: 'h264', containerFormat: 'mp4',
      extension: 'mp4', includeAudio: true, notice: null,
    });
    expect(plan.summary).toBe('1080 × 1920 · 30 fps · 0:12 · MP4');
    expect(plan.bitrate).toBeGreaterThanOrEqual(4_000_000);
  });

  it('uses the composition frame rate', () => {
    const plan = ready({ composition: { width: 1080, height: 1920, frameRate: 29.97 } });
    expect(plan.fps).toBe(29.97);
    expect(plan.summary).toContain('29.97 fps');
  });

  it('formats durations as m:ss', () => {
    expect(formatPhoneExportDuration(12.4)).toBe('0:12');
    expect(formatPhoneExportDuration(75)).toBe('1:15');
    expect(formatPhoneExportDuration(0.2)).toBe('0:01');
  });

  it('explains an empty timeline', () => {
    const plan = buildPhoneExportPlan(input({ clips: [] }));
    expect(plan).toMatchObject({ supported: false });
    expect(plan.supported === false && plan.reason).toMatch(/nothing to export/i);
  });

  it('explains an empty in/out range', () => {
    const plan = buildPhoneExportPlan(input({ inPoint: 5, outPoint: 5 }));
    expect(plan.supported === false && plan.reason).toMatch(/in\/out/i);
  });

  it('explains a missing composition', () => {
    const plan = buildPhoneExportPlan(input({ composition: null }));
    expect(plan.supported === false && plan.reason).toMatch(/composition/i);
  });

  it('explains a browser without WebCodecs', () => {
    const plan = buildPhoneExportPlan(input({ capabilities: { exporterSupported: false, h264: false, audioCodec: null } }));
    expect(plan.supported === false && plan.reason).toMatch(/WebCodecs/);
  });

  it('explains missing H.264 and names the size', () => {
    const plan = buildPhoneExportPlan(input({ capabilities: { ...allSupported, h264: false } }));
    expect(plan.supported).toBe(false);
    expect(plan.supported === false && plan.reason).toContain('H.264 at 1080 × 1920');
  });

  it('falls back to WebM/VP9 with a visible notice', () => {
    const plan = ready({ capabilities: { ...allSupported, h264: false, vp9: true } });
    expect(plan).toMatchObject({ videoCodec: 'vp9', containerFormat: 'webm', extension: 'webm' });
    expect(plan.notice).toMatch(/WebM/);
  });

  it('does not silently drop audio when no audio encoder exists', () => {
    const plan = ready({ capabilities: { ...allSupported, audioCodec: null } });
    expect(plan.includeAudio).toBe(false);
    expect(plan.notice).toMatch(/no sound/i);
  });

  it('says so when AAC is replaced by Opus', () => {
    const plan = ready({ capabilities: { ...allSupported, audioCodec: 'opus' } });
    expect(plan.includeAudio).toBe(true);
    expect(plan.notice).toMatch(/Opus/);
  });

  it('mentions downscaling from a larger composition', () => {
    const plan = ready({ composition: { width: 2160, height: 3840, frameRate: 30 } });
    expect(plan.width).toBe(1080);
    expect(plan.notice).toContain('2160 × 3840');
  });
});
