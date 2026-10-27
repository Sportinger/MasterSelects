// Placement controls of the overlay sheet: a 3x3 position grid (five active cells: the corners and the
// centre) and a three-step size control. Both are radio groups whose options keep the chip test ids
// (`${testId}-${value}`) and report their state through aria-checked.

import { blurAfterPointer, phoneChipTestId } from '../crop/phoneDesignControls';
import { PHONE_OVERLAY_PLACES, PHONE_OVERLAY_SIZES, type PhoneOverlayPlace, type PhoneOverlaySize } from './phoneOverlayPlan';
import './PhoneOverlay.css';

/** Grid cells row by row; null cells are inactive spacers. */
const GRID: readonly (PhoneOverlayPlace | null)[] = [
  'top-left', null, 'top-right',
  null, 'center', null,
  'bottom-left', null, 'bottom-right',
];

export function PhoneOverlayPlaceGrid({ value, testId, onChange }: {
  value: PhoneOverlayPlace;
  testId: string;
  onChange: (place: PhoneOverlayPlace) => void;
}) {
  return (
    <div className="phone-overlay-grid" role="radiogroup" aria-label="Overlay place" data-testid={testId}>
      {GRID.map((place, index) => {
        if (!place) return <span key={`gap-${index}`} className="phone-overlay-grid__gap" aria-hidden="true" />;
        const label = PHONE_OVERLAY_PLACES.find((entry) => entry.value === place)?.label ?? place;
        return (
          <button
            key={place}
            type="button"
            role="radio"
            className="phone-overlay-grid__cell"
            aria-checked={value === place}
            aria-label={label}
            data-testid={phoneChipTestId(testId, place)}
            data-value={place}
            onPointerUp={blurAfterPointer}
            onClick={() => onChange(place)}
          >
            <span className="phone-overlay-grid__dot" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function PhoneOverlaySizeControl({ value, testId, onChange }: {
  value: PhoneOverlaySize;
  testId: string;
  onChange: (size: PhoneOverlaySize) => void;
}) {
  return (
    <div className="phone-overlay-size" role="radiogroup" aria-label="Overlay size" data-testid={testId}>
      {PHONE_OVERLAY_SIZES.map((entry) => (
        <button
          key={entry.value}
          type="button"
          role="radio"
          className="phone-overlay-size__option"
          aria-checked={value === entry.value}
          data-testid={phoneChipTestId(testId, entry.value)}
          data-value={entry.value}
          onPointerUp={blurAfterPointer}
          onClick={() => onChange(entry.value)}
        >
          <span className="phone-overlay-size__icon" aria-hidden="true" style={{ transform: `scale(${0.45 + entry.scale * 0.55})` }} />
          <span>{entry.label}</span>
        </button>
      ))}
    </div>
  );
}
