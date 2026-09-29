import { describe, expect, it } from 'vitest';
import { canResumeWorkerNativeScene, WorkerNativeSceneDeadline, WorkerNativeSceneDeadlineError } from '../../src/services/render/workerNativeSceneCatchUp';

describe('Worker native scene continuation', () => {
  it('retains completed progress after expiry while keeping expiry mandatory', () => {
    let now = 10;
    const guard = new WorkerNativeSceneDeadline(100, () => now, () => true);
    guard.assertCurrent();
    guard.completed(0, 11);
    guard.completed(11, 22);
    now = 100;
    try { guard.assertCurrent(); throw new Error('Expected deadline'); }
    catch (error) {
      expect(error).toBeInstanceOf(WorkerNativeSceneDeadlineError);
      expect((error as WorkerNativeSceneDeadlineError).completedSteps).toBe(22);
    }
  });
  it('counts fresh retained steps after a backward seek resets the session', () => {
    const guard = new WorkerNativeSceneDeadline(1, () => 1, () => true);
    guard.completed(300, 11);
    expect(() => guard.assertCurrent()).toThrow(expect.objectContaining({ completedSteps: 11 }));
  });
  it('does not treat a replaced target as recoverable even after progress', () => {
    const guard = new WorkerNativeSceneDeadline(1, () => 2, () => false);
    guard.completed(0, 50);
    try { guard.assertCurrent(); throw new Error('Expected replacement'); }
    catch (error) { expect(error).not.toBeInstanceOf(WorkerNativeSceneDeadlineError); }
  });
  it.each([undefined, { completedSteps: 0 }, { completedSteps: -1 }, { completedSteps: NaN }, { completedSteps: Infinity }])(
    'does not spin without valid completed progress: %j', progress => {
      expect(canResumeWorkerNativeScene(progress, true)).toBe(false);
    });
  it('only resumes the current request, never an obsolete seek or detached canvas', () => {
    expect(canResumeWorkerNativeScene({ completedSteps: 11 }, true)).toBe(true);
    expect(canResumeWorkerNativeScene({ completedSteps: 11 }, false)).toBe(false);
  });
});
