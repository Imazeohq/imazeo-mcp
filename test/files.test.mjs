import assert from 'node:assert/strict';
import { test } from 'node:test';
import { link, mkdir, readFile, readdir, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileRoots } from './helpers.mjs';
import { LocalFiles, documentTypes } from '../dist/files.js';

const pdf = { '.pdf': documentTypes['.pdf'] };
const signal = new AbortController().signal;

test('local access is opt-in and accepts a regular file in an allowed subdirectory', async (t) => {
  const { input, files } = await fileRoots(t);
  await mkdir(path.join(input, 'uploads'));
  await writeFile(path.join(input, 'uploads', 'résumé.pdf'), 'sample');
  const [file] = await files.readMany(['uploads/résumé.pdf'], pdf, signal);
  assert.equal(file.filename, 'résumé.pdf');
  assert.equal(file.data.toString(), 'sample');

  const disabled = await LocalFiles.fromEnv({});
  await assert.rejects(disabled.readMany(['test.pdf'], pdf, signal), { code: 'FILE_ACCESS_DISABLED' });
  await assert.rejects(disabled.prepare('test.png'), { code: 'FILE_ACCESS_DISABLED' });
  await assert.rejects(LocalFiles.fromEnv({ IMAZEO_INPUT_DIR: '.' }), { code: 'INVALID_ROOT' });
});

test('rejects traversal, device names, absolute paths, links and oversize files', async (t) => {
  const { directory, input, files } = await fileRoots(t);
  for (const name of ['../private.pdf', '/private.pdf', 'sub\\private.pdf', 'C:private.pdf', 'CON.pdf', '.private.pdf', 'sub//private.pdf']) {
    await assert.rejects(files.readMany([name], pdf, signal), { code: 'INVALID_INPUT_PATH' });
  }

  const outside = path.join(directory, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'private.pdf'), 'private');
  await link(path.join(outside, 'private.pdf'), path.join(input, 'alias.pdf'));
  await assert.rejects(files.readMany(['alias.pdf'], pdf, signal), { code: 'INPUT_UNAVAILABLE' });

  const huge = path.join(input, 'huge.pdf');
  await writeFile(huge, '');
  await truncate(huge, 32 * 1024 * 1024 + 1);
  await assert.rejects(files.readMany(['huge.pdf'], pdf, signal), { code: 'INPUT_SIZE_LIMIT' });
});

test('rejects a directory symlink or junction crossing the input boundary', async (t) => {
  const { directory, input, files } = await fileRoots(t);
  const outside = path.join(directory, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'private.pdf'), 'private');
  const alias = path.join(input, 'linked');
  try {
    await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    t.skip('Windows process lacks permission to create directory junctions');
    return;
  }
  await assert.rejects(files.readMany(['linked/private.pdf'], pdf, signal), { code: 'INPUT_UNAVAILABLE' });
  await assert.rejects(LocalFiles.fromEnv({ IMAZEO_INPUT_DIR: alias }), { code: 'INVALID_ROOT' });
});

test('publishes one complete file when two calls race for the same name', async (t) => {
  const { output, files } = await fileRoots(t);
  const results = await Promise.allSettled(['first', 'second'].map((name) => files.save('page.png', [{
    contentType: 'image/png', data: Buffer.from(name),
  }], signal)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failure = results.find((result) => result.status === 'rejected');
  assert.equal(failure.reason.code, 'OUTPUT_EXISTS');
  assert.match(await readFile(path.join(output, 'page.png'), 'utf8'), /^(first|second)$/);
  assert.deepEqual(await readdir(output), ['page.png']);
  await assert.rejects(files.prepare('sub/page.png'), { code: 'INVALID_OUTPUT_NAME' });
  await assert.rejects(files.prepare('page.exe'), { code: 'INVALID_OUTPUT_NAME' });
  await assert.rejects(files.prepare('page.pdf', 'image/png'), { code: 'OUTPUT_TYPE_MISMATCH' });
});
