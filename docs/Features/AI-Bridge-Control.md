[Back to Documentation Index](./README.md)

# AI Bridge Control

MasterSelects exposes its live in-app AI tool surface to local external agents through an authenticated development bridge. The bridge is intended for debugging, parity checks, and controlled automation: an external client can inspect the same tool schemas offered to FlashBoard Chat, execute tools through the browser, and inspect resulting history.

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
        +-- FlashBoard Chat tool executor
        +-- AI tool dispatcher and policy registry
        +-- browser AI-tool audit and project chat history
```

The browser is the execution authority. The HTTP server does not reproduce editor state or tool behavior, so bridge calls observe the same currently loaded project and state as the selected browser tab.

## Requirements

- Run the MasterSelects Vite development server at `http://localhost:5173`.
- Keep at least one editor tab open. The browser client announces bridge presence at registration and then every three seconds.
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
| `bridge_get_history` | Merge current project chat calls, browser audit calls, and bridge traces |
| `bridge_get_tool_result` | Read the stored details of one call |
| `bridge_replay_tool_call` | Replay a stored call with optional replacement arguments |

Direct MCP calls to a published editor tool use the `chat` surface by default. That route invokes the FlashBoard Chat tool executor. The `devBridge` surface instead invokes the policy-filtered AI tool dispatcher.

`dryRun: true` resolves the target session, reads the selected tool schema and policy, and does not execute the tool. It does not invoke a model or validate the tool arguments. Direct `devBridge` calls require `confirm: true` when policy marks the tool as mutating, sensitive, or local-file access.

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

## FlashBoard Chat Runs

The in-app FlashBoard chat uses prompt version `v2` and records its own runs in browser IndexedDB. Bridge history exposes current FlashBoard chat messages and executed tool calls, browser AI-tool audit records, and bridge traces.

Long inspection tool responses are bounded by their tool implementations:

- `getClipAnalysis` returns a summary by default; use `includeFrames`, a source-time range, `offset`, and `limit` for details.
- `getClipTranscript` returns a bounded word page with `hasMore` and `nextOffset` continuation metadata.

## History And Safety

The history response keeps three sources distinct:

- `project`: tool calls stored in the current FlashBoard chat messages;
- `audit`: central browser-side records for in-app and bridge-triggered AI tool execution;
- `bridgeCalls`: durable JSONL traces created by HTTP/MCP bridge requests.

FlashBoard chat runs are stored separately in browser IndexedDB (`masterselects-ai-chat-runs`). They contain source, session/project, provider/model, prompt version, system prompt, request prompt, response, tool calls/results, execution mode, status, and timing.

Audit and bridge records include source, caller context, session, timing, policy snapshot, arguments, status, result, replay origin, and idempotency key where applicable. Secret-like fields are redacted, and embedded base64 images are omitted from durable traces. MCP returns a discovered image as image content instead of duplicating its data in structured output.

An `idempotencyKey` is scoped to the resolved browser session and returns an existing trace for retries. Replays keep a link to the original call. On the `devBridge` surface, mutating or sensitive calls require explicit `confirm: true` as determined by tool policy.

## Current Scope

- This control plane is attached to the local Vite development bridge; it is not a hosted production API.
- A browser tab must remain connected because the real editor state and dispatcher live in the browser.
- Hosted Cloudflare/D1 chat logs are a separate data source and are not silently merged into local project history.
- A timeout stops waiting on the HTTP side but cannot forcibly cancel browser work that has already started. Use idempotency keys for safe retries.
- The Vite bridge supports multiple connected browser sessions: it prefers a focused visible tab when no session is requested, and direct callers can select an explicit session. Native Helper exposes a separate local bridge and is not routed through these endpoints.
