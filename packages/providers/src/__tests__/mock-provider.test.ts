import { describe, expect, it } from 'bun:test';
import type { Provider } from '@omni/core';
import { MockProvider } from '../mock/MockProvider.js';

describe('MockProvider', () => {
  it('implements the provider contract and returns a fixed response', async () => {
    const provider: Provider = new MockProvider('chatgpt', 'Mock ChatGPT', 'fixed response');

    await provider.initialize();
    expect(await provider.isReady()).toBe(true);
    expect(await provider.getStatus()).toBe('healthy');

    const result = await provider.ask('hello');
    expect(result.provider).toBe('chatgpt');
    expect(result.content).toBe('fixed response');
  });
});
