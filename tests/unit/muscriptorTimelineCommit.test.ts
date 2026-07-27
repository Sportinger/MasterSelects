import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureSnapshot,
  initHistoryStoreRefs,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { getTimelineClipAudioSourceFileKey } from '../../src/services/audio/audioClipResolution';
import { createProcessedClipAudioStateHash } from '../../src/services/audio/ProcessedWaveformPyramidService';
import type { TimelineClip, TimelineTrack } from '../../src/types';

function sourceTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'audio-track',
    name: 'Audio 1',
    type: 'audio',
    height: 40,
    muted: false,
    visible: true,
    solo: false,
    ...overrides,
  };
}

function sourceClip(): TimelineClip {
  const file = new File(['source'], 'song.wav', {
    type: 'audio/wav',
    lastModified: 1234,
  });
  return {
    id: 'audio-clip',
    trackId: 'audio-track',
    name: 'Song',
    file,
    startTime: 12,
    duration: 6,
    inPoint: 0,
    outPoint: 6,
    source: { type: 'audio', naturalDuration: 6 },
    transform: {} as TimelineClip['transform'],
    effects: [],
  };
}

function initializeHistory() {
  initHistoryStoreRefs({
    timeline: {
      getState: () => useTimelineStore.getState(),
      setState: state => useTimelineStore.setState(state),
    },
    media: {
      getState: () => ({
        files: [], compositions: [], folders: [], selectedIds: [],
        expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [],
        motionShapeItems: [], signalAssets: [], signalArtifacts: [],
        signalGraphs: [], signalOperators: [],
      }),
      setState: vi.fn(),
    },
    dock: {
      getState: () => ({ layout: null as never }),
      setState: vi.fn(),
    },
  });
}

describe('commitMidiTranscription', () => {
  beforeEach(() => {
    initializeHistory();
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState({
      tracks: [sourceTrack()],
      clips: [sourceClip()],
      expandedTracks: new Set(),
      selectedClipIds: new Set(),
      playheadPosition: 0,
      isExporting: false,
      duration: 60,
      durationLocked: false,
      invalidateCache: vi.fn(),
    });
    captureSnapshot('initial');
  });

  function fingerprint(): string {
    return getTimelineClipAudioSourceFileKey(sourceClip())!;
  }

  it('creates grouped GM tracks and clips at the audible source start as one undo step', () => {
    const result = useTimelineStore.getState().commitMidiTranscription({
      sourceClipId: 'audio-clip',
      sourceFingerprint: 'analysis-fingerprint',
      sourceFileKey: fingerprint(),
      tracks: [
        {
          instrumentId: 'acoustic_piano', displayName: 'Acoustic Piano', gmProgram: 0,
          notes: [
            { pitch: 64, startTime: 1, endTime: 2 },
            { pitch: 60, startTime: 0.5, endTime: 8, velocity: 0.6 },
          ],
        },
        {
          instrumentId: 'drums', displayName: 'Drums', gmProgram: 0, isDrum: true,
          notes: [{ pitch: 36, startTime: 0, endTime: 0.1 }],
        },
      ],
      provenance: { provider: 'test-provider', model: 'small', jobId: 'job-1' },
    });

    expect(result?.trackIds).toHaveLength(2);
    expect(result?.clipIds).toHaveLength(2);

    const state = useTimelineStore.getState();
    const generatedTracks = state.tracks.filter(track => track.type === 'midi');
    const generatedClips = state.clips.filter(clip => clip.source?.type === 'midi');
    expect(generatedTracks).toHaveLength(2);
    expect(generatedClips).toHaveLength(2);
    expect(generatedClips.every(clip => clip.startTime === 12 && clip.duration === 8)).toBe(true);
    expect(generatedClips.flatMap(clip => clip.midiData?.notes ?? [])).toHaveLength(3);

    const drumTrack = generatedTracks.find(track => track.name === 'Drums MIDI');
    expect(drumTrack?.midiInstrument).toEqual({ kind: 'gm', program: 0, isDrum: true, gain: 0.8 });
    const pianoTrack = generatedTracks.find(track => track.name === 'Acoustic Piano MIDI');
    expect(pianoTrack?.midiInstrument).toEqual({ kind: 'gm', program: 0, isDrum: false, gain: 0.8 });
    expect(generatedClips[0].midiData?.provenance).toMatchObject({
      provider: 'test-provider',
      sourceClipId: 'audio-clip',
      sourceFingerprint: 'analysis-fingerprint',
      sourceFileKey: fingerprint(),
    });

    expect(useHistoryStore.getState().undoStack).toHaveLength(1);
    expect(useHistoryStore.getState().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().tracks).toEqual([sourceTrack()]);
    expect(useTimelineStore.getState().clips.map(clip => clip.id)).toEqual(['audio-clip']);
    expect(useHistoryStore.getState().canUndo()).toBe(false);
  });

  it('does not mutate state or history for an empty transcription', () => {
    const beforeTracks = useTimelineStore.getState().tracks;
    const beforeClips = useTimelineStore.getState().clips;
    const result = useTimelineStore.getState().commitMidiTranscription({
      sourceClipId: 'audio-clip',
      sourceFingerprint: 'analysis-fingerprint',
      sourceFileKey: fingerprint(),
      tracks: [],
    });
    expect(result).toBeNull();
    expect(useTimelineStore.getState().tracks).toBe(beforeTracks);
    expect(useTimelineStore.getState().clips).toBe(beforeClips);
    expect(useHistoryStore.getState().undoStack).toHaveLength(0);
  });

  it('rejects stale source file keys and locked source tracks without mutation', () => {
    const stale = useTimelineStore.getState().commitMidiTranscription({
      sourceClipId: 'audio-clip',
      sourceFingerprint: 'analysis-fingerprint',
      sourceFileKey: 'stale',
      tracks: [{
        instrumentId: 'piano', gmProgram: 0,
        notes: [{ pitch: 60, startTime: 0, endTime: 1 }],
      }],
    });
    expect(stale).toBeNull();

    useTimelineStore.setState({ tracks: [sourceTrack({ locked: true })] });
    const locked = useTimelineStore.getState().commitMidiTranscription({
      sourceClipId: 'audio-clip',
      sourceFingerprint: 'analysis-fingerprint',
      sourceFileKey: fingerprint(),
      tracks: [{
        instrumentId: 'piano', gmProgram: 0,
        notes: [{ pitch: 60, startTime: 0, endTime: 1 }],
      }],
    });
    expect(locked).toBeNull();
    expect(useTimelineStore.getState().clips).toHaveLength(1);
    expect(useHistoryStore.getState().undoStack).toHaveLength(0);
  });

  it('rejects a result when processed clip state changed during inference', () => {
    const state = useTimelineStore.getState();
    const original = state.clips[0];
    const processingStateHash = createProcessedClipAudioStateHash(original, { keyframes: [] });
    useTimelineStore.setState({
      clips: [{ ...original, speed: 1.25 }],
    });

    const result = useTimelineStore.getState().commitMidiTranscription({
      sourceClipId: original.id,
      sourceFingerprint: 'analysis-fingerprint',
      processingStateHash,
      sourceFileKey: fingerprint(),
      tracks: [{
        instrumentId: 'piano',
        gmProgram: 0,
        notes: [{ pitch: 60, startTime: 0, endTime: 1 }],
      }],
    });

    expect(result).toBeNull();
    expect(useTimelineStore.getState().clips).toHaveLength(1);
    expect(useTimelineStore.getState().tracks).toHaveLength(1);
    expect(useHistoryStore.getState().undoStack).toHaveLength(0);
  });
});
