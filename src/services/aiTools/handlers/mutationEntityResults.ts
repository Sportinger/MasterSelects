import { getTimelineRevision } from '../../../stores/timeline/revisionMiddleware';

export type MutationEntityKind =
  | 'clip'
  | 'composition'
  | 'effect'
  | 'folder'
  | 'keyframe'
  | 'marker'
  | 'mask'
  | 'mediaItem'
  | 'track'
  | 'transform'
  | 'transition';

interface IdentifiedEntity {
  id: string;
}

export interface MutationEntitySnapshot<T extends IdentifiedEntity> {
  kind: MutationEntityKind;
  entitiesById: Map<string, T>;
  stateRevisionBefore: number;
}

export interface DescribeMutationEntitiesOptions {
  updatedEntityIds?: Iterable<string>;
  excludedDeletedEntityIds?: Iterable<string>;
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
  options: DescribeMutationEntitiesOptions = {},
) {
  const entitiesAfterById = new Map(entitiesAfter.map((entity) => [entity.id, entity]));
  const entityRef = (id: string) => ({ kind: snapshot.kind, id });
  const updatedEntityIds = options.updatedEntityIds
    ? new Set(options.updatedEntityIds)
    : null;
  const excludedDeletedEntityIds = options.excludedDeletedEntityIds
    ? new Set(options.excludedDeletedEntityIds)
    : null;

  return {
    stateRevisionBefore: snapshot.stateRevisionBefore,
    stateRevisionAfter: getTimelineRevision(),
    entities: {
      created: [...entitiesAfterById.keys()]
        .filter((id) => !snapshot.entitiesById.has(id))
        .map(entityRef),
      updated: [...entitiesAfterById]
        .filter(([id, entity]) => (
          (updatedEntityIds === null || updatedEntityIds.has(id))
          && snapshot.entitiesById.has(id)
          && snapshot.entitiesById.get(id) !== entity
        ))
        .map(([id]) => entityRef(id)),
      deleted: [...snapshot.entitiesById.keys()]
        .filter((id) => (
          (excludedDeletedEntityIds === null || !excludedDeletedEntityIds.has(id))
          && !entitiesAfterById.has(id)
        ))
        .map(entityRef),
    },
  };
}
