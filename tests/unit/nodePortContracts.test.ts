import { describe, expect, it } from 'vitest';
import { EFFECT_OPERATORS, getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { getOperatorPortContract, operatorPortsCompatible } from '../../src/services/operators/portContracts';
import { projectOperatorPort } from '../../src/services/nodeGraph/effectGraphProjection';
import { describeNodePort, describePortText } from '../../src/services/nodeGraph/nodePortPresentation';
import { canConnectPortReferences, createPortReference } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { connectEffectGraph, validateEffectGraph } from '../../src/services/operators/effectGraph';
import { defaultCableOperatorGraph } from '../../src/services/faceCables/cableOperatorGraph';
import { foldOperatorGroups } from '../../src/services/nodeGraph/nestedOperatorGroups';
import type { NodeGraph } from '../../src/types/nodeGraph';

const input = (id: string, port: string) => getEffectOperator(id)!.inputs.find(p => p.id === port)!;
const output = (id: string, port: string) => getEffectOperator(id)!.outputs.find(p => p.id === port)!;

describe('typed node port contracts', () => {
  it('declares readable contracts for every operator port', () => {
    for (const operator of EFFECT_OPERATORS) for (const port of [...operator.inputs, ...operator.outputs]) {
      const contract = getOperatorPortContract(port);
      expect(contract.typeLabel).toBeTruthy(); expect(contract.description).toBeTruthy();
      expect(contract.formats.length).toBeGreaterThan(0);
    }
  });
  it('distinguishes signal types hidden by the coarse canvas geometry/texture types', () => {
    const uv = projectOperatorPort(output('texture.uv', 'uv'), 'output');
    const material = projectOperatorPort(output('material.surface', 'material'), 'output');
    const depth = projectOperatorPort(output('depth.estimate', 'depth'), 'output');
    expect(uv.type).toBe('geometry'); expect(describeNodePort(uv).typeLabel).toBe('UV');
    expect(describeNodePort(material).typeLabel).toBe('Material');
    expect(depth.type).toBe('texture'); expect(describeNodePort(depth).typeLabel).toBe('Depth');
    expect(describePortText(depth)).toContain('Relative inverse depth');
  });
  it('rejects a face mesh at the background inlet but accepts reconstructed depth', () => {
    const background = input('geometry.merge-surface', 'background');
    const face = output('geometry.face', 'geometry'), depth = output('geometry.depth', 'geometry');
    expect(operatorPortsCompatible(face, background)).toBe(false);
    expect(operatorPortsCompatible(depth, background)).toBe(true);
    const target = createPortReference('stitch', projectOperatorPort(background, 'input'));
    expect(canConnectPortReferences(createPortReference('face', projectOperatorPort(face, 'output')), target)).toBe(false);
    expect(canConnectPortReferences(target, createPortReference('depth', projectOperatorPort(depth, 'output')))).toBe(true);
  });
  it('requires calibration before depth reconstruction, in UI and persisted graph validation', () => {
    const mesh = input('geometry.depth', 'depth');
    expect(operatorPortsCompatible(output('depth.estimate', 'depth'), mesh)).toBe(false);
    expect(operatorPortsCompatible(output('depth.calibrate', 'depth'), mesh)).toBe(true);
    const graph = defaultCableOperatorGraph();
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(() => connectEffectGraph(graph, { id: 'bad-depth', from: 'depth', output: 'depth', to: 'depth-mesh', input: 'depth' })).toThrow('Invalid connection');
    expect(validateEffectGraph(graph)).toEqual([]);
  });
  it('preserves format restrictions on collapsed boundary ports', () => {
    const port = projectOperatorPort(input('geometry.merge-surface', 'background'), 'input');
    const graph: NodeGraph = { id: 'test', owner: { kind: 'clip', id: 'clip', name: 'Test' }, edges: [],
      nodes: [{ id: 'stitch', label: 'Stitch Surfaces', kind: 'effect', runtime: 'builtin', inputs: [port], outputs: [], layout: { x: 0, y: 0 } }],
      groups: [{ id: 'outer', label: 'Outer', color: '#fff', nodeIds: ['stitch'], proxyId: 'outer-proxy' },
        { id: 'inner', label: 'Inner', color: '#fff', nodeIds: ['stitch'], parentId: 'outer', proxyId: 'inner-proxy' }] };
    const folded = foldOperatorGroups(graph, { version: 1, nodes: [], groups: { inner: { collapsed: true } } });
    const boundary = folded.nodes[0].inputs[0];
    expect(boundary.metadata?.contract?.formats).toEqual(['depth-mesh']);
    expect(boundary.metadata?.groupEndpoint).toEqual({ nodeId: 'stitch', portId: 'background' });
    expect(describePortText(boundary)).toContain('same source UV and coordinate space');
  });
  it('retains distinct Flock signals and generic clip ports', () => {
    const port = { type: 'geometry', metadata: { semanticKind: 'flock:behavior' } };
    expect(describeNodePort(port).typeLabel).toBe('Behavior');
    expect(describeNodePort(port).formatLabels).toContain('Particle behavior / force configuration');
    expect(describeNodePort({ type: 'audio' }).typeLabel).toBe('Audio');
  });
});
