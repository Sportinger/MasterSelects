import type { MouseEvent } from 'react';

import type { Composition, MediaFile, ProjectItem } from '../../../../stores/mediaStore';
import { FileTypeIcon } from '../FileTypeIcon';
import { getItemImportProgress, getItemWaveformProgress } from '../itemTypeGuards';
import { getLabelHex } from '../labelColors';
import type { MediaClassicBadgeTarget, MediaClassicColumnId } from './types';

const MISSING_VALUE = '\u2013';
const RESOLUTION_SEPARATOR = '\u00d7';
const LONG_DASH = '\u2014';

export interface MediaClassicListCellProps {
  colId: MediaClassicColumnId;
  item: ProjectItem;
  depth: number;
  isFolder: boolean;
  isExpanded: boolean;
  isRenaming: boolean;
  isSelected: boolean;
  mediaFile: MediaFile | null;
  nameColumnWidth: number;
  renameValue: string;
  onOpenLabelPicker: (itemId: string, x: number, y: number) => void;
  onToggleFolder: (itemId: string) => void;
  onRenameValueChange: (value: string) => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onNameClick: (event: MouseEvent, itemId: string, currentName: string) => void;
  onBadgeClick: (mediaFileId: string, target: MediaClassicBadgeTarget) => void;
  getProjectItemIconType: (item: ProjectItem | undefined) => string | undefined;
  getGaussianSplatResolutionLabel: (item: ProjectItem) => string | null;
  getMediaFileContainerLabel: (mediaFile: MediaFile | null) => string | undefined;
  getMediaFileCodecLabel: (mediaFile: MediaFile | null) => string | undefined;
  isProxyFrameCountComplete: (frameCount?: number, duration?: number, fps?: number) => boolean;
  formatDuration: (seconds: number) => string;
  formatFileSize: (bytes?: number) => string;
  formatBitrate: (bps?: number) => string;
}

function MediaClassicStatusBadges({
  item,
  mediaFile,
  importProgress,
  waveformProgress,
  onBadgeClick,
  isProxyFrameCountComplete,
  longDashTitles,
}: {
  item: ProjectItem;
  mediaFile: MediaFile | null;
  importProgress: number | null;
  waveformProgress: number | null;
  onBadgeClick: (mediaFileId: string, target: MediaClassicBadgeTarget) => void;
  isProxyFrameCountComplete: (frameCount?: number, duration?: number, fps?: number) => boolean;
  longDashTitles?: boolean;
}) {
  const titleSeparator = longDashTitles ? ` ${LONG_DASH} ` : ' - ';
  const transcriptTitle = `Fully transcribed${titleSeparator}click to open`;
  const analysisTitle = `Fully analyzed${titleSeparator}click to open`;
  const transcriptPartialTitle = (pct: number) => `${pct}% transcribed${titleSeparator}click to open`;
  const analysisPartialTitle = (pct: number) => `${pct}% analyzed${titleSeparator}click to open`;

  return (
    <>
      {importProgress !== null && (
        <span className="media-item-import-progress" title={`Importing: ${importProgress}%`}>
          {importProgress}%
        </span>
      )}
      {importProgress === null && waveformProgress !== null && (
        <span className="media-item-waveform-generating" title={`Generating waveform: ${waveformProgress}%`}>
          <span className="waveform-fill-badge" aria-hidden="true">
            <span className="waveform-fill-bg">W</span>
            <span className="waveform-fill-progress" style={{ height: `${waveformProgress}%` }}>W</span>
          </span>
          <span className="waveform-percent">{waveformProgress}%</span>
        </span>
      )}
      {importProgress === null && waveformProgress === null && Boolean(mediaFile?.waveform?.length || mediaFile?.audioAnalysisRefs?.waveformPyramidId) && (
        <span className="media-item-waveform-badge" title="Waveform ready">W</span>
      )}
      {mediaFile?.audioProxyStatus === 'ready' && (
        <span className="media-item-audio-proxy-badge" title="WAV audio proxy ready">A</span>
      )}
      {mediaFile?.audioProxyStatus === 'error' && (
        <span className="media-item-audio-proxy-error" title="WAV audio proxy failed">A!</span>
      )}
      {mediaFile?.audioProxyStatus === 'generating' && (
        <span className="media-item-audio-proxy-generating" title={`Preparing WAV audio proxy: ${mediaFile.audioProxyProgress || 0}%`}>
          <span className="audio-proxy-fill-badge">
            <span className="audio-proxy-fill-bg">A</span>
            <span className="audio-proxy-fill-progress" style={{ height: `${mediaFile.audioProxyProgress || 0}%` }}>A</span>
          </span>
          <span className="audio-proxy-percent">{mediaFile.audioProxyProgress || 0}%</span>
        </span>
      )}
      {mediaFile?.proxyStatus === 'ready' &&
        isProxyFrameCountComplete(
          mediaFile.proxyFrameCount,
          mediaFile.duration,
          mediaFile.proxyFps ?? mediaFile.fps,
        ) && (
        <span className="media-item-proxy-badge" title="Proxy generated">P</span>
      )}
      {mediaFile?.proxyStatus === 'error' && (
        <span className="media-item-proxy-error" title="Proxy generation failed. Right-click to retry.">P!</span>
      )}
      {mediaFile?.proxyStatus === 'generating' && (
        <span className="media-item-proxy-generating" title={`Generating proxy: ${mediaFile.proxyProgress || 0}%`}>
          <span className="proxy-fill-badge">
            <span className="proxy-fill-bg">P</span>
            <span className="proxy-fill-progress" style={{ height: `${mediaFile.proxyProgress || 0}%` }}>P</span>
          </span>
          <span className="proxy-percent">{mediaFile.proxyProgress || 0}%</span>
        </span>
      )}
      {mediaFile?.transcriptStatus === 'ready' && (() => {
        const pct = Math.round((mediaFile.transcriptCoverage ?? 0) * 100);
        return pct >= 100 ? (
          <span
            className="media-item-transcript-badge"
            title={transcriptTitle}
            onClick={(event) => { event.stopPropagation(); onBadgeClick(item.id, 'transcript'); }}
          >T</span>
        ) : (
          <span
            className="media-item-transcript-fill"
            title={transcriptPartialTitle(pct)}
            onClick={(event) => { event.stopPropagation(); onBadgeClick(item.id, 'transcript'); }}
          >
            <span className="coverage-fill-badge transcript-fill">
              <span className="coverage-fill-bg">T</span>
              <span className="coverage-fill-progress" style={{ height: `${pct}%` }}>T</span>
            </span>
          </span>
        );
      })()}
      {mediaFile?.analysisStatus === 'ready' && (() => {
        const pct = Math.round((mediaFile.analysisCoverage ?? 0) * 100);
        return pct >= 100 ? (
          <span
            className="media-item-analysis-badge"
            title={analysisTitle}
            onClick={(event) => { event.stopPropagation(); onBadgeClick(item.id, 'analysis'); }}
          >A</span>
        ) : (
          <span
            className="media-item-analysis-fill"
            title={analysisPartialTitle(pct)}
            onClick={(event) => { event.stopPropagation(); onBadgeClick(item.id, 'analysis'); }}
          >
            <span className="coverage-fill-badge analysis-fill">
              <span className="coverage-fill-bg">A</span>
              <span className="coverage-fill-progress" style={{ height: `${pct}%` }}>A</span>
            </span>
          </span>
        );
      })()}
    </>
  );
}

export function MediaClassicListCell({
  colId,
  item,
  depth,
  isFolder,
  isExpanded,
  isRenaming,
  isSelected,
  mediaFile,
  nameColumnWidth,
  renameValue,
  onOpenLabelPicker,
  onToggleFolder,
  onRenameValueChange,
  onFinishRename,
  onCancelRename,
  onNameClick,
  onBadgeClick,
  getProjectItemIconType,
  getGaussianSplatResolutionLabel,
  getMediaFileContainerLabel,
  getMediaFileCodecLabel,
  isProxyFrameCountComplete,
  formatDuration,
  formatFileSize,
  formatBitrate,
}: MediaClassicListCellProps) {
  const importProgress = getItemImportProgress(item);
  const waveformProgress = getItemWaveformProgress(item);

  switch (colId) {
    case 'label': {
      const hex = getLabelHex(item.labelColor);
      return (
        <div
          className="media-col media-col-label"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenLabelPicker(item.id, rect.left, rect.bottom + 2);
          }}
        >
          <span
            className="media-label-dot"
            style={{
              background: hex === 'transparent' ? 'var(--border-color)' : hex,
              opacity: hex === 'transparent' ? 0.4 : 1,
            }}
          />
        </div>
      );
    }
    case 'name':
      return (
        <div
          className="media-col media-col-name"
          style={{
            paddingLeft: `${4 + depth * 16}px`,
            width: nameColumnWidth,
            minWidth: nameColumnWidth,
            maxWidth: nameColumnWidth,
          }}
        >
          {isFolder && (
            <span
              className={`media-folder-arrow ${isExpanded ? 'expanded' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleFolder(item.id);
              }}
            >
              &#9654;
            </span>
          )}
          <span className="media-item-icon">
            {isFolder
              ? <span className="media-folder-icon">&#128193;</span>
              : <FileTypeIcon type={getProjectItemIconType(item)} />
            }
          </span>
          {isRenaming ? (
            <input
              type="text"
              className="media-item-rename"
              value={renameValue}
              size={Math.max(1, renameValue.length)}
              onChange={(event) => onRenameValueChange(event.target.value)}
              onBlur={onFinishRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onFinishRename();
                if (event.key === 'Escape') onCancelRename();
              }}
              autoFocus
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span
              className={`media-item-name ${isSelected ? 'editable' : ''}`}
              onClick={(event) => onNameClick(event, item.id, item.name)}
            >
              {item.name}
            </span>
          )}
          <MediaClassicStatusBadges
            item={item}
            mediaFile={mediaFile}
            importProgress={importProgress}
            waveformProgress={waveformProgress}
            onBadgeClick={onBadgeClick}
            isProxyFrameCountComplete={isProxyFrameCountComplete}
            longDashTitles
          />
        </div>
      );
    case 'badges':
      return (
        <div className="media-col media-col-badges">
          <MediaClassicStatusBadges
            item={item}
            mediaFile={mediaFile}
            importProgress={importProgress}
            waveformProgress={waveformProgress}
            onBadgeClick={onBadgeClick}
            isProxyFrameCountComplete={isProxyFrameCountComplete}
          />
        </div>
      );
    case 'duration':
      return (
        <div className="media-col media-col-duration">
          {importProgress !== null
            ? `Import ${importProgress}%`
            : ('duration' in item && item.duration ? formatDuration(item.duration) : MISSING_VALUE)}
        </div>
      );
    case 'resolution':
      return (
        <div className="media-col media-col-resolution" title={getGaussianSplatResolutionLabel(item) ?? undefined}>
          {getGaussianSplatResolutionLabel(item) ??
            ('width' in item && 'height' in item && item.width && item.height ? `${item.width}${RESOLUTION_SEPARATOR}${item.height}` : MISSING_VALUE)}
        </div>
      );
    case 'fps':
      return (
        <div className="media-col media-col-fps">
          {mediaFile?.fps ? `${mediaFile.fps}` : ('type' in item && item.type === 'composition' ? (item as Composition).frameRate : MISSING_VALUE)}
        </div>
      );
    case 'container':
      return <div className="media-col media-col-container">{getMediaFileContainerLabel(mediaFile) || MISSING_VALUE}</div>;
    case 'codec':
      return <div className="media-col media-col-codec">{getMediaFileCodecLabel(mediaFile) || MISSING_VALUE}</div>;
    case 'audio':
      return (
        <div className="media-col media-col-audio">
          {mediaFile?.type === 'audio' ? 'Yes' :
           mediaFile?.type === 'image' ? MISSING_VALUE :
           mediaFile?.hasAudio === true ? 'Yes' :
           mediaFile?.hasAudio === false ? 'No' : MISSING_VALUE}
        </div>
      );
    case 'bitrate':
      return <div className="media-col media-col-bitrate">{mediaFile?.bitrate ? formatBitrate(mediaFile.bitrate) : MISSING_VALUE}</div>;
    case 'size':
      return <div className="media-col media-col-size">{mediaFile ? formatFileSize(mediaFile.fileSize) : MISSING_VALUE}</div>;
    default:
      return null;
  }
}
