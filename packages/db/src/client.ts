// packages/db/src/client.ts
// SQLite client singleton using Drizzle ORM

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import * as schema from './schema/index.js';

export type DbClient = ReturnType<typeof createDbClient>;

function createDbClient(databaseUrl: string) {
  const dir = dirname(databaseUrl);
  if (dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(databaseUrl, {
    create: true,
    strict: true,
  });

  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA synchronous = NORMAL;');
  sqlite.exec('PRAGMA cache_size = -64000;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA temp_store = MEMORY;');

  return drizzle(sqlite, { schema });
}

// Singleton
let _db: DbClient | null = null;

export function getDb(): DbClient {
  if (!_db) {
    const url = process.env['DATABASE_URL'] ?? './data/omnichat.db';
    _db = createDbClient(url);
  }
  return _db;
}

export function initDb(databaseUrl: string): DbClient {
  _db = createDbClient(databaseUrl);
  return _db;
}

export { schema };
