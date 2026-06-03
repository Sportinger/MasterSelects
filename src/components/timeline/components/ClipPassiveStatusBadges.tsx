import { memo, type ReactNode } from 'react';
import type { TimelineClip } from '../../../types';

interface ClipPassiveStatusBadgesProps {
  enabled: boolean;
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
  stemSwitcher?: ReactNode;
}

export const ClipPassiveStatusBadges = memo(function ClipPassiveStatusBadges({
  enabled,
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
}: ClipPassiveStatusBadgesProps) {
  return (
    <>
      {enabled && clip.isPendingDownload && clip.youtubeThumbnail && (
        <div
          className="clip-youtube-preview"
          style={{ backgroundImage: `url(${clip.youtubeThumbnail})` }}
        />
      )}
      {enabled && clip.isPendingDownload && !clip.downloadError && (
        <>
          <div className="clip-download-progress">
            <div
              className="clip-download-progress-bar"
              style={{ width: `${clip.downloadProgress || 0}%` }}
            />
          </div>
          <div className="clip-download-status">
            <div className="download-spinner" />
            <span>Downloading {Math.round(clip.downloadProgress || 0)}%{clip.downloadSpeed ? ` \u00B7 ${clip.downloadSpeed}` : ''}</span>
          </div>
        </>
      )}
      {enabled && clip.downloadError && (
        <div className="clip-download-error-badge" title={clip.downloadError}>
          Error
        </div>
      )}
      {enabled && isGeneratingProxy && (
        <div className="clip-proxy-generating" title={`Generating proxy: ${proxyProgress}%`}>
          <span className="proxy-fill-badge">
            <span className="proxy-fill-bg">P</span>
            <span
              className="proxy-fill-progress"
              style={{ height: `${proxyProgress}%` }}
            >P</span>
          </span>
          <span className="proxy-percent">{proxyProgress}%</span>
        </div>
      )}
      {enabled && isGeneratingAudioProxy && (
        <div className="clip-audio-proxy-generating" title={`Preparing WAV audio proxy: ${audioProxyProgress}%`}>
          <span className="audio-proxy-fill-badge">
            <span className="audio-proxy-fill-bg">A</span>
            <span
              className="audio-proxy-fill-progress"
              style={{ height: `${audioProxyProgress}%` }}
            >A</span>
          </span>
          <span className="audio-proxy-percent">{audioProxyProgress}%</span>
        </div>
      )}
      {showActiveStemSeparation && (
        <div className="clip-stem-generating" title={activeStemStatusTitle}>
          <span className="stem-fill-badge">
            <span className="stem-fill-bg">S</span>
            <span
              className="stem-fill-progress"
              style={{ height: `${activeStemProgressPercent}%` }}
            >S</span>
          </span>
          <span className={isDownloadingStemModel ? 'stem-status-text' : 'stem-percent'}>
            {isDownloadingStemModel ? 'Downloading model' : `${activeStemProgressPercent}%`}
          </span>
        </div>
      )}
      {stemSwitcher}
      {enabled && hasProxy && proxyEnabled && !isGeneratingProxy && (
        <div className="clip-proxy-badge" title="Proxy ready">
          P
        </div>
      )}
      {enabled && hasProxyError && (
        <div className="clip-proxy-error" title="Proxy generation failed">
          P!
        </div>
      )}
      {enabled && hasAudioProxy && !isGeneratingAudioProxy && (
        <div className="clip-audio-proxy-badge" title="WAV audio proxy ready">
          A
        </div>
      )}
      {enabled && hasAudioProxyError && (
        <div className="clip-audio-proxy-error" title="WAV audio proxy failed">
          A!
        </div>
      )}
      {enabled && clip.reversed && (
        <div className="clip-reversed-badge" title="Reversed playback">
          {'\u27F2'}
        </div>
      )}
      {enabled && isInLinkedGroup && (
        <div className="clip-linked-group-badge" title="Multicam linked group">
          {'\u26D3'}
        </div>
      )}
    </>
  );
});
