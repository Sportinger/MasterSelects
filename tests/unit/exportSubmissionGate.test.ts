import { expect, it, vi } from 'vitest';
import { ExportSubmissionGate } from '../../src/components/export/ExportSubmissionGate';

it('rejects concurrent starts until the cancelled runner finishes its cleanup', async () => {
  const gate = new ExportSubmissionGate();
  let finish!: () => void;
  const cleanup = new Promise<void>(resolve => { finish = resolve; });
  const first = vi.fn(() => cleanup);
  const next = vi.fn();
  const active = gate.run(first);
  await gate.run(next);
  // A cancel signal does not mean asynchronous resource release has finished.
  await gate.run(next);
  expect(first).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  finish();
  await active;
  await gate.run(next);
  expect(next).toHaveBeenCalledTimes(1);
});

it('releases submission ownership after setup throws or a runner rejects', async () => {
  const gate = new ExportSubmissionGate();
  await expect(gate.run(() => { throw new Error('setup'); })).rejects.toThrow('setup');
  await expect(gate.run(async () => { throw new Error('runner'); })).rejects.toThrow('runner');
  const next = vi.fn();
  await gate.run(next);
  expect(next).toHaveBeenCalledTimes(1);
});
