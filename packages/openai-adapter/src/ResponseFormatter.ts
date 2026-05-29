// packages/openai-adapter/src/ResponseFormatter.ts
// Converts internal task results → OpenAI API response format

import type { Task } from '@omni/core';
import type {
  ChatCompletionResponse,
  ChatCompletionChoice,
  TokenUsage,
  SubtaskSummary,
} from './types/OpenAI.js';
import { generateCompletionId } from './SSEEmitter.js';

export class ResponseFormatter {
  /**
   * Build a complete non-streaming ChatCompletionResponse from a finished task.
   */
  static fromTask(
    task: Task,
    includeDetails = false,
  ): ChatCompletionResponse {
    const content = task.finalOutput ?? 'No output was produced.';
    const id = generateCompletionId();

    const choice: ChatCompletionChoice = {
      index: 0,
      message: {
        role: 'assistant',
        content,
      },
      finish_reason: 'stop',
      logprobs: null,
    };

    const usage = this.estimateUsage(task);
    const response: ChatCompletionResponse = {
      id,
      object: 'chat.completion',
      created: Math.floor((task.completedAt ?? new Date()).getTime() / 1000),
      model: task.input.modelId,
      choices: [choice],
      usage,
      system_fingerprint: 'omnichat-harness-v1',
    };

    if (includeDetails) {
      response['x-omni-providers'] = task.subtasks.map((s) => s.assignedProvider);
      response['x-omni-evaluation'] = task.evaluation;
      response['x-omni-subtasks'] = task.subtasks
        .filter((s) => s.result)
        .map((s): SubtaskSummary => ({
          provider: s.assignedProvider,
          role: s.role,
          durationMs: s.result!.durationMs,
          tokensEstimate: s.result!.tokensEstimate,
        }));
    }

    return response;
  }

  /**
   * Build an error response.
   */
  static error(
    message: string,
    type = 'internal_error',
    code: string | null = null,
  ) {
    return {
      error: {
        message,
        type,
        param: null,
        code,
      },
    };
  }

  /**
   * Estimate token usage from task.
   * Real token counts aren't available since we're using web UIs.
   */
  private static estimateUsage(task: Task): TokenUsage {
    const promptChars = task.input.messages.reduce(
      (acc, m) => acc + m.content.length,
      0,
    );
    const completionChars = (task.finalOutput ?? '').length;

    // Rough estimate: ~4 chars per token
    return {
      prompt_tokens: Math.ceil(promptChars / 4),
      completion_tokens: Math.ceil(completionChars / 4),
      total_tokens: Math.ceil((promptChars + completionChars) / 4),
    };
  }
}
