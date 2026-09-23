/** Source-history samples; the separate rolling-input history stays at 64. */
export const MAX_SOURCE_TEMPORAL_SAMPLES = 256;
export const SOURCE_TEMPORAL_METADATA_WIDTH = MAX_SOURCE_TEMPORAL_SAMPLES + 1;
export const MAX_HYBRID_TEMPORAL_SAMPLES = 8192;
export const hybridTemporalSampleLimit = (width = 0, height = 0) =>
  Math.max(2, Math.min(MAX_HYBRID_TEMPORAL_SAMPLES, Math.round(Math.max(width, height)) || MAX_SOURCE_TEMPORAL_SAMPLES));
