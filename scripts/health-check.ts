#!/usr/bin/env bun
// scripts/health-check.ts
// CLI script to inspect the health of the OmniChat Harness server and environment

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  models: number;
  providers: {
    total: number;
    healthy: number;
    statuses: Record<string, string>;
  };
  browser: {
    running: boolean;
    contexts: number;
    statuses: Record<string, string>;
  } | null;
  uptime: number;
  timestamp: string;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function checkServer(port: number): Promise<boolean> {
  const url = `http://localhost:${port}/health`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.log(`[Health] Server responded with HTTP ${res.status}`);
      return false;
    }
    const data = await res.json() as HealthResponse;

    console.log('');
    console.log('╔═════════════════════════════════════════════════╗');
    console.log('║           OmniChat Harness Health Check         ║');
    console.log('╚═════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Server Status : ${data.status === 'ok' ? '● OK' : '▲ DEGRADED'}`);
    console.log(`  Version       : v${data.version}`);
    console.log(`  Uptime        : ${formatUptime(data.uptime)}`);
    console.log(`  Models Loaded : ${data.models}`);
    console.log('');
    console.log('  Providers:');
    console.log(`    Healthy: ${data.providers.healthy} / ${data.providers.total}`);
    for (const [provider, status] of Object.entries(data.providers.statuses)) {
      const icon = status === 'healthy' ? '●' : status === 'degraded' ? '▲' : '○';
      console.log(`    ${icon} ${provider.padEnd(14)}: ${status}`);
    }
    console.log('');
    if (data.browser) {
      console.log('  Browser Pool:');
      console.log(`    Running: ${data.browser.running ? 'Yes' : 'No'}`);
      console.log(`    Contexts: ${data.browser.contexts}`);
      for (const [ctx, status] of Object.entries(data.browser.statuses)) {
        console.log(`      - ${ctx.padEnd(12)}: ${status}`);
      }
      console.log('');
    }
    return true;
  } catch {
    return false;
  }
}

function checkOfflineEnvironment(): void {
  console.log('');
  console.log('╔═════════════════════════════════════════════════╗');
  console.log('║           OmniChat Harness Health Check         ║');
  console.log('╚═════════════════════════════════════════════════╝');
  console.log('');
  console.log('  [Server] Offline (No server listening on localhost)');
  console.log('  To start the server, run: bun run dev:server');
  console.log('');

  console.log('  Local Storage & Sessions:');
  const dbPath = process.env['DATABASE_URL'] ?? './data/omnichat.db';
  if (existsSync(dbPath)) {
    const stat = statSync(dbPath);
    console.log(`    ● Database        : ${dbPath} (${Math.round(stat.size / 1024)} KB)`);
  } else {
    console.log(`    ○ Database        : Not initialized yet (${dbPath})`);
  }

  const sessionPath = process.env['SESSION_STORAGE_PATH'] ?? './data/sessions';
  if (existsSync(sessionPath)) {
    const files = readdirSync(sessionPath).filter((f) => f.endsWith('.enc'));
    if (files.length > 0) {
      console.log(`    ● Sessions (${files.length})   : ${files.join(', ')}`);
    } else {
      console.log('    ○ Sessions        : No saved sessions found in ' + sessionPath);
      console.log('      Run `bun run session:init` to authenticate with providers.');
    }
  } else {
    console.log('    ○ Sessions        : Directory ' + sessionPath + ' does not exist yet');
    console.log('      Run `bun run session:init` to create sessions.');
  }
  console.log('');
}

async function main() {
  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const isRunning = await checkServer(port);
  if (!isRunning) {
    checkOfflineEnvironment();
  }
}

main().catch((err) => {
  console.error('[Health] Fatal error:', err);
  process.exit(1);
});
