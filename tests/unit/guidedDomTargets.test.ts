import { afterEach, describe, expect, it } from 'vitest';
import {
  GuidedTargetRegistry,
  registerDomGuidedTargetResolvers,
} from '../../src/services/guidedActions';
import type { GuidedRect } from '../../src/services/guidedActions';
import { useTimelineStore } from '../../src/stores/timeline';

describe('guided DOM target resolvers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    useTimelineStore.setState({ zoom: 50, scrollX: 0 });
  });

  it('resolves clip-specific property controls before generic property controls', async () => {
    const registry = new GuidedTargetRegistry();
    registerDomGuidedTargetResolvers(registry);

    addElement({ 'data-guided-property': 'position.x' }, {
      x: 20,
      y: 30,
      width: 100,
      height: 24,
    });
    addElement({
      'data-guided-property': 'position.x',
      'data-guided-clip-id': 'clip-2',
    }, {
      x: 140,
      y: 60,
      width: 120,
      height: 32,
    });

    const resolution = await registry.resolve({
      kind: 'propertyControl',
      property: 'position.x',
      clipId: 'clip-2',
    });

    expect(resolution.status).toBe('resolved');
    expect(resolution.rect).toEqual({
      x: 140,
      y: 60,
      width: 120,
      height: 32,
    });
    expect(resolution.center).toEqual({ x: 200, y: 76 });
  });

  it('reports a focus-panel recovery action for hidden panels', async () => {
    const registry = new GuidedTargetRegistry();
    registerDomGuidedTargetResolvers(registry);

    const resolution = await registry.resolve({
      kind: 'panel',
      panel: 'media',
    });

    expect(resolution).toEqual(expect.objectContaining({
      status: 'missing',
      reason: 'panel-hidden',
      suggestedAction: { type: 'focusPanel', panel: 'media' },
    }));
  });

  it('maps normalized preview points to viewport coordinates', async () => {
    const registry = new GuidedTargetRegistry();
    registerDomGuidedTargetResolvers(registry);

    addElement({ 'data-guided-target': 'preview' }, {
      x: 100,
      y: 50,
      width: 400,
      height: 200,
    });

    const resolution = await registry.resolve({
      kind: 'previewPoint',
      x: 0.25,
      y: 0.75,
    });

    expect(resolution.status).toBe('resolved');
    expect(resolution.point).toEqual({ x: 200, y: 200 });
    expect(resolution.center).toEqual({ x: 200, y: 200 });
    expect(resolution.rect).toEqual({
      x: 196,
      y: 196,
      width: 8,
      height: 8,
    });
  });

  it('maps timeline time targets to the visible track row', async () => {
    const registry = new GuidedTargetRegistry();
    registerDomGuidedTargetResolvers(registry);
    useTimelineStore.setState({ zoom: 40, scrollX: 60 });

    const surface = addElement({
      'data-guided-target': 'timeline-tracks',
      'data-guided-timeline-origin-x': '210',
    }, {
      x: 20,
      y: 50,
      width: 600,
      height: 220,
    });
    const track = addElement({ 'data-track-id': 'track-video-1' }, {
      x: 230,
      y: 90,
      width: 900,
      height: 60,
    });
    const clipRow = addElement({ class: 'track-clip-row' }, {
      x: 230,
      y: 96,
      width: 900,
      height: 40,
    });
    surface.appendChild(track);
    track.appendChild(clipRow);

    const resolution = await registry.resolve({
      kind: 'timelineTime',
      trackId: 'track-video-1',
      time: 5,
    });

    expect(resolution.status).toBe('resolved');
    expect(resolution.point).toEqual({ x: 370, y: 116 });
    expect(resolution.center).toEqual({ x: 370, y: 116 });
    expect(resolution.rect).toEqual({
      x: 366,
      y: 102,
      width: 8,
      height: 28,
    });
  });

  it('reports offscreen timeline times with a scroll recovery action', async () => {
    const registry = new GuidedTargetRegistry();
    registerDomGuidedTargetResolvers(registry);
    useTimelineStore.setState({ zoom: 50, scrollX: 0 });

    addElement({
      'data-guided-target': 'timeline-tracks',
      'data-guided-timeline-origin-x': '210',
    }, {
      x: 10,
      y: 20,
      width: 300,
      height: 120,
    });

    const target = {
      kind: 'timelineTime' as const,
      time: 20,
    };
    const resolution = await registry.resolve(target);

    expect(resolution).toEqual(expect.objectContaining({
      status: 'missing',
      reason: 'offscreen',
      suggestedAction: {
        type: 'scrollIntoView',
        target,
        block: 'center',
      },
    }));
  });

  it('resolves timeline clips at the center of their visible timeline slice', async () => {
    const registry = new GuidedTargetRegistry();
    registerDomGuidedTargetResolvers(registry);

    const surface = addElement({
      'data-guided-target': 'timeline-tracks',
      'data-guided-timeline-origin-x': '210',
    }, {
      x: 20,
      y: 50,
      width: 600,
      height: 220,
    });
    const clip = addElement({
      'data-guided-target': 'timeline-clip:clip-1',
      'data-clip-id': 'clip-1',
    }, {
      x: -400,
      y: 100,
      width: 1000,
      height: 40,
    });
    surface.appendChild(clip);

    const resolution = await registry.resolve({
      kind: 'timelineClip',
      clipId: 'clip-1',
    });

    expect(resolution.status).toBe('resolved');
    expect(resolution.rect).toEqual({
      x: 230,
      y: 100,
      width: 370,
      height: 40,
    });
    expect(resolution.center).toEqual({ x: 415, y: 120 });
  });

  it('resolves canvas shell trim and fade handles from guided start/end edges', async () => {
    const registry = new GuidedTargetRegistry();
    registerDomGuidedTargetResolvers(registry);

    const shell = addElement({
      class: 'clip-interaction-shell',
      'data-clip-id': 'clip-1',
    }, {
      x: 100,
      y: 100,
      width: 220,
      height: 40,
    });
    const trimHandle = addElement({ 'data-shell-trim-edge': 'left' }, {
      x: 100,
      y: 100,
      width: 8,
      height: 40,
    });
    const fadeHandle = addElement({ 'data-shell-fade-edge': 'right' }, {
      x: 308,
      y: 104,
      width: 12,
      height: 12,
    });
    shell.appendChild(trimHandle);
    shell.appendChild(fadeHandle);

    await expect(registry.resolve({
      kind: 'timelineTrimHandle',
      clipId: 'clip-1',
      edge: 'start',
    })).resolves.toEqual(expect.objectContaining({
      status: 'resolved',
      center: { x: 104, y: 120 },
    }));
    await expect(registry.resolve({
      kind: 'timelineFadeHandle',
      clipId: 'clip-1',
      edge: 'end',
    })).resolves.toEqual(expect.objectContaining({
      status: 'resolved',
      center: { x: 314, y: 110 },
    }));
  });

  it('resolves mask vertex, handle, and edge SVG targets by stable mask ids', async () => {
    const registry = new GuidedTargetRegistry();
    registerDomGuidedTargetResolvers(registry);

    addElement({ 'data-guided-target': 'mask-vertex:mask-1:vertex-2' }, {
      x: 20,
      y: 30,
      width: 10,
      height: 10,
    });
    addElement({ 'data-guided-mask-handle-index': 'mask-1:1:out' }, {
      x: 60,
      y: 70,
      width: 8,
      height: 8,
    });
    addElement({ 'data-guided-mask-edge': 'mask-1:1:2' }, {
      x: 100,
      y: 120,
      width: 40,
      height: 12,
    });

    await expect(registry.resolve({
      kind: 'maskVertex',
      maskId: 'mask-1',
      vertexId: 'vertex-2',
    })).resolves.toEqual(expect.objectContaining({
      status: 'resolved',
      center: { x: 25, y: 35 },
    }));
    await expect(registry.resolve({
      kind: 'maskHandle',
      maskId: 'mask-1',
      index: 1,
      handle: 'out',
    })).resolves.toEqual(expect.objectContaining({
      status: 'resolved',
      center: { x: 64, y: 74 },
    }));
    await expect(registry.resolve({
      kind: 'maskEdge',
      maskId: 'mask-1',
      fromIndex: 1,
      toIndex: 2,
    })).resolves.toEqual(expect.objectContaining({
      status: 'resolved',
      center: { x: 120, y: 126 },
    }));
  });
});

function addElement(
  attributes: Record<string, string>,
  rect: GuidedRect,
): HTMLElement {
  const element = document.createElement('div');
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  element.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => rect,
  });
  document.body.appendChild(element);
  return element;
}
