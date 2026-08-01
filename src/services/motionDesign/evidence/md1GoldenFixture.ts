import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import type { ClipMask } from '../../../types/masks';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import type {
  AppearanceItem,
  AppearanceKind,
  MotionColor,
  MotionLayerDefinition,
  ShapePrimitive,
} from '../../../types/motionDesign';
import { DEFAULT_TRANSFORM } from '../../../stores/timeline/constants';
import type { Composition } from '../../../stores/mediaStore/types';

export const MD1_GOLDEN_FIXTURE_ID = 'motion-design-md1-shapes-appearances-v1';
export const MD1_GOLDEN_WIDTH = 640;
export const MD1_GOLDEN_HEIGHT = 360;
export const MD1_GOLDEN_DURATION_SECONDS = 4;
// Mid-animation: both appearance opacity and star geometry differ from their
// authored base values, so direct/nested parity cannot pass on static defaults.
export const MD1_GOLDEN_SAMPLE_TIME_SECONDS = 0.5;

export const MD1_GOLDEN_SURFACES = [
  'direct-preview',
  'direct-export',
  'nested-preview',
  'nested-export',
] as const;

export type Md1GoldenSurface = (typeof MD1_GOLDEN_SURFACES)[number];

export interface Md1GoldenCrop {
  readonly id: ShapePrimitive;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const MD1_GOLDEN_CROPS: readonly Md1GoldenCrop[] = [
  { id: 'rectangle', x: 32, y: 24, width: 272, height: 144 },
  { id: 'ellipse', x: 336, y: 24, width: 272, height: 144 },
  { id: 'polygon', x: 32, y: 192, width: 272, height: 144 },
  { id: 'star', x: 336, y: 192, width: 272, height: 144 },
] as const;

export const MD1_GOLDEN_REQUIRED_COVERAGE = {
  primitives: ['rectangle', 'ellipse', 'polygon', 'star'],
  appearanceKinds: ['color-fill', 'stroke', 'linear-gradient', 'radial-gradient'],
  signals: [
    'ordered-appearances',
    'multiple-strokes',
    'appearance-opacity',
    'appearance-blend',
    'clip-opacity',
    'clip-blend',
    'mask',
    'effect',
    'nested-composition',
    'appearance-keyframes',
  ],
} as const satisfies {
  primitives: readonly ShapePrimitive[];
  appearanceKinds: readonly AppearanceKind[];
  signals: readonly string[];
};

export interface Md1GoldenFixture {
  readonly id: typeof MD1_GOLDEN_FIXTURE_ID;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly sampleTime: number;
  readonly tracks: TimelineTrack[];
  readonly clips: TimelineClip[];
  readonly keyframes: Map<string, Keyframe[]>;
  readonly nestedTracks: TimelineTrack[];
  readonly nestedClips: TimelineClip[];
  readonly nestedWrapperClip: TimelineClip;
  readonly nestedComposition: Composition;
}

const rgba = (r: number, g: number, b: number, a = 1): MotionColor => ({ r, g, b, a });

const baseAppearance = (
  id: string,
  kind: AppearanceItem['kind'],
  name: string,
  opacity = 1,
  blendMode: AppearanceItem['blendMode'] = 'normal',
) => ({ id, kind, name, visible: true, opacity, blendMode });

function createMask(): ClipMask {
  const handle = { x: 0, y: 0 };
  return {
    id: 'md1-mask-polygon-cut',
    name: 'Polygon diagonal mask',
    closed: true,
    opacity: 0.92,
    feather: 5,
    featherQuality: 2,
    inverted: false,
    mode: 'add',
    expanded: false,
    position: { x: 0, y: 0 },
    enabled: true,
    visible: false,
    vertices: [
      { id: 'md1-mask-v1', x: 0.08, y: 0.08, handleIn: handle, handleOut: handle },
      { id: 'md1-mask-v2', x: 0.92, y: 0.18, handleIn: handle, handleOut: handle },
      { id: 'md1-mask-v3', x: 0.78, y: 0.92, handleIn: handle, handleOut: handle },
      { id: 'md1-mask-v4', x: 0.16, y: 0.82, handleIn: handle, handleOut: handle },
    ],
  };
}

function createEffect(): Effect {
  return {
    id: 'md1-effect-polygon-contrast',
    name: 'MD1 Contrast',
    type: 'contrast',
    enabled: true,
    params: { amount: 0.18 },
  };
}

function rectangleMotion(): MotionLayerDefinition {
  const items: AppearanceItem[] = [
    {
      ...baseAppearance('md1-rect-fill', 'color-fill', 'Navy base'),
      kind: 'color-fill',
      color: rgba(0.04, 0.08, 0.18),
    },
    {
      ...baseAppearance('md1-rect-gradient', 'linear-gradient', 'Cyan magenta overlay', 0.88, 'screen'),
      kind: 'linear-gradient',
      start: { x: 0, y: 0.1 },
      end: { x: 1, y: 0.9 },
      stops: [
        { id: 'md1-rect-stop-a', offset: 0, color: rgba(0.05, 0.82, 1) },
        { id: 'md1-rect-stop-b', offset: 1, color: rgba(0.92, 0.1, 0.72) },
      ],
    },
    {
      ...baseAppearance('md1-rect-stroke-wide', 'stroke', 'Dark outer stroke', 0.9, 'multiply'),
      kind: 'stroke',
      color: rgba(0.01, 0.02, 0.06),
      width: 15,
      alignment: 'outside',
    },
    {
      ...baseAppearance('md1-rect-stroke-thin', 'stroke', 'White inner stroke', 0.82, 'screen'),
      kind: 'stroke',
      color: rgba(1, 1, 1),
      width: 3,
      alignment: 'inside',
    },
  ];
  return {
    version: 1,
    kind: 'shape',
    shape: { primitive: 'rectangle', size: { w: 220, h: 106 }, cornerRadius: 24 },
    appearance: { version: 1, items, selectedItemId: 'md1-rect-gradient' },
    ui: { pinnedProperties: ['shape.cornerRadius', 'appearance.md1-rect-gradient.opacity'] },
  };
}

function ellipseMotion(): MotionLayerDefinition {
  return {
    version: 1,
    kind: 'shape',
    shape: { primitive: 'ellipse', size: { w: 190, h: 116 } },
    appearance: {
      version: 1,
      selectedItemId: 'md1-ellipse-radial',
      items: [
        {
          ...baseAppearance('md1-ellipse-radial', 'radial-gradient', 'Warm radial'),
          kind: 'radial-gradient',
          center: { x: 0.36, y: 0.3 },
          radius: 0.72,
          stops: [
            { id: 'md1-ellipse-stop-a', offset: 0, color: rgba(1, 0.94, 0.2) },
            { id: 'md1-ellipse-stop-b', offset: 0.58, color: rgba(1, 0.28, 0.08) },
            { id: 'md1-ellipse-stop-c', offset: 1, color: rgba(0.35, 0.02, 0.18) },
          ],
        },
        {
          ...baseAppearance('md1-ellipse-stroke', 'stroke', 'Ellipse rim'),
          kind: 'stroke',
          color: rgba(1, 0.78, 0.42),
          width: 8,
          alignment: 'center',
        },
      ],
    },
  };
}

function polygonMotion(): MotionLayerDefinition {
  return {
    version: 1,
    kind: 'shape',
    shape: {
      primitive: 'polygon',
      size: { w: 180, h: 120 },
      polygon: { points: 6, radius: 60, cornerRadius: 7 },
    },
    appearance: {
      version: 1,
      selectedItemId: 'md1-polygon-fill',
      items: [
        {
          ...baseAppearance('md1-polygon-fill', 'color-fill', 'Green fill', 0.92, 'normal'),
          kind: 'color-fill',
          color: rgba(0.12, 0.86, 0.46),
        },
        {
          ...baseAppearance('md1-polygon-stroke', 'stroke', 'Polygon outline', 0.86, 'overlay'),
          kind: 'stroke',
          color: rgba(0.82, 1, 0.9),
          width: 9,
          alignment: 'inside',
        },
      ],
    },
  };
}

function starMotion(): MotionLayerDefinition {
  return {
    version: 1,
    kind: 'shape',
    shape: {
      primitive: 'star',
      size: { w: 184, h: 126 },
      star: { points: 7, outerRadius: 63, innerRadius: 29, cornerRadius: 4 },
    },
    appearance: {
      version: 1,
      selectedItemId: 'md1-star-gradient',
      items: [
        {
          ...baseAppearance('md1-star-fill', 'color-fill', 'Violet base'),
          kind: 'color-fill',
          color: rgba(0.22, 0.04, 0.5),
        },
        {
          ...baseAppearance('md1-star-gradient', 'linear-gradient', 'Star sweep', 0.76, 'add'),
          kind: 'linear-gradient',
          start: { x: 0.08, y: 0.92 },
          end: { x: 0.92, y: 0.08 },
          stops: [
            { id: 'md1-star-stop-a', offset: 0, color: rgba(0.15, 0.35, 1) },
            { id: 'md1-star-stop-b', offset: 1, color: rgba(1, 0.15, 0.74) },
          ],
        },
        {
          ...baseAppearance('md1-star-stroke', 'stroke', 'Star edge'),
          kind: 'stroke',
          color: rgba(0.9, 0.82, 1),
          width: 5,
          alignment: 'center',
        },
      ],
    },
  };
}

function createTrack(id: string, name: string): TimelineTrack {
  return { id, name, type: 'video', height: 70, muted: false, visible: true, solo: false };
}

function createMotionClip(
  id: string,
  trackId: string,
  name: string,
  motion: MotionLayerDefinition,
  position: { x: number; y: number },
  options: { opacity?: number; blendMode?: TimelineClip['transform']['blendMode']; masks?: ClipMask[]; effects?: Effect[] } = {},
): TimelineClip {
  return {
    id,
    trackId,
    name,
    file: new File([JSON.stringify(motion)], `${id}.msmotion`, { type: 'application/json' }),
    startTime: 0,
    duration: MD1_GOLDEN_DURATION_SECONDS,
    inPoint: 0,
    outPoint: MD1_GOLDEN_DURATION_SECONDS,
    source: { type: 'motion-shape', naturalDuration: MD1_GOLDEN_DURATION_SECONDS },
    transform: {
      ...structuredClone(DEFAULT_TRANSFORM),
      opacity: options.opacity ?? 1,
      blendMode: options.blendMode ?? 'normal',
      position: { ...position, z: 0 },
    },
    effects: options.effects ?? [],
    masks: options.masks ?? [],
    motion,
  };
}

function createFixtureClips(): TimelineClip[] {
  return [
    createMotionClip('md1-clip-rectangle', 'md1-track-rectangle', 'MD1 Rectangle', rectangleMotion(), { x: -0.48, y: -0.45 }),
    createMotionClip('md1-clip-ellipse', 'md1-track-ellipse', 'MD1 Ellipse', ellipseMotion(), { x: 0.48, y: -0.45 }, { opacity: 0.94, blendMode: 'screen' }),
    createMotionClip('md1-clip-polygon', 'md1-track-polygon', 'MD1 Polygon', polygonMotion(), { x: -0.48, y: 0.45 }, { masks: [createMask()], effects: [createEffect()] }),
    createMotionClip('md1-clip-star', 'md1-track-star', 'MD1 Star', starMotion(), { x: 0.48, y: 0.45 }, { opacity: 0.9, blendMode: 'overlay' }),
    createMotionClip(
      'md1-clip-background',
      'md1-track-background',
      'MD1 Background',
      {
        version: 1,
        kind: 'shape',
        shape: { primitive: 'rectangle', size: { w: MD1_GOLDEN_WIDTH, h: MD1_GOLDEN_HEIGHT }, cornerRadius: 0 },
        appearance: {
          version: 1,
          selectedItemId: 'md1-background-fill',
          items: [{
            ...baseAppearance('md1-background-fill', 'color-fill', 'Evidence background'),
            kind: 'color-fill',
            color: rgba(0.055, 0.065, 0.095),
          }],
        },
      },
      { x: 0, y: 0 },
    ),
  ];
}

function createFixtureKeyframes(): Map<string, Keyframe[]> {
  return new Map([
    ['md1-clip-rectangle', [
      { id: 'md1-kf-rect-opacity-a', clipId: 'md1-clip-rectangle', time: 0, property: 'appearance.md1-rect-gradient.opacity', value: 0.3, easing: 'ease-in-out' },
      { id: 'md1-kf-rect-opacity-b', clipId: 'md1-clip-rectangle', time: 1, property: 'appearance.md1-rect-gradient.opacity', value: 0.88, easing: 'ease-in-out' },
    ]],
    ['md1-clip-star', [
      { id: 'md1-kf-star-inner-a', clipId: 'md1-clip-star', time: 0, property: 'shape.star.innerRadius', value: 22, easing: 'ease-out' },
      { id: 'md1-kf-star-inner-b', clipId: 'md1-clip-star', time: 1, property: 'shape.star.innerRadius', value: 29, easing: 'ease-out' },
    ]],
  ]);
}

export function createMd1GoldenFixture(): Md1GoldenFixture {
  const tracks = [
    createTrack('md1-track-star', 'MD1 Star'),
    createTrack('md1-track-polygon', 'MD1 Polygon'),
    createTrack('md1-track-ellipse', 'MD1 Ellipse'),
    createTrack('md1-track-rectangle', 'MD1 Rectangle'),
    createTrack('md1-track-background', 'MD1 Background'),
  ];
  const clips = createFixtureClips();
  const nestedTracks = structuredClone(tracks);
  const keyframes = createFixtureKeyframes();
  const nestedClips = structuredClone(clips).map((clip) => {
    const embedded = structuredClone(keyframes.get(clip.id) ?? []);
    return Object.assign(clip, { keyframes: embedded });
  });
  const nestedWrapperClip: TimelineClip = {
    id: 'md1-clip-nested-wrapper',
    trackId: 'md1-track-nested-wrapper',
    name: 'MD1 Nested Composition',
    file: new File([], 'md1-nested-composition.mscomp'),
    startTime: 0,
    duration: MD1_GOLDEN_DURATION_SECONDS,
    inPoint: 0,
    outPoint: MD1_GOLDEN_DURATION_SECONDS,
    source: { type: 'video', naturalDuration: MD1_GOLDEN_DURATION_SECONDS },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    isComposition: true,
    compositionId: 'md1-golden-nested-composition',
    nestedTracks,
    nestedClips,
  };
  const nestedComposition: Composition = {
    id: nestedWrapperClip.compositionId!,
    name: 'MD1 Golden Nested Composition',
    type: 'composition',
    parentId: null,
    createdAt: 0,
    width: MD1_GOLDEN_WIDTH,
    height: MD1_GOLDEN_HEIGHT,
    frameRate: 30,
    duration: MD1_GOLDEN_DURATION_SECONDS,
    backgroundColor: '#000000',
  };

  return {
    id: MD1_GOLDEN_FIXTURE_ID,
    width: MD1_GOLDEN_WIDTH,
    height: MD1_GOLDEN_HEIGHT,
    duration: MD1_GOLDEN_DURATION_SECONDS,
    sampleTime: MD1_GOLDEN_SAMPLE_TIME_SECONDS,
    tracks,
    clips,
    keyframes,
    nestedTracks,
    nestedClips,
    nestedWrapperClip,
    nestedComposition,
  };
}
