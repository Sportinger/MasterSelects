import type { TimelineClip } from '../../types/timeline';
import type { MediaFile } from '../../stores/mediaStore';
import type { ClipContextMenuCommandDescriptor } from './utils/clipContextMenu';
import { handleSubmenuHover, handleSubmenuLeave } from '../panels/media/submenuPosition';

type RunCommand = (command: ClipContextMenuCommandDescriptor) => void;

interface ClipRegenerateContextMenuItemsProps {
  runCommand: RunCommand;
  isVideoMedia: boolean;
  hasSourceAudio: boolean;
  mediaFile: MediaFile | null;
  isGenerating: boolean;
  hasProxy: boolean;
  thumbnailStatus: string;
  hasThumbnailRegenerationSource: boolean;
  isAudioProxyGenerating: boolean;
  hasAudioProxy: boolean;
  audibleAudioClip: TimelineClip | null;
  isAudioAnalysisGenerating: boolean;
  audioAnalysisProgress: number;
  hasSpectrogram: boolean;
}

export function ClipRegenerateContextMenuItems({
  runCommand,
  isVideoMedia,
  hasSourceAudio,
  mediaFile,
  isGenerating,
  hasProxy,
  thumbnailStatus,
  hasThumbnailRegenerationSource,
  isAudioProxyGenerating,
  hasAudioProxy,
  audibleAudioClip,
  isAudioAnalysisGenerating,
  audioAnalysisProgress,
  hasSpectrogram,
}: ClipRegenerateContextMenuItemsProps) {
  if (!isVideoMedia && !hasSourceAudio && !audibleAudioClip) return null;

  return (
    <>
      <div className="context-menu-separator" />
      <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
        <span>Regenerate</span>
        <span className="submenu-arrow">{'▶'}</span>
        <div className="context-submenu">
          {isVideoMedia && (
            <div
              className={`context-menu-item ${!mediaFile || (!isGenerating && !mediaFile.file) ? 'disabled' : ''}`}
              onClick={() => runCommand({
                kind: 'proxy-generation',
                action: isGenerating ? 'stop' : 'start',
                options: { force: hasProxy },
                canExecute: Boolean(mediaFile && (isGenerating || mediaFile.file)),
              })}
            >
              {isGenerating
                ? `Stop Proxy Generation (${mediaFile?.proxyProgress || 0}%)`
                : `Proxy${hasProxy ? ' (ready)' : ''}`}
            </div>
          )}
          {isVideoMedia && (
            <div
              className={`context-menu-item ${thumbnailStatus === 'generating' || !hasThumbnailRegenerationSource ? 'disabled' : ''}`}
              onClick={() => runCommand({
                kind: 'regenerate-thumbnails',
                canExecute: thumbnailStatus !== 'generating' && hasThumbnailRegenerationSource,
              })}
            >
              Thumbnails
              {thumbnailStatus === 'ready'
                ? ' (ready)'
                : thumbnailStatus === 'generating'
                  ? ' (generating)'
                  : ''}
            </div>
          )}
          {hasSourceAudio && (
            <div
              className={`context-menu-item ${!mediaFile || isAudioProxyGenerating ? 'disabled' : ''}`}
              onClick={() => runCommand({
                kind: 'audio-proxy-regeneration',
                force: hasAudioProxy,
                canExecute: Boolean(mediaFile && !isAudioProxyGenerating),
              })}
            >
              WAV Audio Proxy
              {isAudioProxyGenerating
                ? ` (${mediaFile?.audioProxyProgress || 0}%)`
                : hasAudioProxy
                  ? ' (ready)'
                  : ''}
            </div>
          )}
          {audibleAudioClip && (
            <div
              className={`context-menu-item ${isAudioAnalysisGenerating ? 'disabled' : ''}`}
              onClick={() => runCommand({
                kind: 'audio-analysis-regeneration',
                analysisKind: 'waveform',
                canExecute: !isAudioAnalysisGenerating,
              })}
            >
              Waveform
              {isAudioAnalysisGenerating
                ? ` (${audioAnalysisProgress}%)`
                : audibleAudioClip.waveform?.length
                  ? ' (ready)'
                  : ''}
            </div>
          )}
          {audibleAudioClip && (
            <div
              className={`context-menu-item ${isAudioAnalysisGenerating ? 'disabled' : ''}`}
              onClick={() => runCommand({
                kind: 'audio-analysis-regeneration',
                analysisKind: 'spectral',
                canExecute: !isAudioAnalysisGenerating,
              })}
            >
              Spectral
              {isAudioAnalysisGenerating
                ? ` (${audioAnalysisProgress}%)`
                : hasSpectrogram
                  ? ' (ready)'
                  : ''}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

interface ClipAudioAIContextMenuItemsProps {
  runCommand: RunCommand;
  audibleAudioClip: TimelineClip | null;
  canModifyTargets: boolean;
  isStemSeparationActive: boolean;
  stemProgressPercent: number;
  hasStemSeparation: boolean;
  showTranscription: boolean;
  transcriptStatus?: string;
  transcriptProgress?: number;
  transcriptionProviderLabel: string;
  openTranscriptionSettings: () => void;
}

export function ClipAudioAIContextMenuItems({
  runCommand,
  audibleAudioClip,
  canModifyTargets,
  isStemSeparationActive,
  stemProgressPercent,
  hasStemSeparation,
  showTranscription,
  transcriptStatus,
  transcriptProgress,
  transcriptionProviderLabel,
  openTranscriptionSettings,
}: ClipAudioAIContextMenuItemsProps) {
  return (
    <>
      {audibleAudioClip && (
        <>
          <div className="context-menu-separator" />
          <div
            className={`context-menu-item ${isStemSeparationActive || !canModifyTargets ? 'disabled' : ''}`}
            onClick={() => runCommand({
              kind: 'stem-separation',
              force: hasStemSeparation,
              canExecute: canModifyTargets && !isStemSeparationActive,
            })}
          >
            {isStemSeparationActive
              ? `Separating Stems... ${stemProgressPercent}%`
              : hasStemSeparation
                ? 'Regenerate Stems...'
                : 'Stem Separation...'}
          </div>
          <div
            className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
            onClick={() => runCommand({ kind: 'music-to-midi', canExecute: canModifyTargets })}
          >
            Music to MIDI...
          </div>
        </>
      )}

      {showTranscription && (
        <>
          <div className="context-menu-separator" />
          <div
            className={`context-menu-item ${transcriptStatus === 'transcribing' ? 'disabled' : ''}`}
            onClick={() => runCommand({
              kind: 'transcription',
              transcriptStatus,
              canExecute: transcriptStatus !== 'transcribing',
            })}
          >
            {transcriptStatus === 'transcribing'
              ? `Transcribing... ${transcriptProgress || 0}%`
              : transcriptStatus === 'ready'
                ? `Re-transcribe (${transcriptionProviderLabel})`
                : `Transcribe (${transcriptionProviderLabel})`}
          </div>
          <div className="context-menu-item" onClick={openTranscriptionSettings}>
            Transcription Settings...
          </div>
        </>
      )}
    </>
  );
}
