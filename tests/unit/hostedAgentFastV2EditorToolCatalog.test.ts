import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildHostedAgentFastV2EditorToolCatalog,
  canonicalHostedAgentFastV2EditorToolCatalog,
  parseKernelEditorToolBatch,
} from '../../src/services/kernelClient/hostedAgent/fastV2EditorToolCatalog';
import {
  HOSTED_AGENT_FAST_V2_EDITOR_TOOL_CATALOG_DIGEST,
  HOSTED_AGENT_FAST_V2_MAX_TOOL_CALLS_PER_ROUND,
} from '../../src/services/kernelClient/hostedAgent/fastV2StartContract';

describe('Fast V2 editor tool catalog', () => {
  it('publishes a flat digest-pinned atomic surface without public fast paths', () => {
    const catalog = buildHostedAgentFastV2EditorToolCatalog();
    const names = catalog.tools.map((tool) => tool.name);
    const digest = `sha256:${createHash('sha256')
      .update(canonicalHostedAgentFastV2EditorToolCatalog())
      .digest('hex')}`;

    expect(digest).toBe(HOSTED_AGENT_FAST_V2_EDITOR_TOOL_CATALOG_DIGEST);
    expect(catalog.digest).toBe(digest);
    expect(catalog.tools.length).toBeGreaterThan(70);
    expect(catalog.tools.find((tool) => tool.name === 'openComposition')?.risk).toBe('mutating');
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      'createTextClip',
      'createCaptionClip',
      'createMotionShapeClip',
      'getCaptionProperties',
      'updateTextProperties',
      'updateCaptionProperties',
      'updateMotionProperties',
      'addKeyframe',
      'splitClip',
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      'createEditableTitleStack',
      'cutRangesFromClip',
      'executeBatch',
      'manageEditableHook',
      'refineEditableHook',
      'undo',
    ]));
    expect(catalog).not.toHaveProperty('categories');
    expect(JSON.stringify(catalog)).not.toContain('quickPaths');
  });

  it('accepts a large round of atomic editor calls up to the shared cap', () => {
    const request = { args: { scaleX: 1.15, scaleY: 1.15 }, toolName: 'setTransform' };

    expect(parseKernelEditorToolBatch({
      requests: Array.from(
        { length: HOSTED_AGENT_FAST_V2_MAX_TOOL_CALLS_PER_ROUND },
        () => request,
      ),
    })).toHaveLength(HOSTED_AGENT_FAST_V2_MAX_TOOL_CALLS_PER_ROUND);
    expect(parseKernelEditorToolBatch({
      requests: Array.from(
        { length: HOSTED_AGENT_FAST_V2_MAX_TOOL_CALLS_PER_ROUND + 1 },
        () => request,
      ),
    })).toBeNull();
  });
});
