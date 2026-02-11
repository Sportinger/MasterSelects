// AE label color palette (exported for reuse in TimelineClip)
import type { LabelColor } from '../../../stores/mediaStore/types';

export const LABEL_COLORS: { key: LabelColor; hex: string; name: string }[] = [
  { key: 'none', hex: 'transparent', name: 'None' },
  { key: 'red', hex: '#e2514c', name: 'Red' },
  { key: 'yellow', hex: '#dbb63b', name: 'Yellow' },
  { key: 'aqua', hex: '#4ec0c0', name: 'Aqua' },
  { key: 'pink', hex: '#d77bba', name: 'Pink' },
  { key: 'lavender', hex: '#a278c1', name: 'Lavender' },
  { key: 'peach', hex: '#e8a264', name: 'Peach' },
  { key: 'seafoam', hex: '#6bc488', name: 'Sea Foam' },
  { key: 'blue', hex: '#4a90e2', name: 'Blue' },
  { key: 'green', hex: '#6db849', name: 'Green' },
  { key: 'purple', hex: '#8b5fc7', name: 'Purple' },
  { key: 'orange', hex: '#e07934', name: 'Orange' },
  { key: 'brown', hex: '#a57249', name: 'Brown' },
  { key: 'fuchsia', hex: '#d14da1', name: 'Fuchsia' },
  { key: 'cyan', hex: '#49bce3', name: 'Cyan' },
  { key: 'tan', hex: '#c4a86c', name: 'Tan' },
];

export function getLabelHex(color?: LabelColor): string {
  if (!color || color === 'none') return 'transparent';
  return LABEL_COLORS.find(c => c.key === color)?.hex || 'transparent';
}
