import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openPhoneEditor } from '../../src/components/mobileSkin/audiofx/phoneOpenEditor';
import { PHONE_BEAT_STEPS, phoneBeatClipIds, phoneBeatTargetTracks, phoneDefaultBeatSource } from '../../src/components/mobileSkin/audio/phoneAudioBeatPlan';
import { phoneCompositionRenderEngine } from '../../src/components/mobileSkin/compositions/phoneCompositionCommands';
import { usePhoneUiStore } from '../../src/components/mobileSkin/state/phoneUiStore';
import { formatPhoneTrackPan, formatPhoneTrackVolume } from '../../src/components/mobileSkin/tracks/phoneTrackAudioFormat';
import { readPhoneWorkspaceSideChoice } from '../../src/components/mobileSkin/workspace/phoneWorkspaceCatalog';
import { useTimelineStore } from '../../src/stores/timeline';
import type { BeatRuleSourceOption } from '../../src/services/compositionRules/beatRuleSource';
import { createMockClip, createMockTrack } from '../helpers/mockData';

function seed() {
  useTimelineStore.setState({
    tracks: [
      createMockTrack({ id: 'v2', type: 'video' }),
      createMockTrack({ id: 'v1', type: 'video' }),
      createMockTrack({ id: 'locked', type: 'video', locked: true }),
      createMockTrack({ id: 'empty', type: 'video' }),
      createMockTrack({ id: 'a1', type: 'audio' }),
    ],
    clips: [
      createMockClip({ id: 'late', trackId: 'v1', startTime: 6, duration: 2 }),
      createMockClip({ id: 'early', trackId: 'v1', startTime: 0, duration: 2 }),
      createMockClip({ id: 'top', trackId: 'v2', startTime: 1, duration: 2 }),
      createMockClip({ id: 'locked-clip', trackId: 'locked', startTime: 0, duration: 2 }),
      createMockClip({ id: 'music', trackId: 'a1', startTime: 0, duration: 8 }),
    ],
    selectedClipIds: new Set(['top']),
    primarySelectedClipId: 'top',
    isPlaying: false,
  });
  usePhoneUiStore.setState({ workspace: null, activeSheet: 'speed', panelSheet: null });
}

describe('openPhoneEditor (sheet rows that hand over to a landscape editor)', () => {
  beforeEach(() => { window.localStorage.clear(); seed(); });
  afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], selectedClipIds: new Set() }));

  it('selects the clip alone, closes the sheet and opens the editor', () => {
    expect(openPhoneEditor('curves', { clipId: 'early' })).toBe(true);
    expect([...useTimelineStore.getState().selectedClipIds]).toEqual(['early']);
    expect(usePhoneUiStore.getState().workspace).toBe('curves');
    expect(usePhoneUiStore.getState().activeSheet).toBeNull();
  });

  it('opens the requested side panel and remembers it for that editor only', () => {
    openPhoneEditor('curves', { clipId: 'early', revealSide: 'right' });
    expect(readPhoneWorkspaceSideChoice('curves', 'right')).toBe(false);
    expect(readPhoneWorkspaceSideChoice('curves', 'left')).toBeUndefined();
    expect(readPhoneWorkspaceSideChoice('mixer', 'right')).toBeUndefined();
  });

  it('clears the selection for the composition graph', () => {
    openPhoneEditor('nodes', { clearSelection: true });
    expect(useTimelineStore.getState().selectedClipIds.size).toBe(0);
    expect(usePhoneUiStore.getState().workspace).toBe('nodes');
  });

  it('pauses playback first (the editors edit a still frame)', () => {
    useTimelineStore.setState({ isPlaying: true });
    openPhoneEditor('mixer');
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it('refuses an unknown editor with a toast instead of failing silently', () => {
    expect(openPhoneEditor('nope' as never)).toBe(false);
    expect(usePhoneUiStore.getState().workspace).toBeNull();
    expect(usePhoneUiStore.getState().toast?.tone).toBe('error');
  });
});

describe('beats tab planning', () => {
  beforeEach(seed);

  it('offers unlocked video tracks with clips, the main (lowest) track first', () => {
    const { tracks, clips } = useTimelineStore.getState();
    expect(phoneBeatTargetTracks(tracks, clips).map((track) => track.id)).toEqual(['v1', 'v2']);
  });

  it('puts a track\'s clips on beats in time order', () => {
    expect(phoneBeatClipIds(useTimelineStore.getState().clips, 'v1')).toEqual(['early', 'late']);
  });

  it('defaults to a detected beat grid, else a clip to detect, else the tempo map', () => {
    const tempo: BeatRuleSourceOption = { value: 'tempo-map', label: 'Composition tempo map', source: { kind: 'tempo-map' } };
    const todo: BeatRuleSourceOption = { value: 'music:unanalyzed', label: 'music (not analyzed)', analysisClipId: 'music' };
    const ready: BeatRuleSourceOption = { value: 'music:source', label: 'music (source)', source: { kind: 'clip-beat-grid', clipId: 'music', provenance: 'source', artifactId: 'grid' } };
    expect(phoneDefaultBeatSource([tempo, todo, ready])).toBe('music:source');
    expect(phoneDefaultBeatSource([tempo, todo])).toBe('music:unanalyzed');
    expect(phoneDefaultBeatSource([tempo])).toBe('tempo-map');
    expect(phoneDefaultBeatSource([])).toBe('tempo-map');
    expect(PHONE_BEAT_STEPS).toEqual([1, 2, 4]);
  });
});

describe('track level and pan readouts', () => {
  it('formats pan as C / L n / R n and clamps it', () => {
    expect(formatPhoneTrackPan(0)).toBe('C');
    expect(formatPhoneTrackPan(-0.3)).toBe('L 30');
    expect(formatPhoneTrackPan(0.55)).toBe('R 55');
    expect(formatPhoneTrackPan(4)).toBe('R 100');
    expect(formatPhoneTrackPan(Number.NaN)).toBe('C');
  });

  it('formats the level in dB with -inf at the bottom', () => {
    expect(formatPhoneTrackVolume(0)).toBe('0.0 dB');
    expect(formatPhoneTrackVolume(3)).toBe('+3.0 dB');
    expect(formatPhoneTrackVolume(-6.5)).toBe('-6.5 dB');
    expect(formatPhoneTrackVolume(-60)).toBe('-inf dB');
  });

  it('track level and pan go through the store clamps (-60..+18 dB, -1..1)', () => {
    seed();
    useTimelineStore.getState().setTrackAudioVolumeDb('a1', 40);
    useTimelineStore.getState().setTrackAudioPan('a1', -3);
    const track = useTimelineStore.getState().tracks.find((candidate) => candidate.id === 'a1')!;
    expect(track.audioState?.volumeDb).toBe(18);
    expect(track.audioState?.pan).toBe(-1);
  });
});

describe('composition render engine', () => {
  it('reads raster when nothing is stored and the stored engine otherwise', () => {
    expect(phoneCompositionRenderEngine({ renderSettings: undefined })).toBe('raster');
    expect(phoneCompositionRenderEngine({ renderSettings: { engine: 'path-traced', renderScale: 0.5, stillSamples: 256, maxBounces: 8, clampIndirect: 10 } })).toBe('path-traced');
  });
});
