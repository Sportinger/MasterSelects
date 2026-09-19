import { describe, expect, it } from 'vitest';

import {
  parseSeedanceOrchestrationEvent,
  parseSeedanceOrchestrationRun,
  reduceSeedanceOrchestrationEvent,
} from '../../src/services/seedancePreproduction/orchestrationContracts';

const runValue = {
  schemaVersion: 1,
  kind: 'seedance-orchestration-run',
  runId: 'seedance-preproduction-public-test-0001',
  prompt: 'Build a coherent visual story.',
  sourceBundleId: `source-bundle-${'a'.repeat(64)}`,
  snapshotFingerprint: 'b'.repeat(64),
  phase: 'ideating',
  createdAt: 1,
  updatedAt: 1,
  nextSequence: 2,
  drafts: [],
  reviews: [],
  finalConcepts: [],
  scenePlanCount: 0,
  agents: [],
};

const concept = {
  schemaVersion: 1,
  id: 'concept-1',
  title: 'One recurring line',
  deliverableFormat: 'One long-form historical explainer.',
  visualSummary: ['The line starts on paper.', 'It crosses changing worlds.', 'It resolves as one open frame.'],
  visualDramaturgy: Array.from({ length: 10 }, (_, index) => `Visual dramaturgy sentence ${index + 1}.`),
  premise: 'A line moves through changing factual worlds.',
  summary: 'The line begins as a mark, becomes a route and finally resolves as a shared frame.',
  visualCohesion: 'The same direction, weight and teal accent recur.',
  productionApproach: 'Project sources lead; designed bridges cover abstract claims.',
  strongestOpportunity: 'Clear continuity across changing settings.',
  largestRisk: 'The motif could become too literal.',
  targetDurationSeconds: 120,
};

describe('Seedance orchestration public contracts', () => {
  it('parses a bounded run and reduces replayed artifact events idempotently', () => {
    const run = parseSeedanceOrchestrationRun(runValue);
    const event = parseSeedanceOrchestrationEvent({
      schemaVersion: 1,
      eventId: `${run.runId}:2`,
      runId: run.runId,
      sequence: 2,
      createdAt: 2,
      kind: 'concept.draft',
      conceptId: concept.id,
      payload: concept,
    });

    const once = reduceSeedanceOrchestrationEvent(run, event);
    const twice = reduceSeedanceOrchestrationEvent(once, event);

    expect(once.drafts).toEqual([concept]);
    expect(once.drafts[0]?.visualSummary).toHaveLength(3);
    expect(once.drafts[0]?.visualDramaturgy).toHaveLength(10);
    expect(twice.drafts).toEqual([concept]);
    expect(twice.nextSequence).toBe(3);
  });

  it('rejects unsupported event payloads before they reach the UI reducer', () => {
    expect(() => parseSeedanceOrchestrationEvent({
      schemaVersion: 1,
      eventId: 'run:1',
      runId: 'run',
      sequence: 1,
      createdAt: 1,
      kind: 'scene.plan',
      sceneId: 'scene-1',
      payload: { schemaVersion: 1, sceneId: 'scene-1', sourceRoute: 'arbitrary-provider' },
    })).toThrow(/source route/i);
  });

  it('treats empty optional scene-plan text as absent', () => {
    const event = parseSeedanceOrchestrationEvent({
      schemaVersion: 1,
      eventId: 'run:1',
      runId: 'run',
      sequence: 1,
      createdAt: 1,
      kind: 'scene.plan',
      sceneId: 'scene-1',
      payload: {
        schemaVersion: 1,
        sceneId: 'scene-1',
        revision: 1,
        dramaturgicalFunction: 'Open on the real salon mark.',
        visualProposal: 'Use the existing source frame.',
        continuityIn: 'Begin on the held mark.',
        continuityOut: 'Move into the speaker shot.',
        visualWorldId: 'world-1',
        visualWorldChangeRequest: '',
        sourceRoute: 'project-source',
        sourcePlan: 'Use the bound project source.',
        commonsQueries: [],
        cameraDirection: 'Hold, then push in.',
        promptDraft: '',
        risks: [],
        status: 'accepted',
      },
    });

    expect(event.kind).toBe('scene.plan');
    if (event.kind !== 'scene.plan') throw new Error('Expected a scene plan event.');
    expect(event.payload.visualWorldChangeRequest).toBeUndefined();
    expect(event.payload.promptDraft).toBeUndefined();
  });

  it('keeps an unspecified concept duration absent and accepts the source-review decision', () => {
    const { targetDurationSeconds: _duration, ...undatedConcept } = concept;
    const draft = parseSeedanceOrchestrationEvent({
      schemaVersion: 1,
      eventId: 'run:1',
      runId: 'run',
      sequence: 1,
      createdAt: 1,
      kind: 'concept.draft',
      conceptId: concept.id,
      payload: undatedConcept,
    });
    expect(draft.kind).toBe('concept.draft');
    if (draft.kind !== 'concept.draft') throw new Error('Expected a concept draft event.');
    expect(draft.payload.targetDurationSeconds).toBeUndefined();

    const treatment = parseSeedanceOrchestrationEvent({
      schemaVersion: 1,
      eventId: 'run:2',
      runId: 'run',
      sequence: 2,
      createdAt: 2,
      kind: 'treatment.completed',
      payload: {
        schemaVersion: 1,
        kind: 'visual-treatment',
        conceptId: concept.id,
        visualThesis: 'Use the supplied footage as the complete visual basis.',
        recurringThroughline: 'A repeated movement connects the scenes.',
        sourceStrategy: 'Use only verified project media.',
        graphicsPolicy: 'Use restrained titles.',
        generationPolicy: 'No generated references are needed.',
        sourceReview: { required: false, reason: 'Project media covers every planned scene.' },
        visualWorlds: [{
          schemaVersion: 1,
          id: 'world-1',
          title: 'Project world',
          narrativePurpose: 'Carries the complete story.',
          visualRules: ['Use the supplied footage.', 'Keep natural light consistent.'],
          paletteAndLight: 'Natural.',
          recurringElements: ['The speaker.'],
          continuityRules: ['Preserve screen direction.'],
          referenceStrategy: 'Reuse verified project frames.',
          requiresNewReferences: false,
          plannedReferenceCount: 0,
        }],
        sceneBindings: [{
          schemaVersion: 1,
          sceneId: 'scene-1',
          visualWorldId: 'world-1',
          visualState: 'Opening.',
          transitionIn: 'Cut in.',
          transitionOut: 'Cut out.',
        }],
      },
    });
    expect(treatment.kind).toBe('treatment.completed');
    if (treatment.kind !== 'treatment.completed') throw new Error('Expected a treatment event.');
    expect(treatment.payload.sourceReview?.required).toBe(false);
  });
});
