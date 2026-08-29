import type { ProviderHealth } from '../contracts.js';
import type {
  GenerateStructuredRequest,
  GenerateStructuredResponse,
  LlmProvider
} from './provider.js';

export type DisabledProviderReason = 'provider_disabled' | 'provider_not_configured';

export interface DisabledProviderResult {
  status: 'disabled';
  reason: DisabledProviderReason;
}

/**
 * Fail-safe provider used until an explicitly configured provider is supplied.
 * It performs no I/O and treats the disabled state as a normal result.
 */
export class DisabledProvider implements LlmProvider {
  readonly alias = 'disabled' as const;

  constructor(private readonly reason: DisabledProviderReason = 'provider_disabled') {}

  modelAliasForOperation(): 'disabled' {
    return 'disabled';
  }

  async health(): Promise<ProviderHealth> {
    return {
      status: this.reason === 'provider_not_configured' ? 'not_configured' : 'disabled',
      configured: false,
      reason: this.reason
    };
  }

  async generateStructured<T>(
    _request: Readonly<GenerateStructuredRequest>
  ): Promise<GenerateStructuredResponse> {
    const value: DisabledProviderResult = {
      status: 'disabled',
      reason: this.reason
    };
    return { value };
  }
}
