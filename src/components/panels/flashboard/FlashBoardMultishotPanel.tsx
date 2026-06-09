import type { FlashBoardMultiShotPrompt } from '../../../stores/flashboardStore';

interface FlashBoardMultishotPanelProps {
  canAddShot: boolean;
  duration: number;
  isClosing: boolean;
  shots: FlashBoardMultiShotPrompt[];
  totalDuration: number;
  validationError: string | null;
  onAddShot: () => void;
  onRemoveShot: (index: number) => void;
  onShotDurationChange: (index: number, value: string) => void;
  onShotPromptChange: (index: number, value: string) => void;
}

export function FlashBoardMultishotPanel({
  canAddShot,
  duration,
  isClosing,
  shots,
  totalDuration,
  validationError,
  onAddShot,
  onRemoveShot,
  onShotDurationChange,
  onShotPromptChange,
}: FlashBoardMultishotPanelProps) {
  return (
    <div className={`fb-multishot-panel ${isClosing ? 'is-closing' : 'is-opening'}`}>
      <div className="fb-multishot-header">
        <span>Shots</span>
        <span className={`fb-multishot-total ${validationError ? 'error' : ''}`}>
          {totalDuration}/{duration}s
        </span>
      </div>

      <div className="fb-multishot-list">
        {shots.map((shot, index) => (
          <div key={`shot-${shot.index}`} className="fb-multishot-item">
            <div className="fb-multishot-item-header">
              <span className="fb-multishot-item-title">Shot {shot.index}</span>
              <div className="fb-multishot-item-actions">
                <input
                  className="fb-multishot-duration"
                  type="number"
                  min={1}
                  max={duration}
                  value={shot.duration}
                  onChange={(event) => onShotDurationChange(index, event.target.value)}
                />
                <span className="fb-multishot-duration-unit">s</span>
                <button
                  className="fb-multishot-remove"
                  type="button"
                  onClick={() => onRemoveShot(index)}
                  disabled={shots.length <= 2}
                  title="Remove shot"
                >
                  &times;
                </button>
              </div>
            </div>
            <textarea
              className="fb-multishot-input"
              value={shot.prompt}
              onChange={(event) => onShotPromptChange(index, event.target.value)}
              placeholder={`Shot ${shot.index} prompt`}
              rows={2}
              maxLength={500}
            />
            <div className="fb-multishot-count">{shot.prompt.length}/500</div>
          </div>
        ))}
      </div>

      <div className="fb-multishot-footer">
        <button
          className="fb-multishot-add"
          type="button"
          onClick={onAddShot}
          disabled={!canAddShot}
        >
          + Shot
        </button>
        <span className={`fb-multishot-hint ${validationError ? 'error' : ''}`}>
          {validationError ?? 'Multishot uses one start frame only and forces sound.'}
        </span>
      </div>
    </div>
  );
}
