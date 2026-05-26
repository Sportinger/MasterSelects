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
export {
  encodeAudioBufferToWavBlob,
  encodeAudioBufferToWavBytes,
  encodeFloat32PcmChunksToWavBlob,
  encodeFloat32PcmChunksToWavBytes,
  estimateFloat32PcmWavByteSize,
  estimateWavByteSize,
} from './AudioFileEncoder';
export type {
  AudioBufferLike,
  AudioOnlyExportFormat,
  Float32PcmChunk,
  Float32PcmWavEncodeInput,
  WavBitDepth,
  WavEncodeOptions,
} from './AudioFileEncoder';
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
export {
  normalizeAudioEqParams,
  normalizeLegacyParametricAudioEqParams,
  getAudioEqLegacyBandGains,
} from './eq/AudioEqLegacy';
export {
  createAudioEqBiquadCascadeCoefficients,
  createAudioEqBiquadCoefficients,
  getBiquadMagnitudeAtFrequency,
} from './eq/AudioEqBiquad';
export {
  compileAudioEqPlan,
  AUDIO_EQ_DEFAULT_SAMPLE_RATE,
  AUDIO_EQ_LINEAR_PHASE_LATENCY_SAMPLES,
} from './eq/AudioEqCompiler';
export {
  addAudioEqBand,
  updateAudioEqBand,
  removeAudioEqBand,
  reorderAudioEqBand,
  isAudioEqAutomationOrphaned,
} from './eq/AudioEqOperations';
export {
  applyAudioEqPreset,
  cloneAudioEqPreset,
  createAudioEqParamsForPresetKind,
  createUserAudioEqPreset,
  findAudioEqFactoryPreset,
  getAudioEqFactoryPresets,
} from './eq/AudioEqPresets';
export type {
  AudioEqPreset,
  AudioEqPresetApplyMode,
} from './eq/AudioEqPresets';
export {
  AUDIO_EQ_CLIPBOARD_SCHEMA_VERSION,
  copyAudioEqBands,
  copyAudioEqCurve,
  parseAudioEqClipboardPayload,
  pasteAudioEqClipboardPayload,
  serializeAudioEqClipboardPayload,
} from './eq/AudioEqClipboard';
export type {
  AudioEqClipboardPayload,
  AudioEqClipboardScope,
  AudioEqPasteMode,
} from './eq/AudioEqClipboard';
export {
  copyAudioEqABSlot,
  createAudioEqABState,
  resetInactiveAudioEqABSlot,
  switchAudioEqABSlot,
  syncAudioEqABActiveSlot,
} from './eq/AudioEqAB';
export type {
  AudioEqABSlot,
  AudioEqABState,
} from './eq/AudioEqAB';
export {
  hasAudioEqCharacterMode,
  processAudioEqCharacterChannels,
} from './eq/AudioEqCharacter';
export type {
  AudioEqCharacterProcessResult,
} from './eq/AudioEqCharacter';
export {
  calculateAudioEqDynamicGainDb,
  createAudioEqDynamicRuntimeState,
  createSingleBandAudioEqParams,
  hasAudioEqDynamicBands,
  processAudioEqChannels,
} from './eq/AudioEqDynamic';
export type {
  AudioEqDynamicBandTelemetry,
  AudioEqDynamicProcessResult,
  AudioEqDynamicRuntimeState,
} from './eq/AudioEqDynamic';
export {
  hasAudioEqLinearPhaseMode,
  processAudioEqLinearPhaseChannels,
} from './eq/AudioEqLinearPhase';
export type {
  AudioEqLinearPhaseProcessResult,
} from './eq/AudioEqLinearPhase';
export {
  calculateAudioEqSpectralDynamicsGainDb,
  chooseAudioEqSpectralDynamicsFftSize,
  fftRadix2,
  getAudioEqSpectralDynamicsBandRange,
  hannWindow,
  hasAudioEqSpectralDynamicsBands,
  processAudioEqSpectralDynamicsChannels,
} from './eq/AudioEqSpectralDynamics';
export type {
  AudioEqSpectralDynamicsBandRange,
  AudioEqSpectralDynamicsBandTelemetry,
  AudioEqSpectralDynamicsProcessResult,
} from './eq/AudioEqSpectralDynamics';
export {
  applyAudioEqCurveFit,
  applyAudioEqMatch,
  createAudioEqCurvePointsFromSpectrumDelta,
  fitAudioEqBandsToCurve,
} from './eq/AudioEqCurveFitting';
export type {
  AudioEqCurveFitOptions,
  AudioEqCurveFitResult,
  AudioEqCurvePoint,
} from './eq/AudioEqCurveFitting';
export {
  applyAudioEqSpectrumGrabPeak,
  detectAudioEqSpectrumGrabPeaks,
} from './eq/AudioEqSpectrumGrab';
export type {
  AudioEqSpectrumGrabOptions,
  AudioEqSpectrumGrabPeak,
} from './eq/AudioEqSpectrumGrab';
export {
  collectAudioEqInstances,
  filterAudioEqInstances,
  findAudioEqInstance,
} from './eq/AudioEqInstanceRegistry';
export type {
  AudioEqInstanceDescriptor,
  AudioEqInstanceRegistryFilter,
  AudioEqInstanceRegistryInput,
  AudioEqInstanceScope,
} from './eq/AudioEqInstanceRegistry';
export {
  createAudioEqResponseSet,
  createLogFrequencySamples,
  sampleCompiledEqBandResponseDb,
  sumBandResponsesDb,
} from './eq/AudioEqResponse';
export {
  createAudioEqGraphViewModel,
  dbToGraphY,
  frequencyToGraphX,
} from './eq/AudioEqGraphViewModel';
export {
  getAudioEqAudibleStateForIdentity,
  isAudioEqAudibleStateDefault,
} from './eq/AudioEqIdentity';
export type {
  AudioEqAnalyzerMode,
  AudioEqAudibleStateV2,
  AudioEqBand,
  AudioEqBandDynamics,
  AudioEqBandSpectralDynamics,
  AudioEqBandStereoMode,
  AudioEqBandType,
  AudioEqCharacterMode,
  AudioEqDisplayStateV2,
  AudioEqGraphViewModel,
  AudioEqParamsV2,
  AudioEqPhaseMode,
  AudioEqPresetKind,
  CompiledAudioEqPlan,
  CompiledAudioEqBandPlan,
  AudioEqCompilerDiagnostic,
} from './eq/AudioEqTypes';
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
