// The sources an output target can show, shared by the desktop source dropdown and the phone editor.

import type { RenderSource } from '../../types/renderTarget';

export interface OutputSourceOption {
  key: string;
  label: string;
  source: RenderSource;
  group: 'active' | 'composition' | 'slot';
}

interface NamedComposition { id: string; name: string }

export function outputSourceKey(source: RenderSource): string {
  switch (source.type) {
    case 'activeComp': return 'active';
    case 'program': return 'program';
    case 'composition': return `comp:${source.compositionId}`;
    case 'slot': return `slot:${source.slotIndex}`;
    case 'layer': return `layer:${source.layerIds.join(',')}`;
    default: return 'unknown';
  }
}

export function outputSourceLabel(source: RenderSource, compositions: readonly NamedComposition[]): string {
  switch (source.type) {
    case 'activeComp':
      return 'Active Composition';
    case 'program':
      return 'Program (Main Mix)';
    case 'composition':
      return compositions.find((comp) => comp.id === source.compositionId)?.name ?? 'Unknown Composition';
    case 'slot':
      return `Slot ${source.slotIndex + 1}`;
    case 'layer':
      return `Layer (${source.layerIds.length})`;
    default:
      return 'Unknown';
  }
}

/**
 * Active composition, every user-visible composition, then every slot of the slot grid (with the
 * composition it holds). `allCompositions` resolves slot contents, `visibleCompositions` are offered.
 */
export function listOutputSourceOptions(
  visibleCompositions: readonly NamedComposition[],
  allCompositions: readonly NamedComposition[],
  activeLayerSlots: Record<string | number, string | null | undefined> | null | undefined,
): OutputSourceOption[] {
  const options: OutputSourceOption[] = [
    { key: 'active', label: 'Active Composition', source: { type: 'activeComp' }, group: 'active' },
  ];
  for (const comp of visibleCompositions) {
    options.push({ key: `comp:${comp.id}`, label: comp.name, source: { type: 'composition', compositionId: comp.id }, group: 'composition' });
  }
  const slots = Object.entries(activeLayerSlots ?? {})
    .map(([key, compId]) => ({ index: Number(key), compId }))
    .filter((slot) => Number.isFinite(slot.index))
    .toSorted((a, b) => a.index - b.index);
  for (const slot of slots) {
    const compName = slot.compId ? allCompositions.find((comp) => comp.id === slot.compId)?.name ?? null : null;
    options.push({
      key: `slot:${slot.index}`,
      label: `Slot ${slot.index + 1}${compName ? ` (${compName})` : ' (Empty)'}`,
      source: { type: 'slot', slotIndex: slot.index },
      group: 'slot',
    });
  }
  return options;
}
