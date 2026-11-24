import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  binary, error, harness, idempotencyKey, jobId, json, ok,
  operationId, prefix, processing, projectId, quoteId, requestId, key,
} from './helpers.mjs';

test('lists tool schemas and validates unknown and missing input without contacting Imazeo', async (t) => {
  const h = await harness(t, () => assert.fail('Unexpected API call'));
  const { tools } = await h.client.listTools();
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.equal(toolsByName.size, 26);
  for (const tool of tools) {
    assert.match(tool.name, /^imazeo_[a-z_]+$/);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.openWorldHint, true);
  }
  assert.equal(toolsByName.get('imazeo_get_conversion').annotations.readOnlyHint, true);
  assert.equal(toolsByName.get('imazeo_cancel_conversion').annotations.destructiveHint, true);
  assert.equal(toolsByName.get('imazeo_generate_qr').annotations.idempotentHint, false);
  assert.ok(toolsByName.get('imazeo_generate_qr').inputSchema.required.includes('quoteId'));
  error(await h.call('project_capabilities', { bogus: key }), 'INVALID_INPUT');
  error(await h.call('get_operation_result', { id: '../operations' }), 'INVALID_INPUT');
  error(await h.call('generate_qr', { ...processing, options: { content: 'Hello' }, output: 'scan.png', confirm: false }), 'INVALID_INPUT');
  assert.equal(h.requests.length, 0);
});

test('quotes before generating a QR code and downloads replay without embedding bytes', async (t) => {
  const content = 'https://example.com';
  const h = await harness(t, (r) => {
    if (r.url.pathname === prefix + '/credits/quote') {
      assert.equal(r.method, 'POST');
      assert.deepEqual(JSON.parse(r.body), { kind: 'code.qr', units: 1 });
      return json({
        id: quoteId, credits: 1, kind: 'code.qr', units: 1, replayEnabled: true,
        unitCost: 1, remoteUnitCost: 0, scheduleId: 'legacy', expiresAt: '2030-01-01T00:00:00.000Z',
      });
    }
    if (r.url.pathname === prefix + '/tools/qr') {
      assert.equal(r.headers.get('x-quote-id'), quoteId);
      assert.equal(r.headers.get('idempotency-key'), idempotencyKey);
      assert.deepEqual(JSON.parse(r.body), { content });
      return binary('qr-bytes', 'image/png', { 'x-operation-id': operationId });
    }
    if (r.url.pathname === prefix + '/operations/lookup') {
      assert.deepEqual(JSON.parse(r.body), { kind: 'code.qr', key: idempotencyKey });
      return json({ id: operationId, kind: 'code.qr', state: 'completed', hasResult: true });
    }
    assert.equal(r.url.pathname, prefix + '/operations/' + operationId + '/result');
    return binary('qr-bytes', 'image/png');
  });
  assert.equal(ok(await h.call('quote_credits', { kind: 'code.qr', units: 1 })).quote.credits, 1);
  const result = ok(await h.call('generate_qr', { ...processing, options: { content }, output: 'scan.png' }));
  assert.equal(result.operationId, operationId);
  assert.equal(result.files[0].name, 'scan.png');
  assert.equal(result.files[0].bytes, 8);
  assert.equal(await readFile(path.join(h.output, 'scan.png'), 'utf8'), 'qr-bytes');

  const alreadyExists = await h.call('generate_qr', { ...processing, options: { content }, output: 'scan.png' });
  error(alreadyExists, 'OUTPUT_EXISTS');
  assert.equal(h.requests.length, 3);

  assert.equal(ok(await h.call('get_operation', {
    lookup: { by: 'key', kind: 'code.qr', idempotencyKey },
  })).operation.id, operationId);
  const recovered = await h.call('get_operation_result', { id: operationId, output: 'recovered.png' });
  assert.equal(ok(recovered).files[0].name, 'recovered.png');
  assert.doesNotMatch(JSON.stringify(recovered), /qr-bytes/);
});

test('uses the production conversion creation routes, then supports polling, cancellation and saving', async (t) => {
  const queued = (engine) => ({ id: jobId, projectId, status: 'queued', engine, credits: 1, result: null });
  const routes = {
    '/conversions': 'docx', '/conversions/xlsx': 'xlsx',
    '/conversions/pptx': 'pptx', '/conversions/website': 'website',
  };
  const h = await harness(t, (r) => {
    const endpoint = r.url.pathname.slice(prefix.length);
    if (r.method === 'POST' && Object.hasOwn(routes, endpoint)) {
      const engine = routes[endpoint];
      assert.equal(r.headers.get('x-quote-id'), quoteId);
      assert.equal(r.headers.get('idempotency-key'), idempotencyKey);
      if (engine === 'website') {
        assert.deepEqual(JSON.parse(r.body), { url: 'https://example.com/' });
        assert.equal(r.url.searchParams.get('javascriptEnabled'), 'false');
      } else {
        assert.equal(r.headers.get('x-upload-length'), '13');
        assert.ok(r.body instanceof FormData);
        const file = r.body.get('file');
        assert.equal(file.name, 'sample.' + engine);
        return file.text().then((bytes) => {
          assert.equal(bytes, 'fixture bytes');
          if (engine === 'docx') assert.equal(r.url.searchParams.get('renderHeaders'), 'false');
          return json(queued(engine), 202);
        });
      }
      return json(queued(engine), 202);
    }
    if (endpoint === '/conversions/lookup') {
      assert.equal(r.url.searchParams.get('key'), idempotencyKey);
      return json(queued('docx'));
    }
    if (endpoint.endsWith('/cancel')) return json({ ...queued('docx'), status: 'cancelled' });
    if (endpoint.endsWith('/save')) return json({ _id: jobId, requestSnapshot: { input: 'private' } });
    if (endpoint.endsWith('/download')) return binary('rendered', 'image/png');
    assert.equal(endpoint, '/conversions/' + jobId);
    return json({ ...queued('docx'), status: 'completed', result: { bytes: 8, width: 400, height: 300 } });
  });

  for (const engine of ['docx', 'xlsx', 'pptx']) {
    const input = 'sample.' + engine;
    await writeFile(path.join(h.input, input), 'fixture bytes');
    const source = { engine, input, ...(engine === 'docx' ? { options: { renderHeaders: false } } : {}) };
    assert.equal(ok(await h.call('submit_conversion', { ...processing, source })).job.engine, engine);
  }
  const source = { engine: 'website', url: 'https://example.com/', options: { javascriptEnabled: false } };
  assert.equal(ok(await h.call('submit_conversion', { ...processing, source })).job.status, 'queued');
  assert.equal(ok(await h.call('get_conversion', { lookup: { by: 'key', idempotencyKey } })).job.id, jobId);
  assert.equal(ok(await h.call('get_conversion', { lookup: { by: 'id', id: jobId } })).job.status, 'completed');
  assert.equal(ok(await h.call('cancel_conversion', { id: jobId, confirm: true })).job.status, 'cancelled');
  assert.deepEqual(ok(await h.call('save_conversion', { id: jobId, confirm: true })).artifact, { _id: jobId });
  assert.equal(ok(await h.call('download_output', { source: 'conversion', id: jobId, output: 'page.png' })).files[0].bytes, 8);
});

test('uploads inputs in multipart order and writes selected PDF pages without base64 in MCP', async (t) => {
  const h = await harness(t, async (r) => {
    assert.ok(r.body instanceof FormData);
    const files = r.body.getAll('file');
    if (r.url.pathname.endsWith('/merge')) {
      assert.deepEqual(files.map((file) => file.name), ['b.pdf', 'a.pdf']);
      assert.deepEqual(await Promise.all(files.map((file) => file.text())), ['PDF b', 'PDF a']);
      return binary('%PDF-merged', 'application/pdf');
    }
    assert.equal(r.url.pathname, prefix + '/tools/pdf/render');
    assert.equal(r.url.searchParams.get('pages'), '3,1');
    return json({ pages: [3, 1].map((pageNumber) => ({
      pageNumber, width: 10, height: 20, contentType: 'image/png',
      data: Buffer.from('page ' + pageNumber).toString('base64'),
    })) });
  });
  await writeFile(path.join(h.input, 'a.pdf'), 'PDF a');
  await writeFile(path.join(h.input, 'b.pdf'), 'PDF b');
  const merged = ok(await h.call('merge_pdfs', { ...processing, inputs: ['b.pdf', 'a.pdf'], output: 'merged.pdf' }));
  assert.equal(merged.files[0].name, 'merged.pdf');

  const render = await h.call('render_pdf', {
    ...processing, input: 'a.pdf', output: 'slide.png', selection: { mode: 'pages', pages: [3, 1] },
  });
  assert.deepEqual(ok(render).files.map(({ name }) => name), ['slide-p3.png', 'slide-p1.png']);
  assert.equal(await readFile(path.join(h.output, 'slide-p3.png'), 'utf8'), 'page 3');
  assert.doesNotMatch(JSON.stringify(render), /cGFnZSA/);
  assert.deepEqual((await readdir(h.output)).sort(), ['merged.pdf', 'slide-p1.png', 'slide-p3.png']);
});

test('submits a remote transformation with an explicit processing key and supports outputs filters', async (t) => {
  const url = 'https://example.com/image.png';
  const h = await harness(t, (r) => {
    if (r.url.pathname === prefix + '/transforms') {
      assert.deepEqual(JSON.parse(r.body), { url, transform: { width: 640, format: 'webp' }, mode: 'CACHE' });
      assert.equal(r.headers.get('x-quote-id'), quoteId);
      return binary('webp fixture', 'image/webp', { 'x-transformation-id': jobId });
    }
    assert.equal(r.url.pathname, prefix + '/outputs');
    assert.equal(r.url.searchParams.get('scope'), 'generated');
    return json([{ id: jobId, kind: 'transform', meta: { ignored: true } }]);
  });
  const result = ok(await h.call('transform_image', {
    ...processing, source: { type: 'url', url }, transform: { width: 640, format: 'webp' },
    mode: 'CACHE', output: 'sample.webp',
  }));
  assert.equal(result.transformationId, jobId);
  assert.deepEqual(ok(await h.call('list_outputs', { scope: 'generated' })).items,
    [{ id: jobId, kind: 'transform', downloadSource: 'transform' }]);
});

test('dynamic QR uses revision and idempotency and drops detailed scan records', async (t) => {
  const destination = 'https://example.com/';
  const h = await harness(t, (r) => {
    if (r.method === 'POST') {
      assert.equal(r.url.pathname, prefix + '/dynamic-codes');
      assert.equal(r.headers.get('idempotency-key'), idempotencyKey);
      assert.deepEqual(JSON.parse(r.body), { name: 'Menu', destination, analyticsEnabled: false });
      return json({ id: jobId, revision: 0, destination }, 201);
    }
    if (r.method === 'PATCH') {
      assert.equal(r.url.pathname, prefix + '/dynamic-codes/' + jobId);
      assert.equal(r.headers.get('idempotency-key'), idempotencyKey);
      assert.deepEqual(JSON.parse(r.body), { expectedRevision: 0, status: 'paused' });
      return json({ id: jobId, revision: 1, status: 'paused' });
    }
    assert.equal(r.url.pathname, prefix + '/dynamic-codes/' + jobId + '/analytics');
    assert.equal(r.url.searchParams.get('bot'), 'false');
    return json({ total: 1, recent: [{ ip: '192.0.2.1', userAgent: 'private' }] });
  });
  assert.equal(ok(await h.call('create_dynamic_qr', {
    idempotencyKey, confirm: true, name: 'Menu', destination, analyticsEnabled: false,
  })).code.revision, 0);
  assert.equal(ok(await h.call('update_dynamic_qr', {
    id: jobId, idempotencyKey, confirm: true, expectedRevision: 0, status: 'paused',
  })).code.status, 'paused');
  assert.deepEqual(ok(await h.call('get_dynamic_qr_analytics', { id: jobId, bot: false })).analytics, { total: 1 });
});

test('sanitizes rate limit errors and never retries failed mutations automatically', async (t) => {
  const h = await harness(t, (r) => {
    if (r.url.pathname === prefix + '/tools/qr') throw new Error('Connectivity error ' + key);
    return Response.json({ success: false, error: { code: 'RATE_LIMITED', message: key, details: { key } } }, {
      status: 429, headers: { 'retry-after': '12', 'x-request-id': requestId },
    });
  });
  const result = await h.call('generate_qr', { ...processing, options: { content: 'sample' }, output: 'qr.png' });
  assert.equal(error(result, 'REQUEST_FAILED').outcomeUnknown, true);
  assert.ok(!JSON.stringify(result).includes(key));
  const read = await h.call('list_originals', {});
  assert.equal(error(read, 'RATE_LIMITED').retryAfter, '12');
  assert.ok(!JSON.stringify(read).includes(key));
  assert.equal(h.requests.filter((r) => r.url.pathname.endsWith('/qr')).length, 1);
});

test('marks remote acceptance when a returned file cannot be saved', async (t) => {
  const h = await harness(t, () => binary('returned svg', 'image/svg+xml', { 'x-operation-id': operationId }));
  const result = await h.call('generate_qr', { ...processing, options: { content: 'sample' }, output: 'qr.png' });
  const data = error(result, 'OUTPUT_TYPE_MISMATCH');
  assert.equal(data.remoteAccepted, true);
  assert.equal(data.operationId, operationId);
  assert.deepEqual(await readdir(h.output), []);
});

test('propagates MCP cancellation through response body reads', { timeout: 10_000 }, async (t) => {
  const controller = new AbortController();
  let bodyStarted;
  const started = new Promise((resolve) => { bodyStarted = resolve; });
  let signal;
  const h = await harness(t, (request) => {
    signal = request.signal;
    return new Response(new ReadableStream({
      start(stream) {
        signal.addEventListener('abort', () => stream.error(signal.reason), { once: true });
        bodyStarted();
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  const call = h.call('list_originals', {}, { signal: controller.signal });
  await started;
  const abortObserved = new Promise((resolve) => { signal.addEventListener('abort', resolve, { once: true }); });
  controller.abort();
  await assert.rejects(call);
  await abortObserved;
});

test('stores an original and a bounded preview with exact upload lengths', async (t) => {
  const fixture = 'image fixture';
  const h = await harness(t, async (r) => {
    assert.equal(r.method, 'POST');
    assert.equal(r.headers.get('x-upload-length'), String(Buffer.byteLength(fixture)));
    assert.equal(await r.body.get('file').text(), fixture);
    if (r.url.pathname === prefix + '/images') {
      return json({ _id: jobId, projectId, originalName: 'logo.png' }, 201);
    }
    assert.equal(r.url.pathname, prefix + '/tools/artifacts');
    assert.equal(r.body.get('kind'), 'qr');
    assert.equal(r.body.get('displayName'), 'Menu code');
    assert.equal(r.body.get('contentType'), 'image/png');
    return json({ _id: jobId, projectId, requestSnapshot: {} }, 201);
  });
  await writeFile(path.join(h.input, 'logo.png'), fixture);
  assert.equal(ok(await h.call('upload_image', { input: 'logo.png', confirm: true })).image._id, jobId);
  error(await h.call('save_artifact', {
    input: 'logo.png', name: 'PDF export', kind: 'pdf_extract', confirm: true,
  }), 'INVALID_FILE_TYPE');
  const artifact = ok(await h.call('save_artifact', {
    input: 'logo.png', name: 'Menu code', kind: 'qr', confirm: true,
  })).artifact;
  assert.deepEqual(artifact, { _id: jobId, projectId });
  assert.equal(h.requests.length, 3);
});

test('inspects and extracts PDF pages and preserves leading zeroes in barcodes', async (t) => {
  const info = { pageCount: 1, encrypted: false, pages: [{ pageNumber: 1, width: 80, height: 100 }] };
  const h = await harness(t, (r) => {
    if (r.url.pathname === prefix + '/tools/pdf/info') return json(info);
    if (r.url.pathname === prefix + '/tools/pdf/extract') {
      assert.equal(r.url.searchParams.get('rangeStart'), '1');
      assert.equal(r.url.searchParams.get('rangeEnd'), '1');
      return binary('%PDF-extracted', 'application/pdf');
    }
    if (r.url.pathname === prefix + '/tools/barcode') {
      assert.deepEqual(JSON.parse(r.body), { type: 'ean8', content: '0123456', format: 'svg', includeText: false });
      return binary('<svg/>', 'image/svg+xml');
    }
    assert.equal(r.url.pathname, prefix + '/operations/' + operationId + '/result');
    return json(info);
  });
  await writeFile(path.join(h.input, 'sheet.pdf'), 'PDF fixture');
  assert.deepEqual(ok(await h.call('inspect_pdf', { ...processing, input: 'sheet.pdf' })).info, info);
  const extracted = ok(await h.call('extract_pdf_pages', {
    ...processing, input: 'sheet.pdf', output: 'selected.pdf', selection: { mode: 'range', start: 1, end: 1 },
  }));
  assert.equal(extracted.files[0].name, 'selected.pdf');
  assert.deepEqual(ok(await h.call('get_operation_result', { id: operationId })).info, info);
  const generated = ok(await h.call('generate_barcode', {
    ...processing, output: 'barcode.svg', options: { type: 'ean8', content: '0123456', format: 'svg', includeText: false },
  }));
  assert.equal(generated.files[0].name, 'barcode.svg');
});
