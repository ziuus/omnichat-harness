import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/index.ts',
  out: './src/migrations',
  driver: 'better-sqlite',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? './data/omnichat.db',
  },
} satisfies Config;
