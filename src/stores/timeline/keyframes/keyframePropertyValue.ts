import { normalizeTextValue, parseTextProperty } from '../../../services/text/textAnimation';

export function normalizeTimelinePropertyValue(property: string, value: number): number {
  const text = parseTextProperty(property);
  if (text) return normalizeTextValue(text, value);
  if (property === 'opacity') {
    return Math.max(0, Math.min(1, value));
  }
  return value;
}
