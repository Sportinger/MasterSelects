import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { OperatorParameters } from '../../src/components/panels/nodes/workspace/OperatorParameters';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { createEffectGraphActions, setOperatorParameter } from '../../src/services/operators/effectGraphEditing';
import { effectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initial); });

function fixture() {
  const effect: Effect = { id: 'analog-graph', name: 'Analog Signal Lab', type: 'analog-signal-lab', enabled: true,
    params: getDefaultParams('analog-signal-lab') };
  const clip = createMockClip({ id: 'analog-clip', effects: [effect] });
  return { clip, effect };
}

describe('Analog Signal Lab graph owner', () => {
  it('adopts the legacy effect as one canonical persisted graph without changing parameter ownership', () => {
    const { effect } = fixture();
    const graph = effectOperatorGraph(effect);
    expect(graph.domain).toBe('analog-signal');
    expect(graph.nodes.map(node => `${node.id}:${node.operator}`)).toEqual([
      'frame:image.frame', 'encode:analog.pal-encode', 'rf:analog.rf-channel', 'vhs:analog.vhs-transport',
      'analyze:analog.receiver-analyze', 'decode:analog.pal-decode', 'resolve:analog.display-resolve', 'output:image.output',
    ]);
    expect(graph.nodes.find(node => node.id === 'decode')?.bindings).toMatchObject({ decoder: 'decoder' });
    expect(graph.nodes.find(node => node.id === 'vhs')?.bindings).toMatchObject({ tapeSpeed: 'tapeSpeed' });
    expect(getEffectOperator('analog.pal-decode')?.parameters.find(parameter => parameter.id === 'decoder')?.options?.map(option => option.value))
      .toEqual(['simple', 'delay-line', 'comb']);
    expect(getEffectOperator('analog.vhs-transport')?.parameters.find(parameter => parameter.id === 'tracking'))
      .toMatchObject({ default: 0.12, min: 0, max: 1, step: 0.01 });
    const migrated = migratePersistedEffectOperatorGraph(effect);
    expect(migrated.operatorGraph).toEqual(graph);
    expect(migrated.params.decoder).toBe('delay-line');
    expect(migrated.params.tapeSpeed).toBe('sp');
    expect(migrated.params.operatorGraph).toBeUndefined();
  });

  it('edits select bindings through the shared inspector and retains incomplete user wiring', () => {
    const { clip, effect } = fixture();
    const canonical = migratePersistedEffectOperatorGraph(effect);
    const current = { ...clip, effects: [canonical] };
    useTimelineStore.setState({ clips: [current], tracks: [createMockTrack({ id: current.trackId })] });
    const projected = buildEffectOperatorGraph(current, canonical).nodes.find(node => node.id === 'decode');
    render(<OperatorParameters clip={current} effectId={canonical.id} nodeId="decode" projectedNode={projected} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'PAL Decode PAL Decoder' }));
    fireEvent.click(screen.getByRole('option', { name: 'Comb Filter' }));
    expect(useTimelineStore.getState().clips[0].effects[0].params.decoder).toBe('comb');
    expect(() => setOperatorParameter(current.id, canonical.id, 'decode', 'decoder', 'not-a-decoder')).toThrow('Parameter option is unavailable');
    createEffectGraphActions(current.id, canonical.id).disconnectEdge('analyze-decode');
    const saved = useTimelineStore.getState().clips[0].effects[0];
    expect(saved.operatorGraph?.incomplete).toContain('Receiver Lines');
    expect(saved.operatorGraph?.edges.some(edge => edge.id === 'analyze-decode')).toBe(false);
    expect(effectOperatorGraph(saved).incomplete).toBe(saved.operatorGraph?.incomplete);
  });
});
