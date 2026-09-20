import { describe, expect, it } from 'vitest';
import { setAllNodePreviews } from '../../src/components/panels/nodes/previews/useNodePreviewPreferences';

describe('node preview preferences', () => {
  it('switches every node off while preserving its selected output', () => {
    expect(setAllNodePreviews({
      enabled: true,
      nodes: { source: { enabled: true, portId: 'video' } },
    }, ['source', 'math'])).toEqual({
      enabled: false,
      nodes: {
        source: { enabled: false, portId: 'video' },
        math: { enabled: false },
      },
    });
  });

  it('switches every node back on after individual choices', () => {
    expect(setAllNodePreviews({
      enabled: false,
      nodes: { source: { enabled: true }, math: { enabled: false } },
    }, ['source', 'math'])).toEqual({
      enabled: true,
      nodes: { source: { enabled: true }, math: { enabled: true } },
    });
  });
});
