import { describe, expect, it } from 'vitest';
import { projectSaveStatus, trackProjectSave } from '../../src/services/project/projectSaveStatus';

describe('project save status', () => {
  it('shows saving until a write finishes and records only successful timestamps', async () => {
    const identity = {};
    let finish!: (saved: boolean) => void;
    const pending = trackProjectSave(identity, () => new Promise(resolve => { finish = resolve; }));
    expect(projectSaveStatus.read(identity)).toEqual({ saving: true, failed: false, lastSuccessfulSave: null });
    finish(true);
    await pending;
    const successful = projectSaveStatus.read(identity).lastSuccessfulSave;
    expect(successful).toBeTypeOf('number');
    await trackProjectSave(identity, async () => false);
    expect(projectSaveStatus.read(identity)).toEqual({ saving: false, failed: true, lastSuccessfulSave: successful });
  });
  it('keeps thrown failures visible and isolates projects', async () => {
    const first = {};
    const second = {};
    await expect(trackProjectSave(first, async () => { throw new Error('permission denied'); }))
      .rejects.toThrow('permission denied');
    expect(projectSaveStatus.read(first).failed).toBe(true);
    expect(projectSaveStatus.read(second).failed).toBe(false);
    projectSaveStatus.reset(first);
    expect(projectSaveStatus.read(first).failed).toBe(false);
  });
});
