import { z } from 'zod';
import type { Register } from '../server.js';
import type { ConversionJob } from '@imazeo/sdk';
import { documentTypes } from '../files.js';
import { ToolError } from '../errors.js';
import { saveResult } from './media.js';
import {
  confirmation, conversion, conversionEngines, httpUrl, id, idempotencyKey, output,
  pagination, processing, qrOptions, quoteKinds,
} from '../schemas.js';

const dynamicStatus = z.enum(['active', 'paused', 'deleted']);
const name = z.string().trim().min(1).max(100);

function jobSummary(job: ConversionJob) {
  const { options: _options, result, ...metadata } = job;
  if (!result) return { ...metadata, result };
  const { warnings: _warnings, ...dimensions } = result;
  return { ...metadata, result: dimensions };
}

export function registerProject(register: Register) {
  register('project_capabilities',
    'Check the Imazeo project ID and optionally read conversion, dynamic QR, or output availability information.',
    z.strictObject({ detail: z.enum(['identity', 'conversions', 'dynamic_qr', 'outputs']).optional() }), 'read',
    async ({ detail }, { api }) => {
      if (!detail || detail === 'identity') return api.context();
      const sdk = await api.project();
      if (detail === 'conversions') return { conversions: await sdk.conversions.capabilities() };
      if (detail === 'dynamic_qr') return { dynamicQr: await sdk.dynamicCodes.capabilities() };
      return { outputs: await sdk.outputs.summary() };
    });

  register('quote_credits',
    'Request an expiring Imazeo processing quote without running the operation or spending processing credits. Set remote for a transform using a public source URL.',
    z.strictObject({
      kind: z.enum(quoteKinds),
      units: z.int().min(1).max(100).describe('Measurable units for the operation. Common cases use one unit.'),
      remote: z.boolean().optional(),
    }), 'create',
    async ({ kind, units, remote }, { api }) => {
      if ((remote && kind !== 'image.transform') || (kind === 'pdf.render' ? units > 10 : units !== 1)) {
        throw new ToolError('INVALID_INPUT', 'Quote one unit per operation or up to 10 for PDF rendering. Only URL image transforms use the remote flag.');
      }
      return { quote: await (await api.project()).credits.quote({ kind, units, remote }) };
    });

  register('get_operation',
    'Read the status of an Imazeo processing operation by its operation ID or recover it using the original operation kind and idempotency key.',
    z.strictObject({
      lookup: z.discriminatedUnion('by', [
        z.strictObject({ by: z.literal('id'), id }),
        z.strictObject({
          by: z.literal('key'), kind: z.enum([...quoteKinds, 'remote.fetch']), idempotencyKey,
        }),
      ]),
    }), 'read',
    async ({ lookup }, { api }) => {
      const { operations } = await api.project();
      const operation = lookup.by === 'id'
        ? await operations.get(lookup.id)
        : await operations.lookup({ kind: lookup.kind, key: lookup.idempotencyKey });
      return { operation };
    });

  register('get_operation_result',
    'Recover an available retained operation result from Imazeo. Returns PDF metadata or downloads media to a new local filename; multi-page PDF renders are numbered. Project bandwidth limits can apply.',
    z.strictObject({ id, output: output.optional() }), 'download',
    async ({ id, output }, ctx) => {
      if (output) await ctx.files.prepare(output);
      const result = await (await ctx.api.project()).operations.result(id);
      return saveResult(result, output, ctx);
    });

  register('submit_conversion',
    'Queue a DOCX page, XLSX sheet or print page, PPTX slide, or public website capture. Sends the file or URL to Imazeo and reserves credits. Confirm after reviewing the matching one-unit quote.',
    z.strictObject({ source: conversion, ...processing }), 'idempotent',
    async ({ source, quoteId, idempotencyKey }, { api, files, signal }) => {
      const request = { quoteId, idempotencyKey, signal };
      if (source.engine === 'website') {
        const job = await (await api.project()).conversions.website(source.url, request, source.options);
        return { job: jobSummary(job) };
      }
      const extension = ('.' + source.engine) as keyof typeof documentTypes;
      const [file] = await files.readMany([source.input], { [extension]: documentTypes[extension] }, signal);
      const { conversions } = await api.project();
      const job = await conversions[source.engine](file!, request, source.options);
      return { job: jobSummary(job) };
    });

  register('get_conversion',
    'Check an Imazeo conversion job by ID, or recover submission by the original idempotency key.',
    z.strictObject({
      lookup: z.discriminatedUnion('by', [
        z.strictObject({ by: z.literal('id'), id }),
        z.strictObject({ by: z.literal('key'), idempotencyKey }),
      ]),
    }), 'read',
    async ({ lookup }, { api }) => {
      const { conversions } = await api.project();
      const job = lookup.by === 'id'
        ? await conversions.get(lookup.id) : await conversions.lookup(lookup.idempotencyKey);
      return { job: jobSummary(job) };
    });

  register('list_conversions',
    'List recent Imazeo conversion jobs for one engine. Results may include temporary jobs.',
    z.strictObject({ engine: conversionEngines }), 'read',
    async ({ engine }, { api }) => {
      const jobs = await (await api.project()).conversions.list(engine);
      return { jobs: jobs.map(jobSummary) };
    });

  register('cancel_conversion',
    'Request cancellation of an Imazeo conversion. The returned job is authoritative. Confirm before stopping work.',
    z.strictObject({ id, confirm: confirmation }), 'destructive',
    async ({ id }, { api }) => ({ job: jobSummary(await (await api.project()).conversions.cancel(id)) }));

  register('save_conversion',
    'Save a completed temporary conversion as a private Imazeo project artifact. Uses project storage. Confirm before saving.',
    z.strictObject({ id, confirm: confirmation }), 'idempotent',
    async ({ id }, { api }) => {
      const { requestSnapshot: _snapshot, ...artifact } = await (await api.project()).conversions.save(id);
      return { artifact };
    });

  register('list_dynamic_qr',
    'List dynamic QR links in the Imazeo project, including revision and redirect URL.',
    z.strictObject({ ...pagination, status: dynamicStatus.optional(), search: z.string().max(100).optional() }),
    'read', async (query, { api }) => (await api.project()).dynamicCodes.list(query));

  register('get_dynamic_qr',
    'Read one dynamic QR link and its current revision. Encode the redirect URL with generate_qr to make a local QR image.',
    z.strictObject({ id }), 'read',
    async ({ id }, { api }) => ({ code: await (await api.project()).dynamicCodes.get(id) }));

  register('create_dynamic_qr',
    'Create a managed Imazeo redirect for a dynamic QR code. Sends its name and destination to Imazeo and uses the project’s dynamic code quota. Confirm before creation.',
    z.strictObject({
      name, destination: httpUrl, analyticsEnabled: z.boolean().optional(), idempotencyKey, confirm: confirmation,
    }), 'idempotent',
    async ({ idempotencyKey, confirm: _confirm, ...input }, { api }) =>
      ({ code: await (await api.project()).dynamicCodes.create(input, idempotencyKey) }));

  register('update_dynamic_qr',
    'Change a dynamic QR link’s destination, name, analytics, appearance options, or status. Setting deleted retires the link. Confirm against the current revision.',
    z.strictObject({
      id, expectedRevision: z.int().min(0), name: name.optional(), destination: httpUrl.optional(),
      status: dynamicStatus.optional(), analyticsEnabled: z.boolean().optional(),
      qrOptions: qrOptions.optional(), idempotencyKey, confirm: confirmation,
    }), 'destructive',
    async ({ id, idempotencyKey, confirm: _confirm, ...input }, { api }) => {
      if (Object.values(input).filter((value) => value !== undefined).length < 2) {
        throw new ToolError('INVALID_INPUT', 'Specify at least one dynamic QR field to change.');
      }
      return { code: await (await api.project()).dynamicCodes.update(id, input, idempotencyKey) };
    });

  register('get_dynamic_qr_analytics',
    'Read aggregate scan counts for one Imazeo dynamic QR link. Supports plan-gated date ranges and filters.',
    z.strictObject({
      id, days: z.int().min(1).max(90).optional(),
      device: z.enum(['desktop', 'mobile', 'tablet', 'bot', 'unknown']).optional(),
      browser: z.enum(['chrome', 'edge', 'firefox', 'safari', 'other', 'unknown']).optional(),
      country: z.string().regex(/^(?:[A-Za-z]{2}|unknown)$/).optional(), bot: z.boolean().optional(),
    }), 'read',
    async ({ id, ...query }, { api }) => {
      const { recent: _recent, ...analytics } = await (await api.project()).dynamicCodes.analytics(id, query);
      return { analytics };
    });
}
