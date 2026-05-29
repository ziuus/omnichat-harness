#!/usr/bin/env bun
// scripts/session-init.ts
// Interactive script to log in to each AI provider and save the session
//
// Usage:
//   bun run session:init                # init all providers
//   bun run session:init gemini         # init specific provider
//   bun run session:init chatgpt gemini # init multiple

import { chromium } from 'playwright';
import {
  getLaunchOptions,
  getContextOptions,
  getRandomProfile,
  STEALTH_INIT_SCRIPT,
} from '../packages/browser/src/StealthConfig.js';
import { createCipheriv, randomBytes } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import * as readline from 'readline';

const PROVIDER_URLS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com',
  gemini: 'https://gemini.google.com',
  'claude-web': 'https://claude.ai',
  perplexity: 'https://www.perplexity.ai',
};

const SESSION_PATH = process.env['SESSION_STORAGE_PATH'] ?? './data/sessions';
const ENCRYPTION_KEY = process.env['SESSION_ENCRYPTION_KEY'] ?? 'dev-key-change-in-production!!';

function encrypt(plaintext: string, key: string): string {
  const keyBuf = Buffer.from(key.padEnd(32, '0').slice(0, 32));
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

async function initProvider(providerId: string): Promise<void> {
  const url = PROVIDER_URLS[providerId];
  if (!url) {
    console.error(`Unknown provider: ${providerId}`);
    console.error(`Available: ${Object.keys(PROVIDER_URLS).join(', ')}`);
    return;
  }

  console.log('');
  console.log(`━━━ Initializing session: ${providerId} ━━━`);
  console.log('');
  console.log('A browser window will open. Please:');
  console.log(`  1. Log in to ${providerId} (${url})`);
  console.log('  2. Complete any 2FA or verification');
  console.log('  3. Make sure you can see the chat interface');
  console.log('  4. Press ENTER in this terminal when done');
  console.log('');

  const browser = await chromium.launch({
    ...getLaunchOptions(),
    headless: false, // MUST be visible for login
  });

  const profile = getRandomProfile();
  const context = await browser.newContext(getContextOptions(profile));
  await context.addInitScript(STEALTH_INIT_SCRIPT);

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait for human to log in
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdout.write('Press ENTER when logged in and ready > ');
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });

  // Save session
  try {
    const state = await context.storageState();
    const json = JSON.stringify(state);
    const encrypted = encrypt(json, ENCRYPTION_KEY);

    mkdirSync(SESSION_PATH, { recursive: true });
    const filePath = join(SESSION_PATH, `${providerId}.enc`);
    writeFileSync(filePath, encrypted);

    console.log(`✓ Session saved: ${filePath}`);
    console.log(`  Cookies: ${state.cookies.length}`);
    console.log(`  Origins: ${state.origins.length}`);
  } catch (err) {
    console.error('Failed to save session:', err);
  } finally {
    await browser.close();
  }
}

function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getAvailableBrowsers(): string[] {
  const available: string[] = [];
  
  // Check for Chrome
  if (checkCommand('google-chrome') || checkCommand('google-chrome-stable') || checkCommand('chrome')) {
    available.push('chrome');
  }
  // Check for Edge
  if (checkCommand('microsoft-edge') || checkCommand('microsoft-edge-stable') || checkCommand('msedge')) {
    available.push('msedge');
  }
  // Check for Chromium
  if (checkCommand('chromium') || checkCommand('chromium-browser')) {
    available.push('chromium');
  }
  
  return available;
}

async function promptBrowserSelection(): Promise<string | undefined> {
  const browsers = getAvailableBrowsers();
  if (browsers.length === 0) return undefined;
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('Available browsers found on your system:');
    browsers.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
    console.log(`  0. Default / Custom (let the script decide)`);
    
    rl.question('\nSelect a browser number (or press Enter for default): ', (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (num > 0 && num <= browsers.length) {
        resolve(browsers[num - 1]);
      } else {
        resolve(undefined);
      }
    });
  });
}

async function main() {
  // Only parse arguments that don't start with "--" as providers
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const providers = args.length > 0 ? args : Object.keys(PROVIDER_URLS);

  console.log('');
  console.log('╔══════════════════════════════════╗');
  console.log('║   OmniChat Session Initializer   ║');
  console.log('╚══════════════════════════════════╝');
  console.log('');
  console.log(`Providers to initialize: ${providers.join(', ')}`);
  console.log('');

  const hasCliArg = process.argv.some(a => a.startsWith('--browser'));
  if (!hasCliArg && !process.env['OMNI_BROWSER']) {
    const selected = await promptBrowserSelection();
    if (selected) {
      process.env['OMNI_BROWSER'] = selected;
      console.log(`\nUsing browser: ${selected}\n`);
    }
  }

  for (const provider of providers) {
    await initProvider(provider);
    console.log('');
  }

  console.log('━━━ All sessions initialized! ━━━');
  console.log('');
  console.log('Start the server: bun run dev:server');
  console.log('');
}

main().catch(console.error);
