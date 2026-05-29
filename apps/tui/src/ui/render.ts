import type { FetchErrorInfo, HealthOverview, ModelInfo } from '../types.js';
import { ANSI, paint, providerStatusPresentation, serverStatusPresentation } from './status.js';

export type ActivePanel = 'overview' | 'providers' | 'models' | 'tasks';

export interface DashboardState {
  readonly serverUrl: string;
  readonly refreshMs: number;
  readonly apiKeyConfigured: boolean;
  readonly activePanel: ActivePanel;
  readonly lastUpdated: Date | null;
  readonly health: HealthOverview | null;
  readonly healthError: FetchErrorInfo | null;
  readonly models: readonly ModelInfo[];
  readonly modelsError: FetchErrorInfo | null;
}

interface RenderOptions {
  readonly color: boolean;
  readonly clearScreen: boolean;
}

const PANEL_ORDER: readonly ActivePanel[] = ['overview', 'providers', 'models', 'tasks'];

export function nextPanel(panel: ActivePanel): ActivePanel {
  const index = PANEL_ORDER.indexOf(panel);
  return PANEL_ORDER[(index + 1) % PANEL_ORDER.length] ?? 'overview';
}

export function renderDashboard(state: DashboardState, options: RenderOptions): string {
  const lines: string[] = [];
  if (options.clearScreen) {
    lines.push(ANSI.clear);
  }

  lines.push(paint('OmniChat Harness TUI', ANSI.bold + ANSI.cyan, options.color));
  lines.push(`${paint('Server', ANSI.dim, options.color)} ${state.serverUrl}  ${paint('Refresh', ANSI.dim, options.color)} ${state.refreshMs}ms  ${paint('Keys', ANSI.dim, options.color)} ${state.apiKeyConfigured ? 'configured' : 'not configured'}`);
  lines.push(`${paint('Updated', ANSI.dim, options.color)} ${state.lastUpdated ? state.lastUpdated.toLocaleTimeString() : 'waiting'}  ${paint('Controls', ANSI.dim, options.color)} q/Ctrl+C quit · r refresh · Tab panel`);
  lines.push('');
  lines.push(...renderOverview(state, options.color));
  lines.push('');
  lines.push(...renderProviders(state, options.color));
  lines.push('');
  lines.push(...renderModels(state, options.color));
  lines.push('');
  lines.push(...renderTasks(state, options.color));
  lines.push('');
  lines.push(paint('Session hint: if browser sessions are missing or unavailable, run `bun run session:init`.', ANSI.dim, options.color));

  return lines.join('\n');
}

function renderOverview(state: DashboardState, color: boolean): readonly string[] {
  const title = panelTitle('overview', 'Health overview', state.activePanel, color);
  if (state.healthError) {
    return [title, `  ${paint('Unavailable', ANSI.red, color)} — ${state.healthError.message}`];
  }
  if (!state.health) {
    return [title, '  Loading health...'];
  }

  const health = state.health;
  const status = serverStatusPresentation(health.serverStatus);
  const browser = health.browser;
  const browserText = browser
    ? `${browser.running ? 'running' : 'not running'} (${browser.contexts} contexts)`
    : 'not running (0 contexts)';

  return [
    title,
    `  Status      ${paint(`${status.icon} ${status.label}`, status.color, color)} (${health.rawStatus})`,
    `  Uptime      ${formatUptime(health.uptimeSeconds)}`,
    `  Models      ${health.modelCount ?? 'unknown'}`,
    `  Browser     ${browserText}`,
    `  Providers   ${health.providers.healthy}/${health.providers.total} healthy`,
  ];
}

function renderProviders(state: DashboardState, color: boolean): readonly string[] {
  const title = panelTitle('providers', 'Provider status', state.activePanel, color);
  if (!state.health || Object.keys(state.health.providers.statuses).length === 0) {
    return [title, '  No provider snapshot yet.'];
  }

  const rows = Object.entries(state.health.providers.statuses)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, status]) => {
      const presentation = providerStatusPresentation(status);
      return `  ${pad(name, 18)} ${paint(`${presentation.icon} ${presentation.label}`, presentation.color, color)}`;
    });

  return [title, ...rows];
}

function renderModels(state: DashboardState, color: boolean): readonly string[] {
  const title = panelTitle('models', 'Models', state.activePanel, color);
  if (state.modelsError) {
    return [title, `  ${paint('Models unavailable', ANSI.yellow, color)} — ${state.modelsError.message}`];
  }
  if (state.models.length === 0) {
    return [title, '  No models returned yet.'];
  }

  const header = `  ${pad('id', 20)} ${pad('owner', 14)} ${pad('root', 20)} status`;
  const rows = state.models.map((model) => {
    const presentation = providerStatusPresentation(model.omniStatus);
    return `  ${pad(model.id, 20)} ${pad(model.owner ?? '-', 14)} ${pad(model.root ?? '-', 20)} ${paint(`${presentation.icon} ${presentation.label}`, presentation.color, color)}`;
  });

  return [title, paint(header, ANSI.dim, color), ...rows];
}

function renderTasks(state: DashboardState, color: boolean): readonly string[] {
  return [panelTitle('tasks', 'Recent task feed', state.activePanel, color), '  Task feed not wired yet.'];
}

function panelTitle(panel: ActivePanel, label: string, activePanel: ActivePanel, color: boolean): string {
  const marker = panel === activePanel ? '▶' : ' ';
  return paint(`${marker} ${label}`, panel === activePanel ? ANSI.bold + ANSI.blue : ANSI.bold, color);
}

function formatUptime(seconds: number | null): string {
  if (seconds === null) {
    return 'unknown';
  }

  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value.slice(0, Math.max(0, width - 1))}…` : value.padEnd(width, ' ');
}
