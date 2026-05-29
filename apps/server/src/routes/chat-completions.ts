// apps/server/src/routes/chat-completions.ts
// POST /v1/chat/completions — the main OpenAI-compatible endpoint

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { ChatCompletionRequest } from '@omni/openai-adapter';
import {
  SSEEmitter,
  generateCompletionId,
  MessageConverter,
  ModelRegistry,
  ResponseFormatter,
} from '@omni/openai-adapter';
import { ProviderRegistry } from '@omni/providers';
import { TaskRouter, Orchestrator } from '@omni/core';

const app = new Hono();
const router = new TaskRouter();
const orchestrator = new Orchestrator();

app.post('/', async (c) => {
  let body: ChatCompletionRequest;

  try {
    body = await c.req.json<ChatCompletionRequest>();
  } catch {
    return c.json(ResponseFormatter.error('Invalid JSON body', 'invalid_request_error'), 400);
  }

  const registry = ModelRegistry.getInstance();
  const modelConfig = registry.get(body.model);
  if (!modelConfig) {
    return c.json(
      ResponseFormatter.error(
        `Model '${body.model}' not found. Use GET /v1/models to list available models.`,
        'invalid_request_error',
        'model_not_found',
      ),
      404,
    );
  }

  if (!body.messages || body.messages.length === 0) {
    return c.json(
      ResponseFormatter.error('messages array is required and must not be empty', 'invalid_request_error'),
      400,
    );
  }

  const input = MessageConverter.toTaskInput(body, modelConfig);

  const providerRegistry = ProviderRegistry.getInstance();
  const statusSnapshot = await providerRegistry.getStatusSnapshot();
  const availability = Object.entries(statusSnapshot).map(([id, status]) => ({ id, status }));

  let decision;
  try {
    decision = router.route(input, modelConfig, availability);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(ResponseFormatter.error(msg, 'service_unavailable'), 503);
  }

  const providerEntries: Array<[string, ReturnType<ProviderRegistry['get']>]> = decision.selectedProviders
    .map((id) => {
      try {
        return [id, providerRegistry.get(id)] as [string, ReturnType<ProviderRegistry['get']>];
      } catch {
        return null;
      }
    })
    .filter((entry): entry is [string, ReturnType<ProviderRegistry['get']>] => entry !== null);
  const providerMap = new Map<string, ReturnType<ProviderRegistry['get']>>(providerEntries);

  const completionId = generateCompletionId();

  if (!body.stream) {
    try {
      const mockEmitter = {
        sendRoleChunk: async () => {},
        sendDelta: async (_text: string) => {},
        streamText: async (_text: string) => {},
        sendDone: async () => {},
        sendError: async (_msg: string) => {},
        isClosed: false,
      } as const;

      const finalOutput = await orchestrator.execute(input, decision, providerMap, mockEmitter as unknown as SSEEmitter);

      return c.json({
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: finalOutput },
          finish_reason: 'stop',
          logprobs: null,
        }],
        usage: {
          prompt_tokens: Math.ceil(input.prompt.length / 4),
          completion_tokens: Math.ceil(finalOutput.length / 4),
          total_tokens: Math.ceil((input.prompt.length + finalOutput.length) / 4),
        },
        system_fingerprint: 'omnichat-harness-v1',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json(ResponseFormatter.error(msg), 500);
    }
  }

  return stream(c, async (streamWriter) => {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('Connection', 'keep-alive');
    c.header('X-Accel-Buffering', 'no');

    const emitter = new SSEEmitter(completionId, body.model);
    emitter.attach({
      write: async (chunk: Uint8Array) => {
        await streamWriter.write(chunk);
      },
      close: async () => {},
    });

    try {
      await orchestrator.execute(input, decision, providerMap, emitter);
      await emitter.sendDone('stop');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[chat-completions] Execution error:', err);
      await emitter.sendError(msg).catch(() => {});
    }
  });
});

export default app;
