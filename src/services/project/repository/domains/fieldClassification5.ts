import type { FieldOwnershipMap } from './fieldOwnership';
import type { SeedanceOrchestrationPublicRun } from '../../../seedancePreproduction/orchestrationContracts';
import type { SeedancePlanningDocument } from '../../../seedancePreproduction/contracts';
import type { SeedancePlanningSource } from '../../../seedancePreproduction/contracts';
import type { SeedancePreproductionProjectState } from '../../../seedancePreproduction/contracts';
import type { SeedancePreproductionRun } from '../../../seedancePreproduction/contracts';
import type { SeedanceResearchAttempt } from '../../../seedancePreproduction/contracts';
import type { SeedanceResearchDiagnostic } from '../../../seedancePreproduction/contracts';
import type { SeedanceResearchRequirement } from '../../../seedancePreproduction/contracts';
import type { SeedanceScenePlan } from '../../../seedancePreproduction/orchestrationContracts';
import type { SeedanceSegmentPackage } from '../../../seedancePreproduction/contracts';
import type { SeedanceShotTiming } from '../../../seedancePreproduction/contracts';
import type { SeedanceSourceBundleReference } from '../../../seedancePreproduction/contracts';
import type { SeedanceStory } from '../../../seedancePreproduction/contracts';
import type { SeedanceStoryIdea } from '../../../seedancePreproduction/contracts';
import type { SeedanceStoryPreferences } from '../../../seedancePreproduction/orchestrationContracts';
import type { SeedanceStoryScene } from '../../../seedancePreproduction/contracts';
import type { SeedanceVisualTreatment } from '../../../seedancePreproduction/orchestrationContracts';
import type { SeedanceVisualWorld } from '../../../seedancePreproduction/orchestrationContracts';
import type { ShapeDefinition } from '../../../../types/motionDesign';
import type { SharedSceneGraph } from '../../../../types/sharedSceneGraph';
import type { SignalArtifact } from '../../../../signals/types';
import type { SignalArtifactProducer } from '../../../../signals/types';
import type { SignalArtifactStorage } from '../../../../signals/types';
import type { SignalAsset } from '../../../../signals/types';
import type { SignalAssetSource } from '../../../../signals/types';
import type { SignalByteRange } from '../../../../signals/types';
import type { SignalGraph } from '../../../../signals/types';
import type { SignalGraphEdge } from '../../../../signals/types';
import type { SignalGraphNode } from '../../../../signals/types';
import type { SignalGraphOwner } from '../../../../signals/types';
import type { SignalOperatorDescriptor } from '../../../../signals/types';
import type { SignalPortDescriptor } from '../../../../signals/types';
import type { SignalRef } from '../../../../signals/types';
import type { SimpleSynthInstrument } from '../../../../types/midiClip';
import type { SourceAnnotation } from '../../../../types/sourceAnnotation';
import type { SpectralImageLayer } from '../../../../types/audio';
import type { SpectralImageLayerKeyframe } from '../../../../types/audio';
import type { StoryboardCandidate } from '../../../storyboard/contracts/models';
import type { StoryboardCapabilityPolicy } from '../../../storyboard/contracts/models';
import type { StoryboardClipProperties } from '../../../storyboard/contracts/models';
import type { StoryboardCoverage } from '../../../storyboard/contracts/models';
import type { StoryboardDecision } from '../../../storyboard/contracts/models';
import type { StoryboardDecisionOption } from '../../../storyboard/contracts/models';
import type { StoryboardFingerprint } from '../../../storyboard/contracts/models';
import type { StoryboardGenerationBrief } from '../../../storyboard/contracts/models';
import type { StoryboardPlan } from '../../../storyboard/contracts/models';
import type { StoryboardProjectState } from '../../../storyboard/contracts/models';

export const SeedanceOrchestrationPublicRunFields = {
  "schemaVersion": { class: 'content', owner: 'seedance' },
  "kind": { class: 'content', owner: 'seedance' },
  "runId": { class: 'content', owner: 'seedance' },
  "prompt": { class: 'content', owner: 'seedance' },
  "sourceBundleId": { class: 'content', owner: 'seedance' },
  "snapshotFingerprint": { class: 'content', owner: 'seedance' },
  "preferences": { class: 'content', owner: 'seedance' },
  "phase": { class: 'content', owner: 'seedance' },
  "createdAt": { class: 'content', owner: 'seedance' },
  "updatedAt": { class: 'content', owner: 'seedance' },
  "nextSequence": { class: 'content', owner: 'seedance' },
  "drafts": { class: 'content', owner: 'seedance' },
  "reviews": { class: 'content', owner: 'seedance' },
  "finalConcepts": { class: 'content', owner: 'seedance' },
  "selectedConceptId": { class: 'content', owner: 'seedance' },
  "story": { class: 'content', owner: 'seedance' },
  "treatment": { class: 'content', owner: 'seedance' },
  "scenePlanCount": { class: 'content', owner: 'seedance' },
  "agents": { class: 'content', owner: 'seedance' },
  "error": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceOrchestrationPublicRun>;

export const SeedancePlanningDocumentFields = {
  "byteLength": { class: 'content', owner: 'documents' },
  "createdAt": { class: 'content', owner: 'documents' },
  "format": { class: 'content', owner: 'documents' },
  "lastModified": { class: 'content', owner: 'documents' },
  "id": { class: 'content', owner: 'documents' },
  "name": { class: 'content', owner: 'documents' },
  "mimeType": { class: 'content', owner: 'documents' },
  "text": { class: 'content', owner: 'documents' },
  "truncated": { class: 'content', owner: 'documents' },
  "pageCount": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<SeedancePlanningDocument>;

export const SeedancePlanningSourceFields = {
  "id": { class: 'content', owner: 'seedance' },
  "name": { class: 'content', owner: 'seedance' },
  "mimeType": { class: 'content', owner: 'seedance' },
  "text": { class: 'content', owner: 'seedance' },
  "truncated": { class: 'content', owner: 'seedance' },
  "pageCount": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedancePlanningSource>;

export const SeedancePreproductionProjectStateFields = {
  "schemaVersion": { class: 'content', owner: 'seedance' },
  "activeRunId": { class: 'workspace', owner: 'seedance' },
  "documents": { class: 'content', owner: 'seedance' },
  "runs": { class: 'content', owner: 'seedance' },
  "sourceBundle": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedancePreproductionProjectState>;

export const SeedancePreproductionRunFields = {
  "schemaVersion": { class: 'content', owner: 'seedance' },
  "id": { class: 'content', owner: 'seedance' },
  "createdAt": { class: 'content', owner: 'seedance' },
  "updatedAt": { class: 'content', owner: 'seedance' },
  "prompt": { class: 'content', owner: 'seedance' },
  "preferences": { class: 'content', owner: 'seedance' },
  "planningSources": { class: 'content', owner: 'seedance' },
  "sourceMediaFileIds": { class: 'content', owner: 'seedance' },
  "sourceBundle": { class: 'content', owner: 'seedance' },
  "phase": { class: 'journal', owner: 'seedance' },
  "error": { class: 'journal', owner: 'seedance' },
  "ideas": { class: 'content', owner: 'seedance' },
  "orchestration": { class: 'journal', owner: 'seedance' },
  "orchestrationCursor": { class: 'journal', owner: 'seedance' },
  "orchestrationEvents": { class: 'journal', owner: 'seedance' },
  "scenePlans": { class: 'content', owner: 'seedance' },
  "selectedIdeaId": { class: 'content', owner: 'seedance' },
  "story": { class: 'content', owner: 'seedance' },
  "assetPlan": { class: 'content', owner: 'seedance' },
  "storyExpanded": { class: 'workspace', owner: 'seedance' },
  "sourceAssets": { class: 'content', owner: 'seedance' },
  "researchDiagnostics": { class: 'journal', owner: 'seedance' },
  "masterGenerationRound": { class: 'content', owner: 'seedance' },
  "masterLooks": { class: 'content', owner: 'seedance' },
  "selectedMasterLookId": { class: 'content', owner: 'seedance' },
  "keyframeBriefs": { class: 'content', owner: 'seedance' },
  "keyframeVersions": { class: 'content', owner: 'seedance' },
  "acceptedVersionByBriefId": { class: 'content', owner: 'seedance' },
  "selectedKeyframeIds": { class: 'content', owner: 'seedance' },
  "segments": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedancePreproductionRun>;

export const SeedanceResearchAttemptFields = {
  "query": { class: 'content', owner: 'seedance' },
  "status": { class: 'content', owner: 'seedance' },
  "resultCount": { class: 'content', owner: 'seedance' },
  "error": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceResearchAttempt>;

export const SeedanceResearchDiagnosticFields = {
  "requirementId": { class: 'content', owner: 'seedance' },
  "sceneId": { class: 'content', owner: 'seedance' },
  "requestedQuery": { class: 'content', owner: 'seedance' },
  "status": { class: 'content', owner: 'seedance' },
  "resultCount": { class: 'content', owner: 'seedance' },
  "attempts": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceResearchDiagnostic>;

export const SeedanceResearchRequirementFields = {
  "id": { class: 'content', owner: 'seedance' },
  "query": { class: 'content', owner: 'seedance' },
  "purpose": { class: 'content', owner: 'seedance' },
  "sceneId": { class: 'content', owner: 'seedance' },
  "assetNeedId": { class: 'content', owner: 'seedance' },
  "alternativeQueries": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceResearchRequirement>;

export const SeedanceScenePlanFields = {
  "schemaVersion": { class: 'content', owner: 'seedance' },
  "sceneId": { class: 'content', owner: 'seedance' },
  "revision": { class: 'content', owner: 'seedance' },
  "dramaturgicalFunction": { class: 'content', owner: 'seedance' },
  "visualProposal": { class: 'content', owner: 'seedance' },
  "continuityIn": { class: 'content', owner: 'seedance' },
  "continuityOut": { class: 'content', owner: 'seedance' },
  "visualWorldId": { class: 'content', owner: 'seedance' },
  "visualWorldChangeRequest": { class: 'content', owner: 'seedance' },
  "sourceRoute": { class: 'content', owner: 'seedance' },
  "sourcePlan": { class: 'content', owner: 'seedance' },
  "commonsQueries": { class: 'content', owner: 'seedance' },
  "cameraDirection": { class: 'content', owner: 'seedance' },
  "promptDraft": { class: 'content', owner: 'seedance' },
  "risks": { class: 'content', owner: 'seedance' },
  "status": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceScenePlan>;

export const SeedanceSegmentPackageFields = {
  "id": { class: 'content', owner: 'seedance' },
  "title": { class: 'content', owner: 'seedance' },
  "durationSeconds": { class: 'content', owner: 'seedance' },
  "prompt": { class: 'content', owner: 'seedance' },
  "negativePrompt": { class: 'content', owner: 'seedance' },
  "keyframeIds": { class: 'content', owner: 'seedance' },
  "shotTimings": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceSegmentPackage>;

export const SeedanceShotTimingFields = {
  "keyframeId": { class: 'content', owner: 'seedance' },
  "startSeconds": { class: 'content', owner: 'seedance' },
  "endSeconds": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceShotTiming>;

export const SeedanceSourceBundleReferenceFields = {
  "schemaVersion": { class: 'content', owner: 'seedance' },
  "id": { class: 'content', owner: 'seedance' },
  "fingerprint": { class: 'content', owner: 'seedance' },
  "createdAt": { class: 'content', owner: 'seedance' },
  "entryCount": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceSourceBundleReference>;

export const SeedanceStoryFields = {
  "schemaVersion": { class: 'content', owner: 'seedance' },
  "kind": { class: 'content', owner: 'seedance' },
  "title": { class: 'content', owner: 'seedance' },
  "logline": { class: 'content', owner: 'seedance' },
  "summary": { class: 'content', owner: 'seedance' },
  "aspectRatio": { class: 'content', owner: 'seedance' },
  "totalDurationSeconds": { class: 'content', owner: 'seedance' },
  "scenes": { class: 'content', owner: 'seedance' },
  "researchRequirements": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceStory>;

export const SeedanceStoryIdeaFields = {
  "id": { class: 'content', owner: 'seedance' },
  "title": { class: 'content', owner: 'seedance' },
  "summary": { class: 'content', owner: 'seedance' },
  "tone": { class: 'content', owner: 'seedance' },
  "targetDurationSeconds": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceStoryIdea>;

export const SeedanceStoryPreferencesFields = {
  "directionCount": { class: 'content', owner: 'seedance' },
  "aiGeneration": { class: 'content', owner: 'seedance' },
  "commons": { class: 'content', owner: 'seedance' },
  "scenePlanning": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceStoryPreferences>;

export const SeedanceStorySceneFields = {
  "id": { class: 'content', owner: 'seedance' },
  "title": { class: 'content', owner: 'seedance' },
  "summary": { class: 'content', owner: 'seedance' },
  "durationSeconds": { class: 'content', owner: 'seedance' },
  "narration": { class: 'content', owner: 'seedance' },
  "visualIntent": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceStoryScene>;

export const SeedanceVisualTreatmentFields = {
  "schemaVersion": { class: 'content', owner: 'seedance' },
  "kind": { class: 'content', owner: 'seedance' },
  "conceptId": { class: 'content', owner: 'seedance' },
  "visualThesis": { class: 'content', owner: 'seedance' },
  "recurringThroughline": { class: 'content', owner: 'seedance' },
  "sourceStrategy": { class: 'content', owner: 'seedance' },
  "graphicsPolicy": { class: 'content', owner: 'seedance' },
  "generationPolicy": { class: 'content', owner: 'seedance' },
  "sourceReview": { class: 'content', owner: 'seedance' },
  "aiGeneration": { class: 'content', owner: 'seedance' },
  "scenePlanning": { class: 'content', owner: 'seedance' },
  "visualWorlds": { class: 'content', owner: 'seedance' },
  "sceneBindings": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceVisualTreatment>;

export const SeedanceVisualWorldFields = {
  "schemaVersion": { class: 'content', owner: 'seedance' },
  "id": { class: 'content', owner: 'seedance' },
  "title": { class: 'content', owner: 'seedance' },
  "narrativePurpose": { class: 'content', owner: 'seedance' },
  "visualRules": { class: 'content', owner: 'seedance' },
  "paletteAndLight": { class: 'content', owner: 'seedance' },
  "recurringElements": { class: 'content', owner: 'seedance' },
  "continuityRules": { class: 'content', owner: 'seedance' },
  "referenceStrategy": { class: 'content', owner: 'seedance' },
  "requiresNewReferences": { class: 'content', owner: 'seedance' },
  "plannedReferenceCount": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceVisualWorld>;

export const ShapeDefinitionFields = {
  "primitive": { class: 'content', owner: 'timeline' },
  "size": { class: 'content', owner: 'timeline' },
  "cornerRadius": { class: 'content', owner: 'timeline' },
  "polygon": { class: 'content', owner: 'timeline' },
  "star": { class: 'content', owner: 'timeline' },
  "path": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ShapeDefinition>;

export const SharedSceneGraphFields = {
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "effect": { class: 'content', owner: 'timeline' },
  "sourceClipId": { class: 'content', owner: 'timeline' },
  "startTime": { class: 'content', owner: 'timeline' },
  "outputs": { class: 'content', owner: 'timeline' },
  "transform": { class: 'content', owner: 'timeline' },
  "keyframes": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SharedSceneGraph>;

export const SignalArtifactFields = {
  "schemaVersion": { class: 'content', owner: 'signals' },
  "artifactId": { class: 'content', owner: 'signals' },
  "hash": { class: 'content', owner: 'signals' },
  "size": { class: 'content', owner: 'signals' },
  "mimeType": { class: 'content', owner: 'signals' },
  "encoding": { class: 'content', owner: 'signals' },
  "storage": { class: 'content', owner: 'signals' },
  "producer": { class: 'content', owner: 'signals' },
  "sourceRefs": { class: 'content', owner: 'signals' },
  "createdAt": { class: 'content', owner: 'signals' },
  "byteRange": { class: 'content', owner: 'signals' },
  "metadata": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalArtifact>;

export const SignalArtifactProducerFields = {
  "providerId": { class: 'content', owner: 'signals' },
  "providerVersion": { class: 'content', owner: 'signals' },
  "jobId": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalArtifactProducer>;

export const SignalArtifactStorageFields = {
  "kind": { class: 'content', owner: 'signals' },
  "projectRelativePath": { class: 'resolver', owner: 'signals' },
  "uri": { class: 'resolver', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalArtifactStorage>;

export const SignalAssetFields = {
  "schemaVersion": { class: 'content', owner: 'signals' },
  "id": { class: 'content', owner: 'signals' },
  "name": { class: 'content', owner: 'signals' },
  "source": { class: 'content', owner: 'signals' },
  "refs": { class: 'content', owner: 'signals' },
  "artifacts": { class: 'content', owner: 'signals' },
  "createdAt": { class: 'content', owner: 'signals' },
  "updatedAt": { class: 'content', owner: 'signals' },
  "metadata": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalAsset>;

export const SignalAssetSourceFields = {
  "kind": { class: 'content', owner: 'signals' },
  "fileName": { class: 'content', owner: 'signals' },
  "extension": { class: 'content', owner: 'signals' },
  "mimeType": { class: 'content', owner: 'signals' },
  "size": { class: 'content', owner: 'signals' },
  "hash": { class: 'content', owner: 'signals' },
  "projectPath": { class: 'resolver', owner: 'signals' },
  "absolutePath": { class: 'resolver', owner: 'signals' },
  "providerId": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalAssetSource>;

export const SignalByteRangeFields = {
  "offset": { class: 'content', owner: 'signals' },
  "length": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalByteRange>;

export const SignalGraphFields = {
  "schemaVersion": { class: 'content', owner: 'signals' },
  "id": { class: 'content', owner: 'signals' },
  "owner": { class: 'content', owner: 'signals' },
  "nodes": { class: 'content', owner: 'signals' },
  "edges": { class: 'content', owner: 'signals' },
  "outputs": { class: 'content', owner: 'signals' },
  "createdAt": { class: 'content', owner: 'signals' },
  "updatedAt": { class: 'content', owner: 'signals' },
  "metadata": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalGraph>;

export const SignalGraphEdgeFields = {
  "id": { class: 'content', owner: 'signals' },
  "fromNodeId": { class: 'content', owner: 'signals' },
  "fromPortId": { class: 'content', owner: 'signals' },
  "toNodeId": { class: 'content', owner: 'signals' },
  "toPortId": { class: 'content', owner: 'signals' },
  "kind": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalGraphEdge>;

export const SignalGraphNodeFields = {
  "id": { class: 'content', owner: 'signals' },
  "operatorId": { class: 'content', owner: 'signals' },
  "label": { class: 'content', owner: 'signals' },
  "params": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalGraphNode>;

export const SignalGraphOwnerFields = {
  "kind": { class: 'content', owner: 'signals' },
  "id": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalGraphOwner>;

export const SignalOperatorDescriptorFields = {
  "schemaVersion": { class: 'content', owner: 'signals' },
  "id": { class: 'content', owner: 'signals' },
  "version": { class: 'content', owner: 'signals' },
  "label": { class: 'content', owner: 'signals' },
  "role": { class: 'content', owner: 'signals' },
  "runtime": { class: 'content', owner: 'signals' },
  "inputs": { class: 'content', owner: 'signals' },
  "outputs": { class: 'content', owner: 'signals' },
  "deterministic": { class: 'content', owner: 'signals' },
  "stateful": { class: 'content', owner: 'signals' },
  "metadata": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalOperatorDescriptor>;

export const SignalPortDescriptorFields = {
  "id": { class: 'content', owner: 'signals' },
  "label": { class: 'content', owner: 'signals' },
  "kind": { class: 'content', owner: 'signals' },
  "required": { class: 'content', owner: 'signals' },
  "repeated": { class: 'content', owner: 'signals' },
  "metadata": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalPortDescriptor>;

export const SignalRefFields = {
  "schemaVersion": { class: 'content', owner: 'signals' },
  "id": { class: 'content', owner: 'signals' },
  "kind": { class: 'content', owner: 'signals' },
  "label": { class: 'content', owner: 'signals' },
  "assetId": { class: 'content', owner: 'signals' },
  "artifactId": { class: 'content', owner: 'signals' },
  "portId": { class: 'content', owner: 'signals' },
  "mimeType": { class: 'content', owner: 'signals' },
  "createdAt": { class: 'content', owner: 'signals' },
  "metadata": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<SignalRef>;

export const SimpleSynthInstrumentFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "waveform": { class: 'cache', owner: 'timeline' },
  "adsr": { class: 'content', owner: 'timeline' },
  "gain": { class: 'content', owner: 'timeline' },
  "filter": { class: 'content', owner: 'timeline' },
  "filterEnv": { class: 'content', owner: 'timeline' },
  "pitchBendRange": { class: 'content', owner: 'timeline' },
  "lfos": { class: 'content', owner: 'timeline' },
  "modMatrix": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SimpleSynthInstrument>;

export const SourceAnnotationFields = {
  "id": { class: 'content', owner: 'timeline' },
  "text": { class: 'content', owner: 'timeline' },
  "startTime": { class: 'content', owner: 'timeline' },
  "endTime": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "scope": { class: 'content', owner: 'timeline' },
  "clipId": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SourceAnnotation>;

export const SpectralImageLayerFields = {
  "id": { class: 'content', owner: 'audio' },
  "imageMediaFileId": { class: 'content', owner: 'audio' },
  "timeStart": { class: 'content', owner: 'audio' },
  "duration": { class: 'content', owner: 'audio' },
  "frequencyMin": { class: 'content', owner: 'audio' },
  "frequencyMax": { class: 'content', owner: 'audio' },
  "opacity": { class: 'content', owner: 'audio' },
  "enabled": { class: 'content', owner: 'audio' },
  "blendMode": { class: 'content', owner: 'audio' },
  "gainDb": { class: 'content', owner: 'audio' },
  "featherTime": { class: 'content', owner: 'audio' },
  "featherFrequency": { class: 'content', owner: 'audio' },
  "keyframes": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<SpectralImageLayer>;

export const SpectralImageLayerKeyframeFields = {
  "id": { class: 'content', owner: 'audio' },
  "time": { class: 'content', owner: 'audio' },
  "opacity": { class: 'content', owner: 'audio' },
  "gainDb": { class: 'content', owner: 'audio' },
  "frequencyMin": { class: 'content', owner: 'audio' },
  "frequencyMax": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<SpectralImageLayerKeyframe>;

export const StoryboardCandidateFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "id": { class: 'content', owner: 'storyboard' },
  "sceneId": { class: 'content', owner: 'storyboard' },
  "kind": { class: 'content', owner: 'storyboard' },
  "state": { class: 'content', owner: 'storyboard' },
  "generationBriefRevision": { class: 'content', owner: 'storyboard' },
  "generationRequestKey": { class: 'content', owner: 'storyboard' },
  "generationRecordId": { class: 'content', owner: 'storyboard' },
  "outputId": { class: 'content', owner: 'storyboard' },
  "mediaFileId": { class: 'content', owner: 'storyboard' },
  "sourceMomentHandles": { class: 'content', owner: 'storyboard' },
  "variantSetId": { class: 'content', owner: 'storyboard' },
  "variantOptionId": { class: 'content', owner: 'storyboard' },
  "durationSeconds": { class: 'content', owner: 'storyboard' },
  "estimatedCredits": { class: 'content', owner: 'storyboard' },
  "actualCredits": { class: 'content', owner: 'storyboard' },
  "rationale": { class: 'content', owner: 'storyboard' },
  "createdAt": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardCandidate>;

export const StoryboardCapabilityPolicyFields = {
  "mediaType": { class: 'content', owner: 'storyboard' },
  "needsImageToVideo": { class: 'content', owner: 'storyboard' },
  "needsStartEndFrames": { class: 'content', owner: 'storyboard' },
  "needsNativeAudio": { class: 'content', owner: 'storyboard' },
  "preferredQuality": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardCapabilityPolicy>;

export const StoryboardClipPropertiesFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "planId": { class: 'content', owner: 'storyboard' },
  "sceneId": { class: 'content', owner: 'storyboard' },
  "title": { class: 'content', owner: 'storyboard' },
  "description": { class: 'content', owner: 'storyboard' },
  "intent": { class: 'content', owner: 'storyboard' },
  "visualDirection": { class: 'content', owner: 'storyboard' },
  "audioDirection": { class: 'content', owner: 'storyboard' },
  "transitionIntent": { class: 'content', owner: 'storyboard' },
  "sceneKind": { class: 'content', owner: 'storyboard' },
  "beatId": { class: 'content', owner: 'storyboard' },
  "color": { class: 'content', owner: 'storyboard' },
  "targetDurationSeconds": { class: 'content', owner: 'storyboard' },
  "status": { class: 'content', owner: 'storyboard' },
  "generationBriefId": { class: 'content', owner: 'storyboard' },
  "selectedCandidateId": { class: 'content', owner: 'storyboard' },
  "filledClipIds": { class: 'content', owner: 'storyboard' },
  "evidenceRefIds": { class: 'content', owner: 'storyboard' },
  "variantSetIds": { class: 'content', owner: 'storyboard' },
  "notes": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardClipProperties>;

export const StoryboardCoverageFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "sceneId": { class: 'content', owner: 'storyboard' },
  "level": { class: 'content', owner: 'storyboard' },
  "sourceScore": { class: 'content', owner: 'storyboard' },
  "generationReadinessScore": { class: 'content', owner: 'storyboard' },
  "reasons": { class: 'content', owner: 'storyboard' },
  "evaluatedAgainstFingerprint": { class: 'content', owner: 'storyboard' },
  "evaluatedAt": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardCoverage>;

export const StoryboardDecisionFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "id": { class: 'content', owner: 'storyboard' },
  "kind": { class: 'content', owner: 'storyboard' },
  "question": { class: 'content', owner: 'storyboard' },
  "explanation": { class: 'content', owner: 'storyboard' },
  "state": { class: 'content', owner: 'storyboard' },
  "baseFingerprint": { class: 'content', owner: 'storyboard' },
  "options": { class: 'content', owner: 'storyboard' },
  "allowMultiple": { class: 'content', owner: 'storyboard' },
  "allowFreeform": { class: 'content', owner: 'storyboard' },
  "selectedOptionIds": { class: 'content', owner: 'storyboard' },
  "freeform": { class: 'content', owner: 'storyboard' },
  "sceneId": { class: 'content', owner: 'storyboard' },
  "variantSetId": { class: 'content', owner: 'storyboard' },
  "parentDecisionId": { class: 'content', owner: 'storyboard' },
  "createdAt": { class: 'content', owner: 'storyboard' },
  "resolvedAt": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardDecision>;

export const StoryboardDecisionOptionFields = {
  "id": { class: 'content', owner: 'storyboard' },
  "title": { class: 'content', owner: 'storyboard' },
  "summary": { class: 'content', owner: 'storyboard' },
  "rationale": { class: 'content', owner: 'storyboard' },
  "tradeoffs": { class: 'content', owner: 'storyboard' },
  "estimatedCredits": { class: 'content', owner: 'storyboard' },
  "preview": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardDecisionOption>;

export const StoryboardFingerprintFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "algorithm": { class: 'content', owner: 'storyboard' },
  "value": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardFingerprint>;

export const StoryboardGenerationBriefFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "id": { class: 'content', owner: 'storyboard' },
  "sceneId": { class: 'content', owner: 'storyboard' },
  "revision": { class: 'content', owner: 'storyboard' },
  "prompt": { class: 'content', owner: 'storyboard' },
  "negativePrompt": { class: 'content', owner: 'storyboard' },
  "visualContinuity": { class: 'content', owner: 'storyboard' },
  "camera": { class: 'content', owner: 'storyboard' },
  "motion": { class: 'content', owner: 'storyboard' },
  "lighting": { class: 'content', owner: 'storyboard' },
  "audioIntent": { class: 'content', owner: 'storyboard' },
  "durationSeconds": { class: 'content', owner: 'storyboard' },
  "aspectRatio": { class: 'content', owner: 'storyboard' },
  "referenceMediaFileIds": { class: 'content', owner: 'storyboard' },
  "startFrameMediaFileId": { class: 'content', owner: 'storyboard' },
  "endFrameMediaFileId": { class: 'content', owner: 'storyboard' },
  "capabilityPolicy": { class: 'content', owner: 'storyboard' },
  "createdAt": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardGenerationBrief>;

export const StoryboardPlanFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "id": { class: 'content', owner: 'storyboard' },
  "title": { class: 'content', owner: 'storyboard' },
  "description": { class: 'content', owner: 'storyboard' },
  "sceneIds": { class: 'content', owner: 'storyboard' },
  "templateId": { class: 'content', owner: 'storyboard' },
  "targetDurationSeconds": { class: 'content', owner: 'storyboard' },
  "aspectRatio": { class: 'content', owner: 'storyboard' },
  "createdAt": { class: 'content', owner: 'storyboard' },
  "updatedAt": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardPlan>;

export const StoryboardProjectStateFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "plans": { class: 'content', owner: 'storyboard' },
  "scenes": { class: 'content', owner: 'storyboard' },
  "generationBriefs": { class: 'content', owner: 'storyboard' },
  "candidates": { class: 'content', owner: 'storyboard' },
  "evidenceRefs": { class: 'content', owner: 'storyboard' },
  "coverageBySceneId": { class: 'content', owner: 'storyboard' },
  "variantSets": { class: 'content', owner: 'storyboard' },
  "variantOptions": { class: 'content', owner: 'storyboard' },
  "decisions": { class: 'content', owner: 'storyboard' },
  "templates": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardProjectState>;
