import type { TimelineClip, TimelineTrack } from '../../../stores/timeline/types';
import type { ActiveTransitionPlan } from '../../../stores/timeline/editOperations/transitionPlanner';
import type { BlendMode } from '../../../types/blendMode';
import type { RuntimeColorGrade } from '../../../types/colorCorrection';
import type { Effect } from '../../../types/effects';
import type { ClipMask } from '../../../types/masks';
import type { LayerSourceRect, TransitionRenderState } from '../../../types/layers';
import type { TextBoundsPath } from '../../../types/masks';
import type { ClipTransform } from '../../../types/timelineCore';
import type { VectorAnimationClipSettings } from '../../../types/vectorAnimation';
import type { WebCodecsPlayer } from '../../WebCodecsPlayer';

export interface ExportClipStateLike {
  clipId: string;
  webCodecsPlayer: WebCodecsPlayer | null;
  lastSampleIndex: number;
  isSequential: boolean;
  preciseVideoElement?: HTMLVideoElement | null;
  exportImageElement?: HTMLImageElement | null;
}

export interface BaseLayerPropsLike {
  id: string;
  name: string;
  sourceClipId: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  effects: Effect[];
  colorCorrection?: RuntimeColorGrade;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z?: number };
  rotation: { x: number; y: number; z: number };
  maskClipId?: string;
  maskInvert?: boolean;
  masks?: ClipMask[];
  sourceRect?: LayerSourceRect;
  transitionRender?: TransitionRenderState;
  is3D?: boolean;
}

export interface FrameContextLike {
  time: number;
  fps: number;
  frameTolerance: number;
  outputWidth?: number;
  outputHeight?: number;
  clipsAtTime: TimelineClip[];
  renderClipsAtTime?: TimelineClip[];
  trackMap: Map<string, TimelineTrack>;
  clipsByTrack: Map<string, TimelineClip>;
  transitionParticipantsByTrack?: Map<string, ActiveTransitionPlan>;
  getInterpolatedTransform: (clipId: string, localTime: number) => ClipTransform;
  getInterpolatedEffects: (clipId: string, localTime: number) => Effect[];
  getInterpolatedColorCorrection: (clipId: string, localTime: number) => RuntimeColorGrade | undefined;
  getInterpolatedVectorAnimationSettings: (clipId: string, localTime: number) => VectorAnimationClipSettings;
  getInterpolatedTextBounds: (clipId: string, localTime: number) => TextBoundsPath | undefined;
  getSourceTimeForClip: (clipId: string, localTime: number) => number;
  getInterpolatedSpeed: (clipId: string, localTime: number) => number;
}
