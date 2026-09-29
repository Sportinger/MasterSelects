import { describe, expect, it } from 'vitest';
import {
  buildPreviewHealthProperties,
  createPreviewHealthAccumulator,
  recordPreviewHealthSample,
  type PreviewHealthSample,
} from '../../src/services/previewHealth/previewHealthTelemetry';
import { sanitizeProductAnalyticsProperties } from '../../src/services/productAnalytics/catalog';

const sample = (over: Partial<PreviewHealthSample> = {}): PreviewHealthSample => ({
  fps: 30, targetFps: 30, drops: 0, layerCount: 1, decoder: 'HTMLVideo(VF)',
  hash: 'a', nonBlankRatio: 0.9, ...over,
});

describe('preview health telemetry', () => {
  it('reports cadence without claiming pixel health when pixels were not sampled', () => {
    const acc = createPreviewHealthAccumulator(0);
    recordPreviewHealthSample(acc, sample({ hash: null, nonBlankRatio: null }), 500);
    const properties = buildPreviewHealthProperties(acc, 'window', 500);
    expect(properties.fps_avg).toBe(30);
    for (const key of ['black_s', 'black_longest_s', 'frozen_s', 'first_frame_ms']) {
      expect(properties).not.toHaveProperty(key);
    }
  });

  it('alerts after sustained black with layers, recovers, and records time to first frame', () => {
    const acc = createPreviewHealthAccumulator(0);
    const signals = [0, 1, 2, 3].map((i) =>
      recordPreviewHealthSample(acc, sample({ nonBlankRatio: 0 }), 500 * (i + 1)));
    expect(signals).toEqual(['none', 'none', 'none', 'black_alert']);
    expect(acc.firstFrameMs).toBe(-1);
    expect(recordPreviewHealthSample(acc, sample({ hash: 'b' }), 2600)).toBe('black_recovered');
    expect(acc.firstFrameMs).toBe(2600);
    expect(acc.blackLongest).toBe(4);
  });

  it('does not count black without visible layers', () => {
    const acc = createPreviewHealthAccumulator(0);
    for (let i = 0; i < 6; i += 1) {
      expect(recordPreviewHealthSample(acc, sample({ layerCount: 0, nonBlankRatio: 0 }), i * 500)).toBe('none');
    }
    expect(acc.blackSamples).toBe(0);
  });

  it('produces properties that survive the shared analytics sanitizer', () => {
    const acc = createPreviewHealthAccumulator(0);
    recordPreviewHealthSample(acc, sample(), 500);
    recordPreviewHealthSample(acc, sample(), 1000);
    const properties = buildPreviewHealthProperties(acc, 'window', 1000);
    const clean = sanitizeProductAnalyticsProperties('preview_health', properties);
    expect(clean).toEqual(properties);
    expect(clean.decoder).toBe('htmlvideo-vf');
    expect(clean.frozen_s).toBe(1);
  });
});
