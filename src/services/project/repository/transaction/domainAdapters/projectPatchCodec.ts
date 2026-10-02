import type { EntityDTO } from '../../contracts';
import type { ProjectFile } from '../../../types/project.types';
import { encodeProjectDomains } from '../../domains/projectDomains';
import type { DomainMutationPlan } from '../domainMutationAdapter';
import { existingAggregate, object } from './aggregatePlan';

/** Empty skeleton is used only for encoding touched DTOs. It is never published. */
export function projectSkeleton(fields: Partial<ProjectFile> = {}): ProjectFile {
  return { version: 1, name: '', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000 },
    media: [], compositions: [], folders: [], activeCompositionId: null, openCompositionIds: [], expandedFolderIds: [], ...fields };
}
export function encodedPatch(plan: DomainMutationPlan, entities: ReadonlyMap<string, EntityDTO>, fields: Partial<ProjectFile>,
  keys: readonly string[]): void {
  const encoded = encodeProjectDomains(projectSkeleton(fields));
  for (const key of keys) plan.aggregates.push({ key, before: existingAggregate(entities, key), after: existingAggregate(encoded.entities, key) });
  const workspace = object(encoded.workspace);
  // Local patches preserve durable/resolver/cache distinctions established by the codecs.
  for (const category of ['fields', 'resolvers', 'nested']) {
    for (const [key, value] of Object.entries(object(workspace[category]))) {
      if (keys.some(owned => key === owned || key.startsWith(`${owned}/`))) plan.views.push({ key: `codec/${category}/${key}`, value: value as import('../../contracts').JsonValue });
    }
  }
  plan.journals.push(...encoded.journals.map(({ id, value }) => ({ id, value })));
}
