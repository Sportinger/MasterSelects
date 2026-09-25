import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('Codex Direct usage report', () => {
  it('counts only Direct sessions and leaves unfinished turns unconfirmed', () => {
    const root = mkdtempSync(join(tmpdir(), 'ms-direct-usage-test-'));
    roots.push(root);
    const sessions = join(root, 'sessions');
    const output = join(root, 'output');
    mkdirSync(sessions);
    const line = (type: string, payload: unknown) => JSON.stringify({ type, payload, timestamp: '2026-09-24T12:00:00Z' });
    writeFileSync(join(sessions, 'direct.jsonl'), [
      line('session_meta', { id: 'direct-1', originator: 'masterselects_direct' }),
      line('event_msg', { type: 'task_started' }),
      line('event_msg', { type: 'token_count', info: { last_token_usage: {
        input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 5,
      } } }),
      line('event_msg', { type: 'task_complete' }),
      line('event_msg', { type: 'task_started' }),
    ].join('\n'));
    writeFileSync(join(sessions, 'logic.jsonl'), line('session_meta', { id: 'logic-1', originator: 'masterselects_logic' }));
    execFileSync(process.execPath, [resolve('scripts/direct-codex-usage.mjs')], {
      env: { ...process.env, MS_DIRECT_CODEX_SESSIONS_ROOT: sessions, MS_DIRECT_CODEX_OUTPUT_DIR: output },
    });
    const report = JSON.parse(readFileSync(join(output, 'direct-codex-report.json'), 'utf8'));
    expect(report.sessions).toBe(1);
    expect(report.totalTokens).toBe(120);
    expect(report.turns.map((turn: { status: string }) => turn.status)).toEqual(['completed', 'unconfirmed']);
  });
});
