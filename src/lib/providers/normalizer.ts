// ─── src/lib/providers/normalizer.ts ──────────────────────────────────────────
// Every provider adapter returns NormalizedResponse.
// Retry logic, fallback chains, and timeout handling live here.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { NormalizedResponse, Provider } from '@/lib/agent/types';
import { logger } from '@/lib/observability/logger';

const responseCache = new Map<string, NormalizedResponse>();

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function cacheKey(opts: CallLLMOptions, provider: Provider, model: string): string {
  return stableHash(JSON.stringify({
    provider,
    model,
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.3,
    responseFormat: opts.responseFormat ?? 'text',
    schemaVersion: opts.schemaVersion ?? 'none',
    idempotencyKey: opts.idempotencyKey ?? 'none',
  }));
}

function defaultFallbacks(provider: Provider, model: string): Array<{ provider: Provider; model: string }> {
  const candidates: Array<{ provider: Provider; model: string }> = [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'gemini', model: 'gemini-1.5-pro' },
    { provider: 'nvidia', model: 'meta/llama-3.1-70b-instruct' },
  ];
  return candidates.filter((c) => c.provider !== provider || c.model !== model);
}

// ── Token cost table (USD per 1M tokens, updated regularly) ─────────────────
const TOKEN_COSTS: Record<string, { in: number; out: number }> = {
  'claude-opus-4-5':              { in: 15,    out: 75    },
  'claude-sonnet-4-5':            { in: 3,     out: 15    },
  'claude-haiku-4-5':             { in: 0.8,   out: 4     },
  'gpt-4o':                       { in: 2.5,   out: 10    },
  'gpt-4o-mini':                  { in: 0.15,  out: 0.6   },
  'gpt-4-turbo':                  { in: 10,    out: 30    },
  'gemini-1.5-pro':               { in: 1.25,  out: 5     },
  'gemini-1.5-flash':             { in: 0.075, out: 0.3   },
  'gemini-2.0-flash-exp':         { in: 0.1,   out: 0.4   },
  'meta/llama-3.1-405b-instruct': { in: 5,     out: 16    },
  'meta/llama-3.1-70b-instruct':  { in: 0.9,   out: 0.9   },
};

function computeCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = TOKEN_COSTS[model] ?? { in: 1, out: 4 };
  return ((promptTokens * costs.in) + (completionTokens * costs.out)) / 1_000_000;
}

// ── Provider clients (lazy-initialized) ─────────────────────────────────────
let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ── Individual provider adapters ─────────────────────────────────────────────

interface CallOptions {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  responseFormat?: 'text' | 'json_object';
  signal?: AbortSignal;
}

async function callAnthropic(opts: CallOptions): Promise<NormalizedResponse> {
  const t0 = performance.now();
  const client = getAnthropic();

  const res = await client.messages.create({
    model: opts.model,
    system: opts.systemPrompt,
    messages: [{ role: 'user', content: opts.userPrompt }],
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
  }, { signal: opts.signal });

  const content = res.content[0]?.type === 'text' ? res.content[0].text : '';
  const usage = {
    promptTokens: res.usage.input_tokens,
    completionTokens: res.usage.output_tokens,
    totalTokens: res.usage.input_tokens + res.usage.output_tokens,
  };

  return {
    content,
    usage,
    finishReason: res.stop_reason === 'end_turn' ? 'stop' : 'length',
    latencyMs: Math.round(performance.now() - t0),
    model: opts.model,
    provider: 'anthropic',
    costUsd: computeCost(opts.model, usage.promptTokens, usage.completionTokens),
  };
}

async function callOpenAI(opts: CallOptions): Promise<NormalizedResponse> {
  const t0 = performance.now();
  const client = getOpenAI();

  const res = await client.chat.completions.create({
    model: opts.model,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userPrompt },
    ],
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    response_format: opts.responseFormat === 'json_object' ? { type: 'json_object' } : undefined,
  }, { signal: opts.signal });

  const choice = res.choices[0];
  const usage = {
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
    totalTokens: res.usage?.total_tokens ?? 0,
  };

  return {
    content: choice.message.content ?? '',
    usage,
    finishReason: choice.finish_reason === 'stop' ? 'stop' : 'length',
    latencyMs: Math.round(performance.now() - t0),
    model: opts.model,
    provider: 'openai',
    costUsd: computeCost(opts.model, usage.promptTokens, usage.completionTokens),
  };
}

async function callGemini(opts: CallOptions): Promise<NormalizedResponse> {
  const t0 = performance.now();
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const gemModel = genAI.getGenerativeModel({
    model: opts.model,
    systemInstruction: opts.systemPrompt,
  });

  const result = await gemModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: opts.userPrompt }] }],
    generationConfig: {
      maxOutputTokens: opts.maxTokens,
      temperature: opts.temperature,
      responseMimeType: opts.responseFormat === 'json_object' ? 'application/json' : 'text/plain',
    },
  });

  const text = result.response.text();
  const usageMetadata = result.response.usageMetadata;
  const promptTokens = usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = usageMetadata?.candidatesTokenCount ?? 0;
  const usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };

  return {
    content: text,
    usage,
    finishReason: 'stop',
    latencyMs: Math.round(performance.now() - t0),
    model: opts.model,
    provider: 'gemini',
    costUsd: computeCost(opts.model, usage.promptTokens, usage.completionTokens),
  };
}

async function callNvidia(opts: CallOptions): Promise<NormalizedResponse> {
  const t0 = performance.now();
  if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY not set');

  // NVIDIA NIM uses OpenAI-compatible API
  const client = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
  });

  const res = await client.chat.completions.create({
    model: opts.model,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userPrompt },
    ],
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
  }, { signal: opts.signal });

  const choice = res.choices[0];
  const usage = {
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
    totalTokens: res.usage?.total_tokens ?? 0,
  };

  return {
    content: choice.message.content ?? '',
    usage,
    finishReason: choice.finish_reason === 'stop' ? 'stop' : 'length',
    latencyMs: Math.round(performance.now() - t0),
    model: opts.model,
    provider: 'nvidia',
    costUsd: computeCost(opts.model, usage.promptTokens, usage.completionTokens),
  };
}

// ── Timeout wrapper ───────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    promise
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

// ── Main call function with retry + fallback ──────────────────────────────────

const PROVIDER_ADAPTERS: Record<Provider, (opts: CallOptions) => Promise<NormalizedResponse>> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  gemini: callGemini,
  nvidia: callNvidia,
};

export interface CallLLMOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json_object';
  provider: Provider;
  model: string;
  fallbackProviders?: Array<{ provider: Provider; model: string }>;
  timeoutMs?: number;
  maxRetries?: number;
  idempotencyKey?: string;
  schemaVersion?: string;
  cache?: boolean;
  signal?: AbortSignal;
}

export async function callLLM(opts: CallLLMOptions): Promise<NormalizedResponse> {
  const {
    systemPrompt,
    userPrompt,
    maxTokens = 4096,
    temperature = 0.3,
    responseFormat = 'text',
    provider,
    model,
    fallbackProviders = [],
    timeoutMs = 60_000,
    maxRetries = 2,
    cache = true,
    signal,
  } = opts;

  const callOpts: CallOptions = { model, systemPrompt, userPrompt, maxTokens, temperature, responseFormat, signal };
  const chain = [{ provider, model }, ...(fallbackProviders.length > 0 ? fallbackProviders : defaultFallbacks(provider, model))];

  for (let pi = 0; pi < chain.length; pi++) {
    const { provider: p, model: m } = chain[pi];
    const adapter = PROVIDER_ADAPTERS[p];
    const key = cacheKey(opts, p, m);

    if (cache && responseCache.has(key)) {
      logger.debug({ provider: p, model: m, cacheKey: key }, 'LLM cache hit');
      return { ...responseCache.get(key)!, latencyMs: 0 };
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        logger.debug({ provider: p, model: m, attempt, idempotencyKey: opts.idempotencyKey }, 'LLM call');
        const res = await withTimeout(
          adapter({ ...callOpts, model: m }),
          timeoutMs,
          `${p}/${m}`
        );

        if (pi > 0 || attempt > 0) {
          logger.info({ provider: p, model: m, attempt, fallback: pi > 0 }, 'LLM call succeeded after retry/fallback');
        }

        if (cache) responseCache.set(key, res);
        return res;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ provider: p, model: m, attempt, error: msg }, 'LLM call failed');

        if (signal?.aborted) throw new Error('AbortError');
        if (attempt < maxRetries) {
          const cap = Math.min(8_000, Math.pow(2, attempt) * 500);
          const delay = Math.floor(Math.random() * cap);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    logger.warn({ provider: p, model: m }, 'All retries exhausted, trying next provider');
  }

  throw new Error(`All providers failed for query: ${userPrompt.substring(0, 80)}...`);
}

// ── JSON response helper (with schema stripping) ──────────────────────────────

export async function callLLMJson<T>(
  opts: CallLLMOptions,
  parse: (raw: unknown) => T
): Promise<T> {
  const res = await callLLM({ ...opts, responseFormat: 'json_object' });
  let text = res.content.trim();

  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const parsed = JSON.parse(text);
    return parse(parsed);
  } catch {
    throw new Error(`Failed to parse JSON response: ${text.substring(0, 200)}`);
  }
}
