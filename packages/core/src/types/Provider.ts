// packages/core/src/types/Provider.ts
// Every browser-based provider adapter implements this interface

export type ProviderCapability =
  | 'text'
  | 'code'
  | 'image-input'
  | 'image-generation'
  | 'search'
  | 'citations'
  | 'long-context'
  | 'analysis';

export type ProviderStatus =
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'rate-limited'
  | 'needs-captcha'
  | 'session-expired'
  | 'initializing';

export interface ProviderResponse {
  id: string;
  provider: string;
  content: string;
  conversationId?: string;
  /** Rough token estimate based on character count */
  tokensEstimate: number;
  durationMs: number;
  capturedAt: Date;
  metadata: Record<string, unknown>;
}

export interface ProviderLimits {
  requestsPerHour: number | null;
  messagesPerConversation: number | null;
  maxImageSizeMb: number | null;
  remainingRequests?: number;
  resetsAt?: Date;
}

export interface AskOptions {
  /** Continue an existing conversation */
  conversationId?: string;
  /** Images to attach (Buffer of image bytes) */
  images?: ImageAttachment[];
  /** Abort after this many ms */
  timeoutMs?: number;
  /** Block until response stops streaming in the browser */
  waitForCompletion?: boolean;
}

export interface ImageAttachment {
  data: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  filename?: string;
}

// ─── The Provider Contract ──────────────────────────────────────────────────

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapability[];

  // Lifecycle
  initialize(): Promise<void>;
  isReady(): Promise<boolean>;
  getStatus(): Promise<ProviderStatus>;
  getLimits(): Promise<ProviderLimits>;

  // Core interaction
  ask(prompt: string, options?: AskOptions): Promise<ProviderResponse>;

  // Conversation management
  newConversation(): Promise<string>;
  continueConversation(
    conversationId: string,
    prompt: string,
    options?: AskOptions
  ): Promise<ProviderResponse>;

  // Session recovery
  /** Attempt soft recovery (refresh page, re-login if needed) */
  recover(): Promise<void>;
  /** Full nuclear reset — new browser context, fresh login */
  reset(): Promise<void>;

  // Health
  healthCheck(): Promise<ProviderStatus>;
}
