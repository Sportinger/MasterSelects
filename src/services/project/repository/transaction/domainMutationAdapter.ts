import type { EntityDTO, JsonValue } from '../contracts';
import type { ProjectTransactionCoordinator, TransactionToken } from './ProjectTransactionCoordinator';
import { canonicalJson } from '../segments/canonical';

export interface AggregateMutation {
  retainResultBindings?: boolean;
  key: string;
  before: ReadonlyMap<string, EntityDTO>;
  after: ReadonlyMap<string, EntityDTO>;
}
export interface DomainMutationPlan {
  aggregates: AggregateMutation[];
  views: { key: string; value: JsonValue }[];
  journals: { id: string; value: JsonValue }[];
}
export interface StoreDomainAdapter<T = unknown> {
  readonly domain: string;
  /** Pure, bounded aggregate encoding. The before store still owns its runtime. */
  prepare(before: T, patch: Partial<T>, replacing: boolean): DomainMutationPlan;
  restore(projection: ReadonlyMap<string, EntityDTO>, signal: AbortSignal): Promise<void>;
}
export interface PreparedDomainMutation { token: TransactionToken; keys: Set<string>; plan: DomainMutationPlan; }
export function prepareDomainMutation(coordinator: ProjectTransactionCoordinator, token: TransactionToken,
  plan: DomainMutationPlan): PreparedDomainMutation {
  const keys = new Set<string>();
  for (const aggregate of plan.aggregates) {
    for (const key of new Set([...aggregate.before.keys(), ...aggregate.after.keys()])) {
      const before = aggregate.before.get(key) ?? null;
      const after = aggregate.after.get(key) ?? null;
      if (canonicalJson(before) === canonicalJson(after)) continue;
      coordinator.touch(token, key); keys.add(key);
    }
  }
  return { token, keys, plan };
}
export function finishDomainMutation(coordinator: ProjectTransactionCoordinator, prepared: PreparedDomainMutation): void {
  for (const aggregate of prepared.plan.aggregates) {
    for (const key of new Set([...aggregate.before.keys(), ...aggregate.after.keys()])) {
      if (!prepared.keys.has(key)) continue;
      const after = aggregate.after.get(key), before = aggregate.before.get(key);
      if (after && before && aggregate.retainResultBindings !== false && after.value && typeof after.value === 'object' && !Array.isArray(after.value)
        && before.value && typeof before.value === 'object' && !Array.isArray(before.value)) {
        const preserved = Object.fromEntries(Object.entries(before.value).filter(([name]) => name === '$sourceIdentity' || name === '$resultBindings'));
        const bindings = before.value.$resultBindings;
        const dependencies = bindings && typeof bindings === 'object' && !Array.isArray(bindings) ? Object.values(bindings).flatMap(binding => {
          const key = binding && typeof binding === 'object' && !Array.isArray(binding) ? binding.$repositoryEntity : null;
          const entity = typeof key === 'string' ? coordinator.getEntities().get(key) : null;
          return entity ? [entity] : [];
        }) : [];
        coordinator.write(prepared.token, key, { ...after, value: { ...after.value, ...preserved },
          references: [...after.references, ...dependencies.flatMap(entity => entity.references).filter(ref => !after.references.some(next => next.hash === ref.hash))],
          blobs: [...after.blobs, ...dependencies.flatMap(entity => entity.blobs).filter(ref => !after.blobs.some(next => next.hash === ref.hash))] });
      } else coordinator.write(prepared.token, key, after ?? null);
    }
  }
}

/** Structural identity scans do not clone/hash untouched payloads. */
export function changedItems<T extends { id: string }>(before: readonly T[], after: readonly T[]): { id: string; before: T | null; after: T | null }[] {
  if (before === after) return [];
  const previous = new Map(before.map(item => [item.id, item]));
  const changes: { id: string; before: T | null; after: T | null }[] = [];
  for (const item of after) {
    const prior = previous.get(item.id) ?? null;
    if (prior !== item) changes.push({ id: item.id, before: prior, after: item });
    previous.delete(item.id);
  }
  for (const item of previous.values()) changes.push({ id: item.id, before: item, after: null });
  return changes;
}
