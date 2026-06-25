// Core type facade for WebVJ Mixer

export * from './audio';
export * from './colorCorrection';
export * from './motionDesign';
export * from './nodeGraph';
export type {
  AnimatableProperty,
  BezierHandle,
  CameraProperty,
  CameraPropertyName,
  ColorProperty,
  EasingType,
  EffectProperty,
  MaskNumericProperty,
  MaskNumericPropertyName,
  MaskPathProperty,
  MaskProperty,
  NodeGraphParamProperty,
  RotationInterpolationMode,
  TextBoundsNumericProperty,
  TextBoundsNumericPropertyName,
  TextBoundsPathProperty,
  TextBoundsProperty,
  TransformProperty,
} from './animationProperties';
export {
  createEffectProperty,
  createMaskNumericProperty,
  createMaskPathProperty,
  createNodeGraphParamProperty,
  createTextBoundsNumericProperty,
  createTextBoundsPathProperty,
  isCameraProperty,
  isColorProperty,
  isEffectProperty,
  isMaskNumericProperty,
  isMaskPathProperty,
  isNodeGraphParamProperty,
  isTextBoundsNumericProperty,
  isTextBoundsPathProperty,
  parseCameraProperty,
  parseEffectProperty,
  parseMaskProperty,
  parseNodeGraphParamProperty,
  parseTextBoundsProperty,
} from './animationProperties';
export type { BlendMode } from './blendMode';
export type {
  AnalysisStatus,
  ClipAnalysis,
  ClipSegment,
  ClipVideoState,
  FrameAnalysisData,
  SceneDescriptionStatus,
  SceneSegment,
  TranscriptStatus,
  TranscriptWord,
  VideoBakeRegion,
  VideoBakeRegionScope,
  VideoBakeRegionStatus,
} from './clipMetadata';
export type { Effect, EffectType } from './effects';
export { isAudioEffect } from './effects';
export type { EngineStats } from './engineStats';
export type { Keyframe } from './keyframes';
export type {
  Layer,
  LayerSource,
  NestedCompositionData,
} from './layers';
export type {
  MathBaseObject,
  MathFunctionObject,
  MathLabelObject,
  MathObject,
  MathObjectAnimation,
  MathParameter,
  MathParameterAnimation,
  MathPointObject,
  MathSceneDefinition,
  MathSceneStyle,
  MathSceneViewport,
  MathTangentObject,
} from './mathScene';
export type {
  ClipMask,
  MaskMode,
  MaskPathKeyframeValue,
  MaskVertex,
  MaskVertexHandleMode,
  TextBoundsPath,
} from './masks';
export type {
  GaussianSplatBounds,
  GaussianSplatSequenceData,
  GaussianSplatSequenceFrame,
  ModelSequenceData,
  ModelSequenceFrame,
  ModelSequencePlaybackMode,
} from './mediaSequences';
export type { MIDIMapping, Project } from './project';
export type {
  RenderDestinationType,
  RenderSource,
  RenderSourceActiveComp,
  RenderSourceComposition,
  RenderSourceLayer,
  RenderSourceProgram,
  RenderSourceSlot,
  RenderSourceType,
  RenderTarget,
} from './renderTarget';
export type { Text3DProperties, TextClipProperties } from './text';
export type {
  CompositionTimelineData,
  RulerLane,
  RulerLaneFormat,
  SerializableClip,
  SerializableMarker,
  TempoEvent,
  TempoMap,
  TimelineClip,
  TimelineClipDataSource,
  TimelineClipSource,
  TimelineClipSourceRuntimeHandles,
  TimelineState,
  TimelineTrack,
  TransitionOverlayClipDefinition,
} from './timeline';
export type { ClipTransform, TimelineTransition, TransitionCompositionLink } from './timelineCore';
export type { TimelineSourceType } from './timelineSource';
export type {
  VectorAnimationClipSettings,
  VectorAnimationInputProperty,
  VectorAnimationMetadata,
  VectorAnimationProvider,
} from './vectorAnimation';
