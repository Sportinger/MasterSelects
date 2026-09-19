import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disposeAllAINodeSandboxes,
  runAINodeSandbox,
} from '../../src/services/nodeGraph/aiNodeSandboxClient';
import { AI_NODE_SANDBOX_EXECUTION_TIMEOUT_MS } from '../../src/services/nodeGraph/aiNodeSandboxProtocol';

class ReadyButSilentWorker extends EventTarget {
  static instances: ReadyButSilentWorker[] = [];
  terminated = false;

  constructor() {
    super();
    ReadyButSilentWorker.instances.push(this);
  }

  postMessage(message: { type?: string }): void {
    if (message.type !== 'init') return;
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('AI node sandbox client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', ReadyButSilentWorker);
    ReadyButSilentWorker.instances = [];
  });

  afterEach(() => {
    disposeAllAINodeSandboxes();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('terminates a worker that exceeds the hard execution timeout', async () => {
    const texture = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 255]),
    };
    const run = runAINodeSandbox(
      'sandbox-timeout-test',
      [{ id: 'node-1', code: 'defineNode({ process(input) { return { output: input.input }; } })' }],
      {
        texture,
        nodes: [{
          id: 'node-1',
          kind: 'generated',
          context: {
            clipId: 'clip-1',
            clipLocalTime: 0,
            metadata: {},
            params: {},
            clip: {},
            source: {},
            graph: {},
            node: {},
            signals: {},
          },
          connectedInputs: {},
        }],
      },
    );
    const rejected = expect(run).rejects.toThrow(`exceeded ${AI_NODE_SANDBOX_EXECUTION_TIMEOUT_MS} ms`);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AI_NODE_SANDBOX_EXECUTION_TIMEOUT_MS + 1);

    await rejected;
    expect(ReadyButSilentWorker.instances).toHaveLength(1);
    expect(ReadyButSilentWorker.instances[0]?.terminated).toBe(true);
  });
});
