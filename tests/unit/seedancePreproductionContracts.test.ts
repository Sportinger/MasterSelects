import { describe, expect, it } from 'vitest';

import {
  parseSeedanceKernelResult,
  parseSeedancePreproductionProjectState,
} from '../../src/services/seedancePreproduction/contracts';
import { researchRequirementsFromAssetPlan } from '../../src/services/seedancePreproduction/assetPlan';

function idea(index: number) {
  return {
    id: `idea-${index}`,
    title: `Idea ${index}`,
    summary: `Direction ${index}`,
    tone: 'cinematic',
    targetDurationSeconds: 30,
  };
}

describe('Seedance preproduction public boundary', () => {
  it('accepts exactly five fully shaped story ideas', () => {
    const result = parseSeedanceKernelResult({
      schemaVersion: 1,
      kind: 'ideas',
      ideas: [1, 2, 3, 4, 5].map(idea),
    });

    expect(result.kind).toBe('ideas');
    if (result.kind === 'ideas') expect(result.ideas).toHaveLength(5);
  });

  it('rejects incomplete story ideas even when the count is correct', () => {
    expect(() => parseSeedanceKernelResult({
      schemaVersion: 1,
      kind: 'ideas',
      ideas: [idea(1), idea(2), idea(3), idea(4), { id: 'idea-5' }],
    })).toThrow();
  });

  it('rejects Seedance packages longer than thirty seconds', () => {
    expect(() => parseSeedanceKernelResult({
      schemaVersion: 1,
      kind: 'keyframes',
      imageProviderId: 'nano-banana-2',
      keyframes: [{
        id: 'frame-1',
        sceneId: 'scene-1',
        title: 'Opening',
        prompt: 'A precise opening frame',
        negativePrompt: '',
        referenceAssetIds: [],
        previousKeyframeIds: [],
      }],
      segments: [{
        id: 'segment-1',
        title: 'Too long',
        durationSeconds: 31,
        prompt: 'Camera moves forward',
        negativePrompt: '',
        keyframeIds: ['frame-1'],
        shotTimings: [{ keyframeId: 'frame-1', startSeconds: 0, endSeconds: 30 }],
      }],
    })).toThrow();
  });

  it('accepts the bounded source-bundle reference returned by the kernel', () => {
    const fingerprint = 'a'.repeat(64);
    expect(parseSeedanceKernelResult({
      schemaVersion: 1,
      kind: 'source-bundle',
      id: `source-bundle-${fingerprint}`,
      fingerprint,
      createdAt: 42,
      entryCount: 3,
    })).toMatchObject({ kind: 'source-bundle', entryCount: 3 });
  });

  it('projects Commons discovery queries independently from the final source route', () => {
    const result = parseSeedanceKernelResult({
      schemaVersion: 1,
      kind: 'asset-plan',
      assetNeeds: [{
        id: 'need-receipt',
        sceneId: 'scene-1',
        description: 'A contemporary VAT receipt.',
        cameraDirection: 'Macro push toward the VAT line.',
        sourceKind: 'commons',
        priority: 'required',
        commonsQueries: ['VAT receipt 2020', 'Kassenzettel Mehrwertsteuer 2020'],
      }, {
        id: 'need-chart',
        sceneId: 'scene-1',
        description: 'An animated tax-rate chart.',
        cameraDirection: 'Bars grow from left to right.',
        sourceKind: 'motion-graphic',
        priority: 'supporting',
        commonsQueries: ['animated tax chart reference'],
      }],
    });

    expect(result.kind).toBe('asset-plan');
    if (result.kind !== 'asset-plan') return;
    const requirements = researchRequirementsFromAssetPlan(result);
    expect(requirements).toHaveLength(2);
    expect(requirements[0]).toMatchObject({
      assetNeedId: 'need-receipt',
      query: 'VAT receipt 2020',
      alternativeQueries: ['Kassenzettel Mehrwertsteuer 2020'],
    });
    expect(requirements[1]).toMatchObject({
      assetNeedId: 'need-chart',
      query: 'animated tax chart reference',
    });
  });

  it('still rejects a Commons final route without a search query', () => {
    expect(() => parseSeedanceKernelResult({
      schemaVersion: 1,
      kind: 'asset-plan',
      assetNeeds: [{
        id: 'need-chart',
        sceneId: 'scene-1',
        description: 'An animated tax-rate chart.',
        cameraDirection: '',
        sourceKind: 'commons',
        priority: 'required',
        commonsQueries: [],
      }],
    })).toThrow(/inconsistent Commons asset routing/i);
  });

  it('migrates pre-round saved projects without losing the run', () => {
    const state = parseSeedancePreproductionProjectState({
      schemaVersion: 1,
      activeRunId: 'run-1',
      runs: {
        'run-1': {
          schemaVersion: 1,
          id: 'run-1',
          createdAt: 1,
          updatedAt: 1,
          prompt: 'History of a city',
          phase: 'choosing-idea',
          ideas: [],
          storyExpanded: false,
          sourceAssets: [],
          masterLooks: [],
          keyframeBriefs: [],
          keyframeVersions: [],
          acceptedVersionByBriefId: {},
          selectedKeyframeIds: [],
          segments: [],
        },
      },
    });

    expect(state.runs['run-1']?.masterGenerationRound).toBe(0);
    expect(state.runs['run-1']?.researchDiagnostics).toEqual([]);
    expect(state.runs['run-1']?.planningSources).toBeUndefined();
    expect(state.documents).toEqual([]);
  });

  it('restores a valid persisted source-bundle reference', () => {
    const fingerprint = 'b'.repeat(64);
    const state = parseSeedancePreproductionProjectState({
      schemaVersion: 1,
      activeRunId: null,
      documents: [],
      runs: {},
      sourceBundle: {
        schemaVersion: 1,
        id: `source-bundle-${fingerprint}`,
        fingerprint,
        createdAt: 123,
        entryCount: 4,
      },
    });
    expect(state.sourceBundle).toMatchObject({ fingerprint, entryCount: 4 });
  });

  it('drops malformed persisted planning documents at the project boundary', () => {
    const state = parseSeedancePreproductionProjectState({
      schemaVersion: 1,
      activeRunId: null,
      runs: {},
      documents: [{ id: 'unsafe', format: 'pdf', text: 42 }],
    });

    expect(state.documents).toEqual([]);
  });
});
