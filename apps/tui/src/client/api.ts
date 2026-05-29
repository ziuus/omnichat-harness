import type { FetchErrorInfo, FetchResult, HealthOverview, ModelInfo, ProviderStatus } from '../types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const UNKNOWN_STATUS: ProviderStatus = 'unknown';

interface RequestOptions {
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}

export async function fetchHealth(baseUrl: string, options: RequestOptions = {}): Promise<FetchResult<HealthOverview>> {
  const result = await requestJson(joinUrl(baseUrl, '/health'), options);
  if (!result.ok) {
    return result;
  }

  try {
    return { ok: true, data: normalizeHealth(result.data) };
  } catch (error) {
    return { ok: false, error: parseError(error) };
  }
}

export async function fetchModels(baseUrl: string, options: RequestOptions = {}): Promise<FetchResult<readonly ModelInfo[]>> {
  const result = await requestJson(joinUrl(baseUrl, '/v1/models'), options);
  if (!result.ok) {
    return result;
  }

  try {
    return { ok: true, data: normalizeModels(result.data) };
  } catch (error) {
    return { ok: false, error: parseError(error) };
  }
}

export function normalizeHealth(value: unknown): HealthOverview {
  const obj = asRecord(value);
  const providers = asRecord(obj.providers);
  const providerStatuses = normalizeProviderStatuses(asRecord(providers.statuses));
  const browser = obj.browser === null || obj.browser === undefined ? null : asRecord(obj.browser);
  const rawStatus = getString(obj.status) ?? 'unknown';

  return {
    serverStatus: normalizeServerStatus(rawStatus),
    rawStatus,
    version: getString(obj.version),
    uptimeSeconds: getNumber(obj.uptime),
    modelCount: getNumber(obj.models),
    browser: browser
      ? {
          running: getBoolean(browser.running) ?? false,
          contexts: getNumber(browser.contexts) ?? 0,
        }
      : null,
    providers: {
      total: getNumber(providers.total) ?? Object.keys(providerStatuses).length,
      healthy: getNumber(providers.healthy) ?? countHealthyProviders(providerStatuses),
      statuses: providerStatuses,
    },
    timestamp: getString(obj.timestamp),
  };
}

export function normalizeModels(value: unknown): readonly ModelInfo[] {
  const obj = asRecord(value);
  const data = obj.data;
  if (!Array.isArray(data)) {
    throw new Error('Expected /v1/models response data to be an array');
  }

  return data.map((item) => {
    const model = asRecord(item);
    const id = getString(model.id);
    if (!id) {
      throw new Error('Model entry missing string id');
    }

    return {
      id,
      owner: getString(model.owned_by),
      root: getString(model.root),
      omniStatus: normalizeProviderStatus(getString(model['x-omni-status'])),
    };
  });
}

async function requestJson(url: string, options: RequestOptions): Promise<FetchResult<unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const headers = new Headers({ Accept: 'application/json' });
    if (options.apiKey) {
      headers.set('Authorization', `Bearer ${options.apiKey}`);
    }

    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      return { ok: false, error: httpError(response.status) };
    }

    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, error: networkError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function normalizeProviderStatuses(statuses: Record<string, unknown>): Record<string, ProviderStatus> {
  return Object.fromEntries(
    Object.entries(statuses).map(([provider, status]) => [provider, normalizeProviderStatus(getString(status))]),
  );
}

export function normalizeProviderStatus(status: string | null): ProviderStatus {
  switch (status) {
    case 'healthy':
    case 'degraded':
    case 'unavailable':
    case 'rate-limited':
      return status;
    default:
      return UNKNOWN_STATUS;
  }
}

function normalizeServerStatus(status: string): HealthOverview['serverStatus'] {
  if (status === 'ok' || status === 'healthy') {
    return 'healthy';
  }
  if (status === 'degraded') {
    return 'degraded';
  }
  return 'unavailable';
}

function countHealthyProviders(statuses: Readonly<Record<string, ProviderStatus>>): number {
  return Object.values(statuses).filter((status) => status === 'healthy' || status === 'degraded').length;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected JSON object');
  }

  return value as Record<string, unknown>;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function httpError(statusCode: number): FetchErrorInfo {
  const message = statusCode === 401 || statusCode === 403
    ? `Authentication failed (${statusCode}). Check OMNI_API_KEY.`
    : `HTTP ${statusCode}`;

  return { kind: 'http', statusCode, message };
}

function networkError(error: unknown): FetchErrorInfo {
  const message = error instanceof Error && error.name === 'AbortError'
    ? 'Request timed out'
    : error instanceof Error
      ? error.message
      : 'Network request failed';

  return { kind: 'network', statusCode: null, message };
}

function parseError(error: unknown): FetchErrorInfo {
  return {
    kind: 'parse',
    statusCode: null,
    message: error instanceof Error ? error.message : 'Failed to parse response',
  };
}
