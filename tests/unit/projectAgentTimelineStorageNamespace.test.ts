import { describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  handle: { kind: 'directory' } as unknown,
  getProjectData: vi.fn(() => ({ createdAt: '2026-11-16', name: 'MS UTE 22' })),
}));
vi.mock('../../src/services/project/ProjectFileService', () => ({
  projectFileService: {
    getProjectHandle: () => service.handle,
    getProjectPackageSession: () => null,
    getProjectData: service.getProjectData,
    getProjectPath: () => null,
  },
}));
vi.mock('../../src/services/project/repository/artifacts/RepositoryDomainPublication', () => ({ captureRepositoryDomainPublication: () => null }));
vi.mock('../../src/services/project/domains/ArtifactService', () => ({ artifactService: { createStore: () => ({}), createIndexedDBStore: () => ({}) } }));

import { createProjectAgentTimelineStorage } from '../../src/services/agentTimeline/storage/projectAgentTimelineStorage';

describe('agent timeline storage for a project', () => {
  it('does not decode the whole project when pointers live in the project folder', () => {
    createProjectAgentTimelineStorage();
    expect(service.getProjectData).not.toHaveBeenCalled();
  });

  it('still names browser-local pointers after the project', () => {
    service.handle = null;
    createProjectAgentTimelineStorage();
    expect(service.getProjectData).toHaveBeenCalledOnce();
  });
});
