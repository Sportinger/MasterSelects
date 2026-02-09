import type { TimelineClip, TimelineTrack, Keyframe, ClipTransform, AnimatableProperty, EasingType, BezierHandle } from '../../src/types';

let idCounter = 0;
function uid(prefix = 'test') {
  return `${prefix}_${++idCounter}`;
}

export function resetIdCounter() {
  idCounter = 0;
}

export function createMockTransform(overrides?: Partial<ClipTransform>): ClipTransform {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

export function createMockClip(overrides?: Partial<TimelineClip>): TimelineClip {
  const id = overrides?.id ?? uid('clip');
  return {
    id,
    trackId: 'video-1',
    name: `Clip ${id}`,
    file: new File([], 'test.mp4'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: null,
    transform: createMockTransform(),
    effects: [],
    ...overrides,
  };
}

export function createMockTrack(overrides?: Partial<TimelineTrack>): TimelineTrack {
  const id = overrides?.id ?? uid('track');
  return {
    id,
    name: `Track ${id}`,
    type: 'video',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
    ...overrides,
  };
}

export function createMockKeyframe(overrides?: Partial<Keyframe>): Keyframe {
  return {
    id: uid('kf'),
    clipId: 'clip_1',
    time: 0,
    property: 'opacity' as AnimatableProperty,
    value: 1,
    easing: 'linear' as EasingType,
    ...overrides,
  };
}
