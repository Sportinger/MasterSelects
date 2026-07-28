import type {
  FaceIdentityAnnotationLayer,
  FaceIdentityManualAnnotation,
  FaceIdentityOrphanedAnnotation,
  FaceTrackRemap,
  ProjectPersonLink,
  ShardFaceTrackRef,
} from '../../../types/agentTimeline/faceIdentity';
import type { SourceIdentity } from '../../../types/agentTimeline/sourceIdentity';
import { faceTrackKey, sourceIdentitiesMatch } from './identityKeys';

export interface AppliedFaceIdentityAnnotations {
  remaps: FaceTrackRemap[];
  projectLinks: ProjectPersonLink[];
  appliedAnnotationIds: string[];
  orphanedAnnotations: FaceIdentityOrphanedAnnotation[];
}

function compareAnnotations(left: FaceIdentityManualAnnotation, right: FaceIdentityManualAnnotation): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function manualRemap(track: ShardFaceTrackRef, sourcePersonId: string): FaceTrackRemap {
  return {
    track: { ...track },
    sourcePersonId,
    status: 'manual',
    confidence: 1,
    reason: 'manual',
  };
}

export function applyFaceIdentityAnnotations(
  sourceIdentity: SourceIdentity,
  analyzerRemaps: FaceTrackRemap[],
  layers: FaceIdentityAnnotationLayer[],
  allowProjectPersonLinks: boolean,
): AppliedFaceIdentityAnnotations {
  const remaps = new Map(analyzerRemaps.map((entry) => [faceTrackKey(entry.track), { ...entry, track: { ...entry.track } }]));
  const projectLinks = new Map<string, ProjectPersonLink>();
  const appliedAnnotationIds: string[] = [];
  const orphanedAnnotations: FaceIdentityOrphanedAnnotation[] = [];

  const compatibleAnnotations = layers.flatMap((layer) => {
    if (sourceIdentitiesMatch(sourceIdentity, layer.sourceIdentity)) return layer.annotations;
    orphanedAnnotations.push(...layer.annotations.map((annotation) => ({ annotation, reason: 'source-identity-mismatch' as const })));
    return [];
  }).toSorted(compareAnnotations);

  for (const annotation of compatibleAnnotations) {
    const operation = annotation.operation;
    if (operation.type === 'assign-track') {
      remaps.set(faceTrackKey(operation.track), manualRemap(operation.track, operation.targetSourcePersonId));
    } else if (operation.type === 'merge-source-identities') {
      const sources = new Set(operation.sourcePersonIds);
      for (const [key, remap] of remaps) {
        if (remap.sourcePersonId && sources.has(remap.sourcePersonId)) {
          remaps.set(key, manualRemap(remap.track, operation.targetSourcePersonId));
        }
      }
      for (const sourcePersonId of operation.sourcePersonIds) projectLinks.delete(sourcePersonId);
    } else if (operation.type === 'split-tracks') {
      for (const track of operation.tracks) {
        remaps.set(faceTrackKey(track), manualRemap(track, operation.targetSourcePersonId));
      }
    } else if (operation.type === 'link-project-person' && allowProjectPersonLinks) {
      projectLinks.set(operation.sourcePersonId, {
        sourcePersonId: operation.sourcePersonId,
        projectPersonId: operation.projectPersonId,
        annotationId: annotation.id,
      });
    } else if (operation.type === 'unlink-project-person') {
      projectLinks.delete(operation.sourcePersonId);
    }
    appliedAnnotationIds.push(annotation.id);
  }

  return {
    remaps: [...remaps.values()].toSorted((left, right) => faceTrackKey(left.track).localeCompare(faceTrackKey(right.track))),
    projectLinks: [...projectLinks.values()].toSorted((left, right) => left.sourcePersonId.localeCompare(right.sourcePersonId)),
    appliedAnnotationIds,
    orphanedAnnotations,
  };
}
