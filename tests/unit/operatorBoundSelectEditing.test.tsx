import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperatorParameters } from '../../src/components/panels/nodes/workspace/OperatorParameters';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import { setOperatorParameter } from '../../src/services/operators/effectGraphEditing';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { installInProcessInspectorGraphWorker } from '../helpers/inspectorGraphWorker';

vi.mock('../../src/effects', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/effects')>();
  return { ...actual, getEffect: (type: string) => {
    const definition = actual.getEffect(type);
    if (type !== 'invert' || !definition) return definition;
    return { ...definition, params: { ...definition.params, projectionMode: { type: 'select' as const, label: 'Projection Model',
      default: 'stereographic', options: [{ value: 'equidistant', label: 'Equidistant' }, { value: 'stereographic', label: 'Stereographic' }] } } };
  } };
});

const initial = useTimelineStore.getState();
beforeEach(installInProcessInspectorGraphWorker);
afterEach(() => { cleanup(); useTimelineStore.setState(initial); });

function fixture(projectionMode = 'equidistant') {
  const graph = createDefaultInvertImageGraph();
  graph.nodes.push({ id: 'projection', operator: 'values.choice', operatorVersion: 1, bindings: { value: 'projectionMode' } });
  graph.layout.projection = { x: 440, y: 220 };
  const effect: Effect = { id: 'select-effect', name: 'Invert', type: 'invert', enabled: true,
    params: { projectionMode }, operatorGraph: graph };
  const clip = createMockClip({ id: 'select-clip', effects: [effect] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
  return { clip, effect };
}

describe('bound operator select parameters', () => {
  it('renders labels and options from the owning effect schema and persists the stable binding', async () => {
    const { clip, effect } = fixture('unknown');
    render(<OperatorParameters clip={clip} effectId={effect.id} nodeId="projection" />);
    const select = await screen.findByRole('combobox', { name: 'Choice Projection Model' });
    expect(select).toHaveTextContent('Stereographic');
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: 'Equidistant' }));
    let saved = useTimelineStore.getState().clips[0].effects[0];
    expect(saved.params.projectionMode).toBe('equidistant');
    expect(saved.operatorGraph?.nodes.find(node => node.id === 'projection')?.bindings.value).toBe('projectionMode');
    fireEvent.contextMenu(select);
    saved = useTimelineStore.getState().clips[0].effects[0];
    expect(saved.params.projectionMode).toBe('stereographic');
  });

  it('validates bound choices against owner options while the generic registry stores none', () => {
    const { clip, effect } = fixture();
    setOperatorParameter(clip.id, effect.id, 'projection', 'value', 'stereographic');
    expect(useTimelineStore.getState().clips[0].effects[0].params.projectionMode).toBe('stereographic');
    expect(() => setOperatorParameter(clip.id, effect.id, 'projection', 'value', 'unknown')).toThrow('Parameter option is unavailable');
  });
});
