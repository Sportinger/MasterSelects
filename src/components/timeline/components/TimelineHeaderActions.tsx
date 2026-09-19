import { IconAdjustmentsHorizontal } from '@tabler/icons-react';
import { LiquidGlassBubble } from '../../common/liquidGlass/LiquidGlassBubble';
import type { TimelineHeaderProps } from '../types';
import type { useTimelineHeaderAudioPopoverState } from '../hooks/useTimelineHeaderAudioPopoverState';
import { TimelineHeaderMixerControls } from './TimelineHeaderAudioControls';
import { TrackHeaderIcon } from './TimelineHeaderTrackIcons';

interface TimelineHeaderActionsProps {
  effectiveMuted: boolean;
  effectiveSolo: boolean;
  isMixerTrack: boolean;
  isMobileTimelineLayout: boolean;
  mobileActionsOpen: boolean;
  onMobileActionsOpenChange: (open: boolean) => void;
  onToggleLocked: TimelineHeaderProps['onToggleLocked'];
  onToggleMuted: TimelineHeaderProps['onToggleMuted'];
  onToggleSolo: TimelineHeaderProps['onToggleSolo'];
  onToggleVisible: TimelineHeaderProps['onToggleVisible'];
  popoverState: ReturnType<typeof useTimelineHeaderAudioPopoverState>;
  showAdvancedAudioControls: boolean;
  showAudioSummaryMeter: boolean;
  showAudioTrackVolumeFader: boolean;
  showMobileSecondRow: boolean;
  track: TimelineHeaderProps['track'];
  trackInputMonitor: boolean;
  trackRecordArm: boolean;
  trackVolumeDb: number;
  trackVolumeLabel: string;
  trackVolumeUnit: number;
}

export function TimelineHeaderActions({
  effectiveMuted,
  effectiveSolo,
  isMixerTrack,
  isMobileTimelineLayout,
  mobileActionsOpen,
  onMobileActionsOpenChange,
  onToggleLocked,
  onToggleMuted,
  onToggleSolo,
  onToggleVisible,
  popoverState,
  showAdvancedAudioControls,
  showAudioSummaryMeter,
  showAudioTrackVolumeFader,
  showMobileSecondRow,
  track,
  trackInputMonitor,
  trackRecordArm,
  trackVolumeDb,
  trackVolumeLabel,
  trackVolumeUnit,
}: TimelineHeaderActionsProps) {
  const controls = isMixerTrack ? (
    <TimelineHeaderMixerControls
      effectiveMuted={effectiveMuted}
      effectiveSolo={effectiveSolo}
      onToggleLocked={onToggleLocked}
      onToggleMuted={onToggleMuted}
      onToggleSolo={onToggleSolo}
      popoverState={popoverState}
      showAdvancedAudioControls={showAdvancedAudioControls}
      showAudioSummaryMeter={showAudioSummaryMeter}
      showAudioTrackVolumeFader={showAudioTrackVolumeFader}
      track={track}
      trackInputMonitor={trackInputMonitor}
      trackRecordArm={trackRecordArm}
      trackVolumeDb={trackVolumeDb}
      trackVolumeLabel={trackVolumeLabel}
      trackVolumeUnit={trackVolumeUnit}
    />
  ) : (
    <div className="track-controls">
      <button
        className={`btn-icon ${effectiveSolo ? 'solo-active' : ''}`}
        onClick={(event) => { event.stopPropagation(); onToggleSolo(); }}
        title={effectiveSolo ? 'Solo On' : 'Solo Off'}
      >
        S
      </button>
      <button
        className={`btn-icon ${!track.visible ? 'hidden' : ''}`}
        onClick={(event) => { event.stopPropagation(); onToggleVisible(); }}
        title={track.visible ? 'Hide' : 'Show'}
      >
        <TrackHeaderIcon name={track.visible ? 'eye' : 'eyeOff'} />
      </button>
      <button
        className={`btn-icon ${track.locked ? 'locked-active' : ''}`}
        onClick={(event) => { event.stopPropagation(); onToggleLocked?.(); }}
        title={track.locked ? 'Unlock Track' : 'Lock Track'}
      >
        <TrackHeaderIcon name={track.locked ? 'lock' : 'unlock'} />
      </button>
    </div>
  );

  if (!isMobileTimelineLayout) return controls;
  if (!showMobileSecondRow) return null;

  return (
    <div className="timeline-mobile-track-actions">
      <LiquidGlassBubble
        open={mobileActionsOpen}
        onOpenChange={onMobileActionsOpenChange}
        icon={<IconAdjustmentsHorizontal aria-hidden="true" focusable="false" />}
        label={`${track.name} track actions`}
        triggerTitle="Track actions"
      >
        {controls}
      </LiquidGlassBubble>
    </div>
  );
}
