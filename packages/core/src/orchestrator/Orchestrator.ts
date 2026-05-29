// packages/core/src/orchestrator/Orchestrator.ts
// Main execution engine — handles all three modes

import type { Task, TaskInput, SubTask } from '../types/Task.js';
import type { Provider, ProviderResponse } from '../types/Provider.js';
import type { RouterDecision } from '../types/Routing.js';
import { MiddlemanClient } from './MiddlemanClient.js';
import { randomUUID } from 'crypto';

interface StreamEmitter {
  sendRoleChunk(): Promise<void>;
  sendDelta(text: string): Promise<void>;
  streamText(text: string): Promise<void>;
}

export class Orchestrator {
  /**
   * Execute a task and stream results back via the SSEEmitter.
   * This is the single entry point for all three modes.
   */
  async execute(
    input: TaskInput,
    decision: RouterDecision,
    providers: Map<string, Provider>,
    emitter: StreamEmitter,
  ): Promise<string> {
    await emitter.sendRoleChunk();

    switch (decision.executionMode) {
      case 'passthrough':
        return this.executePassthrough(input, decision, providers, emitter);

      case 'self-orchestrated':
        return this.executeSelfOrchestrated(input, decision, providers, emitter);

      case 'middleman':
        return this.executeMiddleman(input, decision, providers, emitter);

      default:
        throw new Error(`Unknown execution mode: ${(decision as any).executionMode}`);
    }
  }

  // ─── Mode 2: Direct Passthrough ─────────────────────────────────────────────

  private async executePassthrough(
    input: TaskInput,
    decision: RouterDecision,
    providers: Map<string, Provider>,
    emitter: StreamEmitter,
  ): Promise<string> {
    const providerId = decision.selectedProviders[0];
    if (!providerId) throw new Error('No provider selected for passthrough');

    const provider = providers.get(providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    const askOptions = input.images && input.images.length > 0
      ? {
          images: input.images.map((img) => ({
            data: img.data,
            mimeType: img.mimeType as any,
          })),
        }
      : undefined;

    const result = await provider.ask(input.prompt, askOptions);

    // Stream the response word by word
    await emitter.streamText(result.content);
    return result.content;
  }

  // ─── Mode 1: Self-Orchestrated ───────────────────────────────────────────────

  private async executeSelfOrchestrated(
    input: TaskInput,
    decision: RouterDecision,
    providers: Map<string, Provider>,
    emitter: StreamEmitter,
  ): Promise<string> {
    const { selectedProviders, modelConfig } = decision;

    // Phase 1: Announce
    await emitter.sendDelta(
      `*Routing to ${selectedProviders.join(', ')}...*\n\n`
    );

    // Phase 2: Assign roles
    const roleMap = modelConfig.routing.roles ?? {};
    const assignments = selectedProviders.map((pid) => ({
      providerId: pid,
      role: roleMap[pid] ?? 'assistant',
    }));

    // Phase 3: Execute in parallel
    const results = await this.runParallel(assignments, input, providers, emitter);

    if (results.length === 0) {
      throw new Error('All providers failed to respond');
    }

    // Phase 4: Synthesize
    await emitter.sendDelta('\n\n*Synthesizing responses...*\n\n');

    const synthesis = this.synthesize(results, modelConfig.routing.synthesis ?? 'internal');

    await emitter.streamText(synthesis);
    return synthesis;
  }

  // ─── Mode 3: Middleman Agent ─────────────────────────────────────────────────

  private async executeMiddleman(
    input: TaskInput,
    decision: RouterDecision,
    providers: Map<string, Provider>,
    emitter: StreamEmitter,
  ): Promise<string> {
    if (!decision.middlemanConfig) {
      throw new Error('Middleman config missing');
    }

    // Build a map of only the available providers for this decision
    const availableProviders = new Map<string, Provider>();
    for (const pid of decision.selectedProviders) {
      const p = providers.get(pid);
      if (p) availableProviders.set(pid, p);
    }

    const client = new MiddlemanClient(decision.middlemanConfig);
    return client.run(input, availableProviders, emitter);
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────────

  private async runParallel(
    assignments: Array<{ providerId: string; role: string }>,
    input: TaskInput,
    providers: Map<string, Provider>,
    emitter: StreamEmitter,
  ): Promise<Array<{ providerId: string; role: string; content: string; durationMs: number }>> {
    const settled = await Promise.allSettled(
      assignments.map(async ({ providerId, role }) => {
        const provider = providers.get(providerId);
        if (!provider) return null;

        const rolePrompt = this.buildRolePrompt(input.prompt, role);

        const providerAskOptions = {
          timeoutMs: 120000,
          ...(input.images && input.images.length > 0
            ? {
                images: input.images.map((img) => ({
                  data: img.data,
                  mimeType: img.mimeType as any,
                })),
              }
            : {}),
        };

        const result = await provider.ask(rolePrompt, providerAskOptions);

        await emitter.sendDelta(
          `✓ **${providerId}** (${role}) responded in ${(result.durationMs / 1000).toFixed(1)}s\n`
        );

        return {
          providerId,
          role,
          content: result.content,
          durationMs: result.durationMs,
        };
      })
    );

    return settled
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value);
  }

  private buildRolePrompt(basePrompt: string, role: string): string {
    const roleInstructions: Record<string, string> = {
      researcher: `Research the following topic thoroughly. Provide comprehensive information, key facts, and important context:\n\n${basePrompt}`,
      analyst: `Analyze the following critically. Identify strengths, weaknesses, implications, and potential issues:\n\n${basePrompt}`,
      reviewer: `Review the following carefully. Check for errors, suggest improvements, and provide constructive feedback:\n\n${basePrompt}`,
      explainer: `Explain the following clearly for a general audience. Use simple language and concrete examples:\n\n${basePrompt}`,
      citations: `Research the following and provide well-cited information. Include sources, references, and recent data:\n\n${basePrompt}`,
      generator: `${basePrompt}`,
      'ocr-and-description': `Describe this image in detail. Extract any text, identify objects, and explain what you see:\n\n${basePrompt}`,
      'deep-analysis': `Perform deep analysis of this image. Identify patterns, relationships, technical details:\n\n${basePrompt}`,
      critique: `Critically evaluate this image. Note quality, composition, effectiveness, and areas for improvement:\n\n${basePrompt}`,
      assistant: basePrompt,
    };

    return roleInstructions[role] ?? basePrompt;
  }

  private synthesize(
    results: Array<{ providerId: string; role: string; content: string; durationMs: number }>,
    strategy: string,
  ): string {
    if (results.length === 1) {
      return results[0]!.content;
    }

    switch (strategy) {
      case 'consensus':
        return this.consensusSynthesize(results);

      case 'internal':
      default:
        return this.structuredSynthesize(results);
    }
  }

  private structuredSynthesize(
    results: Array<{ providerId: string; role: string; content: string }>,
  ): string {
    const sections = results.map((r) =>
      `### ${r.role.charAt(0).toUpperCase() + r.role.slice(1)} (${r.providerId})\n\n${r.content}`
    );

    return sections.join('\n\n---\n\n');
  }

  private consensusSynthesize(
    results: Array<{ providerId: string; role: string; content: string }>,
  ): string {
    // Simple consensus: combine all responses with attribution
    const intro = `*Consensus from ${results.map((r) => r.providerId).join(', ')}:*\n\n`;

    // Find common themes by looking at first sentences
    const combined = results.map((r) => `**${r.providerId}:** ${r.content}`).join('\n\n');

    return intro + combined;
  }
}
