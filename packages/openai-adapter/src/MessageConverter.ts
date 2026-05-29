// packages/openai-adapter/src/MessageConverter.ts
// Converts OpenAI API request format → internal TaskInput

import type { ChatCompletionRequest, OpenAIMessage, ContentPart } from './types/OpenAI.js';
import type { TaskInput, ConversationMessage, ImageRef } from '@omni/core';
import type { ModelConfig } from '@omni/core';

export class MessageConverter {
  /**
   * Convert an OpenAI chat completion request into our internal TaskInput.
   * Handles text messages, image_url content parts, and system prompts.
   */
  static toTaskInput(
    request: ChatCompletionRequest,
    modelConfig: ModelConfig,
  ): TaskInput {
    const { systemPrompt, conversationMessages } = this.separateMessages(request.messages);
    const images = this.extractImages(request.messages);
    const lastUserPrompt = this.extractLastUserPrompt(request.messages);

    const taskInput: TaskInput = {
      prompt: lastUserPrompt,
      messages: conversationMessages,
      executionMode: modelConfig.mode,
      modelId: request.model,
      ...(images.length > 0 ? { images } : {}),
      ...(systemPrompt ? { systemContext: systemPrompt } : {}),
      ...(images.length > 0 ? { requiredCapabilities: ['image-input'] as const } : {}),
    };

    return taskInput;
  }

  /**
   * Extract the last user message as the primary prompt.
   */
  private static extractLastUserPrompt(messages: OpenAIMessage[]): string {
    const userMessages = messages.filter((m) => m.role === 'user');
    const last = userMessages[userMessages.length - 1];

    if (!last) return '';

    if (typeof last.content === 'string') {
      return last.content;
    }

    // Handle multi-part content (text + images)
    return last.content
      .filter((p): p is ContentPart & { type: 'text' } => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('\n');
  }

  /**
   * Separate system message from conversation history.
   */
  private static separateMessages(messages: OpenAIMessage[]): {
    systemPrompt: string | undefined;
    conversationMessages: ConversationMessage[];
  } {
    let systemPrompt: string | undefined;
    const conversationMessages: ConversationMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = typeof msg.content === 'string' ? msg.content : '';
        continue;
      }

      if (msg.role === 'tool') continue; // skip tool messages for now

      const textContent =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .filter((p): p is ContentPart & { type: 'text' } => p.type === 'text')
              .map((p) => p.text ?? '')
              .join('\n');

      conversationMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: textContent,
      });
    }

    return { systemPrompt, conversationMessages };
  }

  /**
   * Extract image attachments from content parts.
   * Handles both data URIs and https:// URLs.
   */
  private static extractImages(messages: OpenAIMessage[]): ImageRef[] {
    const images: ImageRef[] = [];

    for (const msg of messages) {
      if (typeof msg.content === 'string') continue;

      for (const part of msg.content) {
        if (part.type !== 'image_url' || !part.image_url) continue;

        const url = part.image_url.url;

        if (url.startsWith('data:')) {
          // data URI: data:image/png;base64,<data>
          const match = url.match(/^data:(image\/[a-z]+);base64,(.+)$/);
          if (match) {
            const mimeType = match[1] as ImageRef['mimeType'];
            const data = Buffer.from(match[2] ?? '', 'base64');
            images.push({ data, mimeType });
          }
        }
        // Note: https:// URLs would need to be fetched — handled in provider layer
      }
    }

    return images;
  }

  /**
   * Build a simple string prompt from the full conversation history.
   * Used for providers that don't support multi-turn natively.
   */
  static toFlatPrompt(messages: ConversationMessage[], systemContext?: string): string {
    const parts: string[] = [];

    if (systemContext) {
      parts.push(`System: ${systemContext}\n`);
    }

    for (const msg of messages) {
      const prefix = msg.role === 'user' ? 'Human' : 'Assistant';
      parts.push(`${prefix}: ${msg.content}`);
    }

    return parts.join('\n\n');
  }
}
