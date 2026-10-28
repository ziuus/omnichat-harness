// packages/openai-adapter/src/ToolCallParser.ts
// Extracts tool / function calls emitted by web AI models and normalizes them into OpenAI format

import { randomUUID } from 'crypto';
import type { ToolCall } from './types/OpenAI.js';

export interface ParsedToolCallResult {
  hasToolCalls: boolean;
  toolCalls: ToolCall[];
  cleanContent: string;
}

export class ToolCallParser {
  /**
   * Parse raw LLM output text to detect and extract function/tool calls.
   */
  static parse(text: string): ParsedToolCallResult {
    if (!text || typeof text !== 'string') {
      return { hasToolCalls: false, toolCalls: [], cleanContent: text ?? '' };
    }

    // Pattern 1: Markdown code blocks ```json { ... } ```
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
    for (const match of text.matchAll(codeBlockRegex)) {
      if (match[1]) {
        if (match[1].includes('"tool_calls"')) {
          const parsed = this.tryParseToolCallsJson(match[1]);
          if (parsed) {
            const clean = text.replace(match[0], '').trim();
            return { hasToolCalls: true, toolCalls: parsed, cleanContent: clean };
          }
        }
        if (match[1].includes('"name"') && match[1].includes('"arguments"')) {
          const call = this.tryParseSingleCall(match[1]);
          if (call) {
            const clean = text.replace(match[0], '').trim();
            return { hasToolCalls: true, toolCalls: [call], cleanContent: clean };
          }
        }
      }
    }

    // Pattern 2: <tool_call> ... </tool_call>
    const xmlRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
    const xmlMatches = Array.from(text.matchAll(xmlRegex));
    if (xmlMatches.length > 0) {
      const calls: ToolCall[] = [];
      let clean = text;

      for (const match of xmlMatches) {
        if (!match[1]) continue;
        const call = this.tryParseSingleCall(match[1]);
        if (call) {
          calls.push(call);
          clean = clean.replace(match[0], '');
        }
      }

      if (calls.length > 0) {
        return { hasToolCalls: true, toolCalls: calls, cleanContent: clean.trim() };
      }
    }

    // Pattern 3: Balanced JSON object with "tool_calls" (handles nested arrays, quotes, code strings)
    const toolCallsIdx = text.indexOf('"tool_calls"');
    if (toolCallsIdx !== -1) {
      const lastBraceBefore = text.lastIndexOf('{', toolCallsIdx);
      if (lastBraceBefore !== -1) {
        const balanced = this.extractBalancedJsonObject(text, lastBraceBefore);
        if (balanced) {
          const parsed = this.tryParseToolCallsJson(balanced.json);
          if (parsed) {
            const clean = (text.slice(0, balanced.start) + text.slice(balanced.end)).trim();
            return { hasToolCalls: true, toolCalls: parsed, cleanContent: clean };
          }
        }
      }
    }

    // Pattern 4: Single function call with name and arguments
    if (text.includes('"name"') && text.includes('"arguments"')) {
      const nameIdx = text.indexOf('"name"');
      const lastBraceBefore = text.lastIndexOf('{', nameIdx);
      if (lastBraceBefore !== -1) {
        const balanced = this.extractBalancedJsonObject(text, lastBraceBefore);
        if (balanced) {
          const call = this.tryParseSingleCall(balanced.json);
          if (call) {
            const clean = (text.slice(0, balanced.start) + text.slice(balanced.end)).trim();
            return { hasToolCalls: true, toolCalls: [call], cleanContent: clean };
          }
        }
      }
    }

    return { hasToolCalls: false, toolCalls: [], cleanContent: text };
  }

  private static extractBalancedJsonObject(
    text: string,
    startIndex = 0,
  ): { json: string; start: number; end: number } | null {
    const firstBrace = text.indexOf('{', startIndex);
    if (firstBrace === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = firstBrace; i < text.length; i++) {
      const char = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            return {
              json: text.slice(firstBrace, i + 1),
              start: firstBrace,
              end: i + 1,
            };
          }
        }
      }
    }

    return null;
  }

  private static tryParseToolCallsJson(rawJson: string): ToolCall[] | null {
    try {
      const obj = JSON.parse(rawJson);
      if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
        return obj.tool_calls.map((c: any) => this.normalizeCall(c)).filter(Boolean) as ToolCall[];
      }
    } catch {
      // JSON syntax error
    }
    return null;
  }

  private static tryParseSingleCall(rawJson: string): ToolCall | null {
    try {
      const obj = JSON.parse(rawJson);
      if (obj.name) {
        return this.normalizeCall(obj);
      }
      if (obj.function && obj.function.name) {
        return this.normalizeCall(obj);
      }
    } catch {
      // JSON syntax error
    }
    return null;
  }

  private static normalizeCall(item: any): ToolCall | null {
    if (!item) return null;

    const name = item.name ?? item.function?.name;
    if (!name || typeof name !== 'string') return null;

    let args = item.arguments ?? item.function?.arguments ?? {};
    if (typeof args !== 'string') {
      try {
        args = JSON.stringify(args);
      } catch {
        args = '{}';
      }
    }

    return {
      id: item.id || `call_${randomUUID().replace(/-/g, '').slice(0, 9)}`,
      type: 'function',
      function: {
        name,
        arguments: args,
      },
    };
  }
}
