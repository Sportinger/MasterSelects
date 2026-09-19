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
  onGenerateProxy: (
    mediaFileId: string,
    options: { force?: boolean },
  ) => void;
  onAnalyzeSceneCuts: (mediaFileId: string, options: { force?: boolean }) => void;
  onRegenerateThumbnails: (mediaFile: MediaFile) => void;
  onRegenerateAudioProxy: (mediaFile: MediaFile, force: boolean) => void;
  onRegenerateWaveform: (mediaFile: MediaFile) => void;
  onRegenerateSpectrogram: (mediaFile: MediaFile) => void;
  onTranscribeMedia: (mediaFile: MediaFile) => void;
  onAnalyzeMedia: (mediaFile: MediaFile) => void;
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
  onAnalyzeSceneCuts,
  onRegenerateThumbnails,
  onRegenerateAudioProxy,
  onRegenerateWaveform,
  onRegenerateSpectrogram,
  onTranscribeMedia,
  onAnalyzeMedia,
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
              className={`context-menu-item ${(!mediaFile.file && !isGenerating) || mediaFile.sceneCutStatus === 'analyzing' ? 'disabled' : ''}`}
              onClick={() => {
                if ((!mediaFile.file && !isGenerating) || mediaFile.sceneCutStatus === 'analyzing') return;
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
          {isVideoFile && (
            <div
              className={`context-menu-item ${!mediaFile.file || isGenerating ? 'disabled' : ''}`}
              onClick={() => {
                if (!mediaFile.file || isGenerating) return;
                if (mediaFile.sceneCutStatus === 'analyzing') {
                  onCancelProxyGeneration(mediaFile.id);
                } else {
                  onAnalyzeSceneCuts(mediaFile.id, { force: true });
                }
                onClose();
              }}
            >
              {mediaFile.sceneCutStatus === 'analyzing' ? 'Stop Scene Cuts' : 'Scene Cuts'}
              {mediaFile.sceneCutStatus === 'analyzing'
                ? ` (${Math.round(mediaFile.sceneCutProgress || 0)}%)`
                : mediaFile.sceneCutStatus === 'ready'
                  ? ` (${mediaFile.sceneCutAnalysis?.cuts.length ?? 0} found)`
                  : mediaFile.sceneCutStatus === 'error'
                    ? ' (error)'
                    : ''}
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
              className={`context-menu-item ${!mediaFile.file || mediaFile.transcriptStatus === 'transcribing' ? 'disabled' : ''}`}
              onClick={() => {
                if (!mediaFile.file || mediaFile.transcriptStatus === 'transcribing') return;
                onTranscribeMedia(mediaFile);
              }}
            >
              Transcript (Best Quality)
              {mediaFile.transcriptStatus === 'transcribing'
                ? ` (${mediaFile.transcriptFusionProgress?.providerProgress?.deepgram.percent ?? 0}%)`
                : mediaFile.transcriptStatus === 'ready'
                  ? ' (ready)'
                  : mediaFile.transcriptStatus === 'error'
                    ? ' (error)'
                    : ''}
            </div>
          )}
          {isVideoFile && (
            <div
              className={`context-menu-item ${!mediaFile.file || mediaFile.analysisStatus === 'analyzing' || mediaFile.faceAnalysisStatus === 'analyzing' ? 'disabled' : ''}`}
              onClick={() => {
                if (!mediaFile.file || mediaFile.analysisStatus === 'analyzing' || mediaFile.faceAnalysisStatus === 'analyzing') return;
                onAnalyzeMedia(mediaFile);
              }}
            >
              Video Analysis
              {mediaFile.analysisStatus === 'analyzing' || mediaFile.faceAnalysisStatus === 'analyzing'
                ? ` (${Math.round(Math.max(mediaFile.analysisProgress ?? 0, mediaFile.faceAnalysisProgress ?? 0))}%)`
                : mediaFile.analysisStatus === 'ready'
                  ? ' (ready)'
                  : mediaFile.analysisStatus === 'error' || mediaFile.faceAnalysisStatus === 'error'
                    ? ' (error)'
                    : ''}
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
