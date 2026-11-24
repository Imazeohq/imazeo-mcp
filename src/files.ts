import { constants } from 'node:fs';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BinaryResult, PdfRenderPage, UploadSource } from '@imazeo/sdk';
import { ToolError } from './errors.js';

const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
const extensions: Record<string, readonly string[]> = {
  'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'],
  'image/gif': ['.gif'], 'image/avif': ['.avif'],
  'image/svg+xml': ['.svg'], 'application/pdf': ['.pdf'],
};

export const imageTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
};

export const documentTypes = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function portableName(name: string) {
  return /^[\p{L}\p{N}_-][\p{L}\p{N} ._()-]{0,119}$/u.test(name) &&
    !/[. ]$/.test(name) &&
    !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\s*(?:\.|$)/i.test(name);
}

function fileError(code: string, text: string): never {
  throw new ToolError(code, text);
}

async function configureRoot(value: string | undefined, name: string) {
  if (!value) return undefined;
  if (!path.isAbsolute(value) || path.relative(path.parse(value).root, value) === '' ||
      (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(value))) {
    return fileError('INVALID_ROOT', name + ' must be an absolute path to a dedicated directory.');
  }
  const normalized = path.resolve(value);
  try {
    const actual = await realpath(normalized);
    if (path.relative(normalized, actual) !== '' || !(await lstat(normalized)).isDirectory()) {
      throw new Error();
    }
    return actual;
  } catch {
    return fileError('INVALID_ROOT', name + ' must be an existing directory with no symbolic links in its path.');
  }
}

async function checkRoot(root: string | undefined, variable: string) {
  if (!root) return fileError('FILE_ACCESS_DISABLED', 'Configure ' + variable + ' to enable this file operation.');
  if (path.relative(root, await realpath(root)) !== '' || !(await lstat(root)).isDirectory()) {
    return fileError('INVALID_ROOT', 'The configured file directory is unavailable.');
  }
  return root;
}

interface FileResult {
  name: string;
  bytes: number;
  contentType: string;
  pageNumber?: number;
  width?: number;
  height?: number;
}

type OutputBytes = Pick<BinaryResult, 'data' | 'contentType' | 'width' | 'height'> & {
  pageNumber?: number;
};

export class LocalFiles {
  private constructor(private readonly input?: string, private readonly output?: string) {}

  static async fromEnv(env: NodeJS.ProcessEnv) {
    return new LocalFiles(
      await configureRoot(env.IMAZEO_INPUT_DIR, 'IMAZEO_INPUT_DIR'),
      await configureRoot(env.IMAZEO_OUTPUT_DIR, 'IMAZEO_OUTPUT_DIR'),
    );
  }

  async readMany(paths: string[], types: Record<string, string>, signal: AbortSignal) {
    const outputs: Array<Extract<UploadSource, { data: Uint8Array }>> = [];
    let remaining = MAX_UPLOAD_BYTES;
    for (const relative of paths) {
      signal.throwIfAborted();
      const parts = relative.split('/');
      if (parts.length > 12 || !parts.every(portableName)) {
        fileError('INVALID_INPUT_PATH', 'Use a portable path relative to IMAZEO_INPUT_DIR with forward slashes.');
      }
      const filename = parts.at(-1)!;
      const extension = path.extname(filename).toLowerCase();
      const contentType = Object.hasOwn(types, extension) ? types[extension] : undefined;
      if (!contentType) fileError('INVALID_FILE_TYPE', 'The input file extension is unsupported for this operation.');

      try {
        let target = await checkRoot(this.input, 'IMAZEO_INPUT_DIR');
        for (const part of parts.slice(0, -1)) {
          target = path.join(target, part);
          if (!(await lstat(target)).isDirectory()) throw new Error();
        }
        target = path.join(target, filename);
        const entry = await lstat(target, { bigint: true });
        if (!entry.isFile() || entry.nlink !== 1n) throw new Error();
        if (path.relative(target, await realpath(target)) !== '') throw new Error();
        const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) |
          (constants.O_NONBLOCK ?? 0));
        try {
          const opened = await handle.stat({ bigint: true });
          if (opened.ino !== entry.ino || opened.dev !== entry.dev ||
              !opened.isFile() || opened.nlink !== 1n ||
              path.relative(target, await realpath(target)) !== '') {
            throw new Error();
          }
          if (opened.size === 0n || opened.size > BigInt(remaining)) {
            fileError('INPUT_SIZE_LIMIT', 'Each input must be nonempty. Total upload size is limited to 32 MiB per call.');
          }
          const data = Buffer.alloc(Number(opened.size));
          for (let offset = 0; offset < data.byteLength;) {
            signal.throwIfAborted();
            const { bytesRead } = await handle.read(data, offset, data.byteLength - offset, offset);
            if (!bytesRead) throw new Error();
            offset += bytesRead;
          }
          const after = await handle.stat({ bigint: true });
          if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
            throw new Error();
          }
          outputs.push({ data, filename, contentType });
          remaining -= data.byteLength;
        } finally {
          await handle.close();
        }
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ToolError) throw error;
        fileError('INPUT_UNAVAILABLE', 'The input must be a readable regular file under IMAZEO_INPUT_DIR, without links.');
      }
    }
    return outputs;
  }

  async prepare(name: string, contentType?: string, pages?: number[]) {
    if (!portableName(name) || !Object.values(extensions).flat().includes(path.extname(name).toLowerCase())) {
      fileError('INVALID_OUTPUT_NAME', 'Use a single output filename with a supported media extension.');
    }
    if (contentType) assertExtension(name, contentType);
    try {
      const root = await checkRoot(this.output, 'IMAZEO_OUTPUT_DIR');
      const parsed = path.parse(name);
      const planned = pages
        ? pages.map((page) => parsed.name + '-p' + page + parsed.ext)
        : [name];
      for (const candidate of planned) {
        if (!portableName(candidate)) fileError('INVALID_OUTPUT_NAME', 'Use a shorter filename for numbered pages.');
        await assertAbsent(path.join(root, candidate));
      }
    } catch (error) {
      if (error instanceof ToolError) throw error;
      fileError('OUTPUT_UNAVAILABLE', 'The configured output directory is unavailable.');
    }
  }

  async save(name: string, outputs: OutputBytes[], signal: AbortSignal, numbered = outputs.length > 1) {
    if (outputs.length < 1 || outputs.length > 10) {
      fileError('INVALID_RESULT', 'Imazeo returned an unexpected number of files.');
    }
    const parsed = path.parse(name);
    const names = numbered
      ? outputs.map(({ pageNumber }) => parsed.name + '-p' + pageNumber + parsed.ext)
      : [name];
    if (new Set(names).size !== names.length ||
        (numbered && outputs.some(({ pageNumber }) => !Number.isSafeInteger(pageNumber) || pageNumber! < 1))) {
      fileError('INVALID_RESULT', 'Imazeo returned invalid page numbers.');
    }

    const results: FileResult[] = [];
    for (const [index, file] of outputs.entries()) {
      const filename = names[index]!;
      await this.prepare(filename, file.contentType);
      if (!file.data.byteLength) fileError('INVALID_RESULT', 'Imazeo returned an empty file.');
    }
    for (const [index, file] of outputs.entries()) {
      const filename = names[index]!;
      try {
        signal.throwIfAborted();
        const root = await checkRoot(this.output, 'IMAZEO_OUTPUT_DIR');
        const temporary = path.join(root, '.imazeo-' + randomUUID() + '.tmp');
        const handle = await open(temporary, 'wx', 0o600);
        try {
          try {
            await handle.writeFile(file.data, { signal });
            await handle.sync();
          } finally {
            await handle.close();
          }
          signal.throwIfAborted();
          await checkRoot(root, 'IMAZEO_OUTPUT_DIR');
          await link(temporary, path.join(root, filename));
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
        results.push({
          name: filename, bytes: file.data.byteLength,
          contentType: file.contentType.split(';')[0]!,
          pageNumber: file.pageNumber, width: file.width, height: file.height,
        });
      } catch (error) {
        if (results.length) {
          return { files: results, complete: false, error: 'Remaining pages were not written. Recover the result and use a new output filename.' };
        }
        signal.throwIfAborted();
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          fileError('OUTPUT_EXISTS', 'Choose an unused output filename. Existing files are never replaced.');
        }
        fileError('OUTPUT_WRITE_FAILED', 'Could not write the output. Use a writable local directory with hard-link support.');
      }
    }
    return { files: results, complete: true };
  }
}

function assertExtension(name: string, contentType: string) {
  const type = contentType.toLowerCase().split(';')[0]!.trim();
  if (!Object.hasOwn(extensions, type) || !extensions[type]?.includes(path.extname(name).toLowerCase())) {
    fileError('OUTPUT_TYPE_MISMATCH', 'Use a filename extension that matches the output media type.');
  }
}

async function assertAbsent(target: string) {
  try {
    await lstat(target);
    fileError('OUTPUT_EXISTS', 'Choose an unused output filename. Existing files are never replaced.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function pdfPages(pages: PdfRenderPage[]): OutputBytes[] {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 10) {
    fileError('INVALID_RESULT', 'Imazeo returned an unexpected PDF render result.');
  }
  return pages.map(({ data, ...metadata }) => {
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
      fileError('INVALID_RESULT', 'Imazeo returned invalid encoded page data.');
    }
    return { ...metadata, data: Buffer.from(data, 'base64') };
  });
}
