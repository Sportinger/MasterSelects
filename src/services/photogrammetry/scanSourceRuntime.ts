import { captureRepositoryDomainPublication } from '../project/repository/artifacts/RepositoryDomainPublication';
import { getActiveRepositorySession, isScratchRepository, subscribeRepositoryLifecycle } from '../project/repository/lifecycle/editorRepositoryLifecycle';
import { ScanSourceManager } from './ScanSourceManager';
import { cameraSolvingManager } from './cameraSolvingManager';
import { brushTrainingManager } from './brushTrainingManager';

const hot = import.meta.hot?.data as { scanSources?: ScanSourceManager } | undefined;
export const scanSourceManager = hot?.scanSources ?? new ScanSourceManager();
if (hot?.scanSources) Object.setPrototypeOf(scanSourceManager, ScanSourceManager.prototype);

let projectKey = scanSourceManager.getSnapshot().projectKey;
const synchronize = () => {
  const session = getActiveRepositorySession();
  const storage = session && !isScratchRepository() ? captureRepositoryDomainPublication() : null;
  const nextKey = session?.coordinator.sessionEpoch ?? null;
  if (nextKey !== projectKey) {
    cameraSolvingManager.reset(); brushTrainingManager.reset(); projectKey = nextKey;
  }
  void scanSourceManager.activate(storage, nextKey);
};
const unsubscribe = subscribeRepositoryLifecycle(synchronize);
synchronize();
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(data => { data.scanSources = scanSourceManager; unsubscribe(); });
}
