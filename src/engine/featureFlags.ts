// Feature flags for engine subsystems still in development.
// Scene Graph, Dirty Tracking, Structural Sharing are always-on (no flag needed).
// Toggle at runtime via: window.__ENGINE_FLAGS__

export const flags = {
  useRenderGraph: false,  // Render Graph executor (stubs - not ready)
  useDecoderPool: false,  // Shared decoder pool (not wired yet)
  useFullWebCodecsPlayback: false,  // Default HTML Video; persisted toggle in settingsStore syncs on rehydrate
  disableHtmlPreviewFallback: false,  // Synced with useFullWebCodecsPlayback via settingsStore
  useLiveSlotTrigger: false,  // Slot Grid click triggers live layers without forcing editor switching
  useWarmSlotDecks: false,  // Prepare reusable slot-owned live decks for low-latency triggering
  use3DLayers: true,  // Shared 3D scene support
  useGaussianSplat: true,  // Gaussian Splat avatar rendering (old WebGL path)
  useMotionDesignSystem: false,  // Motion shape/null/adjustment system foundation
  useMotionReplicators: false,  // GPU-instanced motion replicators
  advancedAudio: false,  // Advanced audio workstation foundation
  timelineAudioDetailMode: false,  // Expanded timeline audio editing lanes
  inlineSpectralCanvas: false,  // Timeline-embedded spectrogram/spectral editing
  audioFocusMode: false,  // Timeline layout optimized for audio editing
  waveformPyramid: false,  // Artifact-backed multi-resolution waveform data
  audioEffectRegistry: false,  // Registry-backed audio effect descriptors
  audioMixer: false,  // Track/send/master mixer controls
  stemSeparation: false,  // Browser-side clip stem separation UI and jobs
  stemSeparationWebGPU: true,  // Prefer WebGPU for supported stem separation models
  stemSeparationClipLayers: true,  // Render completed stems as clip-local Audio Layers
  stemSeparationExperimentalModels: false,  // Show unvalidated stem model candidates
  guidedActionsRuntime: true,  // Shared guided action contracts, scheduler, and transient session store
  guidedActionsAIReplay: true,  // Visual replay for AI tool calls
  guidedActionsTutorials: true,  // Tutorial scenarios using guided actions
  guidedActionsRecorder: false,  // Future guided action authoring/recording layer
  timelineCanvasWorker: false,  // issue #228 P4: OffscreenCanvas clip renderer for eligible rows. Keep default-off until real-media worker-positive proof and final gates pass.
};

// Expose for runtime toggling from devtools
if (typeof window !== 'undefined') {
  (window as Window & { __ENGINE_FLAGS__?: typeof flags }).__ENGINE_FLAGS__ = flags;
}
