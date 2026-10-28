#!/usr/bin/env bun
// scripts/long-agentic-task.ts
// Multi-turn autonomous agent simulation: Incident Response & SLA Financial Audit
export {};

const PORT = 3132;
const BASE_URL = `http://localhost:${PORT}/v1`;
const API_KEY = 'omni-local-dev-key';
const MODEL = 'chatgpt';

// ── Mock Incident & Financial Data ──────────────────────────────────────
const INCIDENT_DB: Record<string, any> = {
  'INC-502': {
    incident_id: 'INC-502',
    service: 'billing-api-v2',
    severity: 'P1-CRITICAL',
    downtime_minutes: 75,
    root_cause: 'Deadlock in database connection pool during peak migration',
    impacted_accounts: ['ACME-CORP', 'GLOBEX-TECH'],
  },
};

const CONTRACT_DB: Record<string, any> = {
  'ACME-CORP': {
    account_id: 'ACME-CORP',
    tier: 'Tier-1 Enterprise',
    monthly_contract_usd: 12000,
    sla_max_downtime_mins: 30,
    penalty_rate: 0.10, // 10% refund on breach
  },
  'GLOBEX-TECH': {
    account_id: 'GLOBEX-TECH',
    tier: 'Tier-2 Business',
    monthly_contract_usd: 5000,
    sla_max_downtime_mins: 60,
    penalty_rate: 0.05, // 5% refund on breach
  },
};

const REFUND_LEDGER: any[] = [];

// ── Tool Definitions ───────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_incident_log',
      description: 'Fetch incident telemetry, downtime duration, and list of impacted customer accounts',
      parameters: {
        type: 'object',
        properties: {
          incident_id: { type: 'string', description: 'Incident ID (e.g. INC-502)' },
        },
        required: ['incident_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_account_contract',
      description: 'Fetch enterprise contract terms, monthly spend, and SLA threshold for a customer account',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Account ID (e.g. ACME-CORP)' },
        },
        required: ['account_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_credit_refund',
      description: 'Issue an SLA breach credit refund to a customer billing account',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Account ID to credit' },
          refund_amount_usd: { type: 'number', description: 'Dollar amount to refund' },
          reason: { type: 'string', description: 'Justification for credit' },
        },
        required: ['account_id', 'refund_amount_usd', 'reason'],
      },
    },
  },
];

// ── Local Tool Dispatcher ──────────────────────────────────────────────
function executeTool(name: string, args: Record<string, any>): string {
  if (name === 'get_incident_log') {
    const incId = String(args.incident_id || args.incidentId || args.id || '').toUpperCase();
    const inc = incId.includes('502') ? INCIDENT_DB['INC-502'] : INCIDENT_DB[incId];
    return inc
      ? JSON.stringify(inc)
      : JSON.stringify({ error: `Incident ${args.incident_id} not found` });
  }

  if (name === 'get_account_contract') {
    const rawId = String(args.account_id || args.accountId || args.account || '').toUpperCase();
    let contract = CONTRACT_DB[rawId];
    if (!contract) {
      if (rawId.includes('ACME')) contract = CONTRACT_DB['ACME-CORP'];
      else if (rawId.includes('GLOBEX')) contract = CONTRACT_DB['GLOBEX-TECH'];
    }
    return contract
      ? JSON.stringify(contract)
      : JSON.stringify({ error: `Account ${args.account_id} not found` });
  }

  if (name === 'record_credit_refund') {
    const rawId = String(args.account_id || args.accountId || '').toUpperCase();
    const targetId = rawId.includes('ACME') ? 'ACME-CORP' : rawId.includes('GLOBEX') ? 'GLOBEX-TECH' : rawId;
    const amount = Number(args.refund_amount_usd ?? args.amount_usd ?? args.amount ?? 0);
    const record = {
      tx_id: `TX-${Math.floor(100000 + Math.random() * 900000)}`,
      account_id: targetId,
      amount_usd: amount,
      reason: args.reason || 'SLA breach credit refund',
      timestamp: new Date().toISOString(),
      status: 'PROCESSED_SUCCESSFULLY',
    };
    REFUND_LEDGER.push(record);
    return JSON.stringify(record);
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

// ── Main Multi-Turn Agent Loop ─────────────────────────────────────────
async function runLongAgenticTask() {
  console.log('\n================================================================');
  console.log('🚀 Launching Long Multi-Phase Agentic Incident Audit & Resolution');
  console.log(`Server Endpoint: ${BASE_URL} | Model: ${MODEL}`);
  console.log('================================================================\n');

  const messages: any[] = [
    {
      role: 'system',
      content:
        'You are an autonomous Site Reliability & Billing Audit AI Agent. ' +
        'Your goal is to investigate incidents, audit affected customer SLA contracts, issue required billing refunds, ' +
        'and produce a detailed final incident post-mortem report. ' +
        'Always execute tools to fetch accurate real-time data before reaching conclusions.',
    },
    {
      role: 'user',
      content:
        'Incident INC-502 just occurred. Please investigate the incident log to find all impacted accounts. ' +
        'For each impacted account, look up their contract SLA to verify if a breach occurred. ' +
        'If an SLA was breached, issue the appropriate credit refund. ' +
        'Finally, provide a comprehensive post-mortem report detailing the financial impact and SLA compliance summary.',
    },
  ];

  console.log(`[Initial User Objective]:\n"${messages[1].content}"\n`);

  let turn = 1;
  const maxTurns = 8;
  const turnTimings: number[] = [];

  while (turn <= maxTurns) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━ Turn ${turn} (Model Reasoning) ━━━━━━━━━━━━━━━━━━━━━━`);
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
      const err = await response.text();
      console.error(`❌ HTTP Error ${response.status}:`, err);
      break;
    }

    const data = await response.json() as any;
    const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
    turnTimings.push(Number(durationSec));

    const choice = data.choices[0];
    const message = choice.message;

    console.log(`[OmniChat Server Response (${durationSec}s)]: finish_reason = "${choice.finish_reason}"`);

    // Handle Tool Calls
    if (choice.finish_reason === 'tool_calls' || (message.tool_calls && message.tool_calls.length > 0)) {
      messages.push(message);

      for (const tc of message.tool_calls) {
        const fnName = tc.function.name;
        let fnArgs: Record<string, any> = {};
        if (typeof tc.function.arguments === 'string') {
          try {
            fnArgs = JSON.parse(tc.function.arguments);
          } catch {
            console.warn(`⚠️ Failed to parse arguments JSON: ${tc.function.arguments}`);
          }
        } else if (tc.function.arguments) {
          fnArgs = tc.function.arguments;
        }

        console.log(`\n⚙️  [Agent Tool Call]: ${fnName}(${JSON.stringify(fnArgs)})`);
        const result = executeTool(fnName, fnArgs);
        console.log(`📥 [Tool Result]: ${result}`);

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: fnName,
          content: result,
        });
      }

      turn++;
      continue;
    }

    // Final Post-Mortem Report Generated
    console.log('\n================================================================');
    console.log('📋 FINAL AGENT POST-MORTEM & AUDIT REPORT');
    console.log('================================================================');
    console.log(message.content);
    console.log('================================================================');
    console.log('\n💰 Billing Refunds Applied by Agent:');
    console.log(JSON.stringify(REFUND_LEDGER, null, 2));

    const totalTime = turnTimings.reduce((a, b) => a + b, 0).toFixed(1);
    console.log(`\n🎉 Task Complete! Completed in ${turn} turns (${totalTime}s total).`);
    break;
  }
}

await runLongAgenticTask();
