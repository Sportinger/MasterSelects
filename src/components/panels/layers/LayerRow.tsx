import { useState, type DragEvent, type KeyboardEvent } from 'react';
import type { ImageLayer } from '../../../services/imageDocument/imageLayers';
import { useMediaStore } from '../../../stores/mediaStore';
import { EyeIcon, LockIcon } from './LayerIcons';

export const LAYER_DRAG_TYPE = 'application/x-masterselects-layer-track';

interface LayerRowProps {
  layer: ImageLayer;
  selected: boolean;
  dropPosition: 'above' | 'below' | null;
  onSelect: (clipId: string, additive: boolean) => void;
  onToggleVisible: (trackId: string, visible: boolean) => void;
  onToggleLocked: (trackId: string, locked: boolean) => void;
  onRename: (clipId: string, name: string) => void;
  onDragOverRow: (trackId: string, position: 'above' | 'below') => void;
  onDropOnRow: (sourceTrackId: string, targetTrackId: string) => void;
}

function useLayerThumbnail(layer: ImageLayer): string | null {
  const mediaThumbnail = useMediaStore((state) => {
    const mediaFileId = layer.clip.mediaFileId ?? layer.clip.source?.mediaFileId;
    return mediaFileId ? state.files.find((file) => file.id === mediaFileId)?.thumbnailUrl ?? null : null;
  });
  return layer.clip.source?.imageUrl ?? mediaThumbnail ?? layer.clip.thumbnails?.[0] ?? null;
}

function sourceGlyph(type: string | undefined): string {
  switch (type) {
    case 'text': return 'T';
    case 'video': return '▶';
    case 'motion': return '◆';
    default: return '▣';
  }
}

export function LayerRow({
  layer, selected, dropPosition, onSelect, onToggleVisible, onToggleLocked, onRename, onDragOverRow, onDropOnRow,
}: LayerRowProps) {
  const { track, clip } = layer;
  const thumbnail = useLayerThumbnail(layer);
  const [editingName, setEditingName] = useState<string | null>(null);
  const maskCount = clip.masks?.length ?? 0;
  const effectCount = clip.effects.length;

  const commitName = () => {
    if (editingName !== null && editingName.trim() && editingName.trim() !== clip.name) {
      onRename(clip.id, editingName.trim());
    }
    setEditingName(null);
  };
  const handleNameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commitName();
    if (event.key === 'Escape') setEditingName(null);
  };
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(LAYER_DRAG_TYPE)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onDragOverRow(track.id, event.clientY < rect.top + rect.height / 2 ? 'above' : 'below');
  };

  return (
    <div
      aria-selected={selected}
      className={[
        'layers-row',
        selected ? 'selected' : '',
        track.visible ? '' : 'hidden-layer',
        dropPosition ? `drop-${dropPosition}` : '',
      ].filter(Boolean).join(' ')}
      draggable={editingName === null && !track.locked}
      onClick={(event) => onSelect(clip.id, event.shiftKey || event.metaKey || event.ctrlKey)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onSelect(clip.id, event.shiftKey);
      }}
      onDragOver={handleDragOver}
      onDragStart={(event) => {
        event.dataTransfer.setData(LAYER_DRAG_TYPE, track.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDrop={(event) => {
        const sourceTrackId = event.dataTransfer.getData(LAYER_DRAG_TYPE);
        if (!sourceTrackId) return;
        event.preventDefault();
        onDropOnRow(sourceTrackId, track.id);
      }}
      role="option"
      tabIndex={0}
    >
      <button
        aria-label={track.visible ? 'Hide layer' : 'Show layer'}
        aria-pressed={track.visible}
        className="layers-icon-button"
        onClick={(event) => { event.stopPropagation(); onToggleVisible(track.id, !track.visible); }}
        title={track.visible ? 'Hide layer' : 'Show layer'}
        type="button"
      >
        <EyeIcon open={track.visible} />
      </button>
      <div className="layers-thumbnail" aria-hidden="true">
        {clip.solidColor
          ? <span className="layers-thumbnail-swatch" style={{ background: clip.solidColor }} />
          : thumbnail
            ? <img alt="" draggable={false} src={thumbnail} />
            : <span>{sourceGlyph(clip.source?.type)}</span>}
      </div>
      <div className="layers-name">
        {editingName !== null ? (
          <input
            aria-label="Layer name"
            autoFocus
            onBlur={commitName}
            onChange={(event) => setEditingName(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleNameKey}
            value={editingName}
          />
        ) : (
          <span onDoubleClick={(event) => { event.stopPropagation(); setEditingName(clip.name); }} title={clip.name}>
            {clip.name}
          </span>
        )}
        {(maskCount > 0 || effectCount > 0) && (
          <small>
            {maskCount > 0 && `${maskCount} mask${maskCount === 1 ? '' : 's'}`}
            {maskCount > 0 && effectCount > 0 && ' · '}
            {effectCount > 0 && `${effectCount} fx`}
          </small>
        )}
      </div>
      <button
        aria-label={track.locked ? 'Unlock layer' : 'Lock layer'}
        aria-pressed={track.locked === true}
        className={`layers-icon-button layers-lock${track.locked ? ' active' : ''}`}
        onClick={(event) => { event.stopPropagation(); onToggleLocked(track.id, !track.locked); }}
        title={track.locked ? 'Unlock layer' : 'Lock layer'}
        type="button"
      >
        <LockIcon locked={track.locked === true} />
      </button>
    </div>
  );
}
