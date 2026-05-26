import { describe, expect, it } from 'vitest';
import { runAudioExportPreflight } from '../../../src/services/audio/audioExportPreflight';
import type { MasterAudioState, TimelineClip, TimelineTrack } from '../../../src/types';
import { createMockClip, createMockTrack } from '../../helpers/mockData';

function audioTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return createMockTrack({
    id: 'audio-1',
    name: 'Audio 1',
    type: 'audio',
    ...overrides,
  });
}

function audioClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: 'clip-audio',
    trackId: 'audio-1',
    source: { type: 'audio', mediaFileId: 'media-a' } as TimelineClip['source'],
    mediaFileId: 'media-a',
    startTime: 0,
    duration: 5,
    outPoint: 5,
    ...overrides,
  });
}

function createMockAudioBuffer(channels: number[][], sampleRate = 48_000): AudioBuffer {
  const channelData = channels.map(samples => Float32Array.from(samples));
  const length = channelData[0]?.length ?? 0;

  return {
    numberOfChannels: channelData.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: (channelIndex: number) => channelData[channelIndex],
  } as unknown as AudioBuffer;
}

describe('audioExportPreflight', () => {
  it('reports graph, rendered send, input monitor, and master warnings', () => {
    const tracks = [
      audioTrack({
        audioState: {
          volumeDb: 0,
          pan: 0,
          muted: false,
          solo: false,
          recordArm: true,
          inputMonitor: true,
          meterMode: 'peak',
          sends: [
            {
              id: 'send-1',
              targetBusId: 'bus-a',
              gainDb: -6,
              preFader: false,
              enabled: true,
            },
          ],
        },
      }),
    ];
    const clips = [
      audioClip({
        audioState: {
          effectStack: [
            {
              id: 'unknown',
              descriptorId: 'unknown-audio-effect',
              enabled: true,
              params: {},
            },
          ],
        },
      }),
    ];
    const masterAudioState: MasterAudioState = {
      volumeDb: 3,
      limiterEnabled: false,
      targetLufs: -14,
      truePeakCeilingDb: -1,
    };

    const result = runAudioExportPreflight({
      clips,
      tracks,
      masterAudioState,
      startTime: 0,
      endTime: 5,
      now: 123,
    });

    expect(result.lastCheckedAt).toBe(123);
    expect(result.warnings?.map(item => item.code)).toEqual(expect.arrayContaining([
      'audio-graph-effect-descriptor-unknown',
      'audio-export-invalid-effect-skipped',
      'audio-export-track-sends-rendered-as-master-returns',
      'audio-export-record-arm-active',
      'audio-export-input-monitor-not-rendered',
      'audio-export-positive-master-gain-without-limiter',
    ]));
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'audio-export-track-sends-rendered-as-master-returns',
      severity: 'info',
      details: expect.objectContaining({ trackId: 'audio-1', sendCount: 1 }),
    }));
    expect(result.warnings?.map(item => item.code)).not.toContain('audio-export-track-sends-not-rendered');
    expect(result.warnings?.map(item => item.code)).not.toContain('audio-export-target-lufs-unapplied');
  });

  it('reports an info warning when no audio is active in the export range', () => {
    const result = runAudioExportPreflight({
      clips: [audioClip({ startTime: 10, duration: 2 })],
      tracks: [audioTrack()],
      startTime: 0,
      endTime: 5,
      now: 456,
    });

    expect(result.lastCheckedAt).toBe(456);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'audio-export-no-active-audio',
      severity: 'info',
    }));
  });

  it('adds rendered export loudness and peak measurement warnings', () => {
    const samples = Array.from({ length: 48_000 }, (_, index) =>
      Math.sin((2 * Math.PI * 440 * index) / 48_000)
    );
    const result = runAudioExportPreflight({
      clips: [audioClip()],
      tracks: [audioTrack()],
      masterAudioState: {
        volumeDb: 0,
        limiterEnabled: false,
        targetLufs: -23,
        truePeakCeilingDb: -1,
      },
      renderedBuffer: createMockAudioBuffer([samples]),
      startTime: 0,
      endTime: 5,
      now: 789,
    });

    expect(result.measurement).toMatchObject({
      mode: 'rendered-export',
      sampleRate: 48_000,
      channelCount: 1,
      targetLufs: -23,
    });
    expect(result.measurement?.integratedLufs).toEqual(expect.any(Number));
    expect(result.measurement?.truePeakDbtp).toEqual(expect.any(Number));
    expect(result.warnings?.map(item => item.code)).toEqual(expect.arrayContaining([
      'audio-export-rendered-true-peak-hot',
      'audio-export-rendered-lufs-target-mismatch',
    ]));
    expect(result.warnings?.map(item => item.code)).not.toContain('audio-export-target-lufs-unapplied');
  });
});
