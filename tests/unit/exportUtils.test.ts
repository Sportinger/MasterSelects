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
});

describe('getFallbackCodec', () => {
  it('returns vp9 for webm container', () => {
    expect(getFallbackCodec('webm')).toBe('vp9');
  });

  it('returns h264 for mp4 container', () => {
    expect(getFallbackCodec('mp4')).toBe('h264');
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

  it('FRAME_RATE_PRESETS include common frame rates', () => {
    const fpsValues = FRAME_RATE_PRESETS.map(p => p.fps);
    expect(fpsValues).toContain(30);
    expect(fpsValues).toContain(24);
    expect(fpsValues).toContain(60);
  });

  it('CONTAINER_FORMATS include mp4 and webm', () => {
    const ids = CONTAINER_FORMATS.map(f => f.id);
    expect(ids).toContain('mp4');
    expect(ids).toContain('webm');
    expect(CONTAINER_FORMATS.find(f => f.id === 'mp4')?.extension).toBe('.mp4');
  });

  it('BITRATE_RANGE has sane min/max/step', () => {
    expect(BITRATE_RANGE.min).toBeGreaterThan(0);
    expect(BITRATE_RANGE.max).toBeGreaterThan(BITRATE_RANGE.min);
    expect(BITRATE_RANGE.step).toBeGreaterThan(0);
    expect(BITRATE_RANGE.step).toBeLessThan(BITRATE_RANGE.max - BITRATE_RANGE.min);
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
});
