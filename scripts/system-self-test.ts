#!/usr/bin/env bun
// scripts/system-self-test.ts
// Comprehensive automated self-test of the full OmniChat Harness
export {};

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3132;
const BASE_URL = `http://localhost:${PORT}/v1`;
const SERVER_URL = `http://localhost:${PORT}`;
const API_KEY = 'omni-local-dev-key';

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  output?: string;
  error?: string;
}

const results: TestResult[] = [];

async function runStep(name: string, fn: () => Promise<string | void>) {
  console.log(`\n▶ [TEST] ${name}...`);
  const start = Date.now();
  try {
    const out = await fn();
    const durationMs = Date.now() - start;
    results.push({ name, passed: true, durationMs, output: out || 'OK' });
    console.log(`  ✓ PASSED (${(durationMs / 1000).toFixed(1)}s)`);
    if (out) console.log(`    Output: ${out.replace(/\n+/g, ' ').slice(0, 160)}...`);
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, durationMs, error });
    console.error(`  ✗ FAILED (${(durationMs / 1000).toFixed(1)}s):`, error);
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║       OmniChat Harness Automated Self-Test        ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  // Step 1: Health & Models API
  await runStep('GET /health & /v1/models', async () => {
    const healthRes = await fetch(`${SERVER_URL}/health`);
    if (!healthRes.ok) throw new Error(`Health check returned ${healthRes.status}`);
    const health = await healthRes.json() as any;
    if (!health.status) throw new Error('Invalid health payload');

    const modelsRes = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!modelsRes.ok) throw new Error(`Models API returned ${modelsRes.status}`);
    const models = await modelsRes.json() as any;
    if (!Array.isArray(models.data) || models.data.length === 0) {
      throw new Error('Models list is empty');
    }

    return `Health: ${health.status}, Models registered: ${models.data.length}`;
  });

  // Step 2: Non-Streaming Completion
  await runStep('Non-Streaming Completion (Math Query)', async () => {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'chatgpt',
        stream: false,
        messages: [{ role: 'user', content: 'What is 15 * 6? Answer with just the number.' }],
      }),
    });

    if (!res.ok) throw new Error(`Completion failed with HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content.includes('90')) {
      throw new Error(`Expected output to contain '90', got: '${content}'`);
    }
    return content.trim();
  });

  // Step 3: SSE Streaming Completion
  await runStep('SSE Streaming Completion', async () => {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'chatgpt',
        stream: true,
        messages: [{ role: 'user', content: 'Say hello in 3 words.' }],
      }),
    });

    if (!res.ok) throw new Error(`Streaming failed with HTTP ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No readable stream body');

    const decoder = new TextDecoder();
    let accumulatedText = '';
    let sawRole = false;
    let sawDone = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      if (chunk.includes('"role":"assistant"')) sawRole = true;
      if (chunk.includes('[DONE]')) sawDone = true;

      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) accumulatedText += delta;
          } catch {}
        }
      }
    }

    if (!sawRole) throw new Error('Did not receive initial role delta chunk');
    if (!sawDone) throw new Error('Did not receive final [DONE] stream terminator');
    if (!accumulatedText.trim()) throw new Error('Streamed text was empty');

    return accumulatedText.trim();
  });

  // Step 4: Tool / Function Calling
  await runStep('Agent Tool Calling Emulation', async () => {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'chatgpt',
        stream: false,
        messages: [{
          role: 'user',
          content: 'Look up the account for user_id 7712 using the query_database tool.',
        }],
        tools: [{
          type: 'function',
          function: {
            name: 'query_database',
            description: 'Fetch account records by user ID',
            parameters: {
              type: 'object',
              properties: { user_id: { type: 'number' } },
              required: ['user_id'],
            },
          },
        }],
      }),
    });

    if (!res.ok) throw new Error(`Tool call request failed: ${await res.text()}`);
    const data = await res.json() as any;
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== 'tool_calls') {
      throw new Error(`Expected finish_reason 'tool_calls', got: '${choice?.finish_reason}'`);
    }

    const toolCall = choice?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error('No tool_calls found in response');
    if (toolCall.function?.name !== 'query_database') {
      throw new Error(`Expected tool 'query_database', got: '${toolCall.function?.name}'`);
    }

    const args = JSON.parse(toolCall.function?.arguments ?? '{}');
    if (Number(args.user_id) !== 7712) {
      throw new Error(`Expected user_id 7712 in args, got: ${JSON.stringify(args)}`);
    }

    return `Emitted: ${toolCall.function.name}(${toolCall.function.arguments})`;
  });

  // Step 5: Multi-Turn Conversation Context
  await runStep('Multi-Turn Context Retention', async () => {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'chatgpt',
        stream: false,
        messages: [
          { role: 'user', content: 'Remember this codeword: PHOENIX-99' },
          { role: 'assistant', content: 'Understood, I will remember the codeword PHOENIX-99.' },
          { role: 'user', content: 'What was the exact codeword I gave you?' },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Multi-turn failed: ${await res.text()}`);
    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content.includes('PHOENIX-99')) {
      throw new Error(`Expected answer to contain 'PHOENIX-99', got: '${content}'`);
    }

    return content.trim();
  });

  // Summary
  console.log('\n===================================================');
  console.log('                 TEST SUMMARY                      ');
  console.log('===================================================');
  const allPassed = results.every((r) => r.passed);
  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${status} [${(r.durationMs / 1000).toFixed(1)}s] ${r.name}`);
  }
  console.log('===================================================');
  console.log(`Final Result: ${allPassed ? 'ALL TESTS PASSED ✅' : 'SOME TESTS FAILED ❌'}\n`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
