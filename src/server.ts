import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createApi, REQUEST_TIMEOUT_MS } from './api.js';
import type { Api, RequestScope } from './api.js';
import { describeError } from './errors.js';
import type { LocalFiles } from './files.js';
import { registerMedia } from './tools/media.js';
import { registerProject } from './tools/project.js';

export const identity = { name: 'com.imazeo/media', title: 'Imazeo Media', version: '1.0.0' };

export type Effect = 'read' | 'download' | 'idempotent' | 'create' | 'destructive';
const annotations: Record<Effect, ToolAnnotations> = {
  read: { readOnlyHint: true, openWorldHint: true },
  download: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  idempotent: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  create: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  destructive: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
};

export interface ToolContext {
  api: Api;
  files: LocalFiles;
  signal: AbortSignal;
}

export type Register = <Schema extends z.ZodObject>(
  name: string,
  description: string,
  schema: Schema,
  effect: Effect,
  action: (input: z.output<Schema>, context: ToolContext) => Promise<object>,
) => void;

function reply(api: Api, data: object, isError = false): CallToolResult {
  const text = api.redact(JSON.stringify(data, (_key, value: unknown) =>
    typeof value === 'string' ? api.redact(value) : value,
  ));
  if (Buffer.byteLength(text) > 512 * 1024) {
    const error = { code: 'RESULT_TOO_LARGE', message: 'Request a smaller result, such as a shorter list or date range.' };
    return { isError: true, structuredContent: error, content: [{ type: 'text', text: JSON.stringify(error) }] };
  }
  const structuredContent = JSON.parse(text) as Record<string, unknown>;
  return { ...(isError ? { isError: true } : {}), structuredContent, content: [{ type: 'text', text }] };
}

export function createServer(options: { key: string; files: LocalFiles; fetch?: typeof fetch }) {
  const api = createApi(options.key, options.fetch);
  const server = new McpServer(identity, {
    instructions: 'Tools access the Imazeo project bound to the configured API key. ' +
      'Obtain a quote and user approval before spending processing credits. ' +
      'Ask before transmitting local files or changing project state. ' +
      'Retain idempotency keys. After an uncertain outcome, check the operation or conversion before considering another submission. ' +
      'Local output tools return filenames and metadata.',
  });
  let active = 0;

  const register: Register = (name, description, schema, effect, action) => {
    // Advertise the schema but own runtime validation so validation messages
    // cannot echo arbitrary property names or rejected values into the client.
    const jsonSchema = z.toJSONSchema(schema, { io: 'input', target: 'draft-07' });
    const inputSchema = z.looseObject({});
    const advertised = {
      ...inputSchema['~standard'],
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
    };

    server.registerTool('imazeo_' + name, {
      description,
      inputSchema: { '~standard': advertised },
      annotations: annotations[effect],
    }, async (input, ctx) => {
      if (active >= 2) return reply(api, { code: 'SERVER_BUSY', message: 'Wait for a current Imazeo call to finish.' }, true);
      if (api.containsSecret(JSON.stringify(input))) {
        return reply(api, { code: 'INVALID_INPUT', message: 'Keep the project key in the server configuration.' }, true);
      }
      const validated = schema.safeParse(input);
      if (!validated.success) {
        return reply(api, { code: 'INVALID_INPUT', message: 'Check the tool input against its published schema.' }, true);
      }

      const signal = AbortSignal.any([ctx.mcpReq.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      const scope: RequestScope = { signal };
      active += 1;
      try {
        signal.throwIfAborted();
        const result = await api.run(scope, () => action(validated.data, { api, files: options.files, signal }));
        return reply(api, {
          ...result,
          ...(scope.requestId ? { requestId: scope.requestId } : {}),
          ...(scope.operationId ? { operationId: scope.operationId } : {}),
        }, 'complete' in result && result.complete === false);
      } catch (error) {
        const described = describeError(error, signal);
        const uncertain = scope.mutationSent && !scope.mutationAccepted &&
          (!scope.status || scope.status >= 500);
        return reply(api, {
          ...described,
          ...(scope.requestId ? { requestId: scope.requestId } : {}),
          ...(scope.operationId ? { operationId: scope.operationId } : {}),
          ...(scope.retryAfter ? { retryAfter: scope.retryAfter } : {}),
          ...(scope.mutationAccepted ? {
            remoteAccepted: true,
            recovery: 'Imazeo accepted the request. Check its operation, job, or project listing before submitting again.',
          } : uncertain ? {
            outcomeUnknown: true,
            recovery: 'Check the operation, job, or project listing before submitting again.',
          } : {}),
        }, true);
      } finally {
        active -= 1;
      }
    });
  };

  registerMedia(register);
  registerProject(register);
  return server;
}
