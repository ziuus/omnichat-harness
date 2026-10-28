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

  private activePage: Page | null = null;

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

    // Intercept and block heavy media & analytics/telemetry to speed up interactions
    await this.ctx.route('**/*', (route) => {
      const url = route.request().url();
      if (
        url.includes('/events/') ||
        url.includes('google-analytics') ||
        url.includes('doubleclick') ||
        url.includes('statsig') ||
        url.includes('/telemetry') ||
        /\.(mp4|webm|mkv|avi)(\?.*)?$/i.test(url)
      ) {
        return route.abort();
      }
      return route.continue();
    });

    this._status = 'idle';
  }

  /**
   * Get or reuse a warm persistent page from this context.
   */
  async getPage(): Promise<Page> {
    if (!this.ctx) throw new Error(`Context for ${this.providerId} is not initialized`);

    this._status = 'busy';
    this._lastUsed = new Date();
    this._requestCount++;

    if (!this.activePage || this.activePage.isClosed()) {
      this.activePage = await this.ctx.newPage();
    }

    return this.activePage;
  }

  /**
   * Close the active page so the next request gets a fresh page.
   */
  async recyclePage(): Promise<void> {
    if (this.activePage && !this.activePage.isClosed()) {
      await this.activePage.close().catch(() => {});
    }
    this.activePage = null;
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

    return this.ctx.newPage();
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
