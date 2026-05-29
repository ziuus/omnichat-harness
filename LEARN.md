# How it Works: Building the OmniChat Harness

Welcome! This guide explains the technical architecture behind OmniChat Harness and how you can learn from it or extend it.

## The Problem
Most AI applications depend on expensive, rate-limited APIs. Meanwhile, your own browser can access the same models via their official web interfaces. OmniChat Harness bridges this gap by acting as a "harness" that drives your browser like a human would, exposing an OpenAI-compatible API to the rest of your tools.

## Core Tech Stack
- **Runtime:** [Bun](https://bun.sh) (Fastest JS runtime with native TS support)
- **Framework:** [Hono](https://hono.dev) (Ultra-fast, lightweight web framework)
- **Browser Automation:** [Playwright](https://playwright.dev) with Stealth extensions
- **Database:** [SQLite](https://sqlite.org) + [Drizzle ORM](https://orm.drizzle.team)
- **Task Queue:** [BullMQ](https://docs.bullmq.io) + [Redis](https://redis.io)
- **UI:** ANSI-based Terminal Dashboard (TUI)

## 1. The Stealth Browser Engine (`packages/browser`)
The heart of the project is the stealth configuration. We use Playwright to launch system browsers (Chrome/Edge/Chromium) with specific flags to bypass bot detection:
- **Stealth Args:** `--disable-blink-features=AutomationControlled`, `--no-sandbox`, etc.
- **System Browser Selection:** Instead of downloading bulky browser binaries, we detect and use the browser already on your machine.
- **Anonymous Mode:** We patched the engine to allow "anonymous" sessions where the public UI permits, making it easier for new users to get started.

## 2. Encrypted Session Management
Security is paramount. When you run `bun run session:init`, we launch a browser for you to log in.
- **AES-256-GCM:** Your browser cookies and local storage are saved as encrypted blobs in `data/sessions/*.enc`.
- **Encryption Key:** Controlled by your `SESSION_ENCRYPTION_KEY` environment variable.
- **No Leaks:** The codebase is strictly audited to never log cookies, session contents, or decrypted storage.

## 3. The OpenAI Adapter (`packages/openai-adapter`)
To make OmniChat "drop-in" compatible with tools like OpenCode, Cursor, and Cline, we map OpenAI's `/v1/chat/completions` request/response format to our internal browser drivers.
- **Request Parsing:** We extract the prompt and system instructions.
- **Human-like Delays:** We inject random pauses between keystrokes to mimic human behavior.
- **Response Streaming:** We stream tokens back from the browser's DOM in real-time.

## 4. The Terminal Dashboard (`apps/tui`)
We built a lean, dependency-free TUI using ANSI escape codes.
- **Controller-View Pattern:** A clear separation between the API fetching logic and the rendering engine.
- **Concurrent Polishing:** The TUI fetches health status and model lists concurrently to stay responsive.
- **One-shot Mode:** Supports a `--once` flag for CI/CD or logging snapshots.

## 5. Development Workflow
We use **Bun Workspaces** and **Turborepo** to manage our monorepo. This allows us to share types and logic easily between the server and the TUI.

### Key Learning Points
- **Architecture:** Monorepo design using `@omni/` scoped packages.
- **Browser Control:** Using `page.waitForSelector` and `page.type` with human delays.
- **API Design:** Wrapping a non-standard interface (a website) into a standard API (OpenAI).

## Next Steps
- Try adding a new provider in `packages/providers`.
- Improve the TUI's task feed by adding an SSE (Server-Sent Events) endpoint to the server.
- Explore the `packages/queue` logic to see how multiple requests are handled via BullMQ.
