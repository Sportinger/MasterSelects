import { WorkerRuntimeHost } from './hostCore';
import { STANDARD_RUNTIME_WORKER_HANDLERS } from './standardHandlers';
import type {
  RuntimeJobHandlerRegistration,
  RuntimePostMessage,
  RuntimeWorkerInboundMessage,
} from './types';

export interface RuntimeWorkerGlobalScopeLike {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<RuntimeWorkerInboundMessage>) => void,
  ) => void;
  postMessage: RuntimePostMessage;
}

export interface AttachRuntimeWorkerHostOptions {
  handlers?: RuntimeJobHandlerRegistration[];
  includeStandardHandlers?: boolean;
  concurrency?: number;
  now?: () => string;
}

export function attachRuntimeWorkerHost(
  scope: RuntimeWorkerGlobalScopeLike,
  options: AttachRuntimeWorkerHostOptions = {},
): WorkerRuntimeHost {
  const handlers = [
    ...(options.includeStandardHandlers ? STANDARD_RUNTIME_WORKER_HANDLERS : []),
    ...(options.handlers ?? []),
  ];
  const host = new WorkerRuntimeHost({
    handlers,
    concurrency: options.concurrency,
    now: options.now,
    postMessage: (message, transfer) => {
      scope.postMessage(message, transfer);
    },
  });

  scope.addEventListener('message', (event) => {
    host.handleMessage(event.data);
  });

  return host;
}

