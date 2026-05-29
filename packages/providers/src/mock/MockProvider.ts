import type {
  AskOptions,
  Provider,
  ProviderCapability,
  ProviderLimits,
  ProviderResponse,
  ProviderStatus,
} from '@omni/core';

export class MockProvider implements Provider {
  readonly capabilities: ProviderCapability[] = ['text', 'code', 'analysis'];
  private status: ProviderStatus = 'healthy';

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly fixedResponse: string,
  ) {}

  async initialize(): Promise<void> {
    this.status = 'healthy';
  }

  async isReady(): Promise<boolean> {
    return this.status === 'healthy' || this.status === 'degraded';
  }

  async getStatus(): Promise<ProviderStatus> {
    return this.status;
  }

  async getLimits(): Promise<ProviderLimits> {
    return {
      requestsPerHour: null,
      messagesPerConversation: null,
      maxImageSizeMb: null,
    };
  }

  async ask(_prompt: string, _options?: AskOptions): Promise<ProviderResponse> {
    return this.buildResponse();
  }

  async newConversation(): Promise<string> {
    return `${this.id}-mock-conversation`;
  }

  async continueConversation(
    _conversationId: string,
    _prompt: string,
    _options?: AskOptions,
  ): Promise<ProviderResponse> {
    return this.buildResponse();
  }

  async recover(): Promise<void> {
    this.status = 'healthy';
  }

  async reset(): Promise<void> {
    this.status = 'healthy';
  }

  async healthCheck(): Promise<ProviderStatus> {
    return this.status;
  }

  private buildResponse(): ProviderResponse {
    return {
      id: `${this.id}-mock-response`,
      provider: this.id,
      content: this.fixedResponse,
      conversationId: `${this.id}-mock-conversation`,
      tokensEstimate: Math.ceil(this.fixedResponse.length / 4),
      durationMs: 5,
      capturedAt: new Date(),
      metadata: { mock: true },
    };
  }
}
