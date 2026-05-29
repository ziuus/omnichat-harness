# Contributing

Thanks for helping improve OmniChat Harness.

## Local setup

```bash
bun install
cp .env.example .env
bun run session:init chatgpt
bun run dev:server
```

Use `bun run start:tui -- --once` for a quick dashboard smoke check.

## Development rules

- Keep TypeScript strict and avoid `any`.
- Use ESM `.js` import suffixes in TypeScript source.
- Do not log cookies, encrypted session payloads, API keys, or browser storage contents.
- Do not remove human-like browser delays.
- Keep provider DOM selectors isolated inside provider packages.
- Treat model names as routing keys.

## Checks before a PR

```bash
bun run typecheck
bun test
```

If you change browser automation, test at least one provider manually with `session:init` and an OpenAI-compatible request.
