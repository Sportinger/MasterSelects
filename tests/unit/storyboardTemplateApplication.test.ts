import { describe, expect, it } from 'vitest';

import {
  applyStoryboardTemplatePreview,
  confirmStoryboardTemplatePreview,
  expandStoryboardTemplateDurationShares,
  mapStoryboardScenesToTemplate,
  previewStoryboardTemplateApplication,
} from '../../src/services/storyboard/templates';
import type {
  StoryboardProjectState,
  StoryboardScene,
  StoryboardTemplate,
} from '../../src/services/storyboard/contracts';
import { cloneStoryboardProjectState } from '../../src/services/storyboard/contracts';
import { createEmptyStoryboardStoreProjectState } from '../../src/stores/storyboardStore';

const template: StoryboardTemplate = {
  schemaVersion: 1,
  id: 'custom-three-beat',
  name: 'Three beat',
  version: 1,
  description: 'A deterministic three-beat template.',
  targetDurationSeconds: 100,
  aspectRatio: '16:9',
  beats: [
    {
      id: 'intro',
      title: 'Intro',
      purpose: 'Open the story.',
      targetShare: 0.25,
      defaultSceneKind: 'opening',
      evidenceExpectations: ['Opening evidence'],
      generationDefaults: {
        prompt: 'A clear cinematic opening for the story.',
        referenceMediaFileIds: [],
        capabilityPolicy: { mediaType: 'video' },
      },
    },
    {
      id: 'body',
      title: 'Body',
      purpose: 'Develop the story.',
      defaultSceneKind: 'chapter',
      evidenceExpectations: [],
    },
    {
      id: 'close',
      title: 'Close',
      purpose: 'Resolve the story.',
      defaultSceneKind: 'closing',
      evidenceExpectations: [],
    },
  ],
};

function existingScene(
  id: string,
  title: string,
  duration = 20,
): StoryboardScene {
  return {
    schemaVersion: 1,
    id,
    planId: 'plan-existing',
    title,
    description: `${title} authored description`,
    intent: `${title} authored intent`,
    targetDurationSeconds: duration,
    status: 'ready',
    filledClipIds: [],
    evidenceRefIds: [],
    variantSetIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function stateWithScenes(scenes: StoryboardScene[]): StoryboardProjectState {
  return {
    ...createEmptyStoryboardStoreProjectState(),
    plans: {
      'plan-existing': {
        schemaVersion: 1,
        id: 'plan-existing',
        title: 'Existing plan',
        sceneIds: scenes.map(scene => scene.id),
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: Object.fromEntries(scenes.map(scene => [scene.id, scene])),
  };
}

describe('storyboard template duration and mapping', () => {
  it('expands unspecified shares deterministically and assigns rounding residual once', () => {
    const expanded = expandStoryboardTemplateDurationShares(template, 101);
    expect(expanded.map(beat => beat.targetShare)).toEqual([0.25, 0.375, 0.375]);
    expect(expanded.map(beat => beat.targetDurationSeconds)).toEqual([
      25.25,
      37.875,
      37.875,
    ]);
    expect(expanded.reduce((total, beat) => total + beat.targetDurationSeconds, 0)).toBe(101);
  });

  it('maps exact beat ids and titles before deterministic positional fallback', () => {
    const titleMatch = existingScene('scene-title', 'Body');
    const beatMatch = { ...existingScene('scene-beat', 'Authored close'), beatId: 'close' };
    const fallback = existingScene('scene-fallback', 'Something else');
    const result = mapStoryboardScenesToTemplate({
      scenes: [titleMatch, beatMatch, fallback],
      template,
    });
    expect(result.mappings).toEqual([
      expect.objectContaining({ sceneId: titleMatch.id, beatId: 'body', confidence: 'title' }),
      expect.objectContaining({ sceneId: beatMatch.id, beatId: 'close', confidence: 'beat-id' }),
      expect.objectContaining({ sceneId: fallback.id, beatId: 'intro', confidence: 'position' }),
    ]);
    expect(result.unmappedBeatIds).toEqual([]);
  });
});

describe('storyboard template application previews', () => {
  it('instantiates into an empty plan with expanded scenes and provider-neutral generation defaults', async () => {
    const state = createEmptyStoryboardStoreProjectState();
    const preview = await previewStoryboardTemplateApplication({
      state,
      template,
      mode: 'instantiate',
      planId: 'plan-new',
      now: 10,
      createSceneId: beat => `scene-${beat.id}`,
      createGenerationBriefId: beat => `brief-${beat.id}`,
    });
    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.differences.some(change => change.operation === 'add')).toBe(true);

    const applied = await applyStoryboardTemplatePreview(state, preview);
    expect(applied.plans['plan-new']).toMatchObject({
      templateId: template.id,
      targetDurationSeconds: 100,
      aspectRatio: '16:9',
      sceneIds: ['scene-intro', 'scene-body', 'scene-close'],
    });
    expect(applied.scenes['scene-intro'].targetDurationSeconds).toBe(25);
    expect(applied.scenes['scene-body'].targetDurationSeconds).toBe(37.5);
    expect(applied.scenes['scene-close'].targetDurationSeconds).toBe(37.5);
    expect(applied.generationBriefs['brief-intro']).toMatchObject({
      sceneId: 'scene-intro',
      prompt: 'A clear cinematic opening for the story.',
      durationSeconds: 25,
      aspectRatio: '16:9',
    });
    expect(JSON.stringify(applied.generationBriefs['brief-intro']))
      .not.toMatch(/providerId|modelId/);
    expect(state.plans).toEqual({});
  });

  it('merges missing beats without overwriting authored content or requiring destructive confirmation', async () => {
    const intro = existingScene('scene-intro-existing', 'Intro', 42);
    const state = stateWithScenes([intro]);
    const preview = await previewStoryboardTemplateApplication({
      state,
      template,
      mode: 'merge',
      planId: 'plan-existing',
      now: 20,
      createSceneId: beat => `scene-added-${beat.id}`,
    });
    expect(preview.requiresConfirmation).toBe(false);
    const concurrentState = cloneStoryboardProjectState(state);
    concurrentState.plans['plan-unrelated'] = {
      schemaVersion: 1,
      id: 'plan-unrelated',
      title: 'Parallel plan',
      sceneIds: [],
      createdAt: 21,
      updatedAt: 21,
    };
    const applied = await applyStoryboardTemplatePreview(concurrentState, preview);
    expect(applied.plans['plan-existing'].sceneIds).toEqual([
      intro.id,
      'scene-added-body',
      'scene-added-close',
    ]);
    expect(applied.scenes[intro.id]).toMatchObject({
      title: 'Intro',
      description: 'Intro authored description',
      targetDurationSeconds: 42,
      beatId: 'intro',
    });
    expect(applied.plans['plan-unrelated']?.title).toBe('Parallel plan');
  });

  it('maps existing scenes without adding, deleting, or reordering them', async () => {
    const first = existingScene('scene-first', 'Body', 33);
    const second = existingScene('scene-second', 'Unmatched authored ending', 67);
    const state = stateWithScenes([first, second]);
    const preview = await previewStoryboardTemplateApplication({
      state,
      template,
      mode: 'map',
      planId: 'plan-existing',
      explicitMappings: { [second.id]: 'close' },
      now: 25,
    });
    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ sceneId: first.id, beatId: 'body', confidence: 'title' }),
      expect.objectContaining({ sceneId: second.id, beatId: 'close', confidence: 'manual' }),
    ]));
    const applied = await applyStoryboardTemplatePreview(state, preview);
    expect(applied.plans['plan-existing'].sceneIds).toEqual([first.id, second.id]);
    expect(Object.keys(applied.scenes)).toEqual([first.id, second.id]);
    expect(applied.scenes[first.id]).toMatchObject({
      title: 'Body',
      targetDurationSeconds: 33,
      beatId: 'body',
    });
    expect(applied.scenes[second.id]).toMatchObject({
      title: 'Unmatched authored ending',
      targetDurationSeconds: 67,
      beatId: 'close',
    });
  });

  it('produces an empty no-op diff when an already mapped plan matches the template', async () => {
    const instantiated = await previewStoryboardTemplateApplication({
      state: createEmptyStoryboardStoreProjectState(),
      template,
      mode: 'instantiate',
      planId: 'plan-existing',
      now: 1,
      createSceneId: beat => `mapped-${beat.id}`,
    });
    const state = await applyStoryboardTemplatePreview(
      createEmptyStoryboardStoreProjectState(),
      instantiated,
    );
    const preview = await previewStoryboardTemplateApplication({
      state,
      template,
      mode: 'map',
      planId: 'plan-existing',
      now: 999,
    });
    expect(preview.differences).toEqual([]);
    expect(preview.requiresConfirmation).toBe(false);
  });

  it('requires an exact displayed-diff confirmation before destructive restructure and rejects stale previews', async () => {
    const kept = existingScene('scene-kept', 'Authored opening', 40);
    const removed = existingScene('scene-removed', 'Extra chapter', 60);
    const state = stateWithScenes([kept, removed]);
    state.candidates['candidate-removed'] = {
      schemaVersion: 1,
      id: 'candidate-removed',
      sceneId: removed.id,
      kind: 'source-cut',
      state: 'proposed',
      sourceMomentHandles: [],
      createdAt: 1,
    };
    state.evidenceRefs['evidence-removed'] = {
      schemaVersion: 1,
      id: 'evidence-removed',
      sceneId: removed.id,
      kind: 'reference-image',
      mediaFileId: 'media-reference',
      createdAt: 1,
    };
    const oneBeatTemplate: StoryboardTemplate = {
      ...template,
      id: 'custom-one-beat',
      name: 'One beat',
      beats: [{ ...template.beats[0], targetShare: 1 }],
    };
    const preview = await previewStoryboardTemplateApplication({
      state,
      template: oneBeatTemplate,
      mode: 'restructure',
      planId: 'plan-existing',
      now: 30,
    });
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: 'scene', operation: 'remove', destructive: true }),
      expect.objectContaining({ entity: 'candidate', operation: 'remove', destructive: true }),
      expect.objectContaining({ entity: 'evidence', operation: 'remove', destructive: true }),
    ]));
    await expect(applyStoryboardTemplatePreview(state, preview))
      .rejects.toThrow('requires confirmation');

    const staleState = cloneStoryboardProjectState(state);
    staleState.scenes[kept.id].title = 'Changed after preview';
    await expect(applyStoryboardTemplatePreview(
      staleState,
      confirmStoryboardTemplatePreview(preview),
    )).rejects.toThrow('changed after');

    const applied = await applyStoryboardTemplatePreview(
      state,
      confirmStoryboardTemplatePreview(preview),
    );
    expect(applied.plans['plan-existing'].sceneIds).toEqual([kept.id]);
    expect(applied.scenes[kept.id]).toMatchObject({
      title: 'Intro',
      beatId: 'intro',
      targetDurationSeconds: 100,
    });
    expect(applied.scenes[removed.id]).toBeUndefined();
    expect(applied.candidates['candidate-removed']).toBeUndefined();
    expect(applied.evidenceRefs['evidence-removed']).toBeUndefined();
  });
});
