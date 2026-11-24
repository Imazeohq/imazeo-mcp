import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../dist/server.js';
import { LocalFiles } from '../dist/files.js';

export const projectId = '01111111-1111-4111-8111-111111111111';
export const quoteId = '02222222-2222-4222-8222-222222222222';
export const idempotencyKey = '03333333-3333-4333-8333-333333333333';
export const operationId = '04444444-4444-4444-8444-444444444444';
export const jobId = '05555555-5555-4555-8555-555555555555';
export const key = 'imz_' + projectId + '.' + 'z'.repeat(43);
export const processing = { quoteId, idempotencyKey, confirm: true };
export const prefix = '/v1/projects/' + projectId;
export const requestId = 'req_test_001';

export function json(data, status = 200, headers = {}) {
  return Response.json({ success: true, data, meta: { requestId } }, {
    status, headers: { 'x-request-id': requestId, ...headers },
  });
}

export function binary(data, type, headers = {}) {
  return new Response(data, {
    headers: { 'content-type': type, 'x-request-id': requestId, ...headers },
  });
}

export async function fileRoots(t) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'imazeo-mcp-test-')));
  const input = path.join(directory, 'input');
  const output = path.join(directory, 'output');
  const env = { IMAZEO_INPUT_DIR: input, IMAZEO_OUTPUT_DIR: output };
  await Promise.all([mkdir(input), mkdir(output)]);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, input, output, env, files: await LocalFiles.fromEnv(env) };
}

export async function harness(t, route) {
  const files = await fileRoots(t);
  const requests = [];
  const server = createServer({ key, files: files.files, fetch: async (url, init) => {
    const request = { url: new URL(url), ...init, headers: new Headers(init.headers) };
    requests.push(request);
    assert.equal(request.url.origin, 'https://api.imazeo.com');
    assert.equal(request.headers.get('x-api-key'), key);
    assert.equal(request.redirect, 'error');
    if (request.url.pathname === '/v1/api-key/context') return json({ projectId, keyId: jobId });
    return route(request);
  } });
  const client = new Client({ name: 'imazeo-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  return {
    ...files, client, requests,
    call(name, args, options) {
      return client.callTool({ name: 'imazeo_' + name, arguments: args }, options);
    },
  };
}

export function ok(result) {
  assert.equal(result.isError, undefined, result.content[0]?.text);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}

export function error(result, code) {
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, code, result.content[0]?.text);
  return result.structuredContent;
}
