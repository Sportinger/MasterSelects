export interface VideoNewTrackGestureState {
  lastClientY: number | null;
  isOffered: boolean;
}

export const VIDEO_NEW_TRACK_EDGE_THRESHOLD_PX = 72;
export const VIDEO_NEW_TRACK_UPWARD_DELTA_PX = 2;

export const initialVideoNewTrackGestureState: VideoNewTrackGestureState = {
  lastClientY: null,
  isOffered: false,
};

export function getNextVideoNewTrackGestureState(
  state: VideoNewTrackGestureState,
  options: {
    clientY: number;
    timelineTop: number;
    isAudio: boolean;
    edgeThresholdPx?: number;
    upwardDeltaPx?: number;
  },
): VideoNewTrackGestureState {
  const {
    clientY,
    timelineTop,
    isAudio,
    edgeThresholdPx = VIDEO_NEW_TRACK_EDGE_THRESHOLD_PX,
    upwardDeltaPx = VIDEO_NEW_TRACK_UPWARD_DELTA_PX,
  } = options;

  if (isAudio) {
    return { lastClientY: clientY, isOffered: false };
  }

  const distanceFromTop = clientY - timelineTop;
  const nearTopEdge = distanceFromTop >= 0 && distanceFromTop <= edgeThresholdPx;
  const movingUp = state.lastClientY !== null && clientY < state.lastClientY - upwardDeltaPx;
  const isOffered = nearTopEdge && (state.isOffered || movingUp);

  return { lastClientY: clientY, isOffered };
}
