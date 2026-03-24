# Quick Start: Test Lemonade Integration

## Branch Status ✅

Your `lemonade-support` branch is **up to date** with `origin/master`. No merge needed!

---

## Option 1: Dev Server (Recommended for Testing)

```bash
# Install dependencies (if not already done)
npm install

# Start dev server (no changelog)
npm run dev
```

Opens at: **http://localhost:5173**

**What's available:**
- ✅ OpenAI provider (default) — enter API key in Settings
- ✅ Lemonade provider — requires Lemonade Server running
- ✅ Bridge API — for external agents (Claude Code, custom scripts)

---

## Option 2: Test with Lemonade Server

### Step 1: Install Lemonade Server

**Windows:**
```powershell
# Download from https://github.com/lemonade-sdk/lemonade
# Or install via pip
pip install lemonade-server
```

### Step 2: Run Lemonade Server

```bash
# Start Lemonade Server
lemonade-server run Gemma-3-4b-it-GGUF
```

Server runs at: **http://localhost:8000/api/v1**

### Step 3: Enable in MasterSelects

1. Open http://localhost:5173
2. Go to **Settings → AI Features**
3. Select **AI Provider: Lemonade**
4. Server URL should auto-detect as `http://localhost:8000/api/v1`
5. Choose a model (Qwen2.5, Gemma-3, Llama-3.2, etc.)
6. Open AI Chat panel — should show 🟢 Online

### Step 4: Test AMD NPU (If You Have AMD AI PC)

Lemonade auto-detects and uses Ryzen AI NPU via FastFlowLM if available.

Check Task Manager → Performance → NPU to see usage.

---

## Option 3: Test with Ollama (Alternative Local LLM)

### Step 1: Install Ollama

```bash
# Windows/Mac/Linux
# Download from https://ollama.com
```

### Step 2: Run Ollama

```bash
ollama run gemma3
```

Server runs at: **http://localhost:11434**

### Step 3: Connect via Bridge

Ollama doesn't have built-in UI in MasterSelects — use the bridge API:

```bash
# Example: Call bridge to execute AI tool
curl -X POST http://127.0.0.1:5173/api/ai-tools \
  -H "Authorization: Bearer <token-from-.ai-bridge-token>" \
  -d '{"tool":"getTimelineState","args":{}}'
```

**For full Ollama + Bridge integration**, you'd need to write a custom agent script.

---

## Option 4: Test with OpenAI (Cloud, Default)

1. Open http://localhost:5173
2. Go to **Settings → AI Features**
3. Enter your OpenAI API key
4. AI Chat panel works immediately

---

## Bridge API Reference

### Dev Server Bridge (Development)

```bash
# Get token from .ai-bridge-token file
curl -X POST http://localhost:5173/api/ai-tools \
  -H "Authorization: Bearer $(cat .ai-bridge-token)" \
  -H "Content-Type: application/json" \
  -d '{"tool":"_status","args":{}}'
```

### Native Helper Bridge (Production)

```bash
# Requires native helper running on port 9877
curl -X POST http://127.0.0.1:9877/api/ai-tools \
  -H "Authorization: Bearer <startup-token>" \
  -H "Content-Type: application/json" \
  -d '{"tool":"_status","args":{}}'
```

---

## What Each Path Gives You

| Path | Setup | Best For |
|------|-------|----------|
| **OpenAI** | Enter API key | Best quality, no local hardware |
| **Lemonade (Built-in)** | Run Lemonade Server, select in dropdown | AMD AI PC (NPU), simple local setup |
| **Ollama + Bridge** | Run Ollama + write custom agent script | Maximum model choice, power users |
| **Claude Code + Bridge** | Install Claude Code + configure token | Complex reasoning tasks |

---

## Quick Health Check

```bash
# Check if dev server is running
curl http://localhost:5173

# Check if Lemonade Server is running
curl http://localhost:8000/api/v1/models

# Check if Ollama is running
curl http://localhost:11434/api/tags

# Check bridge status (need valid token)
curl -X POST http://localhost:5173/api/ai-tools \
  -H "Authorization: Bearer <token>" \
  -d '{"tool":"_status","args":{}}'
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Lemonade shows "Offline" | Ensure `lemonade-server` is running |
| Build fails | Run `npm install` (MediaBunny is required) |
| Bridge returns 401 | Check token in `.ai-bridge-token` file |
| NPU not detected | Lemonade auto-detects — check AMD NPU driver version |

---

## Next Steps

1. **Run dev server**: `npm run dev`
2. **Test OpenAI** (if you have key)
3. **Test Lemonade** (if you have it running)
4. **Send PR response** using `PR-RESPONSE-CONCISE.md`
