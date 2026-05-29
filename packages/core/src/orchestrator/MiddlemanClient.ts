// packages/core/src/orchestrator/MiddlemanClient.ts
// Connects to the user's configured LLM and runs a tool-calling loop
// The middleman receives provider tools and orchestrates them

import type { MiddlemanConfig } from '../types/Routing.js';
import type { Provider, ProviderResponse } from '../types/Provider.js';
import type { TaskInput } from '../types/Task.js';

interface StreamEmitter {
  sendDelta(text: string): Promise<void>;
  streamText(text: string): Promise<void>;
}

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an intelligent research and task orchestration agent.

You have access to multiple AI assistants as tools. Your job is to:
1. Analyze the user's request carefully
2. Decide which AI assistants to use and what to ask each one
3. Use the tools to gather information from multiple sources
4. Synthesize the results into a comprehensive, well-structured final answer

Available tools represent different AI assistants, each with different strengths:
- ask_chatgpt: Good for code generation, creative tasks, broad knowledge
- ask_gemini: Best for long documents, multimodal tasks, research
- ask_claude_web: Best for nuanced analysis, writing quality, reasoning
- ask_perplexity: Best for real-time information, citations, recent events
- ask_all_parallel: Query multiple assistants simultaneously

Guidelines:
- For research tasks: use ask_perplexity for current info, ask_gemini for depth
- For coding tasks: use ask_chatgpt to generate, ask_claude_web to review
- For analysis: use ask_claude_web, compare with ask_gemini
- Always synthesize results into one coherent, attributed answer
- If providers disagree, note the disagreement and explain which view is better supported`;

// Tool definitions exposed to the middleman LLM
function buildTools(availableProviders: string[]) {
  const tools = [];

  const providerDescriptions: Record<string, string> = {
    chatgpt: 'ChatGPT — best for code generation, creative tasks, broad general knowledge',
    gemini: 'Gemini — best for long documents, research, multimodal content',
    'claude-web': 'Claude — best for nuanced analysis, careful reasoning, writing quality',
    perplexity: 'Perplexity — best for real-time web search and citations',
  };

  for (const pid of availableProviders) {
    const desc = providerDescriptions[pid] ?? `${pid} AI assistant`;
    tools.push({
      type: 'function' as const,
      function: {
        name: `ask_${pid.replace('-', '_')}`,
        description: `Send a question or task to ${desc}`,
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The question or task to send',
            },
          },
          required: ['prompt'],
        },
      },
    });
  }

  // Parallel query tool
  tools.push({
    type: 'function' as const,
    function: {
      name: 'ask_all_parallel',
      description: 'Send the same question to multiple AI assistants simultaneously',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The question to ask all assistants' },
          providers: {
            type: 'array',
            items: { type: 'string', enum: availableProviders },
            description: 'Which assistants to query (omit for all)',
          },
        },
        required: ['prompt'],
      },
    },
  });

  return tools;
}

export class MiddlemanClient {
  private config: MiddlemanConfig;

  constructor(config: MiddlemanConfig) {
    this.config = config;
  }

  /**
   * Run the middleman agentic loop.
   * The middleman LLM calls tools, we execute them, feed back results, repeat.
   */
  async run(
    input: TaskInput,
    providers: Map<string, Provider>,
    emitter: StreamEmitter,
  ): Promise<string> {
    const tools = buildTools(Array.from(providers.keys()));
    const baseUrl = this.getBaseUrl();

    const messages: Array<{ role: string; content: string | null; tool_calls?: any; tool_call_id?: string }> = [
      { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
      ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    await emitter.sendDelta(`\n*Middleman (${this.config.model}) is planning...*\n\n`);

    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      // Call the middleman LLM
      const response = await this.callLLM(baseUrl, messages, tools);
      const message = response.choices?.[0]?.message;

      if (!message) throw new Error('Middleman LLM returned empty response');

      messages.push({ role: 'assistant', content: message.content, tool_calls: message.tool_calls });

      // If no tool calls — final answer
      if (!message.tool_calls || message.tool_calls.length === 0) {
        const finalText = message.content ?? '';
        await emitter.streamText(finalText);
        return finalText;
      }

      // Execute tool calls
      await emitter.sendDelta(`*Querying providers: ${message.tool_calls.map((t: any) => t.function.name).join(', ')}...*\n\n`);

      const toolResults = await this.executeToolCalls(message.tool_calls, providers, emitter);

      // Add tool results to messages
      for (const result of toolResults) {
        messages.push({
          role: 'tool',
          content: result.content,
          tool_call_id: result.tool_call_id,
        } as any);
      }
    }

    throw new Error('Middleman exceeded maximum iterations');
  }

  private async executeToolCalls(
    toolCalls: any[],
    providers: Map<string, Provider>,
    emitter: StreamEmitter,
  ): Promise<Array<{ tool_call_id: string; content: string }>> {
    const results = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const fnName: string = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments ?? '{}');

        try {
          let content: string;

          if (fnName === 'ask_all_parallel') {
            const targetIds = (args.providers as string[] | undefined)
              ?? Array.from(providers.keys());
            const responses = await this.queryParallel(targetIds, args.prompt, providers);
            content = this.formatParallelResults(responses);
          } else {
            // ask_<provider_id>
            const providerId = fnName.replace('ask_', '').replace('_', '-');
            const provider = providers.get(providerId);
            if (!provider) {
              content = `Error: Provider ${providerId} not available`;
            } else {
              const result = await provider.ask(args.prompt);
              content = `[${providerId}]: ${result.content}`;
              await emitter.sendDelta(`✓ ${providerId} responded (${result.durationMs}ms)\n`);
            }
          }

          return { tool_call_id: toolCall.id, content };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { tool_call_id: toolCall.id, content: `Error from ${fnName}: ${msg}` };
        }
      })
    );

    return results;
  }

  private async queryParallel(
    providerIds: string[],
    prompt: string,
    providers: Map<string, Provider>,
  ): Promise<Array<{ provider: string; content: string; durationMs: number }>> {
    const results = await Promise.allSettled(
      providerIds.map(async (id) => {
        const provider = providers.get(id);
        if (!provider) return { provider: id, content: 'unavailable', durationMs: 0 };
        const result = await provider.ask(prompt);
        return { provider: id, content: result.content, durationMs: result.durationMs };
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  private formatParallelResults(
    results: Array<{ provider: string; content: string; durationMs: number }>,
  ): string {
    return results
      .map((r) => `=== ${r.provider} (${r.durationMs}ms) ===\n${r.content}`)
      .join('\n\n');
  }

  private async callLLM(baseUrl: string, messages: any[], tools: any[]): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      if (this.config.type === 'anthropic') {
        headers['x-api-key'] = this.config.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        delete headers['Authorization'];
      }
    }

    const body = {
      model: this.config.model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 4096,
    };

    const endpoint = this.config.type === 'anthropic'
      ? `${baseUrl}/v1/messages`
      : `${baseUrl}/v1/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Middleman LLM error (${response.status}): ${text}`);
    }

    return response.json();
  }

  private getBaseUrl(): string {
    if (this.config.baseUrl) return this.config.baseUrl;

    switch (this.config.type) {
      case 'openai': return 'https://api.openai.com';
      case 'anthropic': return 'https://api.anthropic.com';
      case 'ollama': return 'http://localhost:11434';
      default: return 'http://localhost:11434';
    }
  }
}
