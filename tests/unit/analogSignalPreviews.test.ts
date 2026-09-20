import { describe, expect, it, vi } from 'vitest';
import { analogSignalNodePreview, analogSignalPreviewProducerNode, captureAnalogSignalStagePreviews } from '../../src/services/nodePreview/analogSignalPreviews';
import { analogSignalPreviewStage, parseAnalogSignalPreviewStage } from '../../src/services/nodePreview/analogSignalPreviewStages';
import type { PreviewRequest } from '../../src/services/nodePreview/previewTypes';
import { nodePreviewTextureTap } from '../../src/services/nodePreview/NodePreviewTextureTap';
import { createDefaultAnalogSignalGraph } from '../../src/services/operators/analogSignalGraph';

describe('Analog Signal node preview demand contract', () => {
  it('round-trips encoded stage identities without retaining runtime resources', () => {
    const target = { effectId: 'analog:fx', nodeId: 'decode/2', direction: 'output' as const, portId: 'image' };
    expect(parseAnalogSignalPreviewStage(analogSignalPreviewStage(target))).toEqual(target);
    expect(parseAnalogSignalPreviewStage('analog-node:broken')).toBeUndefined();
  });

  it('reports non-image PAL and receiver outputs honestly without requesting a texture', () => {
    const request = (signal: string, portId: string): PreviewRequest => ({ key: signal, revision: '1', time: 0, clipId: 'clip',
      width: 160, height: 90, interval: 16, priority: 1,
      node: { id: 'node', operatorId: 'analog.stage', label: 'Stage', kind: 'effect', runtime: 'builtin', inputs: [], outputs: [], layout: { x: 0, y: 0 },
        binding: { kind: 'effect-operator', effectId: 'analog', nodeId: 'stage', operator: 'analog.rf-channel' } },
      port: { id: portId, label: portId, type: 'geometry', direction: 'output', metadata: { semanticKind: `operator:${signal}` } } });
    const effect = { id: 'analog', type: 'analog-signal-lab', params: {} };
    expect(analogSignalNodePreview(request('pal-signal', 'signal'), effect)).toMatchObject({ status: 'missing', label: expect.stringContaining('PAL composite') });
    expect(analogSignalNodePreview(request('receiver-lines', 'lines'), effect)).toMatchObject({ status: 'missing', label: expect.stringContaining('metadata') });
  });

  it('creates a bounded texture demand for a decoded image port', async () => {
    const stage = analogSignalPreviewStage({ effectId: 'analog', nodeId: 'decode', direction: 'output', portId: 'image' });
    const request: PreviewRequest = { key: 'decoded', revision: '1', time: 0, clipId: 'clip', width: 160, height: 90, interval: 16, priority: 1,
      node: { id: 'decode', operatorId: 'analog.pal-decode', label: 'PAL Decode', kind: 'effect', runtime: 'builtin', inputs: [], outputs: [], layout: { x: 0, y: 0 },
        binding: { kind: 'effect-operator', effectId: 'analog', nodeId: 'decode', operator: 'analog.pal-decode' } },
      port: { id: 'image', label: 'Decoded Image', type: 'texture', direction: 'output', metadata: { semanticKind: 'operator:image' } } };
    const pending = analogSignalNodePreview(request, { id: 'analog', type: 'analog-signal-lab', params: {} });
    expect(nodePreviewTextureTap.has(stage)).toBe(true);
    nodePreviewTextureTap.cancelClip('clip');
    await expect(pending).resolves.toMatchObject({ status: 'missing', label: 'Preview paused' });
  });

  it('resolves the canonical clip output to the produced resolve texture, including bypass to source', async () => {
    const graph = createDefaultAnalogSignalGraph();
    const target = { effectId: 'analog', nodeId: 'output', direction: 'output' as const, portId: 'image' };
    expect(analogSignalPreviewProducerNode(graph, target)).toBe('resolve');
    graph.nodes.find(node => node.id === 'resolve')!.bypassed = true;
    expect(analogSignalPreviewProducerNode(graph, target)).toBe('frame');
    graph.nodes.find(node => node.id === 'resolve')!.bypassed = false;

    const stage = analogSignalPreviewStage(target);
    const request: PreviewRequest = { key: 'final', revision: '1', time: 0, clipId: 'clip', width: 160, height: 90, interval: 16, priority: 1,
      node: { id: 'output', operatorId: 'image.output', label: 'Image Output', kind: 'output', runtime: 'builtin', inputs: [], outputs: [], layout: { x: 0, y: 0 },
        binding: { kind: 'effect-operator', effectId: 'analog', nodeId: 'output', operator: 'image.output' } },
      port: { id: 'image', label: 'Image', type: 'texture', direction: 'output', metadata: { semanticKind: 'operator:image' } } };
    const pending = analogSignalNodePreview(request, { id: 'analog', type: 'analog-signal-lab', params: {}, operatorGraph: graph });
    const capture = vi.spyOn(nodePreviewTextureTap, 'capture').mockImplementation(() => {});
    expect(captureAnalogSignalStagePreviews({ effect: { id: 'analog', type: 'analog-signal-lab', params: {}, operatorGraph: graph }, nodeId: 'resolve', kind: 'resolve',
      device: {} as GPUDevice, encoder: {} as GPUCommandEncoder, sampler: {} as GPUSampler, view: {} as GPUTextureView, width: 1920, height: 1080 })).toBe(1);
    expect(capture).toHaveBeenCalledWith(stage, expect.anything(), expect.anything(), expect.anything(), expect.anything(), 1920, 1080);
    capture.mockRestore(); nodePreviewTextureTap.cancelClip('clip'); await pending;

    const requestTap = vi.spyOn(nodePreviewTextureTap, 'request').mockResolvedValue({ key: 'final', revision: '1', time: 0,
      status: 'live', label: 'Rendered output' });
    await expect(analogSignalNodePreview(request, { id: 'analog', type: 'analog-signal-lab', params: {}, operatorGraph: graph }))
      .resolves.toMatchObject({ status: 'live', label: 'Final Analog Signal output' });
    expect(requestTap).toHaveBeenCalledWith(stage, request); requestTap.mockRestore();
  });
});
