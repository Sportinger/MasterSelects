import { describe, expect, it } from 'vitest';
import { AudioExportPipeline } from '../../src/engine/audio/AudioExportPipeline';
import { renderAudioGraph } from '../../src/engine/audio/AudioGraphRenderer';
import type { AudioTrackData } from '../../src/engine/audio/AudioMixer';
import type { AudioGraphRenderPlan } from '../../src/engine/audio/AudioGraphTypes';
import { analyzeAudioBufferLoudnessSummary } from '../../src/services/audio/LoudnessEnvelopeGenerator';
import type { TimelineClip, TimelineTrack } from '../../src/types';

const videoTrack: TimelineTrack = {
  id: 'v1',
  name: 'Video 1',
  type: 'video',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

const audioTrack: TimelineTrack = {
  id: 'a1',
  name: 'Audio 1',
  type: 'audio',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

function createClip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip',
    name: 'clip',
    trackId: videoTrack.id,
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    ...overrides,
  } as TimelineClip;
}

function createMockAudioBuffer(): AudioBuffer {
  return {
    numberOfChannels: 2,
    sampleRate: 48000,
    length: 48000,
    duration: 1,
    getChannelData: () => new Float32Array(48000),
  } as unknown as AudioBuffer;
}

function createSignalAudioBuffer(channels: number[][], sampleRate = 48_000): AudioBuffer {
  const channelData = channels.map(samples => Float32Array.from(samples));
  const length = channelData[0]?.length ?? 0;
  const fallbackChannel = channelData[0] ?? new Float32Array(length);

  return {
    numberOfChannels: channelData.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: (channelIndex: number) => channelData[channelIndex] ?? fallbackChannel,
  } as unknown as AudioBuffer;
}

type AudioExportPipelineTestAccess = AudioExportPipeline & {
  prepareTrackData(
    clips: TimelineClip[],
    buffers: Map<string, AudioBuffer>,
    tracks: TimelineTrack[],
    exportStartTime: number,
    audioGraphPlan?: AudioGraphRenderPlan
  ): AudioTrackData[];
  renderMasterBusAudio(
    mixedBuffer: AudioBuffer,
    audioGraphPlan: AudioGraphRenderPlan,
  ): Promise<AudioBuffer>;
};

describe('AudioExportPipeline audio preflight', () => {
  it('returns false for video-only export ranges', () => {
    const clips = [createClip({ source: { type: 'video' } })];

    expect(AudioExportPipeline.hasAudioInRange(clips, [videoTrack, audioTrack], 0, 5)).toBe(false);
  });

  it('detects unmuted audio clips in range', () => {
    const clips = [
      createClip({
        id: 'audio-clip',
        trackId: audioTrack.id,
        source: { type: 'audio', audioElement: {} as HTMLAudioElement },
      }),
    ];

    expect(AudioExportPipeline.hasAudioInRange(clips, [videoTrack, audioTrack], 0, 5)).toBe(true);
  });

  it('ignores muted or non-solo audio tracks', () => {
    const clips = [
      createClip({
        id: 'muted-audio',
        trackId: audioTrack.id,
        source: { type: 'audio', audioElement: {} as HTMLAudioElement },
      }),
    ];

    expect(
      AudioExportPipeline.hasAudioInRange(clips, [videoTrack, { ...audioTrack, muted: true }], 0, 5)
    ).toBe(false);
    expect(
      AudioExportPipeline.hasAudioInRange(
        clips,
        [videoTrack, { ...audioTrack, solo: false }, { ...audioTrack, id: 'a2', solo: true }],
        0,
        5
      )
    ).toBe(false);
  });

  it('detects visible nested composition mixdowns', () => {
    const clips = [
      createClip({
        id: 'comp',
        isComposition: true,
        mixdownBuffer: {} as AudioBuffer,
        hasMixdownAudio: true,
      }),
    ];

    expect(AudioExportPipeline.hasAudioInRange(clips, [videoTrack, audioTrack], 0, 5)).toBe(true);
    expect(
      AudioExportPipeline.hasAudioInRange(clips, [{ ...videoTrack, visible: false }, audioTrack], 0, 5)
    ).toBe(false);
  });

  it('uses advanced track and clip audio graph state for export preflight', () => {
    const mutedByAudioState = createClip({
      id: 'muted-by-audio-state',
      trackId: audioTrack.id,
      source: { type: 'audio', audioElement: {} as HTMLAudioElement },
    });
    const soloedTrack = {
      ...audioTrack,
      id: 'a2',
      audioState: {
        volumeDb: 0,
        pan: 0,
        muted: false,
        solo: true,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak' as const,
      },
    };
    const audibleSoloClip = createClip({
      id: 'audible-solo',
      trackId: soloedTrack.id,
      source: { type: 'audio', audioElement: {} as HTMLAudioElement },
    });

    expect(
      AudioExportPipeline.getClipsWithAudio(
        [mutedByAudioState],
        [
          videoTrack,
          {
            ...audioTrack,
            audioState: {
              volumeDb: 0,
              pan: 0,
              muted: true,
              solo: false,
              recordArm: false,
              inputMonitor: false,
              meterMode: 'peak',
            },
          },
        ],
        0,
        5
      )
    ).toEqual([]);

    expect(
      AudioExportPipeline.getClipsWithAudio(
        [mutedByAudioState, audibleSoloClip],
        [videoTrack, audioTrack, soloedTrack],
        0,
        5
      ).map(clip => clip.id)
    ).toEqual(['audible-solo']);
  });

  it('keeps clips eligible when a time effect tail overlaps the export range', () => {
    const clip = createClip({
      id: 'tail-audio',
      trackId: audioTrack.id,
      startTime: 0,
      duration: 5,
      source: { type: 'audio', audioElement: {} as HTMLAudioElement },
      audioState: {
        effectStack: [{
          id: 'reverb-1',
          descriptorId: 'audio-reverb',
          enabled: true,
          params: { roomSize: 0.4, decaySeconds: 2, damping: 0.2, mix: 1 },
        }],
      },
    });

    expect(
      AudioExportPipeline.getClipsWithAudio([clip], [videoTrack, audioTrack], 5.5, 6)
        .map(candidate => candidate.id)
    ).toEqual(['tail-audio']);
  });

  it('prepares mixer track data from the normalized audio graph', () => {
    const clip = createClip({
      id: 'graph-audio',
      trackId: audioTrack.id,
      startTime: 2,
      source: { type: 'audio', audioElement: {} as HTMLAudioElement },
    });
    const track: TimelineTrack = {
      ...audioTrack,
      audioState: {
        volumeDb: -6,
        pan: 0.5,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'rms',
      },
    };
    const plan = renderAudioGraph({ clips: [clip], tracks: [videoTrack, track], mode: 'export' });
    const pipeline = new AudioExportPipeline() as AudioExportPipelineTestAccess;

    const trackData = pipeline.prepareTrackData(
      [clip],
      new Map([[clip.id, createMockAudioBuffer()]]),
      [videoTrack, track],
      1,
      plan
    );

    expect(trackData).toEqual([
      expect.objectContaining({
        clipId: 'graph-audio',
        startTime: 1,
        sourceOffsetTime: 0,
        trackId: audioTrack.id,
        trackMuted: false,
        trackSolo: false,
        trackVolumeDb: -6,
        trackPan: 0.5,
      }),
    ]);
  });

  it('adds a source offset when an export starts inside an audio clip', () => {
    const clip = createClip({
      id: 'midrange-audio',
      trackId: audioTrack.id,
      startTime: 2,
      duration: 8,
      source: { type: 'audio', audioElement: {} as HTMLAudioElement },
    });
    const plan = renderAudioGraph({ clips: [clip], tracks: [videoTrack, audioTrack], mode: 'export' });
    const pipeline = new AudioExportPipeline() as AudioExportPipelineTestAccess;

    const trackData = pipeline.prepareTrackData(
      [clip],
      new Map([[clip.id, createMockAudioBuffer()]]),
      [videoTrack, audioTrack],
      5.25,
      plan
    );

    expect(trackData[0]).toEqual(expect.objectContaining({
      clipId: 'midrange-audio',
      startTime: -3.25,
      sourceOffsetTime: 3.25,
    }));
  });

  it('prepares export send returns as additional mixer entries', () => {
    const clip = createClip({
      id: 'send-audio',
      trackId: audioTrack.id,
      startTime: 2,
      source: { type: 'audio', audioElement: {} as HTMLAudioElement },
    });
    const track: TimelineTrack = {
      ...audioTrack,
      audioState: {
        volumeDb: -6,
        pan: -0.25,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        sends: [
          {
            id: 'send-post',
            targetBusId: 'bus-plate',
            gainDb: -12,
            preFader: false,
            enabled: true,
          },
          {
            id: 'send-pre',
            targetBusId: 'bus-cue',
            gainDb: -9,
            preFader: true,
            enabled: true,
          },
          {
            id: 'send-muted',
            targetBusId: 'bus-muted',
            gainDb: 0,
            preFader: false,
            enabled: false,
          },
        ],
      },
    };
    const plan = renderAudioGraph({ clips: [clip], tracks: [videoTrack, track], mode: 'export' });
    const pipeline = new AudioExportPipeline() as AudioExportPipelineTestAccess;

    const trackData = pipeline.prepareTrackData(
      [clip],
      new Map([[clip.id, createMockAudioBuffer()]]),
      [videoTrack, track],
      1,
      plan
    );

    expect(trackData).toEqual([
      expect.objectContaining({
        clipId: 'send-audio',
        mixRole: 'main',
        trackVolumeDb: -6,
        trackPan: -0.25,
      }),
      expect.objectContaining({
        clipId: 'send-audio:send:send-post',
        mixRole: 'send',
        sendId: 'send-post',
        sendTargetBusId: 'bus-plate',
        sendPreFader: false,
        trackVolumeDb: -18,
        trackPan: -0.25,
      }),
      expect.objectContaining({
        clipId: 'send-audio:send:send-pre',
        mixRole: 'send',
        sendId: 'send-pre',
        sendTargetBusId: 'bus-cue',
        sendPreFader: true,
        trackVolumeDb: -9,
        trackPan: -0.25,
      }),
    ]);
  });

  it('applies the master target LUFS during export rendering', async () => {
    const targetLufs = -23;
    const samples = Array.from({ length: 48_000 }, (_, index) =>
      0.5 * Math.sin((2 * Math.PI * 440 * index) / 48_000)
    );
    const buffer = createSignalAudioBuffer([samples]);
    const before = analyzeAudioBufferLoudnessSummary(buffer).integratedLufs;
    const plan = renderAudioGraph({
      clips: [],
      tracks: [videoTrack, audioTrack],
      masterAudioState: {
        volumeDb: 0,
        limiterEnabled: false,
        targetLufs,
        truePeakCeilingDb: -1,
      },
      mode: 'export',
    });
    const pipeline = new AudioExportPipeline({ normalize: false }) as AudioExportPipelineTestAccess;

    const rendered = await pipeline.renderMasterBusAudio(buffer, plan);
    const after = analyzeAudioBufferLoudnessSummary(rendered).integratedLufs;

    expect(rendered).toBe(buffer);
    expect(before).toBeGreaterThan(targetLufs + 1);
    expect(after).toBeCloseTo(targetLufs, 1);
  });
});
