import { describe, expect, it, vi } from 'vitest';
import { captureComputeImageOutputPreviews, computeImageOperatorValuePreview } from '../../src/services/nodePreview/computeImageOperatorPreviews';
import { createDefaultVoronoiGraph } from '../../src/services/operators/voronoiEffectGraph';
import type { Effect } from '../../src/types/effects';
import type { PreviewRequest } from '../../src/services/nodePreview/previewTypes';
import { createMockClip } from '../helpers/mockData';
import { nodePreviewTextureTap } from '../../src/services/nodePreview/NodePreviewTextureTap';
import { imageOperatorPreviewStage } from '../../src/services/nodePreview/imageOperatorPreviewStages';

const effect: Effect = { id: 'voronoi-preview', type: 'voronoi', name: 'Voronoi', enabled: true,
  params: { amount: .37 }, operatorGraph: createDefaultVoronoiGraph() };
const clip = createMockClip({ id: 'voronoi-clip', effects: [effect] });
const request = (nodeId: string, operator: string, portId: string, direction: 'input' | 'output', type: string): PreviewRequest => ({
  key: `${nodeId}:${portId}`, revision: 'r1', clipId: clip.id, time: 0, width: 320, height: 180, interval: 100, priority: 1,
  node: { id: nodeId, label: nodeId, kind: 'effect', runtime: 'builtin', layout: { x: 0, y: 0 }, inputs: [], outputs: [],
    binding: { kind: 'effect-operator', effectId: effect.id, nodeId, operator } },
  port: { id: portId, label: portId, direction, type: type as never, metadata: { semanticKind: `operator:${type}` } },
});

describe('compute image operator previews', () => {
  it('presents nearest-seed records as a textual field diagnostic rather than color', () => {
    const preview = computeImageOperatorValuePreview(request('jump-flood', 'geometry.jump-flood', 'field', 'output', 'nearest-seed-field'), clip, effect);
    expect(preview).toMatchObject({ label: 'Nearest-seed field', presentation: 'text', drawing: { kind: 'text', lines: [
      'XY: nearest seed pixel', 'Z > 0: valid; otherwise empty', 'W: reserved',
    ] } });
    expect(preview?.bitmap).toBeUndefined();
  });

  it('evaluates a bound numeric port from owner parameters without field fallbacks', () => {
    const preview = computeImageOperatorValuePreview(request('amount', 'values.number', 'value', 'output', 'number'), clip, effect);
    expect(preview).toMatchObject({ label: 'Live values', drawing: { kind: 'number', value: '0.37' } });
    expect(preview?.values).toContainEqual({ portId: 'value', direction: 'output', value: .37 });
  });

  it('does not present a raw field read as an RGBA color', () => {
    expect(computeImageOperatorValuePreview(request('current-seed', 'field.read-nearest-seed', 'value', 'output', 'vec4'), clip, effect))
      .toMatchObject({ presentation: 'text', label: 'Nearest-seed field' });
  });

  it('captures image.output from the already rendered compute result', () => {
    const outputStage = imageOperatorPreviewStage({ effectId: effect.id, nodeId: 'output', portId: 'image', direction: 'input' });
    const intermediateStage = imageOperatorPreviewStage({ effectId: effect.id, nodeId: 'combined', portId: 'image', direction: 'output' });
    const matching = vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([
      { stage: outputStage, request: {} as never }, { stage: intermediateStage, request: {} as never },
    ]);
    const capture = vi.spyOn(nodePreviewTextureTap, 'capture').mockImplementation(() => {});
    const view = { final: true } as unknown as GPUTextureView;
    expect(captureComputeImageOutputPreviews({ effect, device: {} as GPUDevice, encoder: {} as GPUCommandEncoder,
      sampler: {} as GPUSampler, view, width: 17, height: 11 })).toBe(1);
    expect(capture).toHaveBeenCalledWith(outputStage, expect.anything(), expect.anything(), expect.anything(), view, 17, 11);
    expect(capture).toHaveBeenCalledTimes(1);
    matching.mockRestore(); capture.mockRestore();
  });
});
