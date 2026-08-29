import OpenAI from 'openai';
import { ContentFilterFinishReasonError, LengthFinishReasonError } from 'openai/error';
import { zodTextFormat } from 'openai/helpers/zod';
import type { ZodTypeAny } from 'zod';

import type { ProviderHealth, TokenUsage } from '../contracts.js';
import {
  ProviderExecutionError,
  type GenerateStructuredRequest,
  type GenerateStructuredResponse,
  type LlmOperation,
  type LlmProvider,
  type ProviderModelAlias,
  type ProviderSafeErrorCode
} from './provider.js';

export const OPENAI_SDK_VERSION = '7.8.0' as const;
export const OPENAI_MODEL_ALIASES = Object.freeze({
  analysis: 'gpt-5.6-luna',
  synthesis: 'gpt-5.6-luna'
});

export type OpenAIModelAliases = Readonly<Record<'analysis' | 'synthesis', string>>;

interface ParsedOpenAIResponse {
  id?: string;
  output_parsed: unknown | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | null;
}

export interface OpenAIClientLike {
  responses: {
    parse(
      body: Readonly<Record<string, unknown>>,
      options?: Readonly<Record<string, unknown>>
    ): Promise<ParsedOpenAIResponse>;
  };
}

export interface OpenAIProviderOptions {
  apiKey?: string;
  client?: OpenAIClientLike;
  modelAliases?: OpenAIModelAliases;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function statusOf(error: unknown): number | null {
  if (error instanceof OpenAI.APIError) return error.status ?? null;
  if (error !== null && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number') {
    return (error as { status: number }).status;
  }
  return null;
}

export function mapOpenAiError(error: unknown): ProviderExecutionError {
  if (error instanceof ProviderExecutionError) return error;
  const status = statusOf(error);
  if (
    error instanceof OpenAI.APIConnectionTimeoutError
    || (error instanceof Error && error.name === 'AbortError')
    || status === 408
  ) {
    return new ProviderExecutionError('provider_timeout', true);
  }
  if (status === 429 || error instanceof OpenAI.RateLimitError) {
    return new ProviderExecutionError('provider_rate_limited', true);
  }
  if (status === 401 || status === 403 || error instanceof OpenAI.AuthenticationError) {
    return new ProviderExecutionError('provider_auth_failed', false);
  }
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return new ProviderExecutionError('provider_bad_request', false);
  }
  if (status !== null && status >= 500) {
    return new ProviderExecutionError('provider_unavailable', true);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new ProviderExecutionError('provider_unavailable', true);
  }
  if (
    error instanceof SyntaxError
    || error instanceof LengthFinishReasonError
    || error instanceof ContentFilterFinishReasonError
  ) {
    return new ProviderExecutionError('provider_invalid_output', false);
  }
  return new ProviderExecutionError('provider_unknown_error', false);
}

function usageOf(response: ParsedOpenAIResponse): TokenUsage | undefined {
  if (!response.usage) return undefined;
  return {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.total_tokens
  };
}

function schemaName(request: Readonly<GenerateStructuredRequest>): string {
  return `acpm_${request.agentId}_${request.promptVersion}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export class OpenAIProvider implements LlmProvider {
  readonly alias = 'openai' as const;
  private readonly client: OpenAIClientLike | null;
  private readonly configured: boolean;
  private readonly modelAliases: OpenAIModelAliases;
  private readonly maxAttempts: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: OpenAIProviderOptions = {}) {
    const apiKey = options.apiKey?.trim() ?? '';
    this.configured = options.client !== undefined || apiKey.length > 0;
    this.client = options.client ?? (apiKey
      ? new OpenAI({ apiKey, maxRetries: 0 }) as unknown as OpenAIClientLike
      : null);
    this.modelAliases = options.modelAliases ?? OPENAI_MODEL_ALIASES;
    this.maxAttempts = Math.max(1, Math.min(10, options.maxAttempts ?? 3));
    this.sleep = options.sleep ?? wait;
  }

  modelAliasForOperation(operation: LlmOperation): ProviderModelAlias {
    return operation === 'pm-synthesis' ? 'synthesis' : 'analysis';
  }

  async health(): Promise<ProviderHealth> {
    return this.configured
      ? { status: 'available', configured: true, reason: null }
      : { status: 'not_configured', configured: false, reason: 'provider_not_configured' };
  }

  async generateStructured<T>(
    request: Readonly<GenerateStructuredRequest>
  ): Promise<GenerateStructuredResponse> {
    if (!this.client) throw new ProviderExecutionError('provider_auth_failed', false);
    if (request.modelAlias !== 'analysis' && request.modelAlias !== 'synthesis') {
      throw new ProviderExecutionError('provider_bad_request', false);
    }

    const model = this.modelAliases[request.modelAlias];
    let providerFormat: ReturnType<typeof zodTextFormat>;
    try {
      providerFormat = zodTextFormat(request.outputSchema as ZodTypeAny, schemaName(request));
    } catch {
      throw new ProviderExecutionError('provider_bad_request', false);
    }
    const body = {
      model,
      store: false,
      instructions: request.systemInstruction,
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: JSON.stringify({
            promptVersion: request.promptVersion,
            context: request.context
          })
        }]
      }],
      text: {
        format: providerFormat
      }
    };

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.client.responses.parse(body, {
          timeout: request.timeoutMs,
          headers: { 'Idempotency-Key': request.idempotencyKey }
        });
        if (response.output_parsed === null || response.output_parsed === undefined) {
          throw new ProviderExecutionError('provider_invalid_output', false);
        }
        return {
          value: response.output_parsed as T,
          providerRequestId: response.id,
          usage: usageOf(response)
        };
      } catch (error) {
        const mapped = mapOpenAiError(error);
        if (!mapped.retryable || attempt >= this.maxAttempts) throw mapped;
        await this.sleep(Math.min(250 * (2 ** (attempt - 1)), 2000));
      }
    }

    throw new ProviderExecutionError('provider_unknown_error', false);
  }
}
