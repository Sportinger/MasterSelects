import type { ComponentProps } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import { TimelineToolOverlayLayer } from '../tools/TimelineToolOverlayLayer';
import { AIActionOverlays } from './AIActionOverlays';
import { ParentChildLinksOverlay } from './ParentChildLinksOverlay';
import { TransitionOverlays } from './TransitionOverlays';

type TransitionOverlaysProps = ComponentProps<typeof TransitionOverlays>;
type TimelineToolOverlayLayerProps = ComponentProps<typeof TimelineToolOverlayLayer>;
type ParentChildLinksOverlayProps = ComponentProps<typeof ParentChildLinksOverlay>;

interface TimelineSectionOverlayGroupsProps {
  activeJunction: TransitionOverlaysProps['activeJunction'];
  clipDrag: ParentChildLinksOverlayProps['clipDrag'];
  clips: TimelineClip[];
  duration: number;
  getExpandedTrackHeight: TransitionOverlaysProps['getExpandedTrackHeight'];
  getTrackBaseHeight: ParentChildLinksOverlayProps['getTrackBaseHeight'];
  getTrackHeight: NonNullable<TransitionOverlaysProps['getTrackHeight']>;
  isCompositionTrackMorphing: boolean;
  isTrackExpanded: TransitionOverlaysProps['isTrackExpanded'];
  scrollX: number;
  sectionTracks: TimelineTrack[];
  timelineRef: ParentChildLinksOverlayProps['timelineRef'];
  timelineToolPreview: TimelineToolOverlayLayerProps['preview'];
  timeToPixel: TransitionOverlaysProps['timeToPixel'];
  tracks: TimelineTrack[];
  zoom: number;
}

export function TimelineSectionOverlayGroups({
  activeJunction,
  clipDrag,
  clips,
  duration,
  getExpandedTrackHeight,
  getTrackBaseHeight,
  getTrackHeight,
  isCompositionTrackMorphing,
  isTrackExpanded,
  scrollX,
  sectionTracks,
  timelineRef,
  timelineToolPreview,
  timeToPixel,
  tracks,
  zoom,
}: TimelineSectionOverlayGroupsProps) {
  if (isCompositionTrackMorphing) return null;

  return (
    <>
      <TransitionOverlays
        activeJunction={activeJunction}
        clips={clips}
        tracks={tracks}
        timeToPixel={timeToPixel}
        isTrackExpanded={isTrackExpanded}
        getExpandedTrackHeight={getExpandedTrackHeight}
        getTrackBaseHeight={getTrackBaseHeight}
        getTrackHeight={getTrackHeight}
      />

      <AIActionOverlays
        tracks={tracks}
        timeToPixel={timeToPixel}
        isTrackExpanded={isTrackExpanded}
        getExpandedTrackHeight={getExpandedTrackHeight}
        getTrackHeight={getTrackHeight}
      />

      <TimelineToolOverlayLayer
        preview={timelineToolPreview}
        tracks={sectionTracks}
        clips={clips}
        duration={duration}
        timeToPixel={timeToPixel}
        getTrackHeight={getTrackHeight}
      />

      <ParentChildLinksOverlay
        clips={clips}
        tracks={tracks}
        clipDrag={clipDrag}
        timelineRef={timelineRef}
        scrollX={scrollX}
        zoom={zoom}
        getTrackBaseHeight={getTrackBaseHeight}
        getExpandedTrackHeight={getExpandedTrackHeight}
      />
    </>
  );
}
