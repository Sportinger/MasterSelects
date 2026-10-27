import { describe, expect, it } from 'vitest';
import {
  buildPhoneAdvancedPlan,
  clampExportSide,
  createDefaultPhoneAdvancedSettings,
  resolveAdvancedBitrate,
  resolveAdvancedSize,
  resolveSelectionRange,
  type PhoneAdvancedContext,
  type PhoneAdvancedSettings,
} from '../../src/components/mobileSkin/export/phoneExportAdvancedPlan';
import {
  PHONE_EXPORT_FORMATS,
  getPhoneExportFormat,
  resolvePhoneFormatAvailability,
  type PhoneExportBrowserCapabilities,
} from '../../src/components/mobileSkin/export/phoneExportFormats';
import { exportSettingsToPhone, phoneSpecToExportSettings } from '../../src/components/mobileSkin/export/phoneExportPresetMapping';
import { phoneExportMimeFor } from '../../src/components/mobileSkin/export/phoneExportDelivery';
import { selectRetryJobs } from '../../src/components/mobileSkin/export/usePhoneExportBatch';
import { createDefaultExportSettings, type BatchExportJob } from '../../src/stores/exportStore';

const ALL: PhoneExportBrowserCapabilities = {
  webCodecs: true, wasm: true, audioCodec: 'aac', codecs: { h264: true, h265: true, vp9: true, av1: true },
};
const PORTRAIT = { width: 1080, height: 1920, frameRate: 30 };

function context(overrides: Partial<PhoneAdvancedContext> = {}): PhoneAdvancedContext {
  return {
    composition: PORTRAIT,
    clips: [
      { id: 'a', trackId: 'v1', startTime: 0, duration: 2 },
      { id: 'b', trackId: 'v1', startTime: 2, duration: 3 },
    ],
    tracks: [{ id: 'v1', type: 'video', visible: true, muted: false }],
    inPoint: null,
    outPoint: null,
    selectedClipIds: new Set<string>(),
    playhead: 1.5,
    capabilities: ALL,
    ...overrides,
  };
}

function settings(patch: Partial<PhoneAdvancedSettings> = {}): PhoneAdvancedSettings {
  return { ...createDefaultPhoneAdvancedSettings(PORTRAIT), ...patch };
}

describe('phone advanced export sizes, rates and bitrates', () => {
  it('scales a short-side preset with the composition aspect and keeps sides even', () => {
    expect(resolveAdvancedSize({ resolution: 720, customWidth: 0, customHeight: 0 }, PORTRAIT)).toMatchObject({ width: 720, height: 1280 });
    expect(resolveAdvancedSize({ resolution: 480, customWidth: 0, customHeight: 0 }, { width: 1920, height: 1080, frameRate: 25 }))
      .toMatchObject({ width: 854, height: 480 });
  });

  it('says so when a preset upscales or a custom size is clamped', () => {
    expect(resolveAdvancedSize({ resolution: 2160, customWidth: 0, customHeight: 0 }, PORTRAIT).notes.join(' ')).toMatch(/Upscaled/);
    const custom = resolveAdvancedSize({ resolution: 'custom', customWidth: 7, customHeight: 9999 }, PORTRAIT);
    expect(custom).toMatchObject({ width: 16, height: 7680 });
    expect(custom.notes.join(' ')).toMatch(/adjusted to 16 × 7680/);
    expect(clampExportSide(721)).toEqual({ value: 722, clamped: true });
  });

  it('derives the bitrate from the quality and honours a custom one within limits', () => {
    expect(resolveAdvancedBitrate({ quality: 'high', customBitrate: 0 }, 1080, 1920, 30)).toBe(7_500_000);
    expect(resolveAdvancedBitrate({ quality: 'custom', customBitrate: 3_000_000 }, 1080, 1920, 30)).toBe(3_000_000);
    expect(resolveAdvancedBitrate({ quality: 'custom', customBitrate: 1e12 }, 1080, 1920, 30)).toBe(100_000_000);
  });
});

describe('phone advanced export plan', () => {
  it('plans a 720p WebM VP9 export at 24 fps over the edited content', () => {
    const plan = buildPhoneAdvancedPlan(settings({ formatId: 'webm-vp9', resolution: 720, fps: 24 }), context());
    expect(plan.supported).toBe(true);
    if (!plan.supported) return;
    expect(plan.spec).toMatchObject({ kind: 'webcodecs', container: 'webm', videoCodec: 'vp9', width: 720, height: 1280, fps: 24, startTime: 0, endTime: 5, extension: 'webm' });
    expect(plan.spec.summary).toBe('720 × 1280 · 24 fps · 0:05 · WEBM');
  });

  it('greys a codec this browser cannot encode, with the size in the reason', () => {
    const plan = buildPhoneAdvancedPlan(settings({ formatId: 'mp4-hevc' }), context({ capabilities: { ...ALL, codecs: { ...ALL.codecs, h265: false } } }));
    expect(plan).toMatchObject({ supported: false, reason: 'This browser cannot encode HEVC at 1080 × 1920.' });
  });

  it('exports the selected clips range and explains an empty selection', () => {
    const selected = buildPhoneAdvancedPlan(settings({ range: 'selection' }), context({ selectedClipIds: new Set(['b']) }));
    expect(selected.supported && [selected.spec.startTime, selected.spec.endTime]).toEqual([2, 5]);
    expect(buildPhoneAdvancedPlan(settings({ range: 'selection' }), context())).toMatchObject({ supported: false, reason: expect.stringMatching(/Select one or more clips/) });
    expect(resolveSelectionRange(context().clips, ['a', 'b'])).toEqual({ startTime: 0, endTime: 5 });
  });

  it('uses in/out points when set and falls back visibly when none is set', () => {
    const inOut = buildPhoneAdvancedPlan(settings({ range: 'in-out' }), context({ inPoint: 1, outPoint: 3 }));
    expect(inOut.supported && [inOut.spec.startTime, inOut.spec.endTime]).toEqual([1, 3]);
    const fallback = buildPhoneAdvancedPlan(settings({ range: 'in-out' }), context());
    expect(fallback.supported && fallback.spec.endTime).toBe(5);
    expect(fallback.supported && fallback.spec.notice).toMatch(/No in or out point/);
  });

  it('takes a still frame at the playhead in the chosen image format', () => {
    const plan = buildPhoneAdvancedPlan(settings({ formatId: 'still', imageFormat: 'jpg', resolution: 720 }), context());
    expect(plan.supported && plan.spec).toMatchObject({ kind: 'still', exportTime: 1.5, extension: 'jpg', width: 720, height: 1280 });
  });

  it('plans audio only, and greys AAC where only Opus exists', () => {
    const wav = buildPhoneAdvancedPlan(settings({ formatId: 'audio-wav' }), context());
    expect(wav.supported && wav.spec).toMatchObject({ kind: 'audio', audioFormat: 'wav', includeAudio: true, extension: 'wav', bitrate: 0 });
    expect(buildPhoneAdvancedPlan(settings({ formatId: 'audio-aac' }), context({ capabilities: { ...ALL, audioCodec: 'opus' } })))
      .toMatchObject({ supported: false, reason: expect.stringMatching(/only encode Opus/) });
  });

  it('keeps desktop-only formats visible but unavailable with a reason', () => {
    for (const id of ['mov-hap', 'fcpxml'] as const) {
      const availability = resolvePhoneFormatAvailability(getPhoneExportFormat(id), ALL, { width: 1080, height: 1920 });
      expect(availability).toMatchObject({ available: false, reason: expect.stringMatching(/All options/) });
    }
    expect(PHONE_EXPORT_FORMATS.map((format) => format.id)).toEqual(expect.arrayContaining([
      'mp4-h264', 'mp4-hevc', 'mp4-av1', 'webm-vp9', 'webm-av1', 'mov-prores', 'gif', 'image-sequence', 'still', 'audio-wav', 'audio-mp3', 'audio-aac',
    ]));
  });

  it('notes when the browser cannot encode sound for a video and drops it from the spec', () => {
    const plan = buildPhoneAdvancedPlan(settings(), context({ capabilities: { ...ALL, audioCodec: null } }));
    expect(plan.supported && plan.spec.includeAudio).toBe(false);
    expect(plan.supported && plan.spec.notice).toMatch(/cannot encode audio/);
  });

  it('blocks an empty edit instead of exporting nothing', () => {
    expect(buildPhoneAdvancedPlan(settings(), context({ clips: [] }))).toMatchObject({ supported: false, reason: expect.stringMatching(/Nothing to export/) });
  });
});

describe('phone export presets, delivery and batch retry', () => {
  it('round-trips the phone choices through the project export preset settings', () => {
    const plan = buildPhoneAdvancedPlan(settings({ formatId: 'webm-av1', resolution: 720, fps: 25, quality: 'custom', customBitrate: 4_000_000 }), context());
    if (!plan.supported) throw new Error(plan.reason);
    const stored = phoneSpecToExportSettings(plan.spec, 'in-out', createDefaultExportSettings());
    expect(stored).toMatchObject({ encoder: 'webcodecs', containerFormat: 'webm', videoCodec: 'av1', customWidth: 720, customHeight: 1280, useCustomResolution: true, customFps: 25, bitrate: 4_000_000, useInOut: true });
    expect(exportSettingsToPhone(stored, PORTRAIT)).toMatchObject({ formatId: 'webm-av1', resolution: 'custom', customWidth: 720, customHeight: 1280, fps: 25, quality: 'custom', customBitrate: 4_000_000, range: 'in-out' });
    const still = phoneSpecToExportSettings({ ...plan.spec, kind: 'still', imageFormat: 'webp' }, 'content', createDefaultExportSettings());
    expect(exportSettingsToPhone(still, PORTRAIT)).toMatchObject({ formatId: 'still', imageFormat: 'webp' });
  });

  it('gives shared files a mime type from their extension', () => {
    expect(phoneExportMimeFor(new Blob([]), 'clip.gif')).toBe('image/gif');
    expect(phoneExportMimeFor(new Blob([]), 'frames.zip')).toBe('application/zip');
    expect(phoneExportMimeFor(new Blob([]), 'sound.mp3')).toBe('audio/mpeg');
    expect(phoneExportMimeFor(new Blob([], { type: 'video/webm' }), 'x.mp4')).toBe('video/webm');
  });

  it('retries only failed and cancelled batch jobs', () => {
    const job = (id: string) => ({ id } as BatchExportJob);
    const jobs = [job('a'), job('b'), job('c'), job('d')];
    expect(selectRetryJobs(jobs, {
      a: { status: 'completed', progress: 100 }, b: { status: 'failed', progress: 0 }, c: { status: 'cancelled', progress: 0 },
    }).map((entry) => entry.id)).toEqual(['b', 'c']);
  });
});
