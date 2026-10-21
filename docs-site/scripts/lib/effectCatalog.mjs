// The effect catalog behind the Effects sidebar subgroups and the docs-gallery cards.
//
// Group labels and order are the app's picker groups (EFFECT_GROUPS in
// src/effects/effectCatalogGroups.ts). docs/Features/effects/catalog.json, written by
// scripts/effect-docs.mjs, adds per-effect data. Either source alone is enough:
//   catalog.json: { "groups"?: [{ id, label, effects?: [id] }],
//                   "effects": [{ id, name?, group?, description?, thumb?, anchor?, hidden? }] }
//   (or a plain array of effect entries). `thumb` is a path relative to docs/Features,
//   `anchor` the old heading slug a gallery card keeps as its id.

/** EFFECT_GROUPS and EFFECTS_HIDDEN_FROM_CATALOG read from the TypeScript source, or undefined. */
export function parseEffectGroups(source) {
  const block = source.match(/export const EFFECT_GROUPS\s*=\s*\[([\s\S]*?)\]\s*as const/u)?.[1];
  if (!block) return undefined;
  const quoted = (list) => [...list.matchAll(/(['"])(.*?)\1/gu)].map((match) => match[2]);
  const groups = [...block.matchAll(/\{\s*id:\s*(['"])(.+?)\1,\s*label:\s*(['"])(.+?)\3,\s*effects:\s*\[([^\]]*)\]/gu)]
    .map(([, , id, , label, list]) => ({ id, label, effects: quoted(list) }));
  if (!groups.length) return undefined;
  const hiddenList = source.match(/EFFECTS_HIDDEN_FROM_CATALOG[^=]*=\s*new Set(?:<[^>]*>)?\(\[([^\]]*)\]\)/u)?.[1];
  return { groups, hidden: new Set(hiddenList ? quoted(hiddenList) : []) };
}

/**
 * Merge catalog.json (optional) and the picker groups (optional) into
 * { groups: [{ id, label, effects }], effects: Map<id, entry>, source, notes }.
 * Hidden effects are left out of the groups.
 */
export function loadEffectCatalog({ catalog, groupsSource } = {}) {
  const notes = [];
  const picker = groupsSource ? parseEffectGroups(groupsSource) : undefined;
  if (groupsSource && !picker) notes.push({ level: 'warn', text: 'Effects: EFFECT_GROUPS could not be read from src/effects/effectCatalogGroups.ts; effect subgroups follow catalog.json only.' });
  const entries = Array.isArray(catalog) ? catalog : Array.isArray(catalog?.effects) ? catalog.effects : [];
  if (catalog && !entries.length) notes.push({ level: 'warn', text: 'Effects: docs/Features/effects/catalog.json lists no effects.' });
  const effects = new Map();
  for (const entry of entries) {
    if (entry && typeof entry.id === 'string') effects.set(entry.id, entry);
    else notes.push({ level: 'warn', text: `Effects: catalog.json entry without an id skipped (${JSON.stringify(entry)?.slice(0, 60)}).` });
  }
  const hidden = new Set(picker?.hidden ?? []);
  for (const entry of effects.values()) if (entry.hidden) hidden.add(entry.id);

  let groups = Array.isArray(catalog?.groups) ? catalog.groups : picker?.groups;
  if (!groups) {
    // Neither source names the groups: keep the catalog order.
    const byId = new Map();
    for (const entry of effects.values()) {
      if (!entry.group) continue;
      if (!byId.has(entry.group)) byId.set(entry.group, { id: entry.group, label: entry.group, effects: [] });
      byId.get(entry.group).effects.push(entry.id);
    }
    groups = [...byId.values()];
  }
  groups = groups.map((group) => {
    const members = group.effects
      ?? [...effects.values()].filter((entry) => entry.group === group.id).map((entry) => entry.id);
    return { id: group.id, label: group.label ?? group.id, effects: members.filter((id) => !hidden.has(id)) };
  });
  const source = catalog ? 'catalog.json' : picker ? 'effectCatalogGroups.ts' : 'none';
  return { groups, effects, hidden, source, notes };
}

/** Display name of an effect: catalog name, else the given page title, else undefined. */
export function effectName(catalog, id, pageTitle) {
  return catalog.effects.get(id)?.name ?? pageTitle;
}
