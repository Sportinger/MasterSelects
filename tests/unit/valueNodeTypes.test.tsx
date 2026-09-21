import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultUvDistortGraph } from '../../src/services/operators/uvDistortEffectGraphs';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { imageOperatorValuePreview } from '../../src/services/nodePreview/imageOperatorPreviews';
import { setOperatorVariant } from '../../src/services/operators/effectGraphEditing';
import { OperatorParameters } from '../../src/components/panels/nodes/workspace/OperatorParameters';
import { NodeGraphNodeCard } from '../../src/components/panels/nodes/canvas/NodeGraphNodeCard';
import { NodeGraphGroups } from '../../src/components/panels/nodes/canvas/NodeGraphGroups';
import { buildCanvasScene } from '../../src/components/panels/nodes/canvas/rendering/buildCanvasScene';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { Keyframe } from '../../src/types/keyframes';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initial); });
const cardProps = { selectedNodeId: null, connectionDraft: null, onSelectNode: vi.fn(), onStartNodeDrag: vi.fn(),
  onNodePointerMove: vi.fn(), onFinishNodeDrag: vi.fn(), onStartConnectionDrag: vi.fn(), onDisconnectPortEdges: vi.fn() };

describe('typed Value nodes and collapsed cards', () => {
  it('truncates integer literals and animated values toward zero, while Float keeps fractions', () => {
    const graph = createDefaultUvDistortGraph('kaleidoscope');
    const literal = graph.nodes.find(node => node.id === 'tau')!;
    literal.operator = 'values.integer'; literal.constants = { value: -6.8 };
    const target = { nodeId: 'tau', portId: 'value', direction: 'output' as const };
    const integer = compileImageOperatorPreview(graph, {}, target);
    expect(evaluateImageOperatorPlan(integer, [0, 0, 0, 1])[0]).toBe(-6);
    expect(integer.wgsl).toContain('trunc(');
    literal.operator = 'values.number';
    expect(evaluateImageOperatorPlan(compileImageOperatorPreview(graph, {}, target), [0, 0, 0, 1])[0]).toBeCloseTo(-6.8);
    const bound = graph.nodes.find(node => node.id === 'rotation')!; bound.operator = 'values.integer';
    const clip = createMockClip({ effects: [{ id: 'k', name: 'Kaleidoscope', type: 'kaleidoscope', enabled: true, params: { segments: 6 }, operatorGraph: graph }] });
    const node = buildEffectOperatorGraph(clip, clip.effects[0]).nodes.find(node => node.id === 'rotation')!;
    const keys = [{ id: 'a', time: 0, value: -3.8, clipId: clip.id, property: 'effect.k.rotation', easing: 'linear' },
      { id: 'b', time: 1, value: -.2, clipId: clip.id, property: 'effect.k.rotation', easing: 'linear' }] as Keyframe[];
    const frame = imageOperatorValuePreview({ key: 'rotation', revision: '1', time: .25, node, clipId: clip.id, width: 164, height: 100, interval: 16, priority: 1 }, clip, clip.effects[0], keys, .25);
    expect(frame?.values?.find(value => value.direction === 'output')?.value).toBe(-2);
  });

  it('keeps type selection in the inspector and retains bindings when switching variants', () => {
    const clip = createMockClip({ effects: [{ id: 'k', name: 'Kaleidoscope', type: 'kaleidoscope', enabled: true, params: { segments: 6 }, operatorGraph: createDefaultUvDistortGraph('kaleidoscope') }] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    setOperatorVariant(clip.id, 'k', 'segments', 'values.integer');
    const saved = useTimelineStore.getState().clips[0], effect = saved.effects[0];
    expect(effect.operatorGraph?.nodes.find(node => node.id === 'segments')).toMatchObject({ operator: 'values.integer', bindings: { value: 'segments' } });
    const node = buildEffectOperatorGraph(saved, effect).nodes.find(node => node.id === 'segments')!;
    const view = render(<><NodeGraphNodeCard {...cardProps} node={node} /><OperatorParameters clip={saved} effectId="k" nodeId="segments" /></>);
    expect(view.getByLabelText('Value type').closest('.operator-parameters')).not.toBeNull();
    expect(view.container.querySelector('.node-workspace-node [aria-haspopup]')).toBeNull();
    expect(view.container.querySelector('.node-workspace-node-value')).not.toBeNull();
  });

  it('renders a collapsed group as a regular card with an accessible expansion action and no surrounding frame', () => {
    const node = connectionFixture.nodes[0], group = { id: 'g', label: node.label, collapsed: true, proxyId: node.id, nodeIds: [node.id] };
    const graph = { ...connectionFixture, groups: [group] }, toggle = vi.fn();
    const view = render(<><NodeGraphGroups graph={graph} nodes={graph.nodes} onToggle={toggle} />
      <NodeGraphNodeCard {...cardProps} node={node} collapsedGroupId="g" onToggleGroup={toggle} /></>);
    expect(view.container.querySelector('.node-workspace-group')).toBeNull();
    const expand = view.getByRole('button', { name: `Expand ${node.label} group` });
    expand.focus(); fireEvent.click(expand, { detail: 1 });
    expect(expand).not.toHaveFocus(); expect(toggle).toHaveBeenCalledExactlyOnceWith('g');
    expand.focus(); fireEvent.click(expand, { detail: 0 }); expect(expand).toHaveFocus();
    const scene = buildCanvasScene({ graph, nodes: graph.nodes, plugs: [], selectedNodeId: null, selection: new Set(), selectedEdgeId: null,
      hoveredEdgeId: null, hoveredPort: null, draft: null, clips: [], keyframes: new Map(), sourceTime: () => 0 });
    expect(scene.groups).toHaveLength(0); expect(scene.nodes.find(item => item.id === node.id)?.expandable).toBe(true);
  });
});
