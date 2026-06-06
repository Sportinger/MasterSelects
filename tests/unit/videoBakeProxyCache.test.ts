import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderResourceDescriptor } from '../../src/services/timeline/runtimeCoordinatorTypes';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import { videoBakeProxyCache, type VideoBakeProxyArtifactInput } from '../../src/services/videoBakeProxyCache';

function createInput(regionId = 'region-1'): VideoBakeProxyArtifactInput {
  return {
    region: {
      id: regionId,
      scope: 'composition',
      startTime: 1,
      endTime: 3,
      createdAt: 1,
    },
    compositionId: 'comp-1',
    blob: new Blob(['video'], { type: 'video/mp4' }),
    width: 640,
    height: 360,
    fps: 30,
  };
}

function createRetainedCompositionResource(index: number): RenderResourceDescriptor {
  return {
    id: `retained-composition-video-${index}`,
    kind: 'html-media',
    policyId: 'composition-render',
    owner: {
      ownerId: `retained-composition-owner-${index}`,
      ownerType: 'composition',
      compositionId: `comp-${index}`,
    },
    mediaElementKind: 'video',
    elementId: `retained-video-${index}`,
    srcKind: 'blob-url',
  };
}

function installUrlMocks(): {
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
} {
  const createObjectURL = vi.fn(() => 'blob:video-bake-proxy');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  });
  return { createObjectURL, revokeObjectURL };
}

describe('video bake proxy cache runtime admission', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
    videoBakeProxyCache.clear();
  });

  afterEach(() => {
    videoBakeProxyCache.clear();
    timelineRuntimeCoordinator.clearResources();
    vi.restoreAllMocks();
  });

  it('denies proxy registration before creating blob URLs or video elements when the policy is full', async () => {
    const { createObjectURL } = installUrlMocks();
    const createElement = vi.spyOn(document, 'createElement');
    for (let index = 0; index < 64; index += 1) {
      timelineRuntimeCoordinator.retainResource(createRetainedCompositionResource(index));
    }

    await expect(videoBakeProxyCache.registerCompositionArtifact(createInput('denied-region'))).rejects.toMatchObject({
      name: 'VideoBakeProxyAdmissionError',
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'].resources).toHaveLength(64);
  });

  it('reports admitted proxy videos and releases them on remove', async () => {
    const { revokeObjectURL } = installUrlMocks();
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = Document.prototype.createElement.call(document, tagName, options);
      if (tagName === 'video') {
        Object.defineProperty(element, 'readyState', {
          configurable: true,
          value: HTMLMediaElement.HAVE_CURRENT_DATA,
        });
      }
      return element;
    });

    await videoBakeProxyCache.registerCompositionArtifact(createInput('admitted-region'));

    const resourceId = 'video-bake-proxy:comp-1:admitted-region:html-media:video';
    expect(videoBakeProxyCache.has('admitted-region')).toBe(true);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'].resources)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: resourceId,
          kind: 'html-media',
          mediaElementKind: 'video',
          dimensions: expect.objectContaining({
            width: 640,
            height: 360,
            fps: 30,
            durationSeconds: 2,
          }),
        }),
      ]));

    videoBakeProxyCache.remove('admitted-region');

    expect(videoBakeProxyCache.has('admitted-region')).toBe(false);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['composition-render'].resources)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: resourceId })]));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-bake-proxy');
  });
});
