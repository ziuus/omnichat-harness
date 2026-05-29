// packages/providers/src/chatgpt/ChatGPTProvider.ts
// ChatGPT web UI adapter — most complex due to Arkose Labs anti-bot

import type { Page } from 'playwright';
import type { AskOptions, ProviderCapability } from '@omni/core';
import { BaseProvider } from '../base/BaseProvider.js';
import { humanDelay, humanType, readDelay, thinkDelay, sleep } from '@omni/browser';

// ─── Selectors ─────────────────────────────────────────────────────────────
const SEL = {
  // Input
  promptInput:       '#prompt-textarea',
  promptInputAlt:    'div[contenteditable="true"][data-id="root"]',
  sendButton:        'button[data-testid="send-button"]',
  sendButtonAlt:     'button[aria-label="Send prompt"]',
  stopButton:        'button[aria-label="Stop streaming"]',

  // Response
  // ChatGPT uses data-message-author-role="assistant"
  assistantMessages: '[data-message-author-role="assistant"]',
  streamingCursor:   '.result-streaming',
  streamingIndicator:'[data-testid="stop-button"]', // stop button = currently streaming

  // Auth
  loginButton:       'button[data-testid="login-button"]',
  loginButtonAlt:    'a[href="/auth/login"]',
  userMenu:          'button[id="radix-:r5:"]', // unstable — use alt
  userMenuAlt:       'button[aria-label*="User menu"]',
  userAvatar:        'img[alt="User"]',
  profilePicture:    'div[data-testid="profile-button"]',

  // New conversation
  newChatSidebar:    'a[data-testid="create-new-chat-button"]',
  newChatAlt:        'button[aria-label="New chat"]',

  // Rate limit / errors
  rateLimitMsg:      'text=You\'ve reached the current usage cap',
  rateLimitMsg2:     'text=Too many requests in 1 hour',
  rateLimitMsg3:     '.rate-limit',
  errorMsg:          '[data-testid="error-dialog"]',

  // CAPTCHA
  captchaFrame:      'iframe[src*="arkose"]',
  captchaFrame2:     'iframe[title*="challenge"]',
} as const;

export class ChatGPTProvider extends BaseProvider {
  readonly id = 'chatgpt';
  readonly name = 'ChatGPT';
  readonly capabilities: ProviderCapability[] = [
    'text', 'code', 'image-input', 'image-generation', 'long-context',
  ];

  private readonly baseUrl = 'https://chatgpt.com';

  protected async ensureLoggedIn(page: Page): Promise<void> {
    const currentUrl = page.url();

    if (!currentUrl.includes('chatgpt.com') && !currentUrl.includes('chat.openai.com')) {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
      await readDelay();
    }

    // Check for CAPTCHA first — highest priority issue
    const hasCaptcha = await page.$(SEL.captchaFrame)
      .then((el) => el ?? page.$(SEL.captchaFrame2))
      .then(Boolean);

    if (hasCaptcha) {
      this.status = 'needs-captcha';
      throw new Error('[ChatGPT] CAPTCHA detected — requires human intervention');
    }

    // Check if logged in
    const isLoggedIn = await page.$(SEL.profilePicture)
      .then((el) => el ?? page.$(SEL.userAvatar))
      .then(Boolean);

    if (isLoggedIn) return;

    // Check for login button
    const loginBtn = await page.$(SEL.loginButton)
      .then((el) => el ?? page.$(SEL.loginButtonAlt));

    if (loginBtn) {
      // Allow anonymous usage instead of throwing an error
      console.warn('[ChatGPT] Not logged in. Proceeding anonymously. Note that some features might be restricted.');
      this.status = 'healthy'; // Anonymous mode is still healthy
      return;
    }

    // Wait for page to settle
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Check if the prompt input is visible — means we're on the main page logged in
    const inputVisible = await page.$(SEL.promptInput).then(Boolean);
    if (!inputVisible) {
      console.warn('[ChatGPT] Prompt input not visible immediately during login check, proceeding anyway');
    }
  }

  protected async submitPrompt(
    page: Page,
    prompt: string,
    options?: AskOptions,
  ): Promise<string> {
    // Find input
    let inputEl = await page.$(SEL.promptInput);
    if (!inputEl) {
      inputEl = await page.$(SEL.promptInputAlt);
    }
    if (!inputEl) throw new Error('[ChatGPT] Prompt textarea not found');

    // Handle images before typing
    if (options?.images?.length) {
      await this.attachImages(page, options.images);
    }

    // Click + type
    await inputEl.click();
    await sleep(100);
    await humanType(
      { pressSequentially: (text, opts) => page.keyboard.type(text, opts?.delay !== undefined ? { delay: opts.delay } : {}) },
      prompt,
    );
    await humanDelay(200, 600);

    // Submit
    const sendBtn = await page.$(SEL.sendButton)
      ?? await page.$(SEL.sendButtonAlt);
    if (!sendBtn) throw new Error('[ChatGPT] Send button not found');

    await sendBtn.click();

    return this.waitForResponse(page, options?.timeoutMs ?? 180000);
  }

  protected async createNewConversation(page: Page): Promise<string> {
    await this.ensureLoggedIn(page);

    const newChatBtn = await page.$(SEL.newChatSidebar)
      ?? await page.$(SEL.newChatAlt);

    if (newChatBtn) {
      await newChatBtn.click();
      await readDelay();
    } else {
      // Navigate to root which starts a new chat
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
      await readDelay();
    }

    return this.extractConversationId(page.url());
  }

  protected async navigateToConversation(page: Page, conversationId: string): Promise<void> {
    const url = `${this.baseUrl}/c/${conversationId}`;
    if (page.url() === url) return;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await readDelay();
    await this.ensureLoggedIn(page);
  }

  protected async detectRateLimit(page: Page): Promise<boolean> {
    for (const sel of [SEL.rateLimitMsg, SEL.rateLimitMsg2, SEL.rateLimitMsg3]) {
      if (await page.$(sel).then(Boolean)) return true;
    }
    return false;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async waitForResponse(page: Page, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    // Wait for stop button to appear (streaming started)
    await page.waitForSelector(SEL.streamingIndicator, {
      state: 'visible',
      timeout: 30000,
    }).catch(() => {
      // May have responded immediately
    });

    await thinkDelay();

    // Wait for streaming to end (stop button disappears)
    await page.waitForSelector(SEL.streamingIndicator, {
      state: 'hidden',
      timeout: timeoutMs,
    }).catch(() => {});

    // Also wait for the streaming cursor to disappear
    await page.waitForSelector(SEL.streamingCursor, {
      state: 'hidden',
      timeout: 10000,
    }).catch(() => {});

    await sleep(500); // Settle time

    // Check for rate limit after response
    if (await this.detectRateLimit(page)) {
      this.status = 'rate-limited';
      throw new Error('[ChatGPT] Rate limit hit after response');
    }

    return this.extractLatestResponse(page);
  }

  private async extractLatestResponse(page: Page): Promise<string> {
    const messages = await page.$$(SEL.assistantMessages);
    if (messages.length === 0) throw new Error('[ChatGPT] No assistant messages found');

    const lastMessage = messages[messages.length - 1]!;
    const text = await lastMessage.innerText();
    return this.cleanResponse(text ?? '');
  }

  private async attachImages(
    page: Page,
    images: NonNullable<AskOptions['images']>,
  ): Promise<void> {
    const attachBtn = await page.$('button[aria-label*="Attach"]')
      ?? await page.$('input[type="file"]');

    if (!attachBtn) {
      console.warn('[ChatGPT] Attachment button not found — skipping images');
      return;
    }

    const { writeFileSync, unlinkSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    for (const image of images) {
      const ext = image.mimeType.split('/')[1] ?? 'png';
      const tmpPath = join(tmpdir(), `omni-img-${Date.now()}.${ext}`);
      writeFileSync(tmpPath, image.data);

      const tagName = await attachBtn.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === 'input') {
        await (attachBtn as any).setInputFiles(tmpPath);
      } else {
        await attachBtn.click();
        const uploadInput = page.locator('input[type="file"]').first();
        await uploadInput.setInputFiles(tmpPath);
      }

      await readDelay();
      unlinkSync(tmpPath);
    }
  }

  private extractConversationId(url: string): string {
    const match = url.match(/\/c\/([a-zA-Z0-9_-]+)/);
    return match?.[1] ?? `conv-${Date.now()}`;
  }

  private cleanResponse(text: string): string {
    return text
      .replace(/^ChatGPT\s*/i, '')
      .replace(/^(Copy code|Copy)\s*/gm, '')
      .trim();
  }
}
