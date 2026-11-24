import { AsyncLocalStorage } from 'node:async_hooks';
import { Imazeo } from '@imazeo/sdk';
import { ToolError } from './errors.js';

const API_ORIGIN = 'https://api.imazeo.com';
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const UUID_V4 = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export const REQUEST_TIMEOUT_MS = 120_000;

export interface RequestScope {
  signal: AbortSignal;
  mutationSent?: boolean;
  mutationAccepted?: boolean;
  requestId?: string;
  operationId?: string;
  retryAfter?: string;
  status?: number;
}

export function createApi(apiKey: string, fetcher: typeof fetch = globalThis.fetch) {
  const scopes = new AsyncLocalStorage<RequestScope>();
  const secretForms = new Set([apiKey, encodeURIComponent(apiKey)]);
  let projectId: string | undefined;

  function redact(text: string) {
    for (const secret of secretForms) text = text.replaceAll(secret, '[redacted]');
    return text;
  }

  const boundedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== API_ORIGIN || !url.pathname.startsWith('/v1/')) {
      throw new Error('Invalid Imazeo API destination');
    }

    const scope = scopes.getStore();
    const signal = AbortSignal.any([
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(scope ? [scope.signal] : []),
      ...(init?.signal ? [init.signal] : []),
    ]);
    signal.throwIfAborted();
    const method = init?.method ?? 'GET';
    const mutation = method === 'PATCH' ||
      (method === 'POST' && !/\/(?:quote|lookup)$/.test(url.pathname));

    if (scope && mutation) {
      scope.mutationSent = true;
      scope.status = undefined;
      scope.requestId = undefined;
    }
    const response = await fetcher(url, { ...init, redirect: 'error', signal });
    if (scope) {
      scope.status = response.status;
      const requestId = response.headers.get('x-request-id');
      scope.requestId = requestId && /^[\w-]{1,120}$/.test(requestId) ? requestId : undefined;
      const operationId = response.headers.get('x-operation-id');
      scope.operationId = operationId && UUID_V4.test(operationId) ? operationId : undefined;
      const retryAfter = response.headers.get('retry-after');
      scope.retryAfter = response.status === 429 && retryAfter &&
        (/^\d{1,8}$/.test(retryAfter) || /^[A-Za-z0-9,: -]{24,40} GMT$/.test(retryAfter))
        ? retryAfter : undefined;
      if (mutation && response.ok) scope.mutationAccepted = true;
    }

    // The Imazeo SDK buffers bodies. Apply a decoded-byte cap and keep the
    // cancellation signal active until the body has been read.
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const maxBytes = response.ok ? MAX_RESPONSE_BYTES : 256 * 1024;
    let bytes = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          if (!response.ok) {
            return new Response(null, { status: response.status, headers: response.headers });
          }
          throw new Error('Imazeo response size limit exceeded');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return new Response(new Blob(chunks), {
      status: response.status,
      headers: response.headers,
    });
  };

  const options = {
    apiKey, baseUrl: API_ORIGIN, timeoutMs: REQUEST_TIMEOUT_MS,
    appName: 'Imazeo-MCP', fetch: boundedFetch,
  };
  const unscoped = new Imazeo(options);

  async function context() {
    const result = await unscoped.context.get();
    if (typeof result.projectId !== 'string' || !UUID_V4.test(result.projectId)) {
      throw new ToolError('INVALID_PROJECT', 'Imazeo returned an invalid project ID.');
    }
    projectId = result.projectId;
    return { projectId };
  }

  return {
    context,
    async project() {
      const id = projectId ?? (await context()).projectId;
      return new Imazeo({ ...options, projectId: id });
    },
    run<T>(scope: RequestScope, action: () => Promise<T>) {
      return scopes.run(scope, action);
    },
    redact,
    containsSecret(text: string) {
      return [...secretForms].some((secret) => text.includes(secret));
    },
  };
}

export type Api = ReturnType<typeof createApi>;
