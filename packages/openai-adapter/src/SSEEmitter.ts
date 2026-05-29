// packages/openai-adapter/src/SSEEmitter.ts
// Formats and sends Server-Sent Events in exact OpenAI streaming format

import type { ChatCompletionChunk, ChunkChoice } from './types/OpenAI.js';

interface SSEWriter {
  write(chunk: Uint8Array): Promise<void> | void;
  close(): Promise<void> | void;
}

export class SSEEmitter {
  private completionId: string;
  private model: string;
  private writer: SSEWriter | null = null;
  private encoder = new TextEncoder();
  private closed = false;

  constructor(completionId: string, model: string) {
    this.completionId = completionId;
    this.model = model;
  }

  /**
   * Attach to any writable sink.
   * Call this before sending any chunks.
   */
  attach(writer: SSEWriter): void {
    this.writer = writer;
  }

  /**
   * Send a text delta chunk — the main content stream.
   */
  async sendDelta(content: string): Promise<void> {
    if (this.closed || !this.writer) return;

    const chunk: ChatCompletionChunk = {
      id: this.completionId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: null,
          logprobs: null,
        },
      ],
    };

    await this.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  /**
   * Send the role header chunk — required as the first chunk per OpenAI spec.
   */
  async sendRoleChunk(): Promise<void> {
    if (this.closed || !this.writer) return;

    const chunk: ChatCompletionChunk = {
      id: this.completionId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant' },
          finish_reason: null,
          logprobs: null,
        },
      ],
    };

    await this.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  /**
   * Send the [DONE] terminator.
   */
  async sendDone(finishReason: ChunkChoice['finish_reason'] = 'stop'): Promise<void> {
    if (this.closed || !this.writer) return;

    const finalChunk: ChatCompletionChunk = {
      id: this.completionId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason,
          logprobs: null,
        },
      ],
    };

    await this.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    await this.write('data: [DONE]\n\n');

    this.closed = true;
    await this.writer.close();
  }

  /**
   * Send an error and close.
   * Sends a final message before closing so clients see what went wrong.
   */
  async sendError(message: string): Promise<void> {
    if (this.closed || !this.writer) return;

    await this.sendDelta(`\n\n⚠️ Error: ${message}`);
    await this.sendDone('stop');
  }

  /**
   * Stream text word-by-word with a small delay to simulate token streaming.
   * Used for synthesized content so it feels natural to the user.
   */
  async streamText(text: string, delayMs = 15): Promise<void> {
    const tokens = text.match(/\S+\s*/g) ?? [];

    for (const token of tokens) {
      await this.sendDelta(token);
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  private async write(data: string): Promise<void> {
    if (!this.writer || this.closed) return;
    try {
      await this.writer.write(this.encoder.encode(data));
    } catch {
      this.closed = true;
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

export function createSSEHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  };
}

export function generateCompletionId(): string {
  return `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
