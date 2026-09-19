import type { EffectParam } from './types';

export interface EffectParameterGroup {
  id: string;
  label: string | null;
  quality: boolean;
  params: Array<[string, EffectParam]>;
}

function capitalizeGroupName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function groupEffectParameters(
  params: Record<string, EffectParam>,
): EffectParameterGroup[] {
  const groups = new Map<string, EffectParameterGroup>();

  for (const entry of Object.entries(params)) {
    const [, definition] = entry;
    if (definition.hidden) continue;
    const groupName = definition.group?.trim() || null;
    const label = definition.quality ? 'Quality' : groupName ? capitalizeGroupName(groupName) : null;
    const id = definition.quality ? '__quality__' : groupName ? `group:${groupName}` : '__ungrouped__';
    let group = groups.get(id);
    if (!group) {
      group = { id, label, quality: definition.quality === true, params: [] };
      groups.set(id, group);
    }
    group.params.push(entry);
  }

  return [...groups.values()];
}
