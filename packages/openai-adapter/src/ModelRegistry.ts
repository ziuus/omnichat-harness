// packages/openai-adapter/src/ModelRegistry.ts
// Loads model definitions from config/models.yaml and serves them

import { readFileSync } from 'fs';
import { join } from 'path';
import type { ModelConfig } from '@omni/core';
import type { OpenAIModel, ModelListResponse } from './types/OpenAI.js';

// Simple YAML parser for our specific schema — avoids a dep
// For production, swap for `js-yaml`
function parseModelsYaml(content: string): ModelConfig[] {
  // We'll use a JSON-based config alongside YAML for the runtime
  // and parse YAML via a bundled parser
  throw new Error('Use loadFromJson instead — see ModelRegistry.fromConfig()');
}

export class ModelRegistry {
  private models: Map<string, ModelConfig> = new Map();
  private static instance: ModelRegistry | null = null;

  private constructor() {}

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  /**
   * Load models from a JS/TS config object.
   * Call this at server startup.
   */
  loadFromConfig(configs: ModelConfig[]): void {
    this.models.clear();
    for (const config of configs) {
      this.models.set(config.id, config);
    }
    console.log(`[ModelRegistry] Loaded ${this.models.size} models`);
  }

  /**
   * Get a model config by ID, with fuzzy resolution for common model aliases (e.g. gpt-4o, claude-3-5-sonnet).
   */
  get(modelId: string): ModelConfig | undefined {
    if (!modelId) return undefined;
    const direct = this.models.get(modelId);
    if (direct) return direct;

    const lower = modelId.toLowerCase().trim();
    // OpenAI / GPT aliases
    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('chatgpt') || lower.includes('davinci')) {
      return this.models.get('chatgpt');
    }
    // Claude / Anthropic aliases
    if (lower.includes('claude') || lower.includes('sonnet') || lower.includes('opus') || lower.includes('haiku')) {
      return this.models.get('claude-web');
    }
    // Gemini / Google aliases
    if (lower.includes('gemini') || lower.includes('flash')) {
      return this.models.get('gemini');
    }
    // Perplexity / Sonar aliases
    if (lower.includes('perplexity') || lower.includes('sonar')) {
      return this.models.get('perplexity');
    }

    // Default fallback to chatgpt or first available registered model
    return this.models.get('chatgpt') ?? this.models.values().next().value;
  }

  /**
   * Check if a model exists (or resolves via alias).
   */
  has(modelId: string): boolean {
    return this.get(modelId) !== undefined;
  }

  /**
   * Get all models as OpenAI ModelListResponse.
   */
  toOpenAIList(): ModelListResponse {
    const data: OpenAIModel[] = Array.from(this.models.values()).map((m) =>
      this.toOpenAIModel(m),
    );

    return {
      object: 'list',
      data,
    };
  }

  /**
   * Get a single model as OpenAI model object.
   */
  toOpenAIModel(config: ModelConfig): OpenAIModel {
    return {
      id: config.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'omnichat-harness',
      root: config.id,
      parent: null,
    };
  }

  get size(): number {
    return this.models.size;
  }
}

// ─── Default model configs (mirrors config/models.yaml) ──────────────────────

export const DEFAULT_MODEL_CONFIGS: ModelConfig[] = [
  // Mode 1: Self-orchestrated
  {
    id: 'omni-research',
    mode: 'self-orchestrated',
    name: 'OmniChat Research',
    description: 'Deep multi-provider research with citations and synthesis',
    context_window: 32000,
    routing: {
      strategy: 'parallel',
      providers: ['gemini', 'perplexity', 'claude-web', 'chatgpt'],
      roles: {
        gemini: 'researcher',
        perplexity: 'citations',
        'claude-web': 'analyst',
        chatgpt: 'explainer',
      },
      synthesis: 'internal',
    },
  },
  {
    id: 'omni-code',
    mode: 'self-orchestrated',
    name: 'OmniChat Code',
    description: 'Multi-provider code generation, review, and explanation',
    context_window: 32000,
    routing: {
      strategy: 'parallel',
      providers: ['chatgpt', 'claude-web', 'gemini'],
      roles: {
        chatgpt: 'generator',
        'claude-web': 'reviewer',
        gemini: 'explainer',
      },
      synthesis: 'internal',
    },
  },
  {
    id: 'omni-consensus',
    mode: 'self-orchestrated',
    name: 'OmniChat Consensus',
    description: 'All providers in parallel, majority consensus synthesis',
    context_window: 16000,
    routing: {
      strategy: 'all-parallel',
      synthesis: 'consensus',
    },
  },
  {
    id: 'omni-fast',
    mode: 'self-orchestrated',
    name: 'OmniChat Fast',
    description: 'Routes to the fastest currently available provider',
    context_window: 16000,
    routing: {
      strategy: 'fastest',
      providers: ['chatgpt', 'gemini', 'claude-web', 'perplexity'],
    },
  },
  {
    id: 'omni-image',
    mode: 'self-orchestrated',
    name: 'OmniChat Vision',
    description: 'Multi-provider image analysis',
    context_window: 16000,
    routing: {
      strategy: 'parallel',
      providers: ['chatgpt', 'gemini', 'claude-web'],
      roles: {
        chatgpt: 'ocr-and-description',
        gemini: 'deep-analysis',
        'claude-web': 'critique',
      },
      synthesis: 'internal',
    },
  },

  // Mode 2: Direct passthrough
  {
    id: 'chatgpt',
    mode: 'passthrough',
    name: 'ChatGPT (browser)',
    description: 'Direct access to ChatGPT web UI',
    context_window: 128000,
    routing: { strategy: 'direct' },
    provider: 'chatgpt',
  },
  {
    id: 'gemini',
    mode: 'passthrough',
    name: 'Gemini (browser)',
    description: 'Direct access to Gemini — best for long context (1M tokens)',
    context_window: 1000000,
    routing: { strategy: 'direct' },
    provider: 'gemini',
  },
  {
    id: 'claude-web',
    mode: 'passthrough',
    name: 'Claude (browser)',
    description: 'Direct access to Claude web UI',
    context_window: 200000,
    routing: { strategy: 'direct' },
    provider: 'claude-web',
  },
  {
    id: 'perplexity',
    mode: 'passthrough',
    name: 'Perplexity (browser)',
    description: 'Direct access to Perplexity — best for real-time search',
    context_window: 16000,
    routing: { strategy: 'direct' },
    provider: 'perplexity',
  },

  // Mode 3: Middleman agent
  {
    id: 'omni-middleman',
    mode: 'middleman',
    name: 'OmniChat Middleman',
    description: 'Your configured middleman LLM orchestrates all providers',
    context_window: 32000,
    routing: {
      strategy: 'parallel',
      available_providers: ['chatgpt', 'gemini', 'claude-web', 'perplexity'],
    },
  },
  {
    id: 'omni-middleman-fast',
    mode: 'middleman',
    name: 'OmniChat Middleman (Fast)',
    description: 'Middleman with fast provider subset only',
    context_window: 16000,
    routing: {
      strategy: 'parallel',
      available_providers: ['chatgpt', 'gemini'],
    },
  },
];
