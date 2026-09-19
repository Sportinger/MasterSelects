import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import type { TimelineEditOperation } from './types';
import {
  applyRateStretchClipOperation,
  applyRippleTrimEdgeToTimeOperation,
  applyRollingEditOperation,
  applySlideClipOperation,
  applySlipClipOperation,
  applyTrimClipOperation,
  applyTrimEdgeToTimeOperation,
  type TrimClipsApplyResult,
} from './trimOperations';

type TimelineTrimOperation = Extract<TimelineEditOperation, {
  type:
    | 'trim-clip'
    | 'trim-edge-to-time'
    | 'ripple-trim-edge-to-time'
    | 'rolling-edit'
    | 'slip-clip'
    | 'slide-clip'
    | 'rate-stretch-clip';
}>;

/** Routes the trim-family union while the store slice owns commit/history. */
export function applyTimelineTrimOperation(
  operation: TimelineTrimOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  selectedClipIds: Set<string>,
): TrimClipsApplyResult {
  switch (operation.type) {
    case 'trim-clip': return applyTrimClipOperation(operation, clips, tracks);
    case 'trim-edge-to-time': return applyTrimEdgeToTimeOperation(operation, clips, tracks, selectedClipIds);
    case 'ripple-trim-edge-to-time': return applyRippleTrimEdgeToTimeOperation(operation, clips, tracks, selectedClipIds);
    case 'rolling-edit': return applyRollingEditOperation(operation, clips, tracks);
    case 'slip-clip': return applySlipClipOperation(operation, clips, tracks);
    case 'slide-clip': return applySlideClipOperation(operation, clips, tracks);
    case 'rate-stretch-clip': return applyRateStretchClipOperation(operation, clips, tracks);
  }
}
