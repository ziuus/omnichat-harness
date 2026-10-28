// packages/providers/src/chatgpt/ChatGPTProvider.ts
// ChatGPT web UI adapter — most complex due to Arkose Labs anti-bot

import type { Page } from 'playwright';
import type { AskOptions, ProviderCapability } from '@omni/core';
import { BaseProvider } from '../base/BaseProvider.js';
import { humanDelay, humanType, readDelay, thinkDelay, sleep } from '@omni/browser';

// ─── Selectors ─────────────────────────────────────────────────────────────
const SEL = {
  // Input
  promptInput:       '#prompt-textarea, #mobile-composer-prompt, textarea[placeholder*="Ask ChatGPT"], textarea[placeholder*="Message"], textarea',
  promptInputAlt:    'div[contenteditable="true"][data-id="root"], div[contenteditable="true"]',
  sendButton:        'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label*="Send"]',
  sendButtonAlt:     'button[aria-label="Send prompt"], button[aria-label="Send message"]',
  stopButton:        'button[data-testid="stop-button"], button[data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="stop"]',

  // Response
  // ChatGPT uses data-message-role="assistant" or data-message-author-role="assistant"
  assistantMessages: '[data-message-author-role="assistant"], [data-message-role="assistant"]',
  streamingCursor:   '.result-streaming',
  streamingIndicator:'button[data-testid="stop-button"], button[data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="stop"]', // stop button = currently streaming

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
    // If starting a fresh chat and page already has messages or is on a subpath, reset to root
    if (!options?.conversationId) {
      const hasPriorMessages = (await page.$$(SEL.assistantMessages)).length > 0;
      if (hasPriorMessages || page.url().includes('/c/') || page.url().includes('conversation')) {
        const newChatBtn = await page.$(SEL.newChatSidebar) ?? await page.$(SEL.newChatAlt);
        if (newChatBtn) {
          await newChatBtn.click().catch(() => {});
          await page.waitForFunction('!window.location.pathname.includes("/c/")', { timeout: 5000 }).catch(() => {});
          await sleep(200);
        } else {
          await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await sleep(2500);
        }
      }
    }

    // Dismiss any modal dialog (e.g. mobile-auth-dialog) that might intercept input
    await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const dialogs = doc?.querySelectorAll('dialog[open], #mobile-auth-dialog');
      dialogs?.forEach((d: any) => {
        try { d.close(); } catch {}
        d.remove();
      });
    }).catch(() => {});

    // Wait for input to be mounted and visible
    await page.waitForSelector(SEL.promptInput, { state: 'visible', timeout: 15000 }).catch(() => {});

    // Find input
    let inputEl = await page.$(SEL.promptInput);
    if (!inputEl) {
      inputEl = await page.$(SEL.promptInputAlt);
    }
    if (!inputEl) {
      await page.screenshot({ path: 'chatgpt-error-noinput.png' }).catch(() => {});
      throw new Error('[ChatGPT] Prompt textarea not found');
    }

    // Handle images before typing
    if (options?.images?.length) {
      await this.attachImages(page, options.images);
    }

    // Focus input and clear any residual draft
    await inputEl.click();
    await sleep(100);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await sleep(100);

    // Fast, reliable text insertion with React event triggering for all prompt lengths
    await page.keyboard.insertText(prompt);
    await page.keyboard.type(' ');
    await page.keyboard.press('Backspace');
    await humanDelay(150, 300);

    // Verify textarea actually contains text; if not, re-insert
    let val = await inputEl.evaluate((el: any) => el.value || el.innerText || '').catch(() => '');
    if (!val || val.length === 0) {
      await inputEl.click();
      await sleep(100);
      await page.keyboard.insertText(prompt);
      await page.keyboard.type(' ');
      await page.keyboard.press('Backspace');
      await sleep(300);
    }

    // Record initial message count to detect when new response arrives
    const initialMessageCount = (await page.$$(SEL.assistantMessages)).length;

    // Look for enabled send button, with wait for React state to update
    const sendBtn = await page.waitForSelector(
      'button[data-testid="send-button"]:not([disabled]), button[aria-label="Send message"]:not([disabled]), button[aria-label*="Send"]:not([disabled])',
      { timeout: 5000 }
    ).catch(() => null);

    if (sendBtn) {
      console.log('[ChatGPT] Send button found, clicking via coordinate center');
      const box = await sendBtn.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
      } else {
        await sendBtn.click().catch(() => {});
      }
    }
    await inputEl.focus().catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});

    // Confirm submission started; if textarea still holds prompt after 1.5s and no stop button, re-click
    await sleep(1500);
    const stopSeenEarly = await page.$(SEL.stopButton).catch(() => null);
    if (!stopSeenEarly) {
      const remainingVal = await inputEl.evaluate((el: any) => (el.value || el.innerText || '').trim()).catch(() => '');
      if (remainingVal.length > 0) {
        console.log('[ChatGPT] Input still has text after initial click, re-clicking send button');
        const retryBtn = await page.$('button[aria-label="Send message"], button[aria-label*="Send"], button[data-testid="send-button"]').catch(() => null);
        if (retryBtn) {
          const retryBox = await retryBtn.boundingBox().catch(() => null);
          if (retryBox) {
            await page.mouse.click(retryBox.x + retryBox.width / 2, retryBox.y + retryBox.height / 2).catch(() => {});
          } else {
            await retryBtn.click().catch(() => {});
          }
        }
        await inputEl.focus().catch(() => {});
        await page.keyboard.press('Enter').catch(() => {});
      }
    }

    await sleep(500);
    await page.screenshot({ path: 'chatgpt-debug-after-submit.png' }).catch(() => {});

    return this.waitForResponse(page, options?.timeoutMs ?? 180000, initialMessageCount);
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

  private async waitForResponse(page: Page, timeoutMs: number, initialMessageCount = 0): Promise<string> {
    const startTime = Date.now();
    console.log(`[ChatGPT] Waiting for response to start (initial count: ${initialMessageCount})...`);

    // 1. Wait for streaming to start OR for actual assistant text to appear
    let stopButtonSeen = false;
    const startWait = Date.now();
    while (Date.now() - startWait < 25000) {
      const stopVisible = await page.isVisible(SEL.stopButton).catch(() => false);
      if (stopVisible) {
        stopButtonSeen = true;
        break;
      }

      // Check if actual assistant text beyond "ChatGPT said:" has appeared
      const hasActualContent = await page.evaluate(({ sel }: { sel: string }) => {
        const doc = (globalThis as any).document;
        const messages = doc?.querySelectorAll(sel);
        if (!messages || messages.length === 0) return false;
        const last = messages[messages.length - 1];
        const md = last?.querySelector?.('[data-assistant-markdown], .markdown');
        const text = (md?.innerText || md?.textContent || last?.innerText || last?.textContent || '')
          .replace(/^(?:ChatGPT said:\s*|ChatGPT\s*:\s*|ChatGPT\s*)/i, '')
          .trim();
        return text.length > 0;
      }, { sel: SEL.assistantMessages }).catch(() => false);

      if (hasActualContent) {
        break;
      }
      await sleep(300);
    }

    if (stopButtonSeen) {
      console.log('[ChatGPT] Streaming started (stop button visible)');
      await page.waitForSelector(SEL.stopButton, { state: 'hidden', timeout: timeoutMs }).catch(() => {});
      console.log('[ChatGPT] Streaming completed (stop button hidden)');
    } else {
      console.log('[ChatGPT] Stop button not observed, proceeding to stability check');
    }

    // 2. Text stability check: ensure CLEANED text length > 0 and hasn't changed for at least 1500ms
    let lastText = '';
    let stableCycles = 0;
    const pollIntervalMs = 500;
    const requiredStableCycles = 3; // 3 x 500ms = 1.5s stable

    while (Date.now() - startTime < timeoutMs) {
      const currentText = await page.evaluate(({ sel }: { sel: string }) => {
        const doc = (globalThis as any).document;
        const messages = doc?.querySelectorAll(sel);
        if (!messages || messages.length === 0) return '';
        const last = messages[messages.length - 1];
        const md = last?.querySelector?.('[data-assistant-markdown], .markdown');
        const mdText = (md?.innerText || md?.textContent || '').trim();
        if (mdText.length > 0) return mdText;
        return (last?.innerText || last?.textContent || '').trim();
      }, { sel: SEL.assistantMessages }).catch(() => '');

      const cleanText = this.cleanResponse(currentText);
      const stopStillVisible = await page.isVisible(SEL.stopButton).catch(() => false);

      // CRITICAL: We only consider the response stable if:
      // 1. Cleaned text length > 0 (not just "ChatGPT said:")
      // 2. Stop button is not visible
      if (cleanText.length > 0 && !stopStillVisible) {
        if (cleanText === lastText) {
          stableCycles++;
          if (stableCycles >= requiredStableCycles) {
            break;
          }
        } else {
          lastText = cleanText;
          stableCycles = 0;
        }
      } else {
        stableCycles = 0;
      }

      await sleep(pollIntervalMs);
    }

    if (stableCycles < requiredStableCycles) {
      console.warn(`[ChatGPT] Stability loop ended without reaching ${requiredStableCycles} cycles (stableCycles=${stableCycles})`);
    }

    // Check for rate limit after response
    if (await this.detectRateLimit(page)) {
      this.status = 'rate-limited';
      throw new Error('[ChatGPT] Rate limit hit after response');
    }

    return this.extractLatestResponse(page);
  }

  private async extractLatestResponse(page: Page): Promise<string> {
    const messages = await page.$$(SEL.assistantMessages);
    if (messages.length === 0) {
      await page.screenshot({ path: 'chatgpt-debug-nomessages.png' }).catch(() => {});
      const articles = await page.$$eval('article', (els) => els.map(e => e.outerHTML.slice(0, 200))).catch(() => []);
      console.warn('[ChatGPT] Found 0 assistant messages. Articles on page:', articles);
      throw new Error('[ChatGPT] No assistant messages found');
    }

    const lastMessage = messages[messages.length - 1]!;

    const text = await lastMessage.evaluate((el: any) => {
      const md = el.querySelector('[data-assistant-markdown], .markdown');
      const mdText = (md?.innerText || md?.textContent || '').trim();
      if (mdText.length > 0) return mdText;
      return (el.innerText || el.textContent || '').trim();
    });

    const cleaned = this.cleanResponse(text ?? '');
    console.log(`[ChatGPT] Extracted response length: ${cleaned.length}, preview: "${cleaned.slice(0, 80)}"`);
    if (!cleaned || cleaned.length === 0) {
      await page.screenshot({ path: 'chatgpt-debug-emptyresponse.png' }).catch(() => {});
      throw new Error('[ChatGPT] Extracted response was empty or contained only accessibility header');
    }
    return cleaned;
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
      .replace(/^(?:ChatGPT said:\s*|ChatGPT\s*:\s*|ChatGPT\s*)/i, '')
      .replace(/^(Copy code|Copy)\s*/gm, '')
      .trim();
  }
}
