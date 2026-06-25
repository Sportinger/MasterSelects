import type {
  AudioEffectInstance,
  ClipTransform,
  ColorCorrectionState,
  ColorNodeType,
  ColorParamValue,
  ColorViewMode,
  Effect,
  MathObject,
  MathParameter,
  MathSceneDefinition,
  MaskVertex,
  Text3DProperties,
  TextBoundsPath,
  TextClipProperties,
  TimelineClip,
} from '../../../types';
import type { MidiNote } from '../../../types/midiClip';
import type {
  MotionColor,
  MotionLayerDefinition,
  ShapePrimitive,
} from '../../../types/motionDesign';
import type { Composition } from '../../mediaStore';
import type { MeshPrimitiveType } from '../../mediaStore/types';

export interface TextClipActions {
  addTextClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => Promise<string | null>;
  updateTextProperties: (clipId: string, props: Partial<TextClipProperties>) => void;
  updateTextBounds: (clipId: string, updates: Partial<TextBoundsPath>) => void;
  updateTextBoundsVertex: (clipId: string, vertexId: string, updates: Partial<MaskVertex>, recordKeyframe?: boolean) => void;
  updateTextBoundsVertices: (clipId: string, vertexUpdates: Array<{ vertexId: string; updates: Partial<MaskVertex> }>, recordKeyframe?: boolean) => void;
}

export interface SolidClipActions {
  addSolidClip: (trackId: string, startTime: number, color?: string, duration?: number, skipMediaItem?: boolean) => string | null;
  updateSolidColor: (clipId: string, color: string) => void;
}

export interface MidiClipActions {
  addMidiClip: (trackId: string, startTime: number, duration?: number) => string | null;
  renameMidiClip: (clipId: string, name: string) => void;
  clipRenameId: string | null;
  setClipRenameId: (clipId: string | null) => void;
  addMidiNote: (clipId: string, note: { pitch: number; start: number; duration: number; velocity?: number }) => string | null;
  /**
   * Batch-insert notes into a MIDI clip as a SINGLE undo step, returning the new
   * note ids in input order. Powers piano-roll paste/duplicate, where a per-note
   * addMidiNote loop would push N snapshots and need N undos.
   */
  addMidiNotes: (clipId: string, notes: { pitch: number; start: number; duration: number; velocity?: number }[]) => string[];
  updateMidiNote: (
    clipId: string,
    noteId: string,
    patch: Partial<Pick<MidiNote, 'pitch' | 'start' | 'duration' | 'velocity'>>,
    options?: { captureHistory?: boolean },
  ) => void;
  removeMidiNote: (clipId: string, noteId: string) => void;
  removeMidiNotes: (clipId: string, noteIds: string[]) => void;
}

export interface MathSceneClipActions {
  addMathSceneClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
  updateMathScene: (clipId: string, updater: (scene: MathSceneDefinition) => MathSceneDefinition) => void;
  addMathObject: (clipId: string, object: MathObject) => void;
  updateMathObject: (clipId: string, objectId: string, patch: Partial<MathObject>) => void;
  removeMathObject: (clipId: string, objectId: string) => void;
  updateMathParameter: (clipId: string, parameterId: string, patch: Partial<MathParameter>) => void;
}

export interface MotionShapeClipOptions {
  primitive?: ShapePrimitive;
  size?: { w: number; h: number };
  fillColor?: MotionColor;
  duration?: number;
  name?: string;
}

export interface MotionClipActions {
  addMotionShapeClip: (trackId: string, startTime: number, options?: MotionShapeClipOptions) => string | null;
  addMotionNullClip: (trackId: string, startTime: number, duration?: number) => string | null;
  addMotionAdjustmentClip: (trackId: string, startTime: number, duration?: number) => string | null;
  convertSolidToMotionShape: (clipId: string) => string | null;
  updateMotionLayer: (clipId: string, updater: (motion: MotionLayerDefinition) => MotionLayerDefinition) => void;
}

export interface MeshClipActions {
  addMeshClip: (trackId: string, startTime: number, meshType: MeshPrimitiveType, duration?: number, skipMediaItem?: boolean) => string | null;
  updateText3DProperties: (clipId: string, props: Partial<Text3DProperties>) => void;
}

export interface CameraClipActions {
  addCameraClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
}

export interface SplatEffectorClipActions {
  addSplatEffectorClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
}

export interface ClipEffectActions {
  addClipEffect: (clipId: string, effectType: string) => string;
  removeClipEffect: (clipId: string, effectId: string) => void;
  updateClipEffect: (clipId: string, effectId: string, params: Partial<Effect['params']>) => void;
  setClipEffectEnabled: (clipId: string, effectId: string, enabled: boolean) => void;
  reorderClipEffect: (clipId: string, effectId: string, newIndex: number) => void;
  addClipAudioEffectInstance: (clipId: string, descriptorId: string) => string | null;
  removeClipAudioEffectInstance: (clipId: string, effectId: string) => void;
  updateClipAudioEffectInstance: (clipId: string, effectId: string, params: Partial<AudioEffectInstance['params']>) => void;
  setClipAudioEffectInstanceEnabled: (clipId: string, effectId: string, enabled: boolean) => void;
  reorderClipAudioEffectInstance: (clipId: string, effectId: string, newIndex: number) => void;
}

export interface ColorCorrectionActions {
  ensureColorCorrection: (clipId: string) => void;
  updateColorCorrection: (clipId: string, updater: (current: ColorCorrectionState) => ColorCorrectionState) => void;
  setColorCorrectionEnabled: (clipId: string, enabled: boolean) => void;
  setColorViewMode: (clipId: string, viewMode: ColorViewMode) => void;
  setColorWorkspaceViewport: (clipId: string, viewport: NonNullable<ColorCorrectionState['ui']['workspaceViewport']>) => void;
  selectColorNode: (clipId: string, nodeId: string | undefined) => void;
  addColorNode: (clipId: string, type?: ColorNodeType) => string;
  removeColorNode: (clipId: string, nodeId: string) => void;
  moveColorNode: (clipId: string, nodeId: string, position: { x: number; y: number }) => void;
  connectColorNodes: (clipId: string, fromNodeId: string, toNodeId: string) => void;
  removeColorEdge: (clipId: string, edgeId: string) => void;
  updateColorNodeParam: (clipId: string, versionId: string, nodeId: string, paramName: string, value: ColorParamValue) => void;
  setColorNodeEnabled: (clipId: string, nodeId: string, enabled: boolean) => void;
  renameColorNode: (clipId: string, nodeId: string, name: string) => void;
  resetColorNode: (clipId: string, nodeId: string) => void;
  resetColorCorrection: (clipId: string) => void;
  duplicateColorVersion: (clipId: string) => string;
  deleteColorVersion: (clipId: string, versionId: string) => void;
  setActiveColorVersion: (clipId: string, versionId: string) => void;
}

export interface LinkedGroupActions {
  createLinkedGroup: (clipIds: string[], offsets: Map<string, number>) => void;
  unlinkGroup: (clipId: string) => void;
  linkClips: (clipIds: string[]) => void;
  unlinkClips: (clipIds: string[]) => void;
}

export interface DownloadClipActions {
  addPendingDownloadClip: (trackId: string, startTime: number, videoId: string, title: string, thumbnail: string, estimatedDuration?: number) => string;
  updateDownloadProgress: (clipId: string, progress: number, speed?: string) => void;
  completeDownload: (clipId: string, file: File) => Promise<void>;
  setDownloadError: (clipId: string, error: string) => void;
}

export type ClipTransformUpdate = Omit<Partial<ClipTransform>, 'position' | 'scale' | 'rotation'> & {
  position?: Partial<ClipTransform['position']>;
  scale?: Partial<ClipTransform['scale']>;
  rotation?: Partial<ClipTransform['rotation']>;
};

export interface AddClipOptions {
  name?: string;
  signalAssetId?: string;
  signalRefId?: string;
  signalRenderAdapterId?: string;
  source?: Partial<NonNullable<TimelineClip['source']>>;
}

export interface GenerateClipAudioAnalysisOptions {
  force?: boolean;
  previewOnly?: boolean;
  derivedOnly?: boolean;
}

export interface CoreClipActions {
  addClip: (
    trackId: string,
    file: File,
    startTime: number,
    estimatedDuration?: number,
    mediaFileId?: string,
    mediaTypeOverride?: string,
    options?: AddClipOptions,
  ) => Promise<string | undefined>;
  addCompClip: (trackId: string, composition: Composition, startTime: number) => Promise<void>;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  removeClip: (id: string) => void;
  moveClip: (id: string, newStartTime: number, newTrackId?: string, skipLinked?: boolean, skipGroup?: boolean, skipTrim?: boolean, excludeClipIds?: string[]) => void;
  trimClip: (id: string, inPoint: number, outPoint: number) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  splitClipAtPlayhead: () => void;
  updateClipTransform: (id: string, transform: ClipTransformUpdate) => void;
  toggleClipReverse: (id: string) => void;
  generateWaveformForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => Promise<void>;
  generateProcessedWaveformForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => Promise<void>;
  generateSpectrogramForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => Promise<void>;
  generateLoudnessForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => Promise<void>;
  generateBeatOnsetForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => Promise<void>;
  generateFrequencyPhaseForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => Promise<void>;
  cancelAudioAnalysisForClip: (clipId: string) => void;
  setClipParent: (clipId: string, parentClipId: string | null) => void;
  getClipChildren: (clipId: string) => TimelineClip[];
  setClipPreservesPitch: (clipId: string, preservesPitch: boolean) => void;
  refreshCompClipNestedData: (sourceCompositionId: string) => Promise<void>;
  toggle3D: (clipId: string) => void;
}

export type ClipActions =
  CoreClipActions &
  TextClipActions &
  SolidClipActions &
  MidiClipActions &
  MathSceneClipActions &
  MotionClipActions &
  MeshClipActions &
  CameraClipActions &
  SplatEffectorClipActions &
  ClipEffectActions &
  ColorCorrectionActions &
  LinkedGroupActions &
  DownloadClipActions;
