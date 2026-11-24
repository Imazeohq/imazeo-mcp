#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { LocalFiles } from './files.js';
import { ToolError } from './errors.js';
import { createServer } from './server.js';

async function main() {
  const key = process.env.IMAZEO_API_KEY?.trim();
  if (!key || !/^imz_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(key)) {
    throw new ToolError('INVALID_KEY', 'Set IMAZEO_API_KEY to an Imazeo project API key.');
  }
  const files = await LocalFiles.fromEnv(process.env);
  serveStdio(() => createServer({ key, files }), {
    onerror: () => { process.stderr.write('imazeo-mcp: stdio protocol error.\n'); },
    maxSubscriptions: 8,
  });
}

try {
  await main();
} catch (error) {
  const message = error instanceof ToolError ? error.message : 'Could not start the server.';
  process.stderr.write('imazeo-mcp: ' + message + '\n');
  process.exitCode = 1;
}
