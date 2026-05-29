// packages/core/src/types/Routing.ts

export type ExecutionMode = 'self-orchestrated' | 'passthrough' | 'middleman';
export type RoutingStrategy =
  | 'parallel'
  | 'all-parallel'
  | 'fastest'
  | 'direct'
  | 'sequential';

export interface ModelConfig {
  id: string;
  mode: ExecutionMode;
  name: string;
  description: string;
  context_window: number;
  routing: RoutingConfig;
  provider?: string;  // only for passthrough mode
}

export interface RoutingConfig {
  strategy: RoutingStrategy;
  providers?: string[];
  roles?: Record<string, string>;
  synthesis?: 'internal' | 'consensus' | 'weighted' | 'best-of';
  available_providers?: string[];
}

export interface MiddlemanConfig {
  type: 'ollama' | 'openai' | 'anthropic' | 'openai-compatible';
  apiKey?: string;
  baseUrl?: string;
  model: string;
  systemPrompt?: string;
}

export interface RouterDecision {
  modelConfig: ModelConfig;
  selectedProviders: string[];
  strategy: RoutingStrategy;
  executionMode: ExecutionMode;
  middlemanConfig?: MiddlemanConfig;
}
