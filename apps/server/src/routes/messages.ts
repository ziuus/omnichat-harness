// apps/server/src/routes/messages.ts
// POST /v1/messages — Native Anthropic Messages API compatibility endpoint

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { randomUUID } from 'crypto';
import { ModelRegistry, ToolCallParser } from '@omni/openai-adapter';
import { ProviderRegistry } from '@omni/providers';
import { TaskRouter, Orchestrator, type TaskInput, type ConversationMessage } from '@omni/core';

const app = new Hono();
const router = new TaskRouter();
const orchestrator = new Orchestrator();

app.post('/', async (c) => {
  let body: any;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400);
  }

  const modelName = body.model || 'claude-web';
  console.log(`[messages] Incoming Anthropic request: model=${modelName}, stream=${Boolean(body.stream)}, tools=${body.tools?.length ?? 0}, messages=${body.messages?.length ?? 0}`);

  const registry = ModelRegistry.getInstance();
  const modelConfig = registry.get(modelName);
  if (!modelConfig) {
    return c.json(
      { type: 'error', error: { type: 'not_found_error', message: `Model '${modelName}' not found` } },
      404,
    );
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'messages array is required and must not be empty' } },
      400,
    );
  }

  // Extract system prompt
  let systemContext: string | undefined;
  if (typeof body.system === 'string') {
    systemContext = body.system;
  } else if (Array.isArray(body.system)) {
    systemContext = body.system.map((s: any) => s.text || '').join('\n');
  }

  // Convert Anthropic messages into ConversationMessage[] and last user prompt
  const conversationMessages: ConversationMessage[] = [];
  let lastUserPrompt = '';

  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      conversationMessages.push({ role: msg.role, content: msg.content });
      if (msg.role === 'user') lastUserPrompt = msg.content;
    } else if (Array.isArray(msg.content)) {
      let combinedText = '';
      for (const part of msg.content) {
        if (part.type === 'text') {
          combinedText += (combinedText ? '\n' : '') + (part.text || '');
        } else if (part.type === 'tool_use') {
          conversationMessages.push({
            role: 'assistant',
            content: '',
            toolCalls: [{
              id: part.id || `toolu_${randomUUID().slice(0, 12)}`,
              type: 'function',
              function: {
                name: part.name,
                arguments: JSON.stringify(part.input ?? {}),
              },
            }],
          });
        } else if (part.type === 'tool_result') {
          const resContent = typeof part.content === 'string'
            ? part.content
            : Array.isArray(part.content)
              ? part.content.map((p: any) => p.text || '').join('\n')
              : JSON.stringify(part.content ?? {});
          conversationMessages.push({
            role: 'tool',
            content: resContent,
            toolCallId: part.tool_use_id,
          });
        }
      }

      if (combinedText) {
        conversationMessages.push({ role: msg.role, content: combinedText });
        if (msg.role === 'user') lastUserPrompt = combinedText;
      }
    }
  }

  // Convert Anthropic tools (input_schema) into OpenAI/OmniChat tools (parameters)
  const convertedTools = Array.isArray(body.tools)
    ? body.tools.map((t: any) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || { type: 'object', properties: {} },
        },
      }))
    : undefined;

  const taskInput: TaskInput = {
    prompt: lastUserPrompt,
    messages: conversationMessages,
    executionMode: modelConfig.mode,
    modelId: modelConfig.id,
    ...(convertedTools && convertedTools.length > 0 ? { tools: convertedTools } : {}),
    ...(systemContext ? { systemContext } : {}),
  };

  const providerRegistry = ProviderRegistry.getInstance();

  if (modelConfig.mode === 'passthrough' && modelConfig.provider) {
    try {
      const provider = providerRegistry.get(modelConfig.provider);
      const ready = await provider.isReady();
      if (!ready) {
        await provider.initialize();
      }
    } catch (err) {
      console.warn(`[messages] On-demand initialization for ${modelConfig.provider} failed:`, err);
    }
  }

  const statusSnapshot = await providerRegistry.getStatusSnapshot();
  const availability = Object.entries(statusSnapshot).map(([id, status]) => ({ id, status }));

  let decision;
  try {
    decision = router.route(taskInput, modelConfig, availability);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ type: 'error', error: { type: 'api_error', message: msg } }, 503);
  }

  const providerEntries = decision.selectedProviders
    .map((id) => {
      try {
        return [id, providerRegistry.get(id)] as [string, ReturnType<ProviderRegistry['get']>];
      } catch {
        return null;
      }
    })
    .filter((entry): entry is [string, ReturnType<ProviderRegistry['get']>] => entry !== null);
  const providerMap = new Map(providerEntries);

  const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const inputTokens = Math.ceil(taskInput.prompt.length / 4) + 10;

  // Non-streaming response
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

      const finalOutput = await orchestrator.execute(taskInput, decision, providerMap, mockEmitter as any);
      const toolResult = ToolCallParser.parse(finalOutput);

      const contentBlocks: any[] = [];
      let stopReason = 'end_turn';

      if (toolResult.hasToolCalls && toolResult.toolCalls.length > 0) {
        stopReason = 'tool_use';
        if (toolResult.cleanContent) {
          contentBlocks.push({ type: 'text', text: toolResult.cleanContent });
        }
        for (const tc of toolResult.toolCalls) {
          let argsObj = {};
          try {
            argsObj = JSON.parse(tc.function.arguments || '{}');
          } catch {
            argsObj = { raw: tc.function.arguments };
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id || `toolu_${randomUUID().slice(0, 12)}`,
            name: tc.function.name,
            input: argsObj,
          });
        }
      } else {
        contentBlocks.push({ type: 'text', text: finalOutput });
      }

      const outputTokens = Math.ceil(finalOutput.length / 4);

      return c.json({
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: body.model || modelConfig.id,
        content: contentBlocks,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ type: 'error', error: { type: 'api_error', message: msg } }, 500);
    }
  }

  // Streaming response (Anthropic SSE)
  return stream(c, async (streamWriter) => {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('Connection', 'keep-alive');

    const writeEvent = async (event: string, data: Record<string, any>) => {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      await streamWriter.write(new TextEncoder().encode(payload));
    };

    // 1. message_start
    await writeEvent('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: body.model || modelConfig.id,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 1 },
      },
    });

    // 2. content_block_start
    await writeEvent('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });

    let fullAccumulated = '';
    const streamProxy = {
      sendRoleChunk: async () => {},
      sendDelta: async (delta: string) => {
        fullAccumulated += delta;
        await writeEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: delta },
        });
      },
      streamText: async (text: string) => {
        fullAccumulated = text;
        await writeEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: text },
        });
      },
    };

    const keepAlive = setInterval(() => {
      streamWriter.write(new TextEncoder().encode(': keep-alive\n\n')).catch(() => {});
    }, 2000);

    try {
      await orchestrator.execute(taskInput, decision, providerMap, streamProxy as any);

      // Check if output contained tool calls
      const toolResult = ToolCallParser.parse(fullAccumulated);
      let stopReason = 'end_turn';

      await writeEvent('content_block_stop', {
        type: 'content_block_stop',
        index: 0,
      });

      if (toolResult.hasToolCalls && toolResult.toolCalls.length > 0) {
        stopReason = 'tool_use';
        for (let i = 0; i < toolResult.toolCalls.length; i++) {
          const tc = toolResult.toolCalls[i]!;
          let argsObj = {};
          try {
            argsObj = JSON.parse(tc.function.arguments || '{}');
          } catch {
            argsObj = { raw: tc.function.arguments };
          }

          const blockIdx = i + 1;
          await writeEvent('content_block_start', {
            type: 'content_block_start',
            index: blockIdx,
            content_block: {
              type: 'tool_use',
              id: tc.id || `toolu_${randomUUID().slice(0, 12)}`,
              name: tc.function.name,
              input: argsObj,
            },
          });
          await writeEvent('content_block_stop', {
            type: 'content_block_stop',
            index: blockIdx,
          });
        }
      }

      const outputTokens = Math.ceil(fullAccumulated.length / 4);

      // 4. message_delta
      await writeEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outputTokens },
      });

      // 5. message_stop
      await writeEvent('message_stop', { type: 'message_stop' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await writeEvent('error', { type: 'error', error: { type: 'api_error', message: msg } }).catch(() => {});
    } finally {
      clearInterval(keepAlive);
    }
  });
});

export default app;
