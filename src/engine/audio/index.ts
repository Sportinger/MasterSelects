/**
 * Audio Engine - High-quality offline audio processing for export
 *
 * Components:
 * - AudioExtractor: Decode audio from media files
 * - AudioEncoder: WebCodecs AAC encoding
 * - AudioMixer: Multi-track mixing with mute/solo
 * - TimeStretchProcessor: Speed/pitch with SoundTouchJS
 * - AudioEffectRenderer: EQ/volume with keyframe automation
 * - AudioExportPipeline: Orchestrates the complete export process
 */

export { AudioExtractor, audioExtractor } from './AudioExtractor';
export { AudioEncoderWrapper, getRecommendedAudioBitrate, AUDIO_CODEC_INFO } from './AudioEncoder';
export type { AudioEncoderSettings, EncodedAudioResult, AudioEncoderProgressCallback, AudioCodec } from './AudioEncoder';
export { encodeAudioBufferToWavBlob, encodeAudioBufferToWavBytes, estimateWavByteSize } from './AudioFileEncoder';
export type { AudioBufferLike, AudioOnlyExportFormat, WavBitDepth, WavEncodeOptions } from './AudioFileEncoder';
export { AudioMixer, audioMixer } from './AudioMixer';
export type { AudioTrackData, MixerSettings, MixProgress, MixProgressCallback } from './AudioMixer';
export { TimeStretchProcessor, timeStretchProcessor } from './TimeStretchProcessor';
export type { TimeStretchSettings, TimeStretchProgress, TimeStretchProgressCallback } from './TimeStretchProcessor';
export {
  AUDIO_EFFECT_REGISTRY,
  AUDIO_EQ_BAND_PARAMS,
  getAllAudioEffects,
  getAudioEffect,
  getAudioEffectDefaultParams,
  getAudioEffectParamNames,
  hasAudioEffect,
} from './AudioEffectRegistry';
export type { AudioEffectDescriptor, AudioEffectId, AudioEffectParamDescriptor, AudioEffectParamValue } from './AudioEffectRegistry';
export { AudioEffectRenderer, audioEffectRenderer, EQ_FREQUENCIES, EQ_BAND_PARAMS } from './AudioEffectRenderer';
export type { EffectRenderProgress, EffectRenderProgressCallback } from './AudioEffectRenderer';
export { audioGraphRenderer, createAudioGraphKey, normalizeAudioGraph, renderAudioGraph } from './AudioGraphRenderer';
export type {
  AudioGraphAnalysisRefsDescriptor,
  AudioGraphClipDescriptor,
  AudioGraphClipPlan,
  AudioGraphClipSourceDescriptor,
  AudioGraphDescriptor,
  AudioGraphDiagnostic,
  AudioGraphDiagnosticSeverity,
  AudioGraphEffectDescriptor,
  AudioGraphEffectPlanStep,
  AudioGraphEffectStatus,
  AudioGraphJsonPrimitive,
  AudioGraphJsonValue,
  AudioGraphMasterDescriptor,
  AudioGraphMasterPlan,
  AudioGraphRenderInput,
  AudioGraphRenderMode,
  AudioGraphRenderPlan,
  AudioGraphRenderStep,
  AudioGraphScope,
  AudioGraphSendDescriptor,
  AudioGraphSkippedEffect,
  AudioGraphTimeRangeDescriptor,
  AudioGraphTrackDescriptor,
  AudioGraphTrackPlan,
} from './AudioGraphTypes';
export { AudioExportPipeline, audioExportPipeline } from './AudioExportPipeline';
export type { AudioExportSettings, AudioExportProgress, AudioExportProgressCallback } from './AudioExportPipeline';
