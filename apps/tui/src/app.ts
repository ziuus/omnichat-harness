import { fetchHealth, fetchModels } from './client/api.js';
import { nextPanel, renderDashboard, type ActivePanel, type DashboardState } from './ui/render.js';

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const DEFAULT_REFRESH_MS = 2_000;
const MIN_REFRESH_MS = 500;

export type RuntimeMode = 'watch' | 'once';

export interface RuntimeConfig {
  readonly serverUrl: string;
  readonly apiKey: string | undefined;
  readonly refreshMs: number;
  readonly mode: RuntimeMode;
}

type EnvLookup = Readonly<Record<string, string | undefined>>;

export async function runTui(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const config = readConfig(args, process.env);
  const controller = new DashboardController(config);
  await controller.start();
}

class DashboardController {
  private state: DashboardState;
  private interval: Timer | null = null;
  private refreshing = false;

  constructor(private readonly config: RuntimeConfig) {
    this.state = {
      serverUrl: config.serverUrl,
      refreshMs: config.refreshMs,
      apiKeyConfigured: Boolean(config.apiKey),
      activePanel: 'overview',
      lastUpdated: null,
      health: null,
      healthError: null,
      models: [],
      modelsError: null,
    };
  }

  async start(): Promise<void> {
    if (this.config.mode === 'once') {
      await this.refresh();
      return;
    }

    this.setupTerminal();
    this.render();
    await this.refresh();
    this.interval = setInterval(() => void this.refresh(), this.config.refreshMs);
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) {
      return;
    }

    this.refreshing = true;
    const modelOptions = this.config.apiKey ? { apiKey: this.config.apiKey } : {};
    const [healthResult, modelsResult] = await Promise.all([
      fetchHealth(this.config.serverUrl),
      fetchModels(this.config.serverUrl, modelOptions),
    ]);

    this.state = {
      ...this.state,
      lastUpdated: new Date(),
      health: healthResult.ok ? healthResult.data : this.state.health,
      healthError: healthResult.ok ? null : healthResult.error,
      models: modelsResult.ok ? modelsResult.data : this.state.models,
      modelsError: modelsResult.ok ? null : modelsResult.error,
    };
    this.refreshing = false;
    this.render();
  }

  private setupTerminal(): void {
    process.stdout.write('\u001b[?25l');
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => this.handleKey(String(key)));

    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  private handleKey(key: string): void {
    if (key === 'q' || key === '\u0003') {
      this.stop();
      return;
    }
    if (key === 'r') {
      void this.refresh();
      return;
    }
    if (key === '\t') {
      this.state = { ...this.state, activePanel: nextPanel(this.state.activePanel) as ActivePanel };
      this.render();
    }
  }

  private render(): void {
    process.stdout.write(
      renderDashboard(this.state, {
        color: process.stdout.isTTY,
        clearScreen: this.config.mode === 'watch',
      }),
    );
  }

  private stop(): never {
    if (this.interval) {
      clearInterval(this.interval);
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdout.write('\u001b[?25h\n');
    process.exit(0);
  }
}

export function readConfig(args: readonly string[] = process.argv.slice(2), env: EnvLookup = process.env): RuntimeConfig {
  return {
    serverUrl: env.OMNI_SERVER_URL ?? DEFAULT_SERVER_URL,
    apiKey: env.OMNI_API_KEY,
    refreshMs: readRefreshMs(env.OMNI_TUI_REFRESH_MS),
    mode: readMode(args, env.OMNI_TUI_ONCE),
  };
}

function readMode(args: readonly string[], envValue: string | undefined): RuntimeMode {
  if (args.includes('--once') || envValue === 'true' || envValue === '1') {
    return 'once';
  }

  return 'watch';
}

function readRefreshMs(value: string | undefined): number {
  if (!value) {
    return DEFAULT_REFRESH_MS;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_REFRESH_MS;
  }

  return Math.max(MIN_REFRESH_MS, parsed);
}
