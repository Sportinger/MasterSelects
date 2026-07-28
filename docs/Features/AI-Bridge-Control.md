[Back to Documentation Index](./README.md)

# AI Bridge Control

MasterSelects exposes its live in-app AI tool surface to local external agents through an authenticated development bridge. The bridge is intended for debugging, parity checks, and controlled automation: an external client can inspect the same tool schemas offered to FlashBoard Chat, execute those tools through the same dispatcher and policy layer, and inspect the resulting history.

## Architecture

```text
Codex or another MCP client
        |
        | stdio MCP
        v
scripts/masterselects-mcp.mjs
        |
        | authenticated HTTP
        v
Vite /api/agent-control
        |
        | targeted Vite HMR request
        v
Selected MasterSelects browser tab
        |
        +-- FlashBoard Chat dispatcher and approval policy
        +-- project chat history
        +-- browser-wide AI tool audit
```

The browser is the execution authority. The HTTP server does not reproduce editor state or tool behavior, so bridge calls observe the same currently loaded project and state as an in-app AI call.

## Requirements

- Run the MasterSelects Vite development server at `http://localhost:5173`.
- Keep at least one editor tab open. After a page reload, allow about five seconds for bridge presence to register.
- Keep `.ai-bridge-token` private. The MCP adapter reads it directly and does not expose it as a tool result.
- Restart Codex after adding or changing the MCP registration so it reloads the server configuration.

The checked-in `.mcp.json` registers the adapter for clients that support project-local MCP configuration. A matching personal Codex registration can run:

```text
node scripts/masterselects-mcp.mjs
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `MASTERSELECTS_BRIDGE_URL` | `http://localhost:5173` | Vite bridge base URL |
| `MASTERSELECTS_BRIDGE_SURFACE` | `chat` | Default execution surface: `chat` or `devBridge` |
| `MASTERSELECTS_BRIDGE_SESSION_ID` | none | Initial target session |
| `MASTERSELECTS_BRIDGE_TOKEN_FILE` | project `.ai-bridge-token` | Alternate token file |
| `MASTERSELECTS_BRIDGE_TIMEOUT_MS` | `60000` | Default request timeout |

## MCP Tools

The MCP server publishes the current FlashBoard Chat tools with their exact live JSON schemas. It also provides these control tools:

| Tool | Purpose |
|---|---|
| `bridge_list_sessions` | List connected browser tabs and their project/chat metadata |
| `bridge_select_session` | Select the tab used by subsequent direct calls |
| `bridge_list_tools` | Read the live tool registry for either surface |
| `bridge_get_tool_schema` | Inspect one live schema and policy |
| `bridge_call_tool` | Execute a named tool, optionally as a dry run |
| `bridge_get_history` | Merge saved project chat calls, browser audit calls, and bridge traces |
| `bridge_get_tool_result` | Read the stored details of one call |
| `bridge_replay_tool_call` | Replay a stored call with optional replacement arguments |
| `bridge_send_chat_message` | Run a complete turn through the real in-app chat agent |
| `bridge_compare_chat_prompts` | Compare legacy-v1 and v2 with identical read-only tasks |
| `bridge_list_chat_runs` | List durable UI, bridge, MCP, and test chat runs |
| `bridge_get_chat_run` | Read a run’s exact system prompt, response, tool calls, results, and timing |
| `bridge_get_chat_system_prompt` | Render v1 or v2 plus live context/playbook without calling a model |

Direct MCP calls to a published editor tool use the `chat` surface by default. That route goes through the FlashBoard Chat execution layer and therefore uses the current in-app approval mode and tool policy.

Chat turns require explicit `confirm: true` because they can incur provider cost; normal mode may also mutate the editor. `dryRun: true` validates routing and reports the expected provider-round count without sending a model request. Prompt comparison always runs with technically enforced read-only tool execution and makes two provider calls.

## HTTP API

All routes are under `/api/agent-control` and require the same bridge token accepted by `/api/ai-tools`.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/sessions` | Connected browser sessions |
| `GET` | `/tools?surface=chat` | Live tool list |
| `GET` | `/tools/:name?surface=chat` | One tool schema |
| `GET` | `/history?sessionId=...&limit=500` | Merged history |
| `GET` | `/calls/:callId?sessionId=...` | One stored result |
| `POST` | `/call` | Execute or dry-run a tool |
| `POST` | `/replay` | Replay a stored call |

Example request body:

```json
{
  "sessionId": "opaque-tab-id",
  "surface": "chat",
  "tool": "getTimelineState",
  "args": {},
  "dryRun": false,
  "idempotencyKey": "debug-read-001"
}
```

Explicit unknown or stale session IDs fail instead of silently targeting another tab.

Complete chat-agent runs use the separate authenticated `/api/agent-chat` control plane:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/prompt` | Render v2 or legacy-v1, optional task playbook, and live context |
| `GET` | `/runs` | List durable chat runs |
| `GET` | `/runs/:runId` | Read one complete run |
| `POST` | `/turn` | Execute one full model/tool loop |
| `POST` | `/compare` | Run the same read-only task through legacy-v1 and v2 |

`POST /turn` supports provider/model selection, history inclusion, chat-store persistence, prompt version or complete override, context/playbook toggles, reasoning effort, temperature, read-only enforcement, timeout, and idempotency keys. The response contains the final model answer and every executed tool call; the durable run additionally stores the exact resolved system prompt.

## Chat Agent v2

The built-in v2 prompt replaces the recipe-heavy default with a compact operating loop:

```text
Inspect -> Plan -> Act -> Verify -> Report
```

The previous prompt remains available as `legacy-v1` for regression comparisons. Specialized instructions are selected from the user’s current task and injected only when relevant, including montage, transcript, face/person, silence, quality-analysis, and visual-verification playbooks. Call budgets, approval policy, and diagnostic read-only execution are enforced in code instead of relying on prompt compliance.

Conversation context now includes bounded summaries of prior successful tool calls and their results. This allows a later turn to know what was actually executed rather than seeing only assistant prose.

Long inspection tools are also bounded:

- `getClipAnalysis` returns a summary by default; use `includeFrames`, a source-time range, `offset`, and `limit` for details.
- `getClipTranscript` returns a bounded word page and `hasMore`/`nextOffset` continuation metadata.

## History And Safety

The history response keeps three sources distinct:

- `project`: tool calls already stored in the open project’s FlashBoard chat messages;
- `audit`: central browser-side records for in-app and bridge-triggered AI tool execution;
- `bridgeCalls`: durable JSONL traces created by HTTP/MCP bridge requests.

Chat-agent runs are stored separately in browser IndexedDB (`masterselects-ai-chat-runs`). They survive UI chat clearing and contain source, session/project, provider/model, prompt version, exact resolved system prompt, full request prompt, response, tool calls/results, execution mode, status, and timing. API keys are never included.

Audit and bridge records include source, caller context, session, timing, policy snapshot, arguments, status, result, replay origin, and idempotency key where applicable. Secret-like fields are redacted, and embedded base64 images are omitted from durable traces. MCP returns a discovered image as image content instead of duplicating its data in structured output.

`dryRun` resolves the target and policy without performing the tool. An `idempotencyKey` prevents accidental duplicate bridge execution. Replays keep a link to the original call. On the broader `devBridge` surface, mutating or sensitive calls require explicit `confirm: true`; the default `chat` surface delegates approval to the same in-app policy used by FlashBoard Chat.

## Current Scope

- This control plane is attached to the local Vite development bridge; it is not a hosted production API.
- A browser tab must remain connected because the real editor state and dispatcher live in the browser.
- Hosted Cloudflare/D1 chat logs are a separate data source and are not silently merged into local project history.
- A timeout stops waiting on the HTTP side but cannot forcibly cancel browser work that has already started. Use idempotency keys for safe retries.
- Native Helper parity and multi-editor routing outside the Vite bridge are not part of this implementation.
