import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth.js';
import chatCompletions from './routes/chat-completions.js';
import messages from './routes/messages.js';
import models from './routes/models.js';
import health from './routes/health.js';

export function createApp() {
  const app = new Hono();

  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version'],
  }));

  app.use('*', logger());

  app.route('/health', health);
  app.get('/', (c) => c.redirect('/health'));

  // Universal authentication on all API routes
  app.use('/v1/*', authMiddleware);
  app.use('/api/v1/*', authMiddleware);
  app.use('/chat/*', authMiddleware);
  app.use('/messages', authMiddleware);

  // OpenAI chat completions (supports base URLs with /v1, without /v1, and OpenRouter /api/v1)
  app.route('/v1/chat/completions', chatCompletions);
  app.route('/chat/completions', chatCompletions);
  app.route('/api/v1/chat/completions', chatCompletions);
  app.route('/v1/v1/chat/completions', chatCompletions);

  // Anthropic messages (supports ANTHROPIC_BASE_URL with or without /v1)
  app.route('/v1/messages', messages);
  app.route('/messages', messages);
  app.route('/api/v1/messages', messages);
  app.route('/v1/v1/messages', messages);

  // Model listing
  app.route('/v1/models', models);
  app.route('/models', models);
  app.route('/api/v1/models', models);

  app.post('/v1/completions', async (c) => {
    const body = await c.req.json();
    const chatBody = {
      model: body.model,
      messages: [{ role: 'user', content: body.prompt }],
      stream: body.stream,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
    };

    return c.json({
      error: {
        message: 'Use /v1/chat/completions instead. Legacy completions endpoint routes there.',
        type: 'deprecation_notice',
        details: chatBody,
      },
    }, 400);
  });

  app.post('/v1/embeddings', (c) => {
    return c.json({
      object: 'list',
      data: [{ object: 'embedding', embedding: new Array(1536).fill(0), index: 0 }],
      model: 'text-embedding-stub',
      usage: { prompt_tokens: 0, total_tokens: 0 },
    });
  });

  app.notFound((c) => {
    return c.json(
      { error: { message: `Route ${c.req.method} ${c.req.path} not found`, type: 'not_found', param: null, code: null } },
      404,
    );
  });

  return app;
}

export default createApp;
