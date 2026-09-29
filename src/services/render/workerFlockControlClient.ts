import type { FlockRuntimeControls, FlockRuntimeStatus } from '../../engine/flock/runtime/flockRuntimeApi';
import type { WorkerFlockControlCommand, WorkerFlockControlReply } from './workerFlockControls';

/** Bounded status polling; no particles or GPU objects cross the Worker boundary. */
export class WorkerFlockControlClient implements FlockRuntimeControls {
  private readonly active = new Map<string, WorkerFlockControlCommand>();
  private readonly statuses = new Map<string, FlockRuntimeStatus>();

  private readonly send: (command: WorkerFlockControlCommand) => Promise<WorkerFlockControlReply | undefined>;
  private readonly compositionId: () => string | null;
  private readonly changed: () => void;

  constructor(
    send: (command: WorkerFlockControlCommand) => Promise<WorkerFlockControlReply | undefined>,
    compositionId: () => string | null,
    changed: () => void,
  ) {
    this.send = send;
    this.compositionId = compositionId;
    this.changed = changed;
  }

  merge(statuses: readonly FlockRuntimeStatus[]): readonly FlockRuntimeStatus[] {
    return statuses.map(status => {
      const control = this.statuses.get(status.clipId);
      return control && control.updatedAt >= status.updatedAt ? control : status;
    });
  }

  private async call(command: WorkerFlockControlCommand): Promise<WorkerFlockControlReply> {
    const reply = await this.send(command);
    if (reply?.status) { this.statuses.set(command.clipId, reply.status); this.changed(); }
    return reply ?? { running: false, result: { ok: false, message: 'The render Worker is unavailable.' } };
  }

  async requestPrecompute(clipId: string, range: { start: number; end: number }, options: { persist: boolean }) {
    if (this.active.has(clipId)) return { ok: false, message: 'A precompute for this clip is already running.' };
    const compositionId = this.compositionId();
    if (!compositionId) return { ok: false, message: 'No active composition.' };
    const command: WorkerFlockControlCommand = { type: 'flock.control', targetId: 'preview', compositionId,
      clipId, jobId: crypto.randomUUID(), operation: 'start', range, persist: options.persist };
    this.active.set(clipId, command);
    try {
      let reply = await this.call(command);
      while (reply.running) {
        await new Promise(resolve => setTimeout(resolve, 250));
        reply = await this.call({ ...command, operation: 'status' });
      }
      return reply.result ?? { ok: false, message: 'Precompute ended without a result.' };
    } finally { this.active.delete(clipId); this.changed(); }
  }

  cancelPrecompute(clipId: string): void {
    const command = this.active.get(clipId);
    if (command) void this.call({ ...command, operation: 'cancel' });
  }

  async clearCache(clipId: string): Promise<void> {
    const compositionId = this.compositionId();
    if (!compositionId) throw new Error('No active composition.');
    const reply = await this.call({ type: 'flock.control', targetId: 'preview', compositionId, clipId,
      jobId: crypto.randomUUID(), operation: 'clear' });
    if (!reply.result?.ok) throw new Error(reply.result?.message ?? 'Could not clear cache.');
  }
}
