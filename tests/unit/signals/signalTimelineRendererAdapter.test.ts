import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGNAL_SCHEMA_VERSION, type SignalArtifactStorageKind, type SignalKind } from '../../../src/signals';
import type { SignalAssetItem } from '../../../src/stores/mediaStore';

const artifactMocks = vi.hoisted(() => ({
  getProjectHandle: vi.fn(),
  getArtifact: vi.fn(),
  getIndexedDBArtifact: vi.fn(),
}));

vi.mock('../../../src/services/projectFileService', () => ({
  projectFileService: {
    getProjectHandle: artifactMocks.getProjectHandle,
  },
}));

vi.mock('../../../src/services/project/domains/ArtifactService', () => ({
  artifactService: {
    getArtifact: artifactMocks.getArtifact,
    getIndexedDBArtifact: artifactMocks.getIndexedDBArtifact,
  },
}));

import {
  createSignalTimelineAdapterPlan,
  materializeSignalTimelineRenderFile,
  placeSignalAssetOnTimeline,
  SIGNAL_GAUSSIAN_SPLAT_RENDERER_ADAPTER_ID,
  SIGNAL_MODEL_RENDERER_ADAPTER_ID,
} from '../../../src/runtime/renderers/signalTimelineRendererAdapter';

function makeSignalAssetItem(options: {
  id?: string;
  name?: string;
  kind: SignalKind;
  fileName: string;
  mimeType: string;
  encoding?: 'raw' | 'mesh-buffer';
  storageKind?: SignalArtifactStorageKind;
}): SignalAssetItem {
  const now = '2026-05-24T00:00:00.000Z';
  const assetId = options.id ?? 'signal-renderable';
  const artifactId = `${assetId}:artifact`;
  const artifact = {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    artifactId,
    hash: 'abc123',
    size: 8,
    mimeType: options.mimeType,
    encoding: options.encoding ?? 'raw',
    storage: { kind: options.storageKind ?? 'indexeddb' },
    producer: { providerId: 'test-provider' },
    sourceRefs: [`${assetId}:${options.kind}`],
    createdAt: now,
    metadata: {
      fileName: options.fileName,
    },
  } as const;

  return {
    id: assetId,
    name: options.name ?? options.fileName,
    type: 'signal',
    parentId: null,
    createdAt: Date.parse(now),
    asset: {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      id: assetId,
      name: options.name ?? options.fileName,
      source: {
        kind: 'file',
        fileName: options.fileName,
        extension: options.fileName.split('.').pop(),
        mimeType: options.mimeType,
        size: 8,
      },
      refs: [{
        schemaVersion: SIGNAL_SCHEMA_VERSION,
        id: `${assetId}:${options.kind}`,
        kind: options.kind,
        artifactId,
        mimeType: options.mimeType,
        createdAt: now,
      }],
      artifacts: [artifact],
      createdAt: now,
    },
    artifacts: [artifact],
    signalKinds: [options.kind],
    fileSize: 8,
  };
}

describe('signalTimelineRendererAdapter', () => {
  beforeEach(() => {
    artifactMocks.getProjectHandle.mockReturnValue(null);
    artifactMocks.getArtifact.mockReset();
    artifactMocks.getIndexedDBArtifact.mockReset();
  });

  it('selects the real model renderer for mesh artifacts with model files', () => {
    const item = makeSignalAssetItem({
      kind: 'mesh',
      fileName: 'hero.glb',
      mimeType: 'model/gltf-binary',
      encoding: 'mesh-buffer',
    });

    const plan = createSignalTimelineAdapterPlan(item);

    expect(plan).toMatchObject({
      kind: 'file',
      adapterId: SIGNAL_MODEL_RENDERER_ADAPTER_ID,
      mediaTypeOverride: 'model',
      duration: 10,
      fileName: 'hero.glb',
      signalRefId: 'signal-renderable:mesh',
    });
  });

  it('selects the gaussian-splat renderer for point-cloud artifacts with splat files', () => {
    const item = makeSignalAssetItem({
      kind: 'point-cloud',
      fileName: 'scan.ply',
      mimeType: 'application/octet-stream',
    });

    const plan = createSignalTimelineAdapterPlan(item);

    expect(plan).toMatchObject({
      kind: 'file',
      adapterId: SIGNAL_GAUSSIAN_SPLAT_RENDERER_ADAPTER_ID,
      mediaTypeOverride: 'gaussian-splat',
      duration: 30,
      fileName: 'scan.ply',
    });
  });

  it('routes geometry refs with splat artifacts to the gaussian-splat renderer', () => {
    const item = makeSignalAssetItem({
      kind: 'geometry',
      fileName: 'capture.ksplat',
      mimeType: 'application/octet-stream',
    });

    const plan = createSignalTimelineAdapterPlan(item);

    expect(plan).toMatchObject({
      kind: 'file',
      adapterId: SIGNAL_GAUSSIAN_SPLAT_RENDERER_ADAPTER_ID,
      mediaTypeOverride: 'gaussian-splat',
      fileName: 'capture.ksplat',
    });
  });

  it('falls back to text for non-renderable signal assets', () => {
    const item = makeSignalAssetItem({
      kind: 'table',
      fileName: 'scores.csv',
      mimeType: 'text/csv',
    });

    const plan = createSignalTimelineAdapterPlan(item);

    expect(plan.kind).toBe('text');
    expect(plan.adapterId).toBe('masterselects.renderer.signal-text-summary');
  });

  it('materializes persisted render artifacts as Files', async () => {
    const item = makeSignalAssetItem({
      kind: 'mesh',
      fileName: 'hero.glb',
      mimeType: 'model/gltf-binary',
      encoding: 'mesh-buffer',
    });
    artifactMocks.getIndexedDBArtifact.mockResolvedValue({
      manifest: item.artifacts[0],
      blob: new Blob(['glb-data'], { type: 'model/gltf-binary' }),
    });

    const plan = createSignalTimelineAdapterPlan(item);
    const file = await materializeSignalTimelineRenderFile(item, plan);

    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe('hero.glb');
    expect(file?.type).toBe('model/gltf-binary');
    expect(file?.size).toBe(8);
  });

  it('places renderable mesh signals through addClip with signal provenance', async () => {
    const item = makeSignalAssetItem({
      kind: 'mesh',
      fileName: 'hero.glb',
      mimeType: 'model/gltf-binary',
      encoding: 'mesh-buffer',
    });
    artifactMocks.getIndexedDBArtifact.mockResolvedValue({
      manifest: item.artifacts[0],
      blob: new Blob(['glb-data'], { type: 'model/gltf-binary' }),
    });
    const actions = {
      addClip: vi.fn(async () => 'clip-3d'),
      addTextClip: vi.fn(),
      updateTextProperties: vi.fn(),
      updateClip: vi.fn(),
    };

    const result = await placeSignalAssetOnTimeline(item, 'track-v1', 2, actions);

    expect(result.clipId).toBe('clip-3d');
    expect(result.plan.kind).toBe('file');
    expect(actions.addClip).toHaveBeenCalledWith(
      'track-v1',
      expect.any(File),
      2,
      10,
      undefined,
      'model',
      expect.objectContaining({
        signalAssetId: item.id,
        signalRefId: 'signal-renderable:mesh',
        signalRenderAdapterId: SIGNAL_MODEL_RENDERER_ADAPTER_ID,
        source: expect.objectContaining({ modelFileName: 'hero.glb' }),
      }),
    );
    expect(actions.addTextClip).not.toHaveBeenCalled();
  });

  it('uses text fallback when render artifacts are not materializable', async () => {
    const item = makeSignalAssetItem({
      kind: 'mesh',
      fileName: 'hero.glb',
      mimeType: 'model/gltf-binary',
      encoding: 'mesh-buffer',
      storageKind: 'memory',
    });
    artifactMocks.getIndexedDBArtifact.mockResolvedValue(null);
    const actions = {
      addClip: vi.fn(),
      addTextClip: vi.fn(async () => 'clip-text'),
      updateTextProperties: vi.fn(),
      updateClip: vi.fn(),
    };

    const result = await placeSignalAssetOnTimeline(item, 'track-v1', 0, actions);

    expect(result.clipId).toBe('clip-text');
    expect(result.fallbackReason).toContain('not available');
    expect(actions.addClip).not.toHaveBeenCalled();
    expect(actions.updateTextProperties).toHaveBeenCalledWith('clip-text', expect.objectContaining({
      text: expect.stringContaining('hero.glb'),
    }));
    expect(actions.updateClip).toHaveBeenCalledWith('clip-text', expect.objectContaining({
      signalAssetId: item.id,
      signalRenderAdapterId: 'masterselects.renderer.signal-text-summary',
    }));
  });
});
