// packages/browser/src/StealthConfig.ts
// Anti-bot-detection configuration for Playwright
// Mimics a real Chrome browser as closely as possible

import type { BrowserContextOptions, LaunchOptions } from 'playwright';

// Real Chrome user agents — rotate to avoid fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

// Realistic viewport sizes
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
];

// Realistic timezones
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
];

export interface StealthProfile {
  userAgent: string;
  viewport: { width: number; height: number };
  timezone: string;
  locale: string;
}

export function getRandomProfile(): StealthProfile {
  return {
    userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!,
    viewport: VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)]!,
    timezone: TIMEZONES[Math.floor(Math.random() * TIMEZONES.length)]!,
    locale: 'en-US',
  };
}

// Helper to extract argument from command line
function getArg(flag: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`));
  if (arg) return arg.split('=')[1];
  
  const index = process.argv.indexOf(`--${flag}`);
  if (index !== -1 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return undefined;
}

export function getLaunchOptions(): LaunchOptions {
  // Use CLI arg --browser=... if provided, otherwise env, otherwise default to chrome
  const channel = getArg('browser') ?? process.env['OMNI_BROWSER'] ?? 'chrome';
  
  return {
    channel,
    headless: process.env['BROWSER_HEADLESS'] !== 'false',
    args: [
      '--ignore-certificate-errors',
      // Disable automation flags
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // Performance
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      // Privacy noise reduction that bots do — avoid these to look human
      // '--disable-web-security',  ← DO NOT use, looks robotic
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };
}

export function getContextOptions(profile: StealthProfile): BrowserContextOptions {
  return {
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    timezoneId: profile.timezone,
    locale: profile.locale,
    // Permissions a real browser grants
    permissions: ['notifications'],
    // Real browser headers
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    // Emulate real device memory & CPU
    bypassCSP: false,
  };
}

/**
 * JavaScript to inject into every page.
 * Patches navigator properties that headless Chrome exposes.
 */
export const STEALTH_INIT_SCRIPT = `
  // Patch webdriver flag
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });

  // Patch plugins (headless has 0 plugins, real Chrome has many)
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      return Object.assign(plugins, {
        item: (i) => plugins[i],
        namedItem: (name) => plugins.find(p => p.name === name),
        refresh: () => {},
        length: plugins.length,
      });
    },
  });

  // Patch languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });

  // Patch chrome object (missing in headless)
  if (!window.chrome) {
    window.chrome = {
      runtime: {
        onConnect: { addListener: () => {} },
        onMessage: { addListener: () => {} },
      },
    };
  }

  // Patch permission query (headless returns 'denied' for notifications)
  const originalQuery = window.navigator.permissions?.query;
  if (originalQuery) {
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: 'denied', onchange: null })
        : originalQuery(parameters);
  }
`;
