import { describe, expect, it } from 'vitest';

import { effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';

describe('image frame-history runtime context', () => {
  it('opens frame-history lowering only for catalog feedback owners', () => {
    expect(effectOperatorCompileContext({ type: 'kinetic-trace' }).allowFrameHistory).toBe(true);
    expect(effectOperatorCompileContext({ type: 'brightness' }).allowFrameHistory).toBeUndefined();
  });
});
