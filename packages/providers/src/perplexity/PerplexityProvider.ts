// packages/providers/src/perplexity/PerplexityProvider.ts
// Perplexity.ai web adapter — best for real-time search and citations

import type { Page } from 'playwright';
import type { AskOptions, ProviderCapability } from '@omni/core';
import { BaseProvider } from '../base/BaseProvider.js';
import { humanDelay, humanType, readDelay, thinkDelay, sleep } from '@omni/browser';

const SEL = {
  // Input
  promptInput:      'textarea[placeholder*="Ask"]',
  promptInputAlt:   'textarea.overflow-auto',
  sendButton:       'button[aria-label="Submit"]',
  sendButtonAlt:    'button[type="submit"]',

  // Response
  answerBlock:      '[data-testid="answer"]',
  answerBlockAlt:   '.prose',
  sourcesBlock:     '[data-testid="sources"]',
  streamingSpinner: '.loading-spinner',
  streamingDots:    '.animate-pulse',

  // Auth
  signInButton:     'button:has-text("Sign in")',
  userMenu:         '[data-testid="user-menu"]',
  userAvatar:       '.user-avatar',

  // New chat / search
  newSearchButton:  'a[href="/"]',
  newThreadButton:  'button[aria-label="New Thread"]',

  // Rate limit
  rateLimitMsg:     'text=You\'ve reached your daily limit',
  rateLimitMsg2:    'text=Too many requests',
  proOnlyMsg:       'text=Pro subscribers only',
} as const;

export class PerplexityProvider extends BaseProvider {
  readonly id = 'perplexity';
  readonly name = 'Perplexity';
  readonly capabilities: ProviderCapability[] = [
    'text', 'search', 'citations',
  ];

  private readonly baseUrl = 'https://www.perplexity.ai';

  protected async ensureLoggedIn(page: Page): Promise<void> {
    const currentUrl = page.url();

    if (!currentUrl.includes('perplexity.ai')) {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
      await readDelay();
    }

    // Perplexity works partially without login, but login improves limits
    const isLoggedIn = await page.$(SEL.userMenu)
      .then((el) => el ?? page.$(SEL.userAvatar))
      .then(Boolean);

    if (isLoggedIn) return;

    // Even without login it works — but log a warning
    const inputVisible = await page.$(SEL.promptInput).then(Boolean);
    if (!inputVisible) {
      this.status = 'session-expired';
      throw new Error('[Perplexity] Not logged in. Run: bun run session:init perplexity');
    }

    // Logged out but functional (rate limits will be lower)
    console.warn('[Perplexity] Using without login — rate limits apply');
  }

  protected async submitPrompt(
    page: Page,
    prompt: string,
    _options?: AskOptions,
  ): Promise<string> {
    const inputEl = await page.$(SEL.promptInput)
      ?? await page.$(SEL.promptInputAlt);
    if (!inputEl) throw new Error('[Perplexity] Prompt input not found');

    await inputEl.click();
    await sleep(100);

    // Clear existing content
    await inputEl.selectText();
    await page.keyboard.press('Delete');

    await humanType(
      { pressSequentially: (text, opts) => page.keyboard.type(text, opts?.delay !== undefined ? { delay: opts.delay } : {}) },
      prompt,
    );

    await humanDelay(200, 500);

    const sendBtn = await page.$(SEL.sendButton)
      ?? await page.$(SEL.sendButtonAlt);
    if (!sendBtn) throw new Error('[Perplexity] Send button not found');

    await sendBtn.click();

    return this.waitForResponse(page, _options?.timeoutMs ?? 60000);
  }

  protected async createNewConversation(page: Page): Promise<string> {
    await this.ensureLoggedIn(page);

    const newBtn = await page.$(SEL.newThreadButton)
      ?? await page.$(SEL.newSearchButton);

    if (newBtn) {
      await newBtn.click();
    } else {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
    }

    await readDelay();
    return `perp-${Date.now()}`;
  }

  protected async navigateToConversation(page: Page, _conversationId: string): Promise<void> {
    // Perplexity doesn't have stable conversation URLs in the same way
    // For follow-up, we stay on the same page
    const isOnPerplexity = page.url().includes('perplexity.ai');
    if (!isOnPerplexity) {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
      await readDelay();
    }
  }

  protected async detectRateLimit(page: Page): Promise<boolean> {
    for (const sel of [SEL.rateLimitMsg, SEL.rateLimitMsg2]) {
      if (await page.$(sel).then(Boolean)) return true;
    }
    return false;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async waitForResponse(page: Page, timeoutMs: number): Promise<string> {
    // Wait for answer block to appear
    await page.waitForSelector(SEL.answerBlock, {
      state: 'attached',
      timeout: 30000,
    }).catch(() => {});

    await thinkDelay();

    // Wait for streaming to stop (spinner disappears)
    await page.waitForSelector(SEL.streamingSpinner, {
      state: 'hidden',
      timeout: timeoutMs,
    }).catch(() => {});

    // Also check animated dots
    await page.waitForSelector(SEL.streamingDots, {
      state: 'hidden',
      timeout: 10000,
    }).catch(() => {});

    await sleep(600); // Settle

    if (await this.detectRateLimit(page)) {
      this.status = 'rate-limited';
      throw new Error('[Perplexity] Rate limited');
    }

    return this.extractResponse(page);
  }

  private async extractResponse(page: Page): Promise<string> {
    const answerEl = await page.$(SEL.answerBlock)
      ?? await page.$(SEL.answerBlockAlt);

    if (!answerEl) throw new Error('[Perplexity] No answer block found');

    const answerText = (await answerEl.innerText()) ?? '';

    // Also try to extract sources/citations and append them
    const sourcesEl = await page.$(SEL.sourcesBlock);
    if (sourcesEl) {
      const sourcesText = await sourcesEl.innerText();
      if (sourcesText) {
        return `${answerText.trim()}\n\n---\nSources:\n${sourcesText.trim()}`;
      }
    }

    return answerText.trim();
  }
}
