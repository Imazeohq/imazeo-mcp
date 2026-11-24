import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const write = (file, contents) => writeFileSync(new URL(file, root), contents, 'utf8');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionParts(version) {
  assert.match(version, stableVersion, 'Use a stable version in X.Y.Z format.');
  const parts = version.split('.').map(Number);
  assert.ok(parts.every(Number.isSafeInteger), 'Version components must be safe integers.');
  return parts;
}

async function chooseVersion(current) {
  const [major, minor, patch] = versionParts(current);
  const increments = new Map([
    ['patch', `${major}.${minor}.${patch + 1}`],
    ['minor', `${major}.${minor + 1}.0`],
    ['major', `${major + 1}.0.0`],
  ]);
  let choice = process.argv[2];
  if (choice === undefined) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const options = [...increments].map(([kind, version]) => `${kind} (${version})`).join(', ');
      choice = (await prompt.question(`Current version ${current}. Choose ${options}, or enter X.Y.Z to release and push. Enter cancels.\n> `)).trim();
    } finally {
      prompt.close();
    }
  }
  if (!choice) return;

  const next = increments.get(choice) ?? choice;
  const currentParts = [major, minor, patch];
  const nextParts = versionParts(next);
  const changed = nextParts.findIndex((part, index) => part !== currentParts[index]);
  assert.ok(changed !== -1 && nextParts[changed] > currentParts[changed], `Choose a version above ${current}.`);
  return next;
}

async function release() {
  assert.ok(process.argv.length <= 3, 'Use npm run release -- [patch|minor|major|X.Y.Z].');
  assert.ok(process.env.npm_execpath, 'Run with npm run release.');
  assert.equal(git('branch', '--show-current'), 'main', 'Release from the main branch.');
  assert.equal(git('status', '--porcelain'), '', 'Commit your changes before starting a release.');
  const base = git('rev-parse', 'HEAD');
  const pkg = JSON.parse(read('package.json'));
  const next = await chooseVersion(pkg.version);
  if (!next) return;

  const tag = `v${next}`;
  git('fetch', '--tags', 'origin', 'main');
  const upstream = git('rev-parse', 'refs/remotes/origin/main');
  assert.equal(git('merge-base', upstream, base), upstream, 'Sync main with origin before releasing.');
  assert.equal(git('tag', '--list', tag), '', `Tag ${tag} already exists.`);
  assert.equal(git('rev-parse', 'HEAD'), base, 'HEAD changed during release preparation.');
  assert.equal(git('status', '--porcelain'), '', 'The working tree changed during release preparation.');

  const transforms = {
    'package.json': (contents) => contents.replace(`"version": "${pkg.version}"`, `"version": "${next}"`),
    'package-lock.json': (contents) => {
      const lock = JSON.parse(contents);
      assert.equal(lock.version, pkg.version);
      assert.equal(lock.packages[''].version, pkg.version);
      lock.version = next;
      lock.packages[''].version = next;
      return JSON.stringify(lock, null, 2) + '\n';
    },
    'server.json': (contents) => contents.replaceAll(`"version": "${pkg.version}"`, `"version": "${next}"`),
    'src/server.ts': (contents) => contents.replace(`version: '${pkg.version}'`, `version: '${next}'`),
    'README.md': (contents) => contents.replaceAll(`${pkg.name}@${pkg.version}`, `${pkg.name}@${next}`),
    'docs/clients.md': (contents) => contents.replaceAll(`${pkg.name}@${pkg.version}`, `${pkg.name}@${next}`),
    'CHANGELOG.md': (contents) => contents.replace(/^## Unreleased(?=\r?$)/m, `## ${next}`),
  };
  const edits = Object.entries(transforms).map(([file, transform]) => {
    const previous = read(file);
    return { file, previous, contents: transform(previous) };
  }).filter(({ previous, contents }) => previous !== contents);

  try {
    for (const { file, contents } of edits) write(file, contents);
    for (const script of ['lint', 'test', 'check:package']) {
      execFileSync(process.execPath, [process.env.npm_execpath, 'run', script], { cwd: root, stdio: 'inherit' });
    }
  } catch (error) {
    for (const { file, previous, contents } of edits) {
      if (read(file) === contents) write(file, previous);
    }
    throw error;
  }

  const message = `${pkg.name} ${next}`;
  assert.equal(git('branch', '--show-current'), 'main', 'The branch changed during release checks.');
  assert.equal(git('rev-parse', 'HEAD'), base, 'HEAD changed during release checks.');
  for (const { file, contents } of edits) {
    assert.ok(read(file) === contents, `${file} changed during release checks.`);
  }
  git('commit', '--only', '-m', `Release ${message}`, '--', ...edits.map(({ file }) => file));
  const commit = git('rev-parse', 'HEAD');
  git('tag', '-a', tag, '-m', message, commit);
  const pushArgs = ['push', '--atomic', '--no-follow-tags', 'origin', `${commit}:refs/heads/main`, `refs/tags/${tag}`];
  try {
    git(...pushArgs);
  } catch (error) {
    process.stderr.write(`Release ${tag} is committed and tagged locally. To retry the push, run git ${pushArgs.join(' ')}.\n`);
    throw error;
  }
  process.stdout.write(`Pushed ${tag}. Follow the Release MCP package workflow on GitHub.\n`);
}

try {
  await release();
} catch (error) {
  process.stderr.write(`Release failed: ${error.message}\n`);
  process.exitCode = 1;
}
