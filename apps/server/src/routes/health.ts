// apps/server/src/routes/health.ts

import { Hono } from 'hono';
import { BrowserPool } from '@omni/browser';
import { ProviderRegistry } from '@omni/providers';
import { ModelRegistry } from '@omni/openai-adapter';

const app = new Hono();

app.get('/', async (c) => {
  const providerRegistry = ProviderRegistry.getInstance();
  const modelRegistry = ModelRegistry.getInstance();

  let browser = null;
  try {
    browser = BrowserPool.getInstance().getStatus();
  } catch {
    browser = null;
  }

  const providerStatuses = await providerRegistry.getStatusSnapshot().catch(() => ({}));
  const providers = providerStatuses;

  const healthyCount = Object.values(providers).filter(
    (s) => s === 'healthy' || s === 'degraded'
  ).length;

  const overallStatus = healthyCount > 0 ? 'ok' : 'degraded';

  return c.json({
    status: overallStatus,
    version: '0.1.0',
    models: modelRegistry.size,
    providers: {
      total: Object.keys(providers).length,
      healthy: healthyCount,
      statuses: providers,
    },
    browser: browser
      ? {
          running: browser.browserRunning,
          contexts: browser.contextCount,
          statuses: browser.contexts,
        }
      : null,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export default app;
