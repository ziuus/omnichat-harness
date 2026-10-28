# Architecture Deep-Dive: Building OmniChat Harness

Welcome! This guide explains the technical architecture behind **OmniChat Harness**, detailing how consumer AI chat web interfaces are transformed into standard, drop-in LLM endpoints for agentic tools.

---

## 1. The Core Problem

Modern developer tools (Cursor, Claude Code, OpenCode, Aider) rely on standard API protocols (OpenAI `chat/completions` or Anthropic `messages`). However, during development and heavy agentic loops:
1. Pay-per-token API bills accumulate rapidly.
2. Web interfaces (ChatGPT Plus/Free, Claude, Gemini, Perplexity) often offer generous or zero-login interactive access, but lack an OpenAI/Anthropic-compatible wire protocol.

OmniChat Harness acts as an autonomous headless driver that bridges this gap, translating standard API requests into real browser DOM actions and streaming parsed results back.

---

## 2. Core Tech Stack

- **Runtime:** [Bun](https://bun.sh) (Native TypeScript compilation, fast test runner, package manager)
- **Framework:** [Hono](https://hono.dev) (High-performance web server supporting SSE streaming)
- **Browser Automation:** [Playwright](https://playwright.dev) with Stealth flags & coordinate click emulation
- **Database & Queue:** [SQLite](https://sqlite.org) + [Drizzle ORM](https://orm.drizzle.team) + [BullMQ](https://docs.bullmq.io)
- **Dashboard:** ANSI-based Terminal User Interface (`@omni/tui`)

---

## 3. Dual-Protocol Adapter Layer

OmniChat provides complete protocol parity for both OpenAI and Anthropic clients:

### A. OpenAI Adapter (`packages/openai-adapter`)
- Exposes `POST /v1/chat/completions` and `GET /v1/models`.
- Maps incoming `messages`, `tools`, and `stream` flags to internal `TaskInput`.
- [`SSEEmitter`](file:///home/zius/Projects/omnichat-harness/packages/openai-adapter/src/SSEEmitter.ts) streams delta chunks and handles keep-alive heartbeats.

### B. Anthropic Messages Adapter (`apps/server/src/routes/messages.ts`)
- Exposes native `POST /v1/messages`.
- Accepts `x-api-key` header and Anthropic tool definitions (`input_schema`).
- Implements the Anthropic SSE lifecycle:
  `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`.

### C. Universal Base URL Router (`apps/server/src/app.ts`)
SDKs and developer tools construct base URLs in varying ways. The gateway automatically normalizes:
- OpenAI standard: `http://localhost:3132/v1`
- Root style: `http://localhost:3132` (routes `/chat/completions` and `/messages`)
- OpenRouter format: `http://localhost:3132/api/v1`
- Nested prefixes: `http://localhost:3132/v1/v1/messages` (prevents SDK `/v1` duplication)

---

## 4. Universal Tool Call Parser & Compaction

External agents like OpenCode attach 10–20 developer tools (bash, file editor, glob, grep), which can blow prompt sizes to over 100 KB.

1. **Tool Schema Compaction ([`Orchestrator.ts`](file:///home/zius/Projects/omnichat-harness/packages/core/src/orchestrator/Orchestrator.ts)):**
   - Truncates verbose property descriptions to essential types and constraints.
   - Reduces prompt injection sizes from ~119 KB to under 6 KB, dramatically accelerating browser typing and web UI backend generation.
2. **Universal Tool Call Parser ([`ToolCallParser.ts`](file:///home/zius/Projects/omnichat-harness/packages/openai-adapter/src/ToolCallParser.ts)):**
   - Parses LLM tool calls formatted as Markdown JSON blocks (` ```json {"tool_calls": [...]} ``` `).
   - Supports XML-style `<tool_call>` tags and bare JSON objects.
   - Emits structured `tool_calls` (OpenAI) or `tool_use` (Anthropic) blocks back to the agent.

---

## 5. Stealth Browser Pool & DOM Coordination

Web chat applications (ChatGPT, Claude, Gemini) use modern reactive frameworks (React/Next.js) with anti-bot protections:

- **Coordinate Center Clicks:** React submit buttons often encapsulate nested SVG elements that swallow Playwright synthetic `.click()` events. The driver computes the element's bounding box center and performs real hardware mouse clicks.
- **Draft Buffer Clearing:** Simulates `Ctrl+A` + `Backspace` with settle delays to prevent cross-request prompt concatenation.
- **Non-Empty Response Stability Loops:** Avoids premature extraction by requiring assistant message bodies to contain non-header content (`cleanResponse(text).length > 0`) before counting stability cycles.
- **AES-256-GCM Vault:** Cookies and session storage states are encrypted at rest under `data/sessions/` using your `SESSION_ENCRYPTION_KEY`.

---

## 6. Monorepo Structure

```
omnichat-harness/
├── apps/
│   ├── server/             # Hono HTTP gateway (OpenAI + Anthropic routes)
│   └── tui/                # ANSI monitoring dashboard
├── packages/
│   ├── core/               # Orchestration, TaskRouter, schema compaction
│   ├── openai-adapter/     # ModelRegistry, ToolCallParser, SSEEmitter
│   ├── providers/          # Browser drivers: ChatGPT, Claude, Gemini, Perplexity
│   ├── browser/            # Playwright pool, stealth flags, encrypted storage
│   ├── queue/              # BullMQ background task processing
│   └── db/                 # Drizzle ORM + SQLite
└── scripts/
    ├── system-self-test.ts        # Automated 5-stage health & completion test
    └── autonomous-coding-agent.ts # Real multi-turn autonomous coding loop
```
