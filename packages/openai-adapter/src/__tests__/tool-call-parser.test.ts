import { describe, expect, it } from 'bun:test';
import { ToolCallParser } from '../ToolCallParser.js';

describe('ToolCallParser', () => {
  it('parses markdown json block with tool_calls array', () => {
    const raw = `I will look up the weather for you.
\`\`\`json
{
  "tool_calls": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "arguments": { "location": "Tokyo", "unit": "celsius" }
      }
    }
  ]
}
\`\`\`
Let me know if you need anything else!`;

    const result = ToolCallParser.parse(raw);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe('get_weather');
    expect(JSON.parse(result.toolCalls[0]!.function.arguments)).toEqual({
      location: 'Tokyo',
      unit: 'celsius',
    });
    expect(result.cleanContent).toContain('I will look up the weather for you.');
    expect(result.cleanContent).toContain('Let me know if you need anything else!');
    expect(result.cleanContent).not.toContain('```json');
  });

  it('parses bare JSON object with tool_calls', () => {
    const raw = `{"tool_calls": [{"id": "call_abc123", "type": "function", "function": {"name": "search", "arguments": "{\\"q\\":\\"bun\\"}"}}]}`;

    const result = ToolCallParser.parse(raw);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.id).toBe('call_abc123');
    expect(result.toolCalls[0]!.function.name).toBe('search');
    expect(result.toolCalls[0]!.function.arguments).toBe('{"q":"bun"}');
    expect(result.cleanContent).toBe('');
  });

  it('parses bare JSON tool calls containing code with brackets and arrays', () => {
    const raw = `Here is the module:
{
  "tool_calls": [
    {
      "type": "function",
      "function": {
        "name": "save_module_source",
        "arguments": {
          "path": "math-utils.ts",
          "content": "if (n === -1) return [-1];\\nreturn [1, 2, 3];"
        }
      }
    }
  ]
}
Done.`;

    const result = ToolCallParser.parse(raw);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe('save_module_source');
    expect(JSON.parse(result.toolCalls[0]!.function.arguments)).toEqual({
      path: 'math-utils.ts',
      content: 'if (n === -1) return [-1];\nreturn [1, 2, 3];',
    });
    expect(result.cleanContent).toContain('Here is the module:');
    expect(result.cleanContent).toContain('Done.');
  });

  it('parses XML-style <tool_call> tags', () => {
    const raw = `I am executing your request:
<tool_call>
{
  "name": "calculate",
  "arguments": { "operation": "add", "a": 5, "b": 10 }
}
</tool_call>`;

    const result = ToolCallParser.parse(raw);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe('calculate');
    expect(JSON.parse(result.toolCalls[0]!.function.arguments)).toEqual({
      operation: 'add',
      a: 5,
      b: 10,
    });
    expect(result.cleanContent).toBe('I am executing your request:');
  });

  it('parses single function call JSON block', () => {
    const raw = `\`\`\`json
{
  "name": "execute_code",
  "arguments": { "code": "console.log('test')" }
}
\`\`\``;

    const result = ToolCallParser.parse(raw);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe('execute_code');
    expect(JSON.parse(result.toolCalls[0]!.function.arguments)).toEqual({
      code: "console.log('test')",
    });
    expect(result.cleanContent).toBe('');
  });

  it('passes normal chat text through with hasToolCalls: false', () => {
    const raw = 'Hello! I am ready to help you with your coding questions.';
    const result = ToolCallParser.parse(raw);
    expect(result.hasToolCalls).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanContent).toBe(raw);
  });

  it('handles empty string gracefully', () => {
    const result = ToolCallParser.parse('');
    expect(result.hasToolCalls).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanContent).toBe('');
  });
});
