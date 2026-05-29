import type { HealthOverview, ProviderStatus } from '../types.js';

export interface StatusPresentation {
  readonly label: string;
  readonly icon: string;
  readonly color: string;
}

export const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  gray: '\u001b[90m',
  clear: '\u001b[2J\u001b[H',
} as const;

export function providerStatusPresentation(status: ProviderStatus): StatusPresentation {
  switch (status) {
    case 'healthy':
      return { label: 'healthy', icon: '●', color: ANSI.green };
    case 'degraded':
      return { label: 'degraded', icon: '▲', color: ANSI.yellow };
    case 'rate-limited':
      return { label: 'rate-limited', icon: '◷', color: ANSI.magenta };
    case 'unavailable':
      return { label: 'unavailable', icon: '×', color: ANSI.red };
    case 'unknown':
      return { label: 'unknown', icon: '?', color: ANSI.gray };
  }
}

export function serverStatusPresentation(status: HealthOverview['serverStatus']): StatusPresentation {
  switch (status) {
    case 'healthy':
      return { label: 'healthy', icon: '●', color: ANSI.green };
    case 'degraded':
      return { label: 'degraded', icon: '▲', color: ANSI.yellow };
    case 'unavailable':
      return { label: 'unavailable', icon: '×', color: ANSI.red };
  }
}

export function paint(value: string, color: string, enabled: boolean): string {
  return enabled ? `${color}${value}${ANSI.reset}` : value;
}
