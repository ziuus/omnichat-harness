// packages/db/src/migrate.ts
// Run database migrations — call at startup or via `bun run db:migrate`

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import * as schema from './schema/index.js';

async function runMigrations() {
  const databaseUrl = process.env['DATABASE_URL'] ?? './data/omnichat.db';

  const dir = dirname(databaseUrl);
  if (dir !== '.') mkdirSync(dir, { recursive: true });

  console.log(`[Migrate] Running migrations on: ${databaseUrl}`);

  const sqlite = new Database(databaseUrl, {
    create: true,
    strict: true,
  });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  const db = drizzle(sqlite, { schema });

  // Run all migrations from the migrations folder
  // For initial setup without migration files, we use push instead
  try {
    await migrate(db, {
      migrationsFolder: join(import.meta.dir, 'migrations'),
    });
    console.log('[Migrate] Migrations complete');
  } catch {
    console.log('[Migrate] No migration files found — using schema push');
    // Create tables directly from schema for dev
    pushSchema(sqlite);
  }

  sqlite.close();
}

function pushSchema(sqlite: InstanceType<typeof Database>) {
  // Create all tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'normal',
      execution_mode TEXT NOT NULL,
      model_id TEXT NOT NULL,
      input_prompt TEXT NOT NULL,
      input_messages_json TEXT NOT NULL,
      input_system_context TEXT,
      has_images INTEGER NOT NULL DEFAULT 0,
      plan_json TEXT,
      final_output TEXT,
      evaluation_json TEXT,
      streaming_chunks_json TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
    CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks(created_at);

    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      parent_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      assigned_provider TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_content TEXT,
      result_meta_json TEXT,
      duration_ms INTEGER,
      tokens_estimate INTEGER,
      retries INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS subtasks_parent_idx ON subtasks(parent_task_id);
    CREATE INDEX IF NOT EXISTS subtasks_provider_idx ON subtasks(assigned_provider);

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'initializing',
      capabilities_json TEXT NOT NULL,
      limits_json TEXT,
      stats_json TEXT,
      last_health_check INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id),
      cookies_encrypted TEXT,
      storage_state_encrypted TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_used INTEGER,
      expires_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_provider_idx ON sessions(provider_id);

    CREATE TABLE IF NOT EXISTS response_cache (
      id TEXT PRIMARY KEY,
      prompt_hash TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      content TEXT NOT NULL,
      quality_score REAL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      ttl_expires_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS cache_hash_idx ON response_cache(prompt_hash, provider_id);

    CREATE TABLE IF NOT EXISTS provider_stats (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      avg_duration_ms REAL,
      total_tokens_estimate INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS stats_provider_bucket_idx ON provider_stats(provider_id, bucket);

    CREATE TABLE IF NOT EXISTS conversation_memory (
      id TEXT PRIMARY KEY,
      external_conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tokens_estimate INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memory_conv_idx ON conversation_memory(external_conversation_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      component TEXT NOT NULL,
      message TEXT NOT NULL,
      meta_json TEXT,
      task_id TEXT,
      provider_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS audit_level_idx ON audit_log(level);
    CREATE INDEX IF NOT EXISTS audit_created_at_idx ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS audit_task_idx ON audit_log(task_id);
  `);

  console.log('[Migrate] Schema pushed successfully');
}

runMigrations().catch((err) => {
  console.error('[Migrate] Fatal:', err);
  process.exit(1);
});
