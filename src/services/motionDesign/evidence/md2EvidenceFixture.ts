import type { AnimatableProperty, EasingType } from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import type { MotionLayerDefinition } from '../../../types/motionDesign';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import type { Composition } from '../../../stores/mediaStore/types';

export const MD2_EVIDENCE_FIXTURE_ID = 'motion-design-md2-authoring-animation-v1';
export const MD2_EVIDENCE_WIDTH = 640;
export const MD2_EVIDENCE_HEIGHT = 360;
export const MD2_EVIDENCE_DURATION_SECONDS = 2;
export const MD2_EVIDENCE_SAMPLE_TIME_SECONDS = 0.32;

export const MD2_EVIDENCE_SURFACES = [
  'direct-preview',
  'direct-export',
  'nested-preview',
  'nested-export',
  'global-graph',
  'motion-path-overlay',
] as const;

export type Md2EvidenceSurface = (typeof MD2_EVIDENCE_SURFACES)[number];

export const MD2_EVIDENCE_IDS = {
  compositionId: 'md2-evidence-direct-composition',
  trackId: 'md2-evidence-direct-track',
  clipId: 'md2-evidence-lower-third',
  nestedCompositionId: 'md2-evidence-nested-composition',
  nestedTrackId: 'md2-evidence-nested-track',
  nestedClipId: 'md2-evidence-nested-lower-third',
  nestedWrapperTrackId: 'md2-evidence-wrapper-track',
  nestedWrapperClipId: 'md2-evidence-nested-wrapper',
} as const;

export interface Md2EvidenceSequenceEntry {
  readonly property: Extract<AnimatableProperty, 'position.x' | 'position.y' | 'opacity'>;
  readonly time: number;
  readonly value: number;
  readonly easing: EasingType;
}

export interface Md2EvidenceFixture {
  readonly id: typeof MD2_EVIDENCE_FIXTURE_ID;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly sampleTime: number;
  readonly surfaces: typeof MD2_EVIDENCE_SURFACES;
  readonly ids: typeof MD2_EVIDENCE_IDS;
  readonly tracks: TimelineTrack[];
  readonly clips: TimelineClip[];
  readonly keyframes: Map<string, Keyframe[]>;
  readonly nestedTracks: TimelineTrack[];
  readonly nestedClips: TimelineClip[];
  readonly nestedWrapperClip: TimelineClip;
  readonly directComposition: Composition;
  readonly nestedComposition: Composition;
  readonly expectedSequence: readonly Md2EvidenceSequenceEntry[];
}

const FINAL_POSITION = { x: 0, y: 108 } as const;
const START_POSITION = { x: -420, y: FINAL_POSITION.y } as const;
const OVERSHOOT_POSITION = { x: 28, y: FINAL_POSITION.y } as const;

const SEQUENCE_PHASES = [
  { time: 0, position: START_POSITION, opacity: 0, easing: 'ease-out' },
  { time: 0.32, position: OVERSHOOT_POSITION, opacity: 1, easing: 'ease-in-out' },
  { time: 0.48, position: FINAL_POSITION, opacity: 1, easing: 'ease-in-out' },
  { time: 1.2, position: FINAL_POSITION, opacity: 1, easing: 'linear' },
  { time: 1.6, position: FINAL_POSITION, opacity: 1, easing: 'linear' },
] as const satisfies readonly {
  time: number;
  position: { x: number; y: number };
  opacity: number;
  easing: EasingType;
}[];

function createExpectedSequence(): Md2EvidenceSequenceEntry[] {
  return SEQUENCE_PHASES.flatMap((phase) => [
    {
      property: 'position.x',
      time: phase.time,
      value: phase.position.x,
      easing: phase.easing,
    },
    {
      property: 'position.y',
      time: phase.time,
      value: phase.position.y,
      easing: phase.easing,
    },
    {
      property: 'opacity',
      time: phase.time,
      value: phase.opacity,
      easing: phase.easing,
    },
  ]);
}

function createTrack(id: string, name: string): TimelineTrack {
  return {
    id,
    name,
    type: 'video',
    height: 70,
    muted: false,
    visible: true,
    solo: false,
    locked: false,
  };
}

function createDefaultTransform(): TimelineClip['transform'] {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function createLowerThirdMotion(): MotionLayerDefinition {
  return {
    version: 1,
    kind: 'shape',
    shape: {
      primitive: 'rectangle',
      size: { w: 432, h: 88 },
      cornerRadius: 18,
    },
    appearance: {
      version: 1,
      selectedItemId: 'md2-evidence-fill',
      items: [
        {
          id: 'md2-evidence-fill',
          kind: 'color-fill',
          name: 'Lower-third fill',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          color: { r: 0.035, g: 0.075, b: 0.14, a: 0.94 },
        },
        {
          id: 'md2-evidence-accent',
          kind: 'linear-gradient',
          name: 'Lower-third accent',
          visible: true,
          opacity: 0.88,
          blendMode: 'screen',
          start: { x: 0, y: 0.5 },
          end: { x: 1, y: 0.5 },
          stops: [
            { id: 'md2-evidence-stop-a', offset: 0, color: { r: 0.02, g: 0.72, b: 1, a: 1 } },
            { id: 'md2-evidence-stop-b', offset: 1, color: { r: 0.65, g: 0.16, b: 0.98, a: 1 } },
          ],
        },
        {
          id: 'md2-evidence-stroke',
          kind: 'stroke',
          name: 'Lower-third edge',
          visible: true,
          opacity: 0.78,
          blendMode: 'screen',
          color: { r: 0.82, g: 0.94, b: 1, a: 1 },
          width: 3,
          alignment: 'inside',
        },
      ],
    },
    ui: {
      pinnedProperties: ['position.x', 'position.y', 'opacity'],
    },
  };
}

function createLowerThirdClip(
  id: string,
  trackId: string,
  name: string,
): TimelineClip {
  const motion = createLowerThirdMotion();
  return {
    id,
    trackId,
    name,
    file: new File(
      [JSON.stringify(motion)],
      `${id}.msmotion`,
      { type: 'application/json', lastModified: 0 },
    ),
    startTime: 0,
    duration: MD2_EVIDENCE_DURATION_SECONDS,
    inPoint: 0,
    outPoint: MD2_EVIDENCE_DURATION_SECONDS,
    source: {
      type: 'motion-shape',
      naturalDuration: MD2_EVIDENCE_DURATION_SECONDS,
    },
    transform: {
      ...createDefaultTransform(),
      position: {
        x: FINAL_POSITION.x / (MD2_EVIDENCE_WIDTH / 2),
        y: FINAL_POSITION.y / (MD2_EVIDENCE_HEIGHT / 2),
        z: 0,
      },
    },
    effects: [],
    masks: [],
    motion,
  };
}

export function createMd2EvidenceFixture(): Md2EvidenceFixture {
  const tracks = [createTrack(MD2_EVIDENCE_IDS.trackId, 'MD2 Lower Third')];
  const clips = [createLowerThirdClip(
    MD2_EVIDENCE_IDS.clipId,
    MD2_EVIDENCE_IDS.trackId,
    'MD2 Animated Lower Third',
  )];
  const nestedTracks = [createTrack(MD2_EVIDENCE_IDS.nestedTrackId, 'MD2 Nested Lower Third')];
  const nestedClips = [createLowerThirdClip(
    MD2_EVIDENCE_IDS.nestedClipId,
    MD2_EVIDENCE_IDS.nestedTrackId,
    'MD2 Nested Animated Lower Third',
  )];
  const nestedWrapperClip: TimelineClip = {
    id: MD2_EVIDENCE_IDS.nestedWrapperClipId,
    trackId: MD2_EVIDENCE_IDS.nestedWrapperTrackId,
    name: 'MD2 Nested Composition',
    file: new File([], 'md2-evidence-nested.mscomp', {
      type: 'application/json',
      lastModified: 0,
    }),
    startTime: 0,
    duration: MD2_EVIDENCE_DURATION_SECONDS,
    inPoint: 0,
    outPoint: MD2_EVIDENCE_DURATION_SECONDS,
    source: { type: 'video', naturalDuration: MD2_EVIDENCE_DURATION_SECONDS },
    transform: createDefaultTransform(),
    effects: [],
    isComposition: true,
    compositionId: MD2_EVIDENCE_IDS.nestedCompositionId,
    nestedTracks,
    nestedClips,
  };
  const createComposition = (id: string, name: string): Composition => ({
    id,
    name,
    type: 'composition',
    parentId: null,
    createdAt: 0,
    width: MD2_EVIDENCE_WIDTH,
    height: MD2_EVIDENCE_HEIGHT,
    frameRate: 30,
    duration: MD2_EVIDENCE_DURATION_SECONDS,
    backgroundColor: '#000000',
  });
  const directComposition = createComposition(
    MD2_EVIDENCE_IDS.compositionId,
    'MD2 Evidence Direct Composition',
  );
  const nestedComposition = createComposition(
    MD2_EVIDENCE_IDS.nestedCompositionId,
    'MD2 Evidence Nested Composition',
  );

  return {
    id: MD2_EVIDENCE_FIXTURE_ID,
    width: MD2_EVIDENCE_WIDTH,
    height: MD2_EVIDENCE_HEIGHT,
    duration: MD2_EVIDENCE_DURATION_SECONDS,
    sampleTime: MD2_EVIDENCE_SAMPLE_TIME_SECONDS,
    surfaces: MD2_EVIDENCE_SURFACES,
    ids: MD2_EVIDENCE_IDS,
    tracks,
    clips,
    keyframes: new Map(),
    nestedTracks,
    nestedClips,
    nestedWrapperClip,
    directComposition,
    nestedComposition,
    expectedSequence: createExpectedSequence(),
  };
}
