/**
 * Freezes the data-only input gathered for one render frame.
 * First implementor: FrameExporter/FFmpegFrameRenderer createFrameContext.
 * Eliminates class-c getState reads in the export frame loop, layer-builder
 * interpolation, playback flags, media lookups, and scene UI overrides.
 */

import type { ClipAudioState, MasterAudioState, TrackAudioState } from '../../../types/audio';
import type { RuntimeColorGrade } from '../../../types/colorCorrection';
import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import type { ClipMask, TextBoundsPath } from '../../../types/masks';
import type { MidiInstrument } from '../../../types/midiClip';
import type { MotionLayerDefinition } from '../../../types/motionDesign';
import type { SplatEffectorSettings } from '../../../types/splatEffector';
import type { Text3DProperties, TextClipProperties } from '../../../types/text';
import type { ClipTransform, TimelineTransition } from '../../../types/timelineCore';
import type { TimelineSourceType } from '../../../types/timelineSource';
import type { VectorAnimationClipSettings, VectorAnimationMetadata } from '../../../types/vectorAnimation';
import type { GaussianSplatSettings } from '../../gaussian/types';

export type RenderPlainValue = string | number | boolean | null | readonly RenderPlainValue[] | { readonly [key: string]: RenderPlainValue };
export interface RenderResolution { readonly width: number; readonly height: number }
export interface RenderMediaAssetRef { readonly mediaFileId?: string; readonly signalAssetId?: string; readonly signalRefId?: string; readonly signalRenderAdapterId?: string; readonly fileName?: string; readonly fileHash?: string; readonly fileSize?: number; readonly sourcePath?: string; readonly projectPath?: string; readonly absolutePath?: string }
export type RenderMeshPrimitiveType = 'cube' | 'sphere' | 'plane' | 'cylinder' | 'torus' | 'cone' | 'text3d';
export type RenderLabelColor = 'none' | 'red' | 'yellow' | 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'cyan' | 'brown' | 'lavender' | 'peach' | 'seafoam' | 'fuchsia' | 'tan' | 'aqua';
export interface RenderSceneCameraSettings { readonly fov: number; readonly near: number; readonly far: number; readonly resolutionWidth?: number; readonly resolutionHeight?: number }
export interface RenderVector3 { readonly x: number; readonly y: number; readonly z: number }
export interface RenderSceneCameraConfig {
  readonly position: RenderVector3;
  readonly target: RenderVector3;
  readonly up: RenderVector3;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly applyDefaultDistance?: boolean;
  readonly projection?: 'perspective' | 'orthographic';
  readonly orthographicScale?: number;
}
export interface RenderCompositionCamera { readonly enabled: boolean; readonly position: RenderVector3; readonly target: RenderVector3; readonly fov: number; readonly near: number; readonly far: number }

export type RenderSceneGizmoAxis = 'x' | 'y' | 'z';
export type RenderSceneGizmoMode = 'move' | 'rotate' | 'scale';
export interface RenderSceneGizmoState { readonly visible: boolean; readonly mode: RenderSceneGizmoMode; readonly hoveredAxis: RenderSceneGizmoAxis | null; readonly clipIdOverride: string | null }
export type RenderSequencePlaybackMode = 'clamp' | 'loop';
export interface RenderSequenceFrameRef { readonly name: string; readonly projectPath?: string; readonly sourcePath?: string; readonly absolutePath?: string; readonly fileSize?: number; readonly container?: string; readonly codec?: string }
export interface RenderSequenceData {
  readonly fps: number;
  readonly frameCount: number;
  readonly playbackMode?: RenderSequencePlaybackMode;
  readonly sequenceName?: string;
  readonly frames: readonly RenderSequenceFrameRef[];
  readonly sharedBounds?: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
  readonly totalItemCount?: number;
  readonly minItemCount?: number;
  readonly maxItemCount?: number;
  readonly totalFileSize?: number;
  readonly container?: string;
  readonly codec?: string;
}

export interface RenderTimelineClipSource {
  readonly type: TimelineSourceType;
  readonly assetRef?: RenderMediaAssetRef;
  readonly modelFileName?: string;
  readonly modelSequence?: RenderSequenceData;
  readonly gaussianSplatSequence?: RenderSequenceData;
  readonly threeDEffectorsEnabled?: boolean;
  readonly meshType?: RenderMeshPrimitiveType;
  readonly text3DProperties?: Text3DProperties;
  readonly cameraSettings?: RenderSceneCameraSettings;
  readonly splatEffectorSettings?: SplatEffectorSettings;
  readonly gaussianBlendshapes?: Readonly<Record<string, number>>;
  readonly gaussianSplatFileName?: string;
  readonly gaussianSplatFileHash?: string;
  readonly gaussianSplatSettings?: GaussianSplatSettings;
  readonly naturalDuration?: number;
  readonly mediaFileId?: string;
  readonly vectorAnimationSettings?: VectorAnimationClipSettings;
  readonly filePath?: string;
  readonly extra?: Readonly<Record<string, RenderPlainValue>>;
}

export interface RenderTimelineTrackSnapshot {
  readonly id: string;
  readonly name: string;
  readonly type: 'video' | 'audio' | 'midi';
  readonly height: number;
  readonly labelColor?: RenderLabelColor;
  readonly muted: boolean;
  readonly visible: boolean;
  readonly solo: boolean;
  readonly locked?: boolean;
  readonly parentTrackId?: string;
  readonly audioState?: TrackAudioState;
  readonly midiInstrument?: MidiInstrument;
}

export interface RenderTimelineClipSnapshot {
  readonly id: string;
  readonly trackId: string;
  readonly name: string;
  readonly startTime: number;
  readonly duration: number;
  readonly inPoint: number;
  readonly outPoint: number;
  readonly source: RenderTimelineClipSource | null;
  readonly mediaFileId?: string;
  readonly signalAssetId?: string;
  readonly signalRefId?: string;
  readonly signalRenderAdapterId?: string;
  readonly linkedClipId?: string;
  readonly linkedGroupId?: string;
  readonly parentClipId?: string;
  readonly transform: ClipTransform;
  readonly effects: readonly Effect[];
  readonly colorCorrection?: RuntimeColorGrade;
  readonly audioState?: ClipAudioState;
  readonly waveform?: readonly number[];
  readonly waveformChannels?: readonly (readonly number[])[];
  readonly reversed?: boolean;
  readonly speed?: number;
  readonly preservesPitch?: boolean;
  readonly isComposition?: boolean;
  readonly compositionId?: string;
  readonly nestedClips?: readonly RenderTimelineClipSnapshot[];
  readonly nestedTracks?: readonly RenderTimelineTrackSnapshot[];
  readonly masks?: readonly ClipMask[];
  readonly textProperties?: TextClipProperties;
  readonly text3DProperties?: Text3DProperties;
  readonly motion?: MotionLayerDefinition;
  readonly transitionIn?: TimelineTransition;
  readonly transitionOut?: TimelineTransition;
  readonly is3D?: boolean;
  readonly wireframe?: boolean;
  readonly meshType?: RenderMeshPrimitiveType;
  readonly extra?: Readonly<Record<string, RenderPlainValue>>;
}

export type RenderImportedMediaType = 'video' | 'audio' | 'image' | 'model' | 'gaussian-avatar' | 'gaussian-splat' | 'lottie' | 'rive';

export interface RenderMediaFileSnapshot {
  readonly id: string;
  readonly name: string;
  readonly type: RenderImportedMediaType;
  readonly parentId: string | null;
  readonly createdAt: number;
  readonly labelColor?: RenderLabelColor;
  readonly assetRef: RenderMediaAssetRef;
  readonly modelSequence?: RenderSequenceData;
  readonly gaussianSplatSequence?: RenderSequenceData;
  readonly vectorAnimation?: VectorAnimationMetadata;
  readonly duration?: number;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly codec?: string;
  readonly audioCodec?: string;
  readonly container?: string;
  readonly bitrate?: number;
  readonly hasAudio?: boolean;
  readonly extra?: Readonly<Record<string, RenderPlainValue>>;
}

export interface RenderCompositionSnapshot {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly createdAt: number;
  readonly labelColor?: RenderLabelColor;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly duration: number;
  readonly backgroundColor: string;
  readonly timelineData?: RenderCompositionTimelineSnapshot;
  readonly camera?: RenderCompositionCamera;
}

export interface RenderCompositionTimelineSnapshot {
  readonly tracks: readonly RenderTimelineTrackSnapshot[];
  readonly clips: readonly RenderTimelineClipSnapshot[];
  readonly playheadPosition: number;
  readonly duration: number;
  readonly durationLocked?: boolean;
  readonly zoom: number;
  readonly scrollX: number;
  readonly inPoint: number | null;
  readonly outPoint: number | null;
  readonly clipKeyframes?: Readonly<Record<string, readonly Keyframe[]>>;
  readonly masterAudioState?: MasterAudioState;
}

export interface RenderSlotClipSettings {
  readonly trimIn: number;
  readonly trimOut: number;
  readonly endBehavior: 'loop' | 'hold' | 'clear';
}

export interface RenderFrameTimelineSnapshot {
  readonly clips: readonly RenderTimelineClipSnapshot[];
  readonly tracks: readonly RenderTimelineTrackSnapshot[];
  readonly clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>;
  readonly selectedClipIds: ReadonlySet<string>;
  readonly primarySelectedClipId: string | null;
  readonly selectedKeyframeIds: ReadonlySet<string>;
  readonly masterAudioState?: MasterAudioState;
  readonly getClipsAtTime: (time: number) => readonly RenderTimelineClipSnapshot[];
  readonly interpolation: RenderFrameInterpolationApi;
}

export interface RenderFrameInterpolationApi {
  readonly getInterpolatedTransform: (clipId: string, localTime: number) => ClipTransform;
  readonly getInterpolatedEffects: (clipId: string, localTime: number) => readonly Effect[];
  readonly getInterpolatedColorCorrection: (clipId: string, localTime: number) => RuntimeColorGrade | undefined;
  readonly getInterpolatedVectorAnimationSettings: (clipId: string, localTime: number) => VectorAnimationClipSettings;
  readonly getInterpolatedTextBounds: (clipId: string, localTime: number) => TextBoundsPath | undefined;
  readonly getSourceTimeForClip: (clipId: string, localTime: number) => number;
  readonly getInterpolatedSpeed: (clipId: string, localTime: number) => number;
}

export interface RenderFrameMediaSnapshot {
  readonly activeCompositionId: string | null;
  readonly compositions: readonly RenderCompositionSnapshot[];
  readonly files: readonly RenderMediaFileSnapshot[];
  readonly activeLayerSlots: Readonly<Record<number, string | null>>;
  readonly layerOpacities: Readonly<Record<number, number>>;
  readonly slotClipSettings: Readonly<Record<string, RenderSlotClipSettings>>;
}

export interface RenderFrameSceneSnapshot {
  readonly gizmo: RenderSceneGizmoState;
  readonly previewCameraOverride: RenderSceneCameraConfig | null;
}

export interface RenderFrameSnapshot {
  readonly time: number;
  readonly fps?: number;
  readonly frameToleranceMicros?: number;
  readonly resolution: RenderResolution;
  readonly playback: {
    readonly isPlaying: boolean;
    readonly isDraggingPlayhead: boolean;
    readonly isExporting: boolean;
  };
  readonly timeline: RenderFrameTimelineSnapshot;
  readonly media: RenderFrameMediaSnapshot;
  readonly scene: RenderFrameSceneSnapshot;
}
