import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import type {
  AnimatableProperty,
  AudioStemKind,
  ClipAudioStemState,
  Keyframe,
  SpectralImageLayer,
  TimelineClip,
  TimelineTrack,
  VideoBakeRegion,
} from '../../../types';
import type {
  ClipStemSeparationJobState,
  TimelineAudioRegionSelection,
  TimelineSpectralRegionSelection,
  TimelineToolId,
  TimelineVideoBakeRegionSelection,
} from '../../../stores/timeline/types';
import type {
  ClipDragState,
  ClipFadeState,
  ClipKeyframeTimeGroup,
  ClipTrimState,
  ContextMenuState,
} from '../types';
import type { FadeCurveKeyframe } from '../utils/fadeCurvePath';

export const CLIP_INTERACTION_SHELL_MODULE_SLOTS = [
  'trim',
  'fade',
  'keyframe',
  'audio-region',
  'spectral-region',
  'video-bake',
  'stem',
  'context-menu',
  'tool-preview',
] as const;

export type ClipInteractionShellModuleSlot = typeof CLIP_INTERACTION_SHELL_MODULE_SLOTS[number];

export const CLIP_INTERACTION_SHELL_PARITY_STATES = [
  'selected',
  'open-context-menu',
  'fade',
  'keyframe',
  'audio-region',
  'spectral-region',
  'video-bake',
  'stem',
] as const;

export type ClipInteractionShellParityState = typeof CLIP_INTERACTION_SHELL_PARITY_STATES[number];

export const CLIP_INTERACTION_SHELL_MOUNT_REASONS = [
  'hover',
  'drag',
  'multi-drag',
  'trim',
  'trim-follower',
  'fade',
  'context-menu-open',
  'selected-keyframes',
  'audio-region-active',
  'spectral-region-active',
  'video-bake-active',
  'stem-active',
  'tool-preview',
  'focused-module',
] as const;

export type ClipInteractionShellMountReason = typeof CLIP_INTERACTION_SHELL_MOUNT_REASONS[number];

export type ClipInteractionShellEdge = 'left' | 'right';

export interface ClipInteractionShellPoint {
  x: number;
  y: number;
}

export interface ClipInteractionShellRect extends ClipInteractionShellPoint {
  width: number;
  height: number;
}

export type ClipInteractionShellEdgeRects = Partial<Record<ClipInteractionShellEdge, ClipInteractionShellRect>>;

export type ClipInteractionShellClipRef = Readonly<
  Pick<
    TimelineClip,
    | 'id'
    | 'trackId'
    | 'name'
    | 'startTime'
    | 'duration'
    | 'inPoint'
    | 'outPoint'
    | 'reversed'
    | 'mediaFileId'
    | 'source'
    | 'linkedClipId'
    | 'linkedGroupId'
    | 'waveform'
    | 'audioState'
    | 'videoState'
  >
>;

export type ClipInteractionShellTrackRef = Readonly<
  Pick<TimelineTrack, 'id' | 'type' | 'locked' | 'muted' | 'visible'>
>;

export interface ClipInteractionShellKeyframeRowGeometry {
  property: AnimatableProperty;
  row: ClipInteractionShellRect;
  diamonds: readonly ClipInteractionShellKeyframeDiamondGeometry[];
}

export interface ClipInteractionShellKeyframeDiamondGeometry {
  keyframeId: string;
  time: number;
  rect: ClipInteractionShellRect;
}

export interface ClipInteractionShellGeometry {
  clip: ClipInteractionShellRect;
  visibleClip: ClipInteractionShellRect;
  track: ClipInteractionShellRect;
  viewport: ClipInteractionShellRect;
  trimHandles: ClipInteractionShellEdgeRects;
  fadeHandles: ClipInteractionShellEdgeRects;
  fadeCurve?: readonly ClipInteractionShellPoint[];
  keyframeRows: readonly ClipInteractionShellKeyframeRowGeometry[];
  audioRegion?: ClipInteractionShellRect;
  spectralRegion?: ClipInteractionShellRect;
  videoBakeRegion?: ClipInteractionShellRect;
  stemControls?: ClipInteractionShellRect;
  contextMenuAnchor?: ClipInteractionShellPoint;
  toolPreview?: ClipInteractionShellRect;
}

export interface ClipInteractionShellMountState {
  clipId: string;
  shouldMount: boolean;
  reasons: readonly ClipInteractionShellMountReason[];
  isHovered?: boolean;
  isSelected?: boolean;
  isDragging?: boolean;
  isMultiDragging?: boolean;
  isTrimming?: boolean;
  isTrimFollower?: boolean;
  isFading?: boolean;
  hasOpenContextMenu?: boolean;
  hasVisibleKeyframes?: boolean;
  hasActiveAudioRegion?: boolean;
  hasActiveSpectralRegion?: boolean;
  hasActiveVideoBakeRegion?: boolean;
  hasActiveStemControls?: boolean;
  hasToolPreview?: boolean;
}

export interface ClipInteractionShellBaseModuleState {
  enabled: boolean;
  slot: ClipInteractionShellModuleSlot;
}

export interface ClipInteractionShellTrimModuleState extends ClipInteractionShellBaseModuleState {
  slot: 'trim';
  state: ClipTrimState | null;
  activeEdges: readonly ClipInteractionShellEdge[];
  isFollowerPreview?: boolean;
  isLinkedPreview?: boolean;
}

export interface ClipInteractionShellFadeModuleState extends ClipInteractionShellBaseModuleState {
  slot: 'fade';
  state: ClipFadeState | null;
  activeEdges: readonly ClipInteractionShellEdge[];
  previewDurationSeconds?: number;
  fadeInDuration: number;
  fadeOutDuration: number;
  curveKeyframes: readonly FadeCurveKeyframe[];
  curveKey: string;
  clipDuration: number;
  isAudioClip: boolean;
}

export interface ClipInteractionShellKeyframeModuleState extends ClipInteractionShellBaseModuleState {
  slot: 'keyframe';
  activeProperty?: AnimatableProperty;
  keyframes: readonly Keyframe[];
  keyframeGroups: readonly ClipKeyframeTimeGroup[];
  selectedKeyframeIds: readonly string[];
}

export interface ClipInteractionShellAudioRegionModuleState extends ClipInteractionShellBaseModuleState {
  slot: 'audio-region';
  selection: TimelineAudioRegionSelection | null;
  mode?: 'select' | 'move' | 'resize' | 'gain' | 'context-menu';
  gainPreviewDb?: number;
}

export type ClipInteractionShellSpectralLayerRef = Readonly<
  Pick<
    SpectralImageLayer,
    | 'id'
    | 'imageMediaFileId'
    | 'timeStart'
    | 'duration'
    | 'frequencyMin'
    | 'frequencyMax'
    | 'opacity'
    | 'enabled'
    | 'blendMode'
  >
>;

export interface ClipInteractionShellSpectralRegionModuleState extends ClipInteractionShellBaseModuleState {
  slot: 'spectral-region';
  selection: TimelineSpectralRegionSelection | null;
  imageLayers: readonly ClipInteractionShellSpectralLayerRef[];
  isImageDropTarget?: boolean;
}

export type ClipInteractionShellVideoBakeRegionRef = Readonly<
  Pick<
    VideoBakeRegion,
    | 'id'
    | 'scope'
    | 'startTime'
    | 'endTime'
    | 'status'
    | 'progress'
    | 'clipId'
    | 'trackId'
    | 'sourceInPoint'
    | 'sourceOutPoint'
  >
>;

export interface ClipInteractionShellVideoBakeModuleState extends ClipInteractionShellBaseModuleState {
  slot: 'video-bake';
  selection: TimelineVideoBakeRegionSelection | null;
  regions: readonly ClipInteractionShellVideoBakeRegionRef[];
}

export interface ClipInteractionShellStemModuleState extends ClipInteractionShellBaseModuleState {
  slot: 'stem';
  stemState: ClipAudioStemState | null;
  menuOpen?: boolean;
  activeStemKind?: AudioStemKind;
  job?: ClipStemSeparationJobState | null;
  jobPhase?: string;
  progress?: number;
}

export interface ClipInteractionShellContextMenuModuleState extends ClipInteractionShellBaseModuleState {
  slot: 'context-menu';
  state: ContextMenuState | null;
  isOpen: boolean;
}

export interface ClipInteractionShellToolPreviewModuleState extends ClipInteractionShellBaseModuleState {
  slot: 'tool-preview';
  toolId: TimelineToolId;
  label?: string;
  blocked?: boolean;
}

export interface ClipInteractionShellActiveModules {
  trim?: ClipInteractionShellTrimModuleState;
  fade?: ClipInteractionShellFadeModuleState;
  keyframe?: ClipInteractionShellKeyframeModuleState;
  audioRegion?: ClipInteractionShellAudioRegionModuleState;
  spectralRegion?: ClipInteractionShellSpectralRegionModuleState;
  videoBake?: ClipInteractionShellVideoBakeModuleState;
  stem?: ClipInteractionShellStemModuleState;
  contextMenu?: ClipInteractionShellContextMenuModuleState;
  toolPreview?: ClipInteractionShellToolPreviewModuleState;
}

export const CLIP_INTERACTION_SHELL_MODULE_KEYS = {
  trim: 'trim',
  fade: 'fade',
  keyframe: 'keyframe',
  'audio-region': 'audioRegion',
  'spectral-region': 'spectralRegion',
  'video-bake': 'videoBake',
  stem: 'stem',
  'context-menu': 'contextMenu',
  'tool-preview': 'toolPreview',
} as const satisfies Record<ClipInteractionShellModuleSlot, keyof ClipInteractionShellActiveModules>;

export interface ClipInteractionShellCommandContext {
  clip: ClipInteractionShellClipRef;
  track: ClipInteractionShellTrackRef;
  geometry: ClipInteractionShellGeometry;
  mountState: ClipInteractionShellMountState;
  activeModules: ClipInteractionShellActiveModules;
}

export interface ClipInteractionShellCommands {
  onRootPointerDown?: (
    event: ReactPointerEvent<HTMLDivElement>,
    context: ClipInteractionShellCommandContext,
  ) => void;
  onRootMouseDown?: (
    event: ReactMouseEvent<HTMLDivElement>,
    context: ClipInteractionShellCommandContext,
  ) => void;
  onRootContextMenu?: (
    event: ReactMouseEvent<HTMLDivElement>,
    context: ClipInteractionShellCommandContext,
  ) => void;
  onRootKeyDown?: (
    event: ReactKeyboardEvent<HTMLDivElement>,
    context: ClipInteractionShellCommandContext,
  ) => void;
  onTrimStart?: (
    event: ReactMouseEvent<HTMLElement>,
    context: ClipInteractionShellCommandContext,
    edge: ClipInteractionShellEdge,
  ) => void;
  onFadeStart?: (
    event: ReactMouseEvent<HTMLElement>,
    context: ClipInteractionShellCommandContext,
    edge: ClipInteractionShellEdge,
  ) => void;
  onMoveKeyframeGroup?: (
    keyframeIds: string[],
    newTime: number,
    context: ClipInteractionShellCommandContext,
    phase?: 'begin' | 'update' | 'commit',
  ) => void;
  onModuleCommand?: (
    slot: ClipInteractionShellModuleSlot,
    command: string,
    context: ClipInteractionShellCommandContext,
    event?: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>,
  ) => void;
}

export interface ClipInteractionShellProps {
  clip: ClipInteractionShellClipRef;
  track: ClipInteractionShellTrackRef;
  geometry: ClipInteractionShellGeometry;
  mountState: ClipInteractionShellMountState;
  activeModules: ClipInteractionShellActiveModules;
  commands?: ClipInteractionShellCommands;
  dragState?: ClipDragState | null;
  className?: string;
  style?: CSSProperties;
  renderModule?: (
    slot: ClipInteractionShellModuleSlot,
    context: ClipInteractionShellCommandContext,
  ) => ReactNode;
}

export interface ClipInteractionShellParityCase {
  state: ClipInteractionShellParityState;
  shouldMount: boolean;
  expectedSlots: readonly ClipInteractionShellModuleSlot[];
  note: string;
}

export const CLIP_INTERACTION_SHELL_PARITY_MATRIX = [
  {
    state: 'selected',
    shouldMount: false,
    expectedSlots: [],
    note: 'Selected-only visuals stay canvas-rendered; mount only when selected keyframes or another active module needs DOM.',
  },
  {
    state: 'open-context-menu',
    shouldMount: true,
    expectedSlots: ['context-menu'],
    note: 'Open clip menus keep a shell root for command dispatch without mounting TimelineClip.',
  },
  {
    state: 'fade',
    shouldMount: true,
    expectedSlots: ['fade'],
    note: 'Fade gestures require explicit clipFade mount state before fade handles move out of TimelineClip.',
  },
  {
    state: 'keyframe',
    shouldMount: true,
    expectedSlots: ['keyframe'],
    note: 'Visible keyframe ticks and focused keyframe rows are active shell modules.',
  },
  {
    state: 'audio-region',
    shouldMount: true,
    expectedSlots: ['audio-region'],
    note: 'Audio region selection, gain drag, and context affordances stay active DOM modules.',
  },
  {
    state: 'spectral-region',
    shouldMount: true,
    expectedSlots: ['spectral-region'],
    note: 'Spectral selection, image-layer drop targets, and spectral toolbar are active shell modules.',
  },
  {
    state: 'video-bake',
    shouldMount: true,
    expectedSlots: ['video-bake'],
    note: 'Video bake range selection and controls are active shell modules.',
  },
  {
    state: 'stem',
    shouldMount: true,
    expectedSlots: ['stem'],
    note: 'Stem switcher, stem menu, and stem job controls are active shell modules.',
  },
] as const satisfies readonly ClipInteractionShellParityCase[];

export function getClipInteractionShellActiveSlots(
  activeModules: ClipInteractionShellActiveModules,
): ClipInteractionShellModuleSlot[] {
  return CLIP_INTERACTION_SHELL_MODULE_SLOTS.filter((slot) => {
    const moduleKey = CLIP_INTERACTION_SHELL_MODULE_KEYS[slot];
    return activeModules[moduleKey]?.enabled === true;
  });
}
