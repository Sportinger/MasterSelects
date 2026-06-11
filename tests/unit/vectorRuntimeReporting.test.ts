import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';
import { LottieRuntimeManager } from '../../src/services/vectorAnimation/LottieRuntimeManager';
import {
  createVectorRuntimeCanvasResource,
  reserveVectorRuntimeCanvasResource,
} from '../../src/services/vectorAnimation/vectorRuntimeReporting';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';

vi.mock('@lottiefiles/dotlottie-web', () => ({
  DotLottie: class MockDotLottie {
    activeAnimationId = '';
    isLoaded = true;
    totalFrames = 1;
    addEventListener(): void {}
    removeEventListener(): void {}
    destroy(): void {}
    pause(): void {}
    resize(): void {}
    setBackgroundColor(): void {}
    setFrame(): void {}
    setLayout(): void {}
    setLoop(): void {}
    setUseFrameInterpolation(): void {}
    stateMachineLoad(): boolean { return false; }
    stateMachineSetConfig(): void {}
    stateMachineStart(): boolean { return false; }
    stateMachineStop(): void {}
  },
}));

vi.mock('../../src/services/vectorAnimation/lottieMetadata', () => ({
  prepareLottieAsset: vi.fn(async (file: File) => ({
    metadata: {
      provider: 'lottie',
      width: 128,
      height: 64,
      duration: 1,
    },
    payload: {
      kind: 'json',
      data: '{}',
      sourceKey: `${file.name}:${file.size}`,
    },
  })),
}));

function getInteractivePolicyBudget() {
  const budget = timelineRuntimeCoordinator.getPolicy('interactive')?.defaultBudget;
  if (!budget) throw new Error('Missing interactive runtime policy budget');
  return budget;
}

function createLottieClip(id: string): TimelineClip {
  return {
    id,
    name: `Clip ${id}`,
    type: 'video',
    trackId: 'video-1',
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    file: new File(['{}'], `${id}.json`, { type: 'application/json' }),
    mediaFileId: `media-${id}`,
    source: {
      type: 'lottie',
      mediaFileId: `media-${id}`,
      naturalDuration: 1,
    },
  } as TimelineClip;
}

describe('vector runtime reporting', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    timelineRuntimeCoordinator.clearResources();
  });

  it('reserves and releases vector runtime canvas resources with caller ownership', () => {
    const clip = createLottieClip('background-vector');
    const reservation = reserveVectorRuntimeCanvasResource({
      clip,
      provider: 'lottie',
      width: 320,
      height: 180,
      options: {
        policyId: 'background',
        ownerId: 'background:layer-1:clip-background-vector',
        ownerType: 'clip',
        label: 'Background vector canvas',
        tags: ['background-layer', 'vector-animation'],
      },
    });

    expect(reservation.admitted).toBe(true);
    const stats = timelineRuntimeCoordinator.getBridgeStats();
    const resource = stats.policies.background.resources.find((entry) => entry.id === reservation.resourceId);
    expect(resource).toMatchObject({
      kind: 'image-canvas',
      policyId: 'background',
      imageKind: 'html-canvas',
      owner: {
        ownerId: 'background:layer-1:clip-background-vector',
        clipId: 'background-vector',
        mediaFileId: 'media-background-vector',
      },
      dimensions: {
        width: 320,
        height: 180,
      },
      memoryCost: {
        heapBytes: 320 * 180 * 4,
      },
      tags: expect.arrayContaining([
        'runtime-provider-demand',
        'background-cache',
        'background-layer',
        'vector-animation',
      ]),
    });

    reservation.release();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.background.resources).toHaveLength(0);
  });

  it('denies Lottie runtime preparation before allocating a canvas when the policy is full', async () => {
    const maxImageBitmaps = getInteractivePolicyBudget().maxImageBitmaps ?? 0;
    for (let index = 0; index < maxImageBitmaps; index += 1) {
      timelineRuntimeCoordinator.retainResource(createVectorRuntimeCanvasResource({
        clip: createLottieClip(`retained-${index}`),
        provider: 'lottie',
        options: {
          policyId: 'interactive',
          ownerId: `retained-owner-${index}`,
          resourceId: `retained-vector-canvas-${index}`,
        },
      }));
    }

    const createElement = vi.spyOn(document, 'createElement');
    const manager = new LottieRuntimeManager();

    await expect(manager.prepareClipSource(createLottieClip('denied-vector'))).rejects.toMatchObject({
      name: 'VectorRuntimeAdmissionError',
    });
    expect(createElement).not.toHaveBeenCalledWith('canvas');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .toHaveLength(maxImageBitmaps);
  });
});
