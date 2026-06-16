export type RenderGraphId = string;
export type RenderGraphVersion = number;

export type RenderGraphInterpolationAuthority = 'worker-keyframes' | 'main-evaluated';

export interface RenderGraphVector2 {
  readonly x: number;
  readonly y: number;
}

export interface RenderGraphRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RenderGraphRgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface RenderGraphKeyframe {
  readonly time: number;
  readonly value: number;
  readonly easing: 'hold' | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface RenderGraphTransformTracks {
  readonly positionX: readonly RenderGraphKeyframe[];
  readonly positionY: readonly RenderGraphKeyframe[];
  readonly scaleX: readonly RenderGraphKeyframe[];
  readonly scaleY: readonly RenderGraphKeyframe[];
  readonly rotation: readonly RenderGraphKeyframe[];
  readonly opacity: readonly RenderGraphKeyframe[];
}

export interface RenderGraphAssetRef {
  readonly assetId: RenderGraphId;
  readonly mediaFileId: string | null;
  readonly signalKind:
    | 'video'
    | 'audio'
    | 'image'
    | 'text'
    | 'solid'
    | 'document'
    | 'vector'
    | 'model-3d'
    | 'gaussian'
    | 'cad'
    | 'data';
  readonly duration: number | null;
  readonly intrinsicSize: RenderGraphVector2 | null;
  readonly providerId: string | null;
}

export interface RenderGraphEffectDescriptor {
  readonly id: RenderGraphId;
  readonly effectType: string;
  readonly enabled: boolean;
  readonly order: number;
  readonly parameters: Readonly<Record<string, number | string | boolean | null>>;
}

export interface RenderGraphMaskDescriptor {
  readonly id: RenderGraphId;
  readonly maskType: 'rectangle' | 'ellipse' | 'path' | 'external';
  readonly enabled: boolean;
  readonly bounds: RenderGraphRect;
  readonly feather: number;
  readonly opacity: number;
}

export interface RenderGraphTransitionDescriptor {
  readonly id: RenderGraphId;
  readonly transitionType: string;
  readonly duration: number;
  readonly alignment: 'start' | 'center' | 'end';
  readonly parameters: Readonly<Record<string, number | string | boolean | null>>;
}

export interface RenderGraphClip {
  readonly id: RenderGraphId;
  readonly trackId: RenderGraphId;
  readonly assetId: RenderGraphId | null;
  readonly startTime: number;
  readonly duration: number;
  readonly inPoint: number;
  readonly outPoint: number;
  readonly speed: number;
  readonly visible: boolean;
  readonly muted: boolean;
  readonly blendMode: string;
  readonly transform: RenderGraphTransformTracks;
  readonly effects: readonly RenderGraphEffectDescriptor[];
  readonly masks: readonly RenderGraphMaskDescriptor[];
  readonly incomingTransition: RenderGraphTransitionDescriptor | null;
  readonly outgoingTransition: RenderGraphTransitionDescriptor | null;
  readonly nestedCompositionId: RenderGraphId | null;
}

export interface RenderGraphTrack {
  readonly id: RenderGraphId;
  readonly kind: 'video' | 'audio' | 'overlay' | 'data';
  readonly name: string;
  readonly visible: boolean;
  readonly muted: boolean;
  readonly locked: boolean;
  readonly order: number;
  readonly clipIds: readonly RenderGraphId[];
}

export interface CompositionRenderGraph {
  readonly id: RenderGraphId;
  readonly name: string;
  readonly version: RenderGraphVersion;
  readonly duration: number;
  readonly resolution: RenderGraphVector2;
  readonly background: RenderGraphRgba;
  readonly trackIds: readonly RenderGraphId[];
  readonly tracks: Readonly<Record<RenderGraphId, RenderGraphTrack>>;
  readonly clips: Readonly<Record<RenderGraphId, RenderGraphClip>>;
}

export interface ProjectRenderGraph {
  readonly id: RenderGraphId;
  readonly version: RenderGraphVersion;
  readonly interpolationAuthority: RenderGraphInterpolationAuthority;
  readonly activeCompositionId: RenderGraphId;
  readonly compositionIds: readonly RenderGraphId[];
  readonly compositions: Readonly<Record<RenderGraphId, CompositionRenderGraph>>;
  readonly assets: Readonly<Record<RenderGraphId, RenderGraphAssetRef>>;
}

export type RenderGraphDeltaOperation =
  | { readonly type: 'upsertComposition'; readonly composition: CompositionRenderGraph }
  | { readonly type: 'removeComposition'; readonly compositionId: RenderGraphId }
  | { readonly type: 'upsertTrack'; readonly compositionId: RenderGraphId; readonly track: RenderGraphTrack }
  | { readonly type: 'removeTrack'; readonly compositionId: RenderGraphId; readonly trackId: RenderGraphId }
  | { readonly type: 'upsertClip'; readonly compositionId: RenderGraphId; readonly clip: RenderGraphClip }
  | { readonly type: 'removeClip'; readonly compositionId: RenderGraphId; readonly clipId: RenderGraphId }
  | {
      readonly type: 'upsertKeyframes';
      readonly compositionId: RenderGraphId;
      readonly clipId: RenderGraphId;
      readonly property: keyof RenderGraphTransformTracks;
      readonly keyframes: readonly RenderGraphKeyframe[];
    }
  | {
      readonly type: 'upsertEffectStack';
      readonly compositionId: RenderGraphId;
      readonly clipId: RenderGraphId;
      readonly effects: readonly RenderGraphEffectDescriptor[];
    }
  | {
      readonly type: 'upsertMask';
      readonly compositionId: RenderGraphId;
      readonly clipId: RenderGraphId;
      readonly mask: RenderGraphMaskDescriptor;
    }
  | {
      readonly type: 'upsertTransition';
      readonly compositionId: RenderGraphId;
      readonly clipId: RenderGraphId;
      readonly edge: 'incoming' | 'outgoing';
      readonly transition: RenderGraphTransitionDescriptor | null;
    }
  | { readonly type: 'upsertAsset'; readonly asset: RenderGraphAssetRef }
  | { readonly type: 'targetRegistered'; readonly target: RenderCommandTarget }
  | { readonly type: 'targetResized'; readonly targetId: RenderGraphId; readonly size: RenderGraphVector2 }
  | { readonly type: 'targetUpdated'; readonly target: RenderCommandTarget }
  | { readonly type: 'targetRemoved'; readonly targetId: RenderGraphId };

export interface RenderGraphDelta {
  readonly projectId: RenderGraphId;
  readonly baseVersion: RenderGraphVersion;
  readonly nextVersion: RenderGraphVersion;
  readonly operations: readonly RenderGraphDeltaOperation[];
}

export interface RenderCommandTarget {
  readonly id: RenderGraphId;
  readonly compositionId: RenderGraphId;
  readonly size: RenderGraphVector2;
  readonly devicePixelRatio: number;
  readonly showTransparencyGrid: boolean;
  readonly presentation: 'main-canvas' | 'offscreen-canvas' | 'image-bitmap' | 'software';
}

export interface PlaybackClockSnapshot {
  readonly timelineTime: number;
  readonly playbackSpeed: number;
  readonly playing: boolean;
  readonly loop: { readonly enabled: boolean; readonly start: number; readonly end: number } | null;
  readonly audioClockTime: number | null;
  readonly driftMs: number;
}

export interface RenderDeadline {
  readonly requestId: string;
  readonly targetId: RenderGraphId;
  readonly timelineTime: number;
  readonly deadlineTimeMs: number;
  readonly exact: boolean;
}

export type RenderJobType =
  | 'live-preview'
  | 'scrub'
  | 'independent-preview'
  | 'ram-preview'
  | 'clip-bake'
  | 'composition-bake'
  | 'thumbnail'
  | 'export-frame'
  | 'export-range';

export interface RenderJobDescriptor {
  readonly id: string;
  readonly type: RenderJobType;
  readonly targetId: RenderGraphId | null;
  readonly compositionId: RenderGraphId;
  readonly priority: 'critical' | 'high' | 'normal' | 'low' | 'idle';
  readonly range: { readonly start: number; readonly end: number; readonly step: number } | null;
}

export type RenderCommand =
  | { readonly type: 'initialize'; readonly rendererId: string; readonly strategy: string }
  | { readonly type: 'registerTarget'; readonly target: RenderCommandTarget }
  | { readonly type: 'unregisterTarget'; readonly targetId: RenderGraphId }
  | { readonly type: 'resizeTarget'; readonly targetId: RenderGraphId; readonly size: RenderGraphVector2 }
  | { readonly type: 'renderFrame'; readonly deadline: RenderDeadline }
  | { readonly type: 'startPlayback'; readonly clock: PlaybackClockSnapshot }
  | { readonly type: 'pausePlayback'; readonly clock: PlaybackClockSnapshot }
  | { readonly type: 'seek'; readonly requestId: string; readonly timelineTime: number; readonly exact: boolean }
  | { readonly type: 'scrub'; readonly requestId: string; readonly timelineTime: number; readonly deadlineTimeMs: number }
  | { readonly type: 'startRamPreview'; readonly job: RenderJobDescriptor }
  | { readonly type: 'startBake'; readonly job: RenderJobDescriptor }
  | { readonly type: 'exportFrame'; readonly job: RenderJobDescriptor; readonly timelineTime: number }
  | { readonly type: 'exportRange'; readonly job: RenderJobDescriptor }
  | { readonly type: 'collectStats'; readonly requestId: string }
  | { readonly type: 'dispose'; readonly reason: string }
  | { readonly type: 'InitGraph'; readonly graph: ProjectRenderGraph }
  | { readonly type: 'GraphDelta'; readonly delta: RenderGraphDelta }
  | { readonly type: 'SetClock'; readonly clock: PlaybackClockSnapshot }
  | { readonly type: 'RenderDeadline'; readonly deadline: RenderDeadline }
  | { readonly type: 'RenderNow'; readonly requestId: string; readonly targetId: RenderGraphId; readonly timelineTime: number }
  | { readonly type: 'StartRenderJob'; readonly job: RenderJobDescriptor }
  | { readonly type: 'CancelRenderJob'; readonly jobId: string; readonly reason: string };

export type WorkerRenderStatusEvent =
  | { readonly type: 'initialized'; readonly rendererId: string }
  | { readonly type: 'frame-presented'; readonly requestId: string; readonly targetId: RenderGraphId; readonly timelineTime: number }
  | { readonly type: 'frame-dropped'; readonly requestId: string; readonly reason: string }
  | { readonly type: 'cache-updated'; readonly cacheId: string; readonly ownerId: string; readonly bytes: number }
  | { readonly type: 'job-progress'; readonly jobId: string; readonly completedFrames: number; readonly totalFrames: number | null }
  | { readonly type: 'device-lost'; readonly reason: string }
  | { readonly type: 'error'; readonly message: string; readonly recoverable: boolean }
  | { readonly type: 'stats'; readonly requestId: string; readonly stats: Readonly<Record<string, number | string | boolean | null>> };
