# Codex-Usage-Monitoring.md — audit 2026-08-02

## Verified (spot checks that held)

- `npm run codex:usage`, `codex:usage:watch`, and `codex:usage:stop` map to the monitor once mode, watch mode, and PowerShell stop script in `package.json:57-59`.
- The monitor defaults to `~/.codex/sessions`, reads only JSONL files whose first `session_meta` record has a `cwd` equal to or below the resolved repository root, and defaults its output directory to `.codex-usage/` (`scripts/codex-session-monitor.mjs:20, 57-58, 100-104, 109-124, 702-709`).
- The core output files are written by the monitor: raw and deduplicated turns, session summary, state, and Markdown report (`scripts/codex-session-monitor.mjs:749-766`). `.codex-usage/` is ignored by Git (`.gitignore:92`).
- The token field meanings match `addUsage`: uncached input is `input - cached`, visible output is `output - reasoning`, and cache-adjusted total is `total - cached` (`scripts/codex-session-monitor.mjs:143-156`).
- The report has `Most Expensive Turns`, `Recent Turns`, and an `Open or stale turns` total (`scripts/codex-session-monitor.mjs:610-690`); it uses deduplicated turns for tables (`scripts/codex-session-monitor.mjs:692`).
- Git snapshots contain branch, full and short HEAD, commit timestamp and subject, dirty flag, and short status (`scripts/codex-session-monitor.mjs:409-428`); each turn exposes first and last snapshot data (`scripts/codex-session-monitor.mjs:453-478`).

## Outdated or wrong (claim → reality, with file evidence)

- “all `last_token_usage` entries … until the next user message or task completion” → `task_complete` marks the current turn completed but does not close or clear it; later `token_count` events are still added until the next `user_message` or end of file (`scripts/codex-session-monitor.mjs:331-398`). The document now reflects that implementation.
- “Codex rollout/resume logs can replay older turns” and “duplicate replay turns” → the code has no rollout/resume detection. It heuristically groups by question, answer preview, model-call count, total tokens, output tokens, and reasoning tokens, then labels non-representatives as duplicates (`scripts/codex-session-monitor.mjs:492-557`). The document now describes deduplication rather than asserting a cause.
- “first and last observation time per turn” → `lastObservedAt` changes only when token total or status changes, not on every watch poll (`scripts/codex-session-monitor.mjs:448-468`). The document now says “last recorded change time.”
- The fixed desktop shortcut/project-launcher path was not found in this repository; only the feature document and the untracked docs-site copy contain that assertion. The supported replacement is the local launcher script, which starts a hidden Node watcher, manages `watcher.pid`, and writes `watcher-launch.json` (`scripts/start-codex-usage-watch.ps1:13-86`). The document now describes that script without asserting external launcher behavior.
- The generated-files list omitted `.codex-usage/watcher-launch.json`, which both launcher scripts write (`scripts/start-codex-usage-watch.ps1:15-33`; `scripts/stop-codex-usage-watch.ps1:15-27`). It is now included.

## Noteworthy / unusual

- `docs-site/src/content/docs/features/codex-usage-monitoring.md` is an untracked copy of the feature doc and retains the stale desktop-launcher sentence. It was not edited because this audit was scoped to the requested source document and findings file.
- The `--include-answer-text` option persists full visible assistant text; by default the monitor only retains a 600-character answer preview and a 220-character question preview (`scripts/codex-session-monitor.mjs:23-24, 37-39, 286-289, 347-349`).
- Session eligibility relies only on the first JSONL line, reading at most 2 MiB; logs without a first-line `session_meta` record, or with malformed metadata, are silently excluded (`scripts/codex-session-monitor.mjs:109-139, 704-707`).
- The watcher itself has a 5-second polling default and marks an otherwise open turn stale after 30 minutes (`scripts/codex-session-monitor.mjs:21-22, 57-58, 783-794`).
