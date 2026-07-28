import { attachRuntimeWorkerHost, type RuntimeWorkerGlobalScopeLike } from '../runtime/worker';
import { createAudioIntelligenceWorkerHandlers } from '../services/audio/intelligence/worker/handlers';
import { createSileroVadSession } from '../services/audio/intelligence/vad/sileroVadSession';

attachRuntimeWorkerHost(self as unknown as RuntimeWorkerGlobalScopeLike, {
  handlers: createAudioIntelligenceWorkerHandlers({ createSession: createSileroVadSession }),
});

export {};
