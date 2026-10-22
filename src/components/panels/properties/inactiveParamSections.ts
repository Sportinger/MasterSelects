import type { EffectParameterGroup } from '../../../effects/parameterGroups';
import type { EffectParam } from '../../../effects/types';

type Value = number | boolean | string;

/** The note of a parameter that acts only in another parameter's mode and is inactive now (activeWhen). */
export function inactiveParamNote(definition: EffectParam, params: Record<string, Value>): string | undefined {
  const when = definition.activeWhen, controller = when ? params[when.param] : undefined;
  return when && controller !== undefined && !when.values.includes(controller) ? when.note : undefined;
}

export interface InactiveParamSection { key: string; title: string; note: string; params: EffectParameterGroup['params'] }

/**
 * Card sections whose every row is inactive for the same reason (Weave's Qualle rows while Form is
 * Woven Cloth) fold into one closed section after the active ones, titled by the mode they need
 * ("Qualle controls"), with the note shown once. They stay in the card, so presets and tools still
 * reach them; a section with any active row stays as it is.
 */
export function foldInactiveParamSections(groups: EffectParameterGroup[], definitions: Record<string, EffectParam>,
  params: Record<string, Value>): { active: EffectParameterGroup[]; folded: InactiveParamSection[] } {
  const active: EffectParameterGroup[] = [], folded = new Map<string, InactiveParamSection>();
  for (const group of groups) {
    const notes = new Set(group.params.map(([, definition]) => inactiveParamNote(definition, params)));
    const [note] = notes, when = group.params[0]?.[1].activeWhen;
    if (notes.size !== 1 || !note || !when) { active.push(group); continue; }
    const options = definitions[when.param]?.options ?? [];
    const names = when.values.map(value => options.find(option => option.value === value)?.label ?? String(value));
    const section = folded.get(note) ?? { key: `inactive:${note}`, title: `${names.join(' / ')} controls`, note, params: [] };
    section.params.push(...group.params);
    folded.set(note, section);
  }
  return { active, folded: [...folded.values()] };
}
