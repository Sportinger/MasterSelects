import { attachRuntimeWorkerHost, type RuntimeWorkerGlobalScopeLike } from '../runtime/worker';

attachRuntimeWorkerHost(self as unknown as RuntimeWorkerGlobalScopeLike, {
  includeStandardHandlers: true,
});

export {};
