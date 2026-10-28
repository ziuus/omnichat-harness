#!/usr/bin/env bun
// bin/omnichat.js
// CLI launcher for OmniChat Harness

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const command = process.argv[2] || 'start';
const args = process.argv.slice(3);

function printHelp() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                  OmniChat Harness CLI                         ║
║      Dual OpenAI & Anthropic Compatible AI Gateway            ║
╚═══════════════════════════════════════════════════════════════╝

Usage:
  omnichat [command] [options]

Commands:
  start           Start the dual-protocol API server (default)
  dev             Start the API server in watch/development mode
  tui             Launch the real-time terminal monitoring dashboard
  init [provider] Launch browser to log into providers (e.g. chatgpt, gemini)
  test            Run the comprehensive system self-test
  help            Show this help information

Environment Variables:
  PORT            Server port (default: 3000)
  OMNI_API_KEY    Gateway authentication key (default: omni-local-dev-key)
  BROWSER_HEADLESS Run browsers in headless mode (default: true)

Examples:
  omnichat start --port 3132
  omnichat tui
  omnichat init chatgpt
  omnichat test
`);
}

function runScript(scriptPath, extraArgs = []) {
  const child = spawn('bun', [scriptPath, ...extraArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env },
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

switch (command) {
  case 'start':
  case 'serve':
  case 'server':
    runScript(resolve(ROOT, 'apps/server/src/index.ts'), args);
    break;

  case 'dev':
    runScript(resolve(ROOT, 'apps/server/src/index.ts'), args);
    break;

  case 'tui':
  case 'dashboard':
    runScript(resolve(ROOT, 'apps/tui/src/index.ts'), args);
    break;

  case 'init':
  case 'login':
  case 'session:init':
    runScript(resolve(ROOT, 'scripts/session-init.ts'), args);
    break;

  case 'test':
  case 'self-test':
    runScript(resolve(ROOT, 'scripts/system-self-test.ts'), args);
    break;

  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
