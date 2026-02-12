// Label color picker popup
import { LABEL_COLORS } from './labelColors';

interface LabelColorPickerProps {
  position: { x: number; y: number };
  selectedIds: string[];
  labelPickerItemId: string;
  onSelect: (ids: string[], colorKey: string) => void;
  onClose: () => void;
}

export function LabelColorPicker({ position, selectedIds, labelPickerItemId, onSelect, onClose }: LabelColorPickerProps) {
  return (
    <>
      <div
        className="label-picker-backdrop"
        onClick={onClose}
      />
      <div
        className="label-picker-popup"
        style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 10002 }}
      >
        {LABEL_COLORS.map(c => (
          <span
            key={c.key}
            className={`label-picker-swatch ${c.key === 'none' ? 'none' : ''}`}
            title={c.name}
            style={{ background: c.key === 'none' ? 'var(--bg-tertiary)' : c.hex }}
            onClick={() => {
              const ids = selectedIds.includes(labelPickerItemId) ? selectedIds : [labelPickerItemId];
              onSelect(ids, c.key);
            }}
          >
            {c.key === 'none' && <span className="label-picker-x">&times;</span>}
          </span>
        ))}
      </div>
    </>
  );
}
