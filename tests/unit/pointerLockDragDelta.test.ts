import { describe, expect, it } from 'vitest';
import { resolvePointerLockDragDeltaX } from '../../src/components/common/pointerLockDragDelta';

describe('resolvePointerLockDragDeltaX', () => {
  it('uses the normal client position delta before pointer lock is requested', () => {
    expect(resolvePointerLockDragDeltaX({
      clientX: 108,
      lastClientX: 100,
      movementX: 0,
      pointerLockRequested: false,
      pointerLockActive: false,
    })).toEqual({
      deltaX: 8,
      nextClientX: 108,
    });
  });

  it('uses movementX while pointer lock is active', () => {
    expect(resolvePointerLockDragDeltaX({
      clientX: 0,
      lastClientX: 500,
      movementX: 3,
      pointerLockRequested: true,
      pointerLockActive: true,
    })).toEqual({
      deltaX: 3,
      nextClientX: 0,
    });
  });

  it('ignores a huge movementX spike in the first active pointer-lock event', () => {
    expect(resolvePointerLockDragDeltaX({
      clientX: 100,
      lastClientX: 100,
      movementX: -900,
      pointerLockRequested: true,
      pointerLockActive: true,
      pointerLockHandoffPending: true,
    })).toEqual({
      deltaX: 0,
      nextClientX: 100,
      pointerLockHandoffConsumed: true,
    });
  });

  it('ignores a huge movementX spike before pointerlockchange fires', () => {
    expect(resolvePointerLockDragDeltaX({
      clientX: 903,
      lastClientX: 903,
      movementX: -900,
      pointerLockRequested: true,
      pointerLockActive: false,
      pointerLockHandoffPending: true,
    })).toEqual({
      deltaX: 0,
      nextClientX: 903,
    });
  });

  it('ignores matching clientX and movementX warps before pointer lock becomes active', () => {
    expect(resolvePointerLockDragDeltaX({
      clientX: 0,
      lastClientX: 903,
      movementX: -903,
      pointerLockRequested: true,
      pointerLockActive: false,
      pointerLockHandoffPending: true,
    })).toEqual({
      deltaX: 0,
      nextClientX: 0,
    });
  });

  it('keeps the handoff guard armed across an empty first locked event', () => {
    expect(resolvePointerLockDragDeltaX({
      clientX: 100,
      lastClientX: 100,
      movementX: 0,
      pointerLockRequested: true,
      pointerLockActive: true,
      pointerLockHandoffPending: true,
    })).toEqual({
      deltaX: 0,
      nextClientX: 100,
    });
  });

  it('keeps a plausible first pointer-lock movement and settles the handoff', () => {
    expect(resolvePointerLockDragDeltaX({
      clientX: 100,
      lastClientX: 100,
      movementX: -12,
      pointerLockRequested: true,
      pointerLockActive: true,
      pointerLockHandoffPending: true,
    })).toEqual({
      deltaX: -12,
      nextClientX: 100,
      pointerLockHandoffConsumed: true,
    });
  });

  it('ignores a large clientX warp with zero movement during pointer-lock handoff', () => {
    expect(resolvePointerLockDragDeltaX({
      clientX: 0,
      lastClientX: 900,
      movementX: 0,
      pointerLockRequested: true,
      pointerLockActive: false,
    })).toEqual({
      deltaX: 0,
      nextClientX: 0,
    });
  });

  it('uses the small movement signal when clientX warps during pointer-lock handoff', () => {
    expect(resolvePointerLockDragDeltaX({
      clientX: 0,
      lastClientX: 900,
      movementX: 2,
      pointerLockRequested: true,
      pointerLockActive: false,
    })).toEqual({
      deltaX: 2,
      nextClientX: 0,
    });
  });

  it('keeps small client deltas usable while pointer lock is still pending', () => {
    expect(resolvePointerLockDragDeltaX({
      clientX: 104,
      lastClientX: 100,
      movementX: 0,
      pointerLockRequested: true,
      pointerLockActive: false,
    })).toEqual({
      deltaX: 4,
      nextClientX: 104,
    });
  });
});
