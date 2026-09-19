import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compositionAudioMixer } from '../../src/services/compositionAudioMixer';
import { AudioMixer } from '../../src/engine/audio/AudioMixer';
import { audioExtractor } from '../../src/engine/audio/AudioExtractor';
import { timeStretchProcessor } from '../../src/engine/audio/TimeStretchProcessor';
import { ClipAudioRenderService } from '../../src/services/audio/ClipAudioRenderService';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { createBuffer } from '../../src/engine/audio/audioBufferFactory';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { SerializableClip, TimelineClip, TimelineTrack } from '../../src/types/timeline';

function serialized(clip: TimelineClip): SerializableClip {
  const { file: _file, source, ...data } = clip;
  return { ...data, mediaFileId: clip.mediaFileId ?? '', sourceType: source?.type ?? 'audio' };
}

const audioTrack = createMockTrack({ id: 'a1', type: 'audio' });
const videoTrack = createMockTrack({ id: 'v1', type: 'video' });

function comp(id: string, clips: TimelineClip[], tracks = [audioTrack]): Composition {
  return {
    id, name: id, duration: 5,
    timelineData: { clips: clips.map(serialized), tracks, duration: 5 },
  } as Composition;
}

function nested(id: string, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id, trackId: audioTrack.id, source: { type: 'audio' },
    isComposition: true, compositionId: 'child', ...overrides,
  });
}

const sourceFile = new File(['audio-data'], 'song.wav', { type: 'audio/wav' });

function installCompositionState(compositions: Composition[], options: {
  activeId?: string; clips?: TimelineClip[]; tracks?: TimelineTrack[];
} = {}): void {
  const mediaState = useMediaStore.getState();
  const timelineState = useTimelineStore.getState();
  vi.spyOn(useMediaStore, 'getState').mockReturnValue({
    ...mediaState, compositions, activeCompositionId: options.activeId ?? null,
    files: [{ id: 'song', name: 'song.wav', file: sourceFile } as never],
  });
  if (options.activeId) {
    vi.spyOn(useTimelineStore, 'getState').mockReturnValue({
      ...timelineState, clips: options.clips ?? [], tracks: options.tracks ?? [audioTrack],
      clipKeyframes: new Map(),
    });
  }
}

describe('composition audio content', () => {
  let source: AudioBuffer;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', class {
      state = 'running';
      createBuffer = createBuffer;
      close() { this.state = 'closed'; }
    });
    source = createBuffer(1, 40, 8);
    source.getChannelData(0).set(Array.from({ length: 40 }, (_, i) => i / 40));
    vi.spyOn(audioExtractor, 'extractAudio').mockResolvedValue(source);
    vi.spyOn(audioExtractor, 'trimBuffer').mockImplementation((buffer, start, end) => {
      const first = Math.floor(start * buffer.sampleRate);
      const last = Math.floor(end * buffer.sampleRate);
      const result = createBuffer(buffer.numberOfChannels, last - first, buffer.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        result.getChannelData(channel).set(buffer.getChannelData(channel).subarray(first, last));
      }
      return result;
    });
    // Inspect the PCM handed to the mixer. Web Audio routing itself has its
    // own tests; this suite covers composition traversal and source rendering.
    vi.spyOn(AudioMixer.prototype, 'mixTracks').mockImplementation(async (tracks, duration) => {
      const mixed = createBuffer(1, Math.round(duration * 8), 8);
      for (const track of tracks) {
        if (track.trackMuted) continue;
        const offset = Math.round(track.startTime * 8);
        track.buffer.getChannelData(0).forEach((sample, i) => {
          if (offset + i < mixed.length) mixed.getChannelData(0)[offset + i] += sample;
        });
      }
      return mixed;
    });
  });

  afterEach(() => {
    compositionAudioMixer.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function child(): Composition {
    return comp('child', [createMockClip({
      id: 'song-clip', trackId: audioTrack.id, mediaFileId: 'song', source: { type: 'audio' },
    })]);
  }

  it('keeps sound when a nested composition contains only its audio half', async () => {
    installCompositionState([comp('parent', [nested('audio-only')]), child()]);
    const result = await compositionAudioMixer.mixdownComposition('parent');
    expect(result?.hasAudio).toBe(true);
    expect(Array.from(result!.buffer.getChannelData(0))).toEqual(Array.from(source.getChannelData(0)));
    expect(audioExtractor.extractAudio).toHaveBeenCalledExactlyOnceWith(sourceFile, 'song-clip');
  });

  it('renders an unlinked nested video composition even without local audio tracks', async () => {
    installCompositionState([
      comp('parent', [nested('legacy-video', { trackId: 'v1', source: { type: 'video' } })], [videoTrack]),
      child(),
    ]);
    const result = await compositionAudioMixer.mixdownComposition('parent');
    expect(result?.hasAudio).toBe(true);
    expect(result!.buffer.getChannelData(0)[20]).toBeCloseTo(0.5);
  });

  it('renders a linked video/audio pair once, using the audio trim and track state', async () => {
    const linkedAudio = nested('audio', { linkedClipId: 'video', inPoint: 2, outPoint: 4, duration: 2 });
    const linkedVideo = nested('video', { linkedClipId: 'audio', trackId: 'v1', source: { type: 'video' } });
    installCompositionState([comp('parent', [linkedVideo, linkedAudio], [videoTrack, audioTrack]), child()]);
    const result = await compositionAudioMixer.mixdownComposition('parent');
    const parentTracks = vi.mocked(AudioMixer.prototype.mixTracks).mock.calls.at(-1)![0];
    expect(parentTracks.map(track => track.clipId)).toEqual(['audio']);
    expect(parentTracks[0].buffer.duration).toBe(2);
    expect(result!.buffer.getChannelData(0)[0]).toBeCloseTo(0.4);
    expect(audioExtractor.extractAudio).toHaveBeenCalledTimes(1);
  });

  it('applies reverse and speed before mixing a nested clip', async () => {
    const spedUp = createBuffer(1, 16, 8);
    const stretch = vi.spyOn(timeStretchProcessor, 'processConstantSpeed').mockResolvedValue(spedUp);
    installCompositionState([
      comp('parent', [nested('nested-speed', { inPoint: 1, outPoint: 5, duration: 2, speed: 2, reversed: true })]),
      child(),
    ]);
    await compositionAudioMixer.mixdownComposition('parent');
    expect(stretch).toHaveBeenCalledTimes(1);
    expect(stretch.mock.calls[0][0].getChannelData(0)[0]).toBeCloseTo(39 / 40);
    expect(stretch.mock.calls[0].slice(1)).toEqual([2, true]);
    expect(vi.mocked(AudioMixer.prototype.mixTracks).mock.calls.at(-1)![0][0].buffer).toBe(spedUp);
  });

  it('passes serialized and live speed automation to the shared audio renderer', async () => {
    const clip = createMockClip({ id: 'song-clip', trackId: 'a1', mediaFileId: 'song', source: { type: 'audio' } });
    const keyframes = [createMockKeyframe({ clipId: clip.id, property: 'speed', value: 2 })];
    const stored = child();
    stored.timelineData!.clips[0].keyframes = keyframes;
    installCompositionState([stored]);
    const renderer = vi.spyOn(ClipAudioRenderService.prototype, 'render').mockResolvedValue({ buffer: source });
    await compositionAudioMixer.mixdownComposition('child');
    expect(renderer).toHaveBeenLastCalledWith(expect.objectContaining({ keyframes }));
    vi.restoreAllMocks();
    installCompositionState([stored], { activeId: 'child', clips: [clip] });
    useTimelineStore.getState().clipKeyframes.set(clip.id, keyframes);
    vi.spyOn(AudioMixer.prototype, 'mixTracks').mockResolvedValue(source);
    vi.spyOn(audioExtractor, 'extractAudio').mockResolvedValue(source);
    const liveRenderer = vi.spyOn(ClipAudioRenderService.prototype, 'render').mockResolvedValue({ buffer: source });
    await compositionAudioMixer.mixdownComposition('child');
    expect(liveRenderer).toHaveBeenLastCalledWith(expect.objectContaining({ keyframes }));
  });

  it('resolves source IDs before duplicate names and does not substitute a different file', async () => {
    const current = child();
    current.timelineData!.clips[0].mediaFileId = 'missing-source';
    current.timelineData!.clips[0].name = 'song.wav';
    installCompositionState([current]);
    const result = await compositionAudioMixer.mixdownComposition('child');
    expect(result?.hasAudio).toBe(false);
    expect(audioExtractor.extractAudio).not.toHaveBeenCalled();
  });
});
