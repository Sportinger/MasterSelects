import type { TimelineClip, TimelineTrack } from './clipGraphProjectionDomain';

export const NODE_SPACING_X = 230;
export const MAIN_LANE_Y = 88;
export const AUDIO_LANE_Y = 252;
export const AUDIO_ANALYSIS_LANE_Y = 416;

export interface ClipNodeGraphBuildOptions {
  linkedClip?: TimelineClip | null;
  linkedTrack?: TimelineTrack | null;
}

export interface NodeGraphChainHead {
  nodeId: string;
  portId: string;
}
