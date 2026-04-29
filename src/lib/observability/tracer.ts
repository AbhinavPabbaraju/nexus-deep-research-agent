// ─── src/lib/observability/tracer.ts ─────────────────────────────────────────
// Lightweight span-based tracer. Drop-in compatible with OpenTelemetry shapes.
// Logs spans to structured JSON — pipe to Datadog/Grafana/Loki in prod.

import { logger } from './logger';

interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

class Span {
  private name: string;
  private startTime: number;
  private attributes: SpanAttributes;
  private events: SpanEvent[] = [];
  private status: 'ok' | 'error' | 'unset' = 'unset';
  private statusMessage?: string;

  constructor(name: string, attributes: SpanAttributes = {}) {
    this.name = name;
    this.startTime = Date.now();
    this.attributes = attributes;
  }

  setAttribute(key: string, value: string | number | boolean): this {
    this.attributes[key] = value;
    return this;
  }

  addEvent(name: string, attributes?: SpanAttributes): this {
    this.events.push({ name, timestamp: Date.now(), attributes });
    return this;
  }

  setStatus(status: 'success' | 'error', message?: string): this {
    this.status = status === 'success' ? 'ok' : 'error';
    this.statusMessage = message;
    return this;
  }

  end(): void {
    const durationMs = Date.now() - this.startTime;
    const logFn = this.status === 'error' ? logger.error.bind(logger) : logger.info.bind(logger);
    logFn({
      span: this.name,
      durationMs,
      status: this.status,
      statusMessage: this.statusMessage,
      events: this.events,
      ...this.attributes,
    }, `Span: ${this.name}`);
  }
}

class Tracer {
  startSpan(name: string, attributes: SpanAttributes = {}): Span {
    return new Span(name, attributes);
  }
}

export const tracer = new Tracer();
