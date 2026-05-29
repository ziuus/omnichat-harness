// packages/providers/src/base/BaseProvider.ts
// Abstract base all browser-automation providers extend

import type { Page } from 'playwright';
import type {
  Provider,
  ProviderCapability,
  ProviderResponse,
  ProviderStatus,
  ProviderLimits,
  AskOptions,
} from '@omni/core';
import type { ManagedBrowserContext } from '@omni/browser';
import { withRetry, humanDelay } from '@omni/browser';
import { randomUUID } from 'crypto';

export abstract class BaseProvider implements Provider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapability[];

  protected context: ManagedBrowserContext;
  protected status: ProviderStatus = 'initializing';

  constructor(context: ManagedBrowserContext) {
    this.context = context;
  }

  // ─── Abstract methods each provider must implement ─────────────────────────

  /** Navigate to provider URL and verify logged-in state */
  protected abstract ensureLoggedIn(page: Page): Promise<void>;

  /** Submit prompt and wait for response to complete */
  protected abstract submitPrompt(
    page: Page,
    prompt: string,
    options?: AskOptions,
  ): Promise<string>;

  /** Create a new conversation and return its ID */
  protected abstract createNewConversation(page: Page): Promise<string>;

  /** Navigate to an existing conversation */
  protected abstract navigateToConversation(page: Page, conversationId: string): Promise<void>;

  /** Check if the current page shows the provider is rate-limited */
  protected abstract detectRateLimit(page: Page): Promise<boolean>;

  // ─── Public API (implemented here, using abstract methods above) ───────────

  async initialize(): Promise<void> {
    console.log(`[${this.id}] Initializing...`);
    try {
      const page = await this.context.newPage();
      await this.ensureLoggedIn(page);
      await page.close();
      this.status = 'healthy';
      console.log(`[${this.id}] Initialized successfully`);
    } catch (err) {
      this.status = 'unavailable';
      console.error(`[${this.id}] Initialization failed:`, err);
      throw err;
    } finally {
      this.context.markIdle();
    }
  }

  async isReady(): Promise<boolean> {
    return this.status === 'healthy' || this.status === 'degraded';
  }

  async getStatus(): Promise<ProviderStatus> {
    return this.status;
  }

  async getLimits(): Promise<ProviderLimits> {
    // Subclasses override with real detection
    return {
      requestsPerHour: null,
      messagesPerConversation: null,
      maxImageSizeMb: null,
    };
  }

  async ask(prompt: string, options?: AskOptions): Promise<ProviderResponse> {
    return withRetry(
      () => this._ask(prompt, options),
      3,
      2000,
    );
  }

  async newConversation(): Promise<string> {
    const page = await this.context.newPage();
    try {
      await this.ensureLoggedIn(page);
      const id = await this.createNewConversation(page);
      await this.context.saveSession();
      return id;
    } finally {
      await page.close();
      this.context.markIdle();
    }
  }

  async continueConversation(
    conversationId: string,
    prompt: string,
    options?: AskOptions,
  ): Promise<ProviderResponse> {
    return this.ask(prompt, { ...options, conversationId });
  }

  async recover(): Promise<void> {
    console.log(`[${this.id}] Attempting soft recovery...`);
    this.status = 'initializing';
    try {
      await this.initialize();
    } catch {
      console.warn(`[${this.id}] Soft recovery failed, attempting hard reset`);
      await this.reset();
    }
  }

  async reset(): Promise<void> {
    console.log(`[${this.id}] Hard reset — clearing session`);
    await this.context.reset();
    this.status = 'initializing';
    await this.initialize();
  }

  async healthCheck(): Promise<ProviderStatus> {
    try {
      const page = await this.context.newPage();
      await this.ensureLoggedIn(page);
      const rateLimited = await this.detectRateLimit(page);
      await page.close();
      this.context.markIdle();

      this.status = rateLimited ? 'rate-limited' : 'healthy';
      return this.status;
    } catch {
      this.status = 'unavailable';
      return this.status;
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async _ask(prompt: string, options?: AskOptions): Promise<ProviderResponse> {
    const startTime = Date.now();
    const page = await this.context.newPage();

    try {
      await this.ensureLoggedIn(page);

      if (options?.conversationId) {
        await this.navigateToConversation(page, options.conversationId);
      }

      // Human-like pause before typing
      await humanDelay(400, 900);

      const content = await this.submitPrompt(page, prompt, options);

      await this.context.saveSession();

      const response: ProviderResponse = {
        id: randomUUID(),
        provider: this.id,
        content,
        tokensEstimate: Math.ceil(content.length / 4),
        durationMs: Date.now() - startTime,
        capturedAt: new Date(),
        metadata: {},
      };

      if (options?.conversationId) {
        response.conversationId = options.conversationId;
      }

      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Classify the error and update status
      if (message.includes('rate') || message.includes('limit')) {
        this.status = 'rate-limited';
        throw new Error(`[${this.id}] Rate limited: ${message}`);
      }
      if (message.includes('login') || message.includes('auth') || message.includes('sign')) {
        this.status = 'session-expired';
        throw new Error(`[${this.id}] Session expired: ${message}`);
      }

      this.status = 'degraded';
      throw err;
    } finally {
      await page.close();
      this.context.markIdle();
    }
  }

  /** Wait for an element matching selector, with timeout */
  protected async waitFor(
    page: Page,
    selector: string,
    timeoutMs = 30000,
  ): Promise<void> {
    await page.waitForSelector(selector, {
      state: 'visible',
      timeout: timeoutMs,
    });
  }

  /** Extract text content from a selector */
  protected async extractText(page: Page, selector: string): Promise<string> {
    const el = await page.$(selector);
    if (!el) return '';
    return (await el.textContent()) ?? '';
  }

  /** Wait for selector to disappear (e.g. loading spinner) */
  protected async waitForGone(
    page: Page,
    selector: string,
    timeoutMs = 120000,
  ): Promise<void> {
    await page.waitForSelector(selector, {
      state: 'hidden',
      timeout: timeoutMs,
    });
  }
}
