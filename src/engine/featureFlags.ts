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
  use3DLayers: true,  // Three.js 3D layer support
};

// Expose for runtime toggling from devtools
if (typeof window !== 'undefined') {
  (window as any).__ENGINE_FLAGS__ = flags;
}
