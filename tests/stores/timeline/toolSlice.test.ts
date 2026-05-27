import { describe, expect, it, beforeEach } from 'vitest';

import { createTestTimelineStore } from '../../helpers/storeFactory';

describe('timeline tool slice compatibility', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    store = createTestTimelineStore();
  });

  it('keeps legacy toolMode in sync with the active timeline tool', () => {
    expect(store.getState().activeTimelineToolId).toBe('select');
    expect(store.getState().toolMode).toBe('select');

    store.getState().setActiveTimelineTool('blade');
    expect(store.getState().activeTimelineToolId).toBe('blade');
    expect(store.getState().toolMode).toBe('cut');

    store.getState().setActiveTimelineTool('select');
    expect(store.getState().activeTimelineToolId).toBe('select');
    expect(store.getState().toolMode).toBe('select');
  });

  it('preserves setToolMode and toggleCutTool as legacy bridges', () => {
    store.getState().setToolMode('cut');
    expect(store.getState().activeTimelineToolId).toBe('blade');
    expect(store.getState().toolMode).toBe('cut');

    store.getState().toggleCutTool();
    expect(store.getState().activeTimelineToolId).toBe('select');
    expect(store.getState().toolMode).toBe('select');
  });

  it('tracks the last selected child per tool group', () => {
    store.getState().setActiveTimelineTool('blade');
    store.getState().setActiveTimelineTool('select');

    expect(store.getState().lastTimelineToolByGroup.cut).toBe('blade');

    store.getState().activateTimelineToolGroup('cut');
    expect(store.getState().activeTimelineToolId).toBe('blade');
  });

  it('cycles enabled selection subtools without entering future tools', () => {
    store.getState().cycleTimelineToolGroup('selection');
    expect(store.getState().activeTimelineToolId).toBe('track-select-forward');

    store.getState().cycleTimelineToolGroup('selection');
    expect(store.getState().activeTimelineToolId).toBe('track-select-backward');

    store.getState().cycleTimelineToolGroup('selection');
    expect(store.getState().activeTimelineToolId).toBe('track-select-forward-all');

    store.getState().cycleTimelineToolGroup('selection');
    expect(store.getState().activeTimelineToolId).toBe('range-select');

    store.getState().cycleTimelineToolGroup('selection');
    expect(store.getState().activeTimelineToolId).toBe('select');
  });

  it('cycles enabled cut mode subtools without entering command tools', () => {
    store.getState().setActiveTimelineTool('blade');

    store.getState().cycleTimelineToolGroup('cut');
    expect(store.getState().activeTimelineToolId).toBe('blade-all-tracks');

    store.getState().cycleTimelineToolGroup('cut');
    expect(store.getState().activeTimelineToolId).toBe('blade');
  });

  it('activates and cycles enabled navigation mode tools', () => {
    store.getState().activateTimelineToolGroup('navigation');
    expect(store.getState().activeTimelineToolId).toBe('hand');

    store.getState().cycleTimelineToolGroup('navigation');
    expect(store.getState().activeTimelineToolId).toBe('zoom');

    store.getState().cycleTimelineToolGroup('navigation');
    expect(store.getState().activeTimelineToolId).toBe('pen-keyframe');

    store.getState().cycleTimelineToolGroup('navigation');
    expect(store.getState().activeTimelineToolId).toBe('hand');
  });
});
