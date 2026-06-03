import { memo, type ComponentProps, type ReactNode } from 'react';
import type { TimelineClip } from '../../../types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { SourceExtensionGhost } from '../utils/sourceExtensionGhosts';
import type {
  LegacyThumbnailRenderPlan,
  SegmentThumbnailRenderPlan,
} from '../utils/thumbnailFilmstrip';
import type { TimelineHorizontalRenderWindow } from '../utils/waveformRenderGeometry';
import type { ClipStaticIconKind } from '../utils/clipMediaClassification';
import { ClipAudioMediaView } from './ClipAudioMediaView';
import { ClipContentMeta } from './ClipContentMeta';
import { ClipCoverageBadges } from './ClipCoverageBadges';
import { ClipPassiveStatusBadges } from './ClipPassiveStatusBadges';
import { ClipPostThumbnailDecorations } from './ClipPostThumbnailDecorations';
import { ClipPreThumbnailDecorations } from './ClipPreThumbnailDecorations';
import { ClipThumbnailFilmstrip } from './ClipThumbnailFilmstrip';
import { ClipTranscriptAnalysisOverlays } from './ClipTranscriptAnalysisOverlays';
import { ClipWaveform } from './ClipWaveform';

interface ClipPassiveBackgroundLayerProps {
  sourceExtensionGhosts: readonly SourceExtensionGhost[];
  passiveDecorationsEnabled: boolean;
  passiveMediaEnabled: boolean;
  waveformsEnabled: boolean;
  clip: TimelineClip;
  proxyEnabled: boolean;
  isGeneratingProxy: boolean;
  proxyProgress: number;
  hasProxy: boolean;
  hasProxyError: boolean;
  isGeneratingAudioProxy: boolean;
  audioProxyProgress: number;
  hasAudioProxy: boolean;
  hasAudioProxyError: boolean;
  showActiveStemSeparation: boolean;
  activeStemStatusTitle?: string;
  activeStemProgressPercent: number;
  isDownloadingStemModel: boolean;
  isInLinkedGroup: boolean;
  stemSwitcher: ReactNode;
  mediaFiles: readonly MediaFile[];
  isAudioClip: boolean;
  showWaveformGenerationIndicator?: boolean;
  audioDisplayMode: ComponentProps<typeof ClipAudioMediaView>['audioDisplayMode'];
  hasWaveformForRender: boolean;
  audioSpectrogramProps: ComponentProps<typeof ClipAudioMediaView>['spectrogramProps'];
  audioWaveformProps: ComponentProps<typeof ClipAudioMediaView>['waveformProps'];
  audioAnalysisDisplayStatus: ComponentProps<typeof ClipAudioMediaView>['audioAnalysisDisplayStatus'];
  audioWaveformDiagnostics: ComponentProps<typeof ClipAudioMediaView>['audioWaveformDiagnostics'];
}

export const ClipPassiveBackgroundLayer = memo(function ClipPassiveBackgroundLayer({
  sourceExtensionGhosts,
  passiveDecorationsEnabled,
  passiveMediaEnabled,
  waveformsEnabled,
  clip,
  proxyEnabled,
  isGeneratingProxy,
  proxyProgress,
  hasProxy,
  hasProxyError,
  isGeneratingAudioProxy,
  audioProxyProgress,
  hasAudioProxy,
  hasAudioProxyError,
  showActiveStemSeparation,
  activeStemStatusTitle,
  activeStemProgressPercent,
  isDownloadingStemModel,
  isInLinkedGroup,
  stemSwitcher,
  mediaFiles,
  isAudioClip,
  showWaveformGenerationIndicator,
  audioDisplayMode,
  hasWaveformForRender,
  audioSpectrogramProps,
  audioWaveformProps,
  audioAnalysisDisplayStatus,
  audioWaveformDiagnostics,
}: ClipPassiveBackgroundLayerProps) {
  return (
    <>
      {passiveDecorationsEnabled && sourceExtensionGhosts.map((ghost) => (
        <div
          key={ghost.edge}
          className={`clip-source-extension-ghost ${ghost.edge}`}
          style={{ left: ghost.left, width: ghost.width }}
        />
      ))}
      <ClipPassiveStatusBadges
        enabled={passiveDecorationsEnabled}
        clip={clip}
        proxyEnabled={proxyEnabled}
        isGeneratingProxy={isGeneratingProxy}
        proxyProgress={proxyProgress}
        hasProxy={hasProxy}
        hasProxyError={hasProxyError}
        isGeneratingAudioProxy={isGeneratingAudioProxy}
        audioProxyProgress={audioProxyProgress}
        hasAudioProxy={hasAudioProxy}
        hasAudioProxyError={hasAudioProxyError}
        showActiveStemSeparation={showActiveStemSeparation}
        activeStemStatusTitle={activeStemStatusTitle}
        activeStemProgressPercent={activeStemProgressPercent}
        isDownloadingStemModel={isDownloadingStemModel}
        isInLinkedGroup={isInLinkedGroup}
        stemSwitcher={stemSwitcher}
      />
      <ClipCoverageBadges
        enabled={passiveDecorationsEnabled}
        clip={clip}
        mediaFiles={mediaFiles}
        isAudioClip={isAudioClip}
      />
      {passiveDecorationsEnabled && showWaveformGenerationIndicator && (
        <div
          className="clip-waveform-indicator"
          title={clip.audioAnalysisJob ? `${clip.audioAnalysisJob.label}: ${clip.audioAnalysisJob.phase}` : undefined}
        >
          <div
            className="waveform-progress"
            style={{ width: `${clip.audioAnalysisJob?.progress ?? clip.waveformProgress ?? 50}%` }}
          />
        </div>
      )}
      {passiveMediaEnabled && waveformsEnabled && isAudioClip && (
        audioDisplayMode === 'spectral'
        || hasWaveformForRender
      ) && (
        <ClipAudioMediaView
          audioDisplayMode={audioDisplayMode}
          hasWaveformForRender={hasWaveformForRender}
          spectrogramProps={audioSpectrogramProps}
          waveformProps={audioWaveformProps}
          audioAnalysisDisplayStatus={audioAnalysisDisplayStatus}
          audioWaveformDiagnostics={audioWaveformDiagnostics}
        />
      )}
    </>
  );
});

interface ClipPassiveForegroundLayerProps {
  passiveDecorationsEnabled: boolean;
  clip: TimelineClip;
  waveformsEnabled: boolean;
  width: number;
  trackBaseHeight: number;
  displayInPoint: number;
  displayOutPoint: number;
  audioDisplayMode: ComponentProps<typeof ClipWaveform>['displayMode'];
  pixelsPerSecond: number;
  waveformRenderStartPx: number;
  waveformRenderWidth: number;
  staticClipIconKind: ClipStaticIconKind | null;
  showSegmentThumbnails: boolean;
  showRegularThumbnails: boolean;
  useSourceCache: boolean;
  thumbnailRenderWindow: TimelineHorizontalRenderWindow;
  segmentThumbnailPlans: readonly SegmentThumbnailRenderPlan[];
  cachedThumbnails: readonly (string | null)[];
  legacyThumbnailPlans: readonly LegacyThumbnailRenderPlan[];
  clipMetaOffset: number;
  displayDuration: number;
  formatTime: (seconds: number) => string;
  isSolidClip: boolean;
  isTextClip: boolean;
  isText3DClip: boolean;
  isMathSceneClip: boolean;
  isVectorAnimationClip: boolean;
  vectorAnimationIcon: string;
  vectorAnimationTitle: string;
  isSplatEffectorClip: boolean;
  text3DProperties: TimelineClip['text3DProperties'];
  showTranscriptMarkers: boolean;
  displayStartTime: number;
  isAudioClip: boolean;
}

export const ClipPassiveForegroundLayer = memo(function ClipPassiveForegroundLayer({
  passiveDecorationsEnabled,
  clip,
  waveformsEnabled,
  width,
  trackBaseHeight,
  displayInPoint,
  displayOutPoint,
  audioDisplayMode,
  pixelsPerSecond,
  waveformRenderStartPx,
  waveformRenderWidth,
  staticClipIconKind,
  showSegmentThumbnails,
  showRegularThumbnails,
  useSourceCache,
  thumbnailRenderWindow,
  segmentThumbnailPlans,
  cachedThumbnails,
  legacyThumbnailPlans,
  clipMetaOffset,
  displayDuration,
  formatTime,
  isSolidClip,
  isTextClip,
  isText3DClip,
  isMathSceneClip,
  isVectorAnimationClip,
  vectorAnimationIcon,
  vectorAnimationTitle,
  isSplatEffectorClip,
  text3DProperties,
  showTranscriptMarkers,
  displayStartTime,
  isAudioClip,
}: ClipPassiveForegroundLayerProps) {
  return (
    <>
      <ClipPreThumbnailDecorations
        enabled={passiveDecorationsEnabled}
        clip={clip}
        waveformsEnabled={waveformsEnabled}
        width={width}
        trackBaseHeight={trackBaseHeight}
        displayInPoint={displayInPoint}
        displayOutPoint={displayOutPoint}
        audioDisplayMode={audioDisplayMode}
        pixelsPerSecond={pixelsPerSecond}
        waveformRenderStartPx={waveformRenderStartPx}
        waveformRenderWidth={waveformRenderWidth}
        staticClipIconKind={staticClipIconKind}
      />
      {showSegmentThumbnails && (
        <ClipThumbnailFilmstrip
          mode="segments"
          renderWindow={thumbnailRenderWindow}
          segmentPlans={segmentThumbnailPlans}
        />
      )}
      {showRegularThumbnails && useSourceCache && (
        <ClipThumbnailFilmstrip
          mode="regular"
          renderWindow={thumbnailRenderWindow}
          useSourceCache={true}
          cachedThumbnails={cachedThumbnails}
        />
      )}
      {showRegularThumbnails && !useSourceCache && (
        <ClipThumbnailFilmstrip
          mode="regular"
          renderWindow={thumbnailRenderWindow}
          useSourceCache={false}
          legacyPlans={legacyThumbnailPlans}
        />
      )}
      <ClipPostThumbnailDecorations
        enabled={passiveDecorationsEnabled}
        clip={clip}
      />
      {passiveDecorationsEnabled && (
        <ClipContentMeta
          clip={clip}
          clipMetaOffset={clipMetaOffset}
          displayDuration={displayDuration}
          formatTime={formatTime}
          isSolidClip={isSolidClip}
          isTextClip={isTextClip}
          isText3DClip={isText3DClip}
          isMathSceneClip={isMathSceneClip}
          isVectorAnimationClip={isVectorAnimationClip}
          vectorAnimationIcon={vectorAnimationIcon}
          vectorAnimationTitle={vectorAnimationTitle}
          isSplatEffectorClip={isSplatEffectorClip}
          staticClipIconKind={staticClipIconKind}
          text3DProperties={text3DProperties}
        />
      )}
      <ClipTranscriptAnalysisOverlays
        enabled={passiveDecorationsEnabled}
        showTranscriptMarkers={showTranscriptMarkers}
        clip={clip}
        displayDuration={displayDuration}
        displayStartTime={displayStartTime}
        width={width}
        trackBaseHeight={trackBaseHeight}
        isAudioClip={isAudioClip}
      />
    </>
  );
});
