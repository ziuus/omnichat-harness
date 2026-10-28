// packages/providers/src/claude-web/ClaudeWebProvider.ts
// Claude.ai web UI adapter

import type { Page } from 'playwright';
import type { AskOptions, ProviderCapability } from '@omni/core';
import { BaseProvider } from '../base/BaseProvider.js';
import { humanDelay, humanType, readDelay, thinkDelay, sleep } from '@omni/browser';

const SEL = {
  // Input — Claude uses a ProseMirror editor
  promptInput:          'div[contenteditable="true"].ProseMirror',
  promptInputAlt:       '[data-testid="composer-input"]',
  sendButton:           'button[aria-label="Send Message"]',
  sendButtonAlt:        'button[type="submit"]',

  // Response
  assistantMessage:     '[data-is-streaming="false"] .font-claude-message',
  assistantMessageAlt:  '.font-claude-message',
  streamingMessage:     '[data-is-streaming="true"]',
  streamingDot:         '.streaming-indicator',

  // Auth
  loginLink:            'a[href*="/login"]',
  signInButton:         'button:has-text("Sign in")',
  userMenuButton:       'button[data-testid="user-menu-trigger"]',
  userInitials:         '.user-initials',

  // New chat
  newChatButton:        'a[href="/new"]',
  newChatButtonAlt:     'button[aria-label="New chat"]',

  // Rate limit
  rateLimitMsg:         'text=You\'ve reached your usage limit',
  rateLimitMsg2:        'text=Daily message limit',
  dailyLimitBanner:     '[data-testid="usage-limit-banner"]',

  // File upload
  fileUploadButton:     'button[aria-label*="Upload"]',
  fileUploadButtonAlt:  'input[type="file"]',
} as const;

export class ClaudeWebProvider extends BaseProvider {
  readonly id = 'claude-web';
  readonly name = 'Claude (web)';
  readonly capabilities: ProviderCapability[] = [
    'text', 'code', 'image-input', 'long-context', 'analysis',
  ];

  private readonly baseUrl = 'https://claude.ai';

  protected async ensureLoggedIn(page: Page): Promise<void> {
    const currentUrl = page.url();

    if (!currentUrl.includes('claude.ai')) {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
      await readDelay();
    }

    // Check if on login page
    if (page.url().includes('/login') || page.url().includes('/auth')) {
      this.status = 'session-expired';
      throw new Error('[Claude] Not logged in. Run: bun run session:init claude-web');
    }

    // Look for logged-in indicators
    const isLoggedIn = await page.$(SEL.userMenuButton)
      .then((el) => el ?? page.$(SEL.userInitials))
      .then(Boolean);

    if (isLoggedIn) return;

    // Check for login links
    const hasLoginLink = await page.$(SEL.loginLink)
      .then((el) => el ?? page.$(SEL.signInButton))
      .then(Boolean);

    if (hasLoginLink) {
      this.status = 'session-expired';
      throw new Error('[Claude] Not logged in. Run: bun run session:init claude-web');
    }

    // Wait for network idle and recheck
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const inputVisible = await page.$(SEL.promptInput).then(Boolean);
    if (!inputVisible) {
      throw new Error('[Claude] Could not verify logged-in state');
    }
  }

  protected async submitPrompt(
    page: Page,
    prompt: string,
    options?: AskOptions,
  ): Promise<string> {
    // Attach images first if any
    if (options?.images?.length) {
      await this.attachImages(page, options.images);
    }

    // Find ProseMirror input
    const inputEl = await page.$(SEL.promptInput)
      ?? await page.$(SEL.promptInputAlt);
    if (!inputEl) throw new Error('[Claude] Prompt input not found');

    await inputEl.click();
    await sleep(150);

    if (prompt.length > 60) {
      await page.keyboard.insertText(prompt);
    } else {
      await humanType(
        { pressSequentially: (text, opts) => page.keyboard.type(text, opts?.delay !== undefined ? { delay: opts.delay } : {}) },
        prompt,
      );
    }

    await humanDelay(150, 300);

    // Send
    const sendBtn = await page.$(SEL.sendButton)
      ?? await page.$(SEL.sendButtonAlt);
    if (!sendBtn) throw new Error('[Claude] Send button not found');

    // Check it's not disabled
    const isDisabled = await sendBtn.getAttribute('disabled');
    if (isDisabled !== null) {
      throw new Error('[Claude] Send button is disabled — may be rate limited');
    }

    await sendBtn.click();

    return this.waitForResponse(page, options?.timeoutMs ?? 180000);
  }

  protected async createNewConversation(page: Page): Promise<string> {
    await this.ensureLoggedIn(page);

    const newChatBtn = await page.$(SEL.newChatButton)
      ?? await page.$(SEL.newChatButtonAlt);

    if (newChatBtn) {
      await newChatBtn.click();
    } else {
      await page.goto(`${this.baseUrl}/new`, { waitUntil: 'domcontentloaded' });
    }

    await readDelay();
    return this.extractConversationId(page.url());
  }

  protected async navigateToConversation(page: Page, conversationId: string): Promise<void> {
    const url = `${this.baseUrl}/chat/${conversationId}`;
    if (page.url() === url) return;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await readDelay();
    await this.ensureLoggedIn(page);
  }

  protected async detectRateLimit(page: Page): Promise<boolean> {
    const rateLimitEl = await page.$(SEL.rateLimitMsg)
      .then((el) => el ?? page.$(SEL.rateLimitMsg2))
      .then((el) => el ?? page.$(SEL.dailyLimitBanner));
    return rateLimitEl !== null;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async waitForResponse(page: Page, timeoutMs: number): Promise<string> {
    // Wait for streaming message to appear
    await page.waitForSelector(SEL.streamingMessage, {
      state: 'attached',
      timeout: 30000,
    }).catch(() => {});

    await thinkDelay();

    // Wait for streaming to complete (data-is-streaming becomes false)
    await page.waitForSelector(SEL.streamingMessage, {
      state: 'detached',
      timeout: timeoutMs,
    }).catch(() => {});

    await sleep(400);

    // Check rate limit
    if (await this.detectRateLimit(page)) {
      this.status = 'rate-limited';
      throw new Error('[Claude] Rate limit hit');
    }

    return this.extractLatestResponse(page);
  }

  private async extractLatestResponse(page: Page): Promise<string> {
    // First try to get settled (non-streaming) messages
    let messages = await page.$$(SEL.assistantMessage);

    // Fallback to any assistant message
    if (messages.length === 0) {
      messages = await page.$$(SEL.assistantMessageAlt);
    }

    if (messages.length === 0) {
      throw new Error('[Claude] No assistant messages found');
    }

    const lastMessage = messages[messages.length - 1]!;
    const text = await lastMessage.innerText();
    return this.cleanResponse(text ?? '');
  }

  private async attachImages(
    page: Page,
    images: NonNullable<AskOptions['images']>,
  ): Promise<void> {
    const uploadBtn = await page.$(SEL.fileUploadButton)
      ?? await page.$(SEL.fileUploadButtonAlt);

    if (!uploadBtn) {
      console.warn('[Claude] File upload button not found — skipping images');
      return;
    }

    const { writeFileSync, unlinkSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    for (const image of images) {
      const ext = image.mimeType.split('/')[1] ?? 'png';
      const tmpPath = join(tmpdir(), `omni-img-${Date.now()}.${ext}`);
      writeFileSync(tmpPath, image.data);

      const tagName = await uploadBtn.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === 'input') {
        await (uploadBtn as any).setInputFiles(tmpPath);
      } else {
        await uploadBtn.click();
        const uploadInput = page.locator('input[type="file"]').first();
        await uploadInput.setInputFiles(tmpPath);
      }

      await readDelay();
      unlinkSync(tmpPath);
    }
  }

  private extractConversationId(url: string): string {
    const match = url.match(/\/chat\/([a-zA-Z0-9_-]+)/);
    return match?.[1] ?? `conv-${Date.now()}`;
  }

  private cleanResponse(text: string): string {
    return text
      .replace(/^Claude\s*/i, '')
      .trim();
  }
}
