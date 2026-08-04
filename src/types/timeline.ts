import type {
  ClipAudioAnalysisJobState,
  ClipAudioState,
  MasterAudioState,
  TrackAudioState,
} from './audio';
import type { ColorCorrectionState } from './colorCorrection';
import type {
  AnalysisStatus,
  ClipAnalysis,
  ClipSegment,
  ClipVideoState,
  SceneDescriptionStatus,
  SceneSegment,
  TranscriptStatus,
  TranscriptWord,
  VideoBakeRegion,
} from './clipMetadata';
import type { Effect } from './effects';
import type { Keyframe } from './keyframes';
import type { LayerSourceRect, TransitionRenderState } from './layers';
import type { LightClipSettings } from './light';
import type { ModelMaterialSettings } from './modelMaterial';
import type { MathSceneDefinition } from './mathScene';
import type { ClipMask } from './masks';
import type {
  GaussianSplatSequenceData,
  ModelSequenceData,
} from './mediaSequences';
import type { MotionLayerDefinition } from './motionDesign';
import type { ClipNodeGraph } from './nodeGraph';
import type { Text3DProperties, TextClipProperties } from './text';
import type {
  ClipTransform,
  TimelineTransition,
  TransitionRecipeBlendWindow,
  TransitionSourceMap,
} from './timelineCore';
import type { TimelineSourceType } from './timelineSource';
import type { TransitionOverlayPattern } from '../transitions';
import type { VectorAnimationClipSettings } from './vectorAnimation';
import type { StoryboardClipProperties } from './storyboard';
import type { CaptionClipProperties, CaptionLayerBinding } from './caption';

export interface TransitionOverlayClipDefinition {
  pattern: TransitionOverlayPattern;
  color: string;
  widthRatio: number;
  softness: number;
  angle: number;
}

export interface TimelineClipDataSource {
  type: TimelineSourceType;
  liveInputId?: string;
  modelUrl?: string;
  modelFileName?: string;
  modelSequence?: ModelSequenceData;
  modelPrimitiveIndex?: number;
  modelMaterialSettings?: ModelMaterialSettings;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  threeDEffectorsEnabled?: boolean;
  meshType?: import('../stores/mediaStore/types').MeshPrimitiveType;
  text3DProperties?: Text3DProperties;
  cameraSettings?: import('../stores/mediaStore/types').SceneCameraSettings;
  lightSettings?: LightClipSettings;
  splatEffectorSettings?: import('./splatEffector').SplatEffectorSettings;
  gaussianAvatarUrl?: string;
  gaussianBlendshapes?: Record<string, number>;
  gaussianSplatUrl?: string;
  gaussianSplatFileName?: string;
  gaussianSplatFileHash?: string;
  gaussianSplatRuntimeKey?: string;
  gaussianSplatSettings?: import('../engine/gaussian/types').GaussianSplatSettings;
  imageUrl?: string;
  naturalDuration?: number;
  mediaFileId?: string;
  transitionOverlay?: TransitionOverlayClipDefinition;
  vectorAnimationSettings?: VectorAnimationClipSettings;
  filePath?: string;
}

export interface TimelineClipSourceRuntimeHandles {
  videoElement?: HTMLVideoElement;
  audioElement?: HTMLAudioElement;
  imageElement?: HTMLImageElement;
  webCodecsPlayer?: import('../engine/WebCodecsPlayer').WebCodecsPlayer;
  nativeDecoder?: import('../services/nativeHelper/NativeDecoder').NativeDecoder;
  file?: File;
  textCanvas?: HTMLCanvasElement;
  runtimeSourceId?: string;
  runtimeSessionKey?: string;
}

export type TimelineClipSource = TimelineClipDataSource & TimelineClipSourceRuntimeHandles;

export type EditableHookLayerRole = 'text' | 'background';

export interface EditableHookLayerMetadata {
  id: string;
  role: EditableHookLayerRole;
  rowIndex: number;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  name: string;
  file: File;
  startTime: number;      // Start position on timeline (seconds)
  duration: number;       // Clip duration (seconds)
  inPoint: number;        // Trim in point within source (seconds)
  outPoint: number;       // Trim out point within source (seconds)
  source: TimelineClipSource | null;
  mathScene?: MathSceneDefinition;
  motion?: MotionLayerDefinition;
  thumbnails?: string[];  // Array of data URLs for filmstrip preview
  mediaFileId?: string;   // Reference to MediaFile for audio/proxy lookup (top-level for YouTube downloads)
  signalAssetId?: string; // Source SignalAsset for renderer-adapter materialized clips
  signalRefId?: string;   // Source SignalRef selected by the renderer adapter
  signalRenderAdapterId?: string; // Renderer adapter that produced the clip materialization
  linkedClipId?: string;  // ID of linked clip (e.g., audio linked to video)
  linkedGroupId?: string; // ID of multicam group (clips synced together)
  editableHook?: EditableHookLayerMetadata; // Durable AI-editable hook identity
  parentClipId?: string;  // ID of parent clip for transform inheritance (like AE parenting)
  videoState?: ClipVideoState; // Video bake/cache regions and future clip-side video derivations
  audioState?: ClipAudioState; // Advanced audio workstation state (optional, legacy-safe)
  audioAnalysisJob?: ClipAudioAnalysisJobState; // Transient current audio-analysis job state
  waveform?: number[];    // Array of normalized aggregate amplitude values (0-1) for audio waveform
  waveformChannels?: number[][]; // Optional per-channel waveform previews for stereo/multichannel audio
  waveformGenerating?: boolean;  // True while waveform is being generated
  waveformProgress?: number;     // 0-100 progress of waveform generation
  transform: ClipTransform;  // Visual transform properties
  sourceRect?: LayerSourceRect;
  transitionRender?: TransitionRenderState;
  effects: Effect[];      // Effects applied to this clip
  colorCorrection?: ColorCorrectionState;  // Professional node/list color correction state
  nodeGraph?: ClipNodeGraph; // Field-backed node graph UI state for this clip
  isLoading?: boolean;    // True while media is being loaded
  needsReload?: boolean;  // True if file handle needs re-authorization after page refresh
  reversed?: boolean;     // True if clip plays in reverse
  speed?: number;         // Playback speed (default 1.0, 0.5 = half speed, -1.0 = reverse)
  preservesPitch?: boolean;  // Keep pitch when speed changes (default true)
  followsLinkedVideoSpeed?: boolean; // Audio-only: linked video owns speed/timing (default true)
  freeRun?: boolean;      // Preview the source continuously instead of seeking with the timeline
  // Nested composition support
  isComposition?: boolean;  // True if this clip is a nested composition
  compositionId?: string;   // ID of the nested composition
  nestedClips?: TimelineClip[];  // Loaded clips from the nested composition
  nestedTracks?: TimelineTrack[];  // Tracks from the nested composition
  nestedContentHash?: string;  // Hash to detect changes in nested composition (for thumbnail updates)
  nestedClipBoundaries?: number[];  // Normalized (0-1) positions where nested clips start/end (for visual markers)
  clipSegments?: ClipSegment[];  // Segment-based thumbnails for nested compositions
  // Nested composition audio mixdown
  mixdownAudio?: HTMLAudioElement;  // Audio element for playing nested comp audio
  mixdownWaveform?: number[];  // Waveform of the nested comp audio mixdown
  mixdownBuffer?: AudioBuffer;  // Raw audio buffer for export
  mixdownGenerating?: boolean;  // True while mixdown is being generated
  hasMixdownAudio?: boolean;  // True if nested comp has audio
  // Mask support
  masks?: ClipMask[];     // Array of masks applied to this clip
  // Transcript support
  transcript?: TranscriptWord[];  // Speech-to-text transcript
  transcriptStatus?: TranscriptStatus;  // Transcription status
  transcriptProgress?: number;  // 0-100 progress
  transcriptMessage?: string;  // Status message during transcription
  // Analysis support (focus/motion/face)
  analysis?: ClipAnalysis;
  analysisStatus?: AnalysisStatus;
  analysisProgress?: number;  // 0-100 progress
  faceAnalysisStatus?: import('./clipMetadata').FaceAnalysisStatus;
  faceAnalysisProgress?: number; // 0-100 progress
  faceAnalysisMessage?: string; // Current stage or exact module error
  // AI scene description support
  sceneDescriptions?: SceneSegment[];
  sceneDescriptionStatus?: SceneDescriptionStatus;
  sceneDescriptionProgress?: number;  // 0-100 progress
  sceneDescriptionMessage?: string;   // Status message during description
  // Text clip support
  textProperties?: TextClipProperties;
  // Transcript-driven dynamic caption clip support
  captionProperties?: CaptionClipProperties;
  // Optional live input role for ordinary layers inside a caption design comp
  captionLayerBinding?: CaptionLayerBinding;
  text3DProperties?: Text3DProperties;
  // Solid clip support
  solidColor?: string;
  // Storyboard scene-card projection
  storyboardProperties?: StoryboardClipProperties;
  // Generated transition overlay support
  transitionOverlay?: TransitionOverlayClipDefinition;
  // MIDI clip support (issue #182): note data; instrument lives on the track
  midiData?: import('./midiClip').MidiClipData;
  // MIDI clip automation (issue #298): the four performed CC lanes (cutoff/mod/
  // expression/pitchBend) as clip-level breakpoint envelopes. Durable plain JSON.
  automation?: import('./midiClip').MidiClipAutomation;
  // YouTube download support
  isPendingDownload?: boolean;  // True if clip is being downloaded
  downloadProgress?: number;    // 0-100 download progress
  downloadSpeed?: string;       // e.g. "5.23MiB/s"
  downloadError?: string;       // Error message if download failed
  youtubeVideoId?: string;      // YouTube video ID for pending downloads
  youtubeThumbnail?: string;    // Thumbnail URL for pending display
  // Transition support
  transitionIn?: TimelineTransition;   // Transition from previous clip
  transitionOut?: TimelineTransition;  // Transition to next clip
  transitionSourceTimeOverride?: number; // Runtime-only source time for virtual transition participant clips
  transitionSourceHold?: boolean; // Runtime-only: freeze a virtual transition participant on the override frame
  transitionSourceMap?: TransitionSourceMap;
  transitionRecipeBlendWindows?: TransitionRecipeBlendWindow[];
  // 3D layer support (AE-style per-layer toggle)
  is3D?: boolean;
  wireframe?: boolean;  // Debug: show 3D model as wireframe
  meshType?: import('../stores/mediaStore/types').MeshPrimitiveType;  // Primitive mesh geometry type
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'midi';
  height: number;
  labelColor?: import('../stores/mediaStore/types').LabelColor;
  muted: boolean;
  visible: boolean;
  solo: boolean;
  locked?: boolean;
  parentTrackId?: string;  // ID of parent track for layer parenting (like AE parenting)
  audioState?: TrackAudioState;
  // MIDI track support: instrument that renders this track's MIDI clips (issue #182)
  midiInstrument?: import('./midiClip').MidiInstrument;
}

export interface TimelineState {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  playheadPosition: number;  // Current time in seconds
  duration: number;          // Total timeline duration
  zoom: number;              // Pixels per second
  scrollX: number;           // Horizontal scroll position
  isPlaying: boolean;
  selectedClipId: string | null;
}

// Serializable clip data for storage (without DOM elements)
export interface SerializableClip {
  id: string;
  trackId: string;
  name: string;
  mediaFileId: string;       // Reference to MediaFile in mediaStore
  signalAssetId?: string;    // Source SignalAsset for renderer-adapter materialized clips
  signalRefId?: string;      // Source SignalRef selected by the renderer adapter
  signalRenderAdapterId?: string; // Renderer adapter that produced the clip materialization
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  sourceType: TimelineSourceType;
  liveInputId?: string;
  naturalDuration?: number;
  thumbnails?: string[];
  linkedClipId?: string;
  linkedGroupId?: string;  // Multicam group ID
  editableHook?: EditableHookLayerMetadata;
  parentClipId?: string;   // Motion Design same-composition parent clip ID
  videoState?: ClipVideoState;
  audioState?: ClipAudioState;
  waveform?: number[];
  waveformChannels?: number[][];
  transform: ClipTransform;
  sourceRect?: LayerSourceRect;
  transitionRender?: TransitionRenderState;
  effects: Effect[];         // Effects applied to this clip
  colorCorrection?: ColorCorrectionState;
  nodeGraph?: ClipNodeGraph; // Field-backed node graph UI state
  keyframes?: Keyframe[];    // Animation keyframes for this clip
  // Nested composition support
  isComposition?: boolean;
  compositionId?: string;
  // Mask support
  masks?: ClipMask[];        // Masks applied to this clip
  // Legacy read compatibility only. New writers persist source intelligence
  // once per mediaFileId and intentionally omit these fields from clips.
  transcript?: TranscriptWord[];
  transcriptStatus?: TranscriptStatus;
  analysis?: ClipAnalysis;
  analysisStatus?: AnalysisStatus;
  faceAnalysisStatus?: import('./clipMetadata').FaceAnalysisStatus;
  faceAnalysisMessage?: string;
  sceneDescriptions?: SceneSegment[];
  sceneDescriptionStatus?: SceneDescriptionStatus;
  // Playback
  reversed?: boolean;
  speed?: number;         // Playback speed (default 1.0)
  preservesPitch?: boolean;  // Keep pitch when speed changes (default true)
  followsLinkedVideoSpeed?: boolean; // Audio-only: linked video owns speed/timing (default true)
  freeRun?: boolean;
  // Text clip support
  textProperties?: TextClipProperties;
  captionProperties?: CaptionClipProperties;
  captionLayerBinding?: CaptionLayerBinding;
  text3DProperties?: Text3DProperties;
  // Solid clip support
  solidColor?: string;
  // Storyboard scene-card projection
  storyboardProperties?: StoryboardClipProperties;
  // Generated transition overlay support
  transitionOverlay?: TransitionOverlayClipDefinition;
  // MIDI clip support (issue #182)
  midiData?: import('./midiClip').MidiClipData;
  // MIDI clip automation (issue #298)
  automation?: import('./midiClip').MidiClipAutomation;
  vectorAnimationSettings?: VectorAnimationClipSettings;
  mathScene?: MathSceneDefinition;
  motion?: MotionLayerDefinition;
  // Transition support
  transitionIn?: TimelineTransition;
  transitionOut?: TimelineTransition;
  transitionSourceTimeOverride?: number;
  transitionSourceHold?: boolean;
  transitionSourceMap?: TransitionSourceMap;
  transitionRecipeBlendWindows?: TransitionRecipeBlendWindow[];
  // 3D layer support
  is3D?: boolean;
  modelSequence?: ModelSequenceData;
  modelPrimitiveIndex?: number;
  modelMaterialSettings?: ModelMaterialSettings;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  threeDEffectorsEnabled?: boolean;
  meshType?: import('../stores/mediaStore/types').MeshPrimitiveType;
  cameraSettings?: import('../stores/mediaStore/types').SceneCameraSettings;
  lightSettings?: LightClipSettings;
  splatEffectorSettings?: import('./splatEffector').SplatEffectorSettings;
  // Gaussian avatar blendshape state
  gaussianBlendshapes?: Record<string, number>;
  // Gaussian splat settings
  gaussianSplatSettings?: import('../engine/gaussian/types').GaussianSplatSettings;
}

// Serializable timeline marker (for project save/load)
export interface SerializableMarker {
  id: string;
  time: number;
  label: string;
  color: string;
  stopPlayback?: boolean;
  midiBindings?: import('./midi').MarkerMIDIBinding[];
}

// ---- Multi-ruler infrastructure (issue #257) ----
// The format a ruler lane renders. Linear formats (`time` / `timecode` /
// `frames`) are pure functions of time; `bars` is projected through the TempoMap.
// `tempo` is the odd one out: an EDITOR lane showing draggable tempo/meter flags
// rather than ticks, so it is never selectable as the active lane (issue #299).
export type RulerLaneFormat = 'time' | 'timecode' | 'frames' | 'bars' | 'tempo';

// One stacked ruler lane. Lanes are an ordered, format-unique set
// (no two lanes share a format — duplicate rulers are pointless).
export interface RulerLane {
  id: string;
  format: RulerLaneFormat;
}

// One tempo / time-signature segment, effective from `time` onward until the
// next event. Invariants (sort, uniqueness, pinned first event, clamps) live in
// `src/timeline/tempo/tempoEdits.ts`.
export interface TempoEvent {
  id: string;   // stable identity for editing, dragging and React keys (#299)
  time: number; // seconds, sorted ascending; first event is at 0
  bpm: number;
  numerator: number;
  denominator: number;
  // How this event's tempo is REACHED from the previous one (#299):
  //   'jump' (default) — instant step at `time`
  //   'ramp'           — tempo interpolates linearly from the previous event's
  //                      BPM to this one across the preceding interval
  // Optional so every project saved before ramps stays valid and reads as jump.
  curve?: TempoCurve;
}

export type TempoCurve = 'jump' | 'ramp';

// The conductor track that makes Bars+Beats possible. Always >= 1 event.
export interface TempoMap {
  events: TempoEvent[];
}

// Serializable timeline data for composition storage
export interface CompositionTimelineData {
  tracks: TimelineTrack[];
  clips: SerializableClip[];
  playheadPosition: number;
  duration: number;
  durationLocked?: boolean;  // When true, duration won't auto-update based on clips
  zoom: number;
  scrollX: number;
  inPoint: number | null;
  outPoint: number | null;
  loopPlayback: boolean;
  markers?: SerializableMarker[];  // Timeline markers
  videoBakeRegions?: VideoBakeRegion[];
  masterAudioState?: MasterAudioState;
  // Multi-ruler infrastructure (issue #257). Optional for back-compat: old data
  // lacks them and is normalized to defaults on load (see rulerDefaults).
  tempoMap?: TempoMap;
  rulerLanes?: RulerLane[];
  activeRulerLaneId?: string | null;
}
