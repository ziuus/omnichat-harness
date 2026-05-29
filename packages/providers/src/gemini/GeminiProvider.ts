// packages/providers/src/gemini/GeminiProvider.ts
// Gemini web UI adapter — start here, least aggressive anti-bot

import type { Page } from 'playwright';
import type { AskOptions, ProviderCapability } from '@omni/core';
import { BaseProvider } from '../base/BaseProvider.js';
import { humanDelay, humanType, readDelay, thinkDelay, sleep, microDelay } from '@omni/browser';

// ─── Selectors ────────────────────────────────────────────────────────────────
// Isolated here so DOM changes only require editing this object

const SEL = {
  // Input
  promptInput:      'div[contenteditable="true"].ql-editor',
  promptInputAlt:   'rich-textarea .ql-editor',
  sendButton:       'button[aria-label="Send message"]',
  sendButtonAlt:    'button.send-button',

  // Response
  responseContainer: 'model-response',
  responseText:      'model-response .markdown',
  responseTextAlt:   'model-response message-content',
  streamingIndicator:'model-response .loading-indicator',
  thinkingIndicator: '.thinking-indicator',

  // Auth / state
  signInButton:     'a[href*="accounts.google.com"]',
  userAvatar:       'img[alt*="Google Account"]',
  newChatButton:    'button[aria-label="New chat"]',
  newChatButtonAlt: 'a[href="/app"]',

  // Rate limit
  rateLimitMsg:     'text=You\'ve reached your limit',
  rateLimitMsg2:    'text=Too many requests',

  // Conversation URL pattern: https://gemini.google.com/app/<id>
  conversationUrl:  '/app/',
} as const;

export class GeminiProvider extends BaseProvider {
  readonly id = 'gemini';
  readonly name = 'Gemini';
  readonly capabilities: ProviderCapability[] = [
    'text', 'code', 'image-input', 'long-context', 'search',
  ];

  private readonly baseUrl = 'https://gemini.google.com';
  private isOnPage = false;

  // ─── Abstract implementations ──────────────────────────────────────────────

  protected async ensureLoggedIn(page: Page): Promise<void> {
    // Navigate to Gemini if we're not there
    const currentUrl = page.url();
    if (!currentUrl.includes('gemini.google.com')) {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
      await readDelay();
    }

    // Check if we're already logged in (user avatar present)
    const isLoggedIn = await page.$(SEL.userAvatar).then(Boolean);
    if (isLoggedIn) {
      this.isOnPage = true;
      return;
    }

    // Not logged in — check for sign-in button
    const signInVisible = await page.$(SEL.signInButton).then(Boolean);
    if (signInVisible) {
      this.status = 'session-expired';
      throw new Error(
        '[Gemini] Not logged in. Run the session-init script: bun run session:init gemini'
      );
    }

    // Wait a bit more — page might still be loading
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Final check
    const loggedInAfterWait = await page.$(SEL.userAvatar).then(Boolean);
    if (!loggedInAfterWait) {
      throw new Error('[Gemini] Could not verify logged-in state');
    }

    this.isOnPage = true;
  }

  protected async submitPrompt(
    page: Page,
    prompt: string,
    options?: AskOptions,
  ): Promise<string> {
    // Find the input field
    const inputSelector = await this.resolveSelector(page, [
      SEL.promptInput,
      SEL.promptInputAlt,
    ]);

    const inputEl = await page.$(inputSelector);
    if (!inputEl) throw new Error('[Gemini] Could not find prompt input');

    // Click to focus
    await inputEl.click();
    await microDelay();

    // Handle image attachments
    if (options?.images?.length) {
      await this.attachImages(page, options.images);
    }

    // Type the prompt naturally
    await humanType(
      { pressSequentially: (text, opts) => page.keyboard.type(text, opts?.delay !== undefined ? { delay: opts.delay } : {}) },
      prompt,
    );

    await humanDelay(200, 500);

    // Click send
    const sendBtn = await this.resolveSelector(page, [
      SEL.sendButton,
      SEL.sendButtonAlt,
    ]);
    await page.click(sendBtn);

    // Wait for response
    return await this.waitForResponse(page, options?.timeoutMs ?? 120000);
  }

  protected async createNewConversation(page: Page): Promise<string> {
    await this.ensureLoggedIn(page);

    // Click new chat
    const newChatSel = await this.resolveSelector(page, [
      SEL.newChatButton,
      SEL.newChatButtonAlt,
    ]);
    await page.click(newChatSel);
    await readDelay();

    // Extract conversation ID from URL
    return this.extractConversationId(page.url());
  }

  protected async navigateToConversation(page: Page, conversationId: string): Promise<void> {
    const url = `${this.baseUrl}/app/${conversationId}`;
    const currentUrl = page.url();

    if (currentUrl === url) return;

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await readDelay();
    await this.ensureLoggedIn(page);
  }

  protected async detectRateLimit(page: Page): Promise<boolean> {
    const rateLimitEl = await page.$(SEL.rateLimitMsg)
      .then((el) => el ?? page.$(SEL.rateLimitMsg2));
    return rateLimitEl !== null;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async waitForResponse(page: Page, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    // Wait for the response container to appear
    await page.waitForSelector(SEL.responseContainer, {
      state: 'attached',
      timeout: 30000,
    });

    await thinkDelay();

    // Wait for streaming to complete
    // Gemini shows a thinking/loading indicator while streaming
    let lastLength = 0;
    let stableCount = 0;
    const STABLE_THRESHOLD = 4; // content must be same length 4 checks in a row

    while (Date.now() < deadline) {
      // Check for thinking indicator
      const isThinking = await page.$(SEL.thinkingIndicator).then(Boolean);
      const isStreaming = await page.$(SEL.streamingIndicator).then(Boolean);

      if (!isThinking && !isStreaming) {
        // Get current response length
        const currentText = await this.extractLatestResponse(page);
        const currentLength = currentText.length;

        if (currentLength > 0 && currentLength === lastLength) {
          stableCount++;
          if (stableCount >= STABLE_THRESHOLD) {
            // Response is stable — we're done
            return this.cleanResponse(currentText);
          }
        } else {
          stableCount = 0;
          lastLength = currentLength;
        }
      } else {
        stableCount = 0;
      }

      await sleep(500);
    }

    // Timeout — return whatever we have
    const finalText = await this.extractLatestResponse(page);
    if (finalText) return this.cleanResponse(finalText);
    throw new Error('[Gemini] Response timed out');
  }

  private async extractLatestResponse(page: Page): Promise<string> {
    // Get all response containers and take the last one
    const responses = await page.$$(SEL.responseContainer);
    if (responses.length === 0) return '';

    const lastResponse = responses[responses.length - 1];
    if (!lastResponse) return '';

    // Try markdown content first, then fallback
    const markdownEl = await lastResponse.$(SEL.responseText.split(' ').pop()!);
    if (markdownEl) {
      return (await markdownEl.innerText()) ?? '';
    }

    const altEl = await lastResponse.$(SEL.responseTextAlt.split(' ').pop()!);
    if (altEl) {
      return (await altEl.innerText()) ?? '';
    }

    return (await lastResponse.innerText()) ?? '';
  }

  private async attachImages(
    page: Page,
    images: NonNullable<AskOptions['images']>,
  ): Promise<void> {
    // Look for file upload button (camera/attachment icon)
    const uploadBtn = await page.$('button[aria-label*="Upload"]')
      ?? await page.$('button[aria-label*="image"]')
      ?? await page.$('button[aria-label*="attach"]');

    if (!uploadBtn) {
      console.warn('[Gemini] Image upload button not found — skipping images');
      return;
    }

    // Write images to temp files and upload
    const { writeFileSync, unlinkSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    for (const image of images) {
      const tmpPath = join(tmpdir(), `omni-img-${Date.now()}.${image.mimeType.split('/')[1]}`);
      writeFileSync(tmpPath, image.data);

      await uploadBtn.click();
      const uploadInput = page.locator('input[type="file"]').first();
      await uploadInput.setInputFiles(tmpPath);
      await readDelay();

      unlinkSync(tmpPath);
    }
  }

  private async resolveSelector(page: Page, selectors: string[]): Promise<string> {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return sel;
    }
    // Return first as default — will fail naturally with a good error
    return selectors[0]!;
  }

  private extractConversationId(url: string): string {
    const match = url.match(/\/app\/([a-zA-Z0-9_-]+)/);
    return match?.[1] ?? `conv-${Date.now()}`;
  }

  private cleanResponse(text: string): string {
    return text
      .replace(/^(Gemini|Model):\s*/i, '')
      .trim();
  }
}
