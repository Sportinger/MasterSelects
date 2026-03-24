# Add Lemonade AI Provider (Optional Local AI)

## Summary

Adds **Lemonade Server** as an optional local AI provider alongside OpenAI. This PR adds Lemonade as a built-in option — users can also use **Ollama** via the bridge API (documented below).

### Local AI Options Comparison

| Provider | Type | Privacy | Models | Speed | Best For |
|----------|------|---------|--------|-------|----------|
| **OpenAI** | Cloud | Data sent to OpenAI | GPT-4, o3, etc. | Standard | Best quality |
| **Lemonade** | Local | 100% private | SmolLM3, Qwen2.5, Gemma-3 | Fast (local) | AMD AI PC (NPU optimization via FastFlowLM) |
| **Ollama** | Local | 100% private | Hundreds of models | Fast (local) | Maximum model choice, established ecosystem |

### Important Clarifications

**AMD's Role:** AMD provides sponsorship/backing for Lemonade, but the project is **community-driven** (not corporate-maintained). FastFlowLM (AMD's NPU optimization) is now integrated INTO Lemonade.

**Both Lemonade and Ollama:**
- Use OpenAI-compatible APIs
- Run 100% locally (privacy-preserving)
- Work with the existing bridge architecture
- Are free to use (your own hardware)

**Why Lemonade in this PR?**
- Built-in UI (toggle in Settings, no external tool needed)
- Auto-configures AMD NPU/GPU/CPU via FastFlowLM
- Production-ready (used by n8n, VS Code Copilot, OpenWebUI, Dify, Continue)

**Why Ollama?**
- Larger model library (hundreds of models)
- More established community standard
- Requires bridge API configuration (no built-in UI)

## What This Adds

### New Features (Optional)

- **AI provider toggle** in AIChatPanel (OpenAI ↔ Lemonade)
- **Lemonade Server status indicator** (online/offline)
- **Model selection** for Lemonade (SmolLM3, Qwen2.5, etc.)
- **Fast fallback mode** for quick responses

### Files Added

| File | Purpose |
|------|---------|
| `src/services/lemonadeProvider.ts` | OpenAI-compatible provider for Lemonade Server |
| `src/services/lemonadeService.ts` | Server management, health checks, model listing |

### Files Modified

| File | Changes |
|------|---------|
| `src/components/panels/AIChatPanel.tsx` | Provider toggle UI, Lemonade status indicator |
| `src/stores/settingsStore.ts` | Lemonade settings (URL, model preference, enabled) |
| `README.md` | Lemonade badge and setup instructions |

---

## Master Branch Updates Included

This PR also brings in ~40 commits from master that `lemonade-support` was missing. These updates are **already in master** — this PR just ensures we're current.

### Included Updates Summary

| Feature | Status | Impact | Notes |
|---------|--------|--------|-------|
| **Security hardening** | ✅ Required | Core | `devBridgeAuth`, `fileAccessBroker` — protects AI tool access from unauthorized file operations |
| **AI Tool Policy** | ✅ Required | Core | Approval gating for destructive AI tools (delete, modify, export) |
| **MediaBunny muxer** | ✅ Required | Core | Required for export pipeline — replaces mp4-muxer |
| **Kie.ai integration** | ⚠️ Optional | Can Defer | Optional video generation provider — can move to separate branch |
| **MatAnyone2** | ⚠️ Optional | Can Defer | Optional AI segmentation — can move to separate branch |
| **Documentation audit** | ✅ Keep | None | Reference docs only — no runtime impact |
| **Test suite** | ✅ Keep | None | Unit tests — no runtime impact |

---

## If You Want Minimal PR

We can **split this into smaller PRs** to make review easier:

### Option A: Keep Together (Recommended)

Keep everything in this PR because:
- Security hardening is required for AI tools anyway
- MediaBunny is required for export to work
- Lemonade is a small addition (2 files)
- Kie.ai and MatAnyone2 are already in master

### Option B: Split Into 3 PRs

**PR #1: Security + Infrastructure** (required foundation)
```
✅ Security hardening (devBridgeAuth, fileAccessBroker, redact)
✅ AI tool policy system
✅ MediaBunny muxer (export requirement)
✅ Documentation audit (reference only)
✅ Test suite
```

**PR #2: Lemonade AI Provider** (optional enhancement)
```
✅ lemonadeProvider.ts
✅ lemonadeService.ts
✅ AIChatPanel integration
✅ Settings store updates
```

**PR #3: Optional AI Features** (can defer indefinitely)
```
⚠️ Kie.ai video generation
⚠️ MatAnyone2 segmentation
```

---

## Testing

| Test | Status | Notes |
|------|--------|-------|
| Build passes (`npm run build`) | ✅ Pass | No TypeScript errors |
| Lemonade Server connection | ⏳ TODO | Requires Lemonade Server running locally |
| AIChatPanel provider toggle | ⏳ TODO | Visual testing |
| OpenAI provider still works | ⏳ TODO | Regression test |
| Export pipeline works | ⏳ TODO | MediaBunny verification |

---

## Usage

### For Users Who Want Lemonade

1. Install and run [Lemonade Server](https://github.com/lemonade-sdk/lemonade)
2. Open Settings → AI Features
3. Select "Lemonade" as AI provider
4. Choose model (SmolLM3, Qwen2.5, Gemma-3, etc.)
5. Use AIChatPanel as normal

**AMD AI PC Users:** Lemonade auto-detects and uses your Ryzen AI NPU via FastFlowLM for 10x better power efficiency and 256k token context support.

### For Users Who Want Ollama

1. Install [Ollama](https://ollama.com)
2. Run: `ollama run gemma3` (or any other model)
3. Ollama runs at `http://localhost:11434` with OpenAI-compatible API
4. Use the bridge API to connect (see README.md for bridge documentation)

**Note:** Ollama requires custom bridge integration script. Lemonade provides built-in UI (no script needed).

### For Users Who Don't Want Local AI

Nothing changes. The app works exactly as before:
- OpenAI provider is still default
- Lemonade and Ollama are both optional
- No new dependencies affect core features

---

## Future Updates

We can refine later:

| Feature | Action | Priority |
|---------|--------|----------|
| Kie.ai | Move to separate feature branch | Low |
| MatAnyone2 | Move to separate feature branch | Low |
| Lemonade | Keep as optional local provider | High |
| Security | Keep in core (required for AI) | High |
| MediaBunny | Keep in core (required for export) | High |

---

## Screenshots

### AIChatPanel with Provider Toggle

```
┌─────────────────────────────────────┐
│ AI Chat                    [⚙️]    │
├─────────────────────────────────────┤
│ Provider: [OpenAI ▼]  [🟢 Online]  │
│          or                                               │
│          [Lemonade ▼] [🟢 Online]  │
│                                     │
│ Model: [SmolLM3-3B-Instruct ▼]     │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ How can I help you today?       │ │
│ │                                 │ │
│ │ [Type your message...]          │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Generate] [Clear]                  │
└─────────────────────────────────────┘
```

### Settings → AI Features

```
┌─────────────────────────────────────┐
│ AI Features                         │
├─────────────────────────────────────┤
│ Default Provider                    │
│ ○ OpenAI (cloud)                    │
│ ● Lemonade (local)                  │
│                                     │
│ Lemonade Server URL                 │
│ http://localhost:5000              │
│                                     │
│ Preferred Model                     │
│ [SmolLM3-3B-Instruct ▼]            │
│                                     │
│ [Save Changes]                      │
└─────────────────────────────────────┘
```

---

## Related Issues

- Fixes: #XXX (Add Lemonade Server support)
- Related: #YYY (Local AI provider discussion)

---

## Checklist

- [x] Code follows project patterns
- [x] Build passes without errors
- [x] New files have appropriate exports
- [x] Settings integrated into existing store
- [ ] Tested with running Lemonade Server
- [ ] Tested OpenAI provider still works
- [ ] Documentation updated

---

**Reviewers:** This PR brings Lemonade as an optional local AI provider. The main consideration is whether to include Kie.ai and MatAnyone2 in this PR or move them to separate branches. Recommend keeping them (they're already in master) but marking as optional features.
