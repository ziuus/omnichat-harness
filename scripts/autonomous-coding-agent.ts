#!/usr/bin/env bun
// scripts/autonomous-coding-agent.ts
// Autonomous Developer Coding Agent using OmniChat OpenAI-compatible endpoint
// Equips the AI agent with real developer tools: bash, write_file, read_file, edit_file, list_directory
export {};

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const PORT = 3132;
const BASE_URL = `http://localhost:${PORT}/v1`;
const API_KEY = 'omni-local-dev-key';
const MODEL = 'chatgpt';

// Isolated sandbox directory for the agent to work in
const WORKSPACE_DIR = resolve('/home/zius/Projects/omnichat-harness/test-agent-workspace');
if (!existsSync(WORKSPACE_DIR)) {
  mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// ── Developer Tools Definitions (Standard OpenAI Function Schema) ──────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_project_structure',
      description: 'Inspect the files and directory structure of the project repository',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to inspect (default ".")' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_module_source',
      description: 'Fetch the source code or configuration content of a specific project file (e.g. "package.json")',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to fetch' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_module_source',
      description: 'Save or overwrite a source code file or test file in the project',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to save (e.g. "math-utils.ts")' },
          content: { type: 'string', description: 'Full source code content of the file' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_project_tests',
      description: 'Execute the project test runner and return test suite execution output and pass/fail summary',
      parameters: {
        type: 'object',
        properties: {
          test_command: { type: 'string', description: 'Test command to run (e.g. "bun test")' },
        },
        required: ['test_command'],
      },
    },
  },
];

// ── Tool Execution Implementation ──────────────────────────────────────
function executeDeveloperTool(name: string, args: Record<string, any>): string {
  try {
    const rawPath = args.path || args.file || args.file_name || args.test_file || '.';

    if (name === 'get_project_structure' || name === 'list_files' || name === 'list_directory' || name === 'inspect_workspace') {
      const dirPath = resolve(WORKSPACE_DIR, rawPath);
      if (!existsSync(dirPath)) {
        return JSON.stringify({ error: `Directory not found: ${rawPath}` });
      }
      const entries = readdirSync(dirPath).map((n) => {
        const full = join(dirPath, n);
        const isDir = statSync(full).isDirectory();
        return `${n}${isDir ? '/' : ''}`;
      });
      console.log(`\n📁 [Project Structure]: ${rawPath} -> [${entries.join(', ')}]`);
      return JSON.stringify({ entries });
    }

    if (name === 'get_module_source' || name === 'read_file' || name === 'read_source_module' || name === 'fetch_workspace_file') {
      const filePath = resolve(WORKSPACE_DIR, rawPath);
      if (!existsSync(filePath)) {
        return JSON.stringify({ error: `File not found: ${rawPath}` });
      }
      const content = readFileSync(filePath, 'utf-8');
      console.log(`\n📖 [Module Source Read]: ${rawPath} (${content.length} bytes)`);
      return JSON.stringify({ path: rawPath, content });
    }

    if (name === 'save_module_source' || name === 'write_file' || name === 'create_source_module' || name === 'save_workspace_file') {
      const filePath = resolve(WORKSPACE_DIR, rawPath);
      const content = args.content ?? args.code_content ?? '';
      writeFileSync(filePath, content, 'utf-8');
      console.log(`\n📝 [Module Source Saved]: ${rawPath} (${content.length} bytes)`);
      return JSON.stringify({ success: true, path: rawPath, bytes_written: content.length });
    }

    if (name === 'run_project_tests' || name === 'run_tests' || name === 'run_command' || name === 'run_test_suite' || name === 'bash') {
      const cmd = args.test_command || args.command || args.cmd || 'bun test';
      console.log(`\n💻 [Test Runner Executed]: $ ${cmd}`);
      try {
        const stdout = execSync(cmd, {
          cwd: WORKSPACE_DIR,
          encoding: 'utf-8',
          timeout: 30000,
        });
        const trimmed = stdout.trim();
        console.log(`📊 [Test Results]:\n${trimmed}`);
        return JSON.stringify({ exit_code: 0, stdout: trimmed });
      } catch (err: any) {
        const stdout = (err.stdout ?? '').toString().trim();
        const stderr = (err.stderr ?? '').toString().trim();
        console.warn(`⚠️ [Test Results Error]:\n${stdout || stderr}`);
        return JSON.stringify({
          exit_code: err.status ?? 1,
          stdout,
          stderr: stderr || err.message,
        });
      }
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err: any) {
    return JSON.stringify({ error: err.message || String(err) });
  }
}

// ── Autonomous Agent Loop ──────────────────────────────────────────────
async function runAutonomousCodingAgent() {
  console.log('\n================================================================');
  console.log('🤖 Starting Autonomous Coding Agent (OmniChat + Headless ChatGPT)');
  console.log(`Endpoint: ${BASE_URL} | Model: ${MODEL}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
  console.log('Available Tools: get_project_structure, get_module_source, save_module_source, run_project_tests');
  console.log('================================================================\n');

  const messages: any[] = [
    {
      role: 'system',
      content:
        'You are an autonomous AI Software Engineer. ' +
        'Your goal is to inspect project structure, read project configuration, implement required modules and unit tests, execute the test suite, and verify all tests pass. ' +
        'Always use the available tools to inspect code, save modules, and run tests before making conclusions.',
    },
    {
      role: 'user',
      content:
        process.argv.slice(2).join(' ').trim() ||
        'We need to implement a string cryptography and token utility module and verify it with automated tests. ' +
        'Please check the project structure and inspect package.json to see what test runner and dependencies are configured. ' +
        'Then implement crypto-utils.ts (with generateSecureToken, hashPassword, verifyPassword, base64UrlEncode, base64UrlDecode) and crypto-utils.test.ts, run the test suite to verify everything passes, and provide the final report.',
    },
  ];

  console.log(`[Task Prompt]:\n${messages[1].content}\n`);

  let turn = 1;
  const maxTurns = 8;
  const turnTimings: number[] = [];

  while (turn <= maxTurns) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━ Turn ${turn} (Agent Reasoning) ━━━━━━━━━━━━━━━━━━━━━━`);
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

        console.log(`⚙️  [Agent Tool Call]: ${fnName}(${JSON.stringify(fnArgs).slice(0, 120)}...)`);
        const result = executeDeveloperTool(fnName, fnArgs);
        console.log(`📥 [Tool Result]: ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}`);

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

    // Final Agent Deliverable Generated
    console.log('\n================================================================');
    console.log('🎉 AGENT DELIVERABLE & TEST VERIFICATION REPORT');
    console.log('================================================================');
    console.log(message.content);
    console.log('================================================================');

    const totalTime = turnTimings.reduce((a, b) => a + b, 0).toFixed(1);
    console.log(`\n✅ Autonomous Coding Task Succeeded in ${turn} turns (${totalTime}s total).`);
    break;
  }
}

await runAutonomousCodingAgent();
