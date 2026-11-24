import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('all documented client configurations declare the pinned stdio launch and project key', async () => {
  const { name, version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const packageSpec = `${name}@${version}`;
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.split(/\r?\n/).includes(`npx --yes ${packageSpec}`));
  const doc = await readFile(new URL('../docs/clients.md', import.meta.url), 'utf8');
  const configs = [...doc.matchAll(/^~~~json\r?\n([\s\S]*?)^~~~/gm)].map((match) => JSON.parse(match[1]));
  assert.equal(configs.length, 4);
  const expected = [
    '${env:IMAZEO_API_KEY}', '<project-api-key>',
    '${IMAZEO_API_KEY}', '${input:imazeo-api-key}',
  ];
  for (const [index, config] of configs.entries()) {
    const { imazeo } = config.mcpServers ?? config.servers;
    assert.equal(imazeo.type ?? 'stdio', 'stdio');
    assert.equal(imazeo.command, 'npx');
    assert.deepEqual(imazeo.args, ['--yes', packageSpec]);
    assert.equal(imazeo.env.IMAZEO_API_KEY, expected[index]);
  }
  assert.equal(configs[3].inputs[0].password, true);
});
