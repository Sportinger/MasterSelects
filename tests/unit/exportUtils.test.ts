import { describe, it, expect } from 'vitest';
import {
  getCodecString,
  getMp4MuxerCodec,
  getWebmMuxerCodec,
  isCodecSupportedInContainer,
  getFallbackCodec,
  getVideoCodecsForContainer,
  getRecommendedBitrate,
  formatBitrate,
  RESOLUTION_PRESETS,
  FRAME_RATE_PRESETS,
  CONTAINER_FORMATS,
  BITRATE_RANGE,
} from '../../src/engine/export/codecHelpers';
import {
  getFrameTolerance,
  getKeyframeInterval,
} from '../../src/engine/export/types';
import {
  exportToFCPXML,
} from '../../src/services/export/fcpxmlExport';
import { createMockClip, createMockTrack } from '../helpers/mockData';

// ─── Codec String Mapping ──────────────────────────────────────────────────

describe('getCodecString', () => {
  it('returns Main Profile Level 4.0 for h264', () => {
    expect(getCodecString('h264')).toBe('avc1.4d0028');
  });

  it('returns correct codec string for h265', () => {
    expect(getCodecString('h265')).toBe('hvc1.1.6.L93.B0');
  });

  it('returns correct codec string for vp9', () => {
    expect(getCodecString('vp9')).toBe('vp09.00.10.08');
  });

  it('returns correct codec string for av1', () => {
    expect(getCodecString('av1')).toBe('av01.0.04M.08');
  });

  it('returns fallback for unknown codec', () => {
    expect(getCodecString('unknown' as any)).toBe('avc1.640028');
  });

  it('fallback codec string differs from h264 codec string', () => {
    // h264 returns Main Profile (4d0028), fallback returns High Profile (640028)
    const h264Codec = getCodecString('h264');
    const fallback = getCodecString('notACodec' as any);
    expect(h264Codec).not.toBe(fallback);
  });

  it('returns non-empty strings for all valid codecs', () => {
    const codecs: Array<'h264' | 'h265' | 'vp9' | 'av1'> = ['h264', 'h265', 'vp9', 'av1'];
    for (const codec of codecs) {
      const result = getCodecString(codec);
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

// ─── MP4 Muxer Codec Mapping ───────────────────────────────────────────────

describe('getMp4MuxerCodec', () => {
  it('maps h264 to avc', () => {
    expect(getMp4MuxerCodec('h264')).toBe('avc');
  });

  it('maps h265 to hevc', () => {
    expect(getMp4MuxerCodec('h265')).toBe('hevc');
  });

  it('maps vp9 to vp9', () => {
    expect(getMp4MuxerCodec('vp9')).toBe('vp9');
  });

  it('maps av1 to av1', () => {
    expect(getMp4MuxerCodec('av1')).toBe('av1');
  });

  it('defaults to avc for unknown codec', () => {
    expect(getMp4MuxerCodec('bogus' as any)).toBe('avc');
  });

  it('returns unique muxer codec for each video codec', () => {
    const results = new Set([
      getMp4MuxerCodec('h264'),
      getMp4MuxerCodec('h265'),
      getMp4MuxerCodec('vp9'),
      getMp4MuxerCodec('av1'),
    ]);
    expect(results.size).toBe(4);
  });
});

// ─── WebM Muxer Codec Mapping ──────────────────────────────────────────────

describe('getWebmMuxerCodec', () => {
  it('returns V_AV1 for av1', () => {
    expect(getWebmMuxerCodec('av1')).toBe('V_AV1');
  });

  it('returns V_VP9 for vp9 and all other codecs', () => {
    expect(getWebmMuxerCodec('vp9')).toBe('V_VP9');
    expect(getWebmMuxerCodec('h264')).toBe('V_VP9');
    expect(getWebmMuxerCodec('h265')).toBe('V_VP9');
  });

  it('only returns V_VP9 or V_AV1', () => {
    const codecs: Array<'h264' | 'h265' | 'vp9' | 'av1'> = ['h264', 'h265', 'vp9', 'av1'];
    for (const codec of codecs) {
      const result = getWebmMuxerCodec(codec);
      expect(['V_VP9', 'V_AV1']).toContain(result);
    }
  });

  it('falls back to V_VP9 for unknown codecs', () => {
    expect(getWebmMuxerCodec('unknown' as any)).toBe('V_VP9');
  });
});

// ─── Container/Codec Compatibility ─────────────────────────────────────────

describe('isCodecSupportedInContainer', () => {
  it('allows all codecs in mp4', () => {
    expect(isCodecSupportedInContainer('h264', 'mp4')).toBe(true);
    expect(isCodecSupportedInContainer('h265', 'mp4')).toBe(true);
    expect(isCodecSupportedInContainer('vp9', 'mp4')).toBe(true);
    expect(isCodecSupportedInContainer('av1', 'mp4')).toBe(true);
  });

  it('only allows vp9 and av1 in webm', () => {
    expect(isCodecSupportedInContainer('vp9', 'webm')).toBe(true);
    expect(isCodecSupportedInContainer('av1', 'webm')).toBe(true);
    expect(isCodecSupportedInContainer('h264', 'webm')).toBe(false);
    expect(isCodecSupportedInContainer('h265', 'webm')).toBe(false);
  });

  it('fallback codec is always supported in its container', () => {
    const mp4Fallback = getFallbackCodec('mp4');
    const webmFallback = getFallbackCodec('webm');
    expect(isCodecSupportedInContainer(mp4Fallback, 'mp4')).toBe(true);
    expect(isCodecSupportedInContainer(webmFallback, 'webm')).toBe(true);
  });
});

describe('getFallbackCodec', () => {
  it('returns vp9 for webm container', () => {
    expect(getFallbackCodec('webm')).toBe('vp9');
  });

  it('returns h264 for mp4 container', () => {
    expect(getFallbackCodec('mp4')).toBe('h264');
  });

  it('fallback codecs are valid VideoCodec values', () => {
    const validCodecs = ['h264', 'h265', 'vp9', 'av1'];
    expect(validCodecs).toContain(getFallbackCodec('mp4'));
    expect(validCodecs).toContain(getFallbackCodec('webm'));
  });
});

// ─── Video Codec Options per Container ─────────────────────────────────────

describe('getVideoCodecsForContainer', () => {
  it('returns 2 codecs for webm (vp9 and av1)', () => {
    const codecs = getVideoCodecsForContainer('webm');
    expect(codecs).toHaveLength(2);
    expect(codecs.map(c => c.id)).toEqual(['vp9', 'av1']);
  });

  it('returns 4 codecs for mp4', () => {
    const codecs = getVideoCodecsForContainer('mp4');
    expect(codecs).toHaveLength(4);
    expect(codecs.map(c => c.id)).toEqual(['h264', 'h265', 'vp9', 'av1']);
  });

  it('each codec option has id, label, and description', () => {
    const codecs = getVideoCodecsForContainer('mp4');
    for (const codec of codecs) {
      expect(codec).toHaveProperty('id');
      expect(codec).toHaveProperty('label');
      expect(codec).toHaveProperty('description');
      expect(typeof codec.label).toBe('string');
      expect(typeof codec.description).toBe('string');
    }
  });

  it('webm codecs also have id, label, and description', () => {
    const codecs = getVideoCodecsForContainer('webm');
    for (const codec of codecs) {
      expect(codec).toHaveProperty('id');
      expect(codec).toHaveProperty('label');
      expect(codec).toHaveProperty('description');
      expect(codec.label.length).toBeGreaterThan(0);
      expect(codec.description.length).toBeGreaterThan(0);
    }
  });

  it('all returned codecs are supported in their container', () => {
    for (const container of ['mp4', 'webm'] as const) {
      const codecs = getVideoCodecsForContainer(container);
      for (const codec of codecs) {
        expect(isCodecSupportedInContainer(codec.id, container)).toBe(true);
      }
    }
  });

  it('mp4 codecs include webm codecs as a superset', () => {
    const mp4Ids = getVideoCodecsForContainer('mp4').map(c => c.id);
    const webmIds = getVideoCodecsForContainer('webm').map(c => c.id);
    for (const id of webmIds) {
      expect(mp4Ids).toContain(id);
    }
  });
});

// ─── Bitrate Recommendations ───────────────────────────────────────────────

describe('getRecommendedBitrate', () => {
  it('returns 35 Mbps for 4K (3840px)', () => {
    expect(getRecommendedBitrate(3840)).toBe(35_000_000);
  });

  it('returns 15 Mbps for 1080p (1920px)', () => {
    expect(getRecommendedBitrate(1920)).toBe(15_000_000);
  });

  it('returns 8 Mbps for 720p (1280px)', () => {
    expect(getRecommendedBitrate(1280)).toBe(8_000_000);
  });

  it('returns 5 Mbps for low resolution (480px)', () => {
    expect(getRecommendedBitrate(854)).toBe(5_000_000);
    expect(getRecommendedBitrate(480)).toBe(5_000_000);
  });

  it('returns 35 Mbps for resolutions above 4K', () => {
    expect(getRecommendedBitrate(7680)).toBe(35_000_000); // 8K
    expect(getRecommendedBitrate(5120)).toBe(35_000_000); // 5K
  });

  it('returns 5 Mbps for very small widths', () => {
    expect(getRecommendedBitrate(320)).toBe(5_000_000);
    expect(getRecommendedBitrate(1)).toBe(5_000_000);
  });

  it('boundary: width just below 1280 gets lower bitrate', () => {
    expect(getRecommendedBitrate(1279)).toBe(5_000_000);
  });

  it('boundary: width just below 1920 gets 720p bitrate', () => {
    expect(getRecommendedBitrate(1919)).toBe(8_000_000);
  });

  it('boundary: width just below 3840 gets 1080p bitrate', () => {
    expect(getRecommendedBitrate(3839)).toBe(15_000_000);
  });

  it('increases bitrate monotonically with resolution', () => {
    const widths = [480, 854, 1280, 1920, 3840];
    for (let i = 1; i < widths.length; i++) {
      expect(getRecommendedBitrate(widths[i])).toBeGreaterThanOrEqual(
        getRecommendedBitrate(widths[i - 1])
      );
    }
  });
});

describe('formatBitrate', () => {
  it('formats Mbps for values >= 1M', () => {
    expect(formatBitrate(15_000_000)).toBe('15.0 Mbps');
    expect(formatBitrate(1_000_000)).toBe('1.0 Mbps');
    expect(formatBitrate(35_500_000)).toBe('35.5 Mbps');
  });

  it('formats Kbps for values < 1M', () => {
    expect(formatBitrate(500_000)).toBe('500 Kbps');
    expect(formatBitrate(128_000)).toBe('128 Kbps');
  });

  it('formats fractional Mbps values correctly', () => {
    expect(formatBitrate(2_500_000)).toBe('2.5 Mbps');
    expect(formatBitrate(10_300_000)).toBe('10.3 Mbps');
  });

  it('formats values at exactly 1M boundary', () => {
    expect(formatBitrate(1_000_000)).toBe('1.0 Mbps');
    expect(formatBitrate(999_999)).toBe('1000 Kbps');
  });

  it('formats very large bitrate values', () => {
    expect(formatBitrate(100_000_000)).toBe('100.0 Mbps');
  });

  it('formats very small Kbps values', () => {
    expect(formatBitrate(1_000)).toBe('1 Kbps');
  });

  it('BITRATE_RANGE min and max produce valid formatted strings', () => {
    const minStr = formatBitrate(BITRATE_RANGE.min);
    const maxStr = formatBitrate(BITRATE_RANGE.max);
    expect(minStr).toContain('Mbps');
    expect(maxStr).toContain('Mbps');
  });
});

// ─── FPS-Based Constants ───────────────────────────────────────────────────

describe('getFrameTolerance', () => {
  it('calculates tolerance as 1.5 frame durations in microseconds', () => {
    // 30fps: frame duration = 33333us, tolerance = 50000us
    const tolerance30 = getFrameTolerance(30);
    expect(tolerance30).toBe(Math.round((1_000_000 / 30) * 1.5));
    expect(tolerance30).toBe(50000);
  });

  it('returns higher tolerance for lower fps', () => {
    const tolerance24 = getFrameTolerance(24);
    const tolerance60 = getFrameTolerance(60);
    expect(tolerance24).toBeGreaterThan(tolerance60);
  });

  it('handles 60fps', () => {
    expect(getFrameTolerance(60)).toBe(25000);
  });

  it('handles 24fps correctly', () => {
    expect(getFrameTolerance(24)).toBe(Math.round((1_000_000 / 24) * 1.5));
    expect(getFrameTolerance(24)).toBe(62500);
  });

  it('handles 25fps (PAL)', () => {
    expect(getFrameTolerance(25)).toBe(Math.round((1_000_000 / 25) * 1.5));
    expect(getFrameTolerance(25)).toBe(60000);
  });

  it('handles NTSC 29.97fps', () => {
    const tolerance = getFrameTolerance(29.97);
    expect(tolerance).toBe(Math.round((1_000_000 / 29.97) * 1.5));
    expect(tolerance).toBeGreaterThan(49000);
    expect(tolerance).toBeLessThan(51000);
  });

  it('returns an integer (microseconds)', () => {
    const fps = [24, 25, 29.97, 30, 59.94, 60];
    for (const f of fps) {
      const result = getFrameTolerance(f);
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});

describe('getKeyframeInterval', () => {
  it('returns 1 keyframe per second (rounds fps)', () => {
    expect(getKeyframeInterval(30)).toBe(30);
    expect(getKeyframeInterval(24)).toBe(24);
    expect(getKeyframeInterval(60)).toBe(60);
  });

  it('rounds for non-integer fps', () => {
    expect(getKeyframeInterval(29.97)).toBe(30);
    expect(getKeyframeInterval(23.976)).toBe(24);
  });

  it('handles 25fps (PAL)', () => {
    expect(getKeyframeInterval(25)).toBe(25);
  });

  it('rounds 59.94 NTSC to 60', () => {
    expect(getKeyframeInterval(59.94)).toBe(60);
  });

  it('returns a positive integer', () => {
    const fps = [24, 25, 29.97, 30, 59.94, 60];
    for (const f of fps) {
      const result = getKeyframeInterval(f);
      expect(result).toBeGreaterThan(0);
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});

// ─── Preset Constants ──────────────────────────────────────────────────────

describe('Preset Constants', () => {
  it('RESOLUTION_PRESETS include common resolutions', () => {
    expect(RESOLUTION_PRESETS.length).toBeGreaterThanOrEqual(3);
    const widths = RESOLUTION_PRESETS.map(p => p.width);
    expect(widths).toContain(1920);
    expect(widths).toContain(3840);
    expect(widths).toContain(1280);
  });

  it('RESOLUTION_PRESETS have valid width/height pairs', () => {
    for (const preset of RESOLUTION_PRESETS) {
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.height).toBeGreaterThan(0);
      expect(preset.width).toBeGreaterThan(preset.height); // landscape
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it('RESOLUTION_PRESETS are ordered by width descending (4K first)', () => {
    for (let i = 1; i < RESOLUTION_PRESETS.length; i++) {
      expect(RESOLUTION_PRESETS[i - 1].width).toBeGreaterThan(RESOLUTION_PRESETS[i].width);
    }
  });

  it('RESOLUTION_PRESETS includes 480p', () => {
    const preset480 = RESOLUTION_PRESETS.find(p => p.width === 854);
    expect(preset480).toBeDefined();
    expect(preset480!.height).toBe(480);
  });

  it('FRAME_RATE_PRESETS include common frame rates', () => {
    const fpsValues = FRAME_RATE_PRESETS.map(p => p.fps);
    expect(fpsValues).toContain(30);
    expect(fpsValues).toContain(24);
    expect(fpsValues).toContain(60);
  });

  it('FRAME_RATE_PRESETS include PAL 25fps', () => {
    const fpsValues = FRAME_RATE_PRESETS.map(p => p.fps);
    expect(fpsValues).toContain(25);
  });

  it('FRAME_RATE_PRESETS have labels', () => {
    for (const preset of FRAME_RATE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.fps).toBeGreaterThan(0);
    }
  });

  it('FRAME_RATE_PRESETS are ordered by fps descending', () => {
    for (let i = 1; i < FRAME_RATE_PRESETS.length; i++) {
      expect(FRAME_RATE_PRESETS[i - 1].fps).toBeGreaterThan(FRAME_RATE_PRESETS[i].fps);
    }
  });

  it('CONTAINER_FORMATS include mp4 and webm', () => {
    const ids = CONTAINER_FORMATS.map(f => f.id);
    expect(ids).toContain('mp4');
    expect(ids).toContain('webm');
    expect(CONTAINER_FORMATS.find(f => f.id === 'mp4')?.extension).toBe('.mp4');
  });

  it('CONTAINER_FORMATS webm has .webm extension', () => {
    expect(CONTAINER_FORMATS.find(f => f.id === 'webm')?.extension).toBe('.webm');
  });

  it('CONTAINER_FORMATS have labels and extensions starting with dot', () => {
    for (const format of CONTAINER_FORMATS) {
      expect(format.label.length).toBeGreaterThan(0);
      expect(format.extension.startsWith('.')).toBe(true);
    }
  });

  it('BITRATE_RANGE has sane min/max/step', () => {
    expect(BITRATE_RANGE.min).toBeGreaterThan(0);
    expect(BITRATE_RANGE.max).toBeGreaterThan(BITRATE_RANGE.min);
    expect(BITRATE_RANGE.step).toBeGreaterThan(0);
    expect(BITRATE_RANGE.step).toBeLessThan(BITRATE_RANGE.max - BITRATE_RANGE.min);
  });

  it('BITRATE_RANGE min is at least 1 Mbps', () => {
    expect(BITRATE_RANGE.min).toBeGreaterThanOrEqual(1_000_000);
  });

  it('BITRATE_RANGE max is at most 100 Mbps', () => {
    expect(BITRATE_RANGE.max).toBeLessThanOrEqual(100_000_000);
  });

  it('BITRATE_RANGE step evenly divides into a reasonable number of steps', () => {
    const steps = (BITRATE_RANGE.max - BITRATE_RANGE.min) / BITRATE_RANGE.step;
    expect(steps).toBeGreaterThan(1);
    expect(steps).toBeLessThan(1000);
  });
});

// ─── FCPXML Export ─────────────────────────────────────────────────────────

describe('exportToFCPXML', () => {
  it('generates valid FCPXML header and root element', () => {
    const xml = exportToFCPXML([], [], 10, { projectName: 'Test' });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<!DOCTYPE fcpxml>');
    expect(xml).toContain('<fcpxml version="1.10">');
    expect(xml).toContain('</fcpxml>');
  });

  it('includes format resource with correct resolution and fps', () => {
    const xml = exportToFCPXML([], [], 10, {
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
    expect(xml).toContain('width="1920"');
    expect(xml).toContain('height="1080"');
    expect(xml).toContain('id="r1"');
  });

  it('uses project name in event and project tags', () => {
    const xml = exportToFCPXML([], [], 10, { projectName: 'MyProject' });
    expect(xml).toContain('event name="MyProject"');
    expect(xml).toContain('project name="MyProject"');
  });

  it('escapes XML special characters in project name', () => {
    const xml = exportToFCPXML([], [], 5, { projectName: 'Test <&> "Project"' });
    expect(xml).toContain('Test &lt;&amp;&gt; &quot;Project&quot;');
  });

  it('generates asset-clip elements for video clips', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'Sunrise',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([clip], [track], 10, { frameRate: 30 });
    expect(xml).toContain('asset-clip');
    expect(xml).toContain('name="Sunrise"');
  });

  it('generates gap elements when clips do not start at time zero', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'Later Clip',
      startTime: 5,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([clip], [track], 10, { frameRate: 30 });
    expect(xml).toContain('<gap');
  });

  it('includes audio clips on separate lane when includeAudio is true', () => {
    const videoTrack = createMockTrack({ id: 'v1', type: 'video' });
    const audioTrack = createMockTrack({ id: 'a1', type: 'audio' });
    const audioClip = createMockClip({
      id: 'ac1',
      trackId: 'a1',
      name: 'Music',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'audio', audioElement: {} as any, naturalDuration: 60 } as any,
    });

    const xml = exportToFCPXML([audioClip], [videoTrack, audioTrack], 10, {
      includeAudio: true,
      frameRate: 30,
    });
    expect(xml).toContain('lane="-2"');
    expect(xml).toContain('name="Music"');
  });

  it('excludes audio clips when includeAudio is false', () => {
    const audioTrack = createMockTrack({ id: 'a1', type: 'audio' });
    const audioClip = createMockClip({
      id: 'ac1',
      trackId: 'a1',
      name: 'Music',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'audio', audioElement: {} as any, naturalDuration: 60 } as any,
    });

    const xml = exportToFCPXML([audioClip], [audioTrack], 10, {
      includeAudio: false,
      frameRate: 30,
    });
    expect(xml).not.toContain('name="Music"');
  });

  it('uses default options when none are specified', () => {
    const xml = exportToFCPXML([], [], 10);
    // Default project name
    expect(xml).toContain('MasterSelects Export');
    // Default resolution
    expect(xml).toContain('width="1920"');
    expect(xml).toContain('height="1080"');
    // Default format resource
    expect(xml).toContain('id="r1"');
    // Structure is valid
    expect(xml).toContain('<library>');
    expect(xml).toContain('</library>');
    expect(xml).toContain('<spine>');
    expect(xml).toContain('</spine>');
  });

  it('generates correct FCPXML structure hierarchy', () => {
    const xml = exportToFCPXML([], [], 10, { projectName: 'Test' });
    // Check ordering of structural elements
    const libraryIdx = xml.indexOf('<library>');
    const eventIdx = xml.indexOf('<event');
    const projectIdx = xml.indexOf('<project');
    const sequenceIdx = xml.indexOf('<sequence');
    const spineIdx = xml.indexOf('<spine>');

    expect(libraryIdx).toBeLessThan(eventIdx);
    expect(eventIdx).toBeLessThan(projectIdx);
    expect(projectIdx).toBeLessThan(sequenceIdx);
    expect(sequenceIdx).toBeLessThan(spineIdx);
  });

  it('includes resources section before library', () => {
    const xml = exportToFCPXML([], [], 10);
    const resourcesIdx = xml.indexOf('<resources>');
    const libraryIdx = xml.indexOf('<library>');
    expect(resourcesIdx).toBeLessThan(libraryIdx);
  });

  it('formats timeline duration using frame-accurate rational time', () => {
    const xml = exportToFCPXML([], [], 10, { frameRate: 30 });
    // 10s at 30fps = 300/30s
    expect(xml).toContain('duration="300/30s"');
  });

  it('includes tcStart and tcFormat attributes on sequence', () => {
    const xml = exportToFCPXML([], [], 10, { frameRate: 30 });
    expect(xml).toContain('tcStart="0s"');
    expect(xml).toContain('tcFormat="NDF"');
  });

  it('generates frameDuration for standard frame rates', () => {
    const xml30 = exportToFCPXML([], [], 10, { frameRate: 30 });
    expect(xml30).toContain('frameDuration="100/3000s"');

    const xml24 = exportToFCPXML([], [], 10, { frameRate: 24 });
    expect(xml24).toContain('frameDuration="100/2400s"');

    const xml60 = exportToFCPXML([], [], 10, { frameRate: 60 });
    expect(xml60).toContain('frameDuration="100/6000s"');
  });

  it('generates correct format name based on height and fps', () => {
    const xml = exportToFCPXML([], [], 10, {
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
    expect(xml).toContain('name="FFVideoFormat1080p30"');
  });

  it('generates format name for 4K at 60fps', () => {
    const xml = exportToFCPXML([], [], 10, {
      width: 3840,
      height: 2160,
      frameRate: 60,
    });
    expect(xml).toContain('name="FFVideoFormat2160p60"');
  });

  it('escapes XML special characters in clip names', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'Clip <with> & "special" chars',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([clip], [track], 10, { frameRate: 30 });
    expect(xml).toContain('Clip &lt;with&gt; &amp; &quot;special&quot; chars');
  });

  it('escapes apostrophes in project name', () => {
    const xml = exportToFCPXML([], [], 5, { projectName: "Tom's Project" });
    expect(xml).toContain('Tom&apos;s Project');
  });

  it('generates correct offset and start for clips with inPoint', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'Trimmed',
      startTime: 2,
      duration: 3,
      inPoint: 5,
      outPoint: 8,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 20 } as any,
    });

    const xml = exportToFCPXML([clip], [track], 10, { frameRate: 30 });
    // offset = startTime = 2s => 60/30s
    expect(xml).toContain('offset="60/30s"');
    // start = inPoint = 5s => 150/30s
    expect(xml).toContain('start="150/30s"');
    // duration = 3s => 90/30s
    expect(xml).toContain('duration="90/30s"');
  });

  it('handles multiple video clips sorted by start time', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip1 = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'First',
      startTime: 0,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });
    const clip2 = createMockClip({
      id: 'c2',
      trackId: 'v1',
      name: 'Second',
      startTime: 5,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });

    // Pass clips in reverse order to verify sorting
    const xml = exportToFCPXML([clip2, clip1], [track], 10, { frameRate: 30 });
    // Check ordering within the spine section (asset-clip elements)
    const spineSection = xml.substring(xml.indexOf('<spine>'), xml.indexOf('</spine>'));
    const firstIdx = spineSection.indexOf('name="First"');
    const secondIdx = spineSection.indexOf('name="Second"');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it('generates gap between two non-adjacent clips', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip1 = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'A',
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });
    const clip2 = createMockClip({
      id: 'c2',
      trackId: 'v1',
      name: 'B',
      startTime: 5,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([clip1, clip2], [track], 10, { frameRate: 30 });
    // There should be a gap between clip A (ends at 2s) and clip B (starts at 5s)
    expect(xml).toContain('<gap');
    expect(xml).toContain('name="A"');
    expect(xml).toContain('name="B"');
  });

  it('does not generate gap when clips are back to back', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip1 = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'A',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });
    const clip2 = createMockClip({
      id: 'c2',
      trackId: 'v1',
      name: 'B',
      startTime: 5,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([clip1, clip2], [track], 10, { frameRate: 30 });
    expect(xml).not.toContain('<gap');
  });

  it('filters out composition clips', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const compClip = createMockClip({
      id: 'comp1',
      trackId: 'v1',
      name: 'CompositionClip',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      isComposition: true,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    } as any);

    const xml = exportToFCPXML([compClip], [track], 10, { frameRate: 30 });
    expect(xml).not.toContain('name="CompositionClip"');
    expect(xml).not.toContain('asset-clip');
  });

  it('filters out text source clips', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const textClip = createMockClip({
      id: 'txt1',
      trackId: 'v1',
      name: 'TextOverlay',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'text' } as any,
    });

    const xml = exportToFCPXML([textClip], [track], 10, { frameRate: 30 });
    expect(xml).not.toContain('name="TextOverlay"');
    expect(xml).not.toContain('asset-clip');
  });

  it('generates asset resources for video clips', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'TestVideo',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([clip], [track], 10, { frameRate: 30 });
    // Should have an asset resource (r2 since r1 is format)
    expect(xml).toContain('<asset id="r2"');
    expect(xml).toContain('name="TestVideo"');
    expect(xml).toContain('hasVideo="1"');
  });

  it('generates asset resources for audio clips with channels and sample rate', () => {
    const videoTrack = createMockTrack({ id: 'v1', type: 'video' });
    const audioTrack = createMockTrack({ id: 'a1', type: 'audio' });
    const audioClip = createMockClip({
      id: 'ac1',
      trackId: 'a1',
      name: 'SoundFX',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'audio', audioElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([audioClip], [videoTrack, audioTrack], 10, {
      includeAudio: true,
      frameRate: 30,
    });
    expect(xml).toContain('hasAudio="1"');
    expect(xml).toContain('audioChannels="2"');
    expect(xml).toContain('audioSampleRate="48000"');
  });

  it('deduplicates assets by mediaFileId', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip1 = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'Clip A',
      mediaFileId: 'shared-media',
      startTime: 0,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    } as any);
    const clip2 = createMockClip({
      id: 'c2',
      trackId: 'v1',
      name: 'Clip B',
      mediaFileId: 'shared-media',
      startTime: 3,
      duration: 3,
      inPoint: 3,
      outPoint: 6,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    } as any);

    const xml = exportToFCPXML([clip1, clip2], [track], 10, { frameRate: 30 });
    // Both clips reference the same asset, so only one asset resource should exist
    const assetMatches = xml.match(/<asset id=/g);
    expect(assetMatches).toHaveLength(1);
    // But both clips should appear as asset-clips
    expect(xml).toContain('name="Clip A"');
    expect(xml).toContain('name="Clip B"');
  });

  it('includes media-rep with file source in asset', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'TestVideo',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      file: new File([], 'my-video.mp4'),
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([clip], [track], 10, { frameRate: 30 });
    expect(xml).toContain('media-rep');
    expect(xml).toContain('kind="original-media"');
    expect(xml).toContain('src="file://./my-video.mp4"');
  });

  it('audio clips include srcCh attribute for stereo channels', () => {
    const videoTrack = createMockTrack({ id: 'v1', type: 'video' });
    const audioTrack = createMockTrack({ id: 'a1', type: 'audio' });
    const audioClip = createMockClip({
      id: 'ac1',
      trackId: 'a1',
      name: 'Stereo',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'audio', audioElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([audioClip], [videoTrack, audioTrack], 10, {
      includeAudio: true,
      frameRate: 30,
    });
    expect(xml).toContain('srcCh="1, 2"');
  });

  it('generates linked audio for video clips with linkedClipId', () => {
    const videoTrack = createMockTrack({ id: 'v1', type: 'video' });
    const audioTrack = createMockTrack({ id: 'a1', type: 'audio' });
    const videoClip = createMockClip({
      id: 'vc1',
      trackId: 'v1',
      name: 'LinkedVideo',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      linkedClipId: 'ac1',
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    } as any);
    const audioClip = createMockClip({
      id: 'ac1',
      trackId: 'a1',
      name: 'LinkedAudio',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'audio', audioElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([videoClip, audioClip], [videoTrack, audioTrack], 10, {
      includeAudio: true,
      frameRate: 30,
    });
    // Linked audio should be on lane -1 (inside the asset-clip)
    expect(xml).toContain('lane="-1"');
    expect(xml).toContain('name="LinkedVideo"');
  });

  it('standalone audio clips are not duplicated when linked to video', () => {
    const videoTrack = createMockTrack({ id: 'v1', type: 'video' });
    const audioTrack = createMockTrack({ id: 'a1', type: 'audio' });
    const videoClip = createMockClip({
      id: 'vc1',
      trackId: 'v1',
      name: 'LinkedVideo',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      linkedClipId: 'ac1',
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    } as any);
    const audioClip = createMockClip({
      id: 'ac1',
      trackId: 'a1',
      name: 'LinkedAudio',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'audio', audioElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([videoClip, audioClip], [videoTrack, audioTrack], 10, {
      includeAudio: true,
      frameRate: 30,
    });
    // The linked audio should NOT appear as standalone lane="-2"
    expect(xml).not.toContain('lane="-2"');
    // It should appear as embedded lane="-1" inside the video asset-clip
    expect(xml).toContain('lane="-1"');
  });

  it('handles empty timeline with no clips', () => {
    const xml = exportToFCPXML([], [], 0, { frameRate: 30 });
    expect(xml).toContain('<spine>');
    expect(xml).toContain('</spine>');
    expect(xml).not.toContain('asset-clip');
    expect(xml).not.toContain('<gap');
  });

  it('handles 4K resolution in format resource', () => {
    const xml = exportToFCPXML([], [], 10, {
      width: 3840,
      height: 2160,
      frameRate: 30,
    });
    expect(xml).toContain('width="3840"');
    expect(xml).toContain('height="2160"');
  });

  it('includeAudio defaults to true', () => {
    const videoTrack = createMockTrack({ id: 'v1', type: 'video' });
    const audioTrack = createMockTrack({ id: 'a1', type: 'audio' });
    const audioClip = createMockClip({
      id: 'ac1',
      trackId: 'a1',
      name: 'DefaultAudio',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'audio', audioElement: {} as any, naturalDuration: 10 } as any,
    });

    // Do not specify includeAudio; it should default to true
    const xml = exportToFCPXML([audioClip], [videoTrack, audioTrack], 10, {
      frameRate: 30,
    });
    expect(xml).toContain('name="DefaultAudio"');
    expect(xml).toContain('lane="-2"');
  });

  it('generates valid self-closing asset-clip for video-only clip', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'Solo',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 10 } as any,
    });

    const xml = exportToFCPXML([clip], [track], 10, { frameRate: 30 });
    // Self-closing asset-clip (no linked audio)
    expect(xml).toContain('tcFormat="NDF"/>');
  });

  it('uses natural duration from source for asset duration', () => {
    const track = createMockTrack({ id: 'v1', type: 'video' });
    const clip = createMockClip({
      id: 'c1',
      trackId: 'v1',
      name: 'FullLength',
      startTime: 0,
      duration: 5,
      inPoint: 2,
      outPoint: 7,
      source: { type: 'video', videoElement: {} as any, naturalDuration: 30 } as any,
    });

    const xml = exportToFCPXML([clip], [track], 10, { frameRate: 30 });
    // Asset duration should be naturalDuration (30s) not clip duration (5s)
    // 30s at 30fps = 900/30s
    expect(xml).toContain('<asset id="r2"');
    expect(xml).toContain('duration="900/30s"');
  });
});
