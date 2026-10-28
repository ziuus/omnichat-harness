// packages/openai-adapter/src/types/OpenAI.ts
// Exact OpenAI API wire format — what every client expects

// ─── Request ────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: ToolDefinition[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  user?: string;
  /** OmniChat extension — clients can pass extra hints here */
  'x-omni-options'?: OmniRequestOptions;
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;              // data URI or https URL
    detail?: 'low' | 'high' | 'auto';
  };
}

export interface OmniRequestOptions {
  /** Force specific providers regardless of model routing */
  providers?: string[];
  /** Include per-provider breakdown in response metadata */
  includeProviderDetails?: boolean;
  /** Include evaluation scores in response metadata */
  includeEvaluation?: boolean;
  /** Override execution mode */
  mode?: 'self-orchestrated' | 'passthrough' | 'middleman';
}

// ─── Non-Streaming Response ──────────────────────────────────────────────────

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;             // unix timestamp
  model: string;
  choices: ChatCompletionChoice[];
  usage: TokenUsage;
  system_fingerprint?: string;
  /** OmniChat extensions — only present when requested */
  'x-omni-providers'?: string[];
  'x-omni-evaluation'?: unknown;
  'x-omni-subtasks'?: SubtaskSummary[];
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
  logprobs: null;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface SubtaskSummary {
  provider: string;
  role: string;
  durationMs: number;
  tokensEstimate: number;
}

// ─── Streaming ───────────────────────────────────────────────────────────────

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChunkChoice[];
  system_fingerprint?: string;
}

export interface ChunkChoice {
  index: number;
  delta: MessageDelta;
  finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
  logprobs: null;
}

export interface MessageDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

// ─── Models ──────────────────────────────────────────────────────────────────

export interface OpenAIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  permission?: ModelPermission[];
  root?: string;
  parent?: string | null;
}

export interface ModelPermission {
  id: string;
  object: 'model_permission';
  created: number;
  allow_create_engine: boolean;
  allow_sampling: boolean;
  allow_logprobs: boolean;
  allow_search_indices: boolean;
  allow_view: boolean;
  allow_fine_tuning: boolean;
  organization: string;
  group: string | null;
  is_blocking: boolean;
}

export interface ModelListResponse {
  object: 'list';
  data: OpenAIModel[];
}

// ─── Legacy completions ───────────────────────────────────────────────────────

export interface CompletionRequest {
  model: string;
  prompt: string | string[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface CompletionResponse {
  id: string;
  object: 'text_completion';
  created: number;
  model: string;
  choices: CompletionChoice[];
  usage: TokenUsage;
}

export interface CompletionChoice {
  text: string;
  index: number;
  finish_reason: 'stop' | 'length' | null;
  logprobs: null;
}

// ─── Embeddings ───────────────────────────────────────────────────────────────

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
}

export interface EmbeddingResponse {
  object: 'list';
  data: EmbeddingData[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingData {
  object: 'embedding';
  embedding: number[];
  index: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export interface OpenAIError {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}
