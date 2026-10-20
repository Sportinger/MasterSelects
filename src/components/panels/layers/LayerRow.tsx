import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { IconChevronRight, IconEye, IconEyeOff, IconLock, IconLockOpen } from '@tabler/icons-react';
import type { ImageLayer } from '../../../services/imageDocument/imageLayers';
import { useMediaStore } from '../../../stores/mediaStore';
import { LayerEffectRows, LayerMaskRow } from './LayerStackRows';

export const LAYER_DRAG_TYPE = 'application/x-masterselects-layer-track';

export interface LayerRowActions {
  onSelect: (clipId: string, additive: boolean) => void;
  onToggleVisible: (trackId: string, visible: boolean) => void;
  onToggleLocked: (trackId: string, locked: boolean) => void;
  onRename: (clipId: string, name: string) => void;
  onDragOverRow: (trackId: string, position: 'above' | 'below') => void;
  onDropOnRow: (sourceTrackId: string, targetTrackId: string) => void;
  onToggleExpanded: (clipId: string) => void;
  onOpenProperties: (clipId: string, tab: 'effects' | 'masks') => void;
  onToggleMask: (clipId: string, maskId: string, enabled: boolean) => void;
  onToggleEffect: (clipId: string, effectId: string, enabled: boolean) => void;
  onReorderEffect: (clipId: string, effectId: string, newIndex: number) => void;
}

interface LayerRowProps {
  layer: ImageLayer;
  selected: boolean;
  expanded: boolean;
  dropPosition: 'above' | 'below' | null;
  actions: LayerRowActions;
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

export function LayerRow({ layer, selected, expanded, dropPosition, actions }: LayerRowProps) {
  const { track, clip } = layer;
  const thumbnail = useLayerThumbnail(layer);
  const [editingName, setEditingName] = useState<string | null>(null);
  const masks = clip.masks ?? [];
  const effects = clip.effects;
  const hasStack = masks.length > 0 || effects.length > 0;

  const commitName = () => {
    if (editingName !== null && editingName.trim() && editingName.trim() !== clip.name) {
      actions.onRename(clip.id, editingName.trim());
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
    actions.onDragOverRow(track.id, event.clientY < rect.top + rect.height / 2 ? 'above' : 'below');
  };

  return (
    <div className="layers-entry">
      <div
        aria-expanded={hasStack ? expanded : undefined}
        aria-selected={selected}
        className={[
          'layers-row',
          selected ? 'selected' : '',
          track.visible ? '' : 'hidden-layer',
          dropPosition ? `drop-${dropPosition}` : '',
        ].filter(Boolean).join(' ')}
        draggable={editingName === null && !track.locked}
        onClick={(event) => actions.onSelect(clip.id, event.shiftKey || event.metaKey || event.ctrlKey)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            actions.onSelect(clip.id, event.shiftKey);
          } else if (hasStack && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
            event.preventDefault();
            if ((event.key === 'ArrowRight') !== expanded) actions.onToggleExpanded(clip.id);
          }
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
          actions.onDropOnRow(sourceTrackId, track.id);
        }}
        role="option"
        tabIndex={0}
      >
        <button
          aria-label={track.visible ? 'Hide layer' : 'Show layer'}
          aria-pressed={track.visible}
          className="layers-icon-button"
          onClick={(event) => { event.stopPropagation(); actions.onToggleVisible(track.id, !track.visible); }}
          title={track.visible ? 'Hide layer' : 'Show layer'}
          type="button"
        >
          {track.visible ? <IconEye aria-hidden="true" size={15} /> : <IconEyeOff aria-hidden="true" size={15} />}
        </button>
        <button
          aria-label={expanded ? 'Collapse masks and effects' : 'Show masks and effects'}
          className={`layers-icon-button layers-expand${expanded ? ' expanded' : ''}`}
          disabled={!hasStack}
          onClick={(event) => { event.stopPropagation(); actions.onToggleExpanded(clip.id); }}
          tabIndex={-1}
          title={hasStack ? 'Masks and effects' : undefined}
          type="button"
        >
          {hasStack && <IconChevronRight aria-hidden="true" size={13} />}
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
          {hasStack && (
            <small>
              {masks.length > 0 && `${masks.length} mask${masks.length === 1 ? '' : 's'}`}
              {masks.length > 0 && effects.length > 0 && ' · '}
              {effects.length > 0 && `${effects.length} fx`}
            </small>
          )}
        </div>
        <button
          aria-label={track.locked ? 'Unlock layer' : 'Lock layer'}
          aria-pressed={track.locked === true}
          className={`layers-icon-button layers-lock${track.locked ? ' active' : ''}`}
          onClick={(event) => { event.stopPropagation(); actions.onToggleLocked(track.id, !track.locked); }}
          title={track.locked ? 'Unlock layer' : 'Lock layer'}
          type="button"
        >
          {track.locked ? <IconLock aria-hidden="true" size={14} /> : <IconLockOpen aria-hidden="true" size={14} />}
        </button>
      </div>
      {expanded && hasStack && (
        <div className="layers-children" role="group" aria-label={`${clip.name} masks and effects`}>
          {masks.map((mask) => (
            <LayerMaskRow
              key={mask.id}
              mask={mask}
              onOpen={() => actions.onOpenProperties(clip.id, 'masks')}
              onToggleEnabled={(enabled) => actions.onToggleMask(clip.id, mask.id, enabled)}
            />
          ))}
          <LayerEffectRows
            effects={effects}
            onOpen={() => actions.onOpenProperties(clip.id, 'effects')}
            onReorder={(effectId, newIndex) => actions.onReorderEffect(clip.id, effectId, newIndex)}
            onToggleEnabled={(effectId, enabled) => actions.onToggleEffect(clip.id, effectId, enabled)}
          />
        </div>
      )}
    </div>
  );
}
