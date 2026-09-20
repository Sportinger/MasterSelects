import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flockPreview } from '../../src/services/nodePreview/flockPreviews';
import { flockRuntime } from '../../src/engine/flock/runtime/flockRuntimeApi';
import { nodePreviewTextureTap } from '../../src/services/nodePreview/NodePreviewTextureTap';
import { createMockClip } from '../helpers/mockData';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { compileFlockDefinitionCached } from '../../src/services/flock/compiler/flockCompiler';
import { buildClipFlockNodeGraph } from '../../src/services/nodeGraph/clipGraphFlockProjection';
import type { PreviewRequest } from '../../src/services/nodePreview/previewTypes';

vi.mock('../../src/engine/flock/runtime/flockAudioSampler', () => ({ createFlockAudioSampler: vi.fn(() => () => null) }));
vi.mock('../../src/engine/flock/runtime/flockRuntimeApi', () => ({ flockRuntime: { getStatus: vi.fn(), sampleParticles: vi.fn() } }));
vi.mock('../../src/services/nodePreview/NodePreviewTextureTap', () => ({ nodePreviewTextureTap: { request: vi.fn() } }));

function fixture(operator: string, semantic?: string) {
  const clip = createMockClip({ id: 'flock-preview', source: { type: 'flock' }, flock: createFlockPresetDefinition('free-swarm') });
  const graph = buildClipFlockNodeGraph(clip)!;
  const node = graph.nodes.find(node => node.binding?.kind === 'flock-node' && node.binding.operator === operator)!;
  const port = [...node.outputs, ...node.inputs].find(port => !semantic || port.metadata?.semanticKind === semantic)!;
  const request: PreviewRequest = { key: 'preview', revision: 'revision', clipId: clip.id, node, port, time: 1, width: 128, height: 80, interval: 100, priority: 1 };
  const compilation = compileFlockDefinitionCached(clip.flock!);
  if (!compilation.ok) throw new Error('Invalid fixture');
  return { clip, request, program: compilation.program };
}

describe('Flock in the shared node preview pipeline', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads a bounded particle sample and marks old simulation data stale', async () => {
    const { clip, request, program } = fixture('flock.simulation', 'flock:particles');
    vi.mocked(flockRuntime.getStatus).mockReturnValue({ hashes: program.hashes, cache: { current: true } } as never);
    vi.mocked(flockRuntime.sampleParticles).mockResolvedValue({ clipId: clip.id, count: 2, step: 60, sourceTime: 1,
      values: [1, 2, 3, 0, 0, 0, 1, 0, 4, 5, 6, 0, 0, 0, -1, 0] });
    expect(await flockPreview(request, clip, 1, [])).toMatchObject({ status: 'live', drawing: { kind: 'points', points: [1, 2, 3] } });
    expect(flockRuntime.sampleParticles).toHaveBeenCalledWith(clip.id, 128);
    expect(await flockPreview(request, clip, 3, [])).toMatchObject({ status: 'stale', label: 'Last simulated particles' });
  });
  it('does not request samples from a simulation of a different graph', async () => {
    const { clip, request } = fixture('flock.simulation', 'flock:particles');
    vi.mocked(flockRuntime.getStatus).mockReturnValue({ hashes: { topology: 'old', behavior: 'old' } } as never);
    expect(await flockPreview(request, clip, 1, [])).toMatchObject({ status: 'missing' });
    expect(flockRuntime.sampleParticles).not.toHaveBeenCalled();
  });
  it('labels a shared scene image honestly instead of presenting it as a branch render', async () => {
    const { clip, request } = fixture('flock.output', 'flock:scene');
    vi.mocked(nodePreviewTextureTap.request).mockResolvedValue({ key: request.key, revision: request.revision, time: 1, status: 'live', label: 'Scene' });
    expect(await flockPreview(request, clip, 1, [])).toMatchObject({ status: 'live', label: 'Shared Flock scene' });
    expect(nodePreviewTextureTap.request).toHaveBeenCalledWith(`scene:${clip.id}`, request);
  });
  it('does not render an invalid draft or a bypassed node', async () => {
    const { clip, request } = fixture('flock.simulation', 'flock:particles');
    clip.flock = { ...clip.flock!, edges: [] };
    expect(await flockPreview(request, clip, 1, [])).toMatchObject({ status: 'missing' });
    expect(flockRuntime.sampleParticles).not.toHaveBeenCalled();
    const fresh = fixture('flock.simulation', 'flock:particles');
    fresh.clip.flock!.nodes.find(node => node.operator === 'flock.simulation')!.bypassed = true;
    expect(await flockPreview(fresh.request, fresh.clip, 1, [])).toMatchObject({ label: 'Node bypassed' });
  });
  it('previews unified boundary ports and explains structural nodes without false disconnection errors', async () => {
    const { clip, request } = fixture('flock.output');
    request.port = { id: 'group-out-time', label: 'Clip output', type: 'time', direction: 'output' };
    expect(await flockPreview(request, clip, 1.25, [])).toMatchObject({ label: 'Source time', drawing: { lines: ['1.250 s'] } });
    request.port.type = 'geometry';
    vi.mocked(nodePreviewTextureTap.request).mockResolvedValue({ key: request.key, revision: request.revision, time: 1, status: 'live', label: 'Scene' });
    expect(await flockPreview(request, clip, 1, [])).toMatchObject({ label: 'Shared Flock scene' });
    const compose = fixture('flock.compose');
    expect(await flockPreview(compose.request, compose.clip, 1, [])).toMatchObject({ label: 'Combined behavior; inspect its connected inputs' });
  });
});
