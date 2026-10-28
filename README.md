# OmniChat Harness

<p align="center">
  <img src="https://raw.githubusercontent.com/ziuus/omnichat-harness/main/assets/banner.png" alt="OmniChat Harness Banner" width="100%" onerror="this.style.display='none'"/>
</p>

<p align="center">
  <strong>Dual-protocol local AI gateway that drives web AI interfaces through headless browser sessions.</strong><br/>
  Compatible with OpenAI (<code>/v1/chat/completions</code>) and Anthropic (<code>/v1/messages</code>) wire protocols.
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-v1.4+-black?style=flat-square&logo=bun" alt="Bun"/></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-Strict-blue?style=flat-square&logo=typescript" alt="TypeScript Strict"/></a>
  <a href="https://turbo.build"><img src="https://img.shields.io/badge/Turborepo-Monorepo-ef4444?style=flat-square&logo=turborepo" alt="Turborepo"/></a>
  <a href="https://hono.dev"><img src="https://img.shields.io/badge/Hono-v4-E36002?style=flat-square&logo=hono" alt="Hono"/></a>
  <a href="https://playwright.dev"><img src="https://img.shields.io/badge/Playwright-Stealth-2EAD33?style=flat-square&logo=playwright" alt="Playwright"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License MIT"/></a>
  <img src="https://img.shields.io/badge/Tests-62%20Passing-brightgreen?style=flat-square" alt="Tests"/>
</p>

---

## Overview

**OmniChat Harness** is a local API proxy that bridges AI developer agents (OpenCode, Claude Code, Cursor, Cline, Aider, LangChain) with consumer AI chat web interfaces (**ChatGPT**, **Claude**, **Perplexity**, and **Gemini**).

Instead of requiring paid API token credits for every single token query during local coding and experimentation, OmniChat runs local, headless Chromium browser sessions in the background, coordinates mouse/keystroke execution, and exposes **drop-in compatible standard HTTP endpoints**.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                   AI Agents, Developer Tools & Frameworks                      │
│     OpenCode · Claude Code · Cursor · Cline · Aider · OpenAI SDK · Anthropic   │
└───────────────────────┬────────────────────────────────┬───────────────────────┘
                        │ OpenAI Wire Protocol           │ Anthropic Wire Protocol
                        │ POST /v1/chat/completions      │ POST /v1/messages
                        ▼                                ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                           OmniChat Gateway (:3132)                             │
│                                                                                │
│  ├── Universal Base URL Router (supports /v1, root /, /api/v1, /v1/v1)        │
│  ├── Dual Protocol Normalizer (OpenAI JSON/SSE ↔ Anthropic Messages/SSE)      │
│  ├── Fuzzy Model Alias Engine (gpt-4o, claude-3-5-sonnet, gemini-pro)          │
│  ├── Universal Tool Call Parser (Markdown JSON, XML, bare objects)             │
│  └── Automatic Router Failover & Health Checks                                 │
└───────────────────────┬────────────────────────────────┬───────────────────────┘
                        │                                │
                        ▼                                ▼
┌───────────────────────────────────┐        ┌───────────────────────────────────┐
│     Playwright Stealth Pool       │        │     AES-256-GCM Session Vault     │
│  • Headless Chromium Engine       │        │  • Zero-login anonymous support   │
│  • Native coordinate mouse clicks │        │  • Encrypted cookies & storage    │
│  • Non-empty stability poll loops │        │  • Zero secrets in server logs    │
└─────────────────┬─────────────────┘        └─────────────────┬─────────────────┘
                  │                                            │
                  ▼                                            ▼
   ┌──────────────┬──────────────┬──────────────┬──────────────┐
   │   ChatGPT    │  Claude Web  │  Perplexity  │    Gemini    │
   │  (Web UI)    │  (Web UI)    │  (Web UI)    │  (Web UI)    │
   └──────────────┴──────────────┴──────────────┴──────────────┘
```

---

## Key Features

- **Dual-Protocol Gateway:**
  - **OpenAI Compatible (`POST /v1/chat/completions`):** Full support for Server-Sent Events (`stream: true`), non-streaming completions, and model discovery (`GET /v1/models`).
  - **Anthropic Compatible (`POST /v1/messages`):** Native support for Anthropic Messages API, `x-api-key` authentication, and the Anthropic streaming lifecycle (`message_start` → `content_block_delta` → `message_stop`).
- **Universal Base URL Normalization:**
  - Works with any base URL configuration: `http://localhost:3132/v1`, root `http://localhost:3132`, OpenRouter style `http://localhost:3132/api/v1`, or nested `/v1/v1`.
- **Full Tool & Function Calling:**
  - Accepts standard tool definitions (`tools` in OpenAI schema or `input_schema` in Anthropic schema).
  - Automatically parses tool executions (JSON blocks, XML tags, or raw objects) and delivers structured `tool_calls` / `tool_use` back to the calling agent.
- **Fuzzy Model Aliasing & Graceful Failover:**
  - Request standard commercial model identifiers (`gpt-4o`, `gpt-4`, `claude-3-5-sonnet`, `gemini-1.5-pro`, `sonar-medium`).
  - Automatically routes to the optimal backend and fails over to active providers if a provider is unauthenticated.
- **Zero-Login & Encrypted Session Persistence:**
  - Headless anonymous operation for ChatGPT and Perplexity out of the box.
  - Interactive login wizard (`bun run session:init`) saving AES-256-GCM encrypted browser cookies to `data/sessions/`.
- **Interactive ANSI Terminal Dashboard (`@omni/tui`):**
  - Standalone terminal monitoring dashboard providing real-time provider readiness, browser context states, and health metrics.

---

## Execution Modes

Every request routes dynamically based on the requested `model` parameter:

### 1. Direct Passthrough (`chatgpt`, `gemini`, `claude-web`, `perplexity`)
Zero overhead. Routes directly to the designated provider's web session:
```json
{ "model": "chatgpt" }    // Direct ChatGPT headless session
{ "model": "perplexity" } // Direct Perplexity real-time search
{ "model": "claude-web" } // Direct Claude session
{ "model": "gemini" }     // Direct Gemini session (1M context)
```

### 2. Commercial Aliases (Automatic Resolution)
You don't need to reconfigure hardcoded model strings in your agents:
```json
{ "model": "gpt-4o" }              // Resolves to ChatGPT
{ "model": "claude-3-5-sonnet" }   // Resolves to Claude (fails over to ChatGPT if offline)
{ "model": "gemini-1.5-pro" }      // Resolves to Gemini
{ "model": "sonar-medium" }        // Resolves to Perplexity
```

### 3. Multi-Provider Orchestration (`omni-*`)
OmniChat plans, fans out requests in parallel across multiple providers, and synthesizes results:
```json
{ "model": "omni-code" }      // ChatGPT generates, Claude reviews, Gemini explains
{ "model": "omni-research" }  // Gemini researches, Perplexity cites, Claude analyzes
{ "model": "omni-fast" }      // Automatically routes to the fastest available provider
{ "model": "omni-consensus" } // All providers in parallel, synthesized by majority agreement
```

---

## Quick Start

### 1. Prerequisites
- [Bun](https://bun.sh) (v1.1 or higher)
- Google Chrome, Chromium, or Microsoft Edge installed on your machine

```bash
# Clone the repository
git clone https://github.com/ziuus/omnichat-harness.git
cd omnichat-harness

# Install dependencies across all monorepo packages
bun install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Default configuration uses port `3000` (or set `PORT=3132`):
```ini
PORT=3132
OMNI_API_KEY=omni-local-dev-key
SESSION_ENCRYPTION_KEY=dev-key-change-in-production!!
BROWSER_HEADLESS=true
```

### 3. Launch the Server
```bash
# Start server in development mode (with hot reloading)
bun run dev:server

# Or run in standard mode
PORT=3132 bun run start:server
```

You'll see:
```text
╔═══════════════════════════════════════╗
║      OmniChat Harness v0.1.0          ║
║  OpenAI-compatible multi-agent server ║
╚═══════════════════════════════════════╝

✓ OmniChat Harness running at http://localhost:3132

  Point your AI agent at:
    OPENAI_BASE_URL=http://localhost:3132/v1
    OPENAI_API_KEY=omni-local-dev-key

  Available endpoints:
    POST http://localhost:3132/v1/chat/completions (OpenAI)
    POST http://localhost:3132/v1/messages         (Anthropic)
    GET  http://localhost:3132/v1/models           (Discovery)
    GET  http://localhost:3132/health             (Status)
```

### 4. Optional: Terminal Dashboard
Launch the ANSI monitoring dashboard in another terminal window:
```bash
OMNI_SERVER_URL=http://localhost:3132 bun run start:tui
```

---

## Connecting Your Agents & Tools

### OpenCode
In [`opencode.json`](file:///home/zius/Projects/omnichat-harness/test-opencode-workspace/opencode.json):
```json
{
  "provider": {
    "omnichat": {
      "name": "OmniChat",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "apiKey": "omni-local-dev-key",
        "baseURL": "http://localhost:3132/v1"
      },
      "models": {
        "chatgpt": { "name": "chatgpt" }
      }
    }
  },
  "model": "omnichat/chatgpt"
}
```

### Claude Code CLI / Anthropic SDK
OmniChat directly supports the Anthropic Messages wire protocol:
```bash
export ANTHROPIC_BASE_URL="http://localhost:3132"
export ANTHROPIC_API_KEY="omni-local-dev-key"
```

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  baseURL: 'http://localhost:3132',
  apiKey: 'omni-local-dev-key',
});

const message = await anthropic.messages.create({
  model: 'claude-3-5-sonnet',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Analyze this algorithm.' }],
});
console.log(message.content[0].text);
```

### Cursor & Cline
In Cursor or VS Code Cline settings:
- **Provider:** OpenAI / OpenAI-compatible
- **Base URL:** `http://localhost:3132/v1`
- **API Key:** `omni-local-dev-key`
- **Model ID:** `gpt-4o` or `omni-code`

### Aider
```bash
aider --openai-api-base http://localhost:3132/v1 \
      --openai-api-key omni-local-dev-key \
      --model gpt-4o
```

### Python OpenAI SDK & LangChain
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3132/v1",
    api_key="omni-local-dev-key",
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "What is the capital of France?"}],
)
print(response.choices[0].message.content)
```

---

## API Reference

### 1. `POST /v1/chat/completions` (OpenAI Format)
- **Aliases:** `/chat/completions`, `/api/v1/chat/completions`
- **Headers:** `Authorization: Bearer <KEY>`, `Content-Type: application/json`
- **Body:** Standard OpenAI chat completions payload (`model`, `messages`, `tools`, `stream`).

### 2. `POST /v1/messages` (Anthropic Format)
- **Aliases:** `/messages`, `/api/v1/messages`, `/v1/v1/messages`
- **Headers:** `x-api-key: <KEY>` or `Authorization: Bearer <KEY>`, `anthropic-version: 2023-06-01`
- **Body:** Standard Anthropic payload (`model`, `messages`, `system`, `tools`, `stream`).

### 3. `GET /v1/models`
- **Aliases:** `/models`, `/api/v1/models`
- Returns OpenAI-standard `{"object": "list", "data": [...]}` containing all registered models and routing metadata.

### 4. `GET /health`
- Returns detailed status for browser pool contexts, uptime, and provider readiness.

---

## Testing & Verification

OmniChat includes a comprehensive test suite across monorepo packages, as well as end-to-end agentic verification scripts:

```bash
# Run unit and integration tests (62 tests across 9 files)
bun test

# Run monorepo typechecks across all 8 packages
bun x turbo typecheck

# Run automated system self-test (Health, Completions, SSE, Tool Calls, Multi-Turn)
PORT=3132 bun run scripts/system-self-test.ts

# Run autonomous coding agent loop with real developer tools
PORT=3132 bun run scripts/autonomous-coding-agent.ts "Implement an LRU cache module with unit tests"
```

---

## Monorepo Architecture

```
omnichat-harness/
├── apps/
│   ├── server/             # Hono gateway exposing OpenAI + Anthropic endpoints
│   └── tui/                # Terminal dashboard (ANSI, zero external UI dependencies)
├── packages/
│   ├── core/               # Orchestrator, TaskRouter, schema compaction & types
│   ├── openai-adapter/     # Wire format conversions, SSEEmitter, ToolCallParser, ModelRegistry
│   ├── providers/          # Headless browser adapters (ChatGPT, Claude, Gemini, Perplexity)
│   ├── browser/            # Playwright pool, stealth launch flags, AES-256-GCM vault
│   ├── queue/              # Background request queueing (BullMQ integration)
│   └── db/                 # Drizzle ORM + SQLite database layer
├── scripts/
│   ├── system-self-test.ts        # Automated 5-stage health & completion test
│   ├── autonomous-coding-agent.ts # Real multi-turn autonomous coding loop
│   └── session-init.ts            # Interactive login wizard for browser sessions
└── test-agent-workspace/   # Isolated workspace for agent tests and generated modules
```

---

## Security & Ethics

- **Encrypted Local Storage:** Browser cookies and storage states are encrypted at rest using AES-256-GCM under `data/sessions/`. Never commit `.env` or `data/` directories.
- **Audit-Safe Logging:** No tokens, decrypted session states, or sensitive cookies are ever logged.
- **Terms of Service:** This project drives browser automation for local development, research, and testing. Review and comply with the respective Terms of Service for each web service you interact with.

---

## License

[MIT](./LICENSE) © 2026 OmniChat Contributors
