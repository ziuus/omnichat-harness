# OmniChat Harness

**An OpenAI-compatible local AI gateway that drives AI chat web UIs through your own browser sessions.**

Point OpenCode, Cursor, Cline, Aider, Continue.dev, or any OpenAI-compatible AI agent at it and route requests to ChatGPT, Gemini, Claude, and Perplexity — all through one local standard API.

> Current status: early developer preview. ChatGPT passthrough and the local TUI are the most tested paths. Multi-provider orchestration is being built out incrementally.

## Highlights

- OpenAI-compatible `/v1/chat/completions` and `/v1/models` endpoints.
- Browser-backed providers instead of provider APIs.
- Anonymous ChatGPT support when the public ChatGPT UI allows it.
- Interactive system browser selection for Chrome/Chromium/Edge.
- AES-256-GCM encrypted session storage under `data/sessions/`.
- Terminal dashboard for server/provider/model health.
- Bun + TypeScript strict + Turborepo workspace.

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

### 2. Pick a browser / initialize provider sessions

```bash
bun run session:init chatgpt
```

The init script detects installed system browsers such as Chrome, Chromium, and Edge. Pick one from the prompt, or pass one explicitly:

```bash
bun run session:init chatgpt -- --browser chrome
```

If your system does not have a supported browser available, install Playwright's browser bundle:

```bash
bunx playwright install chromium
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set OMNI_API_KEY
```

### 4. Optional: log in to providers

```bash
# Opens a browser window for manual login when needed
bun run session:init

# Or for specific providers
bun run session:init gemini chatgpt
```

ChatGPT can also run anonymously when its public UI allows chatting without login. Session state is saved encrypted so the server can reuse it.

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

For production-style local runs without file watching:

```bash
bun run start:server
```

### 6. Watch it from the terminal dashboard

```bash
OMNI_SERVER_URL=http://localhost:3000 OMNI_API_KEY=omni-local-dev-key bun run start:tui
```

One-shot smoke check:

```bash
bun run start:tui -- --once
```

---

## Connecting AI Agents

### OpenCode

Add a local OpenAI-compatible provider pointing at `http://localhost:3000/v1`, then run:

```bash
opencode run -m omnichat/chatgpt "Hello from my local browser session"
```

Example provider shape:

```json
{
  "provider": {
    "omnichat": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OmniChat Harness",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "omni-local-dev-key"
      },
      "models": {
        "chatgpt": { "name": "ChatGPT Web" }
      }
    }
  }
}
```

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
│   └── tui/             # Terminal monitoring dashboard
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

## Community Exchange checklist

- Public GitHub repo: `https://github.com/ziuus/omnichat-harness`
- License: MIT
- Includes: README, `.env.example`, CONTRIBUTING, SECURITY, issue templates, Docker Compose, tests
- Recommended demo command: `bun run start:tui -- --once`

Suggested short description:

> OpenAI-compatible local gateway that lets coding agents use ChatGPT/Gemini/Claude-style web UIs through your own browser sessions.

Suggested tags:

`opencode`, `openai-compatible`, `browser-automation`, `chatgpt`, `bun`, `typescript`, `ai-agents`

---

## Important Notes

**Session Management**
Sessions are saved encrypted to `./data/sessions/`. Re-run `session:init` if a provider stops working.

**No secrets in logs**
Do not log cookies, browser storage, decrypted sessions, or API keys. Session files and local databases are ignored by git.

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
bun run start:server  # Start API server
bun run start:tui     # Start terminal dashboard
bun run typecheck     # TypeScript check all packages
bun test              # Run tests
bun run db:migrate    # Run database migrations
bun run session:init  # Re-initialize provider sessions
```
