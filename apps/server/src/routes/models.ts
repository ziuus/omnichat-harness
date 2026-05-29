// apps/server/src/routes/models.ts
// GET /v1/models and GET /v1/models/:id

import { Hono } from 'hono';
import { ModelRegistry } from '@omni/openai-adapter';
import { ProviderRegistry } from '@omni/providers';

const app = new Hono();

// GET /v1/models
app.get('/', async (c) => {
  const registry = ModelRegistry.getInstance();
  const list = registry.toOpenAIList();

  // Annotate with live provider status
  const providerRegistry = ProviderRegistry.getInstance();
  const statusSnapshot: Record<string, string> = await providerRegistry.getStatusSnapshot().catch(
    () => ({}) as Record<string, string>,
  );

  // Add status as description suffix for healthy info
  const enrichedData = list.data.map((model) => ({
    ...model,
    // Non-standard but useful for debugging
    // Clients ignore unknown fields per OpenAI spec
    'x-omni-status': statusSnapshot[model.id] ?? 'unknown',
  }));

  return c.json({ ...list, data: enrichedData });
});

// GET /v1/models/:id
app.get('/:id', (c) => {
  const id = c.req.param('id');
  const registry = ModelRegistry.getInstance();
  const config = registry.get(id);

  if (!config) {
    return c.json(
      {
        error: {
          message: `No such model: ${id}`,
          type: 'invalid_request_error',
          param: 'id',
          code: 'model_not_found',
        },
      },
      404,
    );
  }

  return c.json(registry.toOpenAIModel(config));
});

export default app;
