import type { AnimatableProperty, VideoBakeRegion } from '../../../types';

export type TrackSectionKind = 'video' | 'audio';

export type TrackSectionMetrics = {
  contentHeight: number;
};

export type SectionScrollGestureState = {
  startScrollY: number;
  accumulatedDeltaY: number;
  settleTimerId: number | null;
  snapPositions: readonly number[];
  contentHeight: number;
  viewportHeight: number;
};

export type SelectedTrackRevealSnapshot = {
  clipId: string;
  trackId: string;
  sectionKind: TrackSectionKind;
  keyframeCount: number;
  curveSignature: string;
  trackHeight: number;
  contentHeight: number;
  viewportHeight: number;
  trackTop: number;
  trackBottom: number;
};

export type TrackResizeDragState = {
  trackId: string;
  startY: number;
  startHeight: number;
  pinVideoBottom: boolean;
};

export type TrackHeaderWidthDragState = {
  startX: number;
  startWidth: number;
};

export type TimelineSurfaceDragState = {
  pointerId: number;
  startClientX: number;
  startScrollX: number;
  maxScrollX: number;
};

export type TimelineRightDragScrubState = {
  source: 'empty' | 'clip';
  trackId?: string;
  clipId?: string;
  startClientX: number;
  startClientY: number;
  startTime: number;
  dragging: boolean;
};

export type VideoBakeRulerDragState = {
  startTime: number;
  startClientX: number;
};

export type CompositionVideoBakeOverlayRegion = Pick<VideoBakeRegion, 'id' | 'startTime' | 'endTime' | 'status' | 'progress'> & {
  selection?: boolean;
};

export type HoveredKeyframeRow = {
  trackId: string;
  property: AnimatableProperty;
} | null;
