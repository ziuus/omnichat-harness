import { beforeEach, describe, expect, it } from 'bun:test';
import { createApp } from '../app.js';
import { ModelRegistry, DEFAULT_MODEL_CONFIGS } from '@omni/openai-adapter';
import { ProviderRegistry, MockProvider } from '@omni/providers';

describe('OmniChat server integration', () => {
  beforeEach(() => {
    ModelRegistry.getInstance().loadFromConfig(DEFAULT_MODEL_CONFIGS);

    const providerRegistry = ProviderRegistry.getInstance();
    providerRegistry.clear();
    providerRegistry.register(new MockProvider('chatgpt', 'Mock ChatGPT', 'mock passthrough response'));
    providerRegistry.register(new MockProvider('gemini', 'Mock Gemini', 'mock gemini response'));
    providerRegistry.register(new MockProvider('claude-web', 'Mock Claude', 'mock claude response'));
    providerRegistry.register(new MockProvider('perplexity', 'Mock Perplexity', 'mock perplexity response'));
  });

  it('serves /v1/models', async () => {
    const app = createApp();
    const response = await app.request('/v1/models', {
      headers: { Authorization: 'Bearer omni-local-dev-key' },
    });

    expect(response.status).toBe(200);

    const body = await response.json() as { object: string; data: Array<{ id: string }> };
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((model: { id: string }) => model.id === 'chatgpt')).toBe(true);
  });

  it('serves /health without requiring initialized browsers', async () => {
    const app = createApp();
    const response = await app.request('/health');

    expect(response.status).toBe(200);

    const body = await response.json() as { status: string; providers: unknown };
    expect(typeof body.status).toBe('string');
    expect(body.providers).toBeDefined();
  });

  it('streams passthrough completions over SSE with a mock provider', async () => {
    const app = createApp();
    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer omni-local-dev-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'chatgpt',
        stream: true,
        messages: [{ role: 'user', content: 'Say hi' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const text = await response.text();
    expect(text).toContain('"content":"mock "');
    expect(text).toContain('"content":"passthrough "');
    expect(text).toContain('"content":"response"');
    expect(text).toContain('data: [DONE]');
  });

  it('handles tool calls in non-streaming completions', async () => {
    const providerRegistry = ProviderRegistry.getInstance();
    const toolCallPayload = 'I will fetch the weather.\n```json\n{"tool_calls":[{"type":"function","function":{"name":"get_weather","arguments":{"location":"Tokyo"}}}]}\n```';
    providerRegistry.register(new MockProvider('chatgpt', 'Mock ChatGPT', toolCallPayload));

    const app = createApp();
    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer omni-local-dev-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'chatgpt',
        stream: false,
        messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: { location: { type: 'string' } } },
          },
        }],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
    expect(body.choices[0].message.tool_calls[0].function.name).toBe('get_weather');
    expect(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments)).toEqual({ location: 'Tokyo' });
    expect(body.choices[0].message.content).toBe('I will fetch the weather.');
  });

  it('streams tool calls in SSE completions', async () => {
    const providerRegistry = ProviderRegistry.getInstance();
    const toolCallPayload = '```json\n{"tool_calls":[{"type":"function","function":{"name":"search","arguments":{"query":"bun test"}}}]}\n```';
    providerRegistry.register(new MockProvider('chatgpt', 'Mock ChatGPT', toolCallPayload));

    const app = createApp();
    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer omni-local-dev-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'chatgpt',
        stream: true,
        messages: [{ role: 'user', content: 'Search for bun test' }],
        tools: [{
          type: 'function',
          function: {
            name: 'search',
            description: 'Search documentation',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const text = await response.text();
    expect(text).toContain('"tool_calls":');
    expect(text).toContain('"name":"search"');
    expect(text).toContain('"finish_reason":"tool_calls"');
    expect(text).toContain('data: [DONE]');
  });

  it('serves /v1/messages in Anthropic format with tool_use and fuzzy model aliases', async () => {
    const providerRegistry = ProviderRegistry.getInstance();
    const toolCallPayload = '```json\n{"name":"lookup","arguments":{"query":"hello"}}\n```';
    providerRegistry.register(new MockProvider('claude-web', 'Mock Claude', toolCallPayload));

    const app = createApp();
    const response = await app.request('/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'omni-local-dev-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Lookup hello' }],
        tools: [{
          name: 'lookup',
          description: 'Lookup item',
          input_schema: { type: 'object', properties: { query: { type: 'string' } } },
        }],
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.type).toBe('message');
    expect(json.role).toBe('assistant');
    expect(json.stop_reason).toBe('tool_use');
    expect(json.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool_use',
        name: 'lookup',
        input: { query: 'hello' },
      }),
    ]));
  });

  it('streams /v1/messages in Anthropic SSE format', async () => {
    const providerRegistry = ProviderRegistry.getInstance();
    providerRegistry.register(new MockProvider('claude-web', 'Mock Claude', 'Anthropic streaming reply'));

    const app = createApp();
    const response = await app.request('/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'omni-local-dev-key',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku',
        stream: true,
        messages: [{ role: 'user', content: 'Say hi' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const sse = await response.text();
    expect(sse).toContain('event: message_start');
    expect(sse).toContain('event: content_block_start');
    expect(sse).toContain('event: content_block_delta');
    expect(sse).toContain('event: content_block_stop');
    expect(sse).toContain('event: message_delta');
    expect(sse).toContain('event: message_stop');
    expect(sse).toContain('Anthropic streaming reply');
  });

  it('handles all base URL variations across OpenAI, Anthropic, and OpenRouter formats', async () => {
    const providerRegistry = ProviderRegistry.getInstance();
    providerRegistry.register(new MockProvider('chatgpt', 'Mock ChatGPT', 'hello from base url alias'));
    const app = createApp();

    // 1. OpenAI without /v1 in base URL
    const resNoV1 = await app.request('/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer omni-local-dev-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'chatgpt', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(resNoV1.status).toBe(200);

    // 2. OpenRouter format (/api/v1)
    const resOpenRouter = await app.request('/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer omni-local-dev-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(resOpenRouter.status).toBe(200);

    // 3. Anthropic with /v1 in base URL (resulting in /v1/v1/messages)
    const resAnthropicDoubleV1 = await app.request('/v1/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'omni-local-dev-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(resAnthropicDoubleV1.status).toBe(200);

    // 4. Anthropic direct /messages
    const resAnthropicDirect = await app.request('/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'omni-local-dev-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(resAnthropicDirect.status).toBe(200);
  });
});
