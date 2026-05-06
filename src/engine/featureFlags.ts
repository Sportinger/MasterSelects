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
};

// Expose for runtime toggling from devtools
if (typeof window !== 'undefined') {
  (window as Window & { __ENGINE_FLAGS__?: typeof flags }).__ENGINE_FLAGS__ = flags;
}
