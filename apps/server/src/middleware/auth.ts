// apps/server/src/middleware/auth.ts
// Validates Bearer token against OMNI_API_KEY

import type { MiddlewareHandler } from 'hono';

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const apiKey = process.env['OMNI_API_KEY'];

  // If no key configured, allow all (dev mode)
  if (!apiKey || apiKey === 'omni-local-dev-key') {
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json(
      { error: { message: 'Missing Authorization header', type: 'auth_error', code: 'missing_api_key', param: null } },
      401,
    );
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token !== apiKey) {
    return c.json(
      { error: { message: 'Invalid API key', type: 'auth_error', code: 'invalid_api_key', param: null } },
      401,
    );
  }

  await next();
  return;
};
