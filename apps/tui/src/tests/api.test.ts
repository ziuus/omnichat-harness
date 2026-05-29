import { describe, expect, it } from 'bun:test';
import { normalizeHealth, normalizeModels, normalizeProviderStatus } from '../client/api.js';

describe('TUI API normalization', () => {
  it('normalizes health payloads from the server', () => {
    const health = normalizeHealth({
      status: 'ok',
      version: '0.1.0',
      models: 4,
      providers: {
        total: 2,
        healthy: 1,
        statuses: { chatgpt: 'healthy', gemini: 'rate-limited', weird: 'warming' },
      },
      browser: { running: true, contexts: 3 },
      uptime: 65,
      timestamp: '2026-05-27T00:00:00.000Z',
    });

    expect(health.serverStatus).toBe('healthy');
    expect(health.modelCount).toBe(4);
    expect(health.browser?.contexts).toBe(3);
    expect(health.providers.statuses.chatgpt).toBe('healthy');
    expect(health.providers.statuses.weird).toBe('unknown');
  });

  it('handles null browser and empty providers', () => {
    const health = normalizeHealth({ status: 'degraded', providers: { statuses: {} }, browser: null });

    expect(health.serverStatus).toBe('degraded');
    expect(health.browser).toBeNull();
    expect(health.providers.total).toBe(0);
  });

  it('normalizes OpenAI model list extensions', () => {
    const models = normalizeModels({
      object: 'list',
      data: [
        { id: 'chatgpt', owned_by: 'omni', root: 'chatgpt', 'x-omni-status': 'healthy' },
        { id: 'omni-code', owned_by: 'omni', root: 'omni-code', 'x-omni-status': 'missing' },
      ],
    });

    expect(models).toHaveLength(2);
    expect(models[0]?.omniStatus).toBe('healthy');
    expect(models[1]?.omniStatus).toBe('unknown');
  });

  it('keeps status labels in the supported set', () => {
    expect(normalizeProviderStatus('rate-limited')).toBe('rate-limited');
    expect(normalizeProviderStatus('offline')).toBe('unknown');
    expect(normalizeProviderStatus(null)).toBe('unknown');
  });
});
