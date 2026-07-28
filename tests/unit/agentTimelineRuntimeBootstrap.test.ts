import { describe, expect, it, vi } from 'vitest';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import { startEditorAgentTimelinePersistence } from '../../src/services/agentTimeline/runtime/persistence/editorPersistenceBootstrap';

describe('Agent Timeline runtime bootstrap boundaries', () => {
  it('keeps timelineRuntimeCoordinator imports inert', () => {
    expect(timelineRuntimeCoordinator).toBeDefined();
  });

  it('starts Agent Timeline persistence once through the editor bootstrap seam', () => {
    const start = vi.fn();

    startEditorAgentTimelinePersistence(start);
    startEditorAgentTimelinePersistence(start);

    expect(start).toHaveBeenCalledTimes(1);
  });
});
