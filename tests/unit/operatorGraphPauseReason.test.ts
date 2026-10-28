import { afterEach, describe, expect, it, vi } from 'vitest';

import { operatorGraphPauseReason } from '../../src/services/operators/editableOperatorGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

// operatorGraphPauseReason runs for every effect on every render and inspector drag sample.
// A stored graph object must answer from its own field, without serializing the whole graph.

function graph(incomplete?: string): EffectOperatorGraph {
  return { version: 1, nodes: [], edges: [], ...(incomplete ? { incomplete } : {}) } as unknown as EffectOperatorGraph;
}

afterEach(() => vi.restoreAllMocks());

describe('operatorGraphPauseReason', () => {
  it('reads the reason of a stored graph object without serializing it', () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    expect(operatorGraphPauseReason({ params: {}, operatorGraph: graph('The graph needs one clip output.') }))
      .toBe('The graph needs one clip output.');
    expect(operatorGraphPauseReason({ params: {}, operatorGraph: graph() })).toBeUndefined();
    expect(stringify).not.toHaveBeenCalled();
  });

  it('follows an in-place repair of the stored graph object', () => {
    const stored = graph('Curves input missing');
    const effect = { params: {}, operatorGraph: stored };
    expect(operatorGraphPauseReason(effect)).toBe('Curves input missing');
    delete (stored as { incomplete?: string }).incomplete;
    expect(operatorGraphPauseReason(effect)).toBeUndefined();
  });

  it('still parses a legacy graph stored as text in params', () => {
    expect(operatorGraphPauseReason({ params: { operatorGraph: JSON.stringify(graph('Legacy pause')) } })).toBe('Legacy pause');
    expect(operatorGraphPauseReason({ params: { operatorGraph: JSON.stringify(graph()) } })).toBeUndefined();
    expect(operatorGraphPauseReason({ params: { operatorGraph: '{broken' } })).toBeUndefined();
    expect(operatorGraphPauseReason({ params: {} })).toBeUndefined();
  });
});
