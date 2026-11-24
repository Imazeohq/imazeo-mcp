import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const manifest = JSON.parse(await readFile(new URL('../server.json', import.meta.url), 'utf8'));
const schemaUrl = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
assert.equal(manifest.$schema, schemaUrl);
const response = await fetch(schemaUrl, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
assert.ok(response.ok, 'Registry schema download failed with status ' + response.status);
const schema = await response.json();

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
assert.ok(validate(manifest), ajv.errorsText(validate.errors, { separator: '\n' }));
process.stdout.write('MCP Registry schema validation passed.\n');
