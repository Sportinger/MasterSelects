import type { ToolResult } from '../aiTools/types';

/** In exec the result is a content-item array; stringifying it would dump ~1M tokens of base64. */
const IMAGE_PLACEHOLDER = '[image attached as the inputImage content item; in exec view it with image(item.imageUrl, "low"), never text() the result]';

function serializeToolResult(result: ToolResult): string {
  const serialized = JSON.stringify(result, (_key, value) => (
    typeof value === 'string' && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value)
      ? IMAGE_PLACEHOLDER
      : value
  ));
  return serialized;
}

function findImageDataUrl(value: unknown, seen = new WeakSet<object>()): string | undefined {
  if (typeof value === 'string' && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value)) {
    return value;
  }
  if (value === null || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findImageDataUrl(entry, seen);
      if (found) return found;
    }
    return undefined;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const found = findImageDataUrl(entry, seen);
    if (found) return found;
  }
  return undefined;
}

/** App-server content items for one editor tool result: serialized text plus at most one image. */
export function directToolContentItems(result: ToolResult): Array<Record<string, unknown>> {
  const contentItems: Array<Record<string, unknown>> = [{
    text: serializeToolResult(result),
    type: 'inputText',
  }];
  const imageUrl = findImageDataUrl(result.data);
  if (imageUrl) contentItems.push({ imageUrl, type: 'inputImage' });
  return contentItems;
}
