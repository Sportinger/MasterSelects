import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { NodeValuePreview } from '../../src/components/panels/nodes/previews/NodeValuePreview';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { imageOperatorValuePreview } from '../../src/services/nodePreview/imageOperatorPreviews';
import { previewTextStore } from '../../src/services/nodePreview/previewTextStore';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import type { Effect } from '../../src/types/effects';
import { createMockClip } from '../helpers/mockData';

const owner = {};
afterEach(() => {
  cleanup();
  previewTextStore.retain(owner, new Set());
  delete getEffect('invert')!.params.previewChoice;
});

describe('image choice node preview', () => {
  it('uses owner options/default for malformed values while exposing the compiled numeric index', () => {
    getEffect('invert')!.params.previewChoice = { type: 'select', label: 'Projection', default: 'equisolid', options: [
      { value: 'equidistant', label: 'Equidistant' }, { value: 'equisolid', label: 'Equisolid Angle' }, { value: 'orthographic', label: 'Orthographic' },
    ] };
    const graph = createDefaultInvertImageGraph();
    graph.nodes.push({ id: 'choice', operator: 'values.choice', operatorVersion: 1, bindings: { value: 'previewChoice' } });
    graph.layout.choice = { x: 440, y: 220 };
    const effect: Effect = { id: 'choice-effect', type: 'invert', name: 'Invert', enabled: true, params: { previewChoice: 'malformed' }, operatorGraph: graph };
    const clip = createMockClip({ id: 'choice-clip', effects: [effect] });
    const node = buildEffectOperatorGraph(clip, effect).nodes.find(candidate => candidate.id === 'choice')!;
    node.preview = { enabled: true, requested: true, key: 'choice-preview' };
    const frame = imageOperatorValuePreview({ key: 'choice-preview', revision: '1', time: 0, clipId: clip.id, node,
      width: 164, height: 100, interval: 16, priority: 1 }, clip, effect)!;
    expect(frame.controls?.[0]).toMatchObject({ label: 'Projection', value: 'equisolid', defaultValue: 'equisolid',
      options: getEffect('invert')!.params.previewChoice.options,
      target: { clipId: clip.id, effectId: effect.id, nodeId: 'choice', parameter: 'value' } });
    expect(frame.values).toEqual([{ portId: 'value', direction: 'output', value: 1 }]);
    expect(frame.drawing).toMatchObject({ kind: 'number', value: '1', caption: 'Equisolid Angle' });
    previewTextStore.retain(owner, new Set(['choice-preview']));
    act(() => previewTextStore.publish(frame));
    render(<NodeValuePreview node={node} />);
    expect(screen.getByRole('combobox', { name: 'Choice Projection inline' })).toHaveTextContent('Equisolid Angle');
    expect(screen.queryByLabelText('Choice Projection inline', { selector: 'input[type="color"]' })).toBeNull();
  });

  it('keeps optionless strings on the existing color control path', () => {
    const graph = createDefaultInvertImageGraph(), effect: Effect = { id: 'color-effect', type: 'invert', name: 'Invert', enabled: true, params: {}, operatorGraph: graph };
    const clip = createMockClip({ id: 'color-clip', effects: [effect] }), node = buildEffectOperatorGraph(clip, effect).nodes[0];
    node.preview = { enabled: true, requested: true, key: 'color-preview' };
    previewTextStore.retain(owner, new Set(['color-preview']));
    act(() => previewTextStore.publish({ key: 'color-preview', revision: '1', time: 0, status: 'live', label: 'Live value', drawing: { kind: 'text', lines: ['#112233'] },
      controls: [{ label: 'Color', value: '#112233', defaultValue: '#111827', target: { clipId: clip.id, effectId: effect.id, nodeId: 'frame', parameter: 'value', storage: 'constant' } }] }));
    render(<NodeValuePreview node={node} />);
    expect(screen.getByLabelText(`${node.label} Color inline`)).toHaveAttribute('type', 'color');
  });
});
