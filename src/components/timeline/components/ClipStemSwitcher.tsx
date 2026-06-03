import { memo } from 'react';
import { IconFileMusic } from '@tabler/icons-react';
import type { ClipStemSeparationJobStemChoice } from '../../../stores/timeline/types';
import { StemChoiceIcon } from './ClipStemDisplay';

interface ClipStemSwitcherProps {
  stemMenuOpen: boolean;
  completedStemChoices: readonly ClipStemSeparationJobStemChoice[];
  hasStemSourceChoice: boolean;
  stemSourceMediaFileId: string | null;
  activeStemMediaFileId?: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onControlMouseDown: (e: React.MouseEvent) => void;
  onBadgeClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onChoiceClick: (mediaFileId: string) => (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const ClipStemSwitcher = memo(function ClipStemSwitcher({
  stemMenuOpen,
  completedStemChoices,
  hasStemSourceChoice,
  stemSourceMediaFileId,
  activeStemMediaFileId,
  onMouseEnter,
  onMouseLeave,
  onControlMouseDown,
  onBadgeClick,
  onChoiceClick,
}: ClipStemSwitcherProps) {
  return (
    <div
      className={`clip-stem-switcher ${stemMenuOpen ? 'open' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        className="clip-stem-ready-badge"
        aria-label="Show separated stems"
        title="Separated stems ready"
        onMouseDown={onControlMouseDown}
        onClick={onBadgeClick}
      >
        S
      </button>
      {stemMenuOpen && (
        <div className="clip-stem-menu" role="menu" aria-label="Use stem source">
          {hasStemSourceChoice && stemSourceMediaFileId && (
            <button
              type="button"
              className={`clip-stem-choice-button source ${activeStemMediaFileId === stemSourceMediaFileId ? 'active' : ''}`}
              role="menuitem"
              aria-label="Use source audio"
              title="Use source audio"
              onMouseDown={onControlMouseDown}
              onClick={onChoiceClick(stemSourceMediaFileId)}
            >
              <IconFileMusic className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />
            </button>
          )}
          {completedStemChoices.map(stem => {
            const isActiveStemSource = activeStemMediaFileId === stem.mediaFileId;
            return (
              <button
                key={stem.id}
                type="button"
                className={`clip-stem-choice-button ${isActiveStemSource ? 'active' : ''}`}
                role="menuitem"
                aria-label={`Use ${stem.label} stem`}
                title={`Use ${stem.label} stem as clip source`}
                onMouseDown={onControlMouseDown}
                onClick={onChoiceClick(stem.mediaFileId)}
              >
                <StemChoiceIcon kind={stem.kind} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
