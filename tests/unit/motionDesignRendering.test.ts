import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClipTransform, Keyframe, TimelineClip } from '../../src/types';
import {
  createDefaultMotionLayerDefinition,
  createLinearGradientAppearance,
  createRadialGradientAppearance,
  createStrokeAppearance,
} from '../../src/types/motionDesign';
import {
  MOTION_PATH_PARAMS_OFFSET,
  MOTION_UNIFORM_BYTE_SIZE,
  createMotionInstanceArray,
  createMotionUniformArray,
} from '../../src/engine/motion/MotionBuffers';
import { MotionPathBufferState } from '../../src/engine/motion/pathBufferState';
import { flattenMotionPath } from '../../src/services/motionDesign/path/flattenPath';
import {
  buildMotionTimelineDiagnostics,
  getMotionRendererDiagnostics,
  resetMotionRendererDiagnostics,
} from '../../src/engine/motion/MotionDiagnostics';
import { MotionRenderer } from '../../src/engine/motion/MotionRenderer';
import { getMotionRenderSize } from '../../src/engine/motion/MotionTypes';
import {
  createMotionFrameRuntimeAdmission,
  getMotionRenderSizeForAdmission,
} from '../../src/engine/motion/MotionFrameRuntime';
import { getInterpolatedMotionLayer } from '../../src/utils/motionInterpolation';
import { createTestTimelineStore } from '../helpers/storeFactory';

function makeTransform(): ClipTransform {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function makeMotionClip(motion = createDefaultMotionLayerDefinition('shape')): TimelineClip {
  return {
    id: 'motion-clip',
    trackId: 'video-1',
    name: 'Motion',
    file: new File([], 'motion.msmotion'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'motion-shape', naturalDuration: 5 },
    motion,
    transform: makeTransform(),
    effects: [],
    isLoading: false,
  };
}

function makeMotionLayer(motion = createDefaultMotionLayerDefinition('shape')) {
  return {
    id: 'preview-layer',
    sourceClipId: 'motion-clip',
    visible: true,
    opacity: 1,
    source: { type: 'motion' as const, motion },
  } as unknown as import('../../src/types').Layer;
}

describe('motion design rendering helpers', () => {
  afterEach(() => {
    resetMotionRendererDiagnostics();
    vi.unstubAllGlobals();
  });

  it('sizes motion render targets with outside stroke padding', () => {
    const motion = createDefaultMotionLayerDefinition('shape', {
      size: { w: 100, h: 50 },
    });
    motion.appearance?.items.push({
      ...createStrokeAppearance({ r: 1, g: 0, b: 0, a: 1 }),
      visible: true,
      width: 12,
      alignment: 'outside',
    });

    expect(getMotionRenderSize(motion)).toMatchObject({
      width: 124,
      height: 74,
      strokePadding: 12,
    });
  });

  it('packs shape, fill, and stroke values into renderer uniforms', () => {
    const motion = createDefaultMotionLayerDefinition('shape', {
      primitive: 'ellipse',
      size: { w: 100, h: 50 },
      fillColor: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
    });
    motion.appearance?.items.push({
      ...createStrokeAppearance({ r: 1, g: 0, b: 0, a: 1 }),
      visible: true,
      width: 8,
      alignment: 'center',
    });

    const uniforms = createMotionUniformArray(motion, getMotionRenderSize(motion));

    expect(Array.from(uniforms.slice(0, 7))).toEqual([100, 50, 108, 58, 0, 1, 2]);
    expect(Array.from(uniforms.slice(112, 116))).toEqual([0.25, 0.5, 0.75, 1]);
    expect(Array.from(uniforms.slice(52, 55))).toEqual([8, 0, 0]);
    expect(Array.from(uniforms.slice(116, 120))).toEqual([1, 0, 0, 1]);
  });

  it('packs polygon/star geometry and ordered gradient appearances', () => {
    const motion = createDefaultMotionLayerDefinition('shape', {
      primitive: 'star',
      size: { w: 240, h: 240 },
    });
    motion.shape!.star = {
      points: 7,
      outerRadius: 110,
      innerRadius: 46,
      cornerRadius: 6,
    };
    const linear = createLinearGradientAppearance([
      { r: 1, g: 0, b: 0, a: 1 },
      { r: 0, g: 0, b: 1, a: 1 },
    ]);
    const radial = createRadialGradientAppearance([
      { r: 1, g: 1, b: 1, a: 1 },
      { r: 0, g: 0, b: 0, a: 0 },
    ]);
    radial.blendMode = 'screen';
    motion.appearance!.items = [linear, radial];

    const uniforms = createMotionUniformArray(motion, getMotionRenderSize(motion));

    expect(Array.from(uniforms.slice(4, 7))).toEqual([0, 3, 2]);
    expect(Array.from(uniforms.slice(11, 15))).toEqual([7, 110, 46, 6]);
    expect(Array.from(uniforms.slice(16, 24))).toEqual([
      2, 1, 1, 0,
      3, 1, 1, 2,
    ]);
    expect(Array.from(uniforms.slice(48, 56))).toEqual([
      0, 0, 2, 0,
      0, 0, 2, 0.5,
    ]);
    expect(Array.from(uniforms.slice(80, 88))).toEqual([
      0, 0.5, 1, 0.5,
      0.5, 0.5, 0, 0,
    ]);
  });

  it('packs path trim/dash uniforms and flattened arc-length vertices', () => {
    const motion = createDefaultMotionLayerDefinition('shape', {
      primitive: 'path',
      size: { w: 12, h: 8 },
    });
    motion.shape!.path = {
      closed: false,
      trim: { start: 0.25, end: 0.75, offset: 0 },
      dash: { length: 10, gap: 5, offset: 0 },
      vertices: [
        {
          x: 0,
          y: 0,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 },
        },
        {
          x: 3,
          y: 4,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 },
        },
        {
          x: 6,
          y: 4,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 },
        },
      ],
    };
    const flattened = flattenMotionPath(motion.shape!.path)!;
    const uniforms = createMotionUniformArray(
      motion,
      getMotionRenderSize(motion),
      undefined,
      flattened,
    );
    const pathUpdate = new MotionPathBufferState().prepare(flattened);

    expect(uniforms[5]).toBe(4);
    expect(MOTION_PATH_PARAMS_OFFSET).toBe(464);
    expect(Array.from(uniforms.slice(
      MOTION_PATH_PARAMS_OFFSET,
      MOTION_PATH_PARAMS_OFFSET + 8,
    ))).toEqual([0.25, 0.75, 0, 10, 5, 0, 3, 0]);
    expect(Array.from(pathUpdate.data)).toEqual([
      0, 0, 0, 0,
      3, 4, 5, 0,
      6, 4, 8, 0,
    ]);
    expect(pathUpdate.needsUpload).toBe(true);
  });

  it('sizes and packs grid replicator instances for motion shapes', () => {
    const motion = createDefaultMotionLayerDefinition('shape', {
      size: { w: 100, h: 50 },
    });
    if (motion.replicator?.layout.mode === 'grid') {
      motion.replicator.enabled = true;
      motion.replicator.layout.count = { columns: 3, rows: 2 };
      motion.replicator.layout.spacing = { x: 50, y: 80 };
      motion.replicator.terminalTransform.opacity = 0.75;
    }

    const layer = makeMotionLayer(motion);
    const admission = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [layer],
    });
    const size = getMotionRenderSizeForAdmission(layer, admission);
    const instances = createMotionInstanceArray(size);

    expect(size).toMatchObject({
      width: 200,
      height: 130,
      replicator: {
        enabled: true,
        countX: 3,
        countY: 2,
        spacingX: 50,
        spacingY: 80,
        instanceCount: 6,
      },
    });
    expect(instances).toHaveLength(6 * 12);
    expect(Array.from(instances.slice(0, 12))).toEqual([
      1, 0, 0, 1,
      -50, -40, 1, 0,
      -100, -65, 0, -15,
    ]);
    expect(Array.from(instances.slice(-12))).toEqual([
      1, 0, 0, 1,
      50, 40, 0.75, 1,
      0, 15, 100, 65,
    ]);
  });

  it('interpolates numeric motion properties through the property registry', () => {
    const clip = makeMotionClip(createDefaultMotionLayerDefinition('shape', {
      size: { w: 100, h: 50 },
    }));
    const keyframes: Keyframe[] = [
      {
        id: 'kf-1',
        clipId: clip.id,
        time: 0,
        property: 'shape.size.w',
        value: 100,
        easing: 'linear',
      },
      {
        id: 'kf-2',
        clipId: clip.id,
        time: 2,
        property: 'shape.size.w',
        value: 300,
        easing: 'linear',
      },
    ];

    const interpolated = getInterpolatedMotionLayer(clip, keyframes, 1);

    expect(interpolated?.shape?.size.w).toBe(200);
    expect(clip.motion?.shape?.size.w).toBe(100);
  });

  it('converts solid clips to motion rectangle clips while keeping timeline identity', () => {
    const store = createTestTimelineStore();
    const clipId = store.getState().addSolidClip('video-1', 2, '#336699', 4, true);

    expect(clipId).toBeTruthy();
    const convertedId = store.getState().convertSolidToMotionShape(clipId!);
    const converted = store.getState().clips.find((clip) => clip.id === clipId);
    const fill = converted?.motion?.appearance?.items[0];

    expect(convertedId).toBe(clipId);
    expect(converted?.source?.type).toBe('motion-shape');
    expect(converted?.startTime).toBe(2);
    expect(converted?.duration).toBe(4);
    expect(converted?.motion?.shape?.primitive).toBe('rectangle');
    expect(fill?.kind).toBe('color-fill');
    if (fill?.kind === 'color-fill') {
      expect(fill.color.r).toBeCloseTo(0.2, 3);
      expect(fill.color.g).toBeCloseTo(0.4, 3);
      expect(fill.color.b).toBeCloseTo(0.6, 3);
    }
  });

  it('adds rectangle and ellipse motion shape clips only on video tracks', () => {
    const store = createTestTimelineStore();
    const rectangleId = store.getState().addMotionShapeClip('video-1', 1, {
      primitive: 'rectangle',
      duration: 3,
      size: { w: 320, h: 180 },
      name: 'Motion Rectangle',
    });
    const ellipseId = store.getState().addMotionShapeClip('video-1', 4, {
      primitive: 'ellipse',
      duration: 2,
      name: 'Motion Ellipse',
    });
    const invalidId = store.getState().addMotionShapeClip('audio-1', 0, {
      primitive: 'rectangle',
    });

    const rectangle = store.getState().clips.find((clip) => clip.id === rectangleId);
    const ellipse = store.getState().clips.find((clip) => clip.id === ellipseId);

    expect(rectangleId).toBeTruthy();
    expect(ellipseId).toBeTruthy();
    expect(invalidId).toBeNull();
    expect(rectangle?.source?.type).toBe('motion-shape');
    expect(rectangle?.motion?.shape?.primitive).toBe('rectangle');
    expect(rectangle?.motion?.shape?.size).toEqual({ w: 320, h: 180 });
    expect(rectangle?.startTime).toBe(1);
    expect(rectangle?.duration).toBe(3);
    expect(ellipse?.name).toBe('Motion Ellipse');
    expect(ellipse?.motion?.shape?.primitive).toBe('ellipse');
    expect(store.getState().clips).toHaveLength(2);
  });

  it('deep-clones the full appearance stack when a motion clip is split', () => {
    const store = createTestTimelineStore();
    const clipId = store.getState().addMotionShapeClip('video-1', 0, {
      primitive: 'star',
      duration: 6,
    })!;
    const gradient = createLinearGradientAppearance();
    const stroke = {
      ...createStrokeAppearance({ r: 1, g: 1, b: 1, a: 1 }),
      visible: true,
      width: 10,
      alignment: 'outside' as const,
    };
    store.getState().updateMotionLayer(clipId, (motion) => ({
      ...motion,
      appearance: {
        version: 1,
        items: [gradient, stroke],
        selectedItemId: gradient.id,
      },
    }));

    store.getState().splitClip(clipId, 3);
    const split = store.getState().clips
      .filter((clip) => clip.source?.type === 'motion-shape')
      .sort((left, right) => left.startTime - right.startTime);

    expect(split).toHaveLength(2);
    expect(split[0].motion).toEqual(split[1].motion);
    expect(split[0].motion).not.toBe(split[1].motion);
    expect(split[0].motion?.appearance).not.toBe(split[1].motion?.appearance);
    expect(split[0].motion?.appearance?.items[0])
      .not.toBe(split[1].motion?.appearance?.items[0]);
    expect(split[0].motion?.replicator).not.toBe(split[1].motion?.replicator);

    store.getState().updateMotionLayer(split[0].id, (motion) => ({
      ...motion,
      appearance: motion.appearance
        ? {
            ...motion.appearance,
            items: motion.appearance.items.map((item, index) => (
              index === 0 ? { ...item, opacity: 0.2 } : item
            )),
          }
        : motion.appearance,
    }));
    expect(store.getState().clips.find((clip) => clip.id === split[1].id)
      ?.motion?.appearance?.items[0].opacity).toBe(1);
    const firstReplicator = store.getState().clips.find((clip) => clip.id === split[0].id)
      ?.motion?.replicator;
    const secondReplicator = store.getState().clips.find((clip) => clip.id === split[1].id)
      ?.motion?.replicator;
    if (firstReplicator?.layout.mode === 'grid' && secondReplicator?.layout.mode === 'grid') {
      firstReplicator.layout.spacing.x = 987;
      expect(secondReplicator.layout.spacing.x).not.toBe(987);
    }
  });

  it('reports timeline clip and effective instance counts', () => {
    const rectangle = makeMotionClip(createDefaultMotionLayerDefinition('shape'));
    const ellipse = {
      ...makeMotionClip(createDefaultMotionLayerDefinition('shape', {
        primitive: 'ellipse',
      })),
      id: 'motion-ellipse',
      startTime: 8,
    };
    const polygon = {
      ...makeMotionClip(createDefaultMotionLayerDefinition('shape', {
        primitive: 'polygon',
      })),
      id: 'motion-polygon',
      startTime: 12,
    };
    const star = {
      ...makeMotionClip(createDefaultMotionLayerDefinition('shape', {
        primitive: 'star',
      })),
      id: 'motion-star',
      startTime: 16,
    };
    if (rectangle.motion?.replicator?.layout.mode === 'grid') {
      rectangle.motion.replicator.enabled = true;
      rectangle.motion.replicator.layout.count = { columns: 3, rows: 2 };
    }

    expect(buildMotionTimelineDiagnostics([rectangle, ellipse, polygon, star], 1)).toEqual({
      totalClips: 4,
      activeClips: 1,
      renderableClips: 4,
      unsupportedClips: 0,
      rectangleClips: 1,
      ellipseClips: 1,
      polygonClips: 1,
      starClips: 1,
      replicatorClips: 1,
      effectiveInstances: 9,
      activeEffectiveInstances: 6,
    });
  });

  it('records renderer instances, buffer uploads, cache count, and encoding time', () => {
    vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
    vi.stubGlobal('GPUTextureUsage', {
      RENDER_ATTACHMENT: 1,
      TEXTURE_BINDING: 2,
      COPY_SRC: 4,
    });
    vi.stubGlobal('GPUBufferUsage', {
      UNIFORM: 1,
      VERTEX: 2,
      COPY_DST: 4,
      STORAGE: 8,
    });

    const texture = {
      createView: vi.fn(() => ({ kind: 'view' })),
      destroy: vi.fn(),
    };
    const uniformBuffer = { kind: 'uniform', destroy: vi.fn() };
    const instanceBuffer = { kind: 'instances', destroy: vi.fn() };
    const writeBuffer = vi.fn();
    const device = {
      queue: { writeBuffer },
      createBindGroupLayout: vi.fn(() => ({ kind: 'layout' })),
      createShaderModule: vi.fn(() => ({ kind: 'shader' })),
      createPipelineLayout: vi.fn(() => ({ kind: 'pipeline-layout' })),
      createRenderPipeline: vi.fn(() => ({ kind: 'pipeline' })),
      createTexture: vi.fn(() => texture),
      createBuffer: vi.fn((descriptor: { label?: string }) => (
        descriptor.label?.includes('instances') ? instanceBuffer : uniformBuffer
      )),
      createBindGroup: vi.fn(() => ({ kind: 'bind-group' })),
    } as unknown as GPUDevice;
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    };
    const commandEncoder = {
      beginRenderPass: vi.fn(() => pass),
    } as unknown as GPUCommandEncoder;
    const motion = createDefaultMotionLayerDefinition('shape');
    if (motion.replicator?.layout.mode === 'grid') {
      motion.replicator.enabled = true;
      motion.replicator.layout.count = { columns: 3, rows: 2 };
    }
    const renderer = new MotionRenderer(device);

    const layer = makeMotionLayer(motion);
    const admission = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [layer],
    });

    renderer.renderLayer(layer, commandEncoder, admission);

    expect(writeBuffer).toHaveBeenCalledTimes(2);
    expect(pass.draw).toHaveBeenCalledWith(6, 6);
    expect(getMotionRendererDiagnostics()).toMatchObject({
      renderCalls: 1,
      cacheCount: 1,
      bufferUploads: 2,
      bufferUploadBytes: MOTION_UNIFORM_BYTE_SIZE + 6 * 12 * 4,
      totalInstances: 6,
      lastInstanceCount: 6,
      peakInstanceCount: 6,
      lastLayerId: 'preview-layer',
      lastSourceClipId: 'motion-clip',
    });
    expect(getMotionRendererDiagnostics().lastEncodeTimeMs).toBeGreaterThanOrEqual(0);

    renderer.destroy();
    expect(getMotionRendererDiagnostics().cacheCount).toBe(0);
  });
});
