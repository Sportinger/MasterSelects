import type { EntityDTO } from '../../contracts';
import { decodeAggregate, encodeAggregate } from '../../domains/jsonBoundary';
import type { EncodedProjectDomains } from '../../domains/projectDomains';
import type { DomainMutationPlan } from '../domainMutationAdapter';
import { decodeOwnedAggregate, object, reference, replaceAggregate } from './aggregatePlan';

export const STRUCTURED_FIELDS: Record<string, Readonly<Record<string, 'map' | 'array'>>> = {
  'storyboard/project/state': { plans: 'map', scenes: 'map', generationBriefs: 'map', candidates: 'map', evidenceRefs: 'map', coverageBySceneId: 'map', variantSets: 'map', variantOptions: 'map', decisions: 'map', templates: 'map' },
  'signals/project/state': { assets: 'array', artifacts: 'array', graphs: 'array', operators: 'array', assetItems: 'array' },
  'export/project/definitions': { presets: 'array' },
};
const childKey = (owner: string, field: string, id: string) => `${owner}/item/${encodeURIComponent(field)}/${encodeURIComponent(id)}`;
function entries(value: unknown, kind: 'map' | 'array'): [string, unknown][] {
  if (kind === 'map') return Object.entries(object(value));
  return (Array.isArray(value) ? value : []).map((item, index) => [String(object(item).id ?? object(item).artifactId ?? index), item]);
}
/** Import-only normalization makes large map payloads independently versioned from the first edit. */
export function normalizeEditorStructuredDomains(encoded: EncodedProjectDomains): EncodedProjectDomains {
  for (const [owner, fields] of Object.entries(STRUCTURED_FIELDS)) {
    const entity = encoded.entities.get(owner); if (!entity) continue;
    const shell = object(decodeAggregate(owner, encoded.entities));
    for (const [field, kind] of Object.entries(fields)) {
      if (!(field in shell)) continue;
      const members = entries(shell[field], kind).map(([id, item]) => {
        const key = childKey(owner, field, id);
        for (const [child, value] of encodeAggregate(key, `${entity.type}-item`, item)) encoded.entities.set(child, value);
        return [id, reference(key)] as const;
      });
      shell[field] = kind === 'map' ? Object.fromEntries(members) : members.map(([, value]) => value);
    }
    for (const key of [...encoded.entities.keys()]) if (key === owner || key.startsWith(`${owner}/block/`)) encoded.entities.delete(key);
    for (const [key, value] of encodeAggregate(owner, entity.type, shell)) encoded.entities.set(key, value);
  }
  return encoded;
}
/** Only changed item identities are encoded. Parent work consists of small membership references. */
export function granularizeStructuredPlan(plan: DomainMutationPlan, entities: ReadonlyMap<string, EntityDTO>, owner: string,
  before: Record<string, unknown>, after: Record<string, unknown>, encodeItem: (field: string, value: unknown) => unknown): void {
  const fields = STRUCTURED_FIELDS[owner]; if (!fields) return;
  const aggregate = plan.aggregates.find(entry => entry.key === owner); if (!aggregate) return;
  // The caller may already have encoded the touched state shell, but payload encoding below uses only changed entries.
  const shell = object(decodeOwnedAggregate(owner, aggregate.after));
  for (const [field, kind] of Object.entries(fields)) {
    const old = new Map(entries(before[field], kind)), next = entries(after[field], kind);
    const ids = new Set(next.map(([id]) => id));
    for (const [id, item] of next) {
      const key = childKey(owner, field, id);
      if (old.get(id) !== item || !entities.has(key)) replaceAggregate(plan, entities, key, `${entities.get(owner)?.type ?? 'domain'}-item`, encodeItem(field, item));
    }
    for (const id of old.keys()) if (!ids.has(id)) replaceAggregate(plan, entities, childKey(owner, field, id), 'domain-item', undefined);
    shell[field] = kind === 'map' ? Object.fromEntries(next.map(([id]) => [id, reference(childKey(owner, field, id))])) : next.map(([id]) => reference(childKey(owner, field, id)));
  }
  aggregate.after = encodeAggregate(owner, entities.get(owner)?.type ?? 'domain-aggregate', shell);
}
