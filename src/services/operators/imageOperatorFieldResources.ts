export const NEAREST_SEED_FIELD_FORMAT = 'nearest-seed-rgba16float' as const;
export interface ImageOperatorFieldResource {
  resourceId: string;
  producerNodeId: string;
  outputPort: 'field';
  format: typeof NEAREST_SEED_FIELD_FORMAT;
}

// Field resources use the compiled image program's frame resolution; cross-resolution field reads require a separate explicit contract.

export function resolveImageOperatorFieldResource(
  declarations: readonly ImageOperatorFieldResource[] | undefined,
  producerNodeId: string,
  outputPort: string,
): ImageOperatorFieldResource {
  const ids = new Set<string>(), producers = new Set<string>();
  for (const item of declarations ?? []) {
    if (!item.resourceId || item.resourceId === 'effect-history' || item.resourceId.startsWith('image-resource:') || item.resourceId.startsWith('glyph-atlas:')) {
      throw new Error(`Nearest-seed field resource ${item.resourceId || '<empty>'} uses an invalid or reserved id.`);
    }
    if (item.outputPort !== 'field' || item.format !== NEAREST_SEED_FIELD_FORMAT) throw new Error('Nearest-seed field resource has an invalid port or format.');
    const producer = `${item.producerNodeId}:${item.outputPort}`;
    if (ids.has(item.resourceId) || producers.has(producer)) throw new Error('Nearest-seed field resource declarations must be unique.');
    ids.add(item.resourceId); producers.add(producer);
  }
  const found = declarations?.find(item => item.producerNodeId === producerNodeId && item.outputPort === outputPort);
  if (!found) throw new Error(`Nearest-seed field ${producerNodeId}:${outputPort} is not declared in the compile context.`);
  return found;
}
