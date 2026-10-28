#!/usr/bin/env bun
// scripts/agent-session-demo.ts
// Demonstrates a real multi-turn autonomous agent session using OmniChat Harness
export {};

const BASE_URL = process.env['OPENAI_BASE_URL'] ?? 'http://localhost:3132/v1';
const API_KEY = process.env['OPENAI_API_KEY'] ?? 'omni-local-dev-key';
const MODEL = process.env['MODEL'] ?? 'chatgpt';

// ── Mock Database & Tools ──────────────────────────────────────────────
const CUSTOMER_DB: Record<string, any> = {
  'CUST-882': {
    name: 'Alice Henderson',
    tier: 'Gold VIP',
    email: 'alice@example.com',
    open_order_id: 'ORD-9421',
  },
};

const ORDER_DB: Record<string, any> = {
  'ORD-9421': {
    order_id: 'ORD-9421',
    item: 'Quantum Mechanical Keyboard',
    total_usd: 249.00,
    shipping_destination: 'Seattle, WA',
    status: 'Processing at Warehouse-East',
  },
};

// ── Tool Definitions (OpenAI Spec) ─────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'lookup_customer',
      description: 'Fetch customer profile, account tier, and recent order reference by customer ID',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'string', description: 'Customer identifier (e.g. CUST-882)' },
        },
        required: ['customer_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_order_details',
      description: 'Fetch shipping, items, and status for a specific order ID',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order identifier (e.g. ORD-9421)' },
        },
        required: ['order_id'],
      },
    },
  },
];

// Local Tool Executor
function executeTool(name: string, args: Record<string, any>): string {
  if (name === 'lookup_customer') {
    const cust = CUSTOMER_DB[args.customer_id];
    return cust
      ? JSON.stringify(cust)
      : JSON.stringify({ error: `Customer not found: ${args.customer_id}` });
  }

  if (name === 'get_order_details') {
    const order = ORDER_DB[args.order_id];
    return order
      ? JSON.stringify(order)
      : JSON.stringify({ error: `Order not found: ${args.order_id}` });
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

// ── Agent Runner Loop ──────────────────────────────────────────────────
async function runAgentSession() {
  console.log('\n======================================================');
  console.log('🤖 Starting Multi-Turn Agentic Session on OmniChat');
  console.log(`Target Model: ${MODEL} via ${BASE_URL}`);
  console.log('======================================================\n');

  const messages: any[] = [
    {
      role: 'system',
      content: 'You are an autonomous customer support and logistics AI agent. Use your available tools to resolve user queries completely.',
    },
    {
      role: 'user',
      content: 'Please investigate customer CUST-882. Look up their account, find their current pending order, and determine if their tier qualifies them for expedited priority dispatch.',
    },
  ];

  console.log(`[User Request]: ${messages[1].content}\n`);

  let turn = 1;
  const maxTurns = 5;

  while (turn <= maxTurns) {
    console.log(`---------------- Turn ${turn} (Model Reasoning & Generation) ----------------`);
    const startMs = Date.now();

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages,
        tools: TOOLS,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ HTTP Error ${response.status}:`, errText);
      break;
    }

    const data = await response.json() as any;
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    const choice = data.choices[0];
    const message = choice.message;

    console.log(`[OmniChat Server Response (${elapsedSec}s)]: finish_reason = "${choice.finish_reason}"`);

    // Case 1: Model wants to execute one or more tools
    if (choice.finish_reason === 'tool_calls' || (message.tool_calls && message.tool_calls.length > 0)) {
      messages.push(message);

      for (const tc of message.tool_calls) {
        const fnName = tc.function.name;
        const fnArgs = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments;

        console.log(`\n🛠️  [Agent Emitted Tool Call]: ${fnName}(${JSON.stringify(fnArgs)})`);

        // Execute tool locally
        const toolOutput = executeTool(fnName, fnArgs);
        console.log(`📥 [Tool Execution Output]: ${toolOutput}\n`);

        // Add tool result to conversation history
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: fnName,
          content: toolOutput,
        });
      }

      turn++;
      continue;
    }

    // Case 2: Final answer produced
    console.log('\n🎯 [Final Agent Synthesis & Conclusion]:');
    console.log(message.content);
    console.log('\n✅ Agentic Task Complete!');
    break;
  }
}

await runAgentSession();
