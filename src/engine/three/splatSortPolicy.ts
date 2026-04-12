export interface SplatSortPolicy {
  intervalFrames: number;
  minElapsedMs: number;
  positionEpsilonSq: number;
  directionDotThreshold: number;
  useFrameModulo: boolean;
  allowDynamicResort: boolean;
}

const TARGET_REALTIME_FRAME_MS = 1000 / 60;

export function resolveSplatSortPolicy(
  splatCount: number,
  requestedSortFrequency: number,
  useApproximateSort: boolean,
  realtimePlayback: boolean,
): SplatSortPolicy {
  const baseInterval = splatCount <= 12000
    ? 1
    : splatCount <= 30000
      ? 2
      : splatCount <= 60000
        ? 4
        : splatCount <= 200000
          ? 8
          : splatCount <= 500000
            ? 16
            : splatCount <= 1000000
              ? 24
              : 32;
  const intervalFrames = requestedSortFrequency === 0
    ? 0
    : Math.max(baseInterval, requestedSortFrequency);

  const basePositionEpsilonSq = useApproximateSort
    ? splatCount <= 300000
      ? 0.0004
      : splatCount <= 800000
        ? 0.0016
        : 0.0036
    : 0.0001;
  const baseDirectionDotThreshold = useApproximateSort
    ? splatCount <= 300000
      ? 0.9985
      : splatCount <= 800000
        ? 0.9965
        : 0.994
    : 0.9995;

  if (!realtimePlayback || intervalFrames === 0 || splatCount <= 200000) {
    return {
      intervalFrames,
      minElapsedMs: 0,
      positionEpsilonSq: basePositionEpsilonSq,
      directionDotThreshold: baseDirectionDotThreshold,
      useFrameModulo: true,
      allowDynamicResort: intervalFrames !== 0,
    };
  }

  const realtimeMultiplier = splatCount <= 500000
    ? 1.5
    : splatCount <= 1000000
      ? 2
      : 2.5;
  const playbackPositionEpsilonSq = splatCount <= 500000
    ? 0.0036
    : splatCount <= 1000000
      ? 0.01
      : 0.0225;
  const playbackDirectionDotThreshold = splatCount <= 500000
    ? 0.9955
    : splatCount <= 1000000
      ? 0.9925
      : 0.989;

  return {
    intervalFrames,
    minElapsedMs: Math.round(intervalFrames * TARGET_REALTIME_FRAME_MS * realtimeMultiplier),
    positionEpsilonSq: Math.max(basePositionEpsilonSq, playbackPositionEpsilonSq),
    directionDotThreshold: Math.min(baseDirectionDotThreshold, playbackDirectionDotThreshold),
    // Frame-modulo gating creates visible hitching on heavy splat reorders.
    // During realtime playback, switch to time-based gating instead.
    useFrameModulo: false,
    allowDynamicResort: true,
  };
}
