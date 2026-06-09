import type { PointerEvent, Ref } from 'react';
import type { FlashBoardComposerReferenceRole } from '../../../stores/flashboardStore';
import { FileTypeIcon } from '../media/FileTypeIcon';

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

interface FlashBoardReferenceStripProps {
  badges: ComposerReferenceBadge[];
  referenceStripRef: Ref<HTMLDivElement>;
  supportsEndFrameReference: boolean;
  supportsTimelineReferenceRoles: boolean;
  onHoverReference: (reference: { mediaFileId: string; role: FlashBoardComposerReferenceRole } | null) => void;
  onPointerLeave: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onReferenceRoleChange: (badge: ComposerReferenceBadge, role: FlashBoardComposerReferenceRole) => void;
  onRemoveReference: (badge: ComposerReferenceBadge) => void;
}

export function FlashBoardReferenceStrip({
  badges,
  referenceStripRef,
  supportsEndFrameReference,
  supportsTimelineReferenceRoles,
  onHoverReference,
  onPointerLeave,
  onPointerMove,
  onReferenceRoleChange,
  onRemoveReference,
}: FlashBoardReferenceStripProps) {
  return (
    <div
      ref={referenceStripRef}
      className={`fb-reference-strip ${badges.length <= 3 ? 'is-loose' : ''}`}
      aria-label="AI prompt references"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {badges.map((badge) => (
        <div
          key={badge.key}
          className={`fb-reference-card ${badge.role} ${badge.mediaType}`}
          title={badge.displayName}
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
