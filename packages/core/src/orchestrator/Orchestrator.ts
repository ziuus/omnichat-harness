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

    const fullPrompt = this.formatPromptWithContext(input);
    const result = await provider.ask(fullPrompt, askOptions);

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
    const fullPrompt = this.formatPromptWithContext(input);

    const settled = await Promise.allSettled(
      assignments.map(async ({ providerId, role }) => {
        const provider = providers.get(providerId);
        if (!provider) return null;

        const rolePrompt = this.buildRolePrompt(fullPrompt, role);

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

  private formatPromptWithContext(input: TaskInput): string {
    const hasHistory = Boolean(input.messages && input.messages.length > 1);
    const hasSystem = Boolean(input.systemContext);
    const hasTools = Boolean(input.tools && input.tools.length > 0);

    if (!hasHistory && !hasSystem && !hasTools) {
      return input.prompt;
    }

    const sections: string[] = [];

    if (input.systemContext) {
      const maxSystemChars = 4000;
      const sysCtx = input.systemContext.length > maxSystemChars
        ? input.systemContext.slice(0, maxSystemChars) + '\n...[system instructions compacted for web context]'
        : input.systemContext;
      sections.push(`[System Instructions]\n${sysCtx}`);
    }

    if (hasTools && input.tools) {
      const toolDocs = this.formatTools(input.tools);
      sections.push(
        `[AVAILABLE TOOLS]\nYou have access to the following tools via an external execution harness:\n\`\`\`json\n${toolDocs}\n\`\`\`\n\n` +
        `[TOOL CALL INSTRUCTIONS]\n` +
        `You are integrated into an automated system. You do not execute tools directly; the external harness executes them on your behalf.\n` +
        `Whenever a tool is relevant or requested to fulfill the user's query, you MUST generate a tool call in this exact JSON format:\n` +
        `\`\`\`json\n` +
        `{\n` +
        `  "tool_calls": [\n` +
        `    {\n` +
        `      "type": "function",\n` +
        `      "function": {\n` +
        `        "name": "<tool_name>",\n` +
        `        "arguments": { <arguments_object> }\n` +
        `      }\n` +
        `    }\n` +
        `  ]\n` +
        `}\n` +
        `\`\`\`\n` +
        `CRITICAL: Do NOT decline, apologize, or state that you lack tools or real-time access. Output the tool call JSON directly so the harness can execute it for you. Only provide a standard text answer if no tool is applicable.`
      );
    }

    if (hasHistory && input.messages) {
      const history = input.messages
        .map((m) => {
          if (m.role === 'tool') {
            const content = m.content && m.content.length > 3000
              ? m.content.slice(0, 3000) + '\n...[tool output truncated]'
              : m.content;
            return `[TOOL RESULT: ${m.name || m.toolCallId || 'function'}]\n${content}`;
          }
          if (m.role === 'assistant' && ((m as any).toolCalls || (m as any).tool_calls)) {
            const tc = (m as any).toolCalls || (m as any).tool_calls;
            const toolCallsJson = JSON.stringify(tc, null, 2);
            return `[ASSISTANT TOOL CALLS]\n\`\`\`json\n${toolCallsJson}\n\`\`\`${m.content ? `\n${m.content}` : ''}`;
          }
          const role = m.role.toUpperCase();
          const content = m.content && m.content.length > 3000
            ? m.content.slice(0, 3000) + '\n...[message content truncated]'
            : m.content;
          return `[${role}]\n${content}`;
        })
        .join('\n\n');

      if (history.trim()) {
        sections.push(`[Conversation History]\n${history}`);
      }
    }

    const lastMsg = input.messages && input.messages.length > 0 ? input.messages[input.messages.length - 1] : null;
    if (lastMsg && lastMsg.role === 'tool') {
      sections.push(
        `[Next Step Objective]\n` +
        `The tool results above have been executed and provided to you.\n` +
        `Review the user's initial objective: "${input.prompt}".\n` +
        `- If any required action tools (such as issuing refunds, recording entries, executing changes, or fetching further data) still need to be called to complete the request, you MUST call those tools now in the specified tool call JSON format.\n` +
        `- Only synthesize and provide your final comprehensive report once ALL required tool actions have been fully executed.`
      );
    } else {
      sections.push(`[User Query]\n${input.prompt}`);
      if (hasTools) {
        sections.push(
          `[REQUIRED ACTION]\n` +
          `To fulfill this query, call the appropriate tool by emitting the JSON tool_calls block specified above. Do not merely state what you plan to do; emit the tool call directly.`
        );
      }
    }

    return sections.join('\n\n---\n\n');
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

  private formatTools(tools: any[], maxTools = 25): string {
    let selected = tools;
    if (tools.length > maxTools) {
      const priorityKeywords = ['bash', 'execute', 'run', 'read', 'write', 'edit', 'list', 'glob', 'grep', 'search', 'file', 'command'];
      const prioritized: any[] = [];
      const others: any[] = [];
      for (const t of tools) {
        const name = String(t.function?.name || t.name || '').toLowerCase();
        if (priorityKeywords.some((kw) => name.includes(kw))) {
          prioritized.push(t);
        } else {
          others.push(t);
        }
      }
      selected = [...prioritized, ...others].slice(0, maxTools);
    }

    const compactParams = (params: any): any => {
      if (!params || typeof params !== 'object') return {};
      const properties: Record<string, any> = {};
      if (params.properties && typeof params.properties === 'object') {
        for (const [key, val] of Object.entries<any>(params.properties)) {
          properties[key] = {
            type: val?.type || 'string',
            ...(val?.description ? { description: String(val.description).slice(0, 100) } : {}),
            ...(Array.isArray(val?.enum) ? { enum: val.enum.slice(0, 8) } : {}),
          };
        }
      }
      return {
        type: params.type || 'object',
        properties,
        ...(Array.isArray(params.required) ? { required: params.required } : {}),
      };
    };

    const compacted = selected.map((t) => {
      const fn = t.function || t;
      return {
        name: fn.name,
        description: fn.description ? String(fn.description).slice(0, 140) : '',
        parameters: compactParams(fn.parameters),
      };
    });

    return JSON.stringify(compacted, null, 2);
  }
}
