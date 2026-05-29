// packages/browser/src/BrowserContext.ts
// Wraps a Playwright BrowserContext with session management and recovery

import type { Browser, BrowserContext as PlaywrightContext, Page } from 'playwright';
import {
  getLaunchOptions,
  getContextOptions,
  getRandomProfile,
  STEALTH_INIT_SCRIPT,
  type StealthProfile,
} from './StealthConfig.js';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

type PersistedStorageState = NonNullable<NonNullable<Parameters<Browser['newContext']>[0]>['storageState']>;

export type ContextStatus = 'idle' | 'busy' | 'recovering' | 'dead';

export interface ManagedContextOptions {
  providerId: string;
  sessionStoragePath: string;
  encryptionKey: string;
}

export class ManagedBrowserContext {
  readonly providerId: string;
  private ctx: PlaywrightContext | null = null;
  private browser: Browser | null = null;
  private profile: StealthProfile;
  private sessionPath: string;
  private encryptionKey: Buffer;
  private _status: ContextStatus = 'idle';
  private _lastUsed: Date = new Date();
  private _requestCount = 0;

  constructor(options: ManagedContextOptions) {
    this.providerId = options.providerId;
    this.profile = getRandomProfile();
    this.sessionPath = join(options.sessionStoragePath, `${options.providerId}.enc`);
    this.encryptionKey = Buffer.from(options.encryptionKey.padEnd(32, '0').slice(0, 32));

    // Ensure storage directory exists
    mkdirSync(options.sessionStoragePath, { recursive: true });
  }

  get status(): ContextStatus {
    return this._status;
  }

  get lastUsed(): Date {
    return this._lastUsed;
  }

  get requestCount(): number {
    return this._requestCount;
  }

  /**
   * Initialize the browser context, restoring session if available.
   */
  async initialize(browser: Browser): Promise<void> {
    this.browser = browser;

    const savedState = this.loadStorageState();
    const contextOptions = getContextOptions(this.profile);

    if (savedState) {
      console.log(`[BrowserContext:${this.providerId}] Restoring saved session`);
      this.ctx = await browser.newContext({
        ...contextOptions,
        storageState: savedState,
      });
    } else {
      console.log(`[BrowserContext:${this.providerId}] Creating fresh context`);
      this.ctx = await browser.newContext(contextOptions);
    }

    // Inject stealth scripts on every page
    await this.ctx.addInitScript(STEALTH_INIT_SCRIPT);

    // Intercept and block unnecessary resources to speed up interactions
    await this.ctx.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,mp4,webm}', (route) => {
      // Only block on non-image-task providers
      route.continue();
    });

    this._status = 'idle';
  }

  /**
   * Get a new page from this context.
   * Caller is responsible for closing the page when done.
   */
  async newPage(): Promise<Page> {
    if (!this.ctx) throw new Error(`Context for ${this.providerId} is not initialized`);

    this._status = 'busy';
    this._lastUsed = new Date();
    this._requestCount++;

    const page = await this.ctx.newPage();

    // Add human-like behavior
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    });

    return page;
  }

  /**
   * Mark context as idle after a page interaction completes.
   */
  markIdle(): void {
    this._status = 'idle';
  }

  /**
   * Save the current session state (cookies, localStorage) encrypted to disk.
   */
  async saveSession(): Promise<void> {
    if (!this.ctx) return;

    try {
      const state = await this.ctx.storageState();
      const json = JSON.stringify(state);
      const encrypted = this.encrypt(json);
      writeFileSync(this.sessionPath, encrypted);
      console.log(`[BrowserContext:${this.providerId}] Session saved`);
    } catch (err) {
      console.warn(`[BrowserContext:${this.providerId}] Failed to save session:`, err);
    }
  }

  /**
   * Clear the saved session from disk.
   */
  clearSavedSession(): void {
    try {
      if (existsSync(this.sessionPath)) {
        require('fs').unlinkSync(this.sessionPath);
      }
    } catch {}
  }

  /**
   * Full reset: close context, clear session, reinitialize.
   */
  async reset(): Promise<void> {
    this._status = 'recovering';
    this.clearSavedSession();

    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
    }

    if (this.browser) {
      this.profile = getRandomProfile(); // new fingerprint
      await this.initialize(this.browser);
    }
  }

  /**
   * Close the context gracefully.
   */
  async close(): Promise<void> {
    await this.saveSession();
    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this._status = 'dead';
  }

  // ─── Session encryption ────────────────────────────────────────────────────

  private encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: iv(hex):tag(hex):data(hex)
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(ciphertext: string): string {
    const [ivHex, tagHex, dataHex] = ciphertext.split(':');
    if (!ivHex || !tagHex || !dataHex) throw new Error('Invalid ciphertext format');

    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data).toString('utf8') + decipher.final('utf8');
  }

  private loadStorageState(): PersistedStorageState | null {
    if (!existsSync(this.sessionPath)) return null;

    try {
      const encrypted = readFileSync(this.sessionPath, 'utf8');
      const json = this.decrypt(encrypted);
      return JSON.parse(json);
    } catch (err) {
      console.warn(`[BrowserContext:${this.providerId}] Could not restore session:`, err);
      return null;
    }
  }
}
