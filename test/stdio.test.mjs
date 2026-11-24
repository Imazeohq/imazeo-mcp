import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { key } from './helpers.mjs';

const entry = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

for (const era of ['legacy', 'modern']) {
  test('packaged entry supports ' + era + ' MCP stdio', async (t) => {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [entry], env: { IMAZEO_API_KEY: key }, stderr: 'pipe',
    });
    const client = new Client({ name: 'protocol-test', version: '1.0.0' },
      era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : undefined,
    );
    let stderr = '';
    transport.stderr.on('data', (chunk) => { stderr += chunk; });
    t.after(() => client.close());
    await client.connect(transport);
    assert.equal(client.getProtocolEra(), era);
    assert.equal(client.getServerVersion().name, 'com.imazeo/media');
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === 'imazeo_generate_qr'));
    const result = await client.callTool({ name: 'imazeo_download_output', arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'INVALID_INPUT');
    assert.equal(stderr, '');
  });
}

test('startup validation writes a safe diagnostic to stderr only', () => {
  const run = spawnSync(process.execPath, [entry], {
    env: { IMAZEO_API_KEY: 'unrecognized-sensitive-input' }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /Set IMAZEO_API_KEY/);
  assert.doesNotMatch(run.stderr, /unrecognized-sensitive-input/);
});
