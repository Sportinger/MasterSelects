#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = process.env.MS_DIRECT_CODEX_OUTPUT_DIR || path.join(repoRoot, '.codex-usage');
const roots = process.env.MS_DIRECT_CODEX_SESSIONS_ROOT
  ? [process.env.MS_DIRECT_CODEX_SESSIONS_ROOT]
  : [path.join(outputDir, 'direct-codex-sessions')];
if (!process.env.MS_DIRECT_CODEX_SESSIONS_ROOT) {
  for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('masterselects-logic-dev-')) {
      roots.push(path.join(os.tmpdir(), entry.name, 'codex-home', 'sessions'));
    }
  }
}

function* sessionFiles(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) yield* sessionFiles(file);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield file;
  }
}

function usageFrom(value) {
  const number = key => Number.isSafeInteger(value?.[key]) && value[key] >= 0 ? value[key] : 0;
  return {
    inputTokens: number('input_tokens'), cachedInputTokens: number('cached_input_tokens'),
    outputTokens: number('output_tokens'), reasoningOutputTokens: number('reasoning_output_tokens'),
  };
}

function readSession(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u);
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* Ignore an incomplete final write. */ }
  }
  const meta = events.find(event => event.type === 'session_meta')?.payload;
  if (meta?.originator !== 'masterselects_direct') return null;
  const turns = [];
  let current = null;
  for (const event of events) {
    const kind = event.type === 'event_msg' ? event.payload?.type : null;
    if (kind === 'task_started') {
      current = { threadId: meta.id, startedAt: event.timestamp ?? null, endedAt: null,
        status: 'unconfirmed', modelCalls: 0, inputTokens: 0, cachedInputTokens: 0,
        outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
      turns.push(current);
    }
    if (!current) continue;
    if (kind === 'token_count' && event.payload?.info?.last_token_usage) {
      const usage = usageFrom(event.payload.info.last_token_usage);
      current.modelCalls += 1;
      current.inputTokens += usage.inputTokens;
      current.cachedInputTokens += usage.cachedInputTokens;
      current.outputTokens += usage.outputTokens;
      current.reasoningOutputTokens += usage.reasoningOutputTokens;
      current.totalTokens += usage.inputTokens + usage.outputTokens;
    }
    if (kind === 'task_complete' || kind === 'turn_aborted' || kind === 'task_interrupted') {
      current.status = kind === 'task_complete' ? 'completed' : 'interrupted';
      current.endedAt = event.timestamp ?? null;
      current = null;
    }
  }
  return { id: meta.id, turns, file, mtime: fs.statSync(file).mtimeMs };
}

const sessions = new Map();
for (const root of roots) for (const file of sessionFiles(root)) {
  const session = readSession(file);
  if (session && (!sessions.has(session.id) || sessions.get(session.id).mtime < session.mtime)) {
    sessions.set(session.id, session);
  }
}
const turns = [...sessions.values()].flatMap(session => session.turns)
  .toSorted((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
const total = turns.reduce((sum, turn) => sum + turn.totalTokens, 0);
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), sessions: sessions.size,
  turns, totalTokens: total, incompleteTurns: turns.filter(turn => turn.status !== 'completed').length };
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'direct-codex-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Codex Direct: ${sessions.size} Sessions, ${turns.length} Turns, ${total} Tokens; ${report.incompleteTurns} ohne bestätigten Abschluss.`);
console.log(path.join(outputDir, 'direct-codex-report.json'));
