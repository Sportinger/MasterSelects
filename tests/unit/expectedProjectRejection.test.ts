import { describe, expect, it } from 'vitest';
import { describeExpectedProjectRejection } from '../../src/services/project/projectBackendAvailability';
import { RepositoryError } from '../../src/services/project/repository/contracts';

// Production: "Project creation failed: Project directory already contains a project" ended in "Please check the
// selected folder", and "This folder does not contain a MasterSelects project" was reported as a crash at every boot.
describe('expected project rejections', () => {
  it('tells the person to open the project that is already there', () => {
    expect(describeExpectedProjectRejection(new RepositoryError('conflict', 'Project directory already contains a project')))
      .toContain('Open it with "Open project"');
  });

  it('passes on the sentence about a folder without a project', () => {
    const message = 'This folder does not contain a MasterSelects project (no project.msrepo.json, project.json or .msproj file).';
    expect(describeExpectedProjectRejection(new RepositoryError('unsupported', message))).toBe(message);
  });

  it('leaves every other failure as a reported error', () => {
    expect(describeExpectedProjectRejection(new RepositoryError('conflict', 'Another writer holds the lock'))).toBeNull();
    expect(describeExpectedProjectRejection(new RepositoryError('corrupt', 'Project directory already contains a project'))).toBeNull();
    expect(describeExpectedProjectRejection(new Error('Project directory already contains a project'))).toBeNull();
  });
});
