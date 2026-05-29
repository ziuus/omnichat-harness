import { describe, expect, it } from 'bun:test';
import { readConfig } from '../app.js';

describe('TUI runtime config', () => {
  it('uses safe defaults', () => {
    const config = readConfig([], {});

    expect(config.serverUrl).toBe('http://localhost:3000');
    expect(config.apiKey).toBeUndefined();
    expect(config.refreshMs).toBe(2_000);
    expect(config.mode).toBe('watch');
  });

  it('enables one-shot mode from CLI flag', () => {
    const config = readConfig(['--once'], { OMNI_TUI_REFRESH_MS: '250' });

    expect(config.mode).toBe('once');
    expect(config.refreshMs).toBe(500);
  });

  it('reads server, key, interval, and one-shot mode from environment', () => {
    const config = readConfig([], {
      OMNI_SERVER_URL: 'http://localhost:3999',
      OMNI_API_KEY: 'test-key',
      OMNI_TUI_REFRESH_MS: '1500',
      OMNI_TUI_ONCE: '1',
    });

    expect(config.serverUrl).toBe('http://localhost:3999');
    expect(config.apiKey).toBe('test-key');
    expect(config.refreshMs).toBe(1_500);
    expect(config.mode).toBe('once');
  });
});
