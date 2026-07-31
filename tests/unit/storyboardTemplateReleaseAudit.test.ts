import { describe, expect, it } from 'vitest';

import {
  applyStoryboardTemplatePreview,
  confirmStoryboardTemplatePreview,
  createCustomStoryboardTemplate,
  previewStoryboardTemplateApplication,
  storyboardTemplatePersistenceAdapter,
  upsertCustomStoryboardTemplate,
  type StoryboardTemplateApplicationPreview,
} from '../../src/services/storyboard/templates';
import {
  cloneStoryboardProjectState,
  type StoryboardProjectState,
  type StoryboardScene,
  type StoryboardTemplate,
} from '../../src/services/storyboard/contracts';
import {
  decodeStoryboardProjectState,
  encodeStoryboardProjectState,
} from '../../src/services/project/storyboard';
import { createEmptyStoryboardStoreProjectState } from '../../src/stores/storyboardStore';

const fingerprint = {
  schemaVersion: 1,
  algorithm: 'sha-256',
  value: 'c'.repeat(64),
} as const;

const twoBeatTemplate: StoryboardTemplate = {
  schemaVersion: 1,
  id: 'custom-release-two-beat',
  name: 'Release audit structure',
  version: 1,
  description: 'A portable two-beat release fixture.',
  targetDurationSeconds: 20,
  aspectRatio: '16:9',
  beats: [
    {
      id: 'open',
      title: 'Open',
      purpose: 'Open the story.',
      targetShare: 0.4,
      evidenceExpectations: ['Opening evidence'],
    },
    {
      id: 'close',
      title: 'Close',
      purpose: 'Close the story.',
      targetShare: 0.6,
      evidenceExpectations: ['Closing evidence'],
    },
  ],
};

function scene(
  id: string,
  planId: string,
  title: string,
  duration: number,
): StoryboardScene {
  return {
    schemaVersion: 1,
    id,
    planId,
    title,
    description: `${title} description`,
    intent: `${title} intent`,
    targetDurationSeconds: duration,
    status: 'ready',
    filledClipIds: [],
    evidenceRefIds: [],
    variantSetIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function planState(planId = 'plan-release'): StoryboardProjectState {
  const first = scene('scene-release-open', planId, 'Open', 8);
  const extra = scene('scene-release-extra', planId, 'Authored extra', 12);
  return {
    ...createEmptyStoryboardStoreProjectState(),
    plans: {
      [planId]: {
        schemaVersion: 1,
        id: planId,
        title: 'Release plan',
        sceneIds: [first.id, extra.id],
        targetDurationSeconds: 20,
        aspectRatio: '16:9',
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      [first.id]: first,
      [extra.id]: extra,
    },
  };
}

async function destructivePreview(
  state: StoryboardProjectState,
): Promise<StoryboardTemplateApplicationPreview> {
  const oneBeatTemplate: StoryboardTemplate = {
    ...twoBeatTemplate,
    id: 'custom-release-one-beat',
    beats: [{
      ...twoBeatTemplate.beats[0],
      targetShare: 1,
    }],
  };
  return previewStoryboardTemplateApplication({
    state,
    template: oneBeatTemplate,
    mode: 'restructure',
    planId: 'plan-release',
    now: 10,
  });
}

describe('WP11 release audit: persistence and reload', () => {
  it('round-trips a custom template through the real project codec and can instantiate it after reload', async () => {
    const authored = planState();
    authored.generationBriefs['brief-release-open'] = {
      schemaVersion: 1,
      id: 'brief-release-open',
      sceneId: 'scene-release-open',
      revision: 1,
      prompt: 'A portable opening prompt for the saved template.',
      durationSeconds: 8,
      aspectRatio: '16:9',
      referenceMediaFileIds: ['project-bound-media'],
      startFrameMediaFileId: 'project-bound-start-frame',
      capabilityPolicy: { mediaType: 'video' },
      createdAt: 2,
    };
    const custom = createCustomStoryboardTemplate({
      state: authored,
      planId: 'plan-release',
      id: 'custom-release-roundtrip',
      name: 'Reloadable format',
      description: 'Saved from a real storyboard.',
    });
    const withTemplate = upsertCustomStoryboardTemplate(authored, custom);
    const encoded = encodeStoryboardProjectState(withTemplate);
    const jsonPayload = JSON.stringify(encoded);
    const reloaded = decodeStoryboardProjectState(JSON.parse(jsonPayload)).state;
    const catalog = storyboardTemplatePersistenceAdapter.decode(reloaded.templates);
    const persistedTemplate = catalog.templates[custom.id];

    expect(persistedTemplate).toEqual(custom);
    expect(JSON.stringify(persistedTemplate)).not.toContain('project-bound-media');
    expect(JSON.stringify(persistedTemplate)).not.toContain('project-bound-start-frame');

    const preview = await previewStoryboardTemplateApplication({
      state: reloaded,
      template: persistedTemplate,
      mode: 'instantiate',
      planId: 'plan-from-reloaded-template',
      now: 20,
      createSceneId: beat => `reloaded-${beat.id}`,
    });
    const applied = await applyStoryboardTemplatePreview(reloaded, preview);
    const savedAgain = decodeStoryboardProjectState(JSON.parse(JSON.stringify(
      encodeStoryboardProjectState(applied),
    ))).state;

    expect(savedAgain.plans['plan-from-reloaded-template']).toMatchObject({
      templateId: custom.id,
      sceneIds: custom.beats.map(beat => `reloaded-${beat.id}`),
      targetDurationSeconds: custom.targetDurationSeconds,
      aspectRatio: custom.aspectRatio,
    });
    expect(savedAgain.templates[custom.id]).toEqual(custom);
  });

  it('does not allow an opaque application preview to be serialized and replayed after reload', async () => {
    const state = planState();
    const preview = await destructivePreview(state);
    expect(preview).not.toHaveProperty('nextState');

    const serializedPreview = JSON.parse(JSON.stringify(
      preview,
    )) as StoryboardTemplateApplicationPreview;
    expect(() => confirmStoryboardTemplatePreview(serializedPreview))
      .toThrow('not an active diff-first');
    await expect(applyStoryboardTemplatePreview(state, serializedPreview))
      .rejects.toThrow('not an active diff-first');

    const freshPreview = await destructivePreview(
      decodeStoryboardProjectState(JSON.parse(JSON.stringify(
        encodeStoryboardProjectState(state),
      ))).state,
    );
    const applied = await applyStoryboardTemplatePreview(
      state,
      confirmStoryboardTemplatePreview(freshPreview),
    );
    expect(applied.plans['plan-release'].sceneIds).toHaveLength(1);
  });

  it('rejects duplicate custom-template beat ids before upsert into project persistence', () => {
    const duplicateBeats: StoryboardTemplate = {
      ...twoBeatTemplate,
      id: 'custom-duplicate-beats',
      beats: [
        twoBeatTemplate.beats[0],
        { ...twoBeatTemplate.beats[1], id: twoBeatTemplate.beats[0].id },
      ],
    };
    expect(() => upsertCustomStoryboardTemplate(
      createEmptyStoryboardStoreProjectState(),
      duplicateBeats,
    )).toThrow('duplicate beat ids');
  });

  it('rejects custom-template duration shares over 100% during persistence decode', () => {
    const excessiveShares: StoryboardTemplate = {
      ...twoBeatTemplate,
      id: 'custom-excessive-shares',
      beats: [
        { ...twoBeatTemplate.beats[0], targetShare: 0.7 },
        { ...twoBeatTemplate.beats[1], targetShare: 0.6 },
      ],
    };
    expect(() => storyboardTemplatePersistenceAdapter.decode({
      [excessiveShares.id]: excessiveShares,
    })).toThrow(/shares|100%/);
  });
});

describe('WP11 release audit: stale and diff-first gates', () => {
  it('rejects cloned or fingerprint-tampered previews even when their visible fields look valid', async () => {
    const state = planState();
    const preview = await destructivePreview(state);
    const cloned = structuredClone(preview);
    expect(() => confirmStoryboardTemplatePreview(cloned))
      .toThrow('not an active diff-first');

    const tampered = await destructivePreview(state);
    (tampered as { diffFingerprint: string }).diffFingerprint = '0'.repeat(64);
    expect(() => confirmStoryboardTemplatePreview(tampered))
      .toThrow('fingerprint changed');
  });

  it('does not trust caller-mutated confirmation flags or a forged confirmation fingerprint', async () => {
    const state = planState();
    const flagBypass = await destructivePreview(state);
    (flagBypass as { requiresConfirmation: boolean }).requiresConfirmation = false;
    await expect(applyStoryboardTemplatePreview(state, flagBypass))
      .rejects.toThrow(/confirmation|fingerprint changed/);

    const fingerprintBypass = await destructivePreview(state);
    (fingerprintBypass as { confirmedDiffFingerprint?: string })
      .confirmedDiffFingerprint = fingerprintBypass.diffFingerprint;
    await expect(applyStoryboardTemplatePreview(state, fingerprintBypass))
      .rejects.toThrow(/confirmation|not an active/);
  });

  it('detects when the displayed difference list is altered before confirmation', async () => {
    const state = planState();
    const preview = await destructivePreview(state);
    (preview.differences as StoryboardTemplateApplicationPreview['differences'] & {
      splice: (start: number, deleteCount: number) => unknown;
    }).splice(0, 1);
    expect(() => confirmStoryboardTemplatePreview(preview))
      .toThrow('fingerprint changed');
  });

  it('does not allow a stale preview to borrow a newer preview base fingerprint', async () => {
    const original = planState();
    const stalePreview = confirmStoryboardTemplatePreview(
      await destructivePreview(original),
    );
    const changed = cloneStoryboardProjectState(original);
    changed.scenes['scene-release-open'].description = 'Changed after the first diff.';
    const freshPreview = await destructivePreview(changed);
    (stalePreview as { baseFingerprint: string }).baseFingerprint =
      freshPreview.baseFingerprint;

    await expect(applyStoryboardTemplatePreview(changed, stalePreview))
      .rejects.toThrow(/fingerprint changed|changed after/);
  });

  it('invalidates a preview when relevant candidates or variant state changes after diff creation', async () => {
    const state = planState();
    const mapPreview = await previewStoryboardTemplateApplication({
      state,
      template: twoBeatTemplate,
      mode: 'map',
      planId: 'plan-release',
      now: 30,
    });
    const candidateChanged = cloneStoryboardProjectState(state);
    candidateChanged.candidates['candidate-late'] = {
      schemaVersion: 1,
      id: 'candidate-late',
      sceneId: 'scene-release-open',
      kind: 'source-cut',
      state: 'proposed',
      sourceMomentHandles: [],
      createdAt: 31,
    };
    await expect(applyStoryboardTemplatePreview(candidateChanged, mapPreview))
      .rejects.toThrow('changed after');

    const variantPreview = await previewStoryboardTemplateApplication({
      state,
      template: twoBeatTemplate,
      mode: 'map',
      planId: 'plan-release',
      now: 32,
    });
    const variantChanged = cloneStoryboardProjectState(state);
    variantChanged.variantSets['variant-late'] = {
      schemaVersion: 1,
      id: 'variant-late',
      title: 'Late variant',
      baseCompositionId: 'composition-release',
      sceneIds: ['scene-release-open'],
      scope: {
        startTime: 0,
        endTime: 8,
        trackIds: ['track-release'],
        includeLinked: false,
      },
      baseFingerprint: fingerprint,
      boundaryFingerprint: fingerprint,
      status: 'review',
      optionIds: [],
      createdAt: 32,
    };
    await expect(applyStoryboardTemplatePreview(variantChanged, variantPreview))
      .rejects.toThrow('changed after');
  });
});

describe('WP11 release audit: parallel-plan isolation', () => {
  it('preserves a concurrently added plan and every one of its scoped records byte-for-byte', async () => {
    const state = planState();
    const preview = await previewStoryboardTemplateApplication({
      state,
      template: twoBeatTemplate,
      mode: 'merge',
      planId: 'plan-release',
      now: 40,
      createSceneId: beat => `merged-${beat.id}`,
    });
    const concurrent = cloneStoryboardProjectState(state);
    const parallelScene = scene('scene-parallel', 'plan-parallel', 'Parallel', 7);
    concurrent.plans['plan-parallel'] = {
      schemaVersion: 1,
      id: 'plan-parallel',
      title: 'Parallel plan added after preview',
      sceneIds: [parallelScene.id],
      targetDurationSeconds: 7,
      createdAt: 41,
      updatedAt: 41,
    };
    concurrent.scenes[parallelScene.id] = parallelScene;
    concurrent.generationBriefs['brief-parallel'] = {
      schemaVersion: 1,
      id: 'brief-parallel',
      sceneId: parallelScene.id,
      revision: 1,
      prompt: 'Parallel prompt remains untouched.',
      durationSeconds: 7,
      aspectRatio: '9:16',
      referenceMediaFileIds: [],
      capabilityPolicy: { mediaType: 'video' },
      createdAt: 41,
    };
    concurrent.candidates['candidate-parallel'] = {
      schemaVersion: 1,
      id: 'candidate-parallel',
      sceneId: parallelScene.id,
      kind: 'generated-video',
      state: 'ready',
      sourceMomentHandles: [],
      mediaFileId: 'media-parallel',
      createdAt: 41,
    };
    concurrent.evidenceRefs['evidence-parallel'] = {
      schemaVersion: 1,
      id: 'evidence-parallel',
      sceneId: parallelScene.id,
      kind: 'source-range',
      mediaFileId: 'source-parallel',
      start: 1,
      end: 4,
      createdAt: 41,
    };
    concurrent.coverageBySceneId[parallelScene.id] = {
      schemaVersion: 1,
      sceneId: parallelScene.id,
      level: 'green',
      sourceScore: 1,
      generationReadinessScore: 0.5,
      reasons: ['Parallel coverage remains untouched.'],
      evaluatedAgainstFingerprint: fingerprint,
      evaluatedAt: 41,
    };
    concurrent.decisions['decision-parallel'] = {
      schemaVersion: 1,
      id: 'decision-parallel',
      kind: 'story',
      question: 'Keep the parallel plan?',
      state: 'pending',
      baseFingerprint: fingerprint,
      options: [{
        id: 'yes',
        title: 'Yes',
        summary: 'Keep it.',
        tradeoffs: [],
      }],
      allowMultiple: false,
      allowFreeform: false,
      selectedOptionIds: [],
      sceneId: parallelScene.id,
      createdAt: 41,
    };
    concurrent.templates['custom-parallel'] = {
      ...twoBeatTemplate,
      id: 'custom-parallel',
      name: 'Parallel template',
    };
    const parallelSnapshot = JSON.stringify({
      plan: concurrent.plans['plan-parallel'],
      scene: concurrent.scenes[parallelScene.id],
      brief: concurrent.generationBriefs['brief-parallel'],
      candidate: concurrent.candidates['candidate-parallel'],
      evidence: concurrent.evidenceRefs['evidence-parallel'],
      coverage: concurrent.coverageBySceneId[parallelScene.id],
      decision: concurrent.decisions['decision-parallel'],
      template: concurrent.templates['custom-parallel'],
    });

    const applied = await applyStoryboardTemplatePreview(concurrent, preview);
    expect(JSON.stringify({
      plan: applied.plans['plan-parallel'],
      scene: applied.scenes[parallelScene.id],
      brief: applied.generationBriefs['brief-parallel'],
      candidate: applied.candidates['candidate-parallel'],
      evidence: applied.evidenceRefs['evidence-parallel'],
      coverage: applied.coverageBySceneId[parallelScene.id],
      decision: applied.decisions['decision-parallel'],
      template: applied.templates['custom-parallel'],
    })).toBe(parallelSnapshot);
  });
});
