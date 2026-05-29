// packages/providers/src/ProviderRegistry.ts
// Central registry: initializes, stores, and retrieves all provider instances

import type { Provider } from '@omni/core';
import type { BrowserPool } from '@omni/browser';
import { GeminiProvider } from './gemini/GeminiProvider.js';
import { ChatGPTProvider } from './chatgpt/ChatGPTProvider.js';
import { ClaudeWebProvider } from './claude-web/ClaudeWebProvider.js';
import { PerplexityProvider } from './perplexity/PerplexityProvider.js';

export type ProviderFactory = (pool: BrowserPool) => Provider;

const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  gemini: (pool) => new GeminiProvider(pool.getContext('gemini')),
  chatgpt: (pool) => new ChatGPTProvider(pool.getContext('chatgpt')),
  'claude-web': (pool) => new ClaudeWebProvider(pool.getContext('claude-web')),
  perplexity: (pool) => new PerplexityProvider(pool.getContext('perplexity')),
};

export const ALL_PROVIDER_IDS = Object.keys(PROVIDER_FACTORIES);

export class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();
  private static instance: ProviderRegistry | null = null;

  private constructor() {}

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  clear(): void {
    this.providers.clear();
  }

  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Initialize all providers from the browser pool.
   * Call after BrowserPool.initialize().
   */
  async initialize(pool: BrowserPool): Promise<void> {
    console.log('[ProviderRegistry] Initializing providers...');

    const results = await Promise.allSettled(
      Object.entries(PROVIDER_FACTORIES).map(async ([id, factory]) => {
        const provider = factory(pool);
        try {
          await provider.initialize();
          this.providers.set(id, provider);
          console.log(`[ProviderRegistry] ✓ ${id}`);
        } catch (err) {
          console.warn(`[ProviderRegistry] ✗ ${id} — will retry on demand:`, err);
          // Still register it — it can be recovered on first use
          this.providers.set(id, provider);
        }
      })
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    console.log(
      `[ProviderRegistry] Done. ${this.providers.size - failed}/${this.providers.size} healthy`
    );
  }

  /**
   * Get a provider by ID. Throws if not found.
   */
  get(providerId: string): Provider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    return provider;
  }

  /**
   * Get multiple providers by ID list.
   * Silently skips unknown providers.
   */
  getMany(providerIds: string[]): Provider[] {
    return providerIds
      .map((id) => this.providers.get(id))
      .filter((p): p is Provider => p !== undefined);
  }

  /**
   * Get all healthy providers.
   */
  async getHealthy(): Promise<Provider[]> {
    const results = await Promise.all(
      Array.from(this.providers.values()).map(async (p) => ({
        provider: p,
        ready: await p.isReady(),
      }))
    );
    return results.filter((r) => r.ready).map((r) => r.provider);
  }

  /**
   * Returns status snapshot for dashboard.
   */
  async getStatusSnapshot(): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};
    for (const [id, provider] of Array.from(this.providers.entries())) {
      snapshot[id] = await provider.getStatus();
    }
    return snapshot;
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  get size(): number {
    return this.providers.size;
  }
}
