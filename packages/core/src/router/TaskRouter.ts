// packages/core/src/router/TaskRouter.ts
// Routes tasks to providers based on execution mode and routing strategy

import type { TaskInput, RouterDecision, ModelConfig, MiddlemanConfig } from '../types/index.js';
import type { Provider } from '../types/Provider.js';

export interface ProviderAvailability {
  id: string;
  status: string;
  avgResponseMs?: number;
}

export class TaskRouter {
  private getMiddlemanConfig(): MiddlemanConfig | undefined {
    const type = process.env['OMNI_MIDDLEMAN_TYPE'] as MiddlemanConfig['type'] | undefined;
    if (!type) return undefined;

    const config: MiddlemanConfig = {
      type,
      model: process.env['OMNI_MIDDLEMAN_MODEL'] ?? 'llama3.1:70b',
    };

    const apiKey = process.env['OMNI_MIDDLEMAN_API_KEY'];
    const baseUrl = process.env['OMNI_MIDDLEMAN_BASE_URL'];

    if (apiKey) config.apiKey = apiKey;
    if (baseUrl) config.baseUrl = baseUrl;

    return config;
  }

  /**
   * Determine the routing decision for a task.
   */
  route(
    input: TaskInput,
    modelConfig: ModelConfig,
    availability: ProviderAvailability[],
  ): RouterDecision {
    const healthyIds = availability
      .filter((p) => p.status === 'healthy' || p.status === 'degraded')
      .map((p) => p.id);

    switch (modelConfig.mode) {
      case 'passthrough':
        return this.routePassthrough(modelConfig, healthyIds);

      case 'self-orchestrated':
        return this.routeSelfOrchestrated(modelConfig, healthyIds, input);

      case 'middleman':
        return this.routeMiddleman(modelConfig, healthyIds);

      default:
        throw new Error(`Unknown execution mode: ${(modelConfig as any).mode}`);
    }
  }

  private routePassthrough(
    config: ModelConfig,
    healthyIds: string[],
  ): RouterDecision {
    const providerId = config.provider!;

    if (!healthyIds.includes(providerId)) {
      if (healthyIds.length > 0) {
        const fallbackId = healthyIds[0]!;
        console.warn(`[TaskRouter] Requested provider ${providerId} is not healthy, failing over to healthy provider ${fallbackId}`);
        return {
          modelConfig: config,
          selectedProviders: [fallbackId],
          strategy: 'direct',
          executionMode: 'passthrough',
        };
      }
      throw new Error(
        `Provider ${providerId} is unavailable. Status: unhealthy`
      );
    }

    return {
      modelConfig: config,
      selectedProviders: [providerId],
      strategy: 'direct',
      executionMode: 'passthrough',
    };
  }

  private routeSelfOrchestrated(
    config: ModelConfig,
    healthyIds: string[],
    input: TaskInput,
  ): RouterDecision {
    const strategy = config.routing.strategy;
    let selectedProviders: string[] = [];

    // Filter requested providers against healthy ones
    const requestedProviders = input.preferredProviders?.length
      ? input.preferredProviders
      : config.routing.providers ?? healthyIds;

    const available = requestedProviders.filter((id) => healthyIds.includes(id));

    switch (strategy) {
      case 'parallel':
        selectedProviders = available.slice(0, input.maxProviders ?? available.length);
        break;

      case 'all-parallel':
        selectedProviders = healthyIds;
        break;

      case 'fastest': {
        // For now pick the first healthy one
        // Future: track response times and pick fastest
        selectedProviders = available.length > 0 ? [available[0]!] : [];
        break;
      }

      default:
        selectedProviders = available;
    }

    if (selectedProviders.length === 0) {
      throw new Error('No healthy providers available for this request');
    }

    return {
      modelConfig: config,
      selectedProviders,
      strategy,
      executionMode: 'self-orchestrated',
    };
  }

  private routeMiddleman(
    config: ModelConfig,
    healthyIds: string[],
  ): RouterDecision {
    const middlemanConfig = this.getMiddlemanConfig();
    if (!middlemanConfig) {
      throw new Error(
        'Middleman mode requires OMNI_MIDDLEMAN_TYPE to be configured in .env'
      );
    }

    const availableForMiddleman = (config.routing.available_providers ?? healthyIds)
      .filter((id) => healthyIds.includes(id));

    return {
      modelConfig: config,
      selectedProviders: availableForMiddleman,
      strategy: 'parallel',
      executionMode: 'middleman',
      middlemanConfig,
    };
  }
}
