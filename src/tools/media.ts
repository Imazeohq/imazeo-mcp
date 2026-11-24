import { z } from 'zod';
import type { BinaryResult, ProcessingResult } from '@imazeo/sdk';
import type { Register, ToolContext } from '../server.js';
import { ToolError } from '../errors.js';
import { imageTypes, documentTypes, pdfPages } from '../files.js';
import {
  barcodeOptions, confirmation, httpUrl, id, output, pathInput, pdfQuery, pdfSelection,
  processing, qrOptions, rasterFormat, renderPages, transformOptions,
} from '../schemas.js';

const pdf = { '.pdf': documentTypes['.pdf'] };
const codeMime = (format?: string) => format === 'svg' ? 'image/svg+xml' : 'image/png';
const previewTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const codeTypes = { '.png': 'image/png', '.svg': 'image/svg+xml' };
const artifactTypes = {
  qr: codeTypes, barcode: codeTypes, pdf_render: previewTypes,
  pdf_merge: pdf, pdf_extract: pdf, image_transform: imageTypes,
};

function binaryMetadata(result: BinaryResult) {
  return {
    contentType: result.contentType,
    transformationId: result.transformationId,
    cache: result.cache,
  };
}

export async function saveResult(result: ProcessingResult, name: string | undefined, ctx: ToolContext) {
  if ('data' in result) {
    if (!name) throw new ToolError('OUTPUT_REQUIRED', 'Specify an output filename to save this binary result.');
    return {
      ...await ctx.files.save(name, [{ ...result, pageNumber: result.pdfPage }], ctx.signal),
      ...binaryMetadata(result),
    };
  }
  if ('pages' in result && !('pageCount' in result)) {
    if (!name) throw new ToolError('OUTPUT_REQUIRED', 'Specify an output filename to save rendered pages.');
    return ctx.files.save(name, pdfPages(result.pages), ctx.signal);
  }
  if ('pageCount' in result) return { info: result };
  throw new ToolError('INVALID_RESULT', 'Imazeo returned an unexpected processing result.');
}

export function registerMedia(register: Register) {
  register('upload_image',
    'Send a local image to Imazeo and create a private stored original. Uses project storage. Confirm the upload.',
    z.strictObject({ input: pathInput, confirm: confirmation }), 'create',
    async ({ input }, { api, files, signal }) => {
      const [file] = await files.readMany([input], { ...imageTypes, '.svg': 'image/svg+xml' }, signal);
      return { image: await (await api.project()).images.upload(file!, { signal }) };
    });

  register('transform_image',
    'Resize, convert, or edit an owned Imazeo image or public remote image. Sends the request to Imazeo and may spend credits. Remote sources require a remote image.transform quote.',
    z.strictObject({
      source: z.discriminatedUnion('type', [
        z.strictObject({ type: z.literal('original'), imageId: id }),
        z.strictObject({ type: z.literal('url'), url: httpUrl }),
      ]),
      transform: transformOptions.optional(),
      mode: z.enum(['PERSIST', 'CACHE', 'EPHEMERAL']).optional(),
      maxOutputBytes: z.int().min(1).max(64 * 1024 * 1024).optional(),
      output,
      ...processing,
    }), 'create', async ({ source, transform, mode, maxOutputBytes, output, quoteId, idempotencyKey }, ctx) => {
      const format = transform?.format ?? 'webp';
      await ctx.files.prepare(output, 'image/' + format);
      const sourceOptions = source.type === 'original' ? { imageId: source.imageId } : { url: source.url };
      const result = await (await ctx.api.project()).transforms.create(
        { ...sourceOptions, transform, mode, maxOutputBytes }, ctx.signal, { quoteId, idempotencyKey },
      );
      return saveResult(result, output, ctx);
    });

  register('generate_qr',
    'Send text or a URL to Imazeo for static QR generation. May spend credits. Saves PNG or SVG locally.',
    z.strictObject({ options: qrOptions, output, ...processing }), 'create',
    async ({ options, output, quoteId, idempotencyKey }, ctx) => {
      await ctx.files.prepare(output, codeMime(options.format));
      const result = await (await ctx.api.project()).qr.generate(options, ctx.signal, { quoteId, idempotencyKey });
      return saveResult(result, output, ctx);
    });

  register('generate_barcode',
    'Send a barcode payload to Imazeo and generate a static barcode. May spend credits. Saves PNG or SVG locally.',
    z.strictObject({ options: barcodeOptions, output, ...processing }), 'create',
    async ({ options, output, quoteId, idempotencyKey }, ctx) => {
      await ctx.files.prepare(output, codeMime(options.format));
      const result = await (await ctx.api.project()).barcodes.generate(options, ctx.signal, { quoteId, idempotencyKey });
      return saveResult(result, output, ctx);
    });

  register('inspect_pdf',
    'Upload a local PDF to Imazeo to get its page count and dimensions. May spend credits.',
    z.strictObject({ input: pathInput, ...processing }), 'create',
    async ({ input, quoteId, idempotencyKey }, { api, files, signal }) => {
      const [file] = await files.readMany([input], pdf, signal);
      return { info: await (await api.project()).pdf.info(file!, { quoteId, idempotencyKey, signal }) };
    });

  register('render_pdf',
    'Upload a local PDF to Imazeo to render up to 10 selected pages as images. May spend credits. Multiple pages use a -pN filename suffix.',
    z.strictObject({
      input: pathInput, output, selection: pdfSelection.optional(),
      format: rasterFormat.optional(), scale: z.number().min(0.5).max(2).optional(),
      quality: z.int().min(1).max(100).optional(), ...processing,
    }), 'create',
    async ({ input, output, selection, format, scale, quality, quoteId, idempotencyKey }, ctx) => {
      const pages = renderPages(selection);
      if (pages.length > 10) throw new ToolError('INVALID_SELECTION', 'Select up to 10 pages per render.');
      const mime = 'image/' + (format ?? 'png');
      await ctx.files.prepare(output, mime, pages.length === 1 ? undefined : pages);
      const [file] = await ctx.files.readMany([input], pdf, ctx.signal);
      const result = await (await ctx.api.project()).pdf.render(file!, {
        ...pdfQuery(selection), format, scale, quality, quoteId, idempotencyKey, signal: ctx.signal,
      });
      return ctx.files.save(output, 'data' in result
        ? [{ ...result, pageNumber: result.pdfPage }]
        : pdfPages(result.pages), ctx.signal);
    });

  register('merge_pdfs',
    'Upload two to ten local PDFs to Imazeo and merge them in the supplied order. May spend credits. Saves a PDF locally.',
    z.strictObject({ inputs: z.array(pathInput).min(2).max(10), output, ...processing }), 'create',
    async ({ inputs, output, quoteId, idempotencyKey }, ctx) => {
      await ctx.files.prepare(output, 'application/pdf');
      const files = await ctx.files.readMany(inputs, pdf, ctx.signal);
      const result = await (await ctx.api.project()).pdf.merge(files, { quoteId, idempotencyKey, signal: ctx.signal });
      return saveResult(result, output, ctx);
    });

  register('extract_pdf_pages',
    'Upload a local PDF to Imazeo to extract specified pages. May spend credits. Saves a PDF locally.',
    z.strictObject({ input: pathInput, output, selection: pdfSelection, ...processing }), 'create',
    async ({ input, output, selection, quoteId, idempotencyKey }, ctx) => {
      await ctx.files.prepare(output, 'application/pdf');
      const [file] = await ctx.files.readMany([input], pdf, ctx.signal);
      const result = await (await ctx.api.project()).pdf.extract(file!, {
        ...pdfQuery(selection), quoteId, idempotencyKey, signal: ctx.signal,
      });
      return saveResult(result, output, ctx);
    });

  register('download_output',
    'Download a private original, retained transformation, saved artifact, or completed conversion from Imazeo to a new local file. Project bandwidth limits can apply.',
    z.strictObject({
      source: z.enum(['original', 'transform', 'artifact', 'conversion']),
      id, output,
    }), 'download',
    async ({ source, id, output }, ctx) => {
      await ctx.files.prepare(output);
      const sdk = await ctx.api.project();
      const downloads = {
        original: async () => {
          const result = await sdk.images.download(id, ctx.signal);
          if (result.contentType === 'application/octet-stream' && result.format === 'svg') {
            return { ...result, contentType: 'image/svg+xml' };
          }
          return result;
        },
        transform: () => sdk.transforms.download(id, { signal: ctx.signal }),
        artifact: () => sdk.artifacts.download(id),
        conversion: () => sdk.conversions.download(id),
      };
      return saveResult(await downloads[source](), output, ctx);
    });

  register('list_originals',
    'List originals uploaded to the key’s project. Use an image ID in transform_image or download_output.',
    z.strictObject({
      page: z.int().min(1).optional(), limit: z.int().min(1).max(100).optional(),
      q: z.string().min(1).max(100).optional(),
    }), 'read', async (query, { api, signal }) => (await api.project()).images.list(query, signal));

  register('list_outputs',
    'List private outputs and originals associated with the key’s project. Use each item’s downloadSource and ID to download it.',
    z.strictObject({
      page: z.int().min(1).optional(), limit: z.int().min(1).max(100).optional(),
      q: z.string().min(1).max(100).optional(),
      type: z.enum(['all', 'original', 'transform', 'qr', 'barcode', 'pdf', 'docx', 'xlsx', 'pptx', 'website']).optional(),
      scope: z.enum(['all', 'generated']).optional(),
    }), 'read', async (query, { api }) => {
      const { items, ...page } = await (await api.project()).outputs.list(query);
      return {
        ...page,
        items: items.map(({ meta: _meta, ...item }) => ({
          ...item,
          downloadSource: item.kind === 'original' || item.kind === 'transform' ? item.kind : 'artifact',
        })),
      };
    });

  register('save_artifact',
    'Upload a locally generated preview to Imazeo as a private project artifact. Uses project storage. Confirm the upload.',
    z.strictObject({
      input: pathInput, name: z.string().trim().min(1).max(120),
      kind: z.enum(['qr', 'barcode', 'pdf_render', 'pdf_merge', 'pdf_extract', 'image_transform']),
      sourceImageId: id.optional(), confirm: confirmation,
    }), 'create',
    async ({ input, name, kind, sourceImageId }, { api, files, signal }) => {
      const [file] = await files.readMany([input], artifactTypes[kind], signal);
      if (!file?.contentType) {
        throw new ToolError('INVALID_FILE_TYPE', 'The preview must have a supported media extension.');
      }
      const artifact = await (await api.project()).artifacts.save(file, {
        displayName: name, kind, contentType: file.contentType, sourceImageId,
      });
      const { requestSnapshot: _snapshot, ...metadata } = artifact;
      return { artifact: metadata };
    });
}
