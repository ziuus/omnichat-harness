# OmniChat Harness

**An OpenAI-compatible local LLM server that uses AI chat web UIs as subagents.**

Point Cursor, Cline, Aider, Continue.dev, or any OpenAI-compatible AI agent at it and get access to ChatGPT, Gemini, Claude, and Perplexity — all through one standard API.

---

## Three Execution Modes

Every model name routes to a different mode. Your AI agent just sets the `model` field.

### Mode 1 — Self-Orchestrated (`omni-*`)
OmniChat plans, dispatches to multiple providers in parallel, and synthesizes.

```
model: "omni-code"     → ChatGPT generates, Claude reviews, Gemini explains
model: "omni-research" → Gemini researches, Perplexity cites, Claude analyzes
model: "omni-fast"     → Fastest available provider
model: "omni-consensus"→ All providers, majority vote
```

### Mode 2 — Direct Passthrough (`chatgpt`, `gemini`, etc.)
Zero orchestration. Your prompt goes straight to that provider's web UI.

```
model: "chatgpt"     → Direct ChatGPT web UI
model: "gemini"      → Direct Gemini (1M context window)
model: "claude-web"  → Direct Claude web UI
model: "perplexity"  → Direct Perplexity (real-time search)
```

### Mode 3 — Middleman Agent (`omni-middleman`)
Your own LLM (Ollama, OpenAI, Anthropic, any OpenAI-compatible) orchestrates the providers via tool calls.

```
model: "omni-middleman" → Your LLM decides which providers to use
```

---

## Quick Start

### 1. Install dependencies

```bash
# Requires Bun
curl -fsSL https://bun.sh/install | bash

git clone <this-repo>
cd omnichat-harness
bun install
```

### 2. Install Chromium

```bash
cd packages/browser
bun run install-browsers
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set OMNI_API_KEY
```

### 4. Log in to providers

```bash
# Opens a browser window for you to log in manually
bun run session:init

# Or for specific providers
bun run session:init gemini chatgpt
```

This saves encrypted session cookies so the server can reuse them.

### 5. Start the server

```bash
bun run dev:server
```

You'll see:
```
✓ OmniChat Harness running at http://localhost:3000

  Point your AI agent at:
    OPENAI_BASE_URL=http://localhost:3000/v1
    OPENAI_API_KEY=omni-local-dev-key
```

---

## Connecting AI Agents

### Cursor
Settings → Models → Add Model:
```
Base URL: http://localhost:3000/v1
API Key:  omni-local-dev-key
Model:    omni-code
```

### Cline (VS Code)
Extension settings:
```json
{
  "cline.apiProvider": "openai",
  "cline.openaiBaseUrl": "http://localhost:3000/v1",
  "cline.openaiApiKey": "omni-local-dev-key",
  "cline.openaiModelId": "omni-code"
}
```

### Aider
```bash
aider --openai-api-base http://localhost:3000/v1 \
      --openai-api-key omni-local-dev-key \
      --model omni-code
```

### Continue.dev
`~/.continue/config.json`:
```json
{
  "models": [{
    "title": "OmniChat Research",
    "provider": "openai",
    "model": "omni-research",
    "apiBase": "http://localhost:3000/v1",
    "apiKey": "omni-local-dev-key"
  }]
}
```

### LangChain / Python
```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://localhost:3000/v1",
    api_key="omni-local-dev-key",
    model="omni-research",
)
```

---

## Available Models

| Model | Mode | Description |
|---|---|---|
| `omni-research` | Self-orchestrated | Gemini + Perplexity + Claude + ChatGPT |
| `omni-code` | Self-orchestrated | ChatGPT + Claude + Gemini |
| `omni-consensus` | Self-orchestrated | All providers, consensus |
| `omni-fast` | Self-orchestrated | Fastest available |
| `omni-image` | Self-orchestrated | Multi-provider image analysis |
| `chatgpt` | Passthrough | Direct ChatGPT (128K context) |
| `gemini` | Passthrough | Direct Gemini (1M context!) |
| `claude-web` | Passthrough | Direct Claude (200K context) |
| `perplexity` | Passthrough | Direct Perplexity (real-time search) |
| `omni-middleman` | Middleman | Your LLM orchestrates providers |

---

## Mode 3 — Middleman Setup

Configure your preferred orchestrator in `.env`:

```bash
# Use local Ollama
OMNI_MIDDLEMAN_TYPE=ollama
OMNI_MIDDLEMAN_MODEL=llama3.1:70b
OMNI_MIDDLEMAN_BASE_URL=http://localhost:11434/v1

# Use OpenAI API
OMNI_MIDDLEMAN_TYPE=openai
OMNI_MIDDLEMAN_API_KEY=sk-...
OMNI_MIDDLEMAN_MODEL=gpt-4o

# Use Anthropic API
OMNI_MIDDLEMAN_TYPE=anthropic
OMNI_MIDDLEMAN_API_KEY=sk-ant-...
OMNI_MIDDLEMAN_MODEL=claude-opus-4-5

# Use LM Studio, Together, etc.
OMNI_MIDDLEMAN_TYPE=openai-compatible
OMNI_MIDDLEMAN_BASE_URL=http://localhost:1234/v1
OMNI_MIDDLEMAN_MODEL=mistral-7b
```

Your middleman LLM receives these tools:
- `ask_chatgpt(prompt)` — query ChatGPT
- `ask_gemini(prompt)` — query Gemini
- `ask_claude_web(prompt)` — query Claude
- `ask_perplexity(prompt)` — query Perplexity
- `ask_all_parallel(prompt, providers?)` — query multiple simultaneously

---

## Architecture

```
AI Agent (Cursor/Cline/Aider)
    │  OpenAI API protocol
    ▼
Hono API Server :3000
    │
    ├── Mode Selector (model name → execution mode)
    │
    ├── Mode 1: Self-Orchestrated
    │     └── Parallel browser sessions → Synthesis
    │
    ├── Mode 2: Direct Passthrough
    │     └── Single browser session → Stream
    │
    └── Mode 3: Middleman
          └── Your LLM (tool calls) → Browser sessions → Stream
                │
          ┌─────┴──────────────────┐
          ▼          ▼             ▼
      ChatGPT    Gemini        Claude/Perplexity
      (browser)  (browser)     (browser)
```

---

## Project Structure

```
omnichat-harness/
├── apps/
│   ├── server/          # Hono OpenAI-compatible server
│   └── dashboard/       # Monitoring dashboard (Phase 6)
├── packages/
│   ├── core/            # Types, orchestrator, router
│   ├── openai-adapter/  # Wire format, SSE, model registry
│   ├── browser/         # Playwright pool, stealth, sessions
│   ├── providers/       # ChatGPT, Gemini, Claude, Perplexity adapters
│   └── db/              # Drizzle schema + SQLite
├── config/
│   ├── models.yaml      # Model routing definitions
│   └── providers.yaml   # Provider capabilities
└── scripts/
    └── session-init.ts  # Interactive login script
```

---

## API Reference

### `POST /v1/chat/completions`
Standard OpenAI chat completions. Supports streaming (`stream: true`).

### `GET /v1/models`
Lists all available models with their routing info.

### `GET /health`
Server health, provider statuses, browser pool status.

---

## Important Notes

**Session Management**
Sessions are saved encrypted to `./data/sessions/`. Re-run `session:init` if a provider stops working.

**Rate Limits**
Web UIs have rate limits. The system respects them and marks providers as `rate-limited` automatically. Use `omni-fast` to automatically route around limited providers.

**Legal**
This tool automates web UIs. Use dedicated accounts, not personal accounts. Review each provider's Terms of Service.

**Provider DOM Changes**
Web UI selectors can change. If a provider breaks, check `packages/providers/src/<provider>/` and update the `SEL` object.

---

## Development

```bash
bun run dev:server    # Start API server with watch
bun run dev:dashboard # Start dashboard
bun run typecheck     # TypeScript check all packages
bun run db:migrate    # Run database migrations
bun run session:init  # Re-initialize provider sessions
```
