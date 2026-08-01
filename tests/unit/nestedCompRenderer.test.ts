import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayerRenderData } from '../../src/engine/core/types';
import {
  NestedCompRenderer,
  resolveNestedPreviewRenderScale,
} from '../../src/engine/render/NestedCompRenderer';
import {
  getCompatibleNestedVideoOwnerId,
  getNestedVideoOwnerId,
  getNestedVideoReuseKey,
} from '../../src/engine/render/nestedComp/htmlVideoPreview';
import type { CompositorPipeline } from '../../src/engine/pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import type { TextureManager } from '../../src/engine/texture/TextureManager';
import type { MaskTextureManager } from '../../src/engine/texture/MaskTextureManager';
import type { Layer } from '../../src/types/layers';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import { DEFAULT_PRIMARY_COLOR_PARAMS } from '../../src/types/colorCorrection';
import {
  getSharedSceneDefaultCameraDistance,
  resolveRenderableSharedSceneCamera,
} from '../../src/engine/scene/SceneCameraUtils';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';
import type { MotionFrameRuntimeAdmission } from '../../src/engine/motion/MotionFrameRuntime';

const { mockNativeSceneRenderer } = vi.hoisted(() => ({
  mockNativeSceneRenderer: {
    isInitialized: true,
    initialize: vi.fn(async () => true),
    renderScene: vi.fn(() => ({ label: 'nested-shared-scene-view' })),
  },
}));

const { mockCompositeNestedLayers } = vi.hoisted(() => ({
  mockCompositeNestedLayers: vi.fn((params: { texturePair: { pingTexture: GPUTexture } }) => params.texturePair.pingTexture),
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock('../../src/engine/native3d/NativeSceneRenderer', () => ({
  getNativeSceneRenderer: vi.fn(() => mockNativeSceneRenderer),
}));

vi.mock('../../src/engine/render/nestedComp/compositeNestedLayers', () => ({
  compositeNestedLayers: mockCompositeNestedLayers,
}));

const initialMediaState = useMediaStore.getState();
const initialTimelineState = useTimelineStore.getState();
type NestedCompRendererTestAccess = NestedCompRenderer & {
  collectNestedLayerData: (
    layers: Layer[],
    commandEncoder?: GPUCommandEncoder,
    sampler?: GPUSampler,
    depth?: number,
    skipEffects?: boolean,
    particleQuality?: 'preview' | 'export',
    motionFrameAdmission?: MotionFrameRuntimeAdmission,
    renderOccurrenceKey?: string,
    previewRenderScale?: number,
  ) => LayerRenderData[];
  process3DLayersForNested: (
    layerData: LayerRenderData[],
    width: number,
    height: number,
    compId: string,
    clips: TimelineClip[],
    tracks: TimelineTrack[],
  ) => void;
};

function createMockTexture() {
  return {
    createView: vi.fn(() => ({ label: 'texture-view' })),
    destroy: vi.fn(),
  };
}

function createSizedMockTexture(width = 16, height = 16) {
  return {
    width,
    height,
    createView: vi.fn(() => ({ label: 'texture-view' })),
    destroy: vi.fn(),
  };
}

function createRenderer(device: GPUDevice = {} as GPUDevice) {
  return new NestedCompRenderer(
    device,
    {} as unknown as CompositorPipeline,
    {} as unknown as EffectsPipeline,
    {} as unknown as TextureManager,
    {
      getMaskInfo: vi.fn(() => ({
        hasMask: false,
        view: null,
      })),
    } as unknown as MaskTextureManager,
    null,
  ) as unknown as NestedCompRendererTestAccess;
}

function createRuntimeColorGrade(): NonNullable<Layer['colorCorrection']> {
  return {
    enabled: true,
    graphHash: 'nested-grade-1',
    nodeIds: ['node_primary'],
    primary: {
      ...DEFAULT_PRIMARY_COLOR_PARAMS,
      exposure: 0.2,
      contrast: 1.15,
      pivot: 0.5,
      saturation: 0.85,
      vibrance: 0,
      temperature: 0,
      tint: 0,
      blackPoint: 0,
      whitePoint: 1,
      lift: 0,
      gamma: 1,
      gain: 1,
      offset: 0,
      shadows: 0,
      highlights: 0,
    },
    primaryNodes: [],
    diagnostics: [],
  };
}

describe('NestedCompRenderer shared-scene integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNativeSceneRenderer.isInitialized = true;
    mockNativeSceneRenderer.renderScene.mockReturnValue({ label: 'nested-shared-scene-view' });
    useMediaStore.setState(initialMediaState);
    useTimelineStore.setState(initialTimelineState);
  });

  it('caps nested playback previews while keeping paused and export resolution exact', () => {
    expect(resolveNestedPreviewRenderScale({
      compositionWidth: 1920,
      compositionHeight: 1080,
      outputWidth: 1920,
      outputHeight: 1080,
      isPlaying: true,
      particleQuality: 'preview',
    })).toBe(0.5);
    expect(resolveNestedPreviewRenderScale({
      compositionWidth: 1920,
      compositionHeight: 1080,
      outputWidth: 960,
      outputHeight: 540,
      isPlaying: false,
      particleQuality: 'preview',
    })).toBe(0.5);
    expect(resolveNestedPreviewRenderScale({
      compositionWidth: 1920,
      compositionHeight: 1080,
      outputWidth: 480,
      outputHeight: 270,
      isPlaying: true,
      particleQuality: 'preview',
    })).toBe(0.25);
    expect(resolveNestedPreviewRenderScale({
      compositionWidth: 1920,
      compositionHeight: 1080,
      outputWidth: 480,
      outputHeight: 270,
      isPlaying: true,
      particleQuality: 'export',
    })).toBe(1);
  });

  it('uses the preview scale but always renders exports at full size', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 },
    });
    const device = {
      createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
        const size = descriptor.size;
        const width = Array.isArray(size) ? size[0] : size.width;
        const height = Array.isArray(size) ? size[1] : size.height;
        return createSizedMockTexture(Number(width), Number(height));
      }),
    } as unknown as GPUDevice;
    const renderer = createRenderer(device);
    const renderPass = { end: vi.fn() };
    const encoder = {
      beginRenderPass: vi.fn(() => renderPass),
    } as unknown as GPUCommandEncoder;

    try {
      renderer.preRender(
        'scaled-comp',
        [],
        1920,
        1080,
        encoder,
        {} as GPUSampler,
        1,
        undefined,
        undefined,
        0,
        false,
        'preview',
        undefined,
        'wrapper',
        0.5,
      );
      expect(renderer.getTexture('scaled-comp', 'wrapper')?.texture).toMatchObject({
        width: 960,
        height: 540,
      });

      renderer.preRender(
        'scaled-comp',
        [],
        1920,
        1080,
        encoder,
        {} as GPUSampler,
        1,
        undefined,
        undefined,
        0,
        false,
        'export',
        undefined,
        'wrapper',
        0.5,
      );
      expect(renderer.getTexture('scaled-comp', 'wrapper')?.texture).toMatchObject({
        width: 1920,
        height: 1080,
      });
    } finally {
      renderer.destroy();
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('preserves nested layer geometry in a reduced playback texture', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 },
    });
    const device = {
      createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
        const size = descriptor.size;
        const width = Array.isArray(size) ? size[0] : size.width;
        const height = Array.isArray(size) ? size[1] : size.height;
        return createSizedMockTexture(Number(width), Number(height));
      }),
    } as unknown as GPUDevice;
    const renderer = createRenderer(device);
    const renderPass = { end: vi.fn() };
    const encoder = {
      beginRenderPass: vi.fn(() => renderPass),
      copyTextureToTexture: vi.fn(),
    } as unknown as GPUCommandEncoder;
    const nestedLayer = {
      id: 'child-wrapper',
      name: 'Child composition',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      source: {
        type: 'image',
        nestedComposition: {
          compositionId: 'child-comp',
          layers: [],
          width: 1920,
          height: 1080,
          currentTime: 1,
        },
      },
    } as unknown as Layer;

    try {
      renderer.preRender(
        'outer-comp',
        [nestedLayer],
        1920,
        1080,
        encoder,
        {} as GPUSampler,
        1,
        undefined,
        undefined,
        0,
        false,
        'preview',
        undefined,
        'outer-wrapper',
        0.5,
      );

      const compositeCall = mockCompositeNestedLayers.mock.calls.at(-1)?.[0] as {
        layerData: LayerRenderData[];
        width: number;
        height: number;
      };
      expect(compositeCall).toMatchObject({ width: 960, height: 540 });
      expect(compositeCall.layerData[0]).toMatchObject({
        sourceWidth: 960,
        sourceHeight: 540,
      });
    } finally {
      renderer.destroy();
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('reuses one preview-frame owner across transition coverage segments', () => {
    const baseId = 'transition-comp:transition-1:outgoing';

    expect(getNestedVideoOwnerId({ sourceClipId: baseId })).toBe(baseId);
    expect(getNestedVideoOwnerId({ sourceClipId: `${baseId}:seg:1` })).toBe(baseId);
    expect(getNestedVideoOwnerId({ sourceClipId: `${baseId}:seg:1:part:2` })).toBe(baseId);
    expect(getNestedVideoOwnerId({ sourceClipId: `${baseId}:part:1` })).toBe(baseId);
    expect(getNestedVideoOwnerId({ sourceClipId: 'user-clip:seg:1' })).toBe('user-clip:seg:1');
    expect(getNestedVideoReuseKey({ id: `nested-layer-${baseId}`, sourceClipId: baseId })).toBe(baseId);
    expect(getNestedVideoReuseKey({
      id: `nested-layer-${baseId}:seg:1`,
      sourceClipId: `${baseId}:seg:1`,
    })).toBe(baseId);
    const panelId = `${baseId}:panel:0:0`;
    expect(getNestedVideoOwnerId({ sourceClipId: `${baseId}:seg:1:part:2:panel:0:0` })).toBe(panelId);
    expect(getNestedVideoReuseKey({ id: `nested-layer-${panelId}`, sourceClipId: panelId })).toBe(panelId);
    expect(getNestedVideoReuseKey({
      id: `nested-layer-${baseId}:seg:1:panel:0:0`,
      sourceClipId: `${baseId}:seg:1:panel:0:0`,
    })).toBe(panelId);
    expect(getCompatibleNestedVideoOwnerId(
      { sourceClipId: `${baseId}:seg:1` },
      'parent-clip',
      10.05,
      10,
    )).toBe('parent-clip');
    expect(getCompatibleNestedVideoOwnerId(
      { sourceClipId: `${baseId}:seg:1` },
      'parent-clip',
      9,
      10,
    )).toBe(baseId);
    expect(getCompatibleNestedVideoOwnerId(
      { sourceClipId: `${baseId}:seg:1` },
      'parent-clip',
      9,
      10,
      10.05,
    )).toBe('parent-clip');
  });

  it('does not cache a deferred nested frame at the target time', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 },
    });
    const renderer = createRenderer({
      createTexture: vi.fn(() => createMockTexture()),
    } as unknown as GPUDevice);

    try {
      const view = renderer.preRender(
        'transition-comp',
        [{
          id: 'pending-layer',
          name: 'Pending Layer',
          visible: true,
          opacity: 1,
          source: null,
        }] as unknown as Layer[],
        16,
        16,
        {} as GPUCommandEncoder,
        {} as GPUSampler,
        1,
        [{ id: 'scene-clip' }] as unknown as TimelineClip[],
      );

      expect(view).toBeNull();
      expect((renderer as unknown as { lastRenderTime: Map<string, number> }).lastRenderTime.has('transition-comp')).toBe(false);
    } finally {
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('renders an intentionally transparent nested frame instead of deferring it', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 },
    });
    const renderer = createRenderer({
      createTexture: vi.fn(() => createSizedMockTexture()),
    } as unknown as GPUDevice);
    const renderPass = { end: vi.fn() };
    const encoder = {
      beginRenderPass: vi.fn(() => renderPass),
    } as unknown as GPUCommandEncoder;

    try {
      const view = renderer.preRender(
        'transparent-comp',
        [{
          id: 'transparent-motion-layer',
          name: 'Transparent Motion Layer',
          visible: true,
          opacity: 0,
          source: { type: 'motion' },
        }] as unknown as Layer[],
        16,
        16,
        encoder,
        {} as GPUSampler,
        0,
        [{ id: 'scene-clip' }] as unknown as TimelineClip[],
      );

      expect(view).not.toBeNull();
      expect(encoder.beginRenderPass).toHaveBeenCalledWith({
        colorAttachments: [{
          view: expect.anything(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      expect(renderPass.end).toHaveBeenCalledOnce();
      expect(mockCompositeNestedLayers).not.toHaveBeenCalled();
      expect((renderer as unknown as { lastRenderTime: Map<string, number> }).lastRenderTime.get('transparent-comp')).toBe(0);
    } finally {
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('hides nested preview Motion without invoking its renderer after admission fails', () => {
    const renderer = createRenderer();
    const renderLayer = vi.fn();
    (renderer as unknown as { motionRenderer: { renderLayer: typeof renderLayer } }).motionRenderer = {
      renderLayer,
    };
    const motion = createDefaultMotionLayerDefinition('shape');
    const failedAdmission: MotionFrameRuntimeAdmission = {
      ok: false,
      consumerInput: null,
      failures: [{ code: 'TEST_FRAME_LIMIT', message: 'test frame limit exceeded' }],
    };

    const result = renderer.collectNestedLayerData(
      [{
        id: 'nested-motion-over-budget',
        visible: true,
        opacity: 1,
        source: { type: 'motion', motion },
      } as unknown as Layer],
      {} as GPUCommandEncoder,
      undefined,
      0,
      false,
      'preview',
      failedAdmission,
    );

    expect(result).toEqual([]);
    expect(renderLayer).not.toHaveBeenCalled();
  });

  it('fails nested export before drawing when Motion admission fails', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 },
    });
    const renderer = createRenderer({
      createTexture: vi.fn(() => createSizedMockTexture()),
    } as unknown as GPUDevice);
    const failedAdmission: MotionFrameRuntimeAdmission = {
      ok: false,
      consumerInput: null,
      failures: [{ code: 'TEST_EXPORT_LIMIT', message: 'test export limit exceeded' }],
    };

    try {
      expect(() => renderer.preRender(
        'nested-export-comp',
        [{
          id: 'nested-export-motion',
          visible: true,
          opacity: 1,
          source: { type: 'motion', motion: createDefaultMotionLayerDefinition('shape') },
        } as unknown as Layer],
        16,
        16,
        {} as GPUCommandEncoder,
        {} as GPUSampler,
        0,
        undefined,
        undefined,
        0,
        false,
        'export',
        failedAdmission,
      )).toThrow(/TEST_EXPORT_LIMIT/);
      expect(mockCompositeNestedLayers).not.toHaveBeenCalled();
    } finally {
      renderer.destroy();
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('keeps output textures and frame caches separate for repeated composition occurrences', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 },
    });
    let textureId = 0;
    const device = {
      createTexture: vi.fn(() => {
        const view = { id: `view-${++textureId}` };
        return {
          width: 16,
          height: 16,
          createView: vi.fn(() => view),
          destroy: vi.fn(),
        };
      }),
    } as unknown as GPUDevice;
    const renderer = createRenderer(device);
    const renderPass = { end: vi.fn() };
    const encoder = {
      beginRenderPass: vi.fn(() => renderPass),
    } as unknown as GPUCommandEncoder;
    const sampler = {} as GPUSampler;
    const renderOccurrence = (localTime: number, occurrenceKey: string) => renderer.preRender(
      'repeated-comp',
      [],
      16,
      16,
      encoder,
      sampler,
      localTime,
      undefined,
      undefined,
      0,
      false,
      'preview',
      undefined,
      occurrenceKey,
    );

    try {
      const firstView = renderOccurrence(1, 'wrapper-layer-a');
      const secondView = renderOccurrence(4, 'wrapper-layer-b');

      expect(firstView).not.toBe(secondView);
      expect(renderer.getTexture('repeated-comp', 'wrapper-layer-a')?.view).toBe(firstView);
      expect(renderer.getTexture('repeated-comp', 'wrapper-layer-b')?.view).toBe(secondView);
      expect(renderer.getTexture('repeated-comp')).toBeUndefined();
      expect(renderOccurrence(1, 'wrapper-layer-a')).toBe(firstView);
      expect(renderOccurrence(4, 'wrapper-layer-b')).toBe(secondView);
      expect((renderer as unknown as {
        nestedCompTextures: Map<string, { compositionId: string }>;
      }).nestedCompTextures.size).toBe(2);
      expect((renderer as unknown as { lastRenderTime: Map<string, number> }).lastRenderTime.size).toBe(2);
    } finally {
      renderer.destroy();
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('hands the last good preview frame to a newly split occurrence during a decode gap', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 },
    });
    let textureId = 0;
    const device = {
      createTexture: vi.fn(() => {
        const view = { id: `handoff-view-${++textureId}` };
        return {
          width: 16,
          height: 16,
          createView: vi.fn(() => view),
          destroy: vi.fn(),
        };
      }),
    } as unknown as GPUDevice;
    const renderer = createRenderer(device);
    const renderPass = { end: vi.fn() };
    const encoder = {
      beginRenderPass: vi.fn(() => renderPass),
      copyTextureToTexture: vi.fn(),
    } as unknown as GPUCommandEncoder;
    const unavailableVideoLayer = {
      id: 'nested-video',
      visible: true,
      opacity: 1,
      source: { type: 'video' },
    } as unknown as Layer;

    try {
      const firstView = renderer.preRender(
        'split-comp',
        [],
        16,
        16,
        encoder,
        {} as GPUSampler,
        0.84,
        undefined,
        undefined,
        0,
        false,
        'preview',
        undefined,
        'wrapper-a',
      );
      const secondView = renderer.preRender(
        'split-comp',
        [unavailableVideoLayer],
        16,
        16,
        encoder,
        {} as GPUSampler,
        0.91,
        undefined,
        undefined,
        0,
        false,
        'preview',
        undefined,
        'wrapper-b',
      );

      const firstTexture = renderer.getTexture('split-comp', 'wrapper-a')!.texture;
      const secondTexture = renderer.getTexture('split-comp', 'wrapper-b')!.texture;
      expect(secondView).not.toBeNull();
      expect(secondView).not.toBe(firstView);
      expect(encoder.copyTextureToTexture).toHaveBeenCalledWith(
        { texture: firstTexture },
        { texture: secondTexture },
        { width: 16, height: 16 },
      );

      const copyCount = vi.mocked(encoder.copyTextureToTexture).mock.calls.length;
      expect(renderer.preRender(
        'split-comp',
        [unavailableVideoLayer],
        16,
        16,
        encoder,
        {} as GPUSampler,
        0.92,
        undefined,
        undefined,
        0,
        false,
        'export',
        undefined,
        'wrapper-export',
      )).toBeNull();
      expect(encoder.copyTextureToTexture).toHaveBeenCalledTimes(copyCount);
    } finally {
      renderer.destroy();
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('destroys occurrence textures that were not used in the next render lifecycle', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 },
    });
    const device = {
      createTexture: vi.fn(() => createSizedMockTexture()),
    } as unknown as GPUDevice;
    const renderer = createRenderer(device);
    const renderPass = { end: vi.fn() };
    const encoder = {
      beginRenderPass: vi.fn(() => renderPass),
    } as unknown as GPUCommandEncoder;
    const renderOccurrence = (occurrenceKey: string) => renderer.preRender(
      'lifecycle-comp',
      [],
      16,
      16,
      encoder,
      {} as GPUSampler,
      1,
      undefined,
      undefined,
      0,
      false,
      'preview',
      undefined,
      occurrenceKey,
    );

    try {
      renderOccurrence('wrapper-a');
      renderOccurrence('wrapper-b');
      const entries = Array.from((renderer as unknown as {
        nestedCompTextures: Map<string, {
          renderOccurrenceKey?: string;
          texture: { destroy: ReturnType<typeof vi.fn> };
        }>;
      }).nestedCompTextures.values());
      const first = entries.find((entry) => entry.renderOccurrenceKey === 'wrapper-a')!;
      const stale = entries.find((entry) => entry.renderOccurrenceKey === 'wrapper-b')!;

      renderer.cleanupPendingTextures();
      expect(first.texture.destroy).not.toHaveBeenCalled();
      expect(stale.texture.destroy).not.toHaveBeenCalled();

      renderOccurrence('wrapper-a');
      renderer.cleanupPendingTextures();

      expect(first.texture.destroy).not.toHaveBeenCalled();
      expect(stale.texture.destroy).toHaveBeenCalledOnce();
      expect(renderer.getTexture('lifecycle-comp', 'wrapper-a')).toBeDefined();
      expect(renderer.getTexture('lifecycle-comp', 'wrapper-b')).toBeUndefined();
    } finally {
      renderer.destroy();
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('derives separate recursive cache scopes from each parent occurrence', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 },
    });
    let textureId = 0;
    const device = {
      createTexture: vi.fn(() => {
        const view = { id: `recursive-view-${++textureId}` };
        return {
          width: 16,
          height: 16,
          createView: vi.fn(() => view),
          destroy: vi.fn(),
        };
      }),
    } as unknown as GPUDevice;
    const renderer = createRenderer(device);
    const renderPass = { end: vi.fn() };
    const encoder = {
      beginRenderPass: vi.fn(() => renderPass),
      copyTextureToTexture: vi.fn(),
    } as unknown as GPUCommandEncoder;
    const createNestedWrapper = (localTime: number) => ({
      id: 'same-inner-wrapper-id',
      name: 'Nested child',
      visible: true,
      opacity: 1,
      source: {
        type: 'image',
        nestedComposition: {
          compositionId: 'shared-child-comp',
          layers: [],
          width: 16,
          height: 16,
          currentTime: localTime,
        },
      },
    }) as unknown as Layer;

    try {
      renderer.preRender(
        'outer-comp',
        [createNestedWrapper(1)],
        16,
        16,
        encoder,
        {} as GPUSampler,
        1,
        undefined,
        undefined,
        0,
        false,
        'preview',
        undefined,
        'outer-wrapper-a',
      );
      renderer.preRender(
        'outer-comp',
        [createNestedWrapper(4)],
        16,
        16,
        encoder,
        {} as GPUSampler,
        4,
        undefined,
        undefined,
        0,
        false,
        'preview',
        undefined,
        'outer-wrapper-b',
      );

      const nestedTextures = Array.from((renderer as unknown as {
        nestedCompTextures: Map<string, { compositionId: string; view: GPUTextureView }>;
      }).nestedCompTextures.values()).filter((texture) => texture.compositionId === 'shared-child-comp');
      expect(nestedTextures).toHaveLength(2);
      expect(nestedTextures[0]?.view).not.toBe(nestedTextures[1]?.view);
    } finally {
      renderer.destroy();
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('invalidates a same-time nested texture when Motion appearance changes', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 },
    });
    const renderer = createRenderer({
      limits: { maxBufferSize: 100_000 * 48 },
      createTexture: vi.fn(() => createSizedMockTexture()),
    } as unknown as GPUDevice);
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    const firstMotion = createDefaultMotionLayerDefinition('shape');
    const secondMotion = structuredClone(firstMotion);
    secondMotion.appearance!.items[0].opacity = 0.25;
    const createLayer = (motion: typeof firstMotion) => ({
      id: 'nested-motion',
      name: 'Nested Motion',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      source: { type: 'motion', motion },
    }) as unknown as Layer;

    try {
      renderer.preRender(
        'motion-comp',
        [createLayer(firstMotion)],
        16,
        16,
        encoder,
        {} as GPUSampler,
        1,
      );
      renderer.preRender(
        'motion-comp',
        [createLayer(secondMotion)],
        16,
        16,
        encoder,
        {} as GPUSampler,
        1,
      );

      expect(mockCompositeNestedLayers).toHaveBeenCalledTimes(2);
    } finally {
      renderer.destroy();
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('recollects dynamic nested video when its target time has not advanced', () => {
    const previousGPUTextureUsage = (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8 },
    });
    const device = { createTexture: vi.fn(() => createSizedMockTexture()) } as unknown as GPUDevice;
    const textureManager = { importVideoTexture: vi.fn(() => ({})) } as unknown as TextureManager;
    const renderer = new NestedCompRenderer(
      device,
      {} as CompositorPipeline,
      {} as EffectsPipeline,
      textureManager,
      {} as MaskTextureManager,
    );
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    const layers = [{
      id: 'nested-video',
      name: 'Nested Video',
      sourceClipId: 'transition-comp:transition-1:outgoing',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      source: {
        type: 'video',
        videoFrame: { displayWidth: 16, displayHeight: 16 },
      },
    }] as unknown as Layer[];

    try {
      renderer.preRender('transition-comp', layers, 16, 16, encoder, {} as GPUSampler, 1);
      renderer.preRender('transition-comp', layers, 16, 16, encoder, {} as GPUSampler, 1);

      expect(mockCompositeNestedLayers).toHaveBeenCalledTimes(2);
    } finally {
      if (previousGPUTextureUsage === undefined) {
        delete (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage;
      } else {
        Object.defineProperty(globalThis, 'GPUTextureUsage', {
          configurable: true,
          value: previousGPUTextureUsage,
        });
      }
    }
  });

  it('collects nested gaussian splats as shared-scene placeholders', () => {
    const renderer = createRenderer();

    const nestedLayerData = renderer.collectNestedLayerData([{
      id: 'nested-splat-layer',
      name: 'Nested Splat',
      sourceClipId: 'nested-splat-clip',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0.25, y: -0.5, z: 2 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      is3D: true,
      source: {
        type: 'gaussian-splat',
        gaussianSplatUrl: 'blob:nested-splat',
        gaussianSplatFileName: 'nested.ply',
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: true,
          },
        },
      },
    }] as unknown as TimelineClip[]);

    expect(nestedLayerData).toHaveLength(1);
    expect(nestedLayerData[0]).toMatchObject({
      layer: expect.objectContaining({
        id: 'nested-splat-layer',
        sourceClipId: 'nested-splat-clip',
      }),
      textureView: null,
      sourceWidth: 0,
      sourceHeight: 0,
    });
  });

  it('keeps textureless motion adjustments in nested stack order', () => {
    const renderer = createRenderer();
    const makeLayer = (id: string, type: 'model' | 'motion-adjustment') => ({
      id,
      name: id,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      source: type === 'motion-adjustment'
        ? { type, intrinsicWidth: 640, intrinsicHeight: 360 }
        : { type },
    }) as unknown as Layer;

    const nestedLayerData = renderer.collectNestedLayerData([
      makeLayer('top', 'model'),
      makeLayer('adjustment', 'motion-adjustment'),
      makeLayer('bottom', 'model'),
    ]);

    expect(nestedLayerData.map((entry) => entry.layer.id)).toEqual([
      'bottom',
      'adjustment',
      'top',
    ]);
    expect(nestedLayerData[1]).toMatchObject({
      textureView: null,
      externalTexture: null,
      sourceWidth: 640,
      sourceHeight: 360,
    });
  });

  it('renders nested 3D layers through the shared scene renderer with nested camera and effector context', () => {
    const renderer = createRenderer();
    useMediaStore.setState({
      activeCompositionId: 'main-comp',
      compositions: [{
        id: 'main-comp',
        camera: {
          enabled: true,
          position: { x: 9, y: 9, z: 9 },
          target: { x: 1, y: 1, z: 1 },
          up: { x: 0, y: 1, z: 0 },
          fov: 24,
          near: 0.4,
          far: 240,
        },
      }],
    });
    useTimelineStore.setState({
      isPlaying: false,
      isExporting: false,
      clipKeyframes: new Map(),
      tracks: [],
      clips: [],
    });

    const sceneTracks = [{
      id: 'nested-track',
      type: 'video',
      visible: true,
    }];
    const sceneClips = [{
      id: 'nested-camera',
      trackId: 'nested-track',
      startTime: 0,
      duration: 10,
      transform: {
        position: { x: 0.2, y: -0.25, z: 4 },
        scale: { x: 1.1, y: 1.1, z: 0.4 },
        rotation: { x: 14, y: -12, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      },
      source: {
        type: 'camera',
        cameraSettings: {
          fov: 68,
          near: 0.3,
          far: 420,
        },
      },
    }, {
      id: 'nested-effector',
      trackId: 'nested-track',
      startTime: 1,
      duration: 4,
      transform: {
        position: { x: 0.35, y: -0.15, z: 1.75 },
        scale: { x: 0.45, y: 0.55, z: 0.65 },
        rotation: { x: 10, y: 20, z: 30 },
        opacity: 1,
        blendMode: 'normal',
      },
      source: {
        type: 'splat-effector',
        splatEffectorSettings: {
          mode: 'swirl',
          strength: 45,
          falloff: 1.5,
          speed: 1.25,
          seed: 9,
        },
      },
    }];
    const colorCorrection = createRuntimeColorGrade();
    const layerData: LayerRenderData[] = [{
      layer: {
        id: 'nested-splat-layer',
        name: 'Nested Splat',
        sourceClipId: 'nested-splat-clip',
        visible: true,
        opacity: 0.8,
        blendMode: 'screen',
        effects: [{ id: 'fx-1' } as unknown as LayerRenderData['layer']['effects'][number]],
        colorCorrection,
        position: { x: 0.25, y: -0.5, z: 2 },
        scale: { x: 1.5, y: 1.25, z: 0.75 },
        rotation: { x: 0, y: 0, z: 0 },
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:nested-splat',
          gaussianSplatFileName: 'nested.ply',
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: true,
            },
          },
          mediaTime: 1.5,
        },
      } as unknown as LayerRenderData,
      isVideo: false,
      externalTexture: null,
      textureView: null,
      sourceWidth: 1920,
      sourceHeight: 1080,
    }];
    const expectedCamera = resolveRenderableSharedSceneCamera(
      { width: 1280, height: 720 },
      2,
      {
        clips: sceneClips as unknown as TimelineClip[],
        tracks: sceneTracks as unknown as TimelineTrack[],
        clipKeyframes: new Map(),
        compositionId: 'nested-comp',
        sceneNavClipId: null,
      },
    );

    renderer.process3DLayersForNested(
      layerData,
      1280,
      720,
      2,
      'nested-comp',
      sceneClips as unknown as TimelineClip[],
      sceneTracks as unknown as TimelineTrack[],
    );

    expect(mockNativeSceneRenderer.renderScene).toHaveBeenCalledTimes(1);
    const [deviceArg, layers3D, camera, effectors, isRealtimePlayback] =
      mockNativeSceneRenderer.renderScene.mock.calls[0];
    expect(deviceArg).toEqual({});
    expect(layers3D).toHaveLength(1);
    expect(layers3D[0]).toMatchObject({
      kind: 'splat',
      layerId: 'nested-splat-layer',
      clipId: 'nested-splat-clip',
    });
    expect(camera).toMatchObject({
      cameraPosition: expectedCamera.cameraPosition,
      cameraTarget: expectedCamera.cameraTarget,
      fov: expectedCamera.fov,
      near: expectedCamera.near,
      far: expectedCamera.far,
      viewport: expectedCamera.viewport,
    });
    expect(effectors).toHaveLength(1);
    expect(effectors[0]).toMatchObject({
      clipId: 'nested-effector',
      mode: 'swirl',
      strength: 45,
    });
    expect(isRealtimePlayback).toBe(false);

    expect(layerData).toHaveLength(1);
    expect(layerData[0]).toMatchObject({
      textureView: { label: 'nested-shared-scene-view' },
      sourceWidth: 1280,
      sourceHeight: 720,
    });
    expect(layerData[0]?.layer).toMatchObject({
      id: '__scene_3d_nested__',
      opacity: 0.8,
      blendMode: 'screen',
    });
    expect(layerData[0]?.layer.colorCorrection).toBe(colorCorrection);
  });

  it('uses a renderable default camera for nested 3D video planes without a scene camera', () => {
    const renderer = createRenderer();
    useMediaStore.setState({
      activeCompositionId: null,
      compositions: [],
    });
    useTimelineStore.setState({
      isPlaying: false,
      isExporting: false,
      clipKeyframes: new Map(),
      tracks: [],
      clips: [],
    });

    const layerData: LayerRenderData[] = [{
      layer: {
        id: 'nested-video-plane',
        name: 'Nested Video Plane',
        sourceClipId: 'nested-video-plane-clip',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        is3D: true,
        source: {
          type: 'video',
          videoElement: {
            readyState: 4,
            videoWidth: 1920,
            videoHeight: 1080,
          },
        },
      } as unknown as LayerRenderData,
      isVideo: true,
      externalTexture: null,
      textureView: { label: 'nested-plane-view' } as unknown as LayerRenderData,
      sourceWidth: 1920,
      sourceHeight: 1080,
    }];

    renderer.process3DLayersForNested(
      layerData,
      1280,
      720,
      0,
      'nested-comp',
      [],
      [],
    );

    expect(mockNativeSceneRenderer.renderScene).toHaveBeenCalledTimes(1);
    const [, layers3D, camera] = mockNativeSceneRenderer.renderScene.mock.calls[0];
    const defaultDistance = getSharedSceneDefaultCameraDistance(50);
    expect(layers3D).toHaveLength(1);
    expect(layers3D[0]).toMatchObject({
      kind: 'plane',
      layerId: 'nested-video-plane',
      clipId: 'nested-video-plane-clip',
    });
    expect(camera.cameraPosition).toEqual({ x: 0, y: 0, z: defaultDistance });
    expect(camera.cameraTarget).toEqual({ x: 0, y: 0, z: 0 });
    expect(camera.viewMatrix[14]).toBeCloseTo(-defaultDistance);
    expect(layerData[0]?.textureView).toEqual({ label: 'nested-shared-scene-view' });
  });
});
