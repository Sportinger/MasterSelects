import { memo, type ComponentProps } from 'react';
import { shallow } from 'zustand/shallow';
import { buildTimelineTrackSectionRenderState } from '../utils/timelineTrackSectionRenderState';
import { TimelineTrackSectionFrame } from './TimelineTrackSectionFrame';
import { TimelineTrackSectionHeaderStack } from './TimelineTrackSectionHeaderStack';
import { TimelineTrackSectionLaneStack } from './TimelineTrackSectionLaneStack';

type TrackSectionRenderStateProps = Parameters<typeof buildTimelineTrackSectionRenderState>[0];
type TrackSectionFrameProps = ComponentProps<typeof TimelineTrackSectionFrame>;
type TrackSectionHeaderStackProps = ComponentProps<typeof TimelineTrackSectionHeaderStack>;
type TrackSectionLaneStackProps = ComponentProps<typeof TimelineTrackSectionLaneStack>;

type TrackSectionFrameStaticProps = Omit<
  TrackSectionFrameProps,
  | 'headerContent'
  | 'lanesContent'
  | 'sectionCollapsed'
  | 'sectionContextTrackHeight'
  | 'sectionHeight'
  | 'sectionKind'
  | 'sectionPhaseClass'
  | 'sectionScrollY'
  | 'sectionViewportRef'
>;

type TrackSectionHeaderStaticProps = Omit<
  TrackSectionHeaderStackProps,
  'sectionKind' | 'sectionState'
>;

type TrackSectionLaneStaticProps = Omit<
  TrackSectionLaneStackProps,
  'sectionKind' | 'sectionState'
>;

interface TimelineTrackSectionRendererProps {
  frameProps: TrackSectionFrameStaticProps;
  headerProps: TrackSectionHeaderStaticProps;
  laneProps: TrackSectionLaneStaticProps;
  renderStateProps: TrackSectionRenderStateProps;
}

export const TimelineTrackSectionRenderer = memo(function TimelineTrackSectionRenderer({
  frameProps,
  headerProps,
  laneProps,
  renderStateProps,
}: TimelineTrackSectionRendererProps) {
  const sectionState = buildTimelineTrackSectionRenderState(renderStateProps);
  const { sectionKind } = renderStateProps;

  return (
    <TimelineTrackSectionFrame
      {...frameProps}
      headerContent={(
        <TimelineTrackSectionHeaderStack
          {...headerProps}
          sectionKind={sectionKind}
          sectionState={sectionState}
        />
      )}
      lanesContent={(
        <TimelineTrackSectionLaneStack
          {...laneProps}
          sectionKind={sectionKind}
          sectionState={sectionState}
        />
      )}
      sectionCollapsed={sectionState.sectionCollapsed}
      sectionContextTrackHeight={sectionState.sectionContextTrackHeight}
      sectionHeight={sectionState.sectionHeight}
      sectionKind={sectionKind}
      sectionPhaseClass={sectionState.sectionPhaseClass}
      sectionScrollY={sectionState.sectionScrollY}
      sectionViewportRef={sectionState.sectionViewportRef}
    />
  );
}, (previous, next) => (
  // The Timeline host also renders the transport clock. Its freshly assembled
  // prop groups must not redraw unchanged tracks, waveforms, and overlays.
  // Compare every value, including callbacks, so editing never uses stale input.
  shallow(previous.frameProps, next.frameProps)
  && shallow(previous.headerProps, next.headerProps)
  && shallow(previous.laneProps, next.laneProps)
  && shallow(previous.renderStateProps, next.renderStateProps)
));
