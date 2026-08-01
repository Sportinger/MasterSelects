# AI-Bridge-Control.md — audit 2026-08-02

## Verified (spot checks that held)

- The bridge is a local Vite-to-browser control plane: `tools/devBridge/vitePlugin.ts` dispatches targeted `agent-control:request` HMR messages, and `src/services/aiTools/devBridge/browser/client.ts` executes them in the selected browser tab.
- `scripts/masterselects-mcp.mjs` uses `http://localhost:5173`, reads `.ai-bridge-token`, defaults to the `chat` surface, and honours the documented URL, surface, session, token-file, and timeout environment variables.
- The eight documented control tools and all seven `/api/agent-control` routes exist in `scripts/masterselects-mcp.mjs` and `tools/devBridge/agentControlEndpoints.ts`.
- Tool discovery is live and surface-specific: `src/services/aiTools/devBridge/browser/agentControl.ts` serves `FLASHBOARD_CHAT_TOOLS` for `chat` and policy-filtered `AI_TOOLS` for `devBridge`.
- Explicit stale sessions fail rather than falling back: `tools/devBridge/agentControlEndpoints.ts` returns 404 for an unknown requested session; `scripts/masterselects-mcp.mjs` also validates `bridge_select_session` against `/sessions`.
- Browser tool audit entries persist in IndexedDB and bridge traces persist as JSONL; sensitive keys and base64 binary data are redacted in `src/services/aiTools/audit.ts` and `tools/devBridge/traceStore.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “After a page reload, allow about five seconds for bridge presence” → presence is sent immediately at browser-client registration and every 3,000 ms, not after a defined five-second delay. Evidence: `src/services/aiTools/devBridge/browser/presence.ts`.
- The MCP list included `bridge_send_chat_message`, `bridge_compare_chat_prompts`, `bridge_list_chat_runs`, `bridge_get_chat_run`, and `bridge_get_chat_system_prompt` → none is registered. The adapter's `CONTROL_TOOLS` contains only the eight remaining controls, and a repository-wide search finds these five names only in the mirrored docs site. Evidence: `scripts/masterselects-mcp.mjs`; `.docs-site/src/content/docs/features/ai-bridge-control.md`.
- “Complete chat-agent runs use `/api/agent-chat`”, its route table, `POST /turn` options, and the legacy-v1 comparison claims → no `/api/agent-chat` endpoint or MCP wrapper exists in the client repository. The Vite plugin installs only `installAgentControlEndpoints` for this control plane. Evidence: `tools/devBridge/vitePlugin.ts`, `tools/devBridge/agentControlEndpoints.ts`, `scripts/masterselects-mcp.mjs`.
- The “Chat Agent v2” section described a bridge-exposed v1/v2 prompt comparison and task-playbook controls → FlashBoard's current type admits only `promptVersion: 'v2'`; its model-turn API is in-app code, not an agent-control endpoint. Evidence: `src/services/flashboard/FlashBoardChatTypes.ts`, `src/services/flashboard/FlashBoardChatService.ts`.
- “Chat turns require explicit `confirm: true`” and `dryRun` provider-round reporting → direct bridge calls do not run model turns. `dryRun` reads the schema/policy and does not execute; only the `devBridge` surface enforces bridge-level confirmation for mutating/sensitive/local-file tools. Evidence: `tools/devBridge/agentControlEndpoints.ts`, `src/services/aiTools/devBridge/browser/agentControl.ts`.
- “Native Helper parity and multi-editor routing ... are not part of this implementation” → the Vite bridge already tracks multiple sessions, chooses focused/visible tabs by default, and accepts explicit sessions. Evidence: `tools/devBridge/vitePlugin.ts`, `tools/devBridge/agentControlEndpoints.ts`, `src/services/aiTools/devBridge/browser/presence.ts`.

## Noteworthy / unusual

- FlashBoard chat-run auditing is implemented despite not being exposed by the bridge: `src/services/flashboard/FlashBoardChatRunAudit.ts` stores up to 2,000 IndexedDB run records, including system prompt and tool calls; `src/services/flashboard/FlashBoardChatService.ts` creates and completes them.
- The Vite bridge's default-session choice is focus/visibility based, so an omitted `sessionId` can change target tabs as browser focus changes. Explicit session selection is safer for automation. Evidence: `tools/devBridge/agentControlEndpoints.ts`.
- The repository's mirrored docs-site page still contains the removed chat-agent MCP tools and `/api/agent-chat` section. It was not changed because this bounded task authorized only the audited source doc and findings file. Evidence: `.docs-site/src/content/docs/features/ai-bridge-control.md`.
- The documented “project” history source is actually current `useFlashBoardStore().chatMessages`; it is not independently loaded from a project file by the bridge history handler. Evidence: `src/services/aiTools/devBridge/browser/agentControl.ts`.
