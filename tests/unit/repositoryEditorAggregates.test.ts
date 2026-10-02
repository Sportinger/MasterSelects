import { describe, expect, it } from 'vitest';
import { encodeAggregate, decodeAggregate } from '../../src/services/project/repository/domains/jsonBoundary';
import { PROJECT_ENTITY_KEY } from '../../src/services/project/repository/domains/projectDomains';
import { decodeOwnedAggregate, emptyPlan, ensureRootField, reference } from '../../src/services/project/repository/transaction/domainAdapters/aggregatePlan';

describe('editor owned aggregate rewriting', () => {
  it('adds a root domain without freezing existing clip versions into the project shell', () => {
    const clip = 'clip/comp/existing', composition = 'composition/project/comp';
    const entities = new Map([
      ...encodeAggregate(clip, 'clip', { id: 'existing', startTime: 1 }),
      ...encodeAggregate(composition, 'composition', { id: 'comp', clips: [reference(clip)] }),
      ...encodeAggregate(PROJECT_ENTITY_KEY, 'project-metadata', { compositions: [reference(composition)] }),
    ]);
    const plan = emptyPlan(); ensureRootField(plan, entities, 'trackingAssets', reference('membership/project/tracking'));
    expect(plan.aggregates.map(item => item.key)).toEqual([PROJECT_ENTITY_KEY]);
    for (const [key, entity] of plan.aggregates[0].after) entities.set(key, entity);
    expect(decodeOwnedAggregate(PROJECT_ENTITY_KEY, entities)).toMatchObject({ compositions: [reference(composition)] });
    entities.delete('membership/project/tracking');
    for (const [key, entity] of encodeAggregate('membership/project/tracking', 'membership', [])) entities.set(key, entity);
    for (const [key, entity] of encodeAggregate(clip, 'clip', { id: 'existing', startTime: 9 })) entities.set(key, entity);
    expect(decodeAggregate(PROJECT_ENTITY_KEY, entities)).toMatchObject({ compositions: [{ clips: [{ startTime: 9 }] }] });
  });
  it('resolves large physical blocks while retaining small semantic pointers', () => {
    const data = { label: 'x'.repeat(160000), members: Array.from({ length: 300 }, (_, index) => reference(`clip/c/${index}`)) };
    const entities = encodeAggregate(PROJECT_ENTITY_KEY, 'project-metadata', data);
    expect(entities.size).toBeGreaterThan(1);
    expect(decodeOwnedAggregate(PROJECT_ENTITY_KEY, entities)).toEqual(data);
    const plan = emptyPlan(); ensureRootField(plan, entities, 'documents', reference('documents/project/manifest'));
    expect(decodeOwnedAggregate(PROJECT_ENTITY_KEY, plan.aggregates[0].after)).toEqual({ ...data, documents: reference('documents/project/manifest') });
  });
  it('keeps successive root-field additions in one plan without expanding sibling aggregates', () => {
    const entities = encodeAggregate(PROJECT_ENTITY_KEY, 'project-metadata', { media: reference('membership/project/media') });
    const plan = emptyPlan(); ensureRootField(plan, entities, 'storyboard', reference('storyboard/project/state'));
    ensureRootField(plan, entities, 'documents', reference('documents/project/manifest'));
    expect(plan.aggregates).toHaveLength(1);
    expect(decodeOwnedAggregate(PROJECT_ENTITY_KEY, plan.aggregates[0].after)).toEqual({ media: reference('membership/project/media'),
      storyboard: reference('storyboard/project/state'), documents: reference('documents/project/manifest') });
  });
});
