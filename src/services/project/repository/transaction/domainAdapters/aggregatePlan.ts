import type { EntityDTO, JsonValue } from '../../contracts';
import { encodeAggregate, entityKey } from '../../domains/jsonBoundary';
import { PROJECT_ENTITY_KEY } from '../../domains/projectDomains';
import type { DomainMutationPlan } from '../domainMutationAdapter';

export const reference = (key: string): JsonValue => ({ $repositoryEntity: key });
export function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function emptyPlan(): DomainMutationPlan { return { aggregates: [], views: [], journals: [] }; }
/** Take only the owned aggregate and its structural blocks, never referenced siblings. */
export function existingAggregate(entities: ReadonlyMap<string, EntityDTO>, key: string): Map<string, EntityDTO> {
  const result = new Map<string, EntityDTO>();
  if (entities.has(key)) result.set(key, entities.get(key)!);
  for (const [id, entity] of entities) if (id.startsWith(`${key}/block/`)) result.set(id, entity);
  return result;
}
export function replaceAggregate(plan: DomainMutationPlan, entities: ReadonlyMap<string, EntityDTO>, key: string,
  type: string, value: unknown | undefined): void {
  plan.aggregates.push({ key, before: existingAggregate(entities, key),
    after: value === undefined ? new Map() : encodeAggregate(key, type, value) });
}
export function ensureRootField(plan: DomainMutationPlan, entities: ReadonlyMap<string, EntityDTO>, name: string, value: JsonValue): void {
  const prior = plan.aggregates.find(entry => entry.key === PROJECT_ENTITY_KEY);
  const source = prior ? new Map([...entities, ...prior.after]) : entities;
  const root = object(decodeOwnedAggregate(PROJECT_ENTITY_KEY, source));
  if (JSON.stringify(root[name]) === JSON.stringify(value)) return;
  const next = encodeAggregate(PROJECT_ENTITY_KEY, 'project-metadata', { ...root, [name]: value });
  if (prior) prior.after = next;
  else plan.aggregates.push({ key: PROJECT_ENTITY_KEY, before: existingAggregate(entities, PROJECT_ENTITY_KEY), after: next });
}
export function membership(plan: DomainMutationPlan, entities: ReadonlyMap<string, EntityDTO>, domain: string,
  owner: string, ids: readonly string[], itemDomain = domain): void {
  const key = entityKey('membership', owner, domain);
  replaceAggregate(plan, entities, key, 'domain-membership', ids.map(id => reference(entityKey(itemDomain, owner, id))));
}
export function appendPlan(target: DomainMutationPlan, source: DomainMutationPlan): void {
  target.aggregates.push(...source.aggregates); target.views.push(...source.views); target.journals.push(...source.journals);
}

/** Resolve physical blocks only. Semantic entity references remain editable membership pointers. */
export function decodeOwnedAggregate(key: string, entities: ReadonlyMap<string, EntityDTO>): JsonValue {
  const active = new Set<string>();
  const read = (id: string): JsonValue => {
    if (active.has(id)) throw new TypeError(`Cyclic structural block: ${id}`);
    const entity = entities.get(id); if (!entity) throw new TypeError(`Missing structural block: ${id}`);
    active.add(id); try { return unpack(entity.value); } finally { active.delete(id); }
  };
  const unpack = (value: JsonValue): JsonValue => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(unpack);
    if (typeof value.$repositoryEntity === 'string') return value.$repositoryEntity.startsWith(`${key}/block/`)
      ? read(value.$repositoryEntity) : { ...value };
    if (value.$repositoryShape === 'array' || value.$repositoryShape === 'string') {
      const blocks = unpack(value.blocks); if (!Array.isArray(blocks)) throw new TypeError('Invalid structural membership');
      if (value.$repositoryShape === 'string') { if (blocks.some(block => typeof block !== 'string')) throw new TypeError('Invalid string block'); return blocks.join(''); }
      if (blocks.some(block => !Array.isArray(block))) throw new TypeError('Invalid array block'); return blocks.flat() as JsonValue[];
    }
    if (value.$repositoryShape === 'object') {
      const entries = unpack(value.entries); if (!Array.isArray(entries)) throw new TypeError('Invalid structural object');
      return Object.fromEntries(entries.map(entry => { if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || entry[0] === '__proto__') throw new TypeError('Invalid structural entry'); return entry; })) as JsonValue;
    }
    return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, unpack(child)]));
  };
  return read(key);
}
