import { Logger } from '../logger';

const log = Logger.create('CodexNodeStream');

/** Timing evidence only: never logs prompt, answer fragments or tool arguments. */
export class CodexStreamDiagnostics {
  private readonly started = performance.now();
  private deltas = 0;
  private characters = 0;
  private samples: { atMs: number; characters: number }[] = [];
  private firstOperationMs: number | null = null;
  private providerCompletedMs: number | null = null;
  private operationsBeforeCompletion = 0;
  private elapsed(): number { return Math.round(performance.now() - this.started); }
  delta(text: string): void {
    this.deltas++; this.characters += text.length;
    if (this.samples.length < 16) this.samples.push({ atMs: this.elapsed(), characters: text.length });
  }
  operationCompleted(): void {
    if (this.providerCompletedMs === null) this.operationsBeforeCompletion++;
    if (this.firstOperationMs === null) {
      this.firstOperationMs = this.elapsed();
      log.info('First streamed graph operation applied', { atMs: this.firstOperationMs, receivedDeltas: this.deltas, providerCompleted: this.providerCompletedMs !== null });
    }
  }
  providerCompleted(): void { this.providerCompletedMs = this.elapsed(); }
  finish(turnId: string) {
    const summary = { turnId, deltas: this.deltas, characters: this.characters,
      firstDeltaSamples: this.samples, firstOperationMs: this.firstOperationMs,
      providerCompletedMs: this.providerCompletedMs, operationsBeforeCompletion: this.operationsBeforeCompletion,
      firstOperationBeforeTurnCompleted: this.firstOperationMs !== null && this.providerCompletedMs !== null && this.firstOperationMs < this.providerCompletedMs };
    log.info('Codex node stream timing', summary);
    return summary;
  }
}
