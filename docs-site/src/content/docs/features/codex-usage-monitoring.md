---
title: "Codex Usage Monitoring"
---

MasterSelects includes a local Codex session monitor for answering:

- what the user asked
- how many model calls the turn triggered
- how many input, cached input, output, reasoning, total, and cache-adjusted tokens were reported
- which Git commit and dirty state were observed while the AI worked
- which turns were long-running, open, stale, or unusually expensive

The monitor reads Codex JSONL session logs from `~/.codex/sessions`, filters sessions whose `session_meta.cwd` is inside this repository, and writes local analysis artifacts to `.codex-usage/`.

## Commands

One-shot report:

```bash
npm run codex:usage
```

Continuous watcher:

```bash
npm run codex:usage:watch
```

Stop a watcher started with the provided PowerShell launcher:

```bash
npm run codex:usage:stop
```

Monitor output:

```text
.codex-usage/turns.jsonl
.codex-usage/turns.deduped.jsonl
.codex-usage/sessions.json
.codex-usage/report.md
.codex-usage/state.json
```

When using `scripts/start-codex-usage-watch.ps1`, it also creates:

```text
.codex-usage/watcher.pid
.codex-usage/watcher-launch.json
.codex-usage/watcher.out.log
.codex-usage/watcher.err.log
```

`.codex-usage/` is ignored by Git because it contains local conversation metadata.

The monitor also accepts `--repo`, `--sessions-root`, `--out`, `--poll-ms`, and `--stale-minutes`; use `--include-answer-text` only when storing full visible assistant text locally is appropriate.

## Token Model

Codex logs token usage per model call in `event_msg` entries with `payload.type = "token_count"`.

The monitor groups all `last_token_usage` entries after a user message until the next user message or end of the session file. It marks the turn completed on `task_complete` or a `final_answer`, but continues recording later token events for that current turn until the next user message.

The monitor deduplicates turns with the same question, answer preview, model-call count, and token totals. It keeps raw turns in `turns.jsonl`, marks duplicates with `dedupe`, and writes representative turns to `turns.deduped.jsonl`. `report.md` uses the deduped data by default and shows the raw inflation separately.

Important fields:

| Field | Meaning |
|---|---|
| `inputTokens` | Full prompt/context tokens sent to the model |
| `cachedInputTokens` | Input tokens served from prompt cache |
| `uncachedInputTokens` | `inputTokens - cachedInputTokens` |
| `outputTokens` | Generated output tokens reported by Codex |
| `reasoningOutputTokens` | Reasoning subset when Codex reports it |
| `visibleOutputTokensEstimate` | `outputTokens - reasoningOutputTokens` |
| `totalTokens` | Reported `inputTokens + outputTokens` |
| `cacheAdjustedTotalTokens` | `totalTokens - cachedInputTokens` |

`reasoningOutputTokens` appears to be included in `outputTokens`, so the monitor does not add it a second time.

## Commit Attribution

The watcher stores Git snapshots in `.codex-usage/state.json`:

- branch
- HEAD commit
- commit subject and timestamp
- dirty status and short status output
- first observation and last recorded change time per turn

`scripts/start-codex-usage-watch.ps1` starts a hidden watcher, writes `.codex-usage/watcher.pid`, and avoids starting a second process when that PID belongs to `codex-session-monitor.mjs`. It also records launcher status in `.codex-usage/watcher-launch.json`.

## Reading The Report

Open `.codex-usage/report.md` after running the command. The most useful tables are:

- `Most Expensive Turns`: sort by total tokens
- `Recent Turns`: chronological review of latest questions
- `Open or stale turns`: visible in the totals for incomplete work

For deeper analysis, load `.codex-usage/turns.jsonl` into a script or spreadsheet and group by `git.lastGit.shortHead`, `status`, `toolUsage.tools`, or question text patterns.
