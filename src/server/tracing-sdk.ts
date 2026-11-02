import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  context,
  type Context,
  defaultTextMapGetter,
  defaultTextMapSetter,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  ROOT_CONTEXT,
  type Span,
  type SpanContext,
  SpanKind,
  SpanStatusCode,
  trace,
  type Tracer,
} from '@opentelemetry/api';
import { PRODUCT_SLUG } from '../shared/brand.ts';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter as GrpcExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as ProtoExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { defaultResource, detectResources, envDetector, resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-node';

import {
  type Attributes,
  errorType,
  type HttpRoute,
  type SpanHandle,
  type SpanOptions,
  type TraceLink,
  type TracingImpl,
} from './tracing.ts';

/**
 * The OpenTelemetry side of tracing.ts, loaded only when tracing is on. Everything is configured by the
 * standard environment variables, read by the SDK itself: `OTEL_EXPORTER_OTLP_(TRACES_)ENDPOINT`, `…_HEADERS`,
 * `…_TIMEOUT`, `…_COMPRESSION`, `…_INSECURE`, `OTEL_TRACES_SAMPLER(_ARG)`, `OTEL_BSP_*`, `OTEL_SERVICE_NAME`,
 * `OTEL_RESOURCE_ATTRIBUTES`. Two are read here: `OTEL_TRACES_EXPORTER` (`otlp`, `console`) and
 * `OTEL_EXPORTER_OTLP_(TRACES_)PROTOCOL` (`http/protobuf` by default, `grpc` also supported). Any OTLP
 * collector or backend works: nothing here is specific to one vendor.
 *
 * Only W3C `traceparent`/`tracestate` is read from requests (and set on the render page's loopback requests);
 * baggage is neither read nor recorded.
 */

const SERVICE_NAME = PRODUCT_SLUG;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']);
const propagator = new W3CTraceContextPropagator();

interface Link extends TraceLink {
  spanContext: SpanContext;
}

let contextManagerInstalled = false;

/** AsyncLocalStorage carries the active span across awaits; installed once per process. */
function installContextManager() {
  if (contextManagerInstalled) return;
  contextManagerInstalled = context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
}

export interface CreateTracingOptions {
  /** Export here instead of the environment's exporter (tests: InMemorySpanExporter), synchronously. */
  exporter?: SpanExporter;
}

function protocolFrom(env: NodeJS.ProcessEnv) {
  return (env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'http/protobuf').trim().toLowerCase();
}

/** Where spans go, for the startup log: the endpoint's origin only (never a path, query or credentials). */
function endpointLabel(env: NodeJS.ProcessEnv, protocol: string) {
  const raw = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!raw) return protocol === 'grpc' ? 'localhost:4317' : 'localhost:4318';
  try {
    return new URL(raw).host || raw;
  } catch {
    return 'the configured endpoint';
  }
}

function logLevel(env: NodeJS.ProcessEnv) {
  const level = env.OTEL_LOG_LEVEL?.trim().toUpperCase() as keyof typeof DiagLogLevel | undefined;
  return level && level in DiagLogLevel ? DiagLogLevel[level] : DiagLogLevel.ERROR;
}

export function createTracing(env: NodeJS.ProcessEnv = process.env, options: CreateTracingOptions = {}): TracingImpl {
  installContextManager();
  if (!options.exporter) diag.setLogger(new DiagConsoleLogger(), { logLevel: logLevel(env), suppressOverrideMessage: true });

  const kind = env.OTEL_TRACES_EXPORTER?.split(',')[0]?.trim().toLowerCase() || 'otlp';
  const protocol = protocolFrom(env);
  let exporter: SpanExporter;
  let description: string;
  if (options.exporter) {
    exporter = options.exporter;
    description = 'tracing on (custom exporter)';
  } else if (kind === 'console') {
    exporter = new ConsoleSpanExporter();
    description = 'tracing on: console';
  } else {
    if (kind !== 'otlp') throw new Error(`OTEL_TRACES_EXPORTER must be otlp, console or none, not ${JSON.stringify(kind)}`);
    if (protocol === 'grpc') exporter = new GrpcExporter();
    else if (protocol === 'http/protobuf') exporter = new ProtoExporter();
    else throw new Error(`OTEL_EXPORTER_OTLP_PROTOCOL must be grpc or http/protobuf, not ${JSON.stringify(protocol)}`);
    description = `tracing on: OTLP ${protocol} to ${endpointLabel(env, protocol)}`;
  }

  // why: defaults, then ours, then the environment's (OTEL_SERVICE_NAME, OTEL_RESOURCE_ATTRIBUTES) on top.
  const resource = defaultResource()
    .merge(
      resourceFromAttributes({
        'service.name': SERVICE_NAME,
        ...(env.SERVICE_VERSION && env.SERVICE_VERSION !== 'dev' ? { 'service.version': env.SERVICE_VERSION } : {}),
      }),
    )
    .merge(detectResources({ detectors: [envDetector] }));
  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [options.exporter ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer(SERVICE_NAME);
  const serviceName = String(resource.attributes['service.name'] ?? SERVICE_NAME);
  return new SdkTracing(tracer, provider, `${description} as ${serviceName}`);
}

function clean(attributes: Attributes) {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) if (value !== undefined) result[key] = value;
  return result;
}

function fail(span: Span, error: unknown) {
  span.setAttribute('error.type', errorType(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
}

function handle(span: Span): SpanHandle {
  let ended = false;
  return {
    setAttributes: (attributes) => void span.setAttributes(clean(attributes)),
    setError: (error) => fail(span, error),
    end: (error) => {
      if (ended) return;
      ended = true;
      if (error !== undefined) fail(span, error);
      span.end();
    },
  };
}

const KINDS = { internal: SpanKind.INTERNAL, client: SpanKind.CLIENT, producer: SpanKind.PRODUCER, consumer: SpanKind.CONSUMER };

class SdkTracing implements TracingImpl {
  private readonly requests = new WeakMap<IncomingMessage, Span>();
  /** Spans recordError() already gave an `error.type`, which the status code must not overwrite. */
  private readonly typed = new WeakSet<Span>();
  private readonly tracer: Tracer;
  private readonly provider: NodeTracerProvider;
  readonly description: string;

  constructor(tracer: Tracer, provider: NodeTracerProvider, description: string) {
    this.tracer = tracer;
    this.provider = provider;
    this.description = description;
  }

  private start(name: string, attributes: Attributes, options: SpanOptions = {}): [Span, Context] {
    const parent = options.root ? ROOT_CONTEXT : context.active();
    const links = (options.links ?? []).flatMap((link) => (link ? [{ context: (link as Link).spanContext }] : []));
    const span = this.tracer.startSpan(
      name,
      {
        kind: KINDS[options.kind ?? 'internal'],
        attributes: clean(attributes),
        ...(links.length ? { links } : {}),
        ...(options.startTime !== undefined ? { startTime: options.startTime } : {}),
        ...(options.root ? { root: true } : {}),
      },
      parent,
    );
    return [span, trace.setSpan(parent, span)];
  }

  withSpan<T>(name: string, attributes: Attributes, fn: (span: SpanHandle) => T, options?: SpanOptions): T {
    const [span, active] = this.start(name, attributes, options);
    const spanHandle = handle(span);
    return context.with(active, () => {
      let result: T;
      try {
        result = fn(spanHandle);
      } catch (error) {
        spanHandle.end(error);
        throw error;
      }
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        return (result as unknown as Promise<unknown>).then(
          (value) => {
            spanHandle.end();
            return value;
          },
          (error: unknown) => {
            spanHandle.end(error);
            throw error;
          },
        ) as T;
      }
      spanHandle.end();
      return result;
    });
  }

  startSpan(name: string, attributes: Attributes, options?: SpanOptions) {
    return handle(this.start(name, attributes, options)[0]);
  }

  captureLink(): TraceLink | undefined {
    const span = trace.getActiveSpan();
    return span ? ({ spanContext: span.spanContext() } as Link) : undefined;
  }

  injectHeaders() {
    const headers: Record<string, string> = {};
    propagator.inject(context.active(), headers, defaultTextMapSetter);
    return headers;
  }

  traceRequest(request: IncomingMessage, response: ServerResponse, route: HttpRoute, fn: () => Promise<void>) {
    // why: continue the caller's trace (W3C traceparent); without one this request starts a new trace.
    const parent = propagator.extract(ROOT_CONTEXT, request.headers, defaultTextMapGetter);
    const method = (request.method ?? 'GET').toUpperCase();
    const known = METHODS.has(method);
    const span = this.tracer.startSpan(
      `${known ? method : 'HTTP'} ${route.route}`,
      {
        kind: SpanKind.SERVER,
        attributes: clean({
          'http.request.method': known ? method : '_OTHER',
          'http.route': route.route,
          'url.scheme': 'encrypted' in request.socket && request.socket.encrypted ? 'https' : 'http',
          'network.protocol.version': request.httpVersion,
          'replay.id': route.replayId,
          'suite.id': route.suiteId,
          'suite.run_id': route.runId,
        }),
      },
      parent,
    );
    this.requests.set(request, span);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      const status = response.statusCode;
      span.setAttribute('http.response.status_code', status);
      // why: A response closed before it was finished: the client went away (or a stream broke) mid-body.
      if (!response.writableFinished) span.setAttribute('http.response.incomplete', true);
      // why: server spans: only 5xx are errors (OpenTelemetry HTTP semantic conventions); 4xx are the caller's.
      if (status >= 500) {
        if (!this.typed.has(span)) span.setAttribute('error.type', String(status));
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
    };
    response.once('finish', end);
    response.once('close', end);
    return context.with(trace.setSpan(parent, span), fn);
  }

  setRequestAttributes(request: IncomingMessage, attributes: Attributes) {
    this.requests.get(request)?.setAttributes(clean(attributes));
  }

  recordError(error: unknown, status?: number) {
    const span = trace.getActiveSpan();
    if (!span) return;
    this.typed.add(span);
    span.setAttribute('error.type', errorType(error));
    if (status === undefined || status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
  }

  async shutdown() {
    await this.provider.shutdown();
  }
}
