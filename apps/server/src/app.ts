import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authMiddleware } from './middleware/auth.js';
import chatCompletions from './routes/chat-completions.js';
import models from './routes/models.js';
import health from './routes/health.js';

export function createApp() {
  const app = new Hono();

  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use('*', logger());

  app.route('/health', health);
  app.get('/', (c) => c.redirect('/health'));

  app.use('/v1/*', authMiddleware);
  app.route('/v1/chat/completions', chatCompletions);
  app.route('/v1/models', models);

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
