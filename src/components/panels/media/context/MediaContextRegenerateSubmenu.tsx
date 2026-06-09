import type { MediaFile } from '../../../../stores/mediaStore';
import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';

export interface MediaContextRegenerateSubmenuProps {
  mediaFile: MediaFile;
  isVideoFile: boolean;
  isImageFile: boolean;
  hasAudio: boolean;
  isGenerating: boolean;
  hasProxy: boolean;
  isAudioProxyGenerating: boolean;
  hasAudioProxy: boolean;
  isSourceAudioAnalysisGenerating: boolean;
  hasSourceWaveform: boolean;
  hasSourceSpectrogram: boolean;
  onCancelProxyGeneration: (mediaFileId: string) => void;
  onGenerateProxy: (mediaFileId: string, options: { force: boolean }) => void;
  onRegenerateThumbnails: (mediaFile: MediaFile) => void;
  onRegenerateAudioProxy: (mediaFile: MediaFile, force: boolean) => void;
  onRegenerateWaveform: (mediaFile: MediaFile) => void;
  onRegenerateSpectrogram: (mediaFile: MediaFile) => void;
  onClose: () => void;
}

export function MediaContextRegenerateSubmenu({
  mediaFile,
  isVideoFile,
  isImageFile,
  hasAudio,
  isGenerating,
  hasProxy,
  isAudioProxyGenerating,
  hasAudioProxy,
  isSourceAudioAnalysisGenerating,
  hasSourceWaveform,
  hasSourceSpectrogram,
  onCancelProxyGeneration,
  onGenerateProxy,
  onRegenerateThumbnails,
  onRegenerateAudioProxy,
  onRegenerateWaveform,
  onRegenerateSpectrogram,
  onClose,
}: MediaContextRegenerateSubmenuProps) {
  return (
    <>
      <div className="context-menu-separator" />
      <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
        <span>Regenerate</span>
        <span className="submenu-arrow">&#9654;</span>
        <div className="context-submenu">
          {isVideoFile && (
            <div
              className={`context-menu-item ${!mediaFile.file && !isGenerating ? 'disabled' : ''}`}
              onClick={() => {
                if (!mediaFile.file && !isGenerating) return;
                if (isGenerating) {
                  onCancelProxyGeneration(mediaFile.id);
                } else {
                  onGenerateProxy(mediaFile.id, { force: hasProxy });
                }
                onClose();
              }}
            >
              {isGenerating
                ? `Stop Proxy Generation (${mediaFile.proxyProgress || 0}%)`
                : `Proxy${hasProxy ? ' (ready)' : ''}`}
            </div>
          )}
          {(isVideoFile || isImageFile) && (
            <div
              className="context-menu-item"
              onClick={() => onRegenerateThumbnails(mediaFile)}
            >
              Thumbnails{mediaFile.thumbnailUrl ? ' (ready)' : ''}
            </div>
          )}
          {hasAudio && (
            <div
              className={`context-menu-item ${isAudioProxyGenerating ? 'disabled' : ''}`}
              onClick={() => {
                if (isAudioProxyGenerating) return;
                onRegenerateAudioProxy(mediaFile, hasAudioProxy);
              }}
            >
              WAV Audio Proxy
              {isAudioProxyGenerating
                ? ` (${mediaFile.audioProxyProgress || 0}%)`
                : hasAudioProxy
                ? ' (ready)'
                : ''}
            </div>
          )}
          {hasAudio && (
            <div
              className={`context-menu-item ${isSourceAudioAnalysisGenerating ? 'disabled' : ''}`}
              onClick={() => {
                if (isSourceAudioAnalysisGenerating) return;
                onRegenerateWaveform(mediaFile);
              }}
            >
              Waveform
              {isSourceAudioAnalysisGenerating
                ? ` (${Math.round(mediaFile.waveformProgress || 0)}%)`
                : hasSourceWaveform
                ? ' (ready)'
                : ''}
            </div>
          )}
          {hasAudio && (
            <div
              className={`context-menu-item ${isSourceAudioAnalysisGenerating ? 'disabled' : ''}`}
              onClick={() => {
                if (isSourceAudioAnalysisGenerating) return;
                onRegenerateSpectrogram(mediaFile);
              }}
            >
              Spectral{hasSourceSpectrogram ? ' (ready)' : ''}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
