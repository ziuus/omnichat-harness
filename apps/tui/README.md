# OmniChat TUI

Local terminal dashboard for monitoring an OmniChat Harness server while coding agents use it through the OpenAI-compatible API.

## Run

```bash
OMNI_SERVER_URL=http://localhost:3000 OMNI_API_KEY=omni-local-dev-key bun run dev:tui
```

For CI/smoke checks that should render once and exit:

```bash
OMNI_SERVER_URL=http://localhost:3000 OMNI_API_KEY=omni-local-dev-key bun run start:tui -- --once
```

Environment:

- `OMNI_SERVER_URL` — server base URL, defaults to `http://localhost:3000`.
- `OMNI_API_KEY` — optional Bearer token for `/v1/models`. The key is never printed.
- `OMNI_TUI_REFRESH_MS` — refresh interval in milliseconds, defaults to `2000`.
- `OMNI_TUI_ONCE` — set to `true` or `1` to render one snapshot and exit.

Flags:

- `--once` — render one snapshot and exit without entering raw terminal mode.

Keyboard:

- `q` or `Ctrl+C` — exit cleanly.
- `r` — refresh immediately.
- `Tab` — switch the focused panel marker.

The task feed is intentionally a placeholder until the backend exposes a task/SSE endpoint.
