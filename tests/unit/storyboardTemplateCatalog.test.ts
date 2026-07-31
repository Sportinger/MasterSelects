import { describe, expect, it } from 'vitest';

import {
  createCustomStoryboardTemplate,
  createStoryboardTemplateCatalog,
  decodeStoryboardTemplateRecord,
  encodeStoryboardTemplateRecord,
  expandStoryboardTemplateDurationShares,
  getBuiltInStoryboardTemplates,
  migrateStoryboardTemplateVersion,
  upsertCustomStoryboardTemplate,
} from '../../src/services/storyboard/templates';
import {
  assertStoryboardTemplate,
  type StoryboardGenerationBrief,
  type StoryboardProjectState,
  type StoryboardScene,
  type StoryboardTemplate,
} from '../../src/services/storyboard/contracts';
import { createEmptyStoryboardStoreProjectState } from '../../src/stores/storyboardStore';

function scene(
  id: string,
  title: string,
  duration: number,
  beatId?: string,
): StoryboardScene {
  return {
    schemaVersion: 1,
    id,
    planId: 'plan-custom',
    title,
    description: `${title} description`,
    intent: `${title} purpose`,
    ...(beatId ? { beatId } : {}),
    sceneKind: 'chapter',
    targetDurationSeconds: duration,
    status: 'ready',
    filledClipIds: [],
    evidenceRefIds: [],
    variantSetIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function customTemplate(version = 1): StoryboardTemplate {
  return {
    schemaVersion: 1,
    id: 'custom-essay',
    name: 'My essay',
    version,
    description: 'A custom essay format.',
    targetDurationSeconds: 100,
    aspectRatio: '16:9',
    beats: [{
      id: 'intro',
      title: 'Intro',
      purpose: 'Introduce the idea.',
      targetShare: 1,
      evidenceExpectations: [],
    }],
  };
}

describe('storyboard built-in template catalog', () => {
  it('publishes the six required provider-neutral built-ins with valid duration shares', () => {
    const templates = getBuiltInStoryboardTemplates();
    expect(templates.map(template => template.id)).toEqual([
      'builtin-youtube-essay',
      'builtin-talking-head-broll',
      'builtin-trailer-teaser',
      'builtin-short-vertical-social',
      'builtin-product-demo',
      'builtin-interview-portrait',
    ]);
    for (const template of templates) {
      expect(() => assertStoryboardTemplate(template)).not.toThrow();
      const expanded = expandStoryboardTemplateDurationShares(template);
      expect(expanded.reduce((total, beat) => total + beat.targetDurationSeconds, 0))
        .toBe(template.targetDurationSeconds);
      expect(JSON.stringify(template)).not.toMatch(/providerId|modelId/);
    }
  });

  it('combines immutable built-ins with sorted custom entries and rejects id collisions', () => {
    const catalog = createStoryboardTemplateCatalog({
      [customTemplate().id]: customTemplate(),
    });
    expect(catalog.filter(entry => entry.origin === 'built-in')).toHaveLength(6);
    expect(catalog.at(-1)).toMatchObject({
      origin: 'custom',
      template: { id: 'custom-essay' },
    });
    expect(() => createStoryboardTemplateCatalog({
      'builtin-youtube-essay': {
        ...customTemplate(),
        id: 'builtin-youtube-essay',
      },
    })).toThrow('collides');
  });
});

describe('storyboard custom template and persistence codec', () => {
  it('saves a current storyboard as a custom template with normalized shares and generation defaults', () => {
    const intro = scene('scene-intro', 'Intro', 20, 'opening');
    const body = scene('scene-body', 'Body', 30);
    const brief: StoryboardGenerationBrief = {
      schemaVersion: 1,
      id: 'brief-intro',
      sceneId: intro.id,
      revision: 2,
      prompt: 'A clean opening image for the custom format.',
      durationSeconds: 20,
      aspectRatio: '16:9',
      referenceMediaFileIds: [],
      capabilityPolicy: { mediaType: 'video' },
      createdAt: 2,
    };
    const state: StoryboardProjectState = {
      ...createEmptyStoryboardStoreProjectState(),
      plans: {
        'plan-custom': {
          schemaVersion: 1,
          id: 'plan-custom',
          title: 'Current plan',
          sceneIds: [intro.id, body.id],
          targetDurationSeconds: 100,
          aspectRatio: '16:9',
          createdAt: 1,
          updatedAt: 1,
        },
      },
      scenes: { [intro.id]: intro, [body.id]: body },
      generationBriefs: { [brief.id]: brief },
      evidenceRefs: {
        'evidence-intro': {
          schemaVersion: 1,
          id: 'evidence-intro',
          sceneId: intro.id,
          kind: 'source-range',
          mediaFileId: 'media-1',
          start: 0,
          end: 2,
          createdAt: 1,
        },
      },
    };

    const template = createCustomStoryboardTemplate({
      state,
      planId: 'plan-custom',
      id: 'custom-current',
      name: 'Current structure',
      description: 'Saved from the current storyboard.',
    });
    expect(template.targetDurationSeconds).toBe(100);
    expect(template.beats.map(beat => beat.targetShare)).toEqual([0.4, 0.6]);
    expect(template.beats[0].evidenceExpectations).toEqual(['Source range']);
    expect(template.beats[0].generationDefaults?.prompt).toBe(brief.prompt);
    expect(template.beats[0].generationDefaults).not.toHaveProperty('id');
    expect(template.beats[0].generationDefaults).not.toHaveProperty('durationSeconds');
    expect(template.beats[0].generationDefaults).not.toHaveProperty('aspectRatio');
    expect(template.beats[0].generationDefaults?.referenceMediaFileIds).toEqual([]);

    const withTemplate = upsertCustomStoryboardTemplate(state, template);
    const encoded = encodeStoryboardTemplateRecord(withTemplate.templates);
    const decoded = decodeStoryboardTemplateRecord(encoded);
    expect(decoded.templates[template.id]).toEqual(template);
    expect(state.templates).toEqual({});
  });

  it('migrates template content versions stepwise and fails closed when a step is missing', () => {
    const original = customTemplate(1);
    const migrations = [{
      templateId: original.id,
      fromVersion: 1,
      toVersion: 2,
      migrate: (template: StoryboardTemplate): StoryboardTemplate => ({
        ...template,
        version: 2,
        beats: template.beats.map(beat => ({
          ...beat,
          evidenceExpectations: ['Current source evidence'],
        })),
      }),
    }];
    const migrated = migrateStoryboardTemplateVersion(original, 2, migrations);
    expect(migrated.version).toBe(2);
    expect(migrated.beats[0].evidenceExpectations).toEqual(['Current source evidence']);
    expect(original.version).toBe(1);

    const decoded = decodeStoryboardTemplateRecord(
      { [original.id]: original },
      {
        targetVersions: { [original.id]: 2 },
        migrations,
      },
    );
    expect(decoded.migratedTemplateIds).toEqual([original.id]);
    expect(decoded.templates[original.id].version).toBe(2);
    expect(() => migrateStoryboardTemplateVersion(original, 3, migrations))
      .toThrow('exactly one migration');
  });
});
