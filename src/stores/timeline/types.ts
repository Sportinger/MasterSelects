// Timeline store types and interfaces

import type {
  TimelineClip,
  TimelineTrack,
  ClipTransform,
  CompositionTimelineData,
  Keyframe,
  AnimatableProperty,
  EasingType,
  BezierHandle,
  ClipMask,
  MaskVertex,
  MaskVertexHandleMode,
  Effect,
  ColorCorrectionState,
  ColorNodeType,
  ColorParamValue,
  ColorViewMode,
  RuntimeColorGrade,
  MasterAudioState,
  AudioExportPreflightState,
  TrackAudioState,
  AudioMeterSnapshot,
  RuntimeAudioMeterState,
  TextClipProperties,
  Text3DProperties,
  TextBoundsPath,
  MathSceneDefinition,
  MathObject,
  MathParameter,
  Layer,
  NodeGraphConnectionRequest,
  NodeGraphLayout,
  ClipCustomNodeParamDefinition,
  ClipCustomNodeParamValue,
  SerializableClip,
  ClipAudioEditOperation,
  ClipAudioRegionGainPreview,
  AudioEffectInstance,
  AudioSendState,
  SpectralImageLayer,
  VideoBakeRegion,
  ClipAudioState,
  ClipAudioStemState,
  AudioStemKind,
} from '../../types';
import type { MidiNote, MidiInstrument } from '../../types/midiClip';
import type { MotionColor, MotionLayerDefinition, ShapePrimitive } from '../../types/motionDesign';
import type { Composition } from '../mediaStore';
import type { LabelColor } from '../mediaStore/types';
import type { VectorAnimationClipSettings } from '../../types/vectorAnimation';
import type { MarkerMIDIBinding } from '../../types/midi';
import type { AudioSilenceDetectionOptions, AudioSilenceRange } from '../../services/audio/audioSilenceDetection';
import type { AudioTransientDetectionOptions, AudioTransientRange } from '../../services/audio/audioTransientDetection';
import type { StemSeparationBackend } from '../../services/audio/stemSeparation';
import type {
  ApplyTimelineEditOperationOptions,
  TimelineEditOperation,
  TimelineEditResult,
  TimelineEditOperationSource,
  TimelinePlacementMode,
} from './editOperations/types';

// Re-export imported types for convenience
export type {
  TimelineClip,
  TimelineTrack,
  ClipTransform,
  CompositionTimelineData,
  Keyframe,
  AnimatableProperty,
  EasingType,
  BezierHandle,
  ClipMask,
  MaskVertex,
  MaskVertexHandleMode,
  Effect,
  ColorCorrectionState,
  ColorNodeType,
  ColorParamValue,
  ColorViewMode,
  RuntimeColorGrade,
  Composition,
  TextClipProperties,
  Text3DProperties,
  TextBoundsPath,
  MathSceneDefinition,
  MathObject,
  MathParameter,
  Layer,
  SerializableClip,
};

// Mask edit mode types
export type MaskEditMode = 'none' | 'drawing' | 'editing' | 'drawingRect' | 'drawingEllipse' | 'drawingPen';

// Timeline tool mode types
export type TimelineToolMode = 'select' | 'cut';
export type TimelineToolGroupId =
  | 'selection'
  | 'cut'
  | 'trim'
  | 'placement'
  | 'navigation';

export type TimelineToolKind = 'mode' | 'command';

export type TimelineToolId =
  | 'select'
  | 'track-select-forward'
  | 'track-select-backward'
  | 'track-select-forward-all'
  | 'range-select'
  | 'blade'
  | 'blade-all-tracks'
  | 'split-at-playhead'
  | 'split-all-at-playhead'
  | 'trim-start-to-playhead'
  | 'trim-end-to-playhead'
  | 'ripple-trim-start-to-playhead'
  | 'ripple-trim-end-to-playhead'
  | 'ripple-delete'
  | 'delete-gap'
  | 'lift-range'
  | 'extract-range'
  | 'edge-trim'
  | 'ripple-trim'
  | 'rolling-edit'
  | 'slip'
  | 'slide'
  | 'rate-stretch'
  | 'position-overwrite'
  | 'insert'
  | 'overwrite'
  | 'replace'
  | 'fit-to-fill'
  | 'append-at-end'
  | 'place-on-top'
  | 'ripple-overwrite'
  | 'hand'
  | 'zoom'
  | 'marker'
  | 'in-point'
  | 'out-point'
  | 'pen-keyframe'
  | 'midi-draw';

export type TimelineToolPreviewPlane = 'clip-local' | 'section-scrolled' | 'global-fixed';

export interface TimelineRangeSelection {
  startTime: number;
  endTime: number;
  trackIds: string[];
  anchorTrackId?: string;
}

export type TimelineToolPreviewGhostVariant =
  | 'trim-target'
  | 'ripple-shift'
  | 'rolling-neighbor'
  | 'rate-stretch'
  | 'transition-drop';

export interface TimelineToolPreviewGhostRange {
  id: string;
  trackId: string;
  startTime: number;
  endTime: number;
  label?: string;
  variant?: TimelineToolPreviewGhostVariant;
}

export interface TimelineToolPreview {
  toolId: TimelineToolId;
  plane: TimelineToolPreviewPlane;
  trackId?: string;
  trackIds?: string[];
  clipId?: string;
  time?: number;
  startTime?: number;
  endTime?: number;
  sourceInPoint?: number;
  sourceOutPoint?: number;
  label?: string;
  blocked?: boolean;
  message?: string;
  ghostRanges?: TimelineToolPreviewGhostRange[];
  zIndex?: number;
}

export type LastTimelineToolByGroup = Record<TimelineToolGroupId, TimelineToolId>;

export interface TimelineClipDragPreviewPatch {
  startTime: number;
  trackId?: string;
}

export interface TimelineClipDragPreview {
  patches: Record<string, TimelineClipDragPreviewPatch>;
}

// Timeline audio display mode. Detailed remains waveform-backed today; spectral
// reserves the inline image lane used by spectrogram tile artifacts.
export type TimelineAudioDisplayMode = 'compact' | 'detailed' | 'spectral';
export type TimelineTrackFocusMode = 'balanced' | 'audio' | 'video';

export type TimelinePropertiesSelection =
  | { kind: 'clip'; clipId: string }
  | { kind: 'track'; trackId: string }
  | { kind: 'master' }
  | null;

export interface TimelineAudioRegionSelection {
  clipId: string;
  trackId: string;
  startTime: number;
  endTime: number;
  sourceInPoint: number;
  sourceOutPoint: number;
  snappedToZeroCrossing?: boolean;
}

export interface TimelineSpectralRegionSelection extends TimelineAudioRegionSelection {
  frequencyMinHz: number;
  frequencyMaxHz: number;
  selectionMode?: 'rectangle' | 'brush';
  brushTimeRadiusSeconds?: number;
  brushFrequencyRadiusHz?: number;
}

export interface TimelineAudioRegionClipboard {
  sourceClipId: string;
  sourceTrackId: string;
  sourceMediaFileId?: string;
  sourceAudioRevisionId?: string;
  startTime: number;
  endTime: number;
  sourceInPoint: number;
  sourceOutPoint: number;
  duration: number;
  copiedAt: number;
}

export interface TimelineVideoBakeRegionSelection {
  scope: VideoBakeRegion['scope'];
  startTime: number;
  endTime: number;
  clipId?: string;
  trackId?: string;
  sourceInPoint?: number;
  sourceOutPoint?: number;
}

export type TimelineAudioRegionEditType = Extract<
  ClipAudioEditOperation['type'],
  | 'silence'
  | 'gain'
  | 'cut'
  | 'paste'
  | 'insert-silence'
  | 'delete-silence'
  | 'reverse'
  | 'invert-polarity'
  | 'swap-channels'
  | 'mono-sum'
  | 'split-stereo'
  | 'repair'
  | 'effect'
  | 'room-tone-fill'
>;

export type TimelineSpectralRegionEditType = Extract<
  ClipAudioEditOperation['type'],
  'spectral-mask' | 'spectral-resynthesis'
>;

// AI action visual feedback types
export type AIActionOverlayType = 'split-glow' | 'delete-ghost' | 'trim-highlight' | 'silent-zone' | 'low-quality-zone';

export interface AIActionOverlay {
  id: string;
  type: AIActionOverlayType;
  trackId: string;
  timePosition: number;   // timeline seconds
  width?: number;          // duration in seconds (for delete ghost)
  clipName?: string;       // display name (for delete ghost)
  clipColor?: string;      // background color (for delete ghost)
  createdAt: number;
  duration: number;        // animation duration in ms
  animationDelay?: number; // delay before animation starts in ms (for staggering)
}

export interface AIMovingClip {
  clipId: string;
  fromStartTime: number;   // old position in seconds
  animationDuration: number; // ms
  startedAt: number;
}

export interface PlaybackWarmupState {
  requestId: string;
  startedAt: number;
  targetTime: number;
  pendingVideoCount: number;
  totalVideoCount: number;
}

// Timeline marker type
export interface TimelineMarker {
  id: string;
  time: number;
  label: string;
  color: string;
  stopPlayback?: boolean;
  midiBindings?: MarkerMIDIBinding[];
}

// Timeline state interface
export interface TimelineState {
  // Core state
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  playheadPosition: number;
  duration: number;
  zoom: number;
  scrollX: number;
  trackHeaderWidth: number;
  timelineSplitRatio: number | null;
  snappingEnabled: boolean;
  isPlaying: boolean;
  isDraggingPlayhead: boolean;
  playbackWarmup: PlaybackWarmupState | null;
  selectedClipIds: Set<string>;
  primarySelectedClipId: string | null; // The clip the user actually clicked (for Properties panel)
  propertiesSelection: TimelinePropertiesSelection;
  targetTrackIdByType: Partial<Record<'video' | 'audio' | 'midi', string>>;

  // Render layers (populated by useLayerSync from timeline clips, used by engine)
  layers: Layer[];
  selectedLayerId: string | null;

  // In/Out markers
  inPoint: number | null;
  outPoint: number | null;
  loopPlayback: boolean;

  // Playback speed (1 = normal, 2 = 2x, -1 = reverse, etc.)
  playbackSpeed: number;

  // Duration lock (when true, duration won't auto-update based on clips)
  durationLocked: boolean;

  // RAM Preview state
  ramPreviewEnabled: boolean;
  ramPreviewProgress: number | null;
  ramPreviewRange: { start: number; end: number } | null;
  isRamPreviewing: boolean;
  cachedFrameTimes: Set<number>;

  // Proxy cache preloading state
  isProxyCaching: boolean;
  proxyCacheProgress: number | null;  // 0-100 percentage

  // Export progress state
  isExporting: boolean;
  exportProgress: number | null;  // 0-100 percentage
  exportCurrentTime: number | null;  // Current time being rendered
  exportRange: { start: number; end: number } | null;
  exportPreviewFrame: ImageBitmap | null;  // Latest frame captured from the export pipeline
  exportPreviewFrameTime: number | null;

  // Performance toggles
  thumbnailsEnabled: boolean;
  waveformsEnabled: boolean;
  audioDisplayMode: TimelineAudioDisplayMode;
  audioLayerAdvancedMode: boolean;
  audioFocusMode: boolean;
  trackFocusMode: TimelineTrackFocusMode;
  audioRegionSelection: TimelineAudioRegionSelection | null;
  videoBakeRegionSelection: TimelineVideoBakeRegionSelection | null;
  videoBakeRegions: VideoBakeRegion[];
  audioRegionGainPreview: ClipAudioRegionGainPreview | null;
  audioSpectralRegionSelection: TimelineSpectralRegionSelection | null;
  audioRegionClipboard: TimelineAudioRegionClipboard | null;
  showAudioRegionEditMarkers: boolean;
  showTranscriptMarkers: boolean;

  // Stem separation transient job state plus lightweight completed stem choices.
  clipStemSeparationJobs: Record<string, ClipStemSeparationJobState>;

  // Keyframe animation state
  clipKeyframes: Map<string, Keyframe[]>;
  keyframeRecordingEnabled: Set<string>;
  expandedTracks: Set<string>;
  expandedTrackPropertyGroups: Map<string, Set<string>>;
  selectedKeyframeIds: Set<string>;
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;  // trackId -> expanded curve editors
  curveEditorHeight: number;

  // Mask state
  maskEditMode: MaskEditMode;
  maskPanelActive: boolean;
  activeMaskId: string | null;
  selectedVertexIds: Set<string>;
  maskDrawStart: { x: number; y: number } | null;
  maskDragging: boolean; // True during vertex/mask drag - skips texture regeneration

  // Tool mode
  toolMode: TimelineToolMode;
  activeTimelineToolId: TimelineToolId;
  previousTimelineToolId: TimelineToolId | null;
  lastTimelineToolByGroup: LastTimelineToolByGroup;
  openTimelineToolGroupId: TimelineToolGroupId | null;
  momentaryTimelineToolId: TimelineToolId | null;
  timelineRangeSelection: TimelineRangeSelection | null;
  timelineToolPreview: TimelineToolPreview | null;
  clipDragPreview: TimelineClipDragPreview | null;

  // Timeline markers
  markers: TimelineMarker[];

  // Advanced audio workstation state for the composition master bus.
  masterAudioState?: MasterAudioState;
  runtimeAudioMeters: RuntimeAudioMeterState;

  // Clip entrance animation key (increments on composition switch to trigger animations)
  clipEntranceAnimationKey: number;

  // Clip animation phase for enter/exit transitions
  clipAnimationPhase: 'idle' | 'exiting' | 'entering';

  // Direction derived from composition tab positions
  compositionSwitchDirection: 'forward' | 'backward';

  // Target track layout shown while old clips exit during a composition switch
  compositionSwitchTargetTracks: TimelineTrack[] | null;

  // Slot grid view progress (0 = full timeline, 1 = full grid view)
  slotGridProgress: number;

  // AI action visual feedback (transient, not serialized)
  aiActionOverlays: AIActionOverlay[];
  aiMovingClips: Map<string, AIMovingClip>;

  // Incremented whenever the live timeline is cleared/reloaded.
  // Async callbacks must verify this to avoid writing stale nested clip UI.
  timelineSessionId: number;
}

// Track actions interface
export interface TrackActions {
  addTrack: (type: 'video' | 'audio' | 'midi') => string;
  removeTrack: (id: string) => void;
  // Drag-reorder a track relative to another track in the same section (#layers/tracks)
  reorderTrack: (trackId: string, targetTrackId: string, placeBelow: boolean) => void;
  renameTrack: (id: string, name: string) => void;
  setTrackLabelColor: (id: string, labelColor: LabelColor) => void;
  setTrackMuted: (id: string, muted: boolean) => void;
  setTrackVisible: (id: string, visible: boolean) => void;
  setTrackSolo: (id: string, solo: boolean) => void;
  updateTrackAudioState: (id: string, patch: Partial<TrackAudioState>) => void;
  setTrackAudioVolumeDb: (id: string, volumeDb: number) => void;
  setTrackAudioPan: (id: string, pan: number) => void;
  addTrackAudioSend: (trackId: string, targetBusId?: string) => string | null;
  updateTrackAudioSend: (trackId: string, sendId: string, patch: Partial<AudioSendState>) => void;
  removeTrackAudioSend: (trackId: string, sendId: string) => void;
  addTrackAudioEffectInstance: (trackId: string, descriptorId: string) => string | null;
  removeTrackAudioEffectInstance: (trackId: string, effectId: string) => void;
  updateTrackAudioEffectInstance: (trackId: string, effectId: string, params: Partial<AudioEffectInstance['params']>) => void;
  setTrackAudioEffectInstanceEnabled: (trackId: string, effectId: string, enabled: boolean) => void;
  reorderTrackAudioEffectInstance: (trackId: string, effectId: string, newIndex: number) => void;
  updateMasterAudioState: (patch: Partial<MasterAudioState>) => void;
  setMasterAudioVolumeDb: (volumeDb: number) => void;
  setMasterLimiterEnabled: (enabled: boolean) => void;
  setMasterTruePeakCeilingDb: (truePeakCeilingDb: number) => void;
  setMasterTargetLufs: (targetLufs: number | undefined) => void;
  runAudioExportPreflight: (startTime?: number, endTime?: number, renderedBuffer?: AudioBuffer | null) => AudioExportPreflightState;
  addMasterAudioEffectInstance: (descriptorId: string) => string | null;
  removeMasterAudioEffectInstance: (effectId: string) => void;
  updateMasterAudioEffectInstance: (effectId: string, params: Partial<AudioEffectInstance['params']>) => void;
  setMasterAudioEffectInstanceEnabled: (effectId: string, enabled: boolean) => void;
  reorderMasterAudioEffectInstance: (effectId: string, newIndex: number) => void;
  updateRuntimeAudioMeter: (trackId: string, snapshot: AudioMeterSnapshot, masterSnapshot?: AudioMeterSnapshot) => void;
  clearStaleRuntimeAudioMeters: (maxAgeMs?: number, now?: number) => void;
  setTrackLocked: (id: string, locked: boolean) => void;
  setTrackHeight: (id: string, height: number) => void;
  scaleTracksOfType: (type: 'video' | 'audio' | 'midi', delta: number, baselineHeight?: number) => void;
  setTargetTrack: (trackId: string | null) => void;
  clearTargetTracks: () => void;
  // Track parenting (layer linking)
  setTrackParent: (trackId: string, parentTrackId: string | null) => void;
  getTrackChildren: (trackId: string) => TimelineTrack[];
  // MIDI instrument (issue #182): patch the synth/instrument on a MIDI track.
  setTrackMidiInstrument: (trackId: string, patch: Partial<MidiInstrument>) => void;
}

// Clip actions interface
// Text clip actions (extracted to textClipSlice)
export interface TextClipActions {
  addTextClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => Promise<string | null>;
  updateTextProperties: (clipId: string, props: Partial<TextClipProperties>) => void;
  updateTextBounds: (clipId: string, updates: Partial<TextBoundsPath>) => void;
  updateTextBoundsVertex: (clipId: string, vertexId: string, updates: Partial<MaskVertex>, recordKeyframe?: boolean) => void;
  updateTextBoundsVertices: (clipId: string, vertexUpdates: Array<{ vertexId: string; updates: Partial<MaskVertex> }>, recordKeyframe?: boolean) => void;
}

// Solid clip actions (extracted to solidClipSlice)
export interface SolidClipActions {
  addSolidClip: (trackId: string, startTime: number, color?: string, duration?: number, skipMediaItem?: boolean) => string | null;
  updateSolidColor: (clipId: string, color: string) => void;
}

// MIDI clip actions (issue #182, extracted to midiClipSlice).
export interface MidiClipActions {
  addMidiClip: (trackId: string, startTime: number, duration?: number) => string | null;
  // Note CRUD for the piano-roll editor. `start`/`duration` are seconds relative to clip start.
  addMidiNote: (clipId: string, note: { pitch: number; start: number; duration: number; velocity?: number }) => string | null;
  updateMidiNote: (
    clipId: string,
    noteId: string,
    patch: Partial<Pick<MidiNote, 'pitch' | 'start' | 'duration' | 'velocity'>>,
    options?: { captureHistory?: boolean },
  ) => void;
  removeMidiNote: (clipId: string, noteId: string) => void;
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

// Mesh clip actions (extracted to meshClipSlice)
export interface MeshClipActions {
  addMeshClip: (trackId: string, startTime: number, meshType: import('../mediaStore/types').MeshPrimitiveType, duration?: number, skipMediaItem?: boolean) => string | null;
  updateText3DProperties: (clipId: string, props: Partial<Text3DProperties>) => void;
}

// Camera clip actions (shared 3D scene camera)
export interface CameraClipActions {
  addCameraClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
}

export interface SplatEffectorClipActions {
  addSplatEffectorClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
}

// Clip effect actions (extracted to clipEffectSlice)
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

// Multicam linked group actions (extracted to linkedGroupSlice)
export interface LinkedGroupActions {
  createLinkedGroup: (clipIds: string[], offsets: Map<string, number>) => void;
  unlinkGroup: (clipId: string) => void;
  linkClips: (clipIds: string[]) => void;
  unlinkClips: (clipIds: string[]) => void;
}

// YouTube download clip actions (extracted to downloadClipSlice)
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

// Core clip actions (remain in clipSlice)
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

// Combined ClipActions = all sub-interfaces
export type ClipActions = CoreClipActions & TextClipActions & SolidClipActions & MidiClipActions & MathSceneClipActions & MotionClipActions & MeshClipActions & CameraClipActions & SplatEffectorClipActions & ClipEffectActions & ColorCorrectionActions & LinkedGroupActions & DownloadClipActions;

// Playback actions interface
export interface PlaybackActions {
  setPlayheadPosition: (position: number) => void;
  setDraggingPlayhead: (dragging: boolean) => void;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  setZoom: (zoom: number) => void;
  toggleSnapping: () => void;
  setScrollX: (scrollX: number) => void;
  setInPoint: (time: number | null) => void;
  setOutPoint: (time: number | null) => void;
  clearInOut: () => void;
  setInPointAtPlayhead: () => void;
  setOutPointAtPlayhead: () => void;
  setLoopPlayback: (loop: boolean) => void;
  toggleLoopPlayback: () => void;
  setPlaybackSpeed: (speed: number) => void;
  // JKL playback control
  playForward: () => void;
  playReverse: () => void;
  setDuration: (duration: number) => void;
  setTrackHeaderWidth: (width: number) => void;
  setTimelineSplitRatio: (ratio: number | null) => void;
  // Tool mode
  setToolMode: (mode: TimelineToolMode) => void;
  toggleCutTool: () => void;
  // Clip animation phase for composition transitions
  setClipAnimationPhase: (phase: 'idle' | 'exiting' | 'entering') => void;
  setCompositionSwitchDirection: (direction: 'forward' | 'backward') => void;
  setCompositionSwitchTargetTracks: (tracks: TimelineTrack[] | null) => void;
  // Slot grid view
  setSlotGridProgress: (progress: number) => void;
  // Performance toggles
  toggleThumbnailsEnabled: () => void;
  toggleWaveformsEnabled: () => void;
  setThumbnailsEnabled: (enabled: boolean) => void;
  setWaveformsEnabled: (enabled: boolean) => void;
  setAudioDisplayMode: (mode: TimelineAudioDisplayMode) => void;
  setAudioLayerAdvancedMode: (enabled: boolean) => void;
  toggleAudioLayerAdvancedMode: () => void;
  setAudioFocusMode: (enabled: boolean) => void;
  toggleAudioFocusMode: () => void;
  setTrackFocusMode: (mode: TimelineTrackFocusMode) => void;
  setAudioRegionSelection: (selection: TimelineAudioRegionSelection | null) => void;
  clearAudioRegionSelection: () => void;
  setAudioSpectralRegionSelection: (selection: TimelineSpectralRegionSelection | null) => void;
  clearAudioSpectralRegionSelection: () => void;
  toggleAudioRegionEditMarkers: () => void;
  setShowAudioRegionEditMarkers: (enabled: boolean) => void;
  toggleTranscriptMarkers: () => void;
  setShowTranscriptMarkers: (enabled: boolean) => void;
}

export interface TimelineToolActions {
  setActiveTimelineTool: (toolId: TimelineToolId) => void;
  activateTimelineToolGroup: (groupId: TimelineToolGroupId) => void;
  cycleTimelineToolGroup: (groupId: TimelineToolGroupId, direction?: 1 | -1) => void;
  setOpenTimelineToolGroup: (groupId: TimelineToolGroupId | null) => void;
  setMomentaryTimelineTool: (toolId: TimelineToolId) => void;
  clearMomentaryTimelineTool: () => void;
  setTimelineRangeSelection: (selection: TimelineRangeSelection | null) => void;
  clearTimelineRangeSelection: () => void;
  setTimelineToolPreview: (preview: TimelineToolPreview | null) => void;
}

export interface TimelineEditOperationActions {
  applyTimelineEditOperation: (
    operation: TimelineEditOperation,
    options: ApplyTimelineEditOperationOptions,
  ) => TimelineEditResult;
  splitAllClipsAtTime: (time: number, trackIds?: string[]) => TimelineEditResult;
  selectClipsFromTime: (
    time: number,
    options?: {
      direction?: 'forward' | 'backward';
      trackIds?: string[];
      includeLinked?: boolean;
    },
  ) => TimelineEditResult;
  rippleDeleteSelection: (clipIds?: string[]) => TimelineEditResult;
  deleteGapAtTime: (time: number, trackIds?: string[]) => TimelineEditResult;
  deleteAllGaps: (trackIds?: string[], startTime?: number) => TimelineEditResult;
  trimSelectedClipEdgeToPlayhead: (edge: 'start' | 'end') => TimelineEditResult;
  rippleTrimSelectedClipEdgeToPlayhead: (edge: 'start' | 'end') => TimelineEditResult;
  prepareTimelinePlacementRange: (
    mode: TimelinePlacementMode,
    options: {
      trackIds?: string[];
      startTime?: number;
      duration?: number;
      targetClipId?: string;
      includeLinked?: boolean;
      rippleDelta?: number;
      source?: TimelineEditOperationSource;
      historyLabel?: string;
    },
  ) => TimelineEditResult;
  liftTimelineRange: () => TimelineEditResult;
  extractTimelineRange: () => TimelineEditResult;
}

export interface ApplyAudioRegionEditOptions {
  channelMask?: number[];
  keepSelection?: boolean;
  params?: ClipAudioEditOperation['params'];
}

export interface ApplyAudioRegionGainEditOptions {
  gainDb: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  keepSelection?: boolean;
}

export interface SetClipAudioEditOperationRangeOptions {
  captureHistory?: boolean;
  historyLabel?: string;
}

export interface ApplyAudioRepairSuggestionInput {
  id: string;
  kind: string;
  label: string;
  severity?: string;
  confidence?: number;
  reason?: string;
  operation: {
    editType: Extract<ClipAudioEditOperation['type'], 'repair' | 'mono-sum'>;
    params?: ClipAudioEditOperation['params'];
  };
  evidence?: ClipAudioEditOperation['params'];
}

export interface ApplyDetectedSilenceRemovalOptions {
  detection?: AudioSilenceDetectionOptions;
  ranges?: AudioSilenceRange[];
  rippleTimeline?: boolean;
}

export interface ApplyRoomToneFillOptions {
  targetRange?: { start: number; end: number };
  sourceRanges?: AudioSilenceRange[];
  detection?: AudioSilenceDetectionOptions;
  gainDb?: number;
  crossfadeSeconds?: number;
}

export interface ApplyDetectedTransientSofteningOptions {
  detection?: AudioTransientDetectionOptions;
  ranges?: AudioTransientRange[];
  gainDb?: number;
  attackSeconds?: number;
  releaseSeconds?: number;
}

export interface ApplySpectralRegionEditOptions {
  channelMask?: number[];
  keepSelection?: boolean;
  params?: ClipAudioEditOperation['params'];
}

export type AddClipSpectralImageLayerInput = Omit<SpectralImageLayer, 'id'> & {
  id?: string;
};

export type ClipStemSeparationJobPhase =
  | 'queued'
  | 'preparing'
  | 'downloading-model'
  | 'loading-model'
  | 'separating'
  | 'storing'
  | 'complete'
  | 'cancelled'
  | 'failed';

export interface ClipStemSeparationJobState {
  jobId: string;
  clipId: string;
  requestedClipId: string;
  sourceMediaFileId?: string;
  modelId: string;
  phase: ClipStemSeparationJobPhase;
  progress: number;
  stems?: ClipStemSeparationJobStemChoice[];
  backend?: StemSeparationBackend;
  message?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface ClipStemSeparationJobStemChoice {
  id: string;
  kind: AudioStemKind;
  label: string;
  mediaFileId: string;
}

export interface StartClipStemSeparationOptions {
  modelId?: string;
  force?: boolean;
  range?: { start: number; end: number };
}

export interface ClipStemSeparationProgressUpdate {
  phase?: ClipStemSeparationJobPhase;
  progress?: number;
  sourceMediaFileId?: string;
  stems?: ClipStemSeparationJobStemChoice[];
  backend?: StemSeparationBackend;
  message?: string;
  error?: string;
}

export interface ClipStemSeparationRunnerRequest {
  jobId: string;
  clip: TimelineClip;
  requestedClip: TimelineClip;
  options: StartClipStemSeparationOptions;
  signal: AbortSignal;
  updateProgress: (update: ClipStemSeparationProgressUpdate) => void;
}

export type ClipStemSeparationRunner = (
  request: ClipStemSeparationRunnerRequest,
) => Promise<ClipAudioStemState | null>;

export interface AudioEditActions {
  applyAudioRegionEdit: (type: TimelineAudioRegionEditType, options?: ApplyAudioRegionEditOptions) => string | null;
  setAudioRegionGainPreview: (preview: ClipAudioRegionGainPreview | null) => void;
  clearAudioRegionGainPreview: () => void;
  setAudioRegionGainEdit: (options: ApplyAudioRegionGainEditOptions) => string | null;
  setClipAudioEditOperationRange: (
    clipId: string,
    operationIds: string[],
    selection: TimelineAudioRegionSelection,
    options?: SetClipAudioEditOperationRangeOptions,
  ) => void;
  applyAudioRepairSuggestion: (clipId: string, suggestion: ApplyAudioRepairSuggestionInput) => string | null;
  detectClipSilenceRanges: (clipId: string, options?: AudioSilenceDetectionOptions) => Promise<AudioSilenceRange[]>;
  applyDetectedSilenceRemoval: (clipId: string, options?: ApplyDetectedSilenceRemovalOptions) => Promise<string[]>;
  applyRoomToneFill: (clipId: string, options?: ApplyRoomToneFillOptions) => Promise<string | null>;
  detectClipTransientRanges: (clipId: string, options?: AudioTransientDetectionOptions) => Promise<AudioTransientRange[]>;
  applyDetectedTransientSoftening: (clipId: string, options?: ApplyDetectedTransientSofteningOptions) => Promise<string[]>;
  copySelectedAudioRegion: () => boolean;
  pasteAudioRegionToSelection: () => string | null;
  setClipAudioEditOperationEnabled: (clipId: string, operationId: string, enabled: boolean) => void;
  removeClipAudioEditOperation: (clipId: string, operationId: string) => void;
  clearClipAudioEditStack: (clipId: string) => void;
  bakeClipAudioEditStack: (clipId: string) => Promise<string | null>;
  unbakeClipAudioEditStack: (clipId: string) => boolean;
  applySpectralRegionEdit: (type: TimelineSpectralRegionEditType, options?: ApplySpectralRegionEditOptions) => string | null;
  addClipSpectralImageLayer: (clipId: string, layer: AddClipSpectralImageLayerInput) => string | null;
  updateClipSpectralImageLayer: (clipId: string, layerId: string, patch: Partial<SpectralImageLayer>) => void;
  removeClipSpectralImageLayer: (clipId: string, layerId: string) => void;
}

export interface StemSeparationActions {
  startClipStemSeparation: (
    clipId: string,
    options?: StartClipStemSeparationOptions,
  ) => Promise<string | null>;
  cancelClipStemSeparation: (clipId: string) => void;
  setClipStemMixMode: (clipId: string, mixMode: ClipAudioStemState['mixMode']) => void;
  setClipStemSourceGain: (clipId: string, gainDb: number) => void;
  setClipStemSolo: (clipId: string, stemId: string | null) => void;
  setClipStemEnabled: (clipId: string, stemId: string, enabled: boolean) => void;
  setClipStemGain: (clipId: string, stemId: string, gainDb: number) => void;
  prewarmStemSourceMediaFiles: (stemMediaFileIds: readonly string[]) => number;
  setClipSourceToStem: (clipId: string, stemMediaFileId: string) => boolean;
  relinkClipStemSeparationJobsFromMediaLibrary: () => number;
  syncClipStemSeparationCopies: (clipId: string) => number;
  clearClipStemSeparation: (clipId: string) => void;
}

// RAM Preview actions interface
export interface RamPreviewActions {
  toggleRamPreviewEnabled: () => void;
  startRamPreview: () => Promise<void>;
  startRamPreviewForRange: (
    start: number,
    end: number,
    options?: { centerTime?: number; label?: string },
  ) => Promise<boolean>;
  cancelRamPreview: () => void;
  clearRamPreview: () => void;
  addCachedFrame: (time: number) => void;
  getCachedRanges: () => Array<{ start: number; end: number }>;
}

export interface VideoBakeActions {
  setVideoBakeRegionSelection: (selection: TimelineVideoBakeRegionSelection | null) => void;
  clearVideoBakeRegionSelection: () => void;
  addCompositionVideoBakeRegion: (startTime: number, endTime: number) => string | null;
  bakeCompositionVideoBakeRegion: (regionId: string) => Promise<boolean>;
  unbakeCompositionVideoBakeRegion: (regionId: string) => boolean;
  removeCompositionVideoBakeRegion: (regionId: string) => boolean;
  addClipVideoBakeRegion: (
    clipId: string,
    selection: Omit<TimelineVideoBakeRegionSelection, 'scope' | 'clipId'>,
  ) => string | null;
  bakeClipVideoBakeRegion: (clipId: string, regionId: string) => Promise<boolean>;
  unbakeClipVideoBakeRegion: (clipId: string, regionId: string) => boolean;
  removeClipVideoBakeRegion: (clipId: string, regionId: string) => boolean;
}

// Proxy cache actions interface
export interface ProxyCacheActions {
  getProxyCachedRanges: () => Array<{ start: number; end: number }>;
  getScrubCachedRanges: () => Array<{ start: number; end: number }>;
  invalidateCache: () => void;
  startProxyCachePreload: () => Promise<void>;
  cancelProxyCachePreload: () => void;
}

// Export progress actions interface
export interface ExportActions {
  setExportProgress: (progress: number | null, currentTime: number | null) => void;
  setExportPreviewFrame: (frame: ImageBitmap | null, currentTime: number | null) => void;
  startExport: (start: number, end: number) => void;
  endExport: () => void;
}

// Selection actions interface
export interface SelectionActions {
  // Clip selection (multi-select support)
  selectClip: (id: string | null, addToSelection?: boolean, setPrimaryOnly?: boolean) => void;
  selectClips: (ids: string[]) => void;
  addClipToSelection: (id: string) => void;
  removeClipFromSelection: (id: string) => void;
  clearClipSelection: () => void;
  selectTrackProperties: (trackId: string) => void;
  selectMasterProperties: () => void;
  clearPropertiesSelection: () => void;
  // Keyframe selection
  selectKeyframe: (keyframeId: string, addToSelection?: boolean) => void;
  deselectAllKeyframes: () => void;
  deleteSelectedKeyframes: () => void;
}

// Keyframe actions interface
export interface KeyframeActions {
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number, time?: number, easing?: string | null) => void;
  removeKeyframe: (keyframeId: string) => void;
  updateKeyframe: (keyframeId: string, updates: Partial<Omit<Keyframe, 'id' | 'clipId' | 'easing'>> & { easing?: string | null }) => void;
  moveKeyframe: (keyframeId: string, newTime: number) => void;
  moveKeyframes: (keyframeIds: string[], newTime: number) => void;
  getClipKeyframes: (clipId: string) => Keyframe[];
  getInterpolatedTransform: (clipId: string, clipLocalTime: number) => ClipTransform;
  getInterpolatedCameraSettings: (clipId: string, clipLocalTime: number) => import('../mediaStore/types').SceneCameraSettings;
  getInterpolatedEffects: (clipId: string, clipLocalTime: number) => Effect[];
  getInterpolatedNodeGraphParams: (clipId: string, nodeId: string, clipLocalTime: number) => Record<string, ClipCustomNodeParamValue>;
  getInterpolatedColorCorrection: (clipId: string, clipLocalTime: number) => RuntimeColorGrade | undefined;
  getInterpolatedVectorAnimationSettings: (clipId: string, clipLocalTime: number) => VectorAnimationClipSettings;
  getInterpolatedMasks: (clipId: string, clipLocalTime: number) => ClipMask[] | undefined;
  getInterpolatedTextBounds: (clipId: string, clipLocalTime: number) => TextBoundsPath | undefined;
  getInterpolatedSpeed: (clipId: string, clipLocalTime: number) => number;
  getSourceTimeForClip: (clipId: string, clipLocalTime: number) => number;
  hasKeyframes: (clipId: string, property?: AnimatableProperty) => boolean;
  toggleKeyframeRecording: (clipId: string, property: AnimatableProperty) => void;
  isRecording: (clipId: string, property: AnimatableProperty) => boolean;
  setPropertyValue: (clipId: string, property: AnimatableProperty, value: number) => void;
  addMaskPathKeyframe: (
    clipId: string,
    maskId: string,
    pathValue?: Keyframe['pathValue'],
    time?: number,
    easing?: string | null,
    options?: { phase?: 'update' | 'commit'; source?: TimelineEditOperationSource; historyLabel?: string },
  ) => void;
  recordMaskPathKeyframe: (clipId: string, maskId: string) => void;
  disableMaskPathKeyframes: (clipId: string, maskId: string, pathValue?: Keyframe['pathValue']) => void;
  addTextBoundsPathKeyframe: (
    clipId: string,
    pathValue?: Keyframe['pathValue'],
    time?: number,
    easing?: string | null,
    options?: { phase?: 'update' | 'commit'; source?: TimelineEditOperationSource; historyLabel?: string },
  ) => void;
  recordTextBoundsPathKeyframe: (clipId: string) => void;
  disableTextBoundsPathKeyframes: (clipId: string, pathValue?: Keyframe['pathValue']) => void;
  toggleTrackExpanded: (trackId: string) => void;
  isTrackExpanded: (trackId: string) => boolean;
  toggleTrackPropertyGroupExpanded: (trackId: string, groupName: string) => void;
  isTrackPropertyGroupExpanded: (trackId: string, groupName: string) => boolean;
  getExpandedTrackHeight: (trackId: string, baseHeight: number) => number;
  trackHasKeyframes: (trackId: string) => boolean;
  // Curve editor expansion
  toggleCurveExpanded: (trackId: string, property: AnimatableProperty) => void;
  isCurveExpanded: (trackId: string, property: AnimatableProperty) => boolean;
  setCurveEditorHeight: (height: number) => void;
  // Bezier handle manipulation
  updateBezierHandle: (keyframeId: string, handle: 'in' | 'out', position: BezierHandle) => void;
  // Disable keyframes for a property: save current value as static, remove all keyframes, disable recording
  disablePropertyKeyframes: (clipId: string, property: AnimatableProperty, currentValue: number) => void;
}

// Layer actions interface (render layers for engine)
export interface LayerActions {
  setLayers: (layers: Layer[]) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  selectLayer: (id: string | null) => void;
}

// Marker actions interface
export interface MarkerActions {
  addMarker: (time: number, label?: string, color?: string) => string;
  removeMarker: (markerId: string) => void;
  updateMarker: (markerId: string, updates: Partial<Omit<TimelineMarker, 'id'>>) => void;
  moveMarker: (markerId: string, newTime: number) => void;
  clearMarkers: () => void;
}

// Transition actions interface
export interface TransitionActions {
  applyTransition: (
    clipAId: string,
    clipBId: string,
    type: string,
    duration: number,
    options?: { source?: TimelineEditOperationSource; historyLabel?: string },
  ) => TimelineEditResult;
  removeTransition: (
    clipId: string,
    edge: 'in' | 'out',
    options?: { source?: TimelineEditOperationSource; historyLabel?: string },
  ) => TimelineEditResult;
  updateTransitionDuration: (
    clipId: string,
    edge: 'in' | 'out',
    duration: number,
    options?: { source?: TimelineEditOperationSource; historyLabel?: string },
  ) => TimelineEditResult;
  findClipJunction: (trackId: string, time: number, threshold?: number) => { clipA: TimelineClip; clipB: TimelineClip; junctionTime: number } | null;
}

export interface NodeGraphActions {
  ensureClipNodeGraph: (clipId: string) => void;
  addClipAICustomNode: (clipId: string) => string | null;
  addClipAICustomNodeFromPort: (clipId: string, source: {
    fromNodeId: string;
    fromPortId: string;
    label?: string;
  }) => string | null;
  updateClipAICustomNode: (clipId: string, nodeId: string, updates: {
    label?: string;
    description?: string;
    bypassed?: boolean;
    params?: Record<string, ClipCustomNodeParamValue>;
    parameterSchema?: ClipCustomNodeParamDefinition[];
    status?: import('../../types').ClipCustomNodeAuthoringStatus;
    ai?: Partial<import('../../types').ClipCustomNodeAIAuthoring>;
  }) => void;
  removeClipNodeGraphNode: (clipId: string, nodeId: string) => void;
  showClipNodeGraphBuiltIn: (clipId: string, node: import('../../types').ClipNodeGraphForcedBuiltIn) => void;
  connectClipNodeGraphPorts: (clipId: string, connection: NodeGraphConnectionRequest) => void;
  disconnectClipNodeGraphEdge: (clipId: string, edgeId: string) => void;
  moveClipNodeGraphNode: (clipId: string, nodeId: string, layout: NodeGraphLayout) => void;
}

// Clipboard data for copy/paste
export interface ClipboardClipData {
  // Serializable clip data (without DOM elements)
  id: string;
  trackId: string;
  trackType: 'video' | 'audio' | 'midi';
  name: string;
  mediaFileId?: string;
  signalAssetId?: string;
  signalRefId?: string;
  signalRenderAdapterId?: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  sourceType: SerializableClip['sourceType'];
  naturalDuration?: number;
  transform: ClipTransform;
  effects: Effect[];
  colorCorrection?: ColorCorrectionState;
  nodeGraph?: import('../../types').ClipNodeGraph;
  masks?: ClipMask[];
  keyframes?: Keyframe[];
  linkedClipId?: string;
  reversed?: boolean;
  speed?: number;
  preservesPitch?: boolean;
  textProperties?: import('../../types').TextClipProperties;
  text3DProperties?: import('../../types').Text3DProperties;
  solidColor?: string;
  mathScene?: MathSceneDefinition;
  motion?: MotionLayerDefinition;
  vectorAnimationSettings?: VectorAnimationClipSettings;
  cameraSettings?: import('../mediaStore/types').SceneCameraSettings;
  meshType?: import('../mediaStore/types').MeshPrimitiveType;
  splatEffectorSettings?: import('../../types/splatEffector').SplatEffectorSettings;
  threeDEffectorsEnabled?: boolean;
  // Visual data (thumbnails, waveforms)
  thumbnails?: string[];
  waveform?: number[];
  waveformChannels?: number[][];
  audioAnalysisRefs?: Pick<ClipAudioState, 'processedAnalysisRefs' | 'sourceAnalysisRefs'>;
  // Composition clips
  isComposition?: boolean;
  compositionId?: string;
  is3D?: boolean;
  wireframe?: boolean;
}

// Clipboard data for keyframe copy/paste
export interface ClipboardKeyframeData {
  clipId: string;
  property: AnimatableProperty;
  time: number;        // relative time within the copied set (0 = earliest)
  value: number;
  pathValue?: Keyframe['pathValue'];
  easing: EasingType;
  rotationInterpolation?: Keyframe['rotationInterpolation'];
  handleIn?: BezierHandle;
  handleOut?: BezierHandle;
}

export interface ClipboardClipEffectsData {
  sourceClipId: string;
  effects: Effect[];
  keyframes: Keyframe[];
}

export interface ClipboardClipColorData {
  sourceClipId: string;
  colorCorrection: ColorCorrectionState;
  keyframes: Keyframe[];
}

export interface ClipboardState {
  clipboardData: ClipboardClipData[] | null;
  clipboardKeyframes: ClipboardKeyframeData[] | null;
  clipboardEffects: ClipboardClipEffectsData | null;
  clipboardColor: ClipboardClipColorData | null;
}

// Clipboard actions interface
export interface ClipboardActions {
  copyClips: () => void;
  pasteClips: () => void;
  hasClipboardData: () => boolean;
  copyKeyframes: () => void;
  pasteKeyframes: () => void;
  copyClipEffects: (clipId: string) => void;
  pasteClipEffects: (targetClipIds?: string[]) => void;
  hasClipboardEffects: () => boolean;
  copyClipColor: (clipId: string) => void;
  pasteClipColor: (targetClipIds?: string[]) => void;
  hasClipboardColor: () => boolean;
}

// Mask actions interface
export interface MaskActions {
  setMaskEditMode: (mode: MaskEditMode) => void;
  setMaskPanelActive: (active: boolean) => void;
  setMaskDragging: (dragging: boolean) => void;
  setMaskDrawStart: (point: { x: number; y: number } | null) => void;
  setActiveMask: (clipId: string | null, maskId: string | null) => void;
  selectVertex: (vertexId: string, addToSelection?: boolean) => void;
  selectVertices: (vertexIds: string[]) => void;
  deselectAllVertices: () => void;
  addMask: (clipId: string, mask?: Partial<ClipMask>) => string;
  removeMask: (clipId: string, maskId: string) => void;
  updateMask: (clipId: string, maskId: string, updates: Partial<ClipMask>) => void;
  reorderMasks: (clipId: string, fromIndex: number, toIndex: number) => void;
  getClipMasks: (clipId: string) => ClipMask[];
  addVertex: (clipId: string, maskId: string, vertex: Omit<MaskVertex, 'id'>, index?: number) => string;
  removeVertex: (clipId: string, maskId: string, vertexId: string) => void;
  updateVertex: (clipId: string, maskId: string, vertexId: string, updates: Partial<MaskVertex>, skipCacheInvalidation?: boolean) => void;
  updateVertices: (
    clipId: string,
    maskId: string,
    vertexUpdates: Array<{ id: string; updates: Partial<MaskVertex> }>,
    skipCacheInvalidation?: boolean
  ) => void;
  setVertexHandleMode: (clipId: string, maskId: string, vertexIds: string[], mode: MaskVertexHandleMode) => void;
  closeMask: (clipId: string, maskId: string) => void;
  addRectangleMask: (clipId: string) => string;
  addEllipseMask: (clipId: string) => string;
}

// Utils interface
export interface TimelineUtils {
  getClipsAtTime: (time: number) => TimelineClip[];
  updateDuration: () => void;
  findAvailableAudioTrack: (startTime: number, duration: number) => string;
  getSnappedPosition: (clipId: string, desiredStartTime: number, trackId: string) => { startTime: number; snapped: boolean; snapEdgeTime: number };
  findNonOverlappingPosition: (clipId: string, desiredStartTime: number, trackId: string, duration: number) => number;
  // Get position with magnetic resistance at clip edges - returns adjusted position and whether user has "broken through"
  // Uses pixel-based resistance (zoom converts time distance to pixels)
  // excludeClipIds: optional list of clip IDs to exclude from collision detection (for multi-select)
  getPositionWithResistance: (clipId: string, desiredStartTime: number, trackId: string, duration: number, zoom?: number, excludeClipIds?: string[]) => { startTime: number; forcingOverlap: boolean; noFreeSpace?: boolean };
  // Trim any clips that the placed clip overlaps with
  // excludeClipIds: optional list of clip IDs to exclude from being trimmed (for multi-select)
  trimOverlappingClips: (clipId: string, startTime: number, trackId: string, duration: number, excludeClipIds?: string[]) => void;
  getSerializableState: () => CompositionTimelineData;
  loadState: (data: CompositionTimelineData | undefined) => Promise<void>;
  clearTimeline: () => void;
}

// AI Action Feedback actions
export interface AIActionFeedbackActions {
  addAIOverlay: (overlay: Omit<AIActionOverlay, 'id' | 'createdAt'>) => string;
  addAIOverlaysBatch: (overlays: Omit<AIActionOverlay, 'id' | 'createdAt'>[]) => void;
  removeAIOverlay: (id: string) => void;
  setAIMovingClip: (clipId: string, fromStartTime: number, animationDuration?: number) => void;
  clearAIMovingClip: (clipId: string) => void;
}

// Combined store interface
export interface TimelineStore extends
  TimelineState,
  ClipboardState,
  TrackActions,
  ClipActions,
  PlaybackActions,
  TimelineToolActions,
  TimelineEditOperationActions,
  AudioEditActions,
  StemSeparationActions,
  VideoBakeActions,
  RamPreviewActions,
  ProxyCacheActions,
  ExportActions,
  SelectionActions,
  KeyframeActions,
  LayerActions,
  MaskActions,
  MarkerActions,
  TransitionActions,
  NodeGraphActions,
  ClipboardActions,
  AIActionFeedbackActions,
  TimelineUtils {}

// Slice creator type
export type SliceCreator<T> = (
  set: (partial: Partial<TimelineStore> | ((state: TimelineStore) => Partial<TimelineStore>)) => void,
  get: () => TimelineStore
) => T;
