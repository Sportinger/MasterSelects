import { useEffect, useState } from 'react';
import { IconMagnet } from '@tabler/icons-react';

interface TimelineSnappingButtonProps {
  snappingEnabled: boolean;
  onToggleSnapping: () => void;
}

export function TimelineSnappingButton({
  snappingEnabled,
  onToggleSnapping,
}: TimelineSnappingButtonProps) {
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShiftHeld(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShiftHeld(false);
    };
    const clearModifier = () => setShiftHeld(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearModifier);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearModifier);
    };
  }, []);

  const temporarilyEnabled = !snappingEnabled && shiftHeld;
  const effectivelyEnabled = snappingEnabled || temporarilyEnabled;
  const title = temporarilyEnabled
    ? 'Snapping temporarily enabled while Shift is held'
    : snappingEnabled
      ? 'Snapping enabled - hold Alt to bypass'
      : 'Snapping disabled - hold Shift to snap temporarily';

  return (
    <button
      type="button"
      className={`timeline-tool-button timeline-snapping-button ${effectivelyEnabled ? 'active' : ''}`}
      aria-label="Snapping"
      aria-pressed={effectivelyEnabled}
      data-temporary-active={temporarilyEnabled ? 'true' : undefined}
      onClick={(event) => {
        onToggleSnapping();
        if (event.detail > 0) event.currentTarget.blur();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        onToggleSnapping();
      }}
      title={title}
    >
      <IconMagnet className="timeline-tool-button-icon" size={18} stroke={2.2} aria-hidden="true" />
    </button>
  );
}
