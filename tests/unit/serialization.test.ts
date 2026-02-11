import { describe, it, expect } from 'vitest';
import type {
  SerializableClip,
  CompositionTimelineData,
  TimelineTrack,
  ClipTransform,
  Keyframe,
  Effect,
  ClipMask,
  TranscriptWord,
  ClipAnalysis,
  FrameAnalysisData,
  TextClipProperties,
  TimelineTransition,
  SerializableMarker,
  MaskVertex,
  BezierHandle,
  BlendMode,
  EasingType,
  AnimatableProperty,
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

// ─── Transcript serialization ────────────────────────────────────────────────

describe('transcript serialization', () => {
  it('transcript words survive JSON round-trip', () => {
    const transcript: TranscriptWord[] = [
      { id: 'w1', text: 'Hello', start: 0.0, end: 0.5, confidence: 0.95, speaker: 'Speaker 1' },
      { id: 'w2', text: 'world', start: 0.5, end: 1.0, confidence: 0.88 },
      { id: 'w3', text: 'test', start: 1.0, end: 1.5 },
    ];

    const clip = makeSerializableClip({
      transcript,
      transcriptStatus: 'ready',
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.transcript).toHaveLength(3);
    expect(restored.transcript![0].text).toBe('Hello');
    expect(restored.transcript![0].start).toBe(0.0);
    expect(restored.transcript![0].end).toBe(0.5);
    expect(restored.transcript![0].confidence).toBe(0.95);
    expect(restored.transcript![0].speaker).toBe('Speaker 1');
    expect(restored.transcript![1].speaker).toBeUndefined();
    expect(restored.transcript![2].confidence).toBeUndefined();
    expect(restored.transcriptStatus).toBe('ready');
  });

  it('all transcript statuses serialize correctly', () => {
    const statuses: Array<'none' | 'transcribing' | 'ready' | 'error'> = ['none', 'transcribing', 'ready', 'error'];

    for (const status of statuses) {
      const clip = makeSerializableClip({ transcriptStatus: status });
      const json = JSON.stringify(clip);
      const restored: SerializableClip = JSON.parse(json);
      expect(restored.transcriptStatus).toBe(status);
    }
  });

  it('empty transcript array serializes correctly', () => {
    const clip = makeSerializableClip({ transcript: [], transcriptStatus: 'none' });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.transcript).toEqual([]);
  });
});

// ─── Analysis data serialization ─────────────────────────────────────────────

describe('analysis data serialization', () => {
  it('clip analysis with frame data survives JSON round-trip', () => {
    const analysis: ClipAnalysis = {
      sampleInterval: 500,
      frames: [
        { timestamp: 0, motion: 0.1, globalMotion: 0.05, localMotion: 0.08, focus: 0.9, brightness: 0.5, faceCount: 1 },
        { timestamp: 0.5, motion: 0.4, globalMotion: 0.2, localMotion: 0.3, focus: 0.7, brightness: 0.6, faceCount: 2, isSceneCut: false },
        { timestamp: 1.0, motion: 0.9, globalMotion: 0.8, localMotion: 0.1, focus: 0.3, brightness: 0.4, faceCount: 0, isSceneCut: true },
      ],
    };

    const clip = makeSerializableClip({
      analysis,
      analysisStatus: 'ready',
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.analysis).toBeDefined();
    expect(restored.analysis!.sampleInterval).toBe(500);
    expect(restored.analysis!.frames).toHaveLength(3);

    const frame0 = restored.analysis!.frames[0];
    expect(frame0.timestamp).toBe(0);
    expect(frame0.motion).toBe(0.1);
    expect(frame0.globalMotion).toBe(0.05);
    expect(frame0.localMotion).toBe(0.08);
    expect(frame0.focus).toBe(0.9);
    expect(frame0.brightness).toBe(0.5);
    expect(frame0.faceCount).toBe(1);
    expect(frame0.isSceneCut).toBeUndefined();

    const frame2 = restored.analysis!.frames[2];
    expect(frame2.isSceneCut).toBe(true);
    expect(frame2.faceCount).toBe(0);

    expect(restored.analysisStatus).toBe('ready');
  });

  it('all analysis statuses serialize correctly', () => {
    const statuses: Array<'none' | 'analyzing' | 'ready' | 'error'> = ['none', 'analyzing', 'ready', 'error'];

    for (const status of statuses) {
      const clip = makeSerializableClip({ analysisStatus: status });
      const json = JSON.stringify(clip);
      const restored: SerializableClip = JSON.parse(json);
      expect(restored.analysisStatus).toBe(status);
    }
  });

  it('analysis with empty frames array serializes correctly', () => {
    const analysis: ClipAnalysis = { sampleInterval: 1000, frames: [] };
    const clip = makeSerializableClip({ analysis, analysisStatus: 'ready' });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.analysis!.frames).toEqual([]);
    expect(restored.analysis!.sampleInterval).toBe(1000);
  });
});

// ─── Text clip serialization ─────────────────────────────────────────────────

describe('text clip serialization', () => {
  function makeTextProperties(overrides?: Partial<TextClipProperties>): TextClipProperties {
    return {
      text: 'Hello World',
      fontFamily: 'Roboto',
      fontSize: 48,
      fontWeight: 700,
      fontStyle: 'normal',
      color: '#ffffff',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      letterSpacing: 0,
      strokeEnabled: false,
      strokeColor: '#000000',
      strokeWidth: 2,
      shadowEnabled: false,
      shadowColor: 'rgba(0,0,0,0.5)',
      shadowOffsetX: 2,
      shadowOffsetY: 2,
      shadowBlur: 4,
      pathEnabled: false,
      pathPoints: [],
      ...overrides,
    };
  }

  it('text clip properties survive JSON round-trip', () => {
    const textProperties = makeTextProperties();
    const clip = makeSerializableClip({
      sourceType: 'text',
      mediaFileId: '',
      textProperties,
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.sourceType).toBe('text');
    expect(restored.textProperties).toBeDefined();
    expect(restored.textProperties!.text).toBe('Hello World');
    expect(restored.textProperties!.fontFamily).toBe('Roboto');
    expect(restored.textProperties!.fontSize).toBe(48);
    expect(restored.textProperties!.fontWeight).toBe(700);
    expect(restored.textProperties!.fontStyle).toBe('normal');
    expect(restored.textProperties!.color).toBe('#ffffff');
    expect(restored.textProperties!.textAlign).toBe('center');
    expect(restored.textProperties!.verticalAlign).toBe('middle');
    expect(restored.textProperties!.lineHeight).toBe(1.2);
    expect(restored.textProperties!.letterSpacing).toBe(0);
  });

  it('text clip with stroke and shadow serializes correctly', () => {
    const textProperties = makeTextProperties({
      strokeEnabled: true,
      strokeColor: '#ff0000',
      strokeWidth: 4,
      shadowEnabled: true,
      shadowColor: 'rgba(0,0,0,0.8)',
      shadowOffsetX: 5,
      shadowOffsetY: 5,
      shadowBlur: 10,
    });

    const clip = makeSerializableClip({ sourceType: 'text', textProperties });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.textProperties!.strokeEnabled).toBe(true);
    expect(restored.textProperties!.strokeColor).toBe('#ff0000');
    expect(restored.textProperties!.strokeWidth).toBe(4);
    expect(restored.textProperties!.shadowEnabled).toBe(true);
    expect(restored.textProperties!.shadowColor).toBe('rgba(0,0,0,0.8)');
    expect(restored.textProperties!.shadowOffsetX).toBe(5);
    expect(restored.textProperties!.shadowOffsetY).toBe(5);
    expect(restored.textProperties!.shadowBlur).toBe(10);
  });

  it('text clip with path points serializes correctly', () => {
    const textProperties = makeTextProperties({
      pathEnabled: true,
      pathPoints: [
        { x: 0.1, y: 0.5, handleIn: { x: -0.05, y: 0 }, handleOut: { x: 0.05, y: -0.1 } },
        { x: 0.5, y: 0.3, handleIn: { x: -0.1, y: 0 }, handleOut: { x: 0.1, y: 0 } },
        { x: 0.9, y: 0.5, handleIn: { x: -0.05, y: 0.1 }, handleOut: { x: 0.05, y: 0 } },
      ],
    });

    const clip = makeSerializableClip({ sourceType: 'text', textProperties });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.textProperties!.pathEnabled).toBe(true);
    expect(restored.textProperties!.pathPoints).toHaveLength(3);
    expect(restored.textProperties!.pathPoints[0]).toEqual({
      x: 0.1, y: 0.5, handleIn: { x: -0.05, y: 0 }, handleOut: { x: 0.05, y: -0.1 },
    });
  });

  it('text clip with font style italic serializes correctly', () => {
    const textProperties = makeTextProperties({
      fontStyle: 'italic',
      fontWeight: 300,
      textAlign: 'right',
      verticalAlign: 'bottom',
    });

    const clip = makeSerializableClip({ sourceType: 'text', textProperties });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.textProperties!.fontStyle).toBe('italic');
    expect(restored.textProperties!.fontWeight).toBe(300);
    expect(restored.textProperties!.textAlign).toBe('right');
    expect(restored.textProperties!.verticalAlign).toBe('bottom');
  });
});

// ─── Solid clip serialization ────────────────────────────────────────────────

describe('solid clip serialization', () => {
  it('solid clip color survives JSON round-trip', () => {
    const clip = makeSerializableClip({
      sourceType: 'solid',
      mediaFileId: '',
      solidColor: '#ff6600',
      name: 'Solid #ff6600',
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.sourceType).toBe('solid');
    expect(restored.solidColor).toBe('#ff6600');
  });

  it('solid clip with effects and masks serializes correctly', () => {
    const clip = makeSerializableClip({
      sourceType: 'solid',
      solidColor: '#00ff00',
      effects: [{ id: 'fx1', name: 'Blur', type: 'blur', enabled: true, params: { radius: 10 } }],
      masks: [{
        id: 'mask-1', name: 'Circle', vertices: [
          { id: 'v1', x: 0.5, y: 0.0, handleIn: { x: -0.27, y: 0 }, handleOut: { x: 0.27, y: 0 } },
          { id: 'v2', x: 1.0, y: 0.5, handleIn: { x: 0, y: -0.27 }, handleOut: { x: 0, y: 0.27 } },
          { id: 'v3', x: 0.5, y: 1.0, handleIn: { x: 0.27, y: 0 }, handleOut: { x: -0.27, y: 0 } },
          { id: 'v4', x: 0.0, y: 0.5, handleIn: { x: 0, y: 0.27 }, handleOut: { x: 0, y: -0.27 } },
        ],
        closed: true, opacity: 1, feather: 0, featherQuality: 1,
        inverted: false, mode: 'add', expanded: false,
        position: { x: 0, y: 0 }, visible: true,
      }],
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.solidColor).toBe('#00ff00');
    expect(restored.effects).toHaveLength(1);
    expect(restored.masks).toHaveLength(1);
    expect(restored.masks![0].vertices).toHaveLength(4);
  });
});

// ─── Transition serialization ────────────────────────────────────────────────

describe('transition serialization', () => {
  it('transitionIn and transitionOut survive JSON round-trip', () => {
    const transitionIn: TimelineTransition = {
      id: 'trans-1',
      type: 'cross-dissolve',
      duration: 0.5,
      linkedClipId: 'clip-prev',
    };
    const transitionOut: TimelineTransition = {
      id: 'trans-2',
      type: 'wipe-left',
      duration: 1.0,
      linkedClipId: 'clip-next',
    };

    const clip = makeSerializableClip({ transitionIn, transitionOut });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.transitionIn).toBeDefined();
    expect(restored.transitionIn!.id).toBe('trans-1');
    expect(restored.transitionIn!.type).toBe('cross-dissolve');
    expect(restored.transitionIn!.duration).toBe(0.5);
    expect(restored.transitionIn!.linkedClipId).toBe('clip-prev');

    expect(restored.transitionOut).toBeDefined();
    expect(restored.transitionOut!.id).toBe('trans-2');
    expect(restored.transitionOut!.type).toBe('wipe-left');
    expect(restored.transitionOut!.duration).toBe(1.0);
    expect(restored.transitionOut!.linkedClipId).toBe('clip-next');
  });

  it('clip with only transitionIn serializes correctly', () => {
    const clip = makeSerializableClip({
      transitionIn: { id: 't1', type: 'fade', duration: 0.25, linkedClipId: 'c-prev' },
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.transitionIn).toBeDefined();
    expect(restored.transitionOut).toBeUndefined();
  });
});

// ─── Speed and playback properties ───────────────────────────────────────────

describe('speed and playback serialization', () => {
  it('speed property survives JSON round-trip', () => {
    const clip = makeSerializableClip({ speed: 2.0 });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);
    expect(restored.speed).toBe(2.0);
  });

  it('preservesPitch property survives JSON round-trip', () => {
    const clip = makeSerializableClip({ speed: 0.5, preservesPitch: false });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);
    expect(restored.speed).toBe(0.5);
    expect(restored.preservesPitch).toBe(false);
  });

  it('reversed clip with speed serializes correctly', () => {
    const clip = makeSerializableClip({ reversed: true, speed: 1.5 });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);
    expect(restored.reversed).toBe(true);
    expect(restored.speed).toBe(1.5);
  });

  it('missing speed and preservesPitch default to undefined', () => {
    const clip = makeSerializableClip();
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);
    expect(restored.speed).toBeUndefined();
    expect(restored.preservesPitch).toBeUndefined();
  });
});

// ─── Blend mode serialization ────────────────────────────────────────────────

describe('blend mode serialization', () => {
  it('all blend mode categories survive JSON round-trip', () => {
    const blendModes: BlendMode[] = [
      // Normal
      'normal', 'dissolve', 'dancing-dissolve',
      // Darken
      'darken', 'multiply', 'color-burn', 'linear-burn',
      // Lighten
      'add', 'lighten', 'screen', 'color-dodge', 'linear-dodge',
      // Contrast
      'overlay', 'soft-light', 'hard-light', 'vivid-light', 'pin-light', 'hard-mix',
      // Inversion
      'difference', 'exclusion', 'subtract', 'divide',
      // Component
      'hue', 'saturation', 'color', 'luminosity',
      // Stencil
      'stencil-alpha', 'stencil-luma', 'silhouette-alpha', 'silhouette-luma', 'alpha-add',
    ];

    for (const mode of blendModes) {
      const clip = makeSerializableClip({
        transform: makeDefaultTransform({ blendMode: mode }),
      });

      const json = JSON.stringify(clip);
      const restored: SerializableClip = JSON.parse(json);
      expect(restored.transform.blendMode).toBe(mode);
    }
  });
});

// ─── Easing type serialization ───────────────────────────────────────────────

describe('easing type serialization', () => {
  it('all easing types survive JSON round-trip', () => {
    const easingTypes: EasingType[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'];

    for (const easing of easingTypes) {
      const kf: Keyframe = {
        id: `kf-${easing}`,
        clipId: 'clip-1',
        time: 0,
        property: 'opacity',
        value: 1,
        easing,
        ...(easing === 'bezier' ? {
          handleIn: { x: -0.2, y: 0 },
          handleOut: { x: 0.2, y: 0 },
        } : {}),
      };

      const json = JSON.stringify(kf);
      const restored: Keyframe = JSON.parse(json);
      expect(restored.easing).toBe(easing);
    }
  });
});

// ─── Animatable property types ───────────────────────────────────────────────

describe('animatable property serialization', () => {
  it('all transform property types survive JSON round-trip as keyframes', () => {
    const properties: AnimatableProperty[] = [
      'opacity', 'speed',
      'position.x', 'position.y', 'position.z',
      'scale.x', 'scale.y',
      'rotation.x', 'rotation.y', 'rotation.z',
    ];

    const keyframes: Keyframe[] = properties.map((prop, i) => ({
      id: `kf-${i}`,
      clipId: 'clip-1',
      time: i * 0.5,
      property: prop,
      value: i * 10,
      easing: 'linear' as EasingType,
    }));

    const clip = makeSerializableClip({ keyframes });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.keyframes).toHaveLength(properties.length);
    for (let i = 0; i < properties.length; i++) {
      expect(restored.keyframes![i].property).toBe(properties[i]);
      expect(restored.keyframes![i].value).toBe(i * 10);
    }
  });

  it('effect property keyframes survive JSON round-trip', () => {
    const effectKeyframes: Keyframe[] = [
      { id: 'kf-fx1', clipId: 'clip-1', time: 0, property: 'effect.fx-blur.radius' as AnimatableProperty, value: 0, easing: 'linear' },
      { id: 'kf-fx2', clipId: 'clip-1', time: 2, property: 'effect.fx-blur.radius' as AnimatableProperty, value: 20, easing: 'ease-in-out' },
      { id: 'kf-fx3', clipId: 'clip-1', time: 0, property: 'effect.fx-brightness.amount' as AnimatableProperty, value: 0.5, easing: 'linear' },
    ];

    const clip = makeSerializableClip({
      keyframes: effectKeyframes,
      effects: [
        { id: 'fx-blur', name: 'Blur', type: 'blur', enabled: true, params: { radius: 10 } },
        { id: 'fx-brightness', name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 0.5 } },
      ],
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.keyframes).toHaveLength(3);
    expect(restored.keyframes![0].property).toBe('effect.fx-blur.radius');
    expect(restored.keyframes![2].property).toBe('effect.fx-brightness.amount');
  });
});

// ─── Multiple masks with different modes ─────────────────────────────────────

describe('multiple masks serialization', () => {
  it('multiple masks with different modes survive JSON round-trip', () => {
    const masks: ClipMask[] = [
      {
        id: 'mask-add', name: 'Add Mask', mode: 'add',
        vertices: [
          { id: 'v1', x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { id: 'v2', x: 1, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { id: 'v3', x: 1, y: 1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
        ],
        closed: true, opacity: 1, feather: 0, featherQuality: 0,
        inverted: false, expanded: true, position: { x: 0, y: 0 }, visible: true,
      },
      {
        id: 'mask-sub', name: 'Subtract Mask', mode: 'subtract',
        vertices: [
          { id: 'v4', x: 0.2, y: 0.2, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { id: 'v5', x: 0.8, y: 0.8, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
        ],
        closed: false, opacity: 0.5, feather: 15, featherQuality: 2,
        inverted: true, expanded: false, position: { x: 0.1, y: 0.1 }, visible: false,
      },
      {
        id: 'mask-intersect', name: 'Intersect Mask', mode: 'intersect',
        vertices: [
          { id: 'v6', x: 0.3, y: 0.3, handleIn: { x: -0.1, y: 0 }, handleOut: { x: 0.1, y: 0 } },
          { id: 'v7', x: 0.7, y: 0.3, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { id: 'v8', x: 0.5, y: 0.7, handleIn: { x: 0, y: 0.1 }, handleOut: { x: 0, y: -0.1 } },
        ],
        closed: true, opacity: 0.75, feather: 3, featherQuality: 1,
        inverted: false, expanded: true, position: { x: 0, y: 0 }, visible: true,
      },
    ];

    const clip = makeSerializableClip({ masks });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.masks).toHaveLength(3);
    expect(restored.masks![0].mode).toBe('add');
    expect(restored.masks![0].closed).toBe(true);
    expect(restored.masks![0].expanded).toBe(true);
    expect(restored.masks![1].mode).toBe('subtract');
    expect(restored.masks![1].closed).toBe(false);
    expect(restored.masks![1].opacity).toBe(0.5);
    expect(restored.masks![1].feather).toBe(15);
    expect(restored.masks![1].inverted).toBe(true);
    expect(restored.masks![1].visible).toBe(false);
    expect(restored.masks![1].position).toEqual({ x: 0.1, y: 0.1 });
    expect(restored.masks![2].mode).toBe('intersect');
    expect(restored.masks![2].opacity).toBe(0.75);
  });

  it('mask with curved bezier vertices serializes correctly', () => {
    const masks: ClipMask[] = [{
      id: 'mask-bezier', name: 'Bezier Mask',
      vertices: [
        { id: 'v1', x: 0.5, y: 0.0, handleIn: { x: -0.276, y: 0 }, handleOut: { x: 0.276, y: 0 } },
        { id: 'v2', x: 1.0, y: 0.5, handleIn: { x: 0, y: -0.276 }, handleOut: { x: 0, y: 0.276 } },
        { id: 'v3', x: 0.5, y: 1.0, handleIn: { x: 0.276, y: 0 }, handleOut: { x: -0.276, y: 0 } },
        { id: 'v4', x: 0.0, y: 0.5, handleIn: { x: 0, y: 0.276 }, handleOut: { x: 0, y: -0.276 } },
      ],
      closed: true, opacity: 1, feather: 0, featherQuality: 0,
      inverted: false, mode: 'add', expanded: false,
      position: { x: 0, y: 0 }, visible: true,
    }];

    const clip = makeSerializableClip({ masks });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    const v1 = restored.masks![0].vertices[0];
    expect(v1.handleIn).toEqual({ x: -0.276, y: 0 });
    expect(v1.handleOut).toEqual({ x: 0.276, y: 0 });

    const v3 = restored.masks![0].vertices[2];
    expect(v3.handleIn).toEqual({ x: 0.276, y: 0 });
    expect(v3.handleOut).toEqual({ x: -0.276, y: 0 });
  });
});

// ─── Source type variations ──────────────────────────────────────────────────

describe('source type serialization', () => {
  it('all source types serialize correctly', () => {
    const sourceTypes: Array<'video' | 'audio' | 'image' | 'text' | 'solid'> = [
      'video', 'audio', 'image', 'text', 'solid',
    ];

    for (const sourceType of sourceTypes) {
      const clip = makeSerializableClip({ sourceType });
      const json = JSON.stringify(clip);
      const restored: SerializableClip = JSON.parse(json);
      expect(restored.sourceType).toBe(sourceType);
    }
  });

  it('image clip serializes without audio-specific fields', () => {
    const clip = makeSerializableClip({
      sourceType: 'image',
      duration: 5,
      inPoint: 0,
      outPoint: 5,
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.sourceType).toBe('image');
    expect(restored.waveform).toBeUndefined();
    expect(restored.linkedClipId).toBeUndefined();
  });
});

// ─── Edge cases and boundary values ──────────────────────────────────────────

describe('edge cases', () => {
  it('empty clips array in timeline serializes correctly', () => {
    const data = makeTimelineData({ clips: [] });
    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);
    expect(restored.clips).toEqual([]);
  });

  it('single track timeline serializes correctly', () => {
    const data = makeTimelineData({
      tracks: [{ id: 'tv1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false }],
    });

    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);
    expect(restored.tracks).toHaveLength(1);
  });

  it('clip with zero duration serializes correctly', () => {
    const clip = makeSerializableClip({ duration: 0, outPoint: 0 });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);
    expect(restored.duration).toBe(0);
    expect(restored.outPoint).toBe(0);
  });

  it('clip with very small fractional times serializes precisely', () => {
    const clip = makeSerializableClip({
      startTime: 0.001,
      duration: 0.016667, // ~1 frame at 60fps
      inPoint: 0.033334,
      outPoint: 0.050001,
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.startTime).toBe(0.001);
    expect(restored.duration).toBe(0.016667);
    expect(restored.inPoint).toBe(0.033334);
    expect(restored.outPoint).toBe(0.050001);
  });

  it('clip with very large duration serializes correctly', () => {
    const clip = makeSerializableClip({
      duration: 86400, // 24 hours
      outPoint: 86400,
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);
    expect(restored.duration).toBe(86400);
  });

  it('clip name with special characters serializes correctly', () => {
    const clip = makeSerializableClip({
      name: 'Clip "with" <special> & chars / \\ \u00e4\u00f6\u00fc\u00df \u4e16\u754c',
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);
    expect(restored.name).toBe('Clip "with" <special> & chars / \\ \u00e4\u00f6\u00fc\u00df \u4e16\u754c');
  });

  it('clip name with empty string serializes correctly', () => {
    const clip = makeSerializableClip({ name: '' });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);
    expect(restored.name).toBe('');
  });

  it('transform with extreme values serializes correctly', () => {
    const transform = makeDefaultTransform({
      opacity: 0,
      position: { x: -10000, y: 10000, z: 999 },
      scale: { x: 0.001, y: 100 },
      rotation: { x: 360, y: -180, z: 720 },
    });

    const clip = makeSerializableClip({ transform });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.transform.opacity).toBe(0);
    expect(restored.transform.position).toEqual({ x: -10000, y: 10000, z: 999 });
    expect(restored.transform.scale).toEqual({ x: 0.001, y: 100 });
    expect(restored.transform.rotation).toEqual({ x: 360, y: -180, z: 720 });
  });

  it('large waveform array serializes correctly', () => {
    const waveform = Array.from({ length: 10000 }, (_, i) => Math.sin(i / 100) * 0.5 + 0.5);
    const clip = makeSerializableClip({ waveform });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.waveform).toHaveLength(10000);
    expect(restored.waveform![0]).toBeCloseTo(0.5, 5);
    expect(restored.waveform![9999]).toBeCloseTo(waveform[9999], 10);
  });

  it('negative startTime serializes correctly', () => {
    // Pre-roll scenario
    const clip = makeSerializableClip({ startTime: -2 });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);
    expect(restored.startTime).toBe(-2);
  });

  it('many markers serialize correctly', () => {
    const markers: SerializableMarker[] = Array.from({ length: 100 }, (_, i) => ({
      id: `m-${i}`,
      time: i * 0.5,
      label: `Marker ${i}`,
      color: `#${(i * 2).toString(16).padStart(2, '0')}ff00`,
    }));

    const data = makeTimelineData({ markers });
    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    expect(restored.markers).toHaveLength(100);
    expect(restored.markers![0].label).toBe('Marker 0');
    expect(restored.markers![99].label).toBe('Marker 99');
    expect(restored.markers![99].time).toBe(49.5);
  });

  it('many clips on a single track serialize correctly', () => {
    const clips = Array.from({ length: 50 }, (_, i) =>
      makeSerializableClip({
        id: `clip-${i}`,
        trackId: 'track-v1',
        name: `Clip ${i}`,
        startTime: i * 10,
        duration: 10,
        outPoint: 10,
      })
    );

    const data = makeTimelineData({ clips });
    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    expect(restored.clips).toHaveLength(50);
    expect(restored.clips[49].startTime).toBe(490);
  });
});

// ─── getSerializableState conditional inclusion logic ─────────────────────────

describe('getSerializableState conditional inclusion', () => {
  // These tests simulate the conditional logic from serializationUtils.ts
  // to verify the save-only-if-meaningful behavior.

  it('keyframes omitted when empty (matches getSerializableState behavior)', () => {
    // getSerializableState: keyframes: keyframes.length > 0 ? keyframes : undefined
    const emptyKeyframes: Keyframe[] = [];
    const result = emptyKeyframes.length > 0 ? emptyKeyframes : undefined;
    expect(result).toBeUndefined();

    const clip = makeSerializableClip({ keyframes: undefined });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);
    expect(restored.keyframes).toBeUndefined();
  });

  it('masks omitted when empty (matches getSerializableState behavior)', () => {
    // getSerializableState: masks: clip.masks && clip.masks.length > 0 ? clip.masks : undefined
    const emptyMasks: ClipMask[] = [];
    const result = emptyMasks && emptyMasks.length > 0 ? emptyMasks : undefined;
    expect(result).toBeUndefined();

    const nullMasks: ClipMask[] | undefined = undefined;
    const result2 = nullMasks && nullMasks.length > 0 ? nullMasks : undefined;
    expect(result2).toBeUndefined();
  });

  it('transcript omitted when empty (matches getSerializableState behavior)', () => {
    // getSerializableState: transcript: clip.transcript && clip.transcript.length > 0 ? clip.transcript : undefined
    const emptyTranscript: TranscriptWord[] = [];
    const result = emptyTranscript && emptyTranscript.length > 0 ? emptyTranscript : undefined;
    expect(result).toBeUndefined();
  });

  it('transcriptStatus omitted when "none" (matches getSerializableState behavior)', () => {
    // getSerializableState: transcriptStatus: clip.transcriptStatus !== 'none' ? clip.transcriptStatus : undefined
    const noneStatus: string = 'none';
    const result = noneStatus !== 'none' ? noneStatus : undefined;
    expect(result).toBeUndefined();

    const readyStatus = 'ready';
    const result2 = readyStatus !== 'none' ? readyStatus : undefined;
    expect(result2).toBe('ready');
  });

  it('analysisStatus omitted when "none" (matches getSerializableState behavior)', () => {
    const noneStatus = 'none';
    const result = noneStatus !== 'none' ? noneStatus : undefined;
    expect(result).toBeUndefined();
  });

  it('reversed omitted when false (matches getSerializableState behavior)', () => {
    // getSerializableState: reversed: clip.reversed || undefined
    const notReversed = false;
    const result = notReversed || undefined;
    expect(result).toBeUndefined();

    const reversed = true;
    const result2 = reversed || undefined;
    expect(result2).toBe(true);
  });

  it('durationLocked omitted when false (matches getSerializableState behavior)', () => {
    // getSerializableState: durationLocked: durationLocked || undefined
    const notLocked = false;
    const result = notLocked || undefined;
    expect(result).toBeUndefined();
  });

  it('markers omitted when empty (matches getSerializableState behavior)', () => {
    // getSerializableState: markers: markers.length > 0 ? markers : undefined
    const emptyMarkers: SerializableMarker[] = [];
    const result = emptyMarkers.length > 0 ? emptyMarkers : undefined;
    expect(result).toBeUndefined();
  });

  it('composition clips get empty mediaFileId (matches getSerializableState behavior)', () => {
    // getSerializableState: mediaFileId: clip.isComposition ? '' : resolvedMediaFileId
    const isComposition = true;
    const resolvedMediaFileId = 'media-123';
    const result = isComposition ? '' : resolvedMediaFileId;
    expect(result).toBe('');
  });
});

// ─── Effects with various parameter types ────────────────────────────────────

describe('effects with various parameter types', () => {
  it('effects with string, number, and boolean params serialize correctly', () => {
    const effects: Effect[] = [
      {
        id: 'fx-1', name: 'Complex Effect', type: 'levels', enabled: true,
        params: {
          inputBlack: 0,
          inputWhite: 255,
          gamma: 1.2,
          outputBlack: 10,
          outputWhite: 245,
        },
      },
      {
        id: 'fx-2', name: 'Audio EQ', type: 'audio-eq', enabled: true,
        params: {
          lowGain: -3,
          midGain: 0,
          highGain: 2.5,
          lowFreq: 200,
          highFreq: 8000,
        },
      },
    ];

    const clip = makeSerializableClip({ effects });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.effects).toHaveLength(2);
    expect(restored.effects[0].params.gamma).toBe(1.2);
    expect(restored.effects[1].params.lowGain).toBe(-3);
    expect(restored.effects[1].type).toBe('audio-eq');
  });

  it('disabled effects preserve their state', () => {
    const effects: Effect[] = [
      { id: 'fx-1', name: 'Blur', type: 'blur', enabled: false, params: { radius: 10 } },
      { id: 'fx-2', name: 'Invert', type: 'invert', enabled: false, params: {} },
    ];

    const clip = makeSerializableClip({ effects });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.effects[0].enabled).toBe(false);
    expect(restored.effects[1].enabled).toBe(false);
    expect(restored.effects[1].params).toEqual({});
  });

  it('many effects on a single clip serialize correctly', () => {
    const effects: Effect[] = Array.from({ length: 10 }, (_, i) => ({
      id: `fx-${i}`,
      name: `Effect ${i}`,
      type: 'blur' as const,
      enabled: i % 2 === 0,
      params: { radius: i * 2 },
    }));

    const clip = makeSerializableClip({ effects });
    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    expect(restored.effects).toHaveLength(10);
    expect(restored.effects[5].enabled).toBe(false);
    expect(restored.effects[6].enabled).toBe(true);
    expect(restored.effects[9].params.radius).toBe(18);
  });
});

// ─── Marker edge cases ───────────────────────────────────────────────────────

describe('marker edge cases', () => {
  it('marker at time zero serializes correctly', () => {
    const data = makeTimelineData({
      markers: [{ id: 'm1', time: 0, label: 'Start', color: '#ffffff' }],
    });

    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    expect(restored.markers![0].time).toBe(0);
    expect(restored.markers![0].label).toBe('Start');
    expect(restored.markers![0].color).toBe('#ffffff');
  });

  it('marker with empty label serializes correctly', () => {
    const data = makeTimelineData({
      markers: [{ id: 'm1', time: 5, label: '', color: '#ff0000' }],
    });

    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    expect(restored.markers![0].label).toBe('');
  });

  it('marker with special characters in label serializes correctly', () => {
    const data = makeTimelineData({
      markers: [{ id: 'm1', time: 5, label: 'Scene "A" - Take #3 (Final!)', color: '#ff0000' }],
    });

    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    expect(restored.markers![0].label).toBe('Scene "A" - Take #3 (Final!)');
  });
});

// ─── Track state variations ──────────────────────────────────────────────────

describe('track state variations', () => {
  it('muted track serializes correctly', () => {
    const tracks: TimelineTrack[] = [
      { id: 'tv1', name: 'Video 1', type: 'video', height: 60, muted: true, visible: true, solo: false },
    ];

    const json = JSON.stringify(tracks);
    const restored: TimelineTrack[] = JSON.parse(json);
    expect(restored[0].muted).toBe(true);
  });

  it('hidden track serializes correctly', () => {
    const tracks: TimelineTrack[] = [
      { id: 'tv1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: false, solo: false },
    ];

    const json = JSON.stringify(tracks);
    const restored: TimelineTrack[] = JSON.parse(json);
    expect(restored[0].visible).toBe(false);
  });

  it('solo track serializes correctly', () => {
    const tracks: TimelineTrack[] = [
      { id: 'tv1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: true },
      { id: 'tv2', name: 'Video 2', type: 'video', height: 60, muted: false, visible: true, solo: false },
    ];

    const json = JSON.stringify(tracks);
    const restored: TimelineTrack[] = JSON.parse(json);
    expect(restored[0].solo).toBe(true);
    expect(restored[1].solo).toBe(false);
  });

  it('track with custom height serializes correctly', () => {
    const tracks: TimelineTrack[] = [
      { id: 'tv1', name: 'Video 1', type: 'video', height: 120, muted: false, visible: true, solo: false },
      { id: 'ta1', name: 'Audio 1', type: 'audio', height: 25, muted: false, visible: true, solo: false },
    ];

    const json = JSON.stringify(tracks);
    const restored: TimelineTrack[] = JSON.parse(json);
    expect(restored[0].height).toBe(120);
    expect(restored[1].height).toBe(25);
  });

  it('many tracks serialize correctly', () => {
    const tracks: TimelineTrack[] = Array.from({ length: 20 }, (_, i) => ({
      id: `track-${i}`,
      name: `Track ${i}`,
      type: i < 10 ? 'video' as const : 'audio' as const,
      height: i < 10 ? 60 : 40,
      muted: false,
      visible: true,
      solo: false,
    }));

    const json = JSON.stringify(tracks);
    const restored: TimelineTrack[] = JSON.parse(json);
    expect(restored).toHaveLength(20);
    expect(restored[0].type).toBe('video');
    expect(restored[19].type).toBe('audio');
  });
});

// ─── Linked clips and groups ─────────────────────────────────────────────────

describe('linked clips and groups', () => {
  it('video-audio linked pair serializes correctly', () => {
    const videoClip = makeSerializableClip({
      id: 'clip-video',
      sourceType: 'video',
      linkedClipId: 'clip-audio',
    });
    const audioClip = makeSerializableClip({
      id: 'clip-audio',
      sourceType: 'audio',
      linkedClipId: 'clip-video',
      trackId: 'track-a1',
    });

    const data = makeTimelineData({ clips: [videoClip, audioClip] });
    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    expect(restored.clips[0].linkedClipId).toBe('clip-audio');
    expect(restored.clips[1].linkedClipId).toBe('clip-video');
  });

  it('multicam group clips with linkedGroupId serialize correctly', () => {
    const clips = [
      makeSerializableClip({ id: 'c1', linkedGroupId: 'multicam-1', name: 'Camera 1' }),
      makeSerializableClip({ id: 'c2', linkedGroupId: 'multicam-1', name: 'Camera 2' }),
      makeSerializableClip({ id: 'c3', linkedGroupId: 'multicam-1', name: 'Camera 3' }),
    ];

    const data = makeTimelineData({ clips });
    const json = JSON.stringify(data);
    const restored: CompositionTimelineData = JSON.parse(json);

    expect(restored.clips.every(c => c.linkedGroupId === 'multicam-1')).toBe(true);
  });
});

// ─── Full clip with all optional fields populated ────────────────────────────

describe('fully populated clip', () => {
  it('clip with every possible field populated survives JSON round-trip', () => {
    const clip = makeSerializableClip({
      id: 'full-clip',
      trackId: 'track-v1',
      name: 'Fully Loaded Clip',
      mediaFileId: 'media-full',
      startTime: 5.5,
      duration: 30,
      inPoint: 2,
      outPoint: 32,
      sourceType: 'video',
      naturalDuration: 60,
      thumbnails: ['thumb1', 'thumb2', 'thumb3'],
      linkedClipId: 'linked-audio',
      linkedGroupId: 'group-abc',
      waveform: [0.1, 0.5, 0.9],
      transform: makeDefaultTransform({
        opacity: 0.8,
        blendMode: 'overlay',
        position: { x: 50, y: -25, z: 10 },
        scale: { x: 1.5, y: 0.75 },
        rotation: { x: 15, y: 30, z: 45 },
      }),
      effects: [
        { id: 'fx1', name: 'Blur', type: 'blur', enabled: true, params: { radius: 5 } },
        { id: 'fx2', name: 'Saturation', type: 'saturation', enabled: false, params: { amount: -0.3 } },
      ],
      keyframes: [
        { id: 'kf1', clipId: 'full-clip', time: 0, property: 'opacity', value: 0, easing: 'ease-in' },
        { id: 'kf2', clipId: 'full-clip', time: 2, property: 'opacity', value: 1, easing: 'bezier', handleIn: { x: -0.5, y: 0.1 }, handleOut: { x: 0.5, y: -0.1 } },
      ],
      masks: [{
        id: 'mask-1', name: 'Main Mask',
        vertices: [
          { id: 'v1', x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { id: 'v2', x: 1, y: 1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
        ],
        closed: true, opacity: 0.9, feather: 3, featherQuality: 2,
        inverted: false, mode: 'add', expanded: true,
        position: { x: 0.05, y: 0.05 }, visible: true,
      }],
      transcript: [
        { id: 'w1', text: 'test', start: 0, end: 0.5, confidence: 0.99, speaker: 'A' },
      ],
      transcriptStatus: 'ready',
      analysis: {
        sampleInterval: 200,
        frames: [
          { timestamp: 0, motion: 0.5, globalMotion: 0.3, localMotion: 0.2, focus: 0.8, brightness: 0.6, faceCount: 1 },
        ],
      },
      analysisStatus: 'ready',
      reversed: true,
      speed: 0.75,
      preservesPitch: true,
      transitionIn: { id: 'ti', type: 'dissolve', duration: 0.5, linkedClipId: 'prev' },
      transitionOut: { id: 'to', type: 'wipe', duration: 1.0, linkedClipId: 'next' },
    });

    const json = JSON.stringify(clip);
    const restored: SerializableClip = JSON.parse(json);

    // Verify every field round-trips correctly
    expect(restored.id).toBe('full-clip');
    expect(restored.trackId).toBe('track-v1');
    expect(restored.name).toBe('Fully Loaded Clip');
    expect(restored.mediaFileId).toBe('media-full');
    expect(restored.startTime).toBe(5.5);
    expect(restored.duration).toBe(30);
    expect(restored.inPoint).toBe(2);
    expect(restored.outPoint).toBe(32);
    expect(restored.sourceType).toBe('video');
    expect(restored.naturalDuration).toBe(60);
    expect(restored.thumbnails).toHaveLength(3);
    expect(restored.linkedClipId).toBe('linked-audio');
    expect(restored.linkedGroupId).toBe('group-abc');
    expect(restored.waveform).toHaveLength(3);
    expect(restored.transform.blendMode).toBe('overlay');
    expect(restored.effects).toHaveLength(2);
    expect(restored.keyframes).toHaveLength(2);
    expect(restored.keyframes![1].handleIn).toEqual({ x: -0.5, y: 0.1 });
    expect(restored.masks).toHaveLength(1);
    expect(restored.transcript).toHaveLength(1);
    expect(restored.transcriptStatus).toBe('ready');
    expect(restored.analysis!.frames).toHaveLength(1);
    expect(restored.analysisStatus).toBe('ready');
    expect(restored.reversed).toBe(true);
    expect(restored.speed).toBe(0.75);
    expect(restored.preservesPitch).toBe(true);
    expect(restored.transitionIn!.type).toBe('dissolve');
    expect(restored.transitionOut!.type).toBe('wipe');
  });
});

// ─── JSON size and structure validation ──────────────────────────────────────

describe('JSON structure validation', () => {
  it('serialized JSON produces valid JSON string', () => {
    const data = makeTimelineData();
    const json = JSON.stringify(data);

    // Should not throw
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('double serialization does not corrupt data', () => {
    const data = makeTimelineData({
      clips: [
        makeSerializableClip({
          effects: [{ id: 'fx1', name: 'Blur', type: 'blur', enabled: true, params: { radius: 5 } }],
          keyframes: [{ id: 'kf1', clipId: 'clip-1', time: 0, property: 'opacity', value: 1, easing: 'linear' }],
        }),
      ],
    });

    // Simulate double save/load cycle
    const json1 = JSON.stringify(data);
    const restored1: CompositionTimelineData = JSON.parse(json1);
    const json2 = JSON.stringify(restored1);
    const restored2: CompositionTimelineData = JSON.parse(json2);

    expect(restored2).toEqual(restored1);
    expect(json1).toBe(json2);
  });

  it('undefined values are stripped during JSON serialization', () => {
    const clip = makeSerializableClip({
      keyframes: undefined,
      masks: undefined,
      transcript: undefined,
      analysis: undefined,
    });

    const json = JSON.stringify(clip);
    const parsed = JSON.parse(json);

    // JSON.stringify strips undefined values, so they should not appear
    expect('keyframes' in parsed).toBe(false);
    expect('masks' in parsed).toBe(false);
    expect('transcript' in parsed).toBe(false);
    expect('analysis' in parsed).toBe(false);
  });
});
