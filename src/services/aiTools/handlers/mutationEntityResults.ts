import { getTimelineRevision } from '../../../stores/timeline/revisionMiddleware';

export type MutationEntityKind = 'clip' | 'marker' | 'track' | 'transition';

interface IdentifiedEntity {
  id: string;
}

export interface MutationEntitySnapshot<T extends IdentifiedEntity> {
  kind: MutationEntityKind;
  entitiesById: Map<string, T>;
  stateRevisionBefore: number;
}

export function captureMutationEntitySnapshot<T extends IdentifiedEntity>(
  kind: MutationEntityKind,
  entities: readonly T[],
): MutationEntitySnapshot<T> {
  return {
    kind,
    entitiesById: new Map(entities.map((entity) => [entity.id, entity])),
    stateRevisionBefore: getTimelineRevision(),
  };
}

export function describeMutationEntities<T extends IdentifiedEntity>(
  snapshot: MutationEntitySnapshot<T>,
  entitiesAfter: readonly T[],
) {
  const entitiesAfterById = new Map(entitiesAfter.map((entity) => [entity.id, entity]));
  const entityRef = (id: string) => ({ kind: snapshot.kind, id });

  return {
    stateRevisionBefore: snapshot.stateRevisionBefore,
    stateRevisionAfter: getTimelineRevision(),
    entities: {
      created: [...entitiesAfterById.keys()]
        .filter((id) => !snapshot.entitiesById.has(id))
        .map(entityRef),
      updated: [...entitiesAfterById]
        .filter(([id, entity]) => snapshot.entitiesById.has(id) && snapshot.entitiesById.get(id) !== entity)
        .map(([id]) => entityRef(id)),
      deleted: [...snapshot.entitiesById.keys()]
        .filter((id) => !entitiesAfterById.has(id))
        .map(entityRef),
    },
  };
}
