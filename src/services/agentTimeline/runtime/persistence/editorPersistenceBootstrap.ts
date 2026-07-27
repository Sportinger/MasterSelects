import { startAgentTimelineRuntimePersistence } from './agentTimelineRuntimePersistence';

let started = false;

/** Production editor seam; the publisher remains idempotent across repeated boot calls. */
export function startEditorAgentTimelinePersistence(
  start: () => void = startAgentTimelineRuntimePersistence,
): void {
  if (started) return;
  started = true;
  start();
}
