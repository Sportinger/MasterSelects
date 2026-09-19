import type { DragEvent, MouseEvent, PointerEvent } from 'react';

import type { Composition, MediaFile, ProjectItem } from '../../../../stores/mediaStore';
import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import { FileTypeIcon } from '../FileTypeIcon';
import { MediaReconnectButton } from '../MediaReconnectButton';
import { getItemImportProgress, getItemWaveformProgress, isImportedMediaFileItem } from '../itemTypeGuards';
import { MediaGridVideoThumb } from '../MediaGridVideoThumb';
import { MediaWaveformThumb } from '../MediaWaveformThumb';
import { TrackingAssetActions } from '../TrackingAssetActions';
import { formatMediaDuration } from './format';

export interface MediaGridItemProps {
  item: ProjectItem;
  selected: boolean;
  dragTarget: boolean;
  folderItemCount: number;
  getProjectItemIconType: (item: ProjectItem | undefined) => string | undefined;
  buildTooltip: (item: ProjectItem, isFolder: boolean, isComposition: boolean) => string;
  onRefreshFileUrls: (mediaFileId: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, item: ProjectItem) => void;
  onTouchTimelineDragPointerDown: (event: PointerEvent<HTMLDivElement>, item: ProjectItem) => void;
  onDragEnd: (event: DragEvent<HTMLDivElement>) => void;
  onFolderDragOver: (event: DragEvent<HTMLDivElement>, folderId: string) => void;
  onFolderDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onFolderDrop: (event: DragEvent<HTMLDivElement>, folderId: string) => void;
  onClick: (event: MouseEvent<HTMLDivElement>, itemId: string) => void;
  onDoubleClick: (item: ProjectItem, renameFromName?: boolean) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, itemId: string) => void;
}

export function MediaGridItem({
  item,
  selected,
  dragTarget,
  folderItemCount,
  getProjectItemIconType,
  buildTooltip,
  onRefreshFileUrls,
  onDragStart,
  onTouchTimelineDragPointerDown,
  onDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onClick,
  onDoubleClick,
  onContextMenu,
}: MediaGridItemProps) {
  const isFolder = 'isExpanded' in item;
  const isMediaFile = isImportedMediaFileItem(item);
  const mediaFile = isMediaFile ? item : null;
  const isComposition = !isFolder && 'type' in item && item.type === 'composition';
  const isTrackingAsset = !isFolder && 'type' in item && item.type === 'tracking';
  const composition = isComposition ? (item as Composition) : null;
  const thumbUrl = mediaFile?.thumbnailUrl;
  const importing = Boolean(mediaFile?.isImporting);
  const needsRelink = Boolean(mediaFile && mediaNeedsRelink(mediaFile));
  const importProgress = getItemImportProgress(item);
  const waveformProgress = getItemWaveformProgress(item);
  const duration = mediaFile?.duration || composition?.duration || ('duration' in item ? item.duration : undefined);

  return (
    <div key={item.id} data-item-id={item.id}>
      <div
        data-media-panel-anim-id={item.id}
        className={`media-grid-item ${selected ? 'selected' : ''} ${isFolder ? 'folder' : ''} ${needsRelink ? 'no-file' : ''} ${dragTarget ? 'drag-target' : ''} ${importing ? 'importing' : ''}`}
        draggable={!importing}
        onDragStart={(event) => onDragStart(event, item)}
        onPointerDown={isTrackingAsset ? undefined : (event) => onTouchTimelineDragPointerDown(event, item)}
        onDragEnd={onDragEnd}
        onDragOver={isFolder ? (event) => onFolderDragOver(event, item.id) : undefined}
        onDragLeave={isFolder ? onFolderDragLeave : undefined}
        onDrop={isFolder ? (event) => onFolderDrop(event, item.id) : undefined}
        onClick={(event) => onClick(event, item.id)}
        onDoubleClick={(event) => onDoubleClick(
          item,
          event.target instanceof Element && Boolean(event.target.closest('.media-grid-name')),
        )}
        onContextMenu={(event) => onContextMenu(event, item.id)}
        title={buildTooltip(item, isFolder, isComposition)}
      >
        <div className="media-grid-thumb">
          {mediaFile?.type === 'video' ? (
            <MediaGridVideoThumb
              mediaFile={mediaFile}
              thumbUrl={thumbUrl}
              onError={() => onRefreshFileUrls(mediaFile.id)}
            />
          ) : mediaFile?.type === 'audio' ? (
            <MediaWaveformThumb mediaFile={mediaFile as MediaFile} />
          ) : thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              draggable={false}
              onError={mediaFile ? () => onRefreshFileUrls(mediaFile.id) : undefined}
            />
          ) : (
            <div className="media-grid-thumb-placeholder">
              <FileTypeIcon type={isFolder ? 'folder' : isComposition ? 'composition' : getProjectItemIconType(item)} large />
            </div>
          )}
          {duration ? (
            <span className="media-grid-duration">{formatMediaDuration(duration)}</span>
          ) : null}
          {isFolder && folderItemCount > 0 && (
            <span className="media-grid-badge">{folderItemCount}</span>
          )}
          {importProgress !== null && (
            <span className="media-grid-import-badge">{importProgress}%</span>
          )}
          {importProgress === null && waveformProgress !== null && (
            <span className="media-grid-waveform-badge" title={`Generating waveform: ${waveformProgress}%`}>
              <span className="waveform-progress-mark">W</span>
              <span>{waveformProgress}%</span>
            </span>
          )}
          {needsRelink && mediaFile ? (
            <MediaReconnectButton mediaFileId={mediaFile.id} variant="overlay" />
          ) : null}
          {isTrackingAsset ? <TrackingAssetActions asset={item} /> : null}
        </div>
        <div
          className="media-grid-name"
          data-guided-media-name={item.id}
          title={item.name}
        >
          {item.name}
        </div>
      </div>
    </div>
  );
}
