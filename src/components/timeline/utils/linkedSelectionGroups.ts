import { isManualLinkedGroupId } from '../../../stores/timeline/helpers/idGenerator';

interface LinkedSelectionClip {
  id: string;
  linkedClipId?: string;
  linkedGroupId?: string;
}

// Only selected members participate: Alt-selection must remain an individual selection.
export function getLinkedSelectionGroups<T extends LinkedSelectionClip>(
  clips: readonly T[], selectedIds: ReadonlySet<string>,
): T[][] {
  const selected = clips.filter(clip => selectedIds.has(clip.id));
  const parents = new Map(selected.map(clip => [clip.id, clip.id]));
  const root = (id: string): string => {
    let current = id;
    while (parents.get(current) !== current) current = parents.get(current)!;
    return current;
  };
  const join = (a: string, b: string) => {
    if (parents.has(b)) parents.set(root(a), root(b));
  };
  const groupMembers = new Map<string, string>();
  for (const clip of selected) {
    if (clip.linkedClipId) join(clip.id, clip.linkedClipId);
    if (clip.linkedGroupId && isManualLinkedGroupId(clip.linkedGroupId)) {
      const member = groupMembers.get(clip.linkedGroupId);
      if (member) join(clip.id, member);
      else groupMembers.set(clip.linkedGroupId, clip.id);
    }
  }
  const groups = new Map<string, T[]>();
  for (const clip of selected) {
    const key = root(clip.id);
    const members = groups.get(key) ?? [];
    members.push(clip);
    groups.set(key, members);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

export function getIndividualSelectionIds<T extends LinkedSelectionClip>(
  clips: readonly T[], selectedIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const individual = new Set(selectedIds);
  for (const group of getLinkedSelectionGroups(clips, selectedIds)) {
    for (const clip of group) individual.delete(clip.id);
  }
  return individual;
}
