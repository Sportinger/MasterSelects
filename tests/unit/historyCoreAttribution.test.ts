import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Which revision source an edit is committed with decides whether Undo groups it, skips it or makes it
// its own step. The transaction runtime is simulated; it records each transaction's label and source.
const runtime = vi.hoisted(() => ({ session: null as object | null, token: null as object | null, live: new Set<object>(),
  begun: [] as Array<{ label: string; source: string }> }));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => runtime.session,
  getEditorTransactionToken: () => runtime.token,
  subscribeEditorRepositorySession: () => () => {},
  beginEditorTransaction: (label: string, source = 'user') => { const token = { label }; runtime.live.add(token); runtime.begun.push({ label, source }); return token; },
  ownsEditorTransaction: (token: object) => runtime.live.has(token),
  commitEditorTransaction: (token: object) => { runtime.live.delete(token); },
  cancelEditorTransaction: (token: object) => { runtime.live.delete(token); },
  runEditorTransaction: (_token: object, action: () => unknown) => action(),
  captureEditorTransactionAcrossAwaits: async (_token: object, action: () => Promise<unknown>) => action(),
}));

import { beginAgentTransaction, runAgentRequestScope } from '../../src/services/aiTools/agentTransaction';
import { agentRequestRevisionSource } from '../../src/services/project/repository/transaction/historyNavigationPlan';
import { revisionSourceDisplayLabel } from '../../src/services/project/repository/history/revisionSourceLabel';
import { createClipRuntimeUpdateActions } from '../../src/stores/timeline/clip/clipRuntimeUpdateActions';
import type { ClipActionContext } from '../../src/stores/timeline/clip/clipActionContext';
import type { TimelineClip } from '../../src/types/timeline';

const sources = () => runtime.begun.map(entry => entry.source);
beforeEach(() => { runtime.session = {}; runtime.token = null; runtime.live.clear(); runtime.begun = []; });
afterEach(() => { runtime.session = null; });

describe('assistant request attribution is per request, not one global id', () => {
  it('overlapping requests never join each other; once one ends the other is attributed again', async () => {
    let releaseA!: () => void;
    const a = runAgentRequestScope('A', async () => {
      beginAgentTransaction('AI: a1');
      await new Promise<void>(resolve => { releaseA = resolve; });
    });
    let releaseB!: () => void;
    const b = runAgentRequestScope('B', async () => {
      beginAgentTransaction('AI: b1');
      await new Promise<void>(resolve => { releaseB = resolve; });
      beginAgentTransaction('AI: b2');
    });
    await Promise.resolve();
    releaseA(); await a;
    releaseB(); await b;
    expect(sources()).toEqual([agentRequestRevisionSource('A'), 'agent', agentRequestRevisionSource('B')]);
  });

  it('a direct bridge or console tool call during a chat request stays a plain agent revision', async () => {
    await runAgentRequestScope('A', async () => {
      beginAgentTransaction('AI: chat');
      beginAgentTransaction('AI: bridge', { callerContext: 'devBridge' });
      beginAgentTransaction('AI: console', { callerContext: 'console' });
      beginAgentTransaction('AI: grouped', { callerContext: 'chat' });
    });
    expect(sources()).toEqual([agentRequestRevisionSource('A'), 'agent', 'agent', agentRequestRevisionSource('A')]);
  });

  it('an explicit request id wins, also while other requests overlap', async () => {
    await runAgentRequestScope('A', () => runAgentRequestScope('B', async () => {
      beginAgentTransaction('AI: tagged', { requestId: 'B' });
    }));
    // A nested scope of the same request joins it.
    await runAgentRequestScope('C', () => runAgentRequestScope('C', async () => { beginAgentTransaction('AI: nested'); }));
    expect(sources()).toEqual([agentRequestRevisionSource('B'), agentRequestRevisionSource('C')]);
  });
});

describe('History panel labels', () => {
  it('shows a readable label for an assistant request instead of its run id', () => {
    expect(revisionSourceDisplayLabel(agentRequestRevisionSource('flashboard-run-1a2b-3c'))).toBe('Agent request');
    expect(revisionSourceDisplayLabel('agent')).toBe('Agent');
    expect(revisionSourceDisplayLabel('gesture')).toBe('Edit');
  });
});

describe('late clip-import results after the importing transaction ended', () => {
  it('commit as background revisions (Undo skips them), not as user-visible import steps', () => {
    const clip = { id: 'c1', trackId: 'a1', name: 'Take', startTime: 0, duration: 2, inPoint: 0, outPoint: 2,
      source: { type: 'audio' }, effects: [] } as unknown as TimelineClip;
    let state = { clips: [clip], timelineSessionId: 's1', updateDuration: () => {} };
    const context = { get: () => state, set: (patch: Partial<typeof state>) => { state = { ...state, ...patch }; } } as unknown as ClipActionContext;
    // The clip is added inside a caller's transaction (a phone sheet session or an agent tool) …
    const caller = { label: 'Audio' }; runtime.live.add(caller); runtime.token = caller;
    const { updateClip } = createClipRuntimeUpdateActions(context);
    runtime.token = null; runtime.live.delete(caller); // … that commits before the waveform is ready.
    updateClip('c1', { waveformGenerating: false } as Partial<TimelineClip>);
    expect(state.clips[0]).toMatchObject({ waveformGenerating: false });
    expect(runtime.begun).toEqual([{ label: 'Complete clip import', source: 'background' }]);
  });
});
