import { describe, expect, it, vi } from 'vitest';
import { FlockGpuSession } from '../../src/engine/flock/gpu/FlockGpuSession';

function fixture() {
  let finish!: () => void;
  const completed = new Promise<void>(resolve => { finish = resolve; });
  const session = Object.assign(Object.create(FlockGpuSession.prototype) as FlockGpuSession, {
    step: 0, capacity: 262144, fluid: {}, disposed: false, previewSubmissionPending: false,
    device: { queue: { onSubmittedWorkDone: vi.fn(() => completed) } },
  });
  const batches: number[] = [];
  Object.assign(session, { encodeBatch: (steps: number) => { batches.push(steps); session.step += steps; } });
  return { session, batches, finish, completed };
}

describe('bounded GPU simulation window', () => {
  it('keeps the existing single-buffer limit by default', () => {
    const { session, batches } = fixture();
    expect(session.advanceTo(100, 90, true)).toBe(false);
    expect(batches).toEqual([11]);
  });

  it('queues at most two short buffers and refuses further work until completion', async () => {
    const f = fixture();
    expect(f.session.advanceTo(100, 90, true, 2)).toBe(false);
    expect(f.batches).toEqual([11, 11]);
    f.session.advanceTo(100, 90, true, 2);
    expect(f.batches).toEqual([11, 11]);
    f.finish();
    await f.completed;
    expect(f.session.advanceTo(25, 90, true, 2)).toBe(true);
    expect(f.batches).toEqual([11, 11, 3]);
    expect(f.session.step).toBe(25);
  });

  it('still respects a smaller caller budget without overshooting the target', () => {
    const { session, batches } = fixture();
    expect(session.advanceTo(100, 14, true, 2)).toBe(false);
    expect(batches).toEqual([11, 3]);
  });
});
