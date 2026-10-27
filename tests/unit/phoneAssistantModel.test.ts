import { describe, expect, it } from 'vitest';

import {
  buildPhoneToolCallRows, countPhoneChangeSteps, formatPhoneElapsed, latestSettledAssistantMessage, phoneProgressLine,
  phoneUndoOffer, resolvePhoneAssistantAccess, summarizePhoneToolResult,
} from '../../src/components/mobileSkin/assistant/phoneAssistantModel';
import { getPhoneAssistantTask, PHONE_ASSISTANT_TASKS } from '../../src/components/mobileSkin/assistant/phoneAssistantTasks';
import type { FlashBoardChatMessage } from '../../src/stores/flashboardStore';

/** Every phone catalog item with phone_tier 'assistant' (katalog-INV-*.md), minus the developer-only bridge bookkeeping item. */
const ASSISTANT_TIER_ITEMS = [
  'INV-1/assistant-timeline-editing', 'INV-1/bulk-split-and-range-removal', 'INV-1/storyboard-decisions',
  'INV-2/assistant-effects-and-graphs', 'INV-2/custom-ai-nodes', 'INV-3/assistant-transform-mask-animation',
  'INV-4/audio-assistant-editing', 'INV-5/editable-title-stack', 'INV-6/assistant-media-organization',
  'INV-8/assistant-chat', 'INV-8/assistant-plan-and-policy', 'INV-8/assistant-request-undo', 'INV-8/assistant-progress-and-audit',
  'INV-8/silence-and-speech-cleanup', 'INV-8/assistant-timeline-inspection', 'INV-8/assistant-clip-editing',
  'INV-8/assistant-track-management', 'INV-8/assistant-playback-and-markers', 'INV-8/assistant-visual-review',
  'INV-8/assistant-media-library', 'INV-8/assistant-compositions', 'INV-8/assistant-effects-and-transform',
  'INV-8/assistant-keyframes', 'INV-8/assistant-text-and-hooks', 'INV-8/assistant-masks', 'INV-8/assistant-transitions',
  'INV-8/story-production-workflow', 'INV-8/assistant-generated-clips', 'INV-8/assistant-node-authoring',
  'INV-8/assistant-motion-shapes', 'INV-8/assistant-motion-relationships', 'INV-8/assistant-storyboard-scenes',
  'INV-8/assistant-project-documents', 'INV-8/assistant-beat-rules', 'INV-8/assistant-audio-sync-multicam',
  'INV-8/assistant-flock', 'INV-8/assistant-stick-figure-rigs', 'INV-8/assistant-scene-streams',
];

const readOnly = new Set(['getTimelineState', 'getClipDetails']);
const isReadOnly = (name: string) => readOnly.has(name);

function assistant(patch: Partial<FlashBoardChatMessage> = {}): FlashBoardChatMessage {
  return { id: 'a1', role: 'assistant', text: 'ok', ...patch };
}

function call(id: string, name: string, result: { success: boolean; data?: unknown; error?: string }) {
  return { modelContent: '', result, toolCall: { id, name, arguments: '{}' } };
}

describe('phone assistant tasks', () => {
  it('has exactly one task per assistant-tier catalog item, each with a usable prompt', () => {
    expect(PHONE_ASSISTANT_TASKS.map((task) => task.catalogId).toSorted()).toEqual([...ASSISTANT_TIER_ITEMS].toSorted());
    for (const task of PHONE_ASSISTANT_TASKS) {
      expect(task.task.length, task.catalogId).toBeGreaterThan(5);
      expect(task.prompt, task.catalogId).toMatch(/[.?]$/);
      expect(task.keywords, task.catalogId).toBe(task.keywords.toLowerCase());
    }
    expect(getPhoneAssistantTask('INV-8/assistant-masks')?.task).toMatch(/mask/);
  });
});

describe('phone assistant access', () => {
  const base = { online: true, accountKnown: true, authenticated: false, guest: false, creditBalance: 0 };

  it('blocks sending signed out and offline, and offers the sign-in dialog', () => {
    const signedOut = resolvePhoneAssistantAccess(base);
    expect(signedOut).toMatchObject({ kind: 'signedOut', blocksSending: true, action: { dialog: 'auth' } });
    expect(resolvePhoneAssistantAccess({ ...base, online: false })).toMatchObject({ kind: 'offline', blocksSending: true, action: null });
  });

  it('lets guests and accounts without credits send, saying what the server decides', () => {
    expect(resolvePhoneAssistantAccess({ ...base, guest: true })).toMatchObject({ kind: 'guest', blocksSending: false, action: { dialog: 'auth' } });
    expect(resolvePhoneAssistantAccess({ ...base, authenticated: true })).toMatchObject({ kind: 'noCredits', blocksSending: false, action: { dialog: 'pricing' } });
    const ready = resolvePhoneAssistantAccess({ ...base, authenticated: true, creditBalance: 42.7 });
    expect(ready).toMatchObject({ kind: 'ready', blocksSending: false, action: { dialog: 'account' } });
    expect(ready.message).toContain('42 credits');
    expect(resolvePhoneAssistantAccess({ ...base, accountKnown: false }).kind).toBe('checking');
  });
});

describe('phone assistant progress and tool calls', () => {
  it('shows the newest activity, else the kernel stage, else Thinking', () => {
    expect(phoneProgressLine(undefined)).toBe('');
    expect(phoneProgressLine(assistant({ isPending: true }))).toBe('Thinking…');
    expect(phoneProgressLine(assistant({ isPending: true, kernelProgress: { stage: 'executing', label: 'Running tools', detail: 'splitClip' } as never }))).toBe('Running tools: splitClip');
    const events = [
      { id: 'e1', runId: 'r', kind: 'operation', source: 'runtime', phase: 'started', safeLabel: 'Split clip', operationId: 'c1', toolName: 'splitClip', createdAt: 1 },
      { id: 'e2', runId: 'r', kind: 'progress', source: 'runtime', label: 'Batch', current: 2, total: 5, createdAt: 2 },
    ] as FlashBoardChatMessage['activityEvents'];
    expect(phoneProgressLine(assistant({ isPending: true, activityEvents: events }))).toBe('Batch (2/5)');
    expect(formatPhoneElapsed(65_400)).toBe('1:05');
    expect(formatPhoneElapsed(-3)).toBe('0s');
  });

  it('turns the run audit into rows and counts the changing steps', () => {
    const message = assistant({
      isPending: true,
      toolCalls: [
        call('c1', 'getTimelineState', { success: true, data: { clips: [], tracks: [] } }),
        call('c2', 'splitClip', { success: true, data: { message: 'Split clip at 2.00s' } }),
        call('c3', 'deleteClip', { success: false, error: 'Clip not found' }),
      ],
      activityEvents: [
        { id: 'e1', runId: 'r', kind: 'operation', source: 'runtime', phase: 'started', safeLabel: 'Move clip', operationId: 'c4', toolName: 'moveClip', createdAt: 1 },
        { id: 'e2', runId: 'r', kind: 'operation', source: 'runtime', phase: 'completed', safeLabel: 'Split', operationId: 'c2', toolName: 'splitClip', createdAt: 2 },
      ],
    });
    const rows = buildPhoneToolCallRows(message, isReadOnly);
    expect(rows.map((row) => [row.name, row.status, row.changes])).toEqual([
      ['getTimelineState', 'done', false], ['splitClip', 'done', true], ['deleteClip', 'failed', true], ['moveClip', 'running', true],
    ]);
    expect(rows[1].summary).toBe('Split clip at 2.00s');
    expect(rows[2].summary).toBe('Clip not found');
    expect(countPhoneChangeSteps(rows)).toBe(1);
    expect(buildPhoneToolCallRows({ ...message, isPending: false }, isReadOnly)).toHaveLength(3);
  });

  it('summarizes results briefly and never as an empty success', () => {
    expect(summarizePhoneToolResult({ success: true })).toBe('Done');
    expect(summarizePhoneToolResult({ success: true, data: [1, 2] })).toBe('2 items');
    expect(summarizePhoneToolResult({ success: true, data: { a: 1, b: 2, c: 3, d: 4, e: 5 } })).toBe('Done · a, b, c, d, …');
    expect(summarizePhoneToolResult({ success: false })).toBe('Failed without a reason.');
    expect(summarizePhoneToolResult({ success: true, data: 'x'.repeat(200) }).length).toBeLessThanOrEqual(90);
  });
});

describe('phone assistant undo', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `c${index}`, name: 'splitClip', status: 'done' as const, summary: '', changes: true }));

  it('offers request undo for a verified kernel run and for every other run with changes (one step per request)', () => {
    const kernel = assistant({ kernelReport: { outcome: 'verified', steps: [] } as never });
    expect(phoneUndoOffer(kernel, [])).toMatchObject({ kind: 'request', label: 'Undo this request', steps: 1 });
    expect(phoneUndoOffer(kernel, [], 1)).toBeNull();
    expect(phoneUndoOffer(assistant({ kernelReport: { outcome: 'declined', steps: [] } as never }), [])).toBeNull();
    const two = phoneUndoOffer(assistant(), rows(2));
    expect(two).toMatchObject({ kind: 'request', label: 'Undo this request', steps: 1 });
    expect(two?.hint).toMatch(/one tap takes all 2 changes back/);
    expect(phoneUndoOffer(assistant(), rows(1))).toMatchObject({ steps: 1, hint: 'Undo takes this change back.' });
    expect(phoneUndoOffer(assistant(), rows(2), 1)).toBeNull();
    expect(phoneUndoOffer(assistant({ isPending: true }), rows(1))).toBeNull();
    expect(phoneUndoOffer(assistant({ isError: true }), rows(1))).toBeNull();
    expect(phoneUndoOffer(assistant(), [])).toBeNull();
  });

  it('finds the latest settled answer, none while one is pending', () => {
    const user: FlashBoardChatMessage = { id: 'u', role: 'user', text: 'hi' };
    expect(latestSettledAssistantMessage([user, assistant()])?.id).toBe('a1');
    expect(latestSettledAssistantMessage([assistant(), user, assistant({ id: 'a2', isPending: true })])).toBeUndefined();
    expect(latestSettledAssistantMessage([user])).toBeUndefined();
  });
});
