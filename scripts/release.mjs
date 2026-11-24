import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const [, , bump, mode, ...extra] = process.argv;
assert.ok(!extra.length && (mode === undefined || mode === '--apply'),
  'Usage: node scripts/release.mjs <patch|minor|major> [--apply]');

const pkg = JSON.parse(read('package.json'));
assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Expected a stable package version.');
const [major, minor, patch] = pkg.version.split('.').map(Number);
assert.ok([major, minor, patch].every((part) => Number.isSafeInteger(part + 1)), 'Invalid version components.');
const next = new Map([
  ['patch', [major, minor, patch + 1].join('.')],
  ['minor', [major, minor + 1, 0].join('.')],
  ['major', [major + 1, 0, 0].join('.')],
]).get(bump);
assert.ok(next, 'Choose patch, minor, or major.');

const tag = 'v' + next;
const existingTag = execFileSync('git', ['tag', '--list', tag], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(existingTag, '', 'Tag ' + tag + ' already exists. Use the publish workflow to retry an existing release.');

assert.equal(pkg.name, '@imazeo/mcp');
const response = await fetch('https://registry.npmjs.org/@imazeo%2fmcp', {
  headers: { Accept: 'application/vnd.npm.install-v1+json' },
  signal: AbortSignal.timeout(20_000),
});
assert.notEqual(response.status, 404, 'Publish the first @imazeo/mcp version with an authorized npm account before using Trusted Publishing.');
assert.ok(response.ok, 'Could not read npm release history (HTTP ' + response.status + ').');
const published = await response.json();
const latest = published['dist-tags']?.latest;
assert.equal(latest, pkg.version,
  'The npm latest version must match main. If v' + pkg.version + ' is already tagged, resolve its publication before creating another tag.');
assert.ok(!Object.hasOwn(published.versions, next), next + ' already exists on npm.');

if (mode === '--apply') {
  const oldVersion = '"version": "' + pkg.version + '"';
  const newVersion = '"version": "' + next + '"';
  const pin = pkg.name + '@' + pkg.version;
  const nextPin = pkg.name + '@' + next;
  const transforms = {
    'package.json': (contents) => contents.replace(oldVersion, newVersion),
    'package-lock.json': (contents) => {
      const lock = JSON.parse(contents);
      assert.equal(lock.version, pkg.version);
      assert.equal(lock.packages[''].version, pkg.version);
      lock.version = next;
      lock.packages[''].version = next;
      return JSON.stringify(lock, null, 2) + '\n';
    },
    'server.json': (contents) => contents.replaceAll(oldVersion, newVersion),
    'src/server.ts': (contents) => contents.replace("version: '" + pkg.version + "'", "version: '" + next + "'"),
    'README.md': (contents) => contents.replaceAll(pin, nextPin),
    'docs/clients.md': (contents) => contents.replaceAll(pin, nextPin),
    'CHANGELOG.md': (contents) => contents.replace(/^## Unreleased(?=\r?$)/m, '## ' + next),
  };
  const edits = Object.entries(transforms).flatMap(([file, transform]) => {
    const previous = read(file);
    const contents = transform(previous);
    if (file !== 'CHANGELOG.md') assert.ok(previous !== contents, 'Could not update the version in ' + file + '.');
    return previous === contents ? [] : [{ file, contents }];
  });
  for (const { file, contents } of edits) writeFileSync(new URL(file, root), contents, 'utf8');
}

process.stdout.write(next + '\n');
