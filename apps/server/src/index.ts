// apps/server/src/index.ts
// OmniChat Harness — Main server entry point

import { BrowserPool } from '@omni/browser';
import { ProviderRegistry, ALL_PROVIDER_IDS } from '@omni/providers';
import { ModelRegistry, DEFAULT_MODEL_CONFIGS } from '@omni/openai-adapter';
import { initDb } from '@omni/db';
import { createApp } from './app.js';

const app = createApp();

async function bootstrap() {
  const port = parseInt(process.env['PORT'] ?? '3000');
  const databaseUrl = process.env['DATABASE_URL'] ?? './data/omnichat.db';
  const sessionPath = process.env['SESSION_STORAGE_PATH'] ?? './data/sessions';
  const encryptionKey = process.env['SESSION_ENCRYPTION_KEY'] ?? 'dev-key-change-in-production!!';

  console.log('');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║      OmniChat Harness v0.1.0          ║');
  console.log('║  Dual OpenAI & Anthropic AI Gateway   ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');

  console.log('[Boot] Initializing database...');
  initDb(databaseUrl);
  console.log(`[Boot] Database ready: ${databaseUrl}`);

  console.log('[Boot] Loading model registry...');
  const modelRegistry = ModelRegistry.getInstance();
  modelRegistry.loadFromConfig(DEFAULT_MODEL_CONFIGS);
  console.log(`[Boot] ${modelRegistry.size} models registered`);

  console.log('[Boot] Starting browser pool...');
  const browserPool = BrowserPool.getInstance({
    sessionStoragePath: sessionPath,
    encryptionKey,
    maxContexts: parseInt(process.env['BROWSER_POOL_SIZE'] ?? '5'),
  });

  try {
    await browserPool.initialize(ALL_PROVIDER_IDS);
    console.log('[Boot] Browser pool ready');

    console.log('[Boot] Initializing providers...');
    const providerRegistry = ProviderRegistry.getInstance();
    await providerRegistry.initialize(browserPool);
    console.log('[Boot] Providers ready');
  } catch (err) {
    console.warn('[Boot] Browser pool initialization had issues — some providers may be unavailable:', err);
    console.warn('[Boot] Run `bun run session:init` to log in to providers');
  }

  console.log('');
  console.log(`[Boot] Server starting on port ${port}...`);
  console.log('');

  Bun.serve({
    port,
    fetch: app.fetch,
    idleTimeout: 255,
  });

  console.log(`✓ OmniChat Harness running at http://localhost:${port}`);
  console.log('');
  console.log('  Point your AI agents at:');
  console.log(`    OpenAI SDK / Cursor / Aider:    OPENAI_BASE_URL=http://localhost:${port}/v1`);
  console.log(`    Claude Code / Anthropic SDK:    ANTHROPIC_BASE_URL=http://localhost:${port}`);
  console.log(`    API Key (any format):           API_KEY=${process.env['OMNI_API_KEY'] ?? 'omni-local-dev-key'}`);
  console.log('');
  console.log('  Available endpoints:');
  console.log(`    POST http://localhost:${port}/v1/chat/completions (OpenAI Chat Completions)`);
  console.log(`    POST http://localhost:${port}/v1/messages         (Anthropic Messages API)`);
  console.log(`    GET  http://localhost:${port}/v1/models           (Model Discovery)`);
  console.log(`    GET  http://localhost:${port}/health             (Health & Provider Status)`);
  console.log('');

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  async function shutdown() {
    console.log('\n[Shutdown] Saving sessions and closing browser...');
    await browserPool.shutdown().catch(console.error);
    console.log('[Shutdown] Done. Goodbye.');
    process.exit(0);
  }
}

bootstrap().catch((err) => {
  console.error('[Boot] Fatal error:', err);
  process.exit(1);
});
