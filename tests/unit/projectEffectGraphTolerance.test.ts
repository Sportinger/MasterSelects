import { describe, expect, it } from 'vitest';
import { migratePersistedEffectOperatorGraph, migrateProjectEffectOperatorGraph, UNREADABLE_EFFECT_GRAPH_PARAM } from '../../src/services/operators/effectGraphOwner';
import { createInitialSlitScanGraph } from '../../src/services/operators/slitScanGraphUpgrade';
import { subscribeEditRejections } from '../../src/services/editRejection';
import { getDefaultParams } from '../../src/effects';
import type { Effect } from '../../src/types';

function slitScan(graph: unknown): Effect {
  return { id: 'e1', name: 'Slit Scan', type: 'slit-scan', enabled: true, params: getDefaultParams('slit-scan'), operatorGraph: graph } as unknown as Effect;
}

// Production: "Invalid node: temporalTrail" and a bypass group kept the whole project from opening
// ("Failed to resolve project boot state", "Project recent open failed").
describe('project effects with an unreadable graph', () => {
  it('switches the effect off, keeps its stored graph and says so, instead of refusing the project', () => {
    const graph = createInitialSlitScanGraph();
    graph.nodes[0] = { ...graph.nodes[0], operator: 'operator.from-another-version' };
    expect(() => migratePersistedEffectOperatorGraph(slitScan(graph)), 'presets keep refusing such a graph').toThrow('Slit Scan');

    const notices: string[] = [];
    const unsubscribe = subscribeEditRejections(rejection => notices.push(rejection.message));
    const loaded = migrateProjectEffectOperatorGraph(slitScan(graph));
    unsubscribe();

    expect(loaded.enabled).toBe(false);
    expect(JSON.parse(loaded.params[UNREADABLE_EFFECT_GRAPH_PARAM] as string).nodes[0].operator).toBe('operator.from-another-version');
    expect(notices[0]).toContain('"Slit Scan" could not be read and was switched off');
    // Saving and loading the result again changes nothing further and no longer warns.
    const again = migrateProjectEffectOperatorGraph(loaded);
    expect(again.enabled).toBe(false);
    expect(again.params[UNREADABLE_EFFECT_GRAPH_PARAM]).toBe(loaded.params[UNREADABLE_EFFECT_GRAPH_PARAM]);
  });

  it('leaves a readable effect untouched', () => {
    const loaded = migrateProjectEffectOperatorGraph(slitScan(createInitialSlitScanGraph()));
    expect(loaded.enabled).toBe(true);
    expect(loaded.params[UNREADABLE_EFFECT_GRAPH_PARAM]).toBeUndefined();
  });
});
