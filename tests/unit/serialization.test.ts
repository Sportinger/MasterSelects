import { describe, it, expect } from 'vitest';
import type {
  SerializableClip,
  CompositionTimelineData,
  TimelineTrack,
  ClipTransform,
  Keyframe,
  Effect,
  ClipMask,
} from '../../src/types/index';

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makeDefaultTransform(overrides?: Partial<ClipTransform>): ClipTransform {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

function makeSerializableClip(overrides?: Partial<SerializableClip>): SerializableClip {
  return {
    id: 'clip-1',
    trackId: 'track-v1',
    name: 'Test Clip',
    mediaFileId: 'media-1',
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    sourceType: 'video',
    transform: makeDefaultTransform(),
    effects: [],
    ...overrides,
  };
}

function makeTracks(): TimelineTrack[] {
  return [
    { id: 'track-v1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false },
    { id: 'track-a1', name: 'Audio 1', type: 'audio', height: 40, muted: false, visible: true, solo: false },
  ];
}

function makeTimelineData(overrides?: Partial<CompositionTimelineData>): CompositionTimelineData {
  return {
    tracks: makeTracks(),
    clips: [makeSerializableClip()],
    playheadPosition: 0,
    duration: 60,
    zoom: 50,
    scrollX: 0,
    inPoint: null,
    outPoint: null,
    loopPlayback: false,
    ...overrides,
  };
}

// ─── Clip serialization structure ───────────────────────────────────────────

describe('SerializableClip structure', () => {
  it('contains all required fields', () => {
    const clip = makeSerializableClip();
    expect(clip.id).toBe('clip-1');
    expect(clip.trackId).toBe('track-v1');
    expect(clip.name).toBe('Test Clip');
    expect(clip.mediaFileId).toBe('media-1');
    expect(clip.startTime).toBe(0);
    expect(clip.duration).toBe(10);
    expect(clip.inPoint).toBe(0);
    expect(clip.outPoint).toBe(10);
    expect(clip.sourceType).toBe('video');
    expect(clip.transform).toBeDefined();
    expect(clip.effects).toEqual([]);
  });

  it('preserves transform properties through serialization', () => {
    const transform = makeDefaultTransform({
      opacity: 0.75,
      blendMode: 'multiply',
      position: { x: 100, y: -50, z: 0 },
      scale: { x: 1.5, y: 0.8 },
      rotation: { x: 0, y: 0, z: 45 },
    });
    const clip = makeSerializableClip({ transform });

    // Simulate JSON round-trip (what happens during project save/load)
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.transform.opacity).toBe(0.75);
    expect(restored.transform.blendMode).toBe('multiply');
    expect(restored.transform.position).toEqual({ x: 100, y: -50, z: 0 });
    expect(restored.transform.scale).toEqual({ x: 1.5, y: 0.8 });
    expect(restored.transform.rotation).toEqual({ x: 0, y: 0, z: 45 });
  });

  it('preserves effects through JSON round-trip', () => {
    const effects: Effect[] = [
      { id: 'fx-1', name: 'Blur', type: 'blur', enabled: true, params: { radius: 5 } },
      { id: 'fx-2', name: 'Brightness', type: 'brightness', enabled: false, params: { amount: 0.2 } },
    ];
    const clip = makeSerializableClip({ effects });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.effects).toHaveLength(2);
    expect(restored.effects[0].id).toBe('fx-1');
    expect(restored.effects[0].type).toBe('blur');
    expect(restored.effects[0].enabled).toBe(true);
    expect(restored.effects[0].params.radius).toBe(5);
    expect(restored.effects[1].enabled).toBe(false);
  });

  it('preserves optional fields when present', () => {
    const clip = makeSerializableClip({
      linkedClipId: 'clip-audio-1',
      linkedGroupId: 'group-1',
      naturalDuration: 15,
      thumbnails: ['data:image/png;base64,abc', 'data:image/png;base64,def'],
      waveform: [0.1, 0.5, 0.8, 0.3],
      reversed: true,
      isComposition: true,
      compositionId: 'comp-1',
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.linkedClipId).toBe('clip-audio-1');
    expect(restored.linkedGroupId).toBe('group-1');
    expect(restored.naturalDuration).toBe(15);
    expect(restored.thumbnails).toEqual(['data:image/png;base64,abc', 'data:image/png;base64,def']);
    expect(restored.waveform).toEqual([0.1, 0.5, 0.8, 0.3]);
    expect(restored.reversed).toBe(true);
    expect(restored.isComposition).toBe(true);
    expect(restored.compositionId).toBe('comp-1');
  });
});

// ─── Track serialization ────────────────────────────────────────────────────

describe('Track serialization', () => {
  it('tracks preserve all fields through JSON round-trip', () => {
    const tracks = makeTracks();
    const json = JSON.stringify(tracks);
    const restored: TimelineTrack[] = JSON.parse(json);

    expect(restored).toHaveLength(2);
    expect(restored[0]).toEqual({
      id: 'track-v1',
      name: 'Video 1',
      type: 'video',
      height: 60,
      muted: false,
      visible: true,
      solo: false,
    });
    expect(restored[1].type).toBe('audio');
  });

  it('tracks with parentTrackId serialize correctly', () => {
    const tracks: TimelineTrack[] = [
      { id: 'track-v1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false },
      { id: 'track-v2', name: 'Video 2', type: 'video', height: 60, muted: false, visible: true, solo: false, parentTrackId: 'track-v1' },
    ];

    const json = JSON.stringify(tracks);
    const restored: TimelineTrack[] = JSON.parse(json);

    expect(restored[1].parentTrackId).toBe('track-v1');
  });
});

// ─── Keyframe Map <-> Record conversion ─────────────────────────────────────

describe('keyframe Map to Record conversion', () => {
  const keyframes: Keyframe[] = [
    { id: 'kf-1', clipId: 'clip-1', time: 0, property: 'opacity', value: 1, easing: 'linear' },
    { id: 'kf-2', clipId: 'clip-1', time: 2, property: 'opacity', value: 0.5, easing: 'ease-in-out' },
    { id: 'kf-3', clipId: 'clip-1', time: 1, property: 'position.x', value: 100, easing: 'ease-out' },
  ];

  it('serializes Map<string, Keyframe[]> to plain object', () => {
    // Simulate what getSerializableState does: keyframes are stored per-clip in the serialized clips
    const keyframeMap = new Map<string, Keyframe[]>();
    keyframeMap.set('clip-1', keyframes);
    keyframeMap.set('clip-2', []);

    // Convert Map to Record (JSON-serializable)
    const record: Record<string, Keyframe[]> = {};
    keyframeMap.forEach((kfs, clipId) => {
      record[clipId] = kfs;
    });

    const json = JSON.stringify(record);
    const parsed = JSON.parse(json);

    expect(parsed['clip-1']).toHaveLength(3);
    expect(parsed['clip-1'][0].property).toBe('opacity');
    expect(parsed['clip-1'][1].easing).toBe('ease-in-out');
    expect(parsed['clip-2']).toHaveLength(0);
  });

  it('deserializes Record back to Map<string, Keyframe[]>', () => {
    // Simulate what loadState does: build Map from serialized clip keyframes
    const serializedClips: SerializableClip[] = [
      makeSerializableClip({ id: 'clip-1', keyframes }),
      makeSerializableClip({ id: 'clip-2', keyframes: undefined }),
    ];

    const keyframeMap = new Map<string, Keyframe[]>();
    for (const clip of serializedClips) {
      if (clip.keyframes && clip.keyframes.length > 0) {
        keyframeMap.set(clip.id, clip.keyframes);
      }
    }

    expect(keyframeMap.size).toBe(1);
    expect(keyframeMap.has('clip-1')).toBe(true);
    expect(keyframeMap.has('clip-2')).toBe(false);
    expect(keyframeMap.get('clip-1')).toHaveLength(3);
  });

  it('keyframe bezier handles survive JSON round-trip', () => {
    const kf: Keyframe = {
      id: 'kf-bezier',
      clipId: 'clip-1',
      time: 1.5,
      property: 'scale.x',
      value: 2.0,
      easing: 'bezier',
      handleIn: { x: -0.3, y: 0.1 },
      handleOut: { x: 0.3, y: -0.1 },
    };

    const json = JSON.stringify(kf);
    const restored: Keyframe = JSON.parse(json);

    expect(restored.easing).toBe('bezier');
    expect(restored.handleIn).toEqual({ x: -0.3, y: 0.1 });
    expect(restored.handleOut).toEqual({ x: 0.3, y: -0.1 });
  });
});

// ─── CompositionTimelineData full round-trip ────────────────────────────────

describe('CompositionTimelineData round-trip', () => {
  it('basic timeline data survives JSON serialize/deserialize', () => {
    const data = makeTimelineData({
      playheadPosition: 5.5,
      duration: 120,
      zoom: 75,
      scrollX: 200,
      inPoint: 2,
      outPoint: 30,
      loopPlayback: true,
      durationLocked: true,
    });

    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    expect(restored.playheadPosition).toBe(5.5);
    expect(restored.duration).toBe(120);
    expect(restored.zoom).toBe(75);
    expect(restored.scrollX).toBe(200);
    expect(restored.inPoint).toBe(2);
    expect(restored.outPoint).toBe(30);
    expect(restored.loopPlayback).toBe(true);
    expect(restored.durationLocked).toBe(true);
    expect(restored.tracks).toHaveLength(2);
    expect(restored.clips).toHaveLength(1);
  });

  it('null inPoint/outPoint serializes correctly', () => {
    const data = makeTimelineData({ inPoint: null, outPoint: null });

    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    expect(restored.inPoint).toBeNull();
    expect(restored.outPoint).toBeNull();
  });

  it('markers serialize and deserialize', () => {
    const data = makeTimelineData({
      markers: [
        { id: 'm1', time: 5, label: 'Intro', color: '#ff0000' },
        { id: 'm2', time: 15, label: 'Chorus', color: '#00ff00' },
      ],
    });

    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    expect(restored.markers).toHaveLength(2);
    expect(restored.markers![0].label).toBe('Intro');
    expect(restored.markers![1].time).toBe(15);
  });
});

// ─── Mask serialization ─────────────────────────────────────────────────────

describe('mask serialization', () => {
  it('clip masks survive JSON round-trip', () => {
    const masks: ClipMask[] = [
      {
        id: 'mask-1',
        name: 'Mask 1',
        vertices: [
          { id: 'v1', x: 0.1, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { id: 'v2', x: 0.9, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { id: 'v3', x: 0.9, y: 0.9, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
        ],
        closed: true,
        opacity: 1,
        feather: 5,
        featherQuality: 1,
        inverted: false,
        mode: 'add',
        expanded: false,
        position: { x: 0, y: 0 },
        visible: true,
      },
    ];

    const clip = makeSerializableClip({ masks });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.masks).toHaveLength(1);
    expect(restored.masks![0].vertices).toHaveLength(3);
    expect(restored.masks![0].closed).toBe(true);
    expect(restored.masks![0].feather).toBe(5);
    expect(restored.masks![0].mode).toBe('add');
  });
});

// ─── Missing/default fields on deserialization ──────────────────────────────

describe('default values on deserialization', () => {
  it('missing optional fields default correctly', () => {
    // Simulate a minimal clip from an older project version
    const minimalClip = {
      id: 'clip-old',
      trackId: 'track-v1',
      name: 'Old Clip',
      mediaFileId: 'media-old',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      sourceType: 'video',
      transform: makeDefaultTransform(),
      effects: [],
      // No keyframes, masks, transcript, analysis, reversed, etc.
    };

    const json = JSON.stringify(minimalClip);
    const restored: SerializableClip = JSON.parse(json);

    // These should be undefined (matching the loadState fallback behavior)
    expect(restored.keyframes).toBeUndefined();
    expect(restored.masks).toBeUndefined();
    expect(restored.transcript).toBeUndefined();
    expect(restored.transcriptStatus).toBeUndefined();
    expect(restored.analysis).toBeUndefined();
    expect(restored.analysisStatus).toBeUndefined();
    expect(restored.reversed).toBeUndefined();
    expect(restored.isComposition).toBeUndefined();
    expect(restored.compositionId).toBeUndefined();
    expect(restored.linkedClipId).toBeUndefined();
    expect(restored.textProperties).toBeUndefined();
    expect(restored.solidColor).toBeUndefined();
  });

  it('loadState defaults: effects fallback to empty array', () => {
    // Simulate what loadState does: effects: serializedClip.effects || []
    const clipWithNoEffects: Partial<SerializableClip> = { effects: undefined as unknown as Effect[] };
    const restoredEffects = clipWithNoEffects.effects || [];
    expect(restoredEffects).toEqual([]);
  });

  it('loadState defaults: transcriptStatus fallback to none', () => {
    // Simulate what loadState does: transcriptStatus: serializedClip.transcriptStatus || 'none'
    const clipNoStatus: Partial<SerializableClip> = {};
    const status = clipNoStatus.transcriptStatus || 'none';
    expect(status).toBe('none');
  });

  it('loadState defaults: analysisStatus fallback to none', () => {
    const clipNoStatus: Partial<SerializableClip> = {};
    const status = clipNoStatus.analysisStatus || 'none';
    expect(status).toBe('none');
  });

  it('loadState defaults: markers fallback to empty array', () => {
    // Simulate what loadState does: markers: data.markers || []
    const data: Partial<CompositionTimelineData> = {};
    const markers = data.markers || [];
    expect(markers).toEqual([]);
  });

  it('loadState defaults: durationLocked fallback to false', () => {
    const data: Partial<CompositionTimelineData> = {};
    const locked = data.durationLocked || false;
    expect(locked).toBe(false);
  });
});

// ─── Complex multi-clip timeline round-trip ─────────────────────────────────

describe('complex timeline round-trip', () => {
  it('multi-clip timeline with keyframes, effects, and masks survives serialization', () => {
    const data = makeTimelineData({
      tracks: [
        { id: 'tv1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false },
        { id: 'tv2', name: 'Video 2', type: 'video', height: 60, muted: false, visible: true, solo: false },
        { id: 'ta1', name: 'Audio 1', type: 'audio', height: 40, muted: false, visible: true, solo: false },
      ],
      clips: [
        makeSerializableClip({
          id: 'c1',
          trackId: 'tv1',
          name: 'Intro',
          startTime: 0,
          duration: 5,
          outPoint: 5,
          effects: [{ id: 'fx1', name: 'Blur', type: 'blur', enabled: true, params: { radius: 3 } }],
          keyframes: [
            { id: 'kf1', clipId: 'c1', time: 0, property: 'opacity', value: 0, easing: 'ease-in' },
            { id: 'kf2', clipId: 'c1', time: 1, property: 'opacity', value: 1, easing: 'linear' },
          ],
          transform: makeDefaultTransform({ opacity: 0.9, rotation: { x: 0, y: 0, z: 15 } }),
        }),
        makeSerializableClip({
          id: 'c2',
          trackId: 'tv2',
          name: 'Overlay',
          startTime: 2,
          duration: 8,
          outPoint: 8,
          transform: makeDefaultTransform({ blendMode: 'screen', position: { x: 50, y: 50, z: 0 } }),
          masks: [{
            id: 'mask-1',
            name: 'Vignette',
            vertices: [
              { id: 'v1', x: 0.2, y: 0.2, handleIn: { x: -0.1, y: 0 }, handleOut: { x: 0.1, y: 0 } },
              { id: 'v2', x: 0.8, y: 0.8, handleIn: { x: -0.1, y: 0 }, handleOut: { x: 0.1, y: 0 } },
            ],
            closed: true,
            opacity: 0.8,
            feather: 10,
            featherQuality: 2,
            inverted: true,
            mode: 'subtract',
            expanded: false,
            position: { x: 0, y: 0 },
            visible: true,
          }],
        }),
        makeSerializableClip({
          id: 'c3',
          trackId: 'ta1',
          name: 'Background Music',
          sourceType: 'audio',
          startTime: 0,
          duration: 10,
          outPoint: 10,
          linkedClipId: 'c1',
          waveform: [0.1, 0.3, 0.5, 0.7, 0.9, 0.7, 0.5, 0.3, 0.1, 0.0],
        }),
      ],
      playheadPosition: 3.5,
      duration: 10,
      inPoint: 1,
      outPoint: 9,
      loopPlayback: true,
      markers: [
        { id: 'm1', time: 0, label: 'Start', color: '#00ff00' },
        { id: 'm2', time: 5, label: 'Midpoint', color: '#ffff00' },
      ],
    });

    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    // Verify structure integrity
    expect(restored.tracks).toHaveLength(3);
    expect(restored.clips).toHaveLength(3);
    expect(restored.markers).toHaveLength(2);

    // Verify clip 1 (with keyframes and effects)
    const clip1 = restored.clips[0];
    expect(clip1.name).toBe('Intro');
    expect(clip1.effects).toHaveLength(1);
    expect(clip1.keyframes).toHaveLength(2);
    expect(clip1.keyframes![0].value).toBe(0);
    expect(clip1.keyframes![1].value).toBe(1);
    expect(clip1.transform.rotation).toEqual({ x: 0, y: 0, z: 15 });

    // Verify clip 2 (with masks and blend mode)
    const clip2 = restored.clips[1];
    expect(clip2.transform.blendMode).toBe('screen');
    expect(clip2.masks).toHaveLength(1);
    expect(clip2.masks![0].inverted).toBe(true);
    expect(clip2.masks![0].mode).toBe('subtract');

    // Verify clip 3 (audio with waveform)
    const clip3 = restored.clips[2];
    expect(clip3.sourceType).toBe('audio');
    expect(clip3.linkedClipId).toBe('c1');
    expect(clip3.waveform).toHaveLength(10);

    // Verify timeline state
    expect(restored.playheadPosition).toBe(3.5);
    expect(restored.inPoint).toBe(1);
    expect(restored.outPoint).toBe(9);
    expect(restored.loopPlayback).toBe(true);
  });
});

// ─── Media file reference integrity ─────────────────────────────────────────

describe('media file references', () => {
  it('each clip references a mediaFileId (non-composition clips)', () => {
    const clips: SerializableClip[] = [
      makeSerializableClip({ id: 'c1', mediaFileId: 'media-1' }),
      makeSerializableClip({ id: 'c2', mediaFileId: 'media-2' }),
      makeSerializableClip({ id: 'c3', mediaFileId: 'media-1' }), // same media, different clip
    ];

    const mediaFileIds = clips.map(c => c.mediaFileId);
    expect(mediaFileIds).toEqual(['media-1', 'media-2', 'media-1']);

    // All should be non-empty strings
    for (const id of mediaFileIds) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('composition clips have empty mediaFileId', () => {
    const compClip = makeSerializableClip({
      id: 'comp-clip-1',
      mediaFileId: '',
      isComposition: true,
      compositionId: 'comp-1',
    });

    expect(compClip.mediaFileId).toBe('');
    expect(compClip.isComposition).toBe(true);
    expect(compClip.compositionId).toBe('comp-1');
  });
});
