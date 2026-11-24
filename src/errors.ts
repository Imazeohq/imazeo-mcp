import { ImazeoError } from '@imazeo/sdk';

export class ToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const messages: Record<number, string> = {
  400: 'Imazeo rejected the request. Check the inputs and current API limits.',
  401: 'Imazeo rejected the project key. Check IMAZEO_API_KEY.',
  402: 'The Imazeo project has insufficient credits.',
  403: 'The key or project plan does not permit this operation.',
  404: 'The Imazeo resource was not found or is no longer available.',
  409: 'Imazeo reported a conflict. Check the current job, quote, revision, or idempotency key.',
  410: 'The retained Imazeo result is no longer available.',
  413: 'The upload or output exceeds an Imazeo size limit.',
  415: 'Imazeo does not support this file type.',
  422: 'Imazeo could not process the supplied input.',
  429: 'Imazeo is rate limiting requests. Wait before making another request.',
  503: 'The Imazeo API or this feature is currently unavailable.',
};

const codeMessages: Record<string, string> = {
  CREDIT_INSUFFICIENT: 'The Imazeo project has insufficient credits.',
  OPERATION_PENDING: 'The operation is pending. Check its status before submitting again.',
  OPERATION_EXPIRED: 'The result expired. The same operation key will not run again.',
  OPERATION_FAILED: 'The operation failed. The same operation key will not run again.',
  QUOTE_EXPIRED: 'The quote expired or does not match the operation.',
  IDEMPOTENCY_CONFLICT: 'The idempotency key was already used with different inputs.',
};

export function describeError(error: unknown, signal: AbortSignal) {
  if (error instanceof ToolError) return { code: error.code, message: error.message };
  if (signal.aborted) {
    return {
      code: signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED',
      message: 'The MCP call stopped waiting for Imazeo.',
    };
  }
  if (error instanceof ImazeoError && error.status && error.status >= 400) {
    const code = /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code ?? '') ? error.code! : 'IMAZEO_API_ERROR';
    return {
      code,
      status: error.status,
      message: codeMessages[code] ?? messages[error.status] ?? 'Imazeo could not complete the request.',
    };
  }
  return {
    code: 'REQUEST_FAILED',
    message: 'The request could not be completed. Check connectivity and the Imazeo service status.',
  };
}
