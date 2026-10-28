// packages/browser/src/BrowserPool.ts
// Manages a pool of browser contexts — one per provider, shared across requests

import { chromium, type Browser } from 'playwright';
import { ManagedBrowserContext } from './BrowserContext.js';
import { getLaunchOptions } from './StealthConfig.js';

export interface BrowserPoolOptions {
  sessionStoragePath: string;
  encryptionKey: string;
  maxContexts?: number;
  headless?: boolean;
}

export class BrowserPool {
  private browser: Browser | null = null;
  private contexts: Map<string, ManagedBrowserContext> = new Map();
  private options: BrowserPoolOptions;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private static instance: BrowserPool | null = null;

  private constructor(options: BrowserPoolOptions) {
    this.options = options;
  }

  static getInstance(options?: BrowserPoolOptions): BrowserPool {
    if (!BrowserPool.instance) {
      if (!options) throw new Error('BrowserPool requires options on first initialization');
      BrowserPool.instance = new BrowserPool(options);
    }
    return BrowserPool.instance;
  }

  /**
   * Start the browser and initialize contexts for all providers.
   */
  async initialize(providerIds: string[]): Promise<void> {
    console.log('[BrowserPool] Launching Chromium...');

    const launchOptions = getLaunchOptions();
    if (this.options.headless === false) {
      launchOptions.headless = false;
    }

    this.browser = await chromium.launch(launchOptions);

    console.log(`[BrowserPool] Initializing ${providerIds.length} provider contexts...`);

    // Initialize contexts sequentially to avoid network/CPU contention
    for (const id of providerIds) {
      await this.initContext(id);
    }

    // Start health check loop
    this.startHealthChecks();

    console.log('[BrowserPool] Ready');
  }

  /**
   * Get the context for a provider.
   * Throws if the provider context doesn't exist.
   */
  getContext(providerId: string): ManagedBrowserContext {
    const ctx = this.contexts.get(providerId);
    if (!ctx) {
      throw new Error(`No browser context for provider: ${providerId}`);
    }
    return ctx;
  }

  /**
   * Check if a provider context exists and is alive.
   */
  hasContext(providerId: string): boolean {
    const ctx = this.contexts.get(providerId);
    return !!ctx && ctx.status !== 'dead';
  }

  /**
   * Lazily initialize a context for a provider not in the initial list.
   */
  async ensureContext(providerId: string): Promise<ManagedBrowserContext> {
    if (this.hasContext(providerId)) {
      return this.getContext(providerId);
    }
    return this.initContext(providerId);
  }

  /**
   * Save all sessions to disk (call before shutdown).
   */
  async saveAllSessions(): Promise<void> {
    await Promise.all(
      Array.from(this.contexts.values()).map((ctx) => ctx.saveSession())
    );
  }

  /**
   * Graceful shutdown.
   */
  async shutdown(): Promise<void> {
    console.log('[BrowserPool] Shutting down...');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    await this.saveAllSessions();

    await Promise.all(
      Array.from(this.contexts.values()).map((ctx) => ctx.close())
    );

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    console.log('[BrowserPool] Shutdown complete');
  }

  /**
   * Get pool status for dashboard/monitoring.
   */
  getStatus(): PoolStatus {
    const contextStatuses: Record<string, string> = {};
    for (const [id, ctx] of Array.from(this.contexts.entries())) {
      contextStatuses[id] = ctx.status;
    }

    return {
      browserRunning: this.browser !== null,
      contextCount: this.contexts.size,
      contexts: contextStatuses,
    };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async initContext(providerId: string): Promise<ManagedBrowserContext> {
    if (!this.browser) throw new Error('Browser not initialized');

    const ctx = new ManagedBrowserContext({
      providerId,
      sessionStoragePath: this.options.sessionStoragePath,
      encryptionKey: this.options.encryptionKey,
    });

    await ctx.initialize(this.browser);
    this.contexts.set(providerId, ctx);

    console.log(`[BrowserPool] Context ready: ${providerId}`);
    return ctx;
  }

  private startHealthChecks(): void {
    // Check every 2 minutes for dead contexts and revive them
    this.healthCheckInterval = setInterval(async () => {
      for (const [id, ctx] of Array.from(this.contexts.entries())) {
        if (ctx.status === 'dead') {
          console.warn(`[BrowserPool] Reviving dead context: ${id}`);
          await this.initContext(id).catch((err) => {
            console.error(`[BrowserPool] Failed to revive ${id}:`, err);
          });
        }
      }
    }, 2 * 60 * 1000);
  }
}

export interface PoolStatus {
  browserRunning: boolean;
  contextCount: number;
  contexts: Record<string, string>;
}
