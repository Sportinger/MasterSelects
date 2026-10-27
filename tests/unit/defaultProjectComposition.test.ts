import { describe, expect, it } from 'vitest';

import { createRepositoryProject } from '../../src/services/project/repository/lifecycle/defaultProject';

describe('createRepositoryProject initial composition', () => {
  it('keeps the 1920x1080 30 fps default', () => {
    const project = createRepositoryProject('Default');
    expect(project.settings).toMatchObject({ width: 1920, height: 1080, frameRate: 30 });
    expect(project.compositions[0]).toMatchObject({ width: 1920, height: 1080, frameRate: 30 });
  });

  it('builds the first composition with the requested canvas, so it is part of the first revision', () => {
    const project = createRepositoryProject('Phone', { width: 1080, height: 1920, frameRate: 30 });
    expect(project.settings).toMatchObject({ width: 1080, height: 1920, frameRate: 30 });
    expect(project.compositions).toHaveLength(1);
    expect(project.compositions[0]).toMatchObject({ width: 1080, height: 1920, frameRate: 30 });
    expect(project.activeCompositionId).toBe(project.compositions[0].id);
  });
});
