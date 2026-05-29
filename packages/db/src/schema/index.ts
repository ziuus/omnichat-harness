// packages/db/src/schema/index.ts
// Complete SQLite schema using Drizzle ORM

import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    status: text('status', {
      enum: ['pending', 'planning', 'routing', 'running', 'awaiting-subtasks',
             'evaluating', 'synthesizing', 'completed', 'failed', 'cancelled'],
    }).notNull().default('pending'),
    priority: text('priority', {
      enum: ['low', 'normal', 'high', 'critical'],
    }).notNull().default('normal'),
    executionMode: text('execution_mode', {
      enum: ['self-orchestrated', 'passthrough', 'middleman'],
    }).notNull(),
    modelId: text('model_id').notNull(),

    // Input
    inputPrompt: text('input_prompt').notNull(),
    inputMessagesJson: text('input_messages_json').notNull(),
    inputSystemContext: text('input_system_context'),
    hasImages: integer('has_images', { mode: 'boolean' }).notNull().default(false),

    // Execution
    planJson: text('plan_json'),           // TaskPlan as JSON
    finalOutput: text('final_output'),
    evaluationJson: text('evaluation_json'), // EvaluationResult as JSON
    streamingChunksJson: text('streaming_chunks_json'),

    // Error
    error: text('error'),

    // Timing
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (t) => ({
    statusIdx: index('tasks_status_idx').on(t.status),
    createdAtIdx: index('tasks_created_at_idx').on(t.createdAt),
  }),
);

// ─── Subtasks ─────────────────────────────────────────────────────────────────

export const subtasks = sqliteTable(
  'subtasks',
  {
    id: text('id').primaryKey(),
    parentTaskId: text('parent_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    assignedProvider: text('assigned_provider').notNull(),
    prompt: text('prompt').notNull(),
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    }).notNull().default('pending'),

    // Result
    resultContent: text('result_content'),
    resultMetaJson: text('result_meta_json'),
    durationMs: integer('duration_ms'),
    tokensEstimate: integer('tokens_estimate'),

    // Retry tracking
    retries: integer('retries').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),
    error: text('error'),

    // Timing
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (t) => ({
    parentIdx: index('subtasks_parent_idx').on(t.parentTaskId),
    providerIdx: index('subtasks_provider_idx').on(t.assignedProvider),
  }),
);

// ─── Providers ────────────────────────────────────────────────────────────────

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status', {
    enum: ['healthy', 'degraded', 'unavailable', 'rate-limited',
           'needs-captcha', 'session-expired', 'initializing'],
  }).notNull().default('initializing'),
  capabilitiesJson: text('capabilities_json').notNull(), // string[]
  limitsJson: text('limits_json'),                       // ProviderLimits
  statsJson: text('stats_json'),                         // ProviderStats
  lastHealthCheck: integer('last_health_check', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    /** AES-256-GCM encrypted cookie JSON */
    cookiesEncrypted: text('cookies_encrypted'),
    /** Browser context state for faster restore */
    storageStateEncrypted: text('storage_state_encrypted'),
    status: text('status', {
      enum: ['active', 'stale', 'expired', 'needs-reauth'],
    }).notNull().default('active'),
    lastUsed: integer('last_used', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    providerIdx: index('sessions_provider_idx').on(t.providerId),
  }),
);

// ─── Response Cache ───────────────────────────────────────────────────────────

export const responseCache = sqliteTable(
  'response_cache',
  {
    id: text('id').primaryKey(),
    /** SHA-256 of (providerId + prompt) */
    promptHash: text('prompt_hash').notNull(),
    providerId: text('provider_id').notNull(),
    content: text('content').notNull(),
    qualityScore: real('quality_score'),
    hitCount: integer('hit_count').notNull().default(0),
    ttlExpiresAt: integer('ttl_expires_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    hashIdx: uniqueIndex('cache_hash_idx').on(t.promptHash, t.providerId),
  }),
);

// ─── Provider Stats ───────────────────────────────────────────────────────────

export const providerStats = sqliteTable(
  'provider_stats',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull(),
    /** Hourly bucket: YYYY-MM-DD-HH */
    bucket: text('bucket').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    avgDurationMs: real('avg_duration_ms'),
    totalTokensEstimate: integer('total_tokens_estimate').notNull().default(0),
  },
  (t) => ({
    providerBucketIdx: uniqueIndex('stats_provider_bucket_idx').on(
      t.providerId,
      t.bucket,
    ),
  }),
);

// ─── Memory / Conversation ────────────────────────────────────────────────────

export const conversationMemory = sqliteTable(
  'conversation_memory',
  {
    id: text('id').primaryKey(),
    /** External conversation ID (from the AI agent client) */
    externalConversationId: text('external_conversation_id').notNull(),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    tokensEstimate: integer('tokens_estimate'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    convIdx: index('memory_conv_idx').on(t.externalConversationId),
  }),
);

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    level: text('level', { enum: ['debug', 'info', 'warn', 'error'] }).notNull(),
    component: text('component').notNull(),
    message: text('message').notNull(),
    metaJson: text('meta_json'),
    taskId: text('task_id'),
    providerId: text('provider_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    levelIdx: index('audit_level_idx').on(t.level),
    createdAtIdx: index('audit_created_at_idx').on(t.createdAt),
    taskIdx: index('audit_task_idx').on(t.taskId),
  }),
);
