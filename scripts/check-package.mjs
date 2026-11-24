import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { identity } from '../dist/server.js';

const project = fileURLToPath(new URL('..', import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(new URL('../' + file, import.meta.url), 'utf8'));
const pkg = await readJson('package.json');
const lock = await readJson('package-lock.json');
const registry = await readJson('server.json');
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].name, pkg.name);
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(registry.name, pkg.mcpName);
assert.equal(registry.name, identity.name);
assert.equal(registry.version, pkg.version);
assert.equal(identity.version, pkg.version);
assert.equal(registry.repository.source, 'github');
assert.equal(registry.repository.url, pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''));
assert.equal(registry.packages.length, 1);
const [entry] = registry.packages;
assert.equal(entry.registryType, 'npm');
assert.equal(entry.registryBaseUrl, pkg.publishConfig.registry);
assert.equal(pkg.publishConfig.access, 'public');
assert.equal(entry.identifier, pkg.name);
assert.equal(entry.version, pkg.version);
assert.equal(entry.runtimeHint, 'npx');
assert.equal(entry.transport.type, 'stdio');
assert.ok(!registry.remotes);
assert.deepEqual(entry.environmentVariables.map(({ name }) => name), [
  'IMAZEO_API_KEY', 'IMAZEO_INPUT_DIR', 'IMAZEO_OUTPUT_DIR',
]);
assert.equal(entry.environmentVariables[0].isRequired, true);
assert.equal(entry.environmentVariables[0].isSecret, true);

assert.ok(process.env.npm_execpath, 'Run with npm run check:package.');
const createTarball = process.argv.includes('--pack');
const packArgs = ['pack', '--json', '--ignore-scripts'];
if (!createTarball) packArgs.push('--dry-run');
const output = execFileSync(process.execPath, [process.env.npm_execpath, ...packArgs], {
  cwd: project, encoding: 'utf8',
});
const [pack] = JSON.parse(output);
assert.equal(pack.name, pkg.name);
assert.equal(pack.version, pkg.version);
const files = pack.files.map(({ path }) => path).sort();
assert.deepEqual(files, [
  'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'README.md', 'SECURITY.md',
  'dist/api.js', 'dist/cli.js', 'dist/errors.js', 'dist/files.js', 'dist/schemas.js', 'dist/server.js',
  'dist/tools/media.js', 'dist/tools/project.js',
  'docs/architecture.md', 'docs/clients.md', 'docs/releasing.md',
  'package.json', 'server.json',
].sort());
const executable = await readFile(new URL('../' + pkg.bin['imazeo-mcp'], import.meta.url), 'utf8');
assert.ok(executable.startsWith('#!/usr/bin/env node\n') || executable.startsWith('#!/usr/bin/env node\r\n'));
process.stdout.write('Validated ' + files.length + ' npm package files.\n');
if (createTarball) process.stdout.write('Release tarball: ' + pack.filename + '\n');
