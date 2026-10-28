// packages/core/src/types/Task.ts

import type { ProviderCapability, ProviderResponse } from './Provider.js';
import type { EvaluationResult } from './Evaluation.js';

export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'routing'
  | 'running'
  | 'awaiting-subtasks'
  | 'evaluating'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export type ExecutionMode = 'self-orchestrated' | 'passthrough' | 'middleman';

// ─── Input ──────────────────────────────────────────────────────────────────

export interface TaskInput {
  /** The main prompt from the user/agent */
  prompt: string;
  /** Full conversation history (OpenAI message format) */
  messages: ConversationMessage[];
  /** Attached images */
  images?: ImageRef[];
  /** Additional system context */
  systemContext?: string;
  /** Required capabilities for routing */
  requiredCapabilities?: ProviderCapability[];
  /** Force specific providers */
  preferredProviders?: string[];
  /** Max providers to use in parallel */
  maxProviders?: number;
  /** Execution mode derived from model name */
  executionMode: ExecutionMode;
  /** The raw model name from the API request */
  modelId: string;
  /** Available function/tool calling schemas */
  tools?: any[];
  /** Tool choice directive ('auto', 'required', 'none', or specific function) */
  toolChoice?: any;
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: any[];
}

export interface ImageRef {
  data: Buffer;
  mimeType: string;
  filename?: string;
}

// ─── Plan ───────────────────────────────────────────────────────────────────

export interface TaskPlan {
  objective: string;
  approach: string;
  subtaskDefinitions: SubTaskDefinition[];
  synthesisStrategy: 'internal' | 'consensus' | 'weighted' | 'best-of';
  estimatedDurationMs?: number;
}

export interface SubTaskDefinition {
  /** Semantic role: "researcher", "analyst", "reviewer", etc. */
  role: string;
  /** The specific prompt for this subtask */
  prompt: string;
  /** Provider to assign this to */
  assignedProvider: string;
  /** Can this run at the same time as other subtasks? */
  canRunInParallel: boolean;
  /** Must wait for these roles to complete first */
  dependsOn?: string[];
}

// ─── Execution ──────────────────────────────────────────────────────────────

export interface SubTask {
  id: string;
  parentTaskId: string;
  role: string;
  assignedProvider: string;
  prompt: string;
  status: TaskStatus;
  result?: ProviderResponse;
  retries: number;
  maxRetries: number;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface Task {
  id: string;
  input: TaskInput;
  status: TaskStatus;
  priority: TaskPriority;
  plan?: TaskPlan;
  subtasks: SubTask[];
  evaluation?: EvaluationResult;
  finalOutput?: string;
  error?: string;
  streamingChunks: StreamingChunk[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// ─── Streaming ──────────────────────────────────────────────────────────────

export interface StreamingChunk {
  type: 'status' | 'progress' | 'partial' | 'final' | 'error';
  content: string;
  provider?: string;
  timestamp: Date;
}
