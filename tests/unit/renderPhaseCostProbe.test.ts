import { describe, expect, it, vi } from 'vitest';

import type { EngineResourceSet } from '../../src/engine/engineCore/engineResources';
import { measureRenderPhaseCostsForResources } from '../../src/services/render/renderPhaseCostProbe';

describe('render phase cost probe', () => {
  it('measures calls made during the probe and restores the original methods', async () => {
    const composite = vi.fn();
    const resources = { compositor: { composite } } as unknown as EngineResourceSet;

    const probe = measureRenderPhaseCostsForResources(resources, 0);
    resources.compositor.composite([], null as never);
    const result = await probe;

    expect(result.success).toBe(true);
    expect(result.data.entries).toEqual([
      expect.objectContaining({ name: 'compositor.composite', calls: 1 }),
    ]);
    expect(resources.compositor.composite).toBe(composite);
  });
});
