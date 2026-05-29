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
});
