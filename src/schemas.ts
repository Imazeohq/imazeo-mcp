import { z } from 'zod';

export const id = z.uuidv4();
export const pathInput = z.string().min(1).max(500)
  .describe('File path relative to IMAZEO_INPUT_DIR. Use forward slashes.');
export const output = z.string().min(1).max(120)
  .describe('New filename, including the media extension, under IMAZEO_OUTPUT_DIR.');
export const confirmation = z.literal(true)
  .describe('Set only after the user authorizes this action and the associated data transfer.');
export const idempotencyKey = id.describe('Caller-generated UUID v4. Retain it for recovery of this exact request.');
export const processing = {
  quoteId: id.describe('Unexpired quote for the same operation, units and remote setting.'),
  idempotencyKey,
  confirm: confirmation,
};
export const quoteKinds = [
  'code.qr', 'code.barcode', 'pdf.info', 'pdf.render', 'pdf.merge', 'pdf.extract',
  'image.transform', 'docx.render', 'xlsx.render', 'pptx.render', 'website.capture',
] as const;
export const pagination = {
  page: z.int().min(1).optional(),
  limit: z.int().min(1).max(100).optional(),
};
export const httpUrl = z.url({ protocol: /^https?$/ }).max(2048)
  .refine((value) => {
    const url = URL.parse(value);
    return url !== null && !url.username && !url.password;
  }, 'Embedded URL credentials are unsupported.')
  .describe('Public HTTP(S) URL without embedded credentials.');
export const rasterFormat = z.enum(['png', 'jpeg', 'webp']);
const color = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);
const rasterQuality = z.int().min(1).max(100);
const dimension = z.int().min(1).max(10000);
const padding = z.int().min(0).max(10000);
const codeStyle = {
  format: z.enum(['png', 'svg']).optional(),
  foreground: color.optional(),
  background: color.optional(),
  transparent: z.boolean().optional(),
};

export const qrOptions = z.strictObject({
  content: z.string().min(1).max(2048).refine((value) => Buffer.byteLength(value) <= 2048),
  ...codeStyle,
  size: z.int().min(128).max(1024).optional(),
  margin: z.int().min(0).max(16).optional(),
  errorCorrection: z.enum(['L', 'M', 'Q', 'H']).optional(),
});

export const barcodeOptions = z.strictObject({
  type: z.enum(['code128', 'code39', 'ean13', 'ean8', 'upca', 'itf14']),
  content: z.string().min(1).max(80).describe('Barcode payload as text. Preserve leading zeroes.'),
  ...codeStyle,
  scale: z.int().min(1).max(6).optional(),
  height: z.int().min(4).max(40).optional(),
  includeText: z.boolean().optional(),
});

export const transformOptions = z.strictObject({
  width: dimension.optional(),
  height: dimension.optional(),
  fit: z.enum(['cover', 'contain', 'inside', 'fill']).optional(),
  crop: z.strictObject({
    left: z.int().min(0).max(25000000), top: z.int().min(0).max(25000000),
    width: dimension, height: dimension,
  }).optional(),
  format: z.enum(['jpeg', 'png', 'webp', 'avif', 'gif']).optional(),
  quality: rasterQuality.optional(),
  rotate: z.literal([-360, -270, -180, -90, 0, 90, 180, 270, 360]).optional(),
  flip: z.boolean().optional(),
  flop: z.boolean().optional(),
  optimize: z.boolean().optional(),
  stripMetadata: z.literal(true).optional(),
  grayscale: z.boolean().optional(),
  negate: z.boolean().optional(),
  blur: z.number().min(0.3).max(10).optional(),
  sharpen: z.number().min(0.5).max(5).optional(),
  brightness: z.number().min(0).max(3).optional(),
  saturation: z.number().min(0).max(3).optional(),
  hue: z.int().min(-180).max(180).optional(),
  trim: z.union([z.literal(true), z.strictObject({ threshold: rasterQuality })]).optional(),
  extend: z.strictObject({ top: padding, right: padding, bottom: padding, left: padding }).optional(),
  background: color.optional(),
  position: z.enum(['center', 'entropy', 'attention']).optional(),
}).refine(({ fit, width, height }) => !fit || fit === 'inside' || (width && height),
  'The selected fit requires width and height.');

const pageNumber = z.int().min(1).max(100);
const pages = z.strictObject({
  mode: z.literal('pages'),
  pages: z.array(pageNumber).min(1).max(100)
    .refine((values) => new Set(values).size === values.length, 'Page numbers must be unique.'),
});
const range = z.strictObject({
  mode: z.literal('range'),
  start: pageNumber,
  end: pageNumber,
}).refine(({ start, end }) => end >= start, 'Page range end must be at or after its start.');

export const pdfSelection = z.discriminatedUnion('mode', [pages, range]);

type Selection = z.output<typeof pdfSelection>;

export function pdfQuery(selection?: Selection) {
  if (selection?.mode === 'pages') return { pages: selection.pages.join(',') };
  if (selection?.mode === 'range') return { rangeStart: selection.start, rangeEnd: selection.end };
  return {};
}

export function renderPages(selection?: Selection) {
  if (selection?.mode === 'pages') return selection.pages;
  if (selection?.mode === 'range') {
    return Array.from({ length: selection.end - selection.start + 1 }, (_, i) => i + selection.start);
  }
  return [1];
}

export const conversionEngines = z.enum(['docx', 'xlsx', 'pptx', 'website']);
const conversionStyle = {
  page: z.int().min(1).max(50).optional(),
  scale: z.number().min(0.1).max(6).optional(),
  format: rasterFormat.optional(),
  quality: rasterQuality.optional(),
};

export const conversion = z.discriminatedUnion('engine', [
  z.strictObject({
    engine: z.literal('docx'),
    input: pathInput,
    options: z.strictObject({
      ...conversionStyle,
      fitSinglePage: z.boolean().optional(),
      honorWordPageBreaks: z.boolean().optional(),
      renderHeaders: z.boolean().optional(),
      renderFooters: z.boolean().optional(),
      renderFootnotes: z.boolean().optional(),
      renderEndnotes: z.boolean().optional(),
      repairBrokenRelationships: z.boolean().optional(),
      unwrapSdt: z.boolean().optional(),
      collapseMcAlternate: z.boolean().optional(),
      ignoreImageWrap: z.boolean().optional(),
      ignoreTableWrap: z.boolean().optional(),
      applyWordChrome: z.boolean().optional(),
      normalizeTheme: z.boolean().optional(),
      renderChanges: z.boolean().optional(),
    }).optional(),
  }),
  z.strictObject({
    engine: z.literal('xlsx'),
    input: pathInput,
    options: z.strictObject({
      ...conversionStyle,
      sheet: z.int().min(1).max(50).optional(),
      renderMode: z.enum(['sheet', 'print']).optional(),
      range: z.string().max(40).optional(),
      showGridLines: z.boolean().optional(),
      paperSize: z.enum(['saved', 'A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid', 'B5']).optional(),
    }).optional(),
  }),
  z.strictObject({
    engine: z.literal('pptx'),
    input: pathInput,
    options: z.strictObject(conversionStyle).optional(),
  }),
  z.strictObject({
    engine: z.literal('website'),
    url: httpUrl,
    options: z.strictObject({
      scale: conversionStyle.scale,
      format: conversionStyle.format,
      quality: conversionStyle.quality,
      mode: z.enum(['viewport', 'fullPage', 'element', 'clip']).optional(),
      width: z.int().min(240).max(3840).optional(),
      height: z.int().min(240).max(2160).optional(),
      selector: z.string().max(200).optional(),
      clipX: z.int().min(0).max(30000).optional(),
      clipY: z.int().min(0).max(30000).optional(),
      clipWidth: z.int().min(1).max(3840).optional(),
      clipHeight: z.int().min(1).max(16000).optional(),
      javascriptEnabled: z.boolean().optional(),
      blockTrackers: z.boolean().optional(),
      autoScroll: z.boolean().optional(),
      freezeAnimations: z.boolean().optional(),
      omitBackground: z.boolean().optional(),
      colorScheme: z.enum(['light', 'dark']).optional(),
      reducedMotion: z.boolean().optional(),
      waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle2']).optional(),
      waitMs: z.int().min(0).max(3000).optional(),
    }).refine(({ mode, selector }) => mode !== 'element' || Boolean(selector?.trim()),
      'Element mode requires a selector.').optional(),
  }),
]);
