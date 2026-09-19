import { useState, type CSSProperties, type DragEvent, type PointerEvent, type Ref } from 'react';
import type { FlashBoardComposerReferenceRole } from '../../../stores/flashboardStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { FileTypeIcon } from '../media/FileTypeIcon';
import { MEDIA_FILE_DRAG_MIME } from './useFlashBoardReferenceDrop';

const REFERENCE_REORDER_DRAG_MIME = 'application/x-flashboard-reference-id';

export interface ComposerReferenceBadge {
  key: string;
  role: FlashBoardComposerReferenceRole;
  mediaFileId: string;
  mediaType: 'image' | 'video' | 'audio';
  previewUrl?: string;
  roleLabel: string;
  thumbnailUrl?: string;
  displayName: string;
}

export interface ComposerReferenceSlot {
  accepts?: Array<'image' | 'video' | 'audio'>;
  key: string;
  role: FlashBoardComposerReferenceRole;
  roleLabel: string;
  title: string;
  displayName: string;
  className?: string;
}

interface FlashBoardReferenceStripProps {
  activeSlotKey: string | null;
  badges: ComposerReferenceBadge[];
  slots: ComposerReferenceSlot[];
  referenceStripRef: Ref<HTMLDivElement>;
  supportsEndFrameReference: boolean;
  supportsTimelineReferenceRoles: boolean;
  onHoverReference: (reference: { mediaFileId: string; role: FlashBoardComposerReferenceRole } | null) => void;
  onPointerLeave: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onReferenceRoleChange: (badge: ComposerReferenceBadge, role: FlashBoardComposerReferenceRole) => void;
  onReorderReference: (draggedId: string, targetId: string) => void;
  onRemoveReference: (badge: ComposerReferenceBadge) => void;
  onSlotDragOver: (slot: ComposerReferenceSlot, event: DragEvent<HTMLDivElement>) => void;
  onSlotDrop: (slot: ComposerReferenceSlot, event: DragEvent<HTMLDivElement>) => void;
}

function getReferenceViewTransitionStyle(key: string): CSSProperties {
  return {
    viewTransitionName: `fb-reference-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
  } as CSSProperties;
}

export function FlashBoardReferenceStrip({
  activeSlotKey,
  badges,
  slots,
  referenceStripRef,
  supportsEndFrameReference,
  supportsTimelineReferenceRoles,
  onHoverReference,
  onPointerLeave,
  onPointerMove,
  onReferenceRoleChange,
  onReorderReference,
  onRemoveReference,
  onSlotDragOver,
  onSlotDrop,
}: FlashBoardReferenceStripProps) {
  const setSourceMonitorFile = useMediaStore((s) => s.setSourceMonitorFile);
  const [draggedReferenceId, setDraggedReferenceId] = useState<string | null>(null);
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null);
  const visualItemCount = badges.length + (slots.length > 0 ? 1 : 0);

  return (
    <div
      ref={referenceStripRef}
      className={`fb-reference-strip ${visualItemCount <= 3 ? 'is-loose' : ''}`}
      aria-label="AI prompt references"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {slots.length > 0 && (
        <div className="fb-reference-slot-grid" aria-label="Available reference inputs">
          {slots.map((slot) => (
            <div
              key={slot.key}
              className={`fb-reference-card fb-reference-slot ${slot.role} ${slot.className ?? ''} ${activeSlotKey === slot.key ? 'is-active' : ''}`}
              title={slot.title}
              aria-label={slot.title}
              data-slot-accepts={slot.accepts?.join(' ') ?? ''}
              data-slot-key={slot.key}
              data-slot-role={slot.role}
              style={getReferenceViewTransitionStyle(`slot-${slot.key}`)}
              onDragOverCapture={(event) => onSlotDragOver(slot, event)}
              onDropCapture={(event) => onSlotDrop(slot, event)}
            >
              <div className="fb-reference-preview" aria-hidden="true">
                <span className="fb-reference-slot-label">{slot.roleLabel}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {badges.map((badge) => (
        <div
          key={badge.key}
          className={`fb-reference-card fb-reference-badge ${badge.role} ${badge.mediaType} ${draggedReferenceId === badge.mediaFileId ? 'is-dragging' : ''} ${reorderTargetId === badge.mediaFileId ? 'is-reorder-target' : ''}`}
          title={badge.role === 'reference'
            ? `${badge.displayName} - drag to reorder or add it to the prompt`
            : badge.displayName}
          style={getReferenceViewTransitionStyle(badge.key)}
          draggable={badge.role === 'reference'}
          onDragStart={(event) => {
            if (badge.role !== 'reference' || (event.target as Element).closest('button')) {
              event.preventDefault();
              return;
            }
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'copyMove';
            event.dataTransfer.setData(MEDIA_FILE_DRAG_MIME, badge.mediaFileId);
            event.dataTransfer.setData(REFERENCE_REORDER_DRAG_MIME, badge.mediaFileId);
            setDraggedReferenceId(badge.mediaFileId);
          }}
          onDragEnter={(event) => {
            if (
              badge.role === 'reference'
              && event.dataTransfer.types.includes(REFERENCE_REORDER_DRAG_MIME)
              && draggedReferenceId !== badge.mediaFileId
            ) {
              setReorderTargetId(badge.mediaFileId);
            }
          }}
          onDragOver={(event) => {
            if (
              badge.role !== 'reference'
              || !event.dataTransfer.types.includes(REFERENCE_REORDER_DRAG_MIME)
              || draggedReferenceId === badge.mediaFileId
            ) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setReorderTargetId((currentId) => (
                currentId === badge.mediaFileId ? null : currentId
              ));
            }
          }}
          onDrop={(event) => {
            const sourceId = event.dataTransfer.getData(REFERENCE_REORDER_DRAG_MIME);
            if (badge.role !== 'reference' || !sourceId || sourceId === badge.mediaFileId) return;
            event.preventDefault();
            event.stopPropagation();
            setReorderTargetId(null);
            onReorderReference(sourceId, badge.mediaFileId);
          }}
          onDragEnd={() => {
            setDraggedReferenceId(null);
            setReorderTargetId(null);
          }}
          onDoubleClick={() => setSourceMonitorFile(badge.mediaFileId)}
          onMouseEnter={() => onHoverReference({ mediaFileId: badge.mediaFileId, role: badge.role })}
          onMouseLeave={() => onHoverReference(null)}
        >
          <span className="fb-reference-number">{badge.roleLabel.replace('REF ', '')}</span>
          <button
            className="fb-reference-remove"
            type="button"
            onClick={() => onRemoveReference(badge)}
            title={`Remove ${badge.roleLabel}`}
          >
            &times;
          </button>
          {supportsTimelineReferenceRoles && (
            <div className="fb-reference-role-actions" aria-label={`Role for ${badge.displayName}`}>
              <button
                className={`fb-reference-role-button ${badge.role === 'start' ? 'active' : ''}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onReferenceRoleChange(badge, 'start');
                }}
                title="Use as start frame"
                aria-pressed={badge.role === 'start'}
              >
                IN
              </button>
              <button
                className={`fb-reference-role-button ${badge.role === 'reference' ? 'active' : ''}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onReferenceRoleChange(badge, 'reference');
                }}
                title="Use as regular reference"
                aria-pressed={badge.role === 'reference'}
              >
                REF
              </button>
              <button
                className={`fb-reference-role-button ${badge.role === 'end' ? 'active' : ''}`}
                type="button"
                disabled={!supportsEndFrameReference}
                onClick={(event) => {
                  event.stopPropagation();
                  onReferenceRoleChange(badge, 'end');
                }}
                title={supportsEndFrameReference ? 'Use as end frame' : 'End frames are unavailable in multi-shot mode'}
                aria-pressed={badge.role === 'end'}
              >
                OUT
              </button>
            </div>
          )}
          <div className="fb-reference-preview">
            {badge.thumbnailUrl ? (
              <img src={badge.thumbnailUrl} alt="" draggable={false} />
            ) : badge.mediaType === 'video' && badge.previewUrl ? (
              <video src={badge.previewUrl} muted playsInline preload="metadata" />
            ) : (
              <div className="fb-reference-placeholder">
                <FileTypeIcon type={badge.mediaType} large />
              </div>
            )}
          </div>
          <div className="fb-reference-name">{badge.displayName}</div>
        </div>
      ))}
    </div>
  );
}
