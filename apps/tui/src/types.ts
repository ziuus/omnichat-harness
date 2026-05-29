export type ProviderStatus = 'healthy' | 'degraded' | 'unavailable' | 'rate-limited' | 'unknown';

export interface HealthOverview {
  readonly serverStatus: 'healthy' | 'degraded' | 'unavailable';
  readonly rawStatus: string;
  readonly version: string | null;
  readonly uptimeSeconds: number | null;
  readonly modelCount: number | null;
  readonly browser: {
    readonly running: boolean;
    readonly contexts: number;
  } | null;
  readonly providers: {
    readonly total: number;
    readonly healthy: number;
    readonly statuses: Readonly<Record<string, ProviderStatus>>;
  };
  readonly timestamp: string | null;
}

export interface ModelInfo {
  readonly id: string;
  readonly owner: string | null;
  readonly root: string | null;
  readonly omniStatus: ProviderStatus;
}

export interface FetchErrorInfo {
  readonly kind: 'network' | 'http' | 'parse';
  readonly statusCode: number | null;
  readonly message: string;
}

export type FetchResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: FetchErrorInfo };
