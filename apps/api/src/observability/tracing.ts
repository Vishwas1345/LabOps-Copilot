// OpenTelemetry setup and helpers. Trace context travels inside job payloads
// as a W3C traceparent, so one incident is one trace across API and worker.

import type { Span } from '@opentelemetry/api';
import { context, propagation, SpanStatusCode, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const tracer = trace.getTracer('labops');

/** Call once per process. Without an endpoint, spans exist but are not exported. */
export function initTracing(options: {
  serviceName: string;
  otlpEndpoint?: string;
  spanProcessors?: SpanProcessor[];
}): NodeTracerProvider {
  const processors = options.spanProcessors ?? [];
  if (options.otlpEndpoint) {
    processors.push(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${options.otlpEndpoint}/v1/traces` })),
    );
  }
  const provider = new NodeTracerProvider({ spanProcessors: processors });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  return provider;
}

/** Runs `fn` in a span named for the lifecycle stage; records failures. */
export async function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** The active trace as a W3C traceparent, to embed in a job payload. */
export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}

/** Runs `fn` as a continuation of the trace that enqueued the job. */
export function withTraceparent<T>(traceparent: string | null | undefined, fn: () => T): T {
  if (!traceparent) return fn();
  const parent = propagation.extract(context.active(), { traceparent });
  return context.with(parent, fn);
}
